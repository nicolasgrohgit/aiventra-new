/**
 * One-time (idempotent — safe to re-run) seed: creates three real demo accounts used to
 * give beta testers an immediate, working example of the "friends nearby" feature without
 * needing two real testers to coordinate. Each has a real homebase, shares it with their
 * "Family and Friends" circle, and has randomized real taste preferences so joint-matching
 * with them also produces meaningful results.
 *
 * Deliberately obvious placeholder people (movie characters), same spirit as the existing
 * MOCK_CONTACTS in lib/contacts.ts (Sarah Connor, John Doe, ...) — not meant to look like
 * real users.
 *
 * Pairs with scripts/demo-account-linker.ts, which reciprocally links every new real
 * beta tester to these three accounts so the discovery is actually visible on both sides
 * (see the sharer-driven visibility model documented on GET /api/friends-nearby in server.ts).
 *
 * Run manually: npm run seed-demo-accounts
 */
import dotenv from 'dotenv';
import connectToDatabase from '../lib/mongodb';
import User from '../models/User';
import { FOOD_GENRES_CATEGORIZED, ACTIVITY_GENRES_CATEGORIZED, EVENT_GENRES_CATEGORIZED } from '../constants/preferences';
import { DEMO_ACCOUNTS } from './demo-accounts';

dotenv.config({ quiet: true });

function randomSubset<T>(items: T[], min: number, max: number): T[] {
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  const count = Math.floor(Math.random() * (max - min + 1)) + min;
  return shuffled.slice(0, count);
}

function randomPreferences() {
  const foodAll = FOOD_GENRES_CATEGORIZED.flatMap(g => g.activities);
  const activityAll = ACTIVITY_GENRES_CATEGORIZED.flatMap(g => g.activities);
  const eventAll = EVENT_GENRES_CATEGORIZED.flatMap(g => g.activities);

  return {
    budget: ['10-20', '30-50', '70+'][Math.floor(Math.random() * 3)],
    currency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    activityLevel: ['Low', 'Medium', 'High'][Math.floor(Math.random() * 3)],
    dietary: [] as string[],
    foodGenres: randomSubset(foodAll, 2, 4),
    activityGenres: randomSubset(activityAll, 2, 4),
    eventGenres: randomSubset(eventAll, 2, 4),
  };
}

async function seed() {
  await connectToDatabase();

  for (const account of DEMO_ACCOUNTS) {
    const existing = await User.findOne({ email: account.email });
    if (existing) {
      console.log(`Already exists, skipping: ${account.firstName} ${account.lastName} (${account.email})`);
      continue;
    }

    const fullName = `${account.firstName} ${account.lastName}`;
    await User.create({
      email: account.email,
      full_name: fullName,
      avatar_url: `https://i.pravatar.cc/150?u=${account.email}`,
      homebase: account.homebase,
      homebaseSharedCircles: ['Family and Friends'],
      preferences: randomPreferences(),
      firstName: account.firstName,
      lastName: account.lastName,
      dob: '1990-01-01',
    });
    console.log(`Created demo account: ${fullName} — ${account.homebase}, sharing homebase with "Family and Friends"`);
  }

  console.log('Demo accounts ready. Run `npm run demo-linker` to keep them linked to new beta testers.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
