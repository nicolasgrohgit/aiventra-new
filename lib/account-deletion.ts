// What "delete my account" removes, as data — the ordered list of Mongo operations for one
// user, with no database access here so the coverage is unit-testable
// (lib/account-deletion.test.ts checks every models/*.ts that references a User has a step).
// Executed by deleteAccountData() in server.ts, shared by DELETE /api/users/me (in-app) and
// DELETE /admin/api/users/:id (requests that arrive through public/delete-account.html).
//
// Hard delete, no soft-delete window (docs/differentiation-plan.md, B1). Not covered here
// because it isn't in Mongo: the user's customer record at RevenueCat / their Google Play
// subscription, which Google keeps billing until the user cancels it in Play.

export type DeletionModel =
  | 'Event'
  | 'Trip'
  | 'Contact'
  | 'FriendRequest'
  | 'Suggestion'
  | 'TripCreationEvent'
  | 'AccountDeletionRequest'
  | 'User';

export interface DeletionStep {
  model: DeletionModel;
  op: 'deleteMany' | 'updateMany';
  filter: Record<string, unknown>;
  update?: Record<string, unknown>;
}

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function isObjectIdString(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID_RE.test(value);
}

// Ids are passed as strings and cast to ObjectId by Mongoose against each schema path. The
// shape check matters beyond tidiness: every filter below is built from userId, so anything
// other than a plain id (an operator object from unvalidated input, say) must never get here.
export function buildAccountDeletionPlan(userId: string, ownTripIds: string[], email?: string | null): DeletionStep[] {
  if (!isObjectIdString(userId)) {
    throw new Error('buildAccountDeletionPlan: user id must be a Mongo ObjectId string');
  }
  const tripIds = ownTripIds.filter(isObjectIdString);
  const steps: DeletionStep[] = [];

  if (tripIds.length > 0) {
    // Same cascade as DELETE /api/trips/:id: events hang off the trip by trip_id, and a
    // participant's shadow trip (Trip.linkedTripId) is nothing without the trip it mirrors.
    steps.push({ model: 'Event', op: 'deleteMany', filter: { trip_id: { $in: tripIds } } });
    steps.push({ model: 'Trip', op: 'deleteMany', filter: { linkedTripId: { $in: tripIds } } });
  }
  steps.push({ model: 'Event', op: 'deleteMany', filter: { created_by: userId } });
  // Events other people organized stay theirs — the user just stops being a participant.
  steps.push({
    model: 'Event',
    op: 'updateMany',
    filter: { 'participants.user_id': userId },
    update: { $pull: { participants: { user_id: userId } } },
  });
  steps.push({ model: 'Trip', op: 'deleteMany', filter: { user_id: userId } });
  // Both directions: the user's own address book, and their entry in other people's.
  steps.push({ model: 'Contact', op: 'deleteMany', filter: { $or: [{ owner_user_id: userId }, { contact_user_id: userId }] } });
  steps.push({ model: 'FriendRequest', op: 'deleteMany', filter: { $or: [{ from_user_id: userId }, { to_user_id: userId }] } });
  steps.push({ model: 'Suggestion', op: 'deleteMany', filter: { user: userId } });
  steps.push({ model: 'TripCreationEvent', op: 'deleteMany', filter: { user_id: userId } });

  const requestEmail = normalizeDeletionRequestEmail(email);
  if (requestEmail) {
    steps.push({ model: 'AccountDeletionRequest', op: 'deleteMany', filter: { email: requestEmail } });
  }

  // Last, so a run that fails partway leaves an account that can still sign in and retry.
  steps.push({ model: 'User', op: 'deleteMany', filter: { _id: userId } });
  return steps;
}

// For POST /api/account-deletion-requests (the form on public/delete-account.html).
export function normalizeDeletionRequestEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidDeletionRequestEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

export type AccountDeletionOutcome = { deleted: true } | { deleted: false; message: string };

// How the app reads the response to DELETE /api/users/me (hooks/useAuth.tsx's deleteAccount).
// Only a "deleted" outcome signs the user out and wipes local data — telling someone their
// account is gone while the server still holds it would be worse than an error message.
export function interpretAccountDeletionStatus(status: number): AccountDeletionOutcome {
  if (status >= 200 && status < 300) return { deleted: true };
  // Already deleted (from another device, or by an admin after a web request).
  if (status === 404) return { deleted: true };
  if (status === 401) {
    return { deleted: false, message: 'Your session has expired. Sign out, sign in again, then delete your account.' };
  }
  if (status === 429) {
    return { deleted: false, message: 'Too many attempts. Try again in 15 minutes.' };
  }
  return { deleted: false, message: 'We could not delete your account. Nothing was removed — please try again.' };
}
