import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildAccountDeletionPlan, interpretAccountDeletionStatus, isObjectIdString, isValidDeletionRequestEmail, normalizeDeletionRequestEmail
} from './account-deletion';

const USER = '665f1c2e9b1d4a0012345678';
const TRIPS = ['665f1c2e9b1d4a00aaaaaaa1', '665f1c2e9b1d4a00aaaaaaa2'];

test('the user document is removed last, so a failed run can be retried while still signed in', () => {
  const plan = buildAccountDeletionPlan(USER, TRIPS, 'Sam@Example.com');
  const last = plan[plan.length - 1];
  assert.deepEqual(last, { model: 'User', op: 'deleteMany', filter: { _id: USER } });
  assert.equal(plan.filter((s) => s.model === 'User').length, 1);
});

test('every model that references a User is covered by the plan', () => {
  // Guards against a new models/*.ts with a user reference being added without a matching
  // deletion step — the failure mode that leaves personal data behind after "delete account".
  const modelsDir = path.join(__dirname, '..', 'models');
  const referencing = fs
    .readdirSync(modelsDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .filter((f) => /ref:\s*'User'/.test(fs.readFileSync(path.join(modelsDir, f), 'utf8')))
    .map((f) => f.replace(/\.ts$/, ''));
  assert.ok(referencing.length >= 5, 'expected to find the user-referencing models');
  const covered = new Set(buildAccountDeletionPlan(USER, TRIPS, 'sam@example.com').map((s) => s.model));
  for (const model of referencing) {
    assert.ok(covered.has(model as any), `models/${model}.ts references User but has no deletion step`);
  }
});

test("removes the user's trips, the events on them, and other people's shadow trips of them", () => {
  const plan = buildAccountDeletionPlan(USER, TRIPS, 'sam@example.com');
  assert.ok(plan.some((s) => s.model === 'Event' && s.op === 'deleteMany' && deepEq(s.filter, { trip_id: { $in: TRIPS } })));
  assert.ok(plan.some((s) => s.model === 'Trip' && s.op === 'deleteMany' && deepEq(s.filter, { linkedTripId: { $in: TRIPS } })));
  assert.ok(plan.some((s) => s.model === 'Trip' && s.op === 'deleteMany' && deepEq(s.filter, { user_id: USER })));
  assert.ok(plan.some((s) => s.model === 'Event' && s.op === 'deleteMany' && deepEq(s.filter, { created_by: USER })));
});

test("pulls the user out of other people's events instead of deleting those events", () => {
  const plan = buildAccountDeletionPlan(USER, TRIPS, 'sam@example.com');
  const pull = plan.find((s) => s.op === 'updateMany');
  assert.deepEqual(pull, {
    model: 'Event',
    op: 'updateMany',
    filter: { 'participants.user_id': USER },
    update: { $pull: { participants: { user_id: USER } } },
  });
  // Must run after the user's own events are gone, or it would rewrite documents about to be deleted.
  assert.ok(plan.indexOf(pull!) > plan.findIndex((s) => s.model === 'Event' && deepEq(s.filter, { created_by: USER })));
});

test('removes contacts and friend requests in both directions', () => {
  const plan = buildAccountDeletionPlan(USER, TRIPS, 'sam@example.com');
  assert.deepEqual(plan.find((s) => s.model === 'Contact')?.filter, { $or: [{ owner_user_id: USER }, { contact_user_id: USER }] });
  assert.deepEqual(plan.find((s) => s.model === 'FriendRequest')?.filter, { $or: [{ from_user_id: USER }, { to_user_id: USER }] });
});

test('removes suggestions, the trip-creation log, and any pending web deletion request for that email', () => {
  const plan = buildAccountDeletionPlan(USER, TRIPS, '  Sam@Example.com ');
  assert.deepEqual(plan.find((s) => s.model === 'Suggestion')?.filter, { user: USER });
  assert.deepEqual(plan.find((s) => s.model === 'TripCreationEvent')?.filter, { user_id: USER });
  assert.deepEqual(plan.find((s) => s.model === 'AccountDeletionRequest')?.filter, { email: 'sam@example.com' });
});

test('skips the deletion-request step when the account has no email, rather than matching everything', () => {
  for (const email of [undefined, null, '', '   ']) {
    const plan = buildAccountDeletionPlan(USER, TRIPS, email);
    assert.equal(plan.some((s) => s.model === 'AccountDeletionRequest'), false);
  }
});

test('a user with no trips produces no empty-$in trip steps', () => {
  const plan = buildAccountDeletionPlan(USER, [], 'sam@example.com');
  assert.equal(plan.some((s) => JSON.stringify(s.filter).includes('$in')), false);
  assert.ok(plan.some((s) => s.model === 'Trip' && deepEq(s.filter, { user_id: USER })));
});

test('no step has an empty filter', () => {
  for (const step of buildAccountDeletionPlan(USER, TRIPS, 'sam@example.com')) {
    assert.ok(Object.keys(step.filter).length > 0, `${step.model} step would match every document`);
  }
});

test('rejects a user id that is not an ObjectId', () => {
  for (const bad of ['', 'mock_123', '{"$ne":null}', undefined as any, { $ne: null } as any]) {
    assert.throws(() => buildAccountDeletionPlan(bad, [], 'sam@example.com'), /user id/i);
  }
});

test('deletion-request email validation and normalization', () => {
  assert.equal(normalizeDeletionRequestEmail('  Sam@Example.COM '), 'sam@example.com');
  assert.equal(normalizeDeletionRequestEmail(42), '');
  assert.equal(normalizeDeletionRequestEmail({ $ne: null }), '');
  assert.equal(isValidDeletionRequestEmail('sam@example.com'), true);
  assert.equal(isValidDeletionRequestEmail('sam@example'), false);
  assert.equal(isValidDeletionRequestEmail('sam example@x.com'), false);
  assert.equal(isValidDeletionRequestEmail(''), false);
  assert.equal(isValidDeletionRequestEmail(`${'a'.repeat(250)}@x.com`), false);
});

function deepEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

test('isObjectIdString accepts only a 24-hex string', () => {
  assert.equal(isObjectIdString(USER), true);
  assert.equal(isObjectIdString('mock_123'), false);
  assert.equal(isObjectIdString({ $ne: null }), false);
  assert.equal(isObjectIdString(undefined), false);
});

test('the app treats a success as deleted', () => {
  assert.deepEqual(interpretAccountDeletionStatus(200), { deleted: true });
});

test('the app treats "user not found" as deleted — the account is already gone server-side', () => {
  assert.deepEqual(interpretAccountDeletionStatus(404), { deleted: true });
});

test('any other response leaves the account in place and says why', () => {
  for (const status of [400, 401, 429, 500, 503]) {
    const outcome = interpretAccountDeletionStatus(status);
    assert.equal(outcome.deleted, false, `status ${status}`);
    assert.ok(!outcome.deleted && outcome.message.length > 0, `status ${status} has a message`);
  }
  const expired = interpretAccountDeletionStatus(401);
  assert.match(!expired.deleted ? expired.message : '', /sign in again/i);
  const limited = interpretAccountDeletionStatus(429);
  assert.match(!limited.deleted ? limited.message : '', /15 minutes/);
});
