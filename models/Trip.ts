import mongoose, { Schema, Document } from 'mongoose';

export interface ITrip extends Document {
  user_id: mongoose.Types.ObjectId;
  destination: string;
  start_date: Date;
  end_date: Date;
  timezone?: string; // IANA zone (e.g. "Europe/Paris") the destination's day/free-time math is computed in
  // Circles that can see this specific trip's destination/dates as a "traveling there"
  // presence signal. Empty by default (private); opt-in only, editable anytime (not just at
  // creation). See models/User.ts's homebaseSharedCircles for the parallel "lives there"
  // signal — these are deliberately separate, since one is date-bound and one isn't.
  sharedWithCircles: string[];
}

const TripSchema = new Schema<ITrip>({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  destination: { type: String, required: true },
  start_date: { type: Date, required: true },
  end_date: { type: Date, required: true },
  timezone: { type: String },
  sharedWithCircles: { type: [String], default: [] }
  // Events (created or imported) live in their own collection, queried by trip_id — see
  // models/Event.ts. They used to be embedded here, but an embedded array can't be queried
  // from the invited participant's side ("events I'm invited to") without scanning every
  // other user's trips.
}, { timestamps: true });

export default mongoose.models.Trip || mongoose.model<ITrip>('Trip', TripSchema);
