import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  google_id?: string;
  full_name?: string;
  avatar_url?: string;
  // firstName/lastName/dob/homebase are also real, actively-used fields (see profile.tsx),
  // just not declared here — left to the top-level strict:false below, same as before.
  preferences: {
    dietary?: string[];
    budget?: string;
    currency?: string;
    dateFormat?: string;
    activityLevel?: string;
    foodGenres?: string[];
    activityGenres?: string[];
    eventGenres?: string[];
  };
  // Circles that can see this user's homebase as a standing "lives here" presence signal —
  // separate from any specific trip. Empty by default (private); opt-in only, editable
  // anytime from Profile. Formally declared (not left to strict:false) because it's read via
  // direct property access in GET /api/friends-nearby — this project was already burned once
  // by an undeclared field that stored fine but returned undefined on direct access.
  homebaseSharedCircles: string[];
}

const UserSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true },
  google_id: { type: String, unique: true, sparse: true },
  full_name: { type: String },
  avatar_url: { type: String },
  preferences: {
    dietary: [{ type: String }],
    budget: { type: String },
    currency: { type: String },
    dateFormat: { type: String },
    activityLevel: { type: String },
    foodGenres: [{ type: String }],
    activityGenres: [{ type: String }],
    eventGenres: [{ type: String }],
  },
  homebaseSharedCircles: { type: [String], default: [] }
}, { timestamps: true, strict: false }); // strict: false only needed now for top-level ad hoc fields (firstName, homebase, etc.) — preferences.* is fully declared above

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
