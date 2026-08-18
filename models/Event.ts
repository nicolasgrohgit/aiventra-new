import mongoose, { Schema, Document } from 'mongoose';

export type EventSource = 'created' | 'imported';
export type ParticipantStatus = 'pending' | 'accepted' | 'declined';

export interface IEventParticipant {
  user_id: mongoose.Types.ObjectId;
  invited_by: mongoose.Types.ObjectId;
  status: ParticipantStatus;
}

const ParticipantSchema = new Schema<IEventParticipant>({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  invited_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' }
}, { _id: false });

export interface IEvent extends Document {
  trip_id: mongoose.Types.ObjectId;
  created_by: mongoose.Types.ObjectId;
  source: EventSource;
  title: string;
  start_time: Date;
  end_time: Date;
  place_id?: string;
  place_name?: string;
  location?: string;
  // Only meaningful for source: 'created' — imported (calendar-synced) events are never shareable.
  participants: IEventParticipant[];
  // Reserved for a future calendar-import sync pipeline (source: 'imported'); unused/unset today.
  google_event_id?: string;
}

const EventSchema = new Schema<IEvent>({
  trip_id: { type: Schema.Types.ObjectId, ref: 'Trip', required: true },
  created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  source: { type: String, enum: ['created', 'imported'], default: 'created', required: true },
  title: { type: String, required: true },
  start_time: { type: Date, required: true },
  end_time: { type: Date, required: true },
  place_id: { type: String },
  place_name: { type: String },
  location: { type: String },
  participants: [ParticipantSchema],
  google_event_id: { type: String }
}, { timestamps: true });

// Two access patterns: "events on this trip" (organizer's own trip view) and "events I'm
// invited to across any trip" (the participant's side — there's no other cheap way to find
// these once events aren't embedded in the organizer's own Trip document anymore).
EventSchema.index({ trip_id: 1 });
EventSchema.index({ 'participants.user_id': 1 });

export default mongoose.models.Event || mongoose.model<IEvent>('Event', EventSchema);
