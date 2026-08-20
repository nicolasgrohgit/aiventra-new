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
  // AI Schedule Proposals slots the user has explicitly hidden as not applicable (e.g. a
  // calendar-derived midday gap while genuinely still at work). Keyed by
  // `${proposal.startTime.toISOString()}-${proposal.type}` — see POST/DELETE
  // /api/trips/:tripId/dismissed-slots in server.ts. Purely a display filter; manually adding
  // something to a dismissed window via Propose/Refine is unaffected.
  dismissedSlots: string[];
  // Real anchor point(s) for "near me" distance filtering (see lib/place-matching.ts's
  // buildGeoNearStage) — an array from day one even though today's UI only ever produces one
  // entry, since this app is 1 trip = 1 city today but may become 1 trip = N cities later; an
  // array needs no migration when that day comes, a scalar field would. 'city' is the free
  // centroid fallback (from the destination autocomplete's own geocoding, previously
  // discarded); 'hotel' is the higher-precision geocoded accommodation point when the user
  // provides one. Query-side: pick the entry whose date range contains the slot being queried,
  // preferring 'hotel' over 'city' for that range.
  baseLocations: {
    label: string;
    lat: number;
    lng: number;
    source: 'hotel' | 'city';
    startDate: Date;
    endDate: Date;
  }[];
}

const TripSchema = new Schema<ITrip>({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  destination: { type: String, required: true },
  start_date: { type: Date, required: true },
  end_date: { type: Date, required: true },
  timezone: { type: String },
  sharedWithCircles: { type: [String], default: [] },
  dismissedSlots: { type: [String], default: [] },
  baseLocations: {
    type: [{
      label: { type: String, required: true },
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      source: { type: String, enum: ['hotel', 'city'], required: true },
      startDate: { type: Date, required: true },
      endDate: { type: Date, required: true }
    }],
    default: []
  }
  // Events (created or imported) live in their own collection, queried by trip_id — see
  // models/Event.ts. They used to be embedded here, but an embedded array can't be queried
  // from the invited participant's side ("events I'm invited to") without scanning every
  // other user's trips.
}, { timestamps: true });

export default mongoose.models.Trip || mongoose.model<ITrip>('Trip', TripSchema);
