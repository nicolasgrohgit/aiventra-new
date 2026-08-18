import mongoose, { Schema, Document } from 'mongoose';

export interface IContact extends Document {
  owner_user_id: mongoose.Types.ObjectId;
  contact_user_id?: mongoose.Types.ObjectId;
  name: string;
  // Captured at invite time so a pending (not-yet-linked) contact can be shown and later
  // reconciled — matching this email to a real signup and backfilling contact_user_id is
  // a deliberately separate, not-yet-built pass; this field just makes that possible later.
  email?: string;
  circle_tags: string[];
}

const ContactSchema = new Schema<IContact>({
  owner_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  contact_user_id: { type: Schema.Types.ObjectId, ref: 'User' }, // Populated if the contact also uses Odys.ai
  name: { type: String, required: true },
  email: { type: String },
  circle_tags: [{ type: String }] // e.g. "Family and Friends", "Work"
}, { timestamps: true });

export default mongoose.models.Contact || mongoose.model<IContact>('Contact', ContactSchema);
