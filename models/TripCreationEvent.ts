import mongoose, { Schema, Document } from 'mongoose';

// Append-only log of "a trip was created" events, one row per POST /api/trips call, inserted
// alongside the Trip itself and never modified or deleted afterward — see
// docs/monetization-strategy.md's "Finalized decisions" section. This exists specifically
// because the free-tier monthly cap (lib/trip-quota.ts) must NOT be freed up by deleting a
// trip: counting live Trip documents by createdAt would undercount once a trip is deleted
// (DELETE /api/trips/:id doesn't touch this collection at all), so the cap counts rows here
// instead, which are decoupled from the Trip's own lifecycle.
export interface ITripCreationEvent extends Document {
  user_id: mongoose.Types.ObjectId;
  createdAt: Date;
}

const TripCreationEventSchema = new Schema<ITripCreationEvent>({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
}, {
  // No updatedAt needed — rows are never modified after insert.
  timestamps: { createdAt: true, updatedAt: false }
});

// Queried by { user_id, createdAt: { $gte, $lt } } together (current-calendar-month count) —
// a compound index is what makes that a covered/indexed lookup instead of a per-user scan.
TripCreationEventSchema.index({ user_id: 1, createdAt: 1 });

export default mongoose.models.TripCreationEvent
  || mongoose.model<ITripCreationEvent>('TripCreationEvent', TripCreationEventSchema);
