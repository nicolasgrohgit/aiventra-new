import mongoose, { Schema, Document } from 'mongoose';

// A deletion request made from public/delete-account.html — the web path Google Play
// requires for people who no longer have the app (in-app deletion is DELETE /api/users/me).
// It only records the request: there is no working mail relay yet (lib/mailer.ts is inert)
// and login is email-only, so an unauthenticated form must not delete anything by itself. An
// admin confirms with the address's owner and then deletes the account from the admin page.
//
// Holds an email address and nothing else, one row per address; the row is removed when the
// account is deleted (lib/account-deletion.ts) or the request is dismissed.
export interface IAccountDeletionRequest extends Document {
  email: string;
  createdAt: Date;
}

const AccountDeletionRequestSchema = new Schema<IAccountDeletionRequest>({
  email: { type: String, required: true, unique: true, maxlength: 254 },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.models.AccountDeletionRequest
  || mongoose.model<IAccountDeletionRequest>('AccountDeletionRequest', AccountDeletionRequestSchema);
