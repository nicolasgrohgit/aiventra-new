import { DateTime } from 'luxon';

// Server-side only (uses Mongo aggregation shapes) but kept pure/DB-free so it's directly
// unit-testable — see lib/place-matching.test.ts. Shared by both the solo recommendation
// endpoint (POST /api/recommendations) and the blind joint-matching endpoint
// (POST /api/events/:id/recommendations) in server.ts, so "one place, one meaning" holds
// for how a place gets scored/filtered regardless of which endpoint is asking.

export interface MealTimePreferences {
  earliestLunchTime?: string; // "HH:mm", 24h — e.g. "20:00" for someone who never eats dinner before 8pm
  earliestDinnerTime?: string;
}

export function parseHourString(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const [h, m] = value.split(':').map(Number);
  if (Number.isNaN(h)) return fallback;
  return h + (Number.isNaN(m) ? 0 : m) / 60;
}

// Single source of truth for the lunch/dinner windows — shifts the *start* by the user's
// preference (undefined = today's exact defaults, so nobody's behavior changes until they set
// this) while keeping each window's existing width fixed. Shared by isMealWindow below and by
// lib/free-time.ts's slot labeling/splitting, so "when is dinner" means the same thing
// wherever it's asked.
export function getMealWindows(mealPrefs: MealTimePreferences = {}) {
  const lunchStart = parseHourString(mealPrefs.earliestLunchTime, 11.5);
  const dinnerStart = parseHourString(mealPrefs.earliestDinnerTime, 18.5);
  return {
    lunchStart, lunchEnd: lunchStart + 2,
    dinnerStart, dinnerEnd: dinnerStart + 2.5
  };
}

export function isMealWindow(startTime: Date, timezone: string, mealPrefs: MealTimePreferences = {}): boolean {
  const start = DateTime.fromJSDate(startTime).setZone(timezone);
  const timeAsDecimal = start.hour + start.minute / 60;
  const { lunchStart, lunchEnd, dinnerStart, dinnerEnd } = getMealWindows(mealPrefs);
  const isLunch = timeAsDecimal >= lunchStart && timeAsDecimal <= lunchEnd;
  const isDinner = timeAsDecimal >= dinnerStart && timeAsDecimal <= dinnerEnd;
  return isLunch || isDinner;
}

export function flattenPreferenceTags(preferences: any): string[] {
  if (!preferences) return [];
  return [
    ...(preferences.foodGenres || []),
    ...(preferences.activityGenres || []),
    ...(preferences.eventGenres || [])
  ];
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// City strings in this app come in two shapes depending on where they were entered: a bare
// city name ("Paris", from the Home tab's reverse-geocoded live location) or "City, Country"
// (from the geocoding-autocomplete picker used for trip destinations/homebase, e.g.
// trips.tsx's `${c.name}, ${c.country}`). A plain substring match only catches one direction
// — a stored "Paris" does NOT contain the query "Paris, France", so a trip to "Paris, France"
// would silently never match the curated `city: 'Paris'` places seeded by
// scripts/seed-curated-places.ts. Reducing both sides to the name-only prefix before matching
// makes it symmetric regardless of which shape either side happens to be in.
export function cityNeedle(city: string): string {
  return city.split(',')[0].trim();
}

/**
 * Mongo category filter for the time-of-day the event/slot falls in: meal windows (short
 * enough to actually be a meal) get restaurants only (excluding cafes); everything else gets
 * activities/events/cafes. Same rule used client-side for the old mock data, now the single
 * server-side source of truth.
 */
export function buildCategoryFilter(mealWindow: boolean, durationMinutes: number): any {
  if (mealWindow && durationMinutes <= 120) {
    return { category: 'Restaurant', genre: { $ne: 'Cafes' } };
  }
  if (!mealWindow) {
    return {
      $or: [
        { category: 'Activity' },
        { category: 'Event' },
        { category: 'Restaurant', genre: 'Cafes' }
      ]
    };
  }
  return {};
}

// Default "near me" ceiling for the initial search — chosen against the real spread of
// distanceKm values across curated Paris/Rome/London data (roughly 0.3-7.2km), so this
// genuinely excludes a meaningful tail of farther-out places rather than being a no-op cap.
// "Expand Search Radius" (recommendation.tsx) re-queries with this ceiling raised/removed.
export const DEFAULT_MAX_DISTANCE_KM = 5;

// The city/duration/category conditions shared by both the static-field fallback match stage
// below and buildGeoNearStage's `query` sub-option — split out so the two paths can't drift
// apart on anything except how distance itself is filtered.
export function buildCityDurationQuery(
  city: string,
  durationMinutes: number,
  mealWindow: boolean
): any {
  // Substring, not exact-anchored: city strings aren't consistent across the app — a trip
  // destination is typically "Amsterdam, Netherlands" (picked from geocoding autocomplete),
  // while the Home tab's reverse-geocoded current location is a bare "Amsterdam". An anchored
  // ^...$ match would treat those as different cities and silently return nothing.
  return {
    city: { $regex: escapeRegExp(cityNeedle(city)), $options: 'i' },
    estimatedDuration: { $lte: durationMinutes },
    ...buildCategoryFilter(mealWindow, durationMinutes)
  };
}

/**
 * Fallback match stage for trips with no real anchor point yet (Trip.baseLocations empty —
 * pre-migration trips, or a city whose geocoding failed) — filters against the static,
 * approximate Place.distanceKm field exactly as this app always has. Prefer
 * buildGeoNearStage over this whenever a real anchor point is available.
 */
export function buildCityDurationMatchStage(
  city: string,
  durationMinutes: number,
  mealWindow: boolean,
  maxDistanceKm: number = DEFAULT_MAX_DISTANCE_KM
): any {
  return {
    ...buildCityDurationQuery(city, durationMinutes, mealWindow),
    distanceKm: { $lte: maxDistanceKm }
  };
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface BaseLocation extends GeoPoint {
  source: 'hotel' | 'city';
  startDate: Date;
  endDate: Date;
}

/**
 * Picks the right Trip.baseLocations entry for a given date — the one whose date range
 * contains it, preferring 'hotel' (precise) over 'city' (free centroid fallback) when both
 * exist for that range. Trivial today (Trip.baseLocations has at most one date range, since
 * this app is 1 trip = 1 city), written to generalize cleanly once a trip can span multiple
 * cities/date-ranges. Returns null if no entry covers the date — the caller falls back to the
 * static-distanceKm match stage in that case.
 *
 * Compares by *calendar day*, not exact instant: Trip.start_date/end_date (and the
 * baseLocations entries mirroring them) carry whatever time-of-day happened to be selected
 * when the trip was saved (e.g. 13:18, not midnight) — a naive instant comparison would make a
 * recommendation query for earlier that same day silently miss its own trip's anchor point and
 * fall back to the static-distanceKm path, exactly the bug this comment is here to prevent a
 * regression back into.
 */
export function resolveAnchorForDate(baseLocations: BaseLocation[], date: Date): GeoPoint | null {
  const day = date.toISOString().slice(0, 10); // "YYYY-MM-DD", UTC calendar day
  const candidates = baseLocations.filter(b =>
    day >= b.startDate.toISOString().slice(0, 10) && day <= b.endDate.toISOString().slice(0, 10)
  );
  if (candidates.length === 0) return null;
  const hotel = candidates.find(b => b.source === 'hotel');
  const chosen = hotel || candidates[0];
  return { lat: chosen.lat, lng: chosen.lng };
}

/**
 * Real geospatial first-pipeline-stage, replacing the static distanceKm filter with an actual
 * computed distance from a real anchor point (a trip's hotel or city-centroid location — see
 * Trip.baseLocations). $geoNear MUST be the first stage of the aggregation and requires a
 * 2dsphere index on the queried field (see models/Place.ts). `query` carries every other
 * match condition (city/duration/category — see buildCityDurationQuery) since $geoNear folds
 * filtering and distance computation into one stage rather than a separate $match.
 *
 * maxDistance is always interpreted in meters by Mongo for a 2dsphere-indexed GeoJSON field,
 * regardless of distanceMultiplier (which only scales the *output* distanceField) — easy to
 * get backwards, so spelled out here rather than left implicit.
 */
export function buildGeoNearStage(anchor: GeoPoint, maxDistanceKm: number, query: any): any {
  return {
    $geoNear: {
      near: { type: 'Point', coordinates: [anchor.lng, anchor.lat] },
      distanceField: 'distanceKm',
      maxDistance: maxDistanceKm * 1000,
      distanceMultiplier: 0.001,
      spherical: true,
      query
    }
  };
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two points, in km — used to verify jitterCoordinates in tests. */
export function haversineDistanceKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * A random point between minKm and maxKm from `center`, at a random bearing — used to give
 * synthetic 'generated' filler Places (lib/places-population.ts) a plausible real-ish location
 * when there's no actual venue to geocode, so distance filtering still behaves sensibly for
 * thin-coverage cities instead of leaving `location` unset there as a special case.
 */
export function jitterCoordinates(center: GeoPoint, minKm: number, maxKm: number): GeoPoint {
  const distanceKm = minKm + Math.random() * (maxKm - minKm);
  const bearing = Math.random() * 2 * Math.PI;
  const angularDistance = distanceKm / EARTH_RADIUS_KM;

  const latRad = (center.lat * Math.PI) / 180;
  const lngRad = (center.lng * Math.PI) / 180;

  const newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(angularDistance) + Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const newLngRad = lngRad + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
    Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(newLatRad)
  );

  return {
    lat: (newLatRad * 180) / Math.PI,
    lng: (newLngRad * 180) / Math.PI
  };
}

/**
 * The actual scoring rule, as plain JS — mirrors the $setIntersection + $add Mongo pipeline
 * exactly, so it's testable without a database. One participant's tags in participantTagSets
 * = solo recommendation scoring; multiple = joint/blind matching. This is deliberately the
 * kind of pure function that would have caught the preferences-schema bug found this session
 * (undefined tags in → always-0 scores out) without needing a live database at all.
 */
export function computeMatchScore(placeTags: string[], participantTagSets: string[][]): number {
  return participantTagSets.reduce((total, tags) => {
    const intersectionSize = placeTags.filter(t => tags.includes(t)).length;
    return total + intersectionSize;
  }, 0);
}

/**
 * Fisher-Yates shuffle, non-mutating — applied to an already-scored-and-limited recommendation
 * list (see POST /api/recommendations and POST /api/events/:id/recommendations) so repeated
 * slots/days on the same trip don't all surface the identical top-scored place first every
 * time. Deliberately applied AFTER scoring/limiting to the best candidates, so this only varies
 * order *among already-good matches* — it never surfaces a genuinely worse place over a better
 * one that fell outside that top-N pool.
 */
export function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
