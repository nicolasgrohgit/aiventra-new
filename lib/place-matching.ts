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

export function buildCityDurationMatchStage(city: string, durationMinutes: number, mealWindow: boolean): any {
  return {
    city: { $regex: `^${escapeRegExp(city.trim())}$`, $options: 'i' },
    estimatedDuration: { $lte: durationMinutes },
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
