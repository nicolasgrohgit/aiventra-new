/**
 * One-time backfill: encrypts Event.title / .location / .place_name for every existing
 * plaintext Event document, using the same per-user envelope encryption the live routes now
 * write with going forward (see lib/field-encryption.ts, lib/user-data-key.ts,
 * docs/data-encryption-plan.md). Idempotent — any field already in the versioned ciphertext
 * format (isEncryptedValue) is left untouched, so running this twice (or after the live
 * routes have already re-saved some events) is safe.
 *
 * Requires ENCRYPTION_MASTER_KEY to be set (see .env.example) — without it, every write
 * below would no-op back to plaintext, silently undoing nothing but doing nothing useful
 * either, so this refuses to run at all rather than produce a false "done" report.
 *
 * Conservative on failure: any single event that can't be safely migrated (its `created_by`
 * user no longer resolves, or an encrypt call throws) is skipped and reported, never
 * force-written or allowed to abort the rest of the batch — see docs/data-encryption-plan.md's
 * own note that migration behavior for records that can't be safely re-encrypted "depends on
 * which fields are chosen," not fully specified there, so the conservative default here is
 * "leave it as plaintext, log it clearly" rather than guessing at data loss.
 *
 * Run manually — this does NOT run automatically on server boot or on any request path:
 *   npx tsx scripts/migrate-encrypt-events.ts
 *   npx tsx scripts/migrate-encrypt-events.ts --dry-run   (report only, no writes)
 */
import dotenv from 'dotenv';
import connectToDatabase from '../lib/mongodb';
import Event from '../models/Event';
import { isEncryptionConfigured, isEncryptedValue, encryptWithKey } from '../lib/field-encryption';
import { getOrCreateUserDataKey } from '../lib/user-data-key';

dotenv.config({ quiet: true });

const FIELDS = ['title', 'location', 'place_name'] as const;

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!isEncryptionConfigured()) {
    console.error('ENCRYPTION_MASTER_KEY is not set (or invalid) — refusing to run. See .env.example.');
    process.exit(1);
  }

  await connectToDatabase();

  const events = await Event.find({});
  console.log(`Found ${events.length} event(s) total.`);

  const dataKeyCache = new Map<string, Buffer | null>();
  let migrated = 0;
  let alreadyDone = 0;
  let skippedNoop = 0; // event had no plaintext in any of the three fields to begin with
  let failed = 0;

  for (const event of events) {
    const creatorId = event.created_by?.toString();
    if (!creatorId) {
      console.warn(`Skipping event ${event._id}: no created_by, can't resolve an owner key.`);
      failed++;
      continue;
    }

    const fieldsNeedingEncryption = FIELDS.filter((f) => {
      const value = (event as any)[f];
      return typeof value === 'string' && value.length > 0 && !isEncryptedValue(value);
    });
    const fieldsAlreadyEncrypted = FIELDS.filter((f) => isEncryptedValue((event as any)[f]));

    if (fieldsNeedingEncryption.length === 0) {
      if (fieldsAlreadyEncrypted.length > 0) alreadyDone++;
      else skippedNoop++; // every present field was empty/absent — nothing to encrypt either way
      continue;
    }

    try {
      if (!dataKeyCache.has(creatorId)) {
        dataKeyCache.set(creatorId, await getOrCreateUserDataKey(creatorId));
      }
      const dataKey = dataKeyCache.get(creatorId) ?? null;
      if (!dataKey) {
        // Shouldn't happen given the isEncryptionConfigured() guard above plus a resolvable
        // creator, but fail safe rather than writing anything if it somehow does.
        console.warn(`Skipping event ${event._id}: could not resolve a data key for user ${creatorId}.`);
        failed++;
        continue;
      }

      const update: Record<string, string> = {};
      for (const field of fieldsNeedingEncryption) {
        update[field] = encryptWithKey((event as any)[field], dataKey);
      }

      console.log(`${dryRun ? '[dry-run] would migrate' : 'Migrating'} event ${event._id} (fields: ${fieldsNeedingEncryption.join(', ')})`);
      if (!dryRun) {
        await Event.updateOne({ _id: event._id }, { $set: update });
      }
      migrated++;
    } catch (err) {
      console.error(`Failed to migrate event ${event._id}:`, err);
      failed++;
    }
  }

  console.log('\n--- Migration summary ---');
  console.log(`Migrated:              ${migrated}${dryRun ? ' (dry run — no writes made)' : ''}`);
  console.log(`Already encrypted:     ${alreadyDone}`);
  console.log(`No plaintext to touch: ${skippedNoop}`);
  console.log(`Failed / skipped:      ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Migration script crashed:', err);
  process.exit(1);
});
