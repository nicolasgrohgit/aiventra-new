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
  // Reserved for a future geo/radius bolt-on (a $geoNear stage ahead of the tag-scoring
  // stages in the same aggregation) — deliberately not indexed or queried yet.
  location?: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
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
  location: {
    type: { type: String, enum: ['Point'] },
    coordinates: { type: [Number] }
  }
});

// Supports the city + time-of-day-category filter the joint-recommendation endpoint runs
// before scoring by tags. Not indexing `location` yet — no geo queries run against it today.
PlaceSchema.index({ city: 1, category: 1 });

export default mongoose.models.Place || mongoose.model<IPlace>('Place', PlaceSchema);
