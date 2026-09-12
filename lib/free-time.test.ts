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

  test('an all-day event does not block the whole day (live bug: a single Working Location/holiday marker zeroed out every free slot)', () => {
    const events = [
      { id: 'a', title: 'Armistice Day', startTime: new Date('2030-03-04T00:00:00+01:00'), endTime: new Date('2030-03-05T00:00:00+01:00'), allDay: true },
      { id: 'b', title: 'Standup', startTime: new Date('2030-03-04T09:00:00+01:00'), endTime: new Date('2030-03-04T09:30:00+01:00') },
    ];
    const slots = calculateFreeTimeSlots(events, 8, 22, 60, ZONE);
    // Only the real timed event should carve up the day — the all-day event must be ignored
    // entirely, not treated as a 24h busy block that swallows every gap.
    assert.equal(slots.length, 2);
    assert.equal(slots[0].durationMinutes, 60); // 08:00-09:00
    assert.equal(slots[1].durationMinutes, 750); // 09:30-22:00
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

  test('treatAsFullyOpen forces the weekend-style full-day slot on a weekday', () => {
    // A public holiday on a weekday means the traveller isn't working — same "Full Day"
    // treatment as a real weekend, not the default Mon-Fri lunch/evening-only pattern.
    const slots = getHardcodedFreeSlots(FUTURE_MONDAY, ZONE, {}, true);
    assert.equal(slots.length, 1);
    assert.equal(slots[0].label, 'Full Day');
    assert.equal(slots[0].durationMinutes, 14 * 60);
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

  test('DaySchedule exposes the day\'s own imported events', () => {
    const importedEvents = [
      { id: 'a', title: 'Standup', startTime: new Date('2030-03-04T09:00:00+01:00'), endTime: new Date('2030-03-04T09:30:00+01:00') },
    ];
    const days = getTripDaySchedule(FUTURE_MONDAY, FUTURE_MONDAY, 5, ZONE, importedEvents);
    assert.deepEqual(days[0].importedEvents, importedEvents);
  });

  test('a hardcoded-fallback day (no imported events) still exposes an empty importedEvents array', () => {
    const days = getTripDaySchedule(FUTURE_MONDAY, FUTURE_MONDAY, 5, ZONE, []);
    assert.deepEqual(days[0].importedEvents, []);
  });

  // Live-reported bug: a synced all-day event (Google Calendar's "Working Location" status —
  // filtered out entirely before it ever reaches here, see lib/calendar.ts's
  // isWorkingLocationEvent — or a genuine public holiday, which does reach here) was treated
  // as a literal 24h busy block, silently zeroing out every AI Schedule Proposal for that day.
  describe('all-day events (public holidays, out-of-office banners)', () => {
    test('a weekday with only an all-day event is treated as fully open, not the default work pattern', () => {
      const importedEvents = [
        { id: 'a', title: 'Armistice Day', startTime: new Date('2030-03-04T00:00:00+01:00'), endTime: new Date('2030-03-05T00:00:00+01:00'), allDay: true },
      ];
      const days = getTripDaySchedule(FUTURE_MONDAY, FUTURE_MONDAY, 5, ZONE, importedEvents);
      assert.equal(days[0].freeSlots.length, 1);
      assert.equal(days[0].freeSlots[0].label, 'Full Day');
      assert.equal(days[0].freeSlots[0].durationMinutes, 14 * 60);
    });

    test('an all-day event alongside real timed events does not block the gaps around them', () => {
      const importedEvents = [
        { id: 'a', title: 'Armistice Day', startTime: new Date('2030-03-04T00:00:00+01:00'), endTime: new Date('2030-03-05T00:00:00+01:00'), allDay: true },
        { id: 'b', title: 'Standup', startTime: new Date('2030-03-04T09:00:00+01:00'), endTime: new Date('2030-03-04T09:30:00+01:00') },
      ];
      const days = getTripDaySchedule(FUTURE_MONDAY, FUTURE_MONDAY, 5, ZONE, importedEvents);
      assert.ok(days[0].freeSlots.some(s => s.startTime.getTime() === new Date('2030-03-04T09:30:00+01:00').getTime()),
        'the gap right after the real meeting should still be free, not swallowed by the all-day marker');
    });

    test('the all-day event still appears in DaySchedule.importedEvents for display', () => {
      const importedEvents = [
        { id: 'a', title: 'Armistice Day', startTime: new Date('2030-03-04T00:00:00+01:00'), endTime: new Date('2030-03-05T00:00:00+01:00'), allDay: true },
      ];
      const days = getTripDaySchedule(FUTURE_MONDAY, FUTURE_MONDAY, 5, ZONE, importedEvents);
      assert.deepEqual(days[0].importedEvents, importedEvents);
    });
  });
});

// Real Navan-style event titles (see docs/calendar-signal-detection-plan.md) so
// classifyImportedEvent's matchNavan tier recognizes them as flight signals — these tests
// exercise Part B item 1 of that doc: a detected flight bounding a trip day's effective
// free-time window instead of just being excluded as a busy block.
describe('getTripDaySchedule — flight-signal day bounding', () => {
  const TRIP_START = FUTURE_MONDAY; // 2030-03-04
  const TRIP_END = new Date('2030-03-06T00:00:00+01:00'); // 2030-03-06, a 3-day trip

  test('an arrival-day flight bounds the effective day-start to arrival + buffer', () => {
    const importedEvents = [
      { id: 'flight', title: 'Flight: TLS (TO7103) to ORY Confirmation O7Z5VR', startTime: new Date('2030-03-04T10:40:00+01:00'), endTime: new Date('2030-03-04T12:05:00+01:00'), location: 'Toulouse - Blagnac Airport (TLS)' },
    ];
    const days = getTripDaySchedule(TRIP_START, TRIP_END, 5, ZONE, importedEvents);
    const day0 = days[0]; // trip's own first day = arrival day
    assert.equal(day0.freeSlots.length, 1);
    // 12:05 arrival + 45min buffer = 12:50 — no slot should start any earlier, and none should
    // exist covering the raw pre-flight morning (08:00-10:40), which the old dayStartHour=8
    // default would have incorrectly surfaced as "free".
    assert.equal(DateTime.fromJSDate(day0.freeSlots[0].startTime).setZone(ZONE).toFormat('HH:mm'), '12:50');
  });

  test('a later real ground-transit event on the arrival day wins over the generic buffer estimate', () => {
    // Full real cluster from the design doc's sample trip: "Travel time from ORY airport" ends
    // at 13:05, later than the flight-arrival-plus-buffer estimate (12:50) — the real synced
    // data should win.
    const importedEvents = [
      { id: 'transit-to', title: 'Travel time to TLS airport', startTime: new Date('2030-03-04T09:40:00+01:00'), endTime: new Date('2030-03-04T10:40:00+01:00'), location: 'Toulouse - Blagnac Airport (TLS)' },
      { id: 'flight', title: 'Flight: TLS (TO7103) to ORY Confirmation O7Z5VR', startTime: new Date('2030-03-04T10:40:00+01:00'), endTime: new Date('2030-03-04T12:05:00+01:00'), location: 'Toulouse - Blagnac Airport (TLS)' },
      { id: 'transit-from', title: 'Travel time  from ORY airport', startTime: new Date('2030-03-04T12:05:00+01:00'), endTime: new Date('2030-03-04T13:05:00+01:00'), location: 'Orly Airport (ORY)' },
    ];
    const days = getTripDaySchedule(TRIP_START, TRIP_END, 5, ZONE, importedEvents);
    assert.equal(days[0].freeSlots.length, 1);
    assert.equal(DateTime.fromJSDate(days[0].freeSlots[0].startTime).setZone(ZONE).toFormat('HH:mm'), '13:05');
  });

  test('a departure-day flight bounds the effective day-end to departure - buffer, with no bogus trailing slot', () => {
    const importedEvents = [
      { id: 'flight-out', title: 'Flight: ORY (TO7104) to TLS Confirmation ABC123', startTime: new Date('2030-03-06T16:00:00+01:00'), endTime: new Date('2030-03-06T17:25:00+01:00'), location: 'Orly Airport (ORY)' },
    ];
    const days = getTripDaySchedule(TRIP_START, TRIP_END, 5, ZONE, importedEvents);
    const lastDay = days[days.length - 1]; // trip's own last day = departure day
    assert.equal(DateTime.fromJSDate(lastDay.date).setZone(ZONE).toFormat('yyyy-MM-dd'), '2030-03-06');
    assert.equal(lastDay.freeSlots.length, 1);
    // 16:00 departure - 45min buffer = 15:15 — no trailing slot after the flight's raw 17:25
    // end should be generated (the old dayEndHour=22 default would have incorrectly surfaced
    // a bogus 17:25-22:00 "free" slot on the day the traveller has already left).
    assert.equal(DateTime.fromJSDate(lastDay.freeSlots[0].endTime).setZone(ZONE).toFormat('HH:mm'), '15:15');
  });

  test('a real ground-transit event on the departure day tightens the bound further than the generic buffer', () => {
    const importedEvents = [
      { id: 'transit-to', title: 'Travel time to ORY airport', startTime: new Date('2030-03-06T14:00:00+01:00'), endTime: new Date('2030-03-06T16:00:00+01:00'), location: 'Orly Airport (ORY)' },
      { id: 'flight-out', title: 'Flight: ORY (TO7104) to TLS Confirmation ABC123', startTime: new Date('2030-03-06T16:00:00+01:00'), endTime: new Date('2030-03-06T17:25:00+01:00'), location: 'Orly Airport (ORY)' },
    ];
    const days = getTripDaySchedule(TRIP_START, TRIP_END, 5, ZONE, importedEvents);
    const lastDay = days[days.length - 1];
    assert.equal(lastDay.freeSlots.length, 1);
    // The real transit block (starting 14:00) is a tighter, more accurate bound than the
    // generic 45-min-before-departure estimate (15:15) — it should win.
    assert.equal(DateTime.fromJSDate(lastDay.freeSlots[0].endTime).setZone(ZONE).toFormat('HH:mm'), '14:00');
  });

  test('a flight signal on a day that is neither the trip\'s first nor last day has no effect', () => {
    // Same flight text, but placed on the middle day of the 3-day trip — day-bounding only
    // applies to the trip's actual arrival/departure days, not "any day with a flight".
    const importedEvents = [
      { id: 'domestic-hop', title: 'Flight: TLS (TO7103) to ORY Confirmation O7Z5VR', startTime: new Date('2030-03-05T10:40:00+01:00'), endTime: new Date('2030-03-05T12:05:00+01:00'), location: 'Toulouse - Blagnac Airport (TLS)' },
    ];
    const days = getTripDaySchedule(TRIP_START, TRIP_END, 5, ZONE, importedEvents);
    const middleDay = days[1];
    assert.equal(DateTime.fromJSDate(middleDay.date).setZone(ZONE).toFormat('yyyy-MM-dd'), '2030-03-05');
    // Unaffected: the plain dayStartHour=8 default applies, so the gap before the flight
    // starts right at 08:00, not shifted by any arrival-buffer logic.
    const morningSlot = middleDay.freeSlots.find(s => DateTime.fromJSDate(s.startTime).setZone(ZONE).toFormat('HH:mm') === '08:00');
    assert.ok(morningSlot, 'the pre-flight morning gap should still start at the plain 08:00 default');
  });

  test('a red-eye that departs on the trip\'s first day but lands after midnight still bounds the second day\'s effective start', () => {
    // The flight's own startTime (23:30 on day 0) is what buckets it into day 0's dayEvents —
    // but it LANDS on day 1 (08:30), which is the day that actually needs its effective start
    // bounded past arrival + buffer. Distinguishes this from the "neither first nor last day"
    // domestic-hop test above by requiring the departure to have been on the trip's own start
    // day, not just any flight landing on day 1.
    const importedEvents = [
      { id: 'redeye', title: 'Flight: JFK (AA100) to CDG Confirmation XYZ123', startTime: new Date('2030-03-04T23:30:00+01:00'), endTime: new Date('2030-03-05T08:30:00+01:00'), location: 'JFK Airport' },
      { id: 'meeting', title: 'Team sync', startTime: new Date('2030-03-05T12:00:00+01:00'), endTime: new Date('2030-03-05T13:00:00+01:00'), location: 'Office' },
    ];
    const days = getTripDaySchedule(TRIP_START, TRIP_END, 5, ZONE, importedEvents);
    const arrivalDay = days[1];
    assert.equal(DateTime.fromJSDate(arrivalDay.date).setZone(ZONE).toFormat('yyyy-MM-dd'), '2030-03-05');
    // 08:30 arrival + 45min buffer = 09:15 — no slot should start any earlier, even though the
    // flight event itself isn't part of this day's own dayEvents (its startTime is the day
    // before), which is exactly the gap this test guards against regressing.
    assert.equal(DateTime.fromJSDate(arrivalDay.freeSlots[0].startTime).setZone(ZONE).toFormat('HH:mm'), '09:15');
  });

  test('an arrival day with NOTHING else synced yet still gets a buffered real-calendar slot, not the generic hardcoded fallback', () => {
    // Same red-eye as above, minus the "Team sync" meeting — dayEvents (start-time-bucketed)
    // is completely empty for the arrival day, which used to fall straight through to
    // getHardcodedFreeSlots (no concept of the flight at all, two disjoint Lunch/Evening
    // slots). It should instead still take the real-calendar path via calculateFreeTimeSlots's
    // own empty-events branch, bounded by the same arrival + buffer start.
    const importedEvents = [
      { id: 'redeye', title: 'Flight: JFK (AA100) to CDG Confirmation XYZ123', startTime: new Date('2030-03-04T23:30:00+01:00'), endTime: new Date('2030-03-05T08:30:00+01:00'), location: 'JFK Airport' },
    ];
    const days = getTripDaySchedule(TRIP_START, TRIP_END, 5, ZONE, importedEvents);
    const arrivalDay = days[1];
    assert.equal(DateTime.fromJSDate(arrivalDay.date).setZone(ZONE).toFormat('yyyy-MM-dd'), '2030-03-05');
    assert.equal(arrivalDay.freeSlots.length, 1);
    assert.equal(DateTime.fromJSDate(arrivalDay.freeSlots[0].startTime).setZone(ZONE).toFormat('HH:mm'), '09:15');
  });

  test('a day with only a non-flight signal (ground-transit only, no flight) is unaffected', () => {
    const importedEvents = [
      { id: 'transit-to', title: 'Travel time to TLS airport', startTime: new Date('2030-03-04T09:40:00+01:00'), endTime: new Date('2030-03-04T10:40:00+01:00'), location: 'Toulouse - Blagnac Airport (TLS)' },
    ];
    const days = getTripDaySchedule(TRIP_START, TRIP_END, 5, ZONE, importedEvents);
    const morningSlot = days[0].freeSlots.find(s => DateTime.fromJSDate(s.startTime).setZone(ZONE).toFormat('HH:mm') === '08:00');
    assert.ok(morningSlot, 'no flight signal present, so the plain 08:00 default should still apply');
  });

  test('a day with no imported events at all (hardcoded fallback) is unaffected even on the trip\'s first/last day', () => {
    const days = getTripDaySchedule(TRIP_START, TRIP_END, 5, ZONE, []);
    assert.deepEqual(days[0].freeSlots.map(s => s.label), getHardcodedFreeSlots(TRIP_START, ZONE).map(s => s.label));
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
    assert.equal(proposals[0].label, 'Evening Activity');
    assert.equal(proposals[0].startTime.getTime(), slot.startTime.getTime());
    assert.equal(proposals[1].type, 'meal');
    assert.equal(proposals[1].label, 'Dinner');
    // Dinner duration must stay <=120 so buildCategoryFilter (lib/place-matching.ts) stays
    // in its Restaurant-only branch.
    assert.ok(proposals[1].durationMinutes <= 120);
    // Activity shouldn't run past where dinner starts.
    assert.ok(proposals[0].endTime.getTime() <= proposals[1].startTime.getTime());
  });

  // Regression test for a real reported bug: a mostly-free day (one meeting 16:00-17:00) was
  // computing a single 08:00-16:00 "Lunch Break" slot — its raw start (08:00) is nowhere near
  // lunch, so the recommendation query for it came back with Activity/Event results under a
  // "Lunch Break" label instead of restaurants. It must now split into a real Activity chunk
  // plus a Lunch chunk whose own start time genuinely sits inside the lunch window.
  test('splits a long midday slot into Activity and Lunch (not a giant mislabeled block)', () => {
    const slot = { startTime: new Date('2030-03-04T08:00:00+01:00'), endTime: new Date('2030-03-04T16:00:00+01:00'), durationMinutes: 480, label: 'Lunch Break' };
    const proposals = expandSlotForProposals(slot, ZONE);
    assert.equal(proposals.length, 2);
    assert.equal(proposals[0].type, 'activity');
    assert.equal(proposals[0].label, 'Morning Activity');
    assert.equal(proposals[0].startTime.getTime(), slot.startTime.getTime());
    assert.equal(proposals[1].type, 'meal');
    assert.equal(proposals[1].label, 'Lunch');
    // The Lunch proposal's own start time must genuinely fall inside the lunch window —
    // this is what fixes the category-filter mismatch at the source.
    const lunchStartHour = DateTime.fromJSDate(proposals[1].startTime).setZone(ZONE).hour
      + DateTime.fromJSDate(proposals[1].startTime).setZone(ZONE).minute / 60;
    assert.ok(lunchStartHour >= 11.5 && lunchStartHour <= 13.5);
    assert.ok(proposals[1].durationMinutes <= 120);
  });

  test('a slot spanning both lunch and dinner splits into four proposals', () => {
    const slot = getHardcodedFreeSlots(FUTURE_SATURDAY, ZONE)[0]; // weekend "Full Day": 08:00-22:00
    const proposals = expandSlotForProposals(slot, ZONE);
    assert.equal(proposals.length, 4);
    assert.deepEqual(proposals.map(p => p.type), ['activity', 'meal', 'activity', 'meal']);
    assert.equal(proposals[1].label, 'Lunch');
    assert.equal(proposals[3].label, 'Dinner');
    // Both activity chunks are capped, not left spanning the whole gap either side.
    assert.ok(proposals[0].durationMinutes <= 180);
    assert.ok(proposals[2].durationMinutes <= 180);
  });

  test('does not split a short evening gap', () => {
    const slot = { startTime: new Date('2030-03-04T19:30:00+01:00'), endTime: new Date('2030-03-04T20:30:00+01:00'), durationMinutes: 60, label: 'Evening' };
    const proposals = expandSlotForProposals(slot, ZONE);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].type, 'activity');
  });

  test('does not split a slot that reaches no meal window at all', () => {
    const slot = { startTime: new Date('2030-03-04T06:00:00+01:00'), endTime: new Date('2030-03-04T09:00:00+01:00'), durationMinutes: 180, label: 'Free Time' };
    const proposals = expandSlotForProposals(slot, ZONE);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].startTime.getTime(), slot.startTime.getTime());
    assert.equal(proposals[0].durationMinutes, 180);
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
