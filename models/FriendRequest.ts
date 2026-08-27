import mongoose, { Schema, Document } from 'mongoose';

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined';

export interface IFriendRequest extends Document {
  from_user_id: mongoose.Types.ObjectId;
  to_user_id: mongoose.Types.ObjectId;
  // The circle the SENDER wants to file the recipient under once accepted. The recipient
  // picks their own (possibly different) circle_tag independently at respond-time — see
  // PUT /api/friend-requests/:id/respond in server.ts — that's the whole point: each side
  // of a friendship can categorize the other differently.
  circle_tag: string;
  status: FriendRequestStatus;
}

const FriendRequestSchema = new Schema<IFriendRequest>({
  from_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  to_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  circle_tag: { type: String, required: true },
  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' }
}, { timestamps: true });

// "requests I need to respond to" and "requests I've sent" (the latter to avoid duplicate
// sends / let the UI show a "waiting" state) are the two access patterns this collection
// serves — same reasoning as the participants/trip_id indexes on models/Event.ts.
FriendRequestSchema.index({ to_user_id: 1, status: 1 });
FriendRequestSchema.index({ from_user_id: 1, status: 1 });

export default mongoose.models.FriendRequest || mongoose.model<IFriendRequest>('FriendRequest', FriendRequestSchema);
