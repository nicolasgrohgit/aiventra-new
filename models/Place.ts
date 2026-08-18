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
  // the auto-population step. 'generated' = synthetic fallback content auto-created at trip
  // creation time (see lib/places-population.ts) to top up thin/uncovered cities; safe to
  // regenerate or eventually replace with real API results without losing curated data.
  source: 'curated' | 'generated';
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
  source: { type: String, enum: ['curated', 'generated'], required: true, default: 'generated' },
  location: {
    type: { type: String, enum: ['Point'] },
    coordinates: { type: [Number] }
  }
});

// Supports the city + time-of-day-category filter the joint-recommendation endpoint runs
// before scoring by tags. Not indexing `location` yet — no geo queries run against it today.
PlaceSchema.index({ city: 1, category: 1 });

export default mongoose.models.Place || mongoose.model<IPlace>('Place', PlaceSchema);
