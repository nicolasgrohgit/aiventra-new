// Per-user AES-256-GCM field encryption — the "local-only stopgap" explicitly allowed by
// docs/data-encryption-plan.md: a master key from an env var to unblock building the
// encrypt/decrypt plumbing now, with the real GCP KMS swap-in deferred to match the GCP
// migration (docs/gcp-migration.md). Scope for this pass, per the plan's own recommendation:
// Event.title / Event.location / Event.place_name (see server.ts) — free-text fields never
// filtered/sorted/indexed on server-side, so they can be transparently encrypted without
// losing any query capability, unlike email/trip_id/user_id/dates.
//
// Envelope design (matches the plan doc): each User gets a random 256-bit "data key",
// generated lazily on first use, encrypted ("wrapped") with a single master key and stored on
// the User document as `encryptedDataKey`. Event fields are encrypted with the *creator's*
// data key, not the master key directly — losing the master key doesn't mean one leaked user
// record compromises every other user's key material, and discarding a user's wrapped key
// later (not built here) would make their ciphertext permanently unreadable for free
// ("crypto-shredding"). The server always holds the master key, so it can always unwrap any
// user's data key to decrypt an event for an invited participant reading the organizer's
// event — this is encryption at rest against raw DB access, not a per-viewer access-control
// mechanism (that's handled separately, by the existing ownership/participant checks in each
// route).
//
// Deliberately NOT attempted here: key rotation (nothing in docs/data-encryption-plan.md
// specifies a policy) and the real KMS swap-in (explicitly out of scope this sprint, see
// docs/gcp-migration.md). Both are safe to defer — this plumbing works correctly without them,
// it just doesn't yet support rotating a compromised key.
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV is the recommended/standard size for GCM.
const KEY_LENGTH = 32; // 256 bits.

// Versioned so a future format change (e.g. a v2 with a different algorithm/KMS-wrapped key)
// can coexist with old ciphertext during a migration, and so callers can cheaply tell
// "already encrypted" apart from legacy/never-encrypted plaintext (see isEncryptedValue).
const FORMAT_PREFIX = 'v1:';
// Ciphertext segment allows zero-length (`*` not `+`) — encrypting an empty-string field
// (an Event with no `location`, say) produces a 0-byte ciphertext, which is still valid,
// still-must-decrypt-back-to-'' output, not "not encrypted."
const ENCRYPTED_PATTERN = /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*$/;

let cachedMasterKey: Buffer | null | undefined; // undefined = not yet resolved, null = resolved absent/invalid.
let warnedMissingKey = false;

// Reads ENCRYPTION_MASTER_KEY (64 hex chars = 32 bytes) once and caches it. Absent/invalid is
// not an error — mirrors this project's existing pattern for optional, env-gated features
// (SENTRY_DSN, GOOGLE_PLACES_API_KEY): field encryption is a complete no-op (fields read/write
// as plain strings, current behavior preserved) until this is explicitly configured, rather
// than the whole server refusing to start like it does for the required JWT_SECRET.
export function getMasterKey(): Buffer | null {
  if (cachedMasterKey !== undefined) return cachedMasterKey;
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw) {
    cachedMasterKey = null;
    return null;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    if (!warnedMissingKey) {
      // eslint-disable-next-line no-console
      console.warn('ENCRYPTION_MASTER_KEY is set but is not 64 hex characters (32 bytes) — field encryption is disabled.');
      warnedMissingKey = true;
    }
    cachedMasterKey = null;
    return null;
  }
  cachedMasterKey = Buffer.from(raw, 'hex');
  return cachedMasterKey;
}

// Test-only: clears the cached key so tests can exercise both "configured" and "not
// configured" behavior in the same process despite the module-level cache above.
export function _resetMasterKeyCacheForTests(): void {
  cachedMasterKey = undefined;
  warnedMissingKey = false;
}

export function isEncryptionConfigured(): boolean {
  return getMasterKey() !== null;
}

export function isEncryptedValue(value: unknown): value is string {
  return typeof value === 'string' && ENCRYPTED_PATTERN.test(value);
}

// Generic AES-256-GCM encrypt of a UTF-8 string under an arbitrary 32-byte key — used both to
// encrypt an Event field under a user's data key, and to "wrap" a user's data key under the
// master key. A fresh random IV per call (standard/required practice for GCM; the key is
// reused across many calls, so a fixed or counter IV would risk nonce reuse).
export function encryptWithKey(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`encryptWithKey: key must be ${KEY_LENGTH} bytes, got ${key.length}`);
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${FORMAT_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

// Inverse of encryptWithKey. Deliberately permissive on non-ciphertext input — passes any
// value that isn't in the versioned format straight through unchanged — so a partially
// migrated Event collection (see scripts/migrate-encrypt-events.ts) never throws or corrupts
// data on read; a plaintext value simply displays as itself until it's migrated or re-saved.
export function decryptWithKey(value: string, key: Buffer): string {
  if (!isEncryptedValue(value)) return value;
  if (key.length !== KEY_LENGTH) {
    throw new Error(`decryptWithKey: key must be ${KEY_LENGTH} bytes, got ${key.length}`);
  }
  const [, ivB64, tagB64, ciphertextB64] = value.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

export function generateDataKey(): Buffer {
  return crypto.randomBytes(KEY_LENGTH);
}

// Wraps a per-user data key under the master key for storage on User.encryptedDataKey. Returns
// null (rather than throwing) when no master key is configured, so callers can no-op cleanly —
// the same "not configured" pattern as the rest of this module.
export function wrapDataKey(dataKey: Buffer): string | null {
  const masterKey = getMasterKey();
  if (!masterKey) return null;
  return encryptWithKey(dataKey.toString('base64'), masterKey);
}

export function unwrapDataKey(wrapped: string): Buffer | null {
  const masterKey = getMasterKey();
  if (!masterKey) return null;
  return Buffer.from(decryptWithKey(wrapped, masterKey), 'base64');
}
