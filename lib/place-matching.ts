import { DateTime } from 'luxon';

// Server-side only (uses Mongo aggregation shapes) but kept pure/DB-free so it's directly
// unit-testable — see lib/place-matching.test.ts. Shared by both the solo recommendation
// endpoint (POST /api/recommendations) and the blind joint-matching endpoint
// (POST /api/events/:id/recommendations) in server.ts, so "one place, one meaning" holds
// for how a place gets scored/filtered regardless of which endpoint is asking.

export function isMealWindow(startTime: Date, timezone: string): boolean {
  const start = DateTime.fromJSDate(startTime).setZone(timezone);
  const timeAsDecimal = start.hour + start.minute / 60;
  const isLunch = timeAsDecimal >= 11.5 && timeAsDecimal <= 13.5;
  const isDinner = timeAsDecimal >= 18.5 && timeAsDecimal <= 21.0;
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

export function buildCityDurationMatchStage(
  city: string,
  durationMinutes: number,
  mealWindow: boolean,
  maxDistanceKm: number = DEFAULT_MAX_DISTANCE_KM
): any {
  // Substring, not exact-anchored: city strings aren't consistent across the app — a trip
  // destination is typically "Amsterdam, Netherlands" (picked from geocoding autocomplete),
  // while the Home tab's reverse-geocoded current location is a bare "Amsterdam". An anchored
  // ^...$ match would treat those as different cities and silently return nothing.
  return {
    city: { $regex: escapeRegExp(cityNeedle(city)), $options: 'i' },
    estimatedDuration: { $lte: durationMinutes },
    distanceKm: { $lte: maxDistanceKm },
    ...buildCategoryFilter(mealWindow, durationMinutes)
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
