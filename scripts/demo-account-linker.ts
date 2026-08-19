/**
 * Persistent beta-session process: every 5 minutes (configurable via DEMO_LINK_INTERVAL_MS,
 * mainly for testing this script itself), reciprocally links every real user to the three
 * demo accounts from scripts/seed-demo-accounts.ts, in "Family and Friends" on both sides.
 *
 * Why bidirectional: visibility in GET /api/friends-nearby is sharer-driven — Sarah's shared
 * Paris homebase is only visible to a tester if *Sarah* has a Contact pointing at that
 * tester, not the other way around. A new beta tester didn't exist when the demo accounts
 * were seeded, so nobody could have pre-created that link. This script is what backfills it
 * automatically instead of requiring a manual step per new tester. Linking both directions
 * also means the demo accounts show up normally in the tester's own Circles tab, not just in
 * the friends-nearby discovery layer.
 *
 * Idempotent — re-checks and only creates what's missing, safe to leave running indefinitely
 * or restart anytime.
 *
 * Run manually, left running alongside the server/tunnel during a beta session:
 *   npm run demo-linker
 */
import dotenv from 'dotenv';
import connectToDatabase from '../lib/mongodb';
import User from '../models/User';
import Contact from '../models/Contact';
import { DEMO_ACCOUNT_EMAILS } from './demo-accounts';

dotenv.config({ quiet: true });

const CIRCLE = 'Family and Friends';
const INTERVAL_MS = Number(process.env.DEMO_LINK_INTERVAL_MS) || 5 * 60 * 1000;

async function ensureReciprocalContact(ownerId: string, contactUserId: string, contactName: string) {
  const existing = await Contact.findOne({ owner_user_id: ownerId, contact_user_id: contactUserId });
  if (existing) {
    if (!existing.circle_tags.includes(CIRCLE)) {
      existing.circle_tags.push(CIRCLE);
      await existing.save();
      return 'updated';
    }
    return 'already-linked';
  }
  await Contact.create({
    owner_user_id: ownerId,
    contact_user_id: contactUserId,
    name: contactName,
    circle_tags: [CIRCLE],
  });
  return 'created';
}

async function runOnce() {
  const demoUsers = await User.find({ email: { $in: DEMO_ACCOUNT_EMAILS } });
  if (demoUsers.length === 0) {
    console.log(`[${new Date().toISOString()}] No demo accounts found yet — run \`npm run seed-demo-accounts\` first.`);
    return;
  }

  const realUsers = await User.find({ email: { $nin: DEMO_ACCOUNT_EMAILS } });
  let linksTouched = 0;

  for (const real of realUsers) {
    for (const demo of demoUsers) {
      const a = await ensureReciprocalContact(demo._id.toString(), real._id.toString(), real.full_name || real.email);
      const b = await ensureReciprocalContact(real._id.toString(), demo._id.toString(), demo.full_name || demo.email);
      if (a !== 'already-linked' || b !== 'already-linked') linksTouched++;
    }
  }

  console.log(`[${new Date().toISOString()}] Checked ${realUsers.length} real user(s) against ${demoUsers.length} demo account(s) — ${linksTouched} link(s) created/updated.`);
}

async function main() {
  await connectToDatabase();
  console.log(`Demo account linker running — checking every ${INTERVAL_MS / 1000}s. Ctrl+C to stop.`);
  await runOnce();
  setInterval(() => {
    runOnce().catch((err) => console.error('Link cycle failed:', err));
  }, INTERVAL_MS);
}

main().catch((err) => {
  console.error('Demo account linker failed to start:', err);
  process.exit(1);
});
