import * as Calendar from 'expo-calendar';
import {
  CalendarEvent,
  FreeTimeSlot,
  DaySchedule,
  SlotProposal,
  MealTimePreferences,
  calculateFreeTimeSlots,
  getHardcodedFreeSlots,
  getTripDaySchedule,
  labelFreeSlot,
  expandSlotForProposals,
  generateMockEventsForToday,
} from './free-time';
import { classifyImportedEvent, inferTripFromSignals, ClassifiedSignal, InferredTrip } from './calendar-signals';

// The pure free-time-slot math lives in lib/free-time.ts (kept RN-independent so it's
// testable in plain Node — this file can't be, since expo-calendar transitively pulls in
// react-native). Re-exported here so existing `@/lib/calendar` imports are unaffected.
export type { CalendarEvent, FreeTimeSlot, DaySchedule, SlotProposal, MealTimePreferences, InferredTrip };
export { calculateFreeTimeSlots, getHardcodedFreeSlots, getTripDaySchedule, labelFreeSlot, expandSlotForProposals, generateMockEventsForToday };

// Google Calendar's "Working Location" feature auto-creates an all-day event every workday
// (title exactly "Home", "Office", or "Working elsewhere[: <custom place>]") to show where
// you're working from — live-reported as silently zeroing out several consecutive days of a
// trip's free-time proposals, because it synced through the three device-calendar readers
// below like any other all-day event and got treated as a literal 24h busy block. Unlike a
// real all-day event (a public holiday, an out-of-office banner — see getTripDaySchedule's
// holidayEvents handling), a Working Location marker carries no information relevant to a
// *future* trip: it reflects a habitual daily status the user may well not have thought to
// change yet for days they'll actually be travelling, so it's dropped entirely — excluded
// from busy-time calculation AND never surfaced in the UI — rather than shown as a banner
// like a genuine all-day event. There's no dedicated event-type field for this coming out of
// expo-calendar's cross-platform device-calendar bridge (unlike Google's own Calendar API,
// which does expose eventType: 'workingLocation' — not what this app reads), so detection is
// necessarily by title, matching Google's own fixed, documented set of values.
function isWorkingLocationEvent(evt: { allDay?: boolean; title?: string }): boolean {
  if (!evt.allDay || !evt.title) return false;
  const title = evt.title.trim().toLowerCase();
  return title === 'home' || title === 'office' || title.startsWith('working elsewhere');
}

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

      return deviceEvents
        .filter(evt => !isWorkingLocationEvent(evt))
        .map(evt => ({
          id: evt.id,
          title: evt.title,
          startTime: new Date(evt.startDate),
          endTime: new Date(evt.endDate),
          // expo-calendar 15.x types Event.location as `string | null` (was effectively
          // optional before); normalize to undefined to match this app's CalendarEvent shape.
          location: evt.location ?? undefined,
          allDay: evt.allDay,
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

    return deviceEvents
      .filter(evt => !isWorkingLocationEvent(evt))
      .map(evt => ({
        id: evt.id,
        title: evt.title,
        startTime: new Date(evt.startDate),
        endTime: new Date(evt.endDate),
        // expo-calendar 15.x types Event.location as `string | null` (was effectively
        // optional before); normalize to undefined to match this app's CalendarEvent shape.
        location: evt.location ?? undefined,
        allDay: evt.allDay,
      }));
  } catch (error) {
    console.warn("Failed to fetch native calendar events for range: ", error);
    return [];
  }
}

/**
 * Proactive trip discovery — see docs/auto-trip-discovery-plan.md Parts A/B. Unlike
 * getDeviceEventsForDateRange above, this is the one calendar read in the app allowed to run
 * BEFORE the user has told it anything about a trip, so every caller is responsible for
 * gating it behind its own explicit trigger (first calendar-connect opt-in, a throttled
 * foreground check, or a manual pull-to-refresh — see app/(tabs)/index.tsx and
 * app/(tabs)/trips.tsx) rather than calling it unconditionally.
 *
 * Reads every device calendar event from now through `daysAhead` days out, classifies each one
 * (classifyImportedEvent, lib/calendar-signals.ts) and hands the flight/lodging hits to the
 * pure inferTripFromSignals to produce trip suggestions. `daysAhead` is a real parameter, not a
 * fixed default, because callers use two different widths: ~30 days for the permission-grant
 * and weekly-foreground paths, ~7 days for the trips-tab pull-to-refresh (a narrower, cheaper
 * window appropriate for an explicit "check right now" action).
 *
 * Deliberately does NOT prompt for permission (same reasoning as getDeviceEventsForDateRange)
 * — every caller only ever invokes this after calendar access is already granted (path 1 calls
 * it immediately after its own requestCalendarPermissionsAsync succeeds). Fails safe on any
 * error (a malformed event that throws mid-classification, a permission read that errors) by
 * returning an empty array rather than aborting a caller's own refresh flow.
 */
export async function scanForUpcomingTripSignals(daysAhead: number): Promise<InferredTrip[]> {
  try {
    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status !== 'granted') return [];

    const allCalendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const calendarIds = allCalendars.map(c => c.id);
    if (calendarIds.length === 0) return [];

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const deviceEvents = await Calendar.getEventsAsync(calendarIds, startDate, endDate);

    const signals: ClassifiedSignal[] = [];
    for (const evt of deviceEvents) {
      if (isWorkingLocationEvent(evt)) continue;
      try {
        const event: CalendarEvent = {
          id: evt.id,
          title: evt.title,
          startTime: new Date(evt.startDate),
          endTime: new Date(evt.endDate),
          // expo-calendar 15.x types Event.location as `string | null` (was effectively
          // optional before); normalize to undefined to match this app's CalendarEvent shape.
          location: evt.location ?? undefined,
        };
        const signal = classifyImportedEvent(event);
        if (signal && (signal.kind === 'flight' || signal.kind === 'lodging')) {
          signals.push({ event, signal });
        }
      } catch (error) {
        // One malformed event shouldn't sink the whole scan — skip it and keep going.
        console.warn('Skipping unclassifiable calendar event during trip discovery scan:', error);
      }
    }

    return inferTripFromSignals(signals);
  } catch (error) {
    console.warn('Trip discovery scan failed:', error);
    return [];
  }
}
