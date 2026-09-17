import mongoose, { Schema, Document } from 'mongoose';

// Tiny generic key/value config store for things that must be changeable without a redeploy
// (a Cloud Run env var change needs a new revision — see docs/monetization-strategy.md's
// "Finalized decisions" section). First/only consumer today is the
// 'freeTierMonthlyTripCap' key (lib/trip-quota.ts), but this is deliberately generic rather
// than a single-purpose "TripCapConfig" model, since the same "small Mongo doc + short
// in-memory cache" shape will fit whatever config knob needs this treatment next.
export interface IAppConfig extends Document {
  key: string;
  value: any;
}

const AppConfigSchema = new Schema<IAppConfig>({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed, required: true }
}, { timestamps: true });

export default mongoose.models.AppConfig || mongoose.model<IAppConfig>('AppConfig', AppConfigSchema);
