import * as Calendar from 'expo-calendar';
import {
  CalendarEvent,
  FreeTimeSlot,
  DaySchedule,
  calculateFreeTimeSlots,
  getHardcodedFreeSlots,
  getTripDaySchedule,
  generateMockEventsForToday,
} from './free-time';

// The pure free-time-slot math lives in lib/free-time.ts (kept RN-independent so it's
// testable in plain Node — this file can't be, since expo-calendar transitively pulls in
// react-native). Re-exported here so existing `@/lib/calendar` imports are unaffected.
export type { CalendarEvent, FreeTimeSlot, DaySchedule };
export { calculateFreeTimeSlots, getHardcodedFreeSlots, getTripDaySchedule, generateMockEventsForToday };

/**
 * Request permission and fetch actual device events for today.
 */
export async function getDeviceEventsForToday(useSimulatedIfDenied = false): Promise<CalendarEvent[]> {
  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status === 'granted') {
      const allCalendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      // Filter out calendars that probably aren't what we want (e.g. holiday or birthday calendars if you want strictness),
      // For now, let's just grab all default user calendars that can be read.
      const calendarIds = allCalendars.map(c => c.id);

      if (calendarIds.length === 0) {
        return useSimulatedIfDenied ? generateMockEventsForToday() : [];
      }

      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date();
      endDate.setHours(23, 59, 59, 999);

      const deviceEvents = await Calendar.getEventsAsync(calendarIds, startDate, endDate);

      return deviceEvents.map(evt => ({
        id: evt.id,
        title: evt.title,
        startTime: new Date(evt.startDate),
        endTime: new Date(evt.endDate),
        location: evt.location,
      }));
    }
  } catch (error) {
    console.warn("Failed to fetch native calendar events: ", error);
  }

  return useSimulatedIfDenied ? generateMockEventsForToday() : [];
}
