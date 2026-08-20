import { DateTime } from 'luxon';
import { DEVICE_TIMEZONE } from './timezones';
import { isMealWindow } from './place-matching';

// Dinner-window boundaries, kept in sync with isMealWindow's own dinner check (18.5-21.0) —
// duplicated as numbers (rather than re-deriving from isMealWindow) because callers below need
// the actual start/end instants, not just a boolean.
const DINNER_WINDOW_START_HOUR = 18.5;
const DINNER_WINDOW_END_HOUR = 21.0;

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
    let start = now.set({ hour: dayStartHour, minute: 0, second: 0, millisecond: 0 });
    const end = now.set({ hour: dayEndHour, minute: 0, second: 0, millisecond: 0 });

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
  const dayStart = firstEventDay.set({ hour: dayStartHour, minute: 0, second: 0, millisecond: 0 });
  const dayEnd = firstEventDay.set({ hour: dayEndHour, minute: 0, second: 0, millisecond: 0 });

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
 */
export function labelFreeSlot(slot: FreeTimeSlot, timezone: string = DEVICE_TIMEZONE): string {
  const start = DateTime.fromJSDate(slot.startTime).setZone(timezone);
  const end = DateTime.fromJSDate(slot.endTime).setZone(timezone);

  const overlapMinutes = (windowStartHour: number, windowEndHour: number) => {
    const winStart = start.set({ hour: Math.floor(windowStartHour), minute: (windowStartHour % 1) * 60, second: 0, millisecond: 0 });
    const winEnd = start.set({ hour: Math.floor(windowEndHour), minute: (windowEndHour % 1) * 60, second: 0, millisecond: 0 });
    const overlapStart = start > winStart ? start : winStart;
    const overlapEnd = end < winEnd ? end : winEnd;
    return Math.max(0, overlapEnd.diff(overlapStart, 'minutes').minutes);
  };

  const lunchOverlap = overlapMinutes(11.5, 13.5);
  const dinnerOverlap = overlapMinutes(DINNER_WINDOW_START_HOUR, DINNER_WINDOW_END_HOUR);

  if (lunchOverlap >= 30 && lunchOverlap >= dinnerOverlap) return 'Lunch Break';
  if (dinnerOverlap >= 30) return 'Evening';
  return 'Free Time';
}

/**
 * Splits a free-time slot into one proposal per suggestion type instead of a single flat
 * list — an evening slot long enough to fit both should propose an activity AND a dinner,
 * not just whichever the slot's start time happens to classify as. Typed as an array of
 * { type, ... } rather than a hardcoded pair so a future 'show' (post-dinner) type can be
 * appended later without restructuring callers — see docs on the Event taxonomy's
 * venue-vs-schedule gap for why that third type isn't built yet.
 *
 * Splits only when the slot both overlaps the dinner window by a meaningful amount and is
 * long enough overall that carving out a dinner portion still leaves a real activity portion
 * — short slots or slots that don't reach dinner time at all (e.g. an afternoon gap) are
 * returned unchanged as a single 'activity' proposal, i.e. today's behavior.
 */
export interface SlotProposal {
  type: 'activity' | 'meal';
  label: string;
  icon: string;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
}

export function expandSlotForProposals(slot: FreeTimeSlot, timezone: string = DEVICE_TIMEZONE): SlotProposal[] {
  const start = DateTime.fromJSDate(slot.startTime).setZone(timezone);
  const end = DateTime.fromJSDate(slot.endTime).setZone(timezone);

  const dinnerWindowStart = start.set({ hour: 18, minute: 30, second: 0, millisecond: 0 });
  const dinnerWindowEnd = start.set({ hour: 21, minute: 0, second: 0, millisecond: 0 });

  const dinnerStart = start > dinnerWindowStart ? start : dinnerWindowStart;
  const dinnerEnd = end < dinnerWindowEnd ? end : dinnerWindowEnd;
  const dinnerOverlapMinutes = Math.max(0, dinnerEnd.diff(dinnerStart, 'minutes').minutes);

  const asActivity = (): SlotProposal[] => [{
    type: 'activity',
    label: slot.label || labelFreeSlot(slot, timezone),
    icon: '🌙',
    startTime: slot.startTime,
    endTime: slot.endTime,
    durationMinutes: slot.durationMinutes
  }];

  if (dinnerOverlapMinutes < 45 || slot.durationMinutes < 150) {
    return asActivity();
  }

  const activityEnd = dinnerStart;
  const activityDurationMinutes = Math.min(180, Math.floor(activityEnd.diff(start, 'minutes').minutes));
  if (activityDurationMinutes < 45) {
    // Carving out dinner would leave too little of an activity window to bother splitting.
    return asActivity();
  }

  return [
    {
      type: 'activity',
      label: 'Activity',
      icon: '🎭',
      startTime: start.toJSDate(),
      endTime: start.plus({ minutes: activityDurationMinutes }).toJSDate(),
      durationMinutes: activityDurationMinutes
    },
    {
      type: 'meal',
      label: 'Dinner',
      icon: '🍽️',
      startTime: dinnerStart.toJSDate(),
      endTime: dinnerEnd.toJSDate(),
      // Capped at 120: buildCategoryFilter (lib/place-matching.ts) only guarantees a
      // Restaurant-only result when mealWindow && durationMinutes <= 120 — anything longer
      // falls through to an unfiltered match, defeating the point of a dedicated Dinner row.
      durationMinutes: Math.min(120, Math.round(dinnerOverlapMinutes))
    }
  ];
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
 */
export function getHardcodedFreeSlots(date: Date, timezone: string = DEVICE_TIMEZONE): FreeTimeSlot[] {
  const zonedDate = DateTime.fromJSDate(date).setZone(timezone);
  const isWeekend = zonedDate.weekday === 6 || zonedDate.weekday === 7; // luxon: 6 = Sat, 7 = Sun
  const now = DateTime.now().setZone(timezone);
  const isToday = zonedDate.hasSame(now, 'day');

  if (isWeekend) {
    let start = zonedDate.set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
    const end = zonedDate.set({ hour: 22, minute: 0, second: 0, millisecond: 0 });

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

  const lunchStart = zonedDate.set({ hour: 12, minute: 0, second: 0, millisecond: 0 });
  const lunchEnd = zonedDate.set({ hour: 13, minute: 30, second: 0, millisecond: 0 });

  if (!isToday || now < lunchEnd) {
    const start = (isToday && now > lunchStart) ? now : lunchStart;
    const duration = Math.floor(lunchEnd.diff(start, 'minutes').minutes);
    if (duration >= 30) {
      slots.push({ startTime: start.toJSDate(), endTime: lunchEnd.toJSDate(), durationMinutes: duration, label: 'Lunch Break' });
    }
  }

  const eveningStart = zonedDate.set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
  const eveningEnd = zonedDate.set({ hour: 22, minute: 0, second: 0, millisecond: 0 });

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
 */
export function getTripDaySchedule(
  startDate: Date,
  endDate: Date,
  maxDays = 5,
  timezone: string = DEVICE_TIMEZONE,
  importedEvents: CalendarEvent[] = []
): DaySchedule[] {
  const days: DaySchedule[] = [];
  let current = DateTime.fromJSDate(startDate).setZone(timezone).startOf('day');
  const end = DateTime.fromJSDate(endDate).setZone(timezone).endOf('day');

  let count = 0;
  while (current <= end && count < maxDays) {
    const isWeekend = current.weekday === 6 || current.weekday === 7;
    const dayLabel = current.toFormat('EEE, MMM d');

    const dayEvents = importedEvents.filter(e =>
      DateTime.fromJSDate(e.startTime).setZone(timezone).hasSame(current, 'day')
    );

    const freeSlots = dayEvents.length > 0
      ? calculateFreeTimeSlots(dayEvents, 8, 22, 60, timezone).map(slot => ({
          ...slot,
          label: labelFreeSlot(slot, timezone)
        }))
      : getHardcodedFreeSlots(current.toJSDate(), timezone);

    days.push({
      date: current.toJSDate(),
      dayLabel,
      isWeekend,
      freeSlots,
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
