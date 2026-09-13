// Run via `npm test` (tsx --conditions=react-server --test ...) — this file transitively
// imports lib/api-client.ts → expo-constants → react-native, same as lib/mutation-queue.ts
// (see that file's test for the same note); a bare `tsx --test` run outside that condition
// would fail to resolve the import.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { isTripPast, isTripActive } from './trip-types';

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

describe('isTripActive', () => {
  test('true on the trip\'s own first day', () => {
    const startDate = new Date('2030-03-10T00:00:00+01:00');
    const endDate = new Date('2030-03-17T00:00:00+01:00');
    const referenceDate = new Date('2030-03-10T08:00:00+01:00');
    assert.equal(isTripActive(startDate, endDate, ZONE, referenceDate), true);
  });

  test('true on the trip\'s own last day, right up until midnight', () => {
    const startDate = new Date('2030-03-10T00:00:00+01:00');
    const endDate = new Date('2030-03-17T14:00:00+01:00');
    const referenceDate = new Date('2030-03-17T23:59:59+01:00');
    assert.equal(isTripActive(startDate, endDate, ZONE, referenceDate), true);
  });

  test('false the calendar day before the trip starts', () => {
    const startDate = new Date('2030-03-10T00:00:00+01:00');
    const endDate = new Date('2030-03-17T00:00:00+01:00');
    const referenceDate = new Date('2030-03-09T23:00:00+01:00');
    assert.equal(isTripActive(startDate, endDate, ZONE, referenceDate), false);
  });

  test('false the calendar day after the trip ends', () => {
    const startDate = new Date('2030-03-10T00:00:00+01:00');
    const endDate = new Date('2030-03-17T14:00:00+01:00');
    const referenceDate = new Date('2030-03-18T00:00:01+01:00');
    assert.equal(isTripActive(startDate, endDate, ZONE, referenceDate), false);
  });

  test('checked in the trip\'s own destination timezone, not UTC or the device\'s', () => {
    // 2030-03-09T23:30 Honolulu is already 2030-03-10T09:30 UTC — a naive UTC/device-local
    // comparison could wrongly call the trip active a day early; in Honolulu's own zone it's
    // still the day before the trip starts.
    const startDate = new Date('2030-03-10T00:00:00-10:00'); // Honolulu midnight, trip's first day
    const endDate = new Date('2030-03-17T00:00:00-10:00');
    const referenceDate = new Date('2030-03-09T23:30:00-10:00'); // still the 9th in Honolulu
    assert.equal(isTripActive(startDate, endDate, 'Pacific/Honolulu', referenceDate), false);
  });

  test('a single-day trip is active on that one day', () => {
    const startDate = new Date('2030-03-10T00:00:00+01:00');
    const endDate = new Date('2030-03-10T00:00:00+01:00');
    const referenceDate = new Date('2030-03-10T18:00:00+01:00');
    assert.equal(isTripActive(startDate, endDate, ZONE, referenceDate), true);
  });
});
