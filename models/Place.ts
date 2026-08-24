import mongoose, { Schema, Document } from 'mongoose';

export interface IPlace extends Document {
  name: string;
  city: string;
  category: 'Restaurant' | 'Activity' | 'Event';
  genre: string;
  // Flattened tag set (genre + category-derived) used for $setIntersection-based joint
  // preference matching — see POST /api/events/:id/recommendations in server.ts.
  tags: string[];
  rating: number;
  description: string;
  estimatedDuration: number;
  distanceKm: number;
  // 'curated' = added by hand through the admin site, vetted, permanent — never touched by
  // the auto-population step. 'google' = fetched live from Google Places API (New) at
  // population time (see lib/google-places-client.ts, lib/places-population.ts) — real venue
  // data, but safe to refresh/replace on a future re-fetch, unlike curated. 'generated' =
  // synthetic fallback content, used when there's no curated coverage AND either no
  // GOOGLE_PLACES_API_KEY is configured or the Google fetch didn't return enough to fill a
  // city; safe to regenerate at any time.
  source: 'curated' | 'generated' | 'google';
  // Real coordinates, used by buildGeoNearStage (lib/place-matching.ts) as the first stage of
  // both recommendation aggregations once a trip has a real anchor point (Trip.baseLocations).
  // Populated by: lib/google-places-client.ts (source: 'google', straight from the API
  // response), scripts/backfill-curated-place-coords.ts (source: 'curated', one-time Nominatim
  // geocode), and lib/places-population.ts (source: 'generated', jittered around the request's
  // anchor point since there's no real venue to geocode).
  location?: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  // Google's own resource id (`places/xxxx`), source: 'google' only. Lets the live per-request
  // nearby search (server.ts's recommendation endpoints, via lib/google-places-client.ts's
  // searchNearbyPlaces) upsert instead of insert — re-querying the same hotel/anchor on a later
  // request refreshes this document (rating, tags) rather than creating a duplicate Place every
  // time, since that search deliberately re-hits Google on every request rather than relying on
  // ensurePlacesForCity's one-time-per-city population.
  googlePlaceId?: string;
}

const PlaceSchema = new Schema<IPlace>({
  name: { type: String, required: true },
  city: { type: String, required: true },
  category: { type: String, enum: ['Restaurant', 'Activity', 'Event'], required: true },
  genre: { type: String, required: true },
  tags: [{ type: String }],
  rating: { type: Number, required: true },
  description: { type: String, required: true },
  estimatedDuration: { type: Number, required: true },
  distanceKm: { type: Number, required: true },
  source: { type: String, enum: ['curated', 'generated', 'google'], required: true, default: 'generated' },
  // `default: undefined` on the array is deliberate and load-bearing: Mongoose otherwise
  // defaults any array-typed path to `[]`, which materializes `location: { coordinates: [] }`
  // on every document regardless of whether it was ever set — invalid GeoJSON (a Point needs
  // exactly 2 coordinates) that breaks 2dsphere index creation outright. This is what actually
  // keeps `location` truly absent until a real point is assigned.
  location: {
    type: { type: String, enum: ['Point'] },
    coordinates: { type: [Number], default: undefined }
  },
  // `default: undefined` (not required) so curated/generated docs simply never have this path
  // at all — a sparse unique index only enforces uniqueness across documents where the field
  // actually exists, which is exactly what's needed here.
  googlePlaceId: { type: String, default: undefined }
});

// Supports the city + time-of-day-category filter the joint-recommendation endpoint runs
// before scoring by tags.
PlaceSchema.index({ city: 1, category: 1 });
// Required for $geoNear (buildGeoNearStage, lib/place-matching.ts) — a 2dsphere index is a
// hard prerequisite for any geospatial query against this field, not just a perf nicety.
PlaceSchema.index({ location: '2dsphere' });
// Sparse + unique: makes the live nearby-search upsert (server.ts's recommendation endpoints)
// idempotent per Google place, without constraining curated/generated docs that never set this
// field at all (a plain unique index would reject every second document with no googlePlaceId,
// since Mongo treats "field absent" as equal to itself for uniqueness purposes — sparse exempts
// absent-field documents from the constraint entirely).
PlaceSchema.index({ googlePlaceId: 1 }, { unique: true, sparse: true });

export default mongoose.models.Place || mongoose.model<IPlace>('Place', PlaceSchema);
