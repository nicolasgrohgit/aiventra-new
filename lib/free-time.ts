import { DateTime } from 'luxon';
import { DEVICE_TIMEZONE } from './timezones';
import { getMealWindows, parseHourString, MealTimePreferences } from './place-matching';
import { classifyImportedEvent } from './calendar-signals';

export type { MealTimePreferences };

// Split out of lib/calendar.ts so this pure date/time logic is testable in plain Node
// (see lib/free-time.test.ts) — lib/calendar.ts transitively imports expo-calendar, which
// pulls in react-native, which can't be transformed outside the RN/Expo build pipeline, so
// nothing in that file can be imported directly from a plain Node test. Re-exported from
// lib/calendar.ts for backward compatibility — existing imports are unaffected.

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  location?: string;
}

// Buffer applied on either side of a detected flight when it bounds a trip day's effective
// free-time window (see getTripDaySchedule below) — customs/baggage/the ride into town after
// landing, or the boarding cutoff before departure. A first reasonable guess (the design doc's
// suggested 30-45min range), not researched against real airport transit-time data — that's
// explicitly out of scope for this round (see docs/calendar-signal-detection-plan.md).
const FLIGHT_BUFFER_MINUTES = 45;

export interface FreeTimeSlot {
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  label?: string; // e.g. 'Lunch Break' | 'Evening' | 'Full Day'
}

export interface DaySchedule {
  date: Date;
  dayLabel: string;
  isWeekend: boolean;
  freeSlots: FreeTimeSlot[];
  // This day's real imported (device-calendar-synced) events, if any — [] when the day used
  // getHardcodedFreeSlots' fallback instead. Exposed so a caller can run
  // classifyImportedEvent (lib/calendar-signals.ts) against exactly the events this day's
  // freeSlots were computed from, without re-deriving the same per-day filter this function
  // already did internally — see filterDiningConflicts, used by app/(tabs)/trips.tsx to
  // suppress an AI meal proposal that would compete with a real already-scheduled meal.
  importedEvents: CalendarEvent[];
}

// Sets `base`'s time-of-day to `hour`, which may be fractional (e.g. 12.833 for 12:50) — used
// for day-start/day-end boundaries that aren't necessarily on the hour, like a flight-arrival-
// plus-buffer bound (see getTripDaySchedule) or a mealPrefs-shifted dayEndHour. Luxon's own
// `.set({ hour })` silently truncates a fractional hour instead of erroring (verified:
// `.set({ hour: 22.75 })` yields 22:00, dropping the 45 minutes) — floor the hour and convert
// the remainder to minutes explicitly instead, rounding rather than truncating so a value like
// 12.8333... (from a diff-in-minutes round trip) lands on :50, not :49.
function atHour(base: DateTime, hour: number): DateTime {
  return base.set({ hour: Math.floor(hour), minute: Math.round((hour % 1) * 60), second: 0, millisecond: 0 });
}

/**
 * Core Algorithm: Parses a day's worth of events and finds free time gaps that are larger than minGapMinutes.
 * `timezone` is the IANA zone the day boundaries (dayStartHour/dayEndHour) are measured in — defaults to the
 * device's own zone, which is correct for "today, where I am" but wrong for a future trip in another city
 * (use the trip's own timezone there; see getTripDaySchedule).
 */
export function calculateFreeTimeSlots(
  events: CalendarEvent[],
  dayStartHour = 8,
  dayEndHour = 22,
  minGapMinutes = 60,
  timezone: string = DEVICE_TIMEZONE
): FreeTimeSlot[] {
  const now = DateTime.now().setZone(timezone);

  if (!events || events.length === 0) {
    let start = atHour(now, dayStartHour);
    const end = atHour(now, dayEndHour);

    // Trim to current time if today and current time has passed the start
    if (now > start) {
      start = now;
    }

    const gapMinutes = Math.floor(end.diff(start, 'minutes').minutes);
    if (gapMinutes >= minGapMinutes) {
      return [{
        startTime: start.toJSDate(),
        endTime: end.toJSDate(),
        durationMinutes: gapMinutes
      }];
    }
    return [];
  }

  // Sort events chronologically
  const sortedEvents = [...events].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const freeSlots: FreeTimeSlot[] = [];

  // Start/end of daily available window, anchored to the first event's calendar day in `timezone`
  const firstEventDay = DateTime.fromJSDate(sortedEvents[0].startTime).setZone(timezone);
  const dayStart = atHour(firstEventDay, dayStartHour);
  const dayEnd = atHour(firstEventDay, dayEndHour);

  let currentTime = dayStart;

  // If calculating for today, do not include times that have already passed
  if (now.hasSame(dayStart, 'day') && now > dayStart) {
    currentTime = now < dayEnd ? now : dayEnd;
  }

  for (const event of sortedEvents) {
    const evtStart = DateTime.fromJSDate(event.startTime).setZone(timezone);
    const evtEnd = DateTime.fromJSDate(event.endTime).setZone(timezone);

    if (evtStart > currentTime) {
      const gapMinutes = Math.floor(evtStart.diff(currentTime, 'minutes').minutes);

      if (gapMinutes >= minGapMinutes) {
        freeSlots.push({
          startTime: currentTime.toJSDate(),
          endTime: evtStart.toJSDate(),
          durationMinutes: gapMinutes
        });
      }
    }

    // Update current free time pointer to the end of the event (or keep it if overlapping)
    if (evtEnd > currentTime) {
      currentTime = evtEnd;
    }
  }

  // Check the final gap between the last event and the end of the day bounds
  if (currentTime < dayEnd) {
    const gapMinutes = Math.floor(dayEnd.diff(currentTime, 'minutes').minutes);

    if (gapMinutes >= minGapMinutes) {
      freeSlots.push({
        startTime: currentTime.toJSDate(),
        endTime: dayEnd.toJSDate(),
        durationMinutes: gapMinutes
      });
    }
  }

  return freeSlots;
}

/**
 * Classifies a computed FreeTimeSlot the same way getHardcodedFreeSlots labels its own
 * output ('Lunch Break' | 'Evening' | 'Free Time'), based on overlap with isMealWindow's
 * lunch/dinner boundaries — so real-calendar-derived slots (getTripDaySchedule, once it has
 * imported events to work with) and hardcoded-fallback slots read consistently in the UI,
 * which already keys icon choice off slot.label === 'Lunch Break'.
 *
 * `mealPrefs` (default none, unchanged behavior) shifts the lunch/dinner windows per-user —
 * see lib/place-matching.ts's getMealWindows, the single source of truth for these boundaries.
 */
export function labelFreeSlot(slot: FreeTimeSlot, timezone: string = DEVICE_TIMEZONE, mealPrefs: MealTimePreferences = {}): string {
  const start = DateTime.fromJSDate(slot.startTime).setZone(timezone);
  const end = DateTime.fromJSDate(slot.endTime).setZone(timezone);
  const { lunchStart, lunchEnd, dinnerStart, dinnerEnd } = getMealWindows(mealPrefs);

  const overlapMinutes = (windowStartHour: number, windowEndHour: number) => {
    const winStart = atHour(start, windowStartHour);
    const winEnd = atHour(start, windowEndHour);
    const overlapStart = start > winStart ? start : winStart;
    const overlapEnd = end < winEnd ? end : winEnd;
    return Math.max(0, overlapEnd.diff(overlapStart, 'minutes').minutes);
  };

  const lunchOverlap = overlapMinutes(lunchStart, lunchEnd);
  const dinnerOverlap = overlapMinutes(dinnerStart, dinnerEnd);

  if (lunchOverlap >= 30 && lunchOverlap >= dinnerOverlap) return 'Lunch Break';
  if (dinnerOverlap >= 30) return 'Evening';
  return 'Free Time';
}

/**
 * Splits a free-time slot into one proposal per suggestion type instead of a single flat
 * list — a slot long enough to span a meal should propose an activity AND that meal, not just
 * whichever label the slot's *overall* time range happens to classify as. This is what fixes
 * a real observed bug: a slot like 08:00-16:00 (only genuinely busy 16:00-17:00) got labeled
 * "Lunch Break" purely because lunch was the window it overlapped *most*, but its raw start
 * time (08:00) is nowhere near lunch — so the recommendation query for it (which filters by
 * category based on whether the *queried instant* falls in a meal window, see
 * lib/place-matching.ts's isMealWindow/buildCategoryFilter) came back with Activity/Event
 * results under a "Lunch Break" label instead of restaurants. Carving out a dedicated Lunch
 * proposal whose own start time genuinely sits inside the lunch window fixes the mismatch at
 * the source, rather than papering over it with a better label.
 *
 * Handles both meal windows generically (a slot can span just one, or — a weekend "Full Day"
 * slot — both): walks the slot chronologically, emitting an Activity chunk for any meaningful
 * gap before each meal window the slot reaches, then a Lunch/Dinner chunk for that window
 * itself. Trailing time after the last relevant meal isn't surfaced as its own proposal
 * (matches the already-accepted gap for "after dinner" — see the 'show' type note below).
 *
 * Typed as an array of { type, ... } rather than a hardcoded shape so a future 'show'
 * (post-dinner) type can be appended later without restructuring callers — see docs on the
 * Event taxonomy's venue-vs-schedule gap for why that third type isn't built yet.
 *
 * Only splits when the slot is long enough overall (>=150min) that carving out a meal still
 * leaves something meaningful — short slots, or slots that don't reach any meal window, are
 * returned unchanged as a single 'activity' proposal, i.e. today's behavior for those cases.
 */
export interface SlotProposal {
  type: 'activity' | 'meal';
  label: string;
  icon: string;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
}

function activityLabel(startHour: number): string {
  if (startHour < 12) return 'Morning Activity';
  if (startHour < 17) return 'Afternoon Activity';
  return 'Evening Activity';
}

export function expandSlotForProposals(slot: FreeTimeSlot, timezone: string = DEVICE_TIMEZONE, mealPrefs: MealTimePreferences = {}): SlotProposal[] {
  const start = DateTime.fromJSDate(slot.startTime).setZone(timezone);
  const end = DateTime.fromJSDate(slot.endTime).setZone(timezone);
  const windows = getMealWindows(mealPrefs);

  const asActivity = (): SlotProposal[] => [{
    type: 'activity',
    label: slot.label || labelFreeSlot(slot, timezone, mealPrefs),
    icon: '🌙',
    startTime: slot.startTime,
    endTime: slot.endTime,
    durationMinutes: slot.durationMinutes
  }];

  if (slot.durationMinutes < 150) {
    return asActivity();
  }

  const meals = ([
    { label: 'Lunch', windowStart: windows.lunchStart, windowEnd: windows.lunchEnd },
    { label: 'Dinner', windowStart: windows.dinnerStart, windowEnd: windows.dinnerEnd }
  ] as const)
    .map(m => {
      const winStart = atHour(start, m.windowStart);
      const winEnd = atHour(start, m.windowEnd);
      const overlapStart = start > winStart ? start : winStart;
      const overlapEnd = end < winEnd ? end : winEnd;
      const overlapMinutes = Math.max(0, overlapEnd.diff(overlapStart, 'minutes').minutes);
      return { label: m.label, overlapStart, overlapEnd, overlapMinutes };
    })
    .filter(m => m.overlapMinutes >= 45)
    .sort((a, b) => a.overlapStart.toMillis() - b.overlapStart.toMillis());

  if (meals.length === 0) {
    return asActivity();
  }

  const proposals: SlotProposal[] = [];
  let cursor = start;
  for (const meal of meals) {
    const activityDurationMinutes = Math.min(180, Math.floor(meal.overlapStart.diff(cursor, 'minutes').minutes));
    if (activityDurationMinutes >= 45) {
      proposals.push({
        type: 'activity',
        label: activityLabel(cursor.hour + cursor.minute / 60),
        icon: '🎭',
        startTime: cursor.toJSDate(),
        endTime: cursor.plus({ minutes: activityDurationMinutes }).toJSDate(),
        durationMinutes: activityDurationMinutes
      });
    }
    proposals.push({
      type: 'meal',
      label: meal.label,
      icon: '🍽️',
      startTime: meal.overlapStart.toJSDate(),
      endTime: meal.overlapEnd.toJSDate(),
      // Capped at 120: buildCategoryFilter (lib/place-matching.ts) only guarantees a
      // Restaurant-only result when mealWindow && durationMinutes <= 120 — anything longer
      // falls through to an unfiltered match, defeating the point of a dedicated meal row.
      durationMinutes: Math.min(120, Math.round(meal.overlapMinutes))
    });
    cursor = meal.overlapEnd;
  }

  return proposals;
}

/**
 * Returns the hardcoded free time slots for a given date based on the
 * fixed work schedule: busy Mon–Fri 08:30–18:00 with a 90-min lunch
 * window at 12:00–13:30. Weekends are fully open 08:00–22:00.
 * Elapsed slots for today are automatically truncated or discarded.
 *
 * `timezone` (IANA, e.g. "Europe/Paris") anchors what "today"/"now" and the
 * work-schedule hours mean — pass the trip's destination timezone so a user
 * planning a Paris trip from a New York device gets Paris-local slots, not
 * their phone's local slots. Defaults to the device's own timezone.
 *
 * `mealPrefs` (default none, unchanged behavior) shifts the lunch/evening start times per-user
 * — see lib/place-matching.ts's getMealWindows. Each window's existing *width* is kept fixed
 * (90min lunch, 240min evening); the evening window is additionally capped at 23:30 so a very
 * late dinner preference can't push suggestions into the small hours.
 */
export function getHardcodedFreeSlots(date: Date, timezone: string = DEVICE_TIMEZONE, mealPrefs: MealTimePreferences = {}): FreeTimeSlot[] {
  const zonedDate = DateTime.fromJSDate(date).setZone(timezone);
  const isWeekend = zonedDate.weekday === 6 || zonedDate.weekday === 7; // luxon: 6 = Sat, 7 = Sun
  const now = DateTime.now().setZone(timezone);
  const isToday = zonedDate.hasSame(now, 'day');
  // Deliberately not reusing getMealWindows' defaults here (11.5/18.5, tuned for
  // isMealWindow's scoring window) — this function's own historical defaults are 12:00/18:00,
  // and preserving those exactly (when no preference is set) is what keeps "undefined = no
  // behavior change" true. When a preference *is* set, both paths land on the same value
  // anyway, since parseHourString just returns it unchanged.
  const lunchStartHour = parseHourString(mealPrefs.earliestLunchTime, 12);
  const dinnerStartHour = parseHourString(mealPrefs.earliestDinnerTime, 18);

  if (isWeekend) {
    let start = atHour(zonedDate, 8);
    const end = atHour(zonedDate, 22);

    if (isToday && now > start) {
      start = now;
    }

    const duration = Math.floor(end.diff(start, 'minutes').minutes);
    if (duration >= 60) {
      return [{ startTime: start.toJSDate(), endTime: end.toJSDate(), durationMinutes: duration, label: 'Full Day' }];
    }
    return [];
  }

  // Weekday: lunch window + evening window
  const slots: FreeTimeSlot[] = [];

  const lunchStart = atHour(zonedDate, lunchStartHour);
  const lunchEnd = lunchStart.plus({ minutes: 90 });

  if (!isToday || now < lunchEnd) {
    const start = (isToday && now > lunchStart) ? now : lunchStart;
    const duration = Math.floor(lunchEnd.diff(start, 'minutes').minutes);
    if (duration >= 30) {
      slots.push({ startTime: start.toJSDate(), endTime: lunchEnd.toJSDate(), durationMinutes: duration, label: 'Lunch Break' });
    }
  }

  const eveningStart = atHour(zonedDate, dinnerStartHour);
  const eveningEndCap = atHour(zonedDate, 23.5);
  const eveningEnd = DateTime.min(eveningStart.plus({ minutes: 240 }), eveningEndCap);

  if (!isToday || now < eveningEnd) {
    const start = (isToday && now > eveningStart) ? now : eveningStart;
    const duration = Math.floor(eveningEnd.diff(start, 'minutes').minutes);
    if (duration >= 60) {
      slots.push({ startTime: start.toJSDate(), endTime: eveningEnd.toJSDate(), durationMinutes: duration, label: 'Evening' });
    }
  }

  return slots;
}

/**
 * Returns a day-by-day schedule array for a trip, capped at maxDays.
 * Each entry contains the date, a human-readable label, whether it's
 * a weekend, and the computed free slots for that day.
 *
 * `timezone` should be the trip's own destination timezone (see lib/timezones.ts)
 * so day boundaries and free slots reflect the destination's clock, not the device's.
 *
 * `importedEvents` (default none, fully backward compatible): real device-calendar events
 * synced for this trip (Event docs with source: 'imported' — see POST
 * /api/trips/:tripId/events/import). Any day that has at least one of these uses them to
 * compute real gaps via calculateFreeTimeSlots instead of the fixed weekday/weekend
 * assumption — a day with real data is a strictly better source of truth than a guess about
 * a "typical" schedule. A day with none (calendar access not granted, or genuinely nothing
 * synced yet) falls back to getHardcodedFreeSlots exactly as before.
 *
 * `mealPrefs` (default none, unchanged behavior): passed through to labelFreeSlot and
 * getHardcodedFreeSlots, and also widens the day-end bound passed to calculateFreeTimeSlots
 * (fixed at 22 otherwise) so a late dinner preference doesn't get truncated by the real-
 * calendar path before expandSlotForProposals ever sees it.
 *
 * A detected flight (classifyImportedEvent, lib/calendar-signals.ts) additionally bounds the
 * day's *effective* start/end instead of just being excluded as a busy block — see
 * docs/calendar-signal-detection-plan.md Part B. On the trip's own first day, if that day's
 * imported events include a flight signal, the effective day-start becomes that flight's
 * arrival time plus FLIGHT_BUFFER_MINUTES (the traveller isn't reachable for activities until
 * customs/baggage/the ride into town are done, even though the underlying busy-time math
 * already excludes the literal flight/ground-transit blocks). Symmetrically, on the trip's own
 * last day, a flight signal pulls the effective day-end earlier by the same buffer before its
 * departure time. Only applied on the trip's actual first/last day — not just "any day with a
 * flight" — since those are the only days a flight plausibly represents this trip's own
 * arrival/departure rather than, say, a same-day domestic hop mid-trip, which this doesn't try
 * to guess at. A day with no flight signal (the common case) is completely unaffected: the
 * fixed dayStartHour=8 / dayEndHour bound applies exactly as before.
 *
 * The two sides use different mechanisms internally (see the inline comments in the loop
 * below) — bounding dayStartHour is sufficient on the arrival side, but the departure side
 * additionally extends the flight event's own busy window backward by the buffer, since
 * dayEndHour alone only ever bounds the day's trailing gap, not one that ends right before a
 * mid-day event.
 */
export function getTripDaySchedule(
  startDate: Date,
  endDate: Date,
  maxDays = 5,
  timezone: string = DEVICE_TIMEZONE,
  importedEvents: CalendarEvent[] = [],
  mealPrefs: MealTimePreferences = {}
): DaySchedule[] {
  const days: DaySchedule[] = [];
  let current = DateTime.fromJSDate(startDate).setZone(timezone).startOf('day');
  const end = DateTime.fromJSDate(endDate).setZone(timezone).endOf('day');
  const dayEndHour = Math.min(23.5, Math.max(22, getMealWindows(mealPrefs).dinnerEnd));
  const tripStartDay = DateTime.fromJSDate(startDate).setZone(timezone).startOf('day');
  const tripEndDay = DateTime.fromJSDate(endDate).setZone(timezone).startOf('day');

  let count = 0;
  while (current <= end && count < maxDays) {
    const isWeekend = current.weekday === 6 || current.weekday === 7;
    const dayLabel = current.toFormat('EEE, MMM d');

    const dayEvents = importedEvents.filter(e =>
      DateTime.fromJSDate(e.startTime).setZone(timezone).hasSame(current, 'day')
    );

    let effectiveDayStartHour = 8;
    let effectiveDayEndHour = dayEndHour;
    // The events actually passed to calculateFreeTimeSlots — identical to dayEvents unless a
    // departure-day flight needs its own busy block extended (see below).
    let eventsForFreeTime = dayEvents;

    const isTripStartDay = current.hasSame(tripStartDay, 'day');
    const isTripEndDay = current.hasSame(tripEndDay, 'day');

    // Arrival day: bounding the day's own *start* (rather than just the flight's busy
    // block) is what's needed here — calculateFreeTimeSlots seeds its very first gap check
    // from dayStart, so this alone correctly suppresses any "free" gap before landing,
    // including one computed against an earlier ground-transit event
    // (`Travel time to <airport>`) rather than the flight itself. A later real event ending
    // after this buffered estimate (e.g. `Travel time from <airport>`) still wins, since
    // real synced data is more precise than this generic guess.
    //
    // Deliberately sourced from `importedEvents` (the full list), not `dayEvents` — an
    // overnight/red-eye flight's own startTime (what buckets an event into `dayEvents` above)
    // falls on the *departure* calendar day even when its arrival, the instant that actually
    // matters here, lands after midnight. So this also checks the day right after
    // tripStartDay, the only day such a flight could land on — gated by requiring the flight's
    // own departure to have been on tripStartDay itself, so a same-day domestic hop that
    // happens to both depart and land on that later day (see the "neither first nor last day"
    // test) still correctly has no effect.
    const isArrivalCandidateDay = isTripStartDay || current.hasSame(tripStartDay.plus({ days: 1 }), 'day');
    let hasArrivalSignal = false;
    if (isArrivalCandidateDay) {
      const arrivingToday = importedEvents.filter(e => {
        if (classifyImportedEvent(e, timezone, mealPrefs)?.kind !== 'flight') return false;
        if (!DateTime.fromJSDate(e.endTime).setZone(timezone).hasSame(current, 'day')) return false;
        return isTripStartDay || DateTime.fromJSDate(e.startTime).setZone(timezone).hasSame(tripStartDay, 'day');
      });
      if (arrivingToday.length > 0) {
        hasArrivalSignal = true;
        // Non-null: DateTime.max types its return as possibly undefined only because TS can't
        // see the arrivingToday.length > 0 guard above through the spread — always defined here.
        const latestArrival = DateTime.max(...arrivingToday.map(e => DateTime.fromJSDate(e.endTime).setZone(timezone)))!
          .plus({ minutes: FLIGHT_BUFFER_MINUTES });
        effectiveDayStartHour = Math.max(effectiveDayStartHour, latestArrival.hour + latestArrival.minute / 60);
      }
    }

    if (dayEvents.length > 0 && isTripEndDay) {
      const isFlightSignal = (e: CalendarEvent) => classifyImportedEvent(e, timezone, mealPrefs)?.kind === 'flight';
      const flightSignals = dayEvents.filter(isFlightSignal);

      // Departure day needs two changes together, unlike arrival day: (1) capping
      // effectiveDayEndHour, which only ever bounds the *trailing* gap after the day's last
      // event — it correctly suppresses a bogus "free until 22:00" slot that would otherwise
      // follow the flight's own end time, but does nothing for the gap that ends right before
      // the flight *starts* (a gap-before-event, not a trailing gap) — so (2) the flight
      // event's own busy window is additionally extended backward by the buffer, the same way
      // a real `Travel time to <airport>` block already (correctly) bounds that gap when one
      // exists. When a real transit event's own start is earlier than this buffered estimate
      // (the common case, per the real sample data), it already wins on its own — this only
      // matters when the flight is the day's only relevant event.
      if (flightSignals.length > 0) {
        const earliestDeparture = DateTime.min(...flightSignals.map(e => DateTime.fromJSDate(e.startTime).setZone(timezone)))!;
        const bufferedDeparture = earliestDeparture.minus({ minutes: FLIGHT_BUFFER_MINUTES });
        effectiveDayEndHour = Math.min(effectiveDayEndHour, bufferedDeparture.hour + bufferedDeparture.minute / 60);
        eventsForFreeTime = dayEvents.map(e =>
          isFlightSignal(e)
            ? { ...e, startTime: DateTime.fromJSDate(e.startTime).setZone(timezone).minus({ minutes: FLIGHT_BUFFER_MINUTES }).toJSDate() }
            : e
        );
      }
    }

    let freeSlots: FreeTimeSlot[];
    if (dayEvents.length > 0) {
      freeSlots = calculateFreeTimeSlots(eventsForFreeTime, effectiveDayStartHour, effectiveDayEndHour, 60, timezone).map(slot => ({
        ...slot,
        label: labelFreeSlot(slot, timezone, mealPrefs)
      }));
    } else if (hasArrivalSignal) {
      // A flight lands today but that's the *only* real signal this day has — dayEvents
      // itself is empty (nothing else synced yet), which would otherwise fall through to
      // getHardcodedFreeSlots below and lose all awareness of the flight. Mirrors
      // calculateFreeTimeSlots's own events.length === 0 branch, but deliberately doesn't
      // call it: that branch anchors to real wall-clock "now" rather than an explicit target
      // day, which is only correct for a caller literally asking about today (see
      // app/(tabs)/index.tsx's two calls) — `current` here can be any day of a future or past
      // trip, so the anchor has to be `current` itself, trimmed to now only when it really is
      // today.
      const now = DateTime.now().setZone(timezone);
      let start = atHour(current, effectiveDayStartHour);
      const end = atHour(current, effectiveDayEndHour);
      if (now.hasSame(current, 'day') && now > start) {
        start = now < end ? now : end;
      }
      const gapMinutes = Math.floor(end.diff(start, 'minutes').minutes);
      freeSlots = gapMinutes >= 60
        ? [{
            startTime: start.toJSDate(),
            endTime: end.toJSDate(),
            durationMinutes: gapMinutes,
            label: labelFreeSlot({ startTime: start.toJSDate(), endTime: end.toJSDate(), durationMinutes: gapMinutes }, timezone, mealPrefs)
          }]
        : [];
    } else {
      freeSlots = getHardcodedFreeSlots(current.toJSDate(), timezone, mealPrefs);
    }

    days.push({
      date: current.toJSDate(),
      dayLabel,
      isWeekend,
      freeSlots,
      importedEvents: dayEvents,
    });

    current = current.plus({ days: 1 });
    count++;
  }

  return days;
}

/**
 * Generates mock events for today to test the matching algorithm.
 */
export function generateMockEventsForToday(): CalendarEvent[] {
  const today = new Date();

  const createDate = (hours: number, minutes = 0) => {
    const d = new Date(today);
    d.setHours(hours, minutes, 0, 0);
    return d;
  };

  return [
    {
      id: 'evt1',
      title: 'Morning Sync',
      startTime: createDate(9, 30),
      endTime: createDate(10, 30),
      location: 'Zoom',
    },
    {
      id: 'evt2',
      title: 'Lunch with Sarah',
      startTime: createDate(12, 30),
      endTime: createDate(13, 45),
      location: 'Le Parisien',
    },
    {
      id: 'evt3',
      title: 'Project Presentation',
      startTime: createDate(16, 0),
      endTime: createDate(17, 30),
      location: 'Conference Room B',
    }
  ];
}
