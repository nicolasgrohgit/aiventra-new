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
  // End boundary deliberately exclusive (< not <=) — half-open [start, end), matching the
  // overlap-based window math in lib/free-time.ts's labelFreeSlot/expandSlotForProposals. An
  // inclusive end let a slot starting exactly when a meal window ends (e.g. a 14:00-16:45 free
  // slot with lunchEnd=14:00) get classified as a meal-window query here while free-time.ts's
  // overlap check (correctly) saw zero overlap and left it labeled/split as plain activity time
  // — live-verified as a real bug: buildCategoryFilter's mealWindow-but-duration>120 branch
  // returns no category filter at all, so a genuine restaurant leaked into what displayed as a
  // "Free Time" activity slot.
  const isLunch = timeAsDecimal >= lunchStart && timeAsDecimal < lunchEnd;
  const isDinner = timeAsDecimal >= dinnerStart && timeAsDecimal < dinnerEnd;
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
  // mealWindow but longer than a normal meal (>120min, e.g. a long dinner event queried
  // directly by duration rather than via expandSlotForProposals' 120-cap) — still restaurant
  // -only rather than no filter at all. An unfiltered fallback here previously meant any
  // category (including plain Activity places) could surface for a query the caller believes
  // is meal-scoped; still allows cafes here (unlike the <=120 branch) since there's no meal-
  // specific reason to exclude them once duration no longer implies a sit-down meal.
  return { category: 'Restaurant' };
}

// Fallback "near me" ceiling for when the destination's population can't be resolved (a
// geocoding miss/failure) — the same flat value every request used before resolveSearchRadiusKm
// existed. "Expand Search Radius" (recommendation.tsx) re-queries with this ceiling raised/
// removed regardless of which radius produced the original result.
export const DEFAULT_MAX_DISTANCE_KM = 5;

// "Near me" means something completely different in a 10M-person metro than a 8,000-person
// town — a flat radius either misses everything walkable in a dense city center (ten
// restaurants within 500m of a central Paris hotel) or returns nothing at all in a small town
// (nothing within even 5km). Tiers chosen directly against the case that surfaced this: a
// central Paris hotel (pop. ~2.1M) with genuine walking-distance restaurant coverage that a
// flat 5km radius was diluting with far-flung options carrying no real advantage over a
// 30m-away place.
//
// Restaurant and Activity get separate (wider, for Activity) tiers rather than sharing one:
// live-tested against the same Paris hotel, a 500m Activity search returned mostly spas and
// hotels — real points of interest (museums, viewpoints, landmarks) are structurally sparser
// than restaurants, so the radius that's exactly right for "walk to lunch" is too tight for
// "something worth doing nearby."
export function resolveSearchRadiusKm(population: number | null, category: 'Restaurant' | 'Activity'): number {
  if (population === null) return DEFAULT_MAX_DISTANCE_KM;
  const tiers = category === 'Restaurant'
    ? { dense: 0.5, mid: 2, sparse: 5 }
    : { dense: 2, mid: 5, sparse: 25 };
  if (population >= 100_000) return tiers.dense;
  if (population >= 10_000) return tiers.mid;
  return tiers.sparse;
}

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

// Mongo aggregation expression: a small (<1) tie-breaking bonus added to matchScore/jointScore
// before sorting, giving curated → google → generated-filler places a nudge without ever
// letting source override actual tag relevance (a curated place with a 0-tag match still can't
// outrank a google place with a 2-tag match — the max bonus gap is 0.9). See
// docs/ad-monetization.md's "Roadmap: rank curated places above Google-sourced ones".
export const SOURCE_RANK_BONUS = {
  $switch: {
    branches: [
      { case: { $eq: ['$source', 'curated'] }, then: 0.9 },
      { case: { $eq: ['$source', 'google'] }, then: 0.4 }
    ],
    default: 0
  }
};

const SOURCE_TIER_ORDER = ['curated', 'google', 'generated'];

/**
 * Like shuffled(), but shuffles within each Place.source tier (curated, then google, then
 * generated) rather than across the whole list — otherwise a plain shuffle of the top-10 pool
 * would completely erase the source-priority ordering SOURCE_RANK_BONUS establishes the moment
 * a lower-tier place lands in the same pool. Sources outside the known tiers fall into the
 * lowest ('generated') bucket rather than jumping ahead of google/curated.
 */
export function tieredShuffle<T extends { source?: string }>(items: T[]): T[] {
  const tiers = new Map<string, T[]>(SOURCE_TIER_ORDER.map(tier => [tier, []]));
  for (const item of items) {
    const tier = item.source && tiers.has(item.source) ? item.source : 'generated';
    tiers.get(tier)!.push(item);
  }
  return SOURCE_TIER_ORDER.flatMap(tier => shuffled(tiers.get(tier)!));
}
