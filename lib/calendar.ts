import * as Calendar from 'expo-calendar';
import {
  CalendarEvent,
  FreeTimeSlot,
  DaySchedule,
  SlotProposal,
  calculateFreeTimeSlots,
  getHardcodedFreeSlots,
  getTripDaySchedule,
  labelFreeSlot,
  expandSlotForProposals,
  generateMockEventsForToday,
} from './free-time';

// The pure free-time-slot math lives in lib/free-time.ts (kept RN-independent so it's
// testable in plain Node — this file can't be, since expo-calendar transitively pulls in
// react-native). Re-exported here so existing `@/lib/calendar` imports are unaffected.
export type { CalendarEvent, FreeTimeSlot, DaySchedule, SlotProposal };
export { calculateFreeTimeSlots, getHardcodedFreeSlots, getTripDaySchedule, labelFreeSlot, expandSlotForProposals, generateMockEventsForToday };

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

/**
 * Fetch device calendar events for an arbitrary date range — used to opportunistically sync
 * a trip's actual dates (not just "today") into Event documents with source: 'imported' (see
 * POST /api/trips/:tripId/events/import in server.ts). Deliberately does NOT prompt for
 * permission — only reads if calendar access is already granted, since this sync is a
 * background nicety triggered from viewing/creating a trip, not something that should
 * interrupt that flow with a fresh permission dialog. Returns [] if not granted, on any
 * calendar with no readable calendars, or on error.
 */
export async function getDeviceEventsForDateRange(startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
  try {
    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status !== 'granted') return [];

    const allCalendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const calendarIds = allCalendars.map(c => c.id);
    if (calendarIds.length === 0) return [];

    const deviceEvents = await Calendar.getEventsAsync(calendarIds, startDate, endDate);

    return deviceEvents.map(evt => ({
      id: evt.id,
      title: evt.title,
      startTime: new Date(evt.startDate),
      endTime: new Date(evt.endDate),
      location: evt.location,
    }));
  } catch (error) {
    console.warn("Failed to fetch native calendar events for range: ", error);
    return [];
  }
}
