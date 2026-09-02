import React, { createContext, useContext, ReactNode } from 'react';
import { apiFetch, API_URL } from '@/lib/api-client';
import { guessTimezoneForCity } from '@/lib/timezones';
import { TripMock } from '@/lib/trip-types';
import { useSyncedCollection } from './useSyncedCollection';

// Step 5 (last) of the useAuth.tsx split (see docs/useauth-split-plan.md) — last because
// `trips` is read by index.tsx (Home tab's active-trip city fallback) in addition to
// trips.tsx, one more consumer than contacts/events had.
//
// The AsyncStorage-load / server-sync-effect / diff-based create-update-delete machinery
// below is shared with hooks/useContacts.tsx via useSyncedCollection.ts (see
// CHANGELOG.md's cleanliness-audit entry) — this file only owns what's actually
// trip-specific: the shape of a trip, its diff/payload rules, and toggleDismissedSlot.

// The normalized shape every trip is in once it's passed through parseServerTrips (or the
// AsyncStorage cache-load path below) — what app screens actually work with, as opposed to
// the raw server document. Extends TripMock (lib/trip-types.ts, the same shape
// app/(tabs)/trips.tsx's components already expect) with the raw `_id` and an index
// signature, since both parse paths spread the raw server/cached object first (`...t`)
// before overriding the fields below, so a few server-only fields (e.g. `created_by`) ride
// along unmodeled.
export interface ClientTrip extends TripMock {
  _id?: string;
  [key: string]: any;
}

interface TripsContextType {
  trips: ClientTrip[];
  setTrips: (trips: ClientTrip[]) => void;
  // Server-authoritative, so deliberately NOT routed through setTrips — that triggers the
  // full create/update sync-diff machinery meant for user-edited fields (destination, dates),
  // which this isn't. Patches only the one trip's dismissedSlots in local state after the API
  // call succeeds.
  toggleDismissedSlot: (tripId: string, slotKey: string, dismissed: boolean) => Promise<void>;
}

const TripsContext = createContext<TripsContextType>({
  trips: [],
  setTrips: () => {},
  toggleDismissedSlot: async () => {}
});

export const useTrips = () => useContext(TripsContext);

const parseServerTrips = (tripsData: any[]): ClientTrip[] =>
  tripsData.map((t: any) => ({
    ...t,
    id: t._id,
    startDate: new Date(t.start_date),
    endDate: new Date(t.end_date),
    timezone: t.timezone || guessTimezoneForCity(t.destination),
    sharedWithCircles: t.sharedWithCircles || [],
    dismissedSlots: t.dismissedSlots || []
  }));

const parseCachedTrip = (t: any): ClientTrip => ({
  ...t,
  startDate: new Date(t.startDate),
  endDate: new Date(t.endDate),
  timezone: t.timezone || guessTimezoneForCity(t.destination),
  sharedWithCircles: t.sharedWithCircles || []
  // events live in their own collection now, fetched separately per trip
});

const tripHasChanged = (ot: ClientTrip, nt: ClientTrip) =>
  ot.destination !== nt.destination ||
  new Date(ot.startDate).getTime() !== new Date(nt.startDate).getTime() ||
  new Date(ot.endDate).getTime() !== new Date(nt.endDate).getTime() ||
  ot.timezone !== nt.timezone ||
  JSON.stringify(ot.sharedWithCircles || []) !== JSON.stringify(nt.sharedWithCircles || []) ||
  JSON.stringify(ot.baseLocations || []) !== JSON.stringify(nt.baseLocations || []);

const buildTripBody = (t: ClientTrip) => ({
  destination: t.destination,
  startDate: t.startDate,
  endDate: t.endDate,
  timezone: t.timezone,
  sharedWithCircles: t.sharedWithCircles || [],
  baseLocations: t.baseLocations || []
});

export const TripsProvider = ({ children }: { children: ReactNode }) => {
  const { items: trips, setItems: setTrips, replaceItems } = useSyncedCollection<ClientTrip>({
    storageKey: '@trips',
    apiPath: '/api/trips',
    entityLabel: 'trip',
    emptyState: [],
    parseCached: parseCachedTrip,
    parseServer: parseServerTrips,
    canSyncForDelete: (id) => !id.startsWith('mock_'),
    hasChanged: tripHasChanged,
    buildCreateBody: (t, userId) => ({ userId, ...buildTripBody(t) }),
    buildUpdateBody: buildTripBody
  });

  const toggleDismissedSlot = async (tripId: string, slotKey: string, dismissed: boolean) => {
    try {
      const res = dismissed
        ? await apiFetch(`${API_URL}/api/trips/${tripId}/dismissed-slots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slotKey })
          })
        : await apiFetch(`${API_URL}/api/trips/${tripId}/dismissed-slots/${encodeURIComponent(slotKey)}`, { method: 'DELETE' });
      if (!res.ok) return;
      const { dismissedSlots } = await res.json();
      replaceItems(prev => prev.map(t => (t.id === tripId || t._id === tripId) ? { ...t, dismissedSlots } : t));
    } catch (err) {
      console.warn('Failed to toggle dismissed slot:', err);
    }
  };

  return (
    <TripsContext.Provider value={{ trips, setTrips, toggleDismissedSlot }}>
      {children}
    </TripsContext.Provider>
  );
};
