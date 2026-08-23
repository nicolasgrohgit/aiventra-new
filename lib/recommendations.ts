// Recommendation scoring now happens server-side against the real Place Mongo collection
// (see POST /api/recommendations and POST /api/events/:id/recommendations in server.ts,
// via lib/place-matching.ts) — this file used to hold a static MOCK_PLACES_DATABASE array
// and Math.random()-based scoring queried directly from the client, which meant solo and
// joint recommendations were silently drawing from two different, disagreeing data sources.
// Only the shared response shape lives here now.

export interface PlaceRecommendation {
  id: string;
  name: string;
  city: string;
  category: 'Restaurant' | 'Activity' | 'Event';
  genre: string;
  rating: number;
  matchScore: number;
  description: string;
  estimatedDuration: number;
  distanceKm: number;
  source?: 'curated' | 'generated' | 'google';
  location?: { type: 'Point'; coordinates: [number, number] }; // [lng, lat]
}

// A `Restaurant`/`Cafes` place is deliberately included in non-meal-window recommendation
// queries (see buildCategoryFilter, lib/place-matching.ts) — a coffee stop is a reasonable
// thing to surface during open "Free Time", not a meal. Showing its raw `category` badge as
// "Restaurant" there reads as a mismatch (why is a restaurant showing up during free time?)
// even though it's working as intended — this makes that intent visible instead.
export function displayCategory(place: { category: string; genre?: string }): string {
  if (place.category === 'Restaurant' && place.genre === 'Cafes') return 'Cafe';
  return place.category;
}
