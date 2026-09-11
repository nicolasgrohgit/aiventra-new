// Run via `npm test` (tsx --conditions=react-server --test ...) — this file transitively
// imports lib/api-client.ts → expo-constants → react-native, same as lib/mutation-queue.ts
// (see that file's test for the same note); a bare `tsx --test` run outside that condition
// would fail to resolve the import.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { isTripPast } from './trip-types';

const ZONE = 'Europe/Paris';

describe('isTripPast', () => {
  test('false on the trip\'s own last day', () => {
    const endDate = new Date('2030-03-17T14:00:00+01:00');
    const referenceDate = new Date('2030-03-17T23:00:00+01:00');
    assert.equal(isTripPast(endDate, ZONE, referenceDate), false);
  });

  test('false right up until the calendar day after it ends', () => {
    const endDate = new Date('2030-03-17T14:00:00+01:00');
    const referenceDate = new Date('2030-03-17T23:59:59+01:00');
    assert.equal(isTripPast(endDate, ZONE, referenceDate), false);
  });

  test('true starting midnight the day after it ends, in the trip\'s own timezone', () => {
    const endDate = new Date('2030-03-17T14:00:00+01:00');
    const referenceDate = new Date('2030-03-18T00:00:01+01:00');
    assert.equal(isTripPast(endDate, ZONE, referenceDate), true);
  });

  test('true for a trip long over', () => {
    const endDate = new Date('2030-01-01T00:00:00Z');
    const referenceDate = new Date('2030-06-01T00:00:00Z');
    assert.equal(isTripPast(endDate, ZONE, referenceDate), true);
  });

  test('checked in the trip\'s own destination timezone, not UTC or the device\'s', () => {
    // 2030-03-17T23:30 Pacific/Honolulu is still 2030-03-18T09:30 UTC — the trip's own last
    // day hasn't ended yet in its own zone, even though the UTC calendar date has already
    // rolled over.
    const endDate = new Date('2030-03-17T12:00:00-10:00'); // Honolulu midday, still the 17th there
    const referenceDate = new Date('2030-03-17T23:30:00-10:00'); // still the 17th in Honolulu
    assert.equal(isTripPast(endDate, 'Pacific/Honolulu', referenceDate), false);
  });
});
