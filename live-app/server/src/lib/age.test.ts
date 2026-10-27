import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageOn, isAdult, parseDob } from './age';

test('parseDob rejects malformed and impossible dates', () => {
  assert.equal(parseDob('2000-02-30'), undefined);
  assert.equal(parseDob('01/02/2000'), undefined);
  assert.ok(parseDob('2000-02-29'));
});

test('age turns over exactly on the birthday', () => {
  const dob = parseDob('2008-10-27')!;
  assert.equal(ageOn(dob, new Date('2026-10-26T12:00:00Z')), 17);
  assert.equal(ageOn(dob, new Date('2026-10-27T00:00:00Z')), 18);
  assert.equal(isAdult(dob, new Date('2026-10-26T12:00:00Z')), false);
  assert.equal(isAdult(dob, new Date('2026-10-27T00:00:00Z')), true);
});
