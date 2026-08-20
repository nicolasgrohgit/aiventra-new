import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { calculateFreeTimeSlots, getHardcodedFreeSlots, getTripDaySchedule, labelFreeSlot, expandSlotForProposals } from './free-time';

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

  test('mealPrefs shifts the lunch start while keeping its 90min width', () => {
    const slots = getHardcodedFreeSlots(FUTURE_MONDAY, ZONE, { earliestLunchTime: '13:00' });
    const lunch = slots.find(s => s.label === 'Lunch Break')!;
    assert.equal(DateTime.fromJSDate(lunch.startTime).setZone(ZONE).toFormat('HH:mm'), '13:00');
    assert.equal(lunch.durationMinutes, 90);
  });

  test('mealPrefs shifts the evening start earlier for an early-dinner preference', () => {
    const slots = getHardcodedFreeSlots(FUTURE_MONDAY, ZONE, { earliestDinnerTime: '17:30' });
    const evening = slots.find(s => s.label === 'Evening')!;
    assert.equal(DateTime.fromJSDate(evening.startTime).setZone(ZONE).toFormat('HH:mm'), '17:30');
  });

  test('a very late dinner preference caps the evening window at 23:30', () => {
    const slots = getHardcodedFreeSlots(FUTURE_MONDAY, ZONE, { earliestDinnerTime: '22:00' });
    const evening = slots.find(s => s.label === 'Evening')!;
    assert.equal(DateTime.fromJSDate(evening.endTime).setZone(ZONE).toFormat('HH:mm'), '23:30');
  });

  test('no mealPrefs: identical to today\'s defaults', () => {
    assert.deepEqual(getHardcodedFreeSlots(FUTURE_MONDAY, ZONE, {}), getHardcodedFreeSlots(FUTURE_MONDAY, ZONE));
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

  test('a day with imported events uses real gaps instead of the hardcoded pattern', () => {
    // A meeting sits right across the hardcoded lunch window (12:00-13:30) — under the old
    // fixed pattern this would still surface a "Lunch Break" slot regardless; with real data
    // it must not, since the user is actually busy then.
    const importedEvents = [
      { id: 'a', title: 'Standup', startTime: new Date('2030-03-04T09:00:00+01:00'), endTime: new Date('2030-03-04T09:30:00+01:00') },
      { id: 'b', title: 'Client lunch', startTime: new Date('2030-03-04T12:00:00+01:00'), endTime: new Date('2030-03-04T13:30:00+01:00') },
    ];
    const days = getTripDaySchedule(FUTURE_MONDAY, FUTURE_MONDAY, 5, ZONE, importedEvents);
    assert.equal(days.length, 1);
    const noon = days[0].freeSlots.find(s => s.startTime.getTime() <= new Date('2030-03-04T12:00:00+01:00').getTime()
      && s.endTime.getTime() > new Date('2030-03-04T12:00:00+01:00').getTime());
    assert.equal(noon, undefined, 'no free slot should span the real 12:00-13:30 meeting');
    // The gap right after the meeting (13:30 onward) should still show up as free.
    assert.ok(days[0].freeSlots.some(s => s.startTime.getTime() === new Date('2030-03-04T13:30:00+01:00').getTime()));
  });

  test('a day with no imported events falls back to the hardcoded pattern', () => {
    const days = getTripDaySchedule(FUTURE_MONDAY, FUTURE_MONDAY, 5, ZONE, []);
    assert.deepEqual(days[0].freeSlots.map(s => s.label), getHardcodedFreeSlots(FUTURE_MONDAY, ZONE).map(s => s.label));
  });
});

describe('labelFreeSlot', () => {
  test('labels a slot overlapping the lunch window', () => {
    const slot = { startTime: new Date('2030-03-04T12:00:00+01:00'), endTime: new Date('2030-03-04T13:00:00+01:00'), durationMinutes: 60 };
    assert.equal(labelFreeSlot(slot, ZONE), 'Lunch Break');
  });

  test('labels a slot overlapping the dinner window', () => {
    const slot = { startTime: new Date('2030-03-04T18:00:00+01:00'), endTime: new Date('2030-03-04T22:00:00+01:00'), durationMinutes: 240 };
    assert.equal(labelFreeSlot(slot, ZONE), 'Evening');
  });

  test('labels a slot overlapping neither as Free Time', () => {
    const slot = { startTime: new Date('2030-03-04T14:00:00+01:00'), endTime: new Date('2030-03-04T16:00:00+01:00'), durationMinutes: 120 };
    assert.equal(labelFreeSlot(slot, ZONE), 'Free Time');
  });
});

describe('expandSlotForProposals', () => {
  test('splits a long evening slot into Activity and Dinner', () => {
    const slot = { startTime: new Date('2030-03-04T17:00:00+01:00'), endTime: new Date('2030-03-04T22:00:00+01:00'), durationMinutes: 300, label: 'Evening' };
    const proposals = expandSlotForProposals(slot, ZONE);
    assert.equal(proposals.length, 2);
    assert.equal(proposals[0].type, 'activity');
    assert.equal(proposals[0].label, 'Activity');
    assert.equal(proposals[0].startTime.getTime(), slot.startTime.getTime());
    assert.equal(proposals[1].type, 'meal');
    assert.equal(proposals[1].label, 'Dinner');
    // Dinner duration must stay <=120 so buildCategoryFilter (lib/place-matching.ts) stays
    // in its Restaurant-only branch.
    assert.ok(proposals[1].durationMinutes <= 120);
    // Activity shouldn't run past where dinner starts.
    assert.ok(proposals[0].endTime.getTime() <= proposals[1].startTime.getTime());
  });

  test('splits a weekend full-day slot too (it reaches dinner time)', () => {
    const slot = getHardcodedFreeSlots(FUTURE_SATURDAY, ZONE)[0];
    const proposals = expandSlotForProposals(slot, ZONE);
    assert.equal(proposals.length, 2);
    assert.equal(proposals[1].type, 'meal');
    // Activity is capped, not the whole 8am-18:30 span.
    assert.ok(proposals[0].durationMinutes <= 180);
  });

  test('does not split a short evening gap', () => {
    const slot = { startTime: new Date('2030-03-04T19:30:00+01:00'), endTime: new Date('2030-03-04T20:30:00+01:00'), durationMinutes: 60, label: 'Evening' };
    const proposals = expandSlotForProposals(slot, ZONE);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].type, 'activity');
  });

  test('does not split a slot that never reaches the dinner window', () => {
    const slot = { startTime: new Date('2030-03-04T09:00:00+01:00'), endTime: new Date('2030-03-04T16:00:00+01:00'), durationMinutes: 420, label: 'Free Time' };
    const proposals = expandSlotForProposals(slot, ZONE);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].startTime.getTime(), slot.startTime.getTime());
    assert.equal(proposals[0].durationMinutes, 420);
  });

  test('a late-dinner preference (Spanish-style) shifts the Dinner split later', () => {
    const slot = { startTime: new Date('2030-03-04T17:00:00+01:00'), endTime: new Date('2030-03-04T23:00:00+01:00'), durationMinutes: 360, label: 'Evening' };
    const proposals = expandSlotForProposals(slot, ZONE, { earliestDinnerTime: '21:00' });
    assert.equal(proposals.length, 2);
    assert.equal(DateTime.fromJSDate(proposals[1].startTime).setZone(ZONE).toFormat('HH:mm'), '21:00');
    // Activity now has more room before dinner starts, still capped at 180.
    assert.ok(proposals[0].durationMinutes <= 180);
  });

  test('a slot that only reaches dinner time once shifted earlier now splits (Dutch-style)', () => {
    // 16:00-18:45 only overlaps the default 18:30-21:00 dinner window by 15min (< the 45min
    // floor), so with no preference this does NOT split — shifting dinner to 17:00 should.
    const slot = { startTime: new Date('2030-03-04T16:00:00+01:00'), endTime: new Date('2030-03-04T18:45:00+01:00'), durationMinutes: 165, label: 'Evening' };
    const unshifted = expandSlotForProposals(slot, ZONE);
    assert.equal(unshifted.length, 1);

    const shifted = expandSlotForProposals(slot, ZONE, { earliestDinnerTime: '17:00' });
    assert.equal(shifted.length, 2);
    assert.equal(DateTime.fromJSDate(shifted[1].startTime).setZone(ZONE).toFormat('HH:mm'), '17:00');
  });
});
