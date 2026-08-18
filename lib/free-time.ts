import { DateTime } from 'luxon';
import { DEVICE_TIMEZONE } from './timezones';

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
 */
export function getTripDaySchedule(
  startDate: Date,
  endDate: Date,
  maxDays = 5,
  timezone: string = DEVICE_TIMEZONE
): DaySchedule[] {
  const days: DaySchedule[] = [];
  let current = DateTime.fromJSDate(startDate).setZone(timezone).startOf('day');
  const end = DateTime.fromJSDate(endDate).setZone(timezone).endOf('day');

  let count = 0;
  while (current <= end && count < maxDays) {
    const isWeekend = current.weekday === 6 || current.weekday === 7;
    const dayLabel = current.toFormat('EEE, MMM d');

    days.push({
      date: current.toJSDate(),
      dayLabel,
      isWeekend,
      freeSlots: getHardcodedFreeSlots(current.toJSDate(), timezone),
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
