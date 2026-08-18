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
}
