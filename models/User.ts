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
  // Expo push token for this user's current device, registered client-side via
  // lib/push-token.ts (expo-notifications) and stored through the dedicated
  // POST /api/users/me/push-token endpoint below — deliberately not folded into the general
  // PUT /api/users/:id update path. Formally declared for the same "direct property access"
  // reason as homebaseSharedCircles above (server.ts reads user.expoPushToken directly when
  // sending a push, see POST /api/friend-requests and POST /api/trips/:tripId/events).
  // Single device only for now (last-registered token wins) — multi-device fanout is a
  // follow-up, not needed for this build.
  expoPushToken?: string;
  // This user's random 256-bit AES data key, wrapped (encrypted) under the server's master
  // key (see lib/field-encryption.ts / ENCRYPTION_MASTER_KEY) and stored as opaque ciphertext
  // — never the raw key. Generated lazily on first write of an encrypted field (an Event this
  // user created — see getOrCreateUserDataKey in server.ts), not at account creation, so
  // existing users are unaffected until they actually create/edit an event. Absent entirely
  // for a user who has never triggered that path, or for every user if ENCRYPTION_MASTER_KEY
  // isn't configured at all.
  encryptedDataKey?: string;
  // Server-observed "last time this user's app opened trip auto-discovery counted as caught
  // up" timestamp — see docs/auto-trip-discovery-plan.md Part B. Written only by
  // POST /api/users/me/app-access (never by the generic PUT /api/users/:id — deliberately
  // NOT in USER_UPDATABLE_FIELDS below, since this is a fact the server observes, not a
  // client-editable preference), and read client-side to gate the ~weekly proactive
  // calendar-scan trigger. A real Mongo field rather than an AsyncStorage flag specifically so
  // it survives a reinstall/new device and can double as a later engagement/retention signal
  // (not built here — see the changelog entry for this feature).
  lastAppAccess?: Date;
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
  expoPushToken: { type: String },
  encryptedDataKey: { type: String },
  lastAppAccess: { type: Date }
}, { timestamps: true, strict: false }); // strict: false only needed now for top-level ad hoc fields (firstName, homebase, etc.) — preferences.* is fully declared above

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
