/**
 * Manual stopgap for contact linking: there is currently no automated way for a pending
 * contact (invited by email via social.tsx, no contact_user_id yet) to become a real
 * linked one — that reconciliation is deliberately deferred to its own later pass. Until
 * then, run this after the invited person has signed up (logged in at least once) to
 * backfill contact_user_id on every pending Contact that was invited with their email.
 *
 * This does NOT run automatically anywhere (not on login, not on server boot) — it's a
 * manual CLI tool only.
 *
 * Run manually:
 *   npx tsx scripts/link-contact.ts <email>
 */
import dotenv from 'dotenv';
import connectToDatabase from '../lib/mongodb';
import User from '../models/User';
import Contact from '../models/Contact';

dotenv.config({ quiet: true });

async function linkContact(email: string) {
  await connectToDatabase();

  const user = await User.findOne({ email });
  if (!user) {
    console.log(`No user found with email "${email}" — they need to log in at least once before their contacts can be linked.`);
    process.exit(1);
  }

  // POST /api/contacts sets contact_user_id to explicit null (not an absent field) for an
  // unlinked invite, so this must match null, not use $exists: false (which only matches a
  // genuinely missing field and would silently never match anything here).
  const pendingContacts = await Contact.find({ email, contact_user_id: null });
  if (pendingContacts.length === 0) {
    console.log(`No pending contacts found with email "${email}" — nothing to link.`);
    process.exit(0);
  }

  for (const contact of pendingContacts) {
    contact.contact_user_id = user._id;
    await contact.save();
  }

  const owners = await User.find({ _id: { $in: pendingContacts.map(c => c.owner_user_id) } });
  const ownerNameById = new Map(owners.map(o => [o._id.toString(), o.full_name || o.email]));

  console.log(`Linked ${pendingContacts.length} contact(s) to ${user.full_name || user.email} (${email}):`);
  for (const contact of pendingContacts) {
    console.log(`  - in ${ownerNameById.get(contact.owner_user_id.toString()) || contact.owner_user_id}'s circle, as "${contact.name}"`);
  }
  process.exit(0);
}

const email = process.argv[2];
if (!email) {
  console.error('Usage: npx tsx scripts/link-contact.ts <email>');
  process.exit(1);
}

linkContact(email).catch((err) => {
  console.error('Link failed:', err);
  process.exit(1);
});
