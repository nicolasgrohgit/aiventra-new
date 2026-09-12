// Shared trip/event shapes and small display helpers used by both app/(tabs)/trips.tsx and
// the extracted components/trips/* components (PlaceCard, RefineSearchCard, ContactPicker —
// see components/trips/place-card.tsx and friends). Pulled out specifically so those
// components can import these types/helpers without creating a circular import back into
// trips.tsx itself.

import { DateTime } from 'luxon';
import { API_URL } from './api-client';
import { DEVICE_TIMEZONE } from './timezones';

export interface EventParticipant {
  user_id: string;
  invited_by: string;
  status: 'pending' | 'accepted' | 'declined';
}

export interface TripEvent {
  _id: string;
  trip_id: string;
  created_by: string;
  source: 'created' | 'imported';
  title: string;
  start_time: string;
  end_time: string;
  place_id?: string;
  place_name?: string;
  // Real venue/address text — present on both 'created' events (an optional free-text field
  // at creation) and 'imported' ones (the device calendar event's own location). Used by
  // lib/calendar-signals.ts's classifyImportedEvent (flight/ground-transit/lodging/dining
  // detection) and, for a dining-classified imported event, to build its Navigate action the
  // same way a real Place's address does (see components/trips/calendar-event-card.tsx).
  location?: string;
  participants: EventParticipant[];
  // 'imported' only — true for a device-calendar event flagged all-day (a public holiday, an
  // out-of-office banner). See lib/calendar.ts's isWorkingLocationEvent for why a Working
  // Location marker never reaches here at all, and lib/free-time.ts's getTripDaySchedule for
  // how this is excluded from busy-time calculation but still shown as that day's event.
  allDay?: boolean;
}

// The shape GET /api/events/invited actually returns: `created_by` comes back populated
// (organizer full_name/avatar_url, so invite cards can render "Invited by <name>") rather
// than as the bare id string every other event endpoint returns. A distinct type instead of
// widening TripEvent.created_by itself, since every other event fetch (fetchTripEvents,
// createEvent, ...) genuinely still returns a plain id string.
export interface InvitedTripEvent extends Omit<TripEvent, 'created_by'> {
  created_by: {
    _id: string;
    full_name: string;
    avatar_url?: string;
  };
}

export interface TripBaseLocation {
  label: string;
  lat: number;
  lng: number;
  source: 'hotel' | 'city';
  startDate: string;
  endDate: string;
}

export interface TripMock {
  id: string;
  destination: string;
  startDate: Date;
  endDate: Date;
  timezone: string;
  sharedWithCircles: string[];
  dismissedSlots?: string[];
  baseLocations?: TripBaseLocation[];
}

// Sub-kilometer distances read as more useful in meters ("450m away" vs "0.5km away") — matches
// how a "near your hotel" walkable distance is actually judged.
export const formatDistanceLabel = (km: number) => (km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`);

// A trip is "past" starting the calendar day right after it ends (in its own destination
// timezone, not the device's) — deliberately not stored anywhere (no status/archived field on
// the Trip model): derived fresh every time from `endDate`, so it applies retroactively to
// every trip already in the DB with zero backfill/migration, and never goes stale. See
// app/(tabs)/trips.tsx's Current/Past segmented control, the only caller today.
export function isTripPast(endDate: Date, timezone: string = DEVICE_TIMEZONE, referenceDate: Date = new Date()): boolean {
  const cutoff = DateTime.fromJSDate(endDate).setZone(timezone).startOf('day').plus({ days: 1 });
  return DateTime.fromJSDate(referenceDate).setZone(timezone) >= cutoff;
}

// Every card/detail-modal thumbnail points at this same server-side proxy (never at
// googleapis.com directly) — see GET /api/places/:id/photo in server.ts for why: resolving a
// Google photoRef into real image bytes needs GOOGLE_PLACES_API_KEY, which must never leave
// the server. Only call this when place.hasPhoto is true — the endpoint 404s otherwise.
export const placePhotoUri = (placeId: string) => `${API_URL}/api/places/${placeId}/photo`;
