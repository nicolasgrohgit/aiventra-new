import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectToDatabase from '../lib/mongodb';
import User from './User';
import { flattenPreferenceTags } from '../lib/place-matching';

dotenv.config({ quiet: true });

// Regression test for the critical bug found this session: `preferences` was declared on
// the User schema with only `dietary`/`activity_level`, so foodGenres/activityGenres/
// eventGenres were stored fine (top-level strict:false let them save) and even round-tripped
// correctly through res.json()/.toObject(), but returned `undefined` on DIRECT property
// access on a fetched Mongoose document — exactly how flattenPreferenceTags reads them in
// server.ts. jointScore was silently 0 for every place, for every user, from the moment the
// joint-matching feature was built, until this was caught by actually running the app against
// a real database. A plain-object unit test (see place-matching.test.ts) can't reproduce this
// — it's specifically a Mongoose subdocument/schema-declaration behavior, so this test talks
// to a real database on purpose. Requires MongoDB reachable via MONGODB_URI (npm run mongo start).

const TEST_EMAIL = `preferences-regression-test-${Date.now()}@test.local`;

before(async () => {
  await connectToDatabase();
});

after(async () => {
  await User.deleteOne({ email: TEST_EMAIL });
  await mongoose.disconnect();
});

test('a freshly-fetched User document exposes preferences.* via direct property access', async () => {
  await User.create({
    email: TEST_EMAIL,
    full_name: 'Preferences Regression Test',
    preferences: {
      dietary: [],
      foodGenres: ['Italian', 'French'],
      activityGenres: ['Museums'],
      eventGenres: ['Concerts']
    }
  });

  // Deliberately re-fetch rather than using the object returned by .create() — the bug only
  // manifested on a document that went through a real find, not the in-memory create() result.
  const fetched = await User.findOne({ email: TEST_EMAIL });
  assert.ok(fetched, 'test user should exist after create');

  // The exact access pattern that was broken: direct property access, not .toObject().
  assert.deepEqual(fetched!.preferences.foodGenres, ['Italian', 'French']);
  assert.deepEqual(fetched!.preferences.activityGenres, ['Museums']);
  assert.deepEqual(fetched!.preferences.eventGenres, ['Concerts']);

  // And the actual function the joint-matching endpoint calls must see real tags, not [].
  const tags = flattenPreferenceTags(fetched!.preferences);
  assert.deepEqual(tags.sort(), ['Concerts', 'French', 'Italian', 'Museums'].sort());
});
