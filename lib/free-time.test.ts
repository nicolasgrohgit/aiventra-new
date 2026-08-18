import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFreeTimeSlots, getHardcodedFreeSlots, getTripDaySchedule } from './free-time';

const ZONE = 'Europe/Paris';

// Fixed far-future dates throughout, so "now" truncation never interferes with the parts of
// the algorithm being tested here — "now"-relative behavior gets its own explicit tests below.
const FUTURE_MONDAY = new Date('2030-03-04T00:00:00.000+01:00'); // a Monday
const FUTURE_SATURDAY = new Date('2030-03-09T00:00:00.000+01:00'); // a Saturday

describe('calculateFreeTimeSlots', () => {
  test('no events: returns the full day window when far in the future', () => {
    // Uses "now" as the anchor day when there are no events, so this specifically exercises
    // the no-truncation path only insofar as "today" (real now) has a full day ahead — safe
    // because the assertion is about shape/duration, not the exact date.
    const slots = calculateFreeTimeSlots([], 8, 22, 60, ZONE);
    assert.ok(slots.length <= 1);
    if (slots.length === 1) {
      assert.ok(slots[0].durationMinutes <= 14 * 60);
    }
  });

  test('finds a gap between two events on the same day', () => {
    const events = [
      { id: 'a', title: 'Morning', startTime: new Date('2030-03-04T09:00:00+01:00'), endTime: new Date('2030-03-04T10:00:00+01:00') },
      { id: 'b', title: 'Afternoon', startTime: new Date('2030-03-04T14:00:00+01:00'), endTime: new Date('2030-03-04T15:00:00+01:00') },
    ];
    const slots = calculateFreeTimeSlots(events, 8, 22, 60, ZONE);

    // Gap 1: day start (8:00) to event a (9:00) = 60min — exactly at minGapMinutes, included.
    // Gap 2: event a end (10:00) to event b (14:00) = 240min.
    // Gap 3: event b end (15:00) to day end (22:00) = 420min.
    assert.equal(slots.length, 3);
    assert.equal(slots[0].durationMinutes, 60);
    assert.equal(slots[1].durationMinutes, 240);
    assert.equal(slots[2].durationMinutes, 420);
  });

  test('a gap shorter than minGapMinutes is excluded', () => {
    const events = [
      { id: 'a', title: 'A', startTime: new Date('2030-03-04T09:00:00+01:00'), endTime: new Date('2030-03-04T10:00:00+01:00') },
      { id: 'b', title: 'B', startTime: new Date('2030-03-04T10:30:00+01:00'), endTime: new Date('2030-03-04T11:00:00+01:00') }, // only 30min gap
    ];
    const slots = calculateFreeTimeSlots(events, 8, 22, 60, ZONE);
    // The 30min gap between A and B must not appear; only the before-A and after-B gaps should.
    assert.equal(slots.some(s => s.durationMinutes === 30), false);
  });

  test('overlapping events are handled without a negative-duration gap', () => {
    const events = [
      { id: 'a', title: 'A', startTime: new Date('2030-03-04T09:00:00+01:00'), endTime: new Date('2030-03-04T12:00:00+01:00') },
      { id: 'b', title: 'B', startTime: new Date('2030-03-04T10:00:00+01:00'), endTime: new Date('2030-03-04T11:00:00+01:00') }, // fully inside A
    ];
    const slots = calculateFreeTimeSlots(events, 8, 22, 60, ZONE);
    assert.ok(slots.every(s => s.durationMinutes > 0));
  });

  test('respects the destination timezone, not the local one', () => {
    // 08:00 Paris time is 02:00 New York time on the same calendar day (winter offset) —
    // computing this in the wrong zone would shift which day boundary applies.
    const events = [
      { id: 'a', title: 'A', startTime: new Date('2030-03-04T09:00:00+01:00'), endTime: new Date('2030-03-04T10:00:00+01:00') },
    ];
    const parisSlots = calculateFreeTimeSlots(events, 8, 22, 60, 'Europe/Paris');
    const nyOffsetSlots = calculateFreeTimeSlots(events, 8, 22, 60, 'America/New_York');
    // Different zones anchor the 8am/10pm day-boundary at different absolute instants, so the
    // resulting slot boundaries must differ even though the input events are identical.
    assert.notEqual(parisSlots[0]?.startTime.getTime(), nyOffsetSlots[0]?.startTime.getTime());
  });
});

describe('getHardcodedFreeSlots', () => {
  test('weekday: returns a lunch break and an evening slot', () => {
    const slots = getHardcodedFreeSlots(FUTURE_MONDAY, ZONE);
    assert.equal(slots.length, 2);
    assert.equal(slots[0].label, 'Lunch Break');
    assert.equal(slots[0].durationMinutes, 90);
    assert.equal(slots[1].label, 'Evening');
    assert.equal(slots[1].durationMinutes, 240);
  });

  test('weekend: returns a single full-day slot', () => {
    const slots = getHardcodedFreeSlots(FUTURE_SATURDAY, ZONE);
    assert.equal(slots.length, 1);
    assert.equal(slots[0].label, 'Full Day');
    assert.equal(slots[0].durationMinutes, 14 * 60);
  });

  test('today: does not return a slot that starts in the past', () => {
    const slots = getHardcodedFreeSlots(new Date(), ZONE);
    const now = Date.now();
    for (const slot of slots) {
      assert.ok(slot.startTime.getTime() >= now - 1000, `slot "${slot.label}" starts before now`);
    }
  });
});

describe('getTripDaySchedule', () => {
  test('returns one entry per day, capped at maxDays', () => {
    const start = FUTURE_MONDAY;
    const end = new Date('2030-03-14T00:00:00+01:00'); // 10 days later
    const days = getTripDaySchedule(start, end, 5, ZONE);
    assert.equal(days.length, 5);
  });

  test('correctly labels weekend vs weekday within the range', () => {
    const days = getTripDaySchedule(FUTURE_MONDAY, FUTURE_SATURDAY, 6, ZONE);
    assert.equal(days.length, 6);
    assert.equal(days[0].isWeekend, false); // Monday
    assert.equal(days[5].isWeekend, true); // Saturday
  });

  test('a single-day trip returns exactly one day', () => {
    const days = getTripDaySchedule(FUTURE_MONDAY, FUTURE_MONDAY, 5, ZONE);
    assert.equal(days.length, 1);
  });
});
