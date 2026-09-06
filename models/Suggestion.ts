import mongoose, { Schema, Document } from 'mongoose';

// The "Have a suggestion for Odys.ai?" form on Profile (see
// components/profile/suggestion-form-modal.tsx, POST /api/suggestions in server.ts). This is
// the durable source of truth for a submitted suggestion — saved the moment Send succeeds,
// independent of whether the best-effort email (lib/mailer.ts) to admin@odys.ai ever actually
// goes out. See docs/rfe-suggestion-form-plan.md for the full design.
export interface ISuggestion extends Document {
  user: mongoose.Types.ObjectId;
  text: string;
  createdAt: Date;
  // Whether the admin-notification email (lib/mailer.ts) was actually sent for this
  // submission — false both when no mail relay is configured yet (today) and if a
  // configured relay's send call fails. Lets a later admin pass query/retry the ones that
  // never went out, rather than a suggestion being silently lost to an email-relay hiccup.
  emailed: boolean;
}

const SuggestionSchema = new Schema<ISuggestion>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 1500 },
  createdAt: { type: Date, default: Date.now },
  emailed: { type: Boolean, default: false }
});

export default mongoose.models.Suggestion || mongoose.model<ISuggestion>('Suggestion', SuggestionSchema);
