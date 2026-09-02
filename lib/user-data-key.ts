// Per-user data-key lookup/creation for field encryption (see lib/field-encryption.ts and
// docs/data-encryption-plan.md). Split out from server.ts so both the live routes and
// scripts/migrate-encrypt-events.ts share exactly one implementation — a migration script
// re-deriving its own "how do I get this user's key" logic independently of the routes it's
// migrating data for is exactly how the two quietly drift apart.
import User from '../models/User';
import { isEncryptionConfigured, generateDataKey, wrapDataKey, unwrapDataKey } from './field-encryption';

// This user's per-user data key, unwrapped to raw bytes — generating and persisting
// (wrapped, never raw) one lazily on first use if none exists yet. Call on every WRITE that
// touches an encrypted field.
export async function getOrCreateUserDataKey(userId: string): Promise<Buffer | null> {
  if (!isEncryptionConfigured()) return null;
  const user = await User.findById(userId);
  if (!user) return null;
  if (user.encryptedDataKey) {
    const key = unwrapDataKey(user.encryptedDataKey);
    if (key) return key;
    // Falls through to generating a fresh key if the existing wrapped one fails to unwrap
    // (e.g. the master key was rotated out from under it — rotation itself isn't handled
    // here, see docs/data-encryption-plan.md) so the write still succeeds; any fields already
    // encrypted under the old key become undecryptable, a known limitation, not something
    // introduced silently.
  }
  const dataKey = generateDataKey();
  const wrapped = wrapDataKey(dataKey);
  if (wrapped) {
    user.encryptedDataKey = wrapped;
    await user.save();
  }
  return dataKey;
}

// Read-only counterpart for the decrypt path: fetches this user's unwrapped data key WITHOUT
// generating one. A user with no key has never had anything encrypted, so there's nothing to
// decrypt — and lazily creating one here would be a pointless side effect (a surprise write
// triggered by a GET request).
export async function getUserDataKeyIfExists(userId: string): Promise<Buffer | null> {
  if (!isEncryptionConfigured()) return null;
  const user = await User.findById(userId).select('encryptedDataKey');
  if (!user?.encryptedDataKey) return null;
  return unwrapDataKey(user.encryptedDataKey);
}
