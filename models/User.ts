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
    // "HH:mm", 24h — earliest this user would eat that meal. Shifts the lunch/dinner windows
    // used both for recommendation category-filtering (isMealWindow) and trip free-slot
    // labeling/splitting (labelFreeSlot, expandSlotForProposals) — see lib/place-matching.ts's
    // getMealWindows, the single source of truth. Undefined = today's fixed defaults.
    earliestLunchTime?: string;
    earliestDinnerTime?: string;
  };
  // Circles that can see this user's homebase as a standing "lives here" presence signal —
  // separate from any specific trip. Empty by default (private); opt-in only, editable
  // anytime from Profile. Formally declared (not left to strict:false) because it's read via
  // direct property access in GET /api/friends-nearby — this project was already burned once
  // by an undeclared field that stored fine but returned undefined on direct access.
  homebaseSharedCircles: string[];
  // This user's random 256-bit AES data key, wrapped (encrypted) under the server's master
  // key (see lib/field-encryption.ts / ENCRYPTION_MASTER_KEY) and stored as opaque ciphertext
  // — never the raw key. Generated lazily on first write of an encrypted field (an Event this
  // user created — see getOrCreateUserDataKey in server.ts), not at account creation, so
  // existing users are unaffected until they actually create/edit an event. Absent entirely
  // for a user who has never triggered that path, or for every user if ENCRYPTION_MASTER_KEY
  // isn't configured at all.
  encryptedDataKey?: string;
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
    earliestLunchTime: { type: String },
    earliestDinnerTime: { type: String },
  },
  homebaseSharedCircles: { type: [String], default: [] },
  encryptedDataKey: { type: String }
}, { timestamps: true, strict: false }); // strict: false only needed now for top-level ad hoc fields (firstName, homebase, etc.) — preferences.* is fully declared above

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
