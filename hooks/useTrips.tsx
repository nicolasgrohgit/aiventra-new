import React, { createContext, useContext, useState, ReactNode, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch, API_URL } from '@/lib/api-client';
import { guessTimezoneForCity } from '@/lib/timezones';
import { queueMutation, flushMutationQueue } from '@/lib/mutation-queue';
import { useMutationQueueFlush } from './useMutationQueueFlush';
import { useAuth } from './useAuth';

// Step 5 (last) of the useAuth.tsx split (see docs/useauth-split-plan.md) — last because
// `trips` is read by index.tsx (Home tab's active-trip city fallback) in addition to
// trips.tsx, one more consumer than contacts/events had.

interface TripsContextType {
  trips: any[];
  setTrips: (trips: any[]) => void;
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

const parseServerTrips = (tripsData: any[]) =>
  tripsData.map((t: any) => ({
    ...t,
    id: t._id,
    startDate: new Date(t.start_date),
    endDate: new Date(t.end_date),
    timezone: t.timezone || guessTimezoneForCity(t.destination),
    sharedWithCircles: t.sharedWithCircles || [],
    dismissedSlots: t.dismissedSlots || []
  }));

export const TripsProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  useMutationQueueFlush();
  const [trips, setTripsState] = useState<any[]>([]);
  // Guards the sync-from-server effect below against re-running for the same user across
  // unrelated re-renders — should fire once per actual login/logout transition.
  const lastSyncedUserId = useRef<string | null>(null);

  // Offline-first: load whatever's cached locally immediately, independent of auth state.
  useEffect(() => {
    (async () => {
      try {
        const storedTrips = await AsyncStorage.getItem('@trips');
        if (storedTrips) {
          const parsedTrips = JSON.parse(storedTrips).map((t: any) => ({
            ...t,
            startDate: new Date(t.startDate),
            endDate: new Date(t.endDate),
            timezone: t.timezone || guessTimezoneForCity(t.destination),
            sharedWithCircles: t.sharedWithCircles || []
          })); // events live in their own collection now, fetched separately per trip
          setTripsState(parsedTrips);
        }
      } catch (e) {
        console.error('Failed to load cached trips', e);
      }
    })();
  }, []);

  // Reacts to auth state: sync from server once we know who's logged in; clear on logout.
  useEffect(() => {
    const userId = user?._id || user?.id;

    if (!userId) {
      if (lastSyncedUserId.current !== null) {
        setTripsState([]);
        AsyncStorage.removeItem('@trips');
        lastSyncedUserId.current = null;
      }
      return;
    }

    if (String(userId).startsWith('mock_') || lastSyncedUserId.current === userId) return;
    lastSyncedUserId.current = userId;

    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/api/trips?userId=${userId}`);
        if (!res.ok) return;
        const parsedTrips = parseServerTrips(await res.json());
        setTripsState(parsedTrips);
        await AsyncStorage.setItem('@trips', JSON.stringify(parsedTrips));
      } catch (err) {
        console.warn("Could not sync trips with backend server. Offline mode active:", err);
      }
    })();
  }, [user?._id, user?.id]);

  const setTrips = async (newTrips: any[]) => {
    setTripsState(newTrips);
    AsyncStorage.setItem('@trips', JSON.stringify(newTrips)).catch((e) => console.error('Failed to save trips', e));

    if (!user) return;
    const userId = user._id || user.id;
    if (!userId || String(userId).startsWith('mock_')) return;

    // Retry anything left over from a previous dropped connection before layering a new sync
    // on top of it.
    await flushMutationQueue().catch((e) => console.warn('Mutation queue flush failed:', e));

    const oldTrips = trips;

    // 1. Delete trips that are no longer present. Each call is isolated (its own try/catch)
    // so one failure doesn't abort the rest of the batch — previously the whole sync was one
    // try/catch, so a single dropped connection meant every subsequent mutation in this call
    // silently never even got attempted.
    const deletedTrips = oldTrips.filter(ot => !newTrips.some(nt => nt.id === ot.id || nt._id === ot._id));
    for (const t of deletedTrips) {
      const id = t._id || t.id;
      if (id && !String(id).startsWith('mock_')) {
        try {
          await apiFetch(`${API_URL}/api/trips/${id}`, { method: 'DELETE' });
        } catch (err) {
          console.warn(`Failed to delete trip ${id}, queuing for retry:`, err);
          await queueMutation(`trip:${id}`, { method: 'DELETE', url: `${API_URL}/api/trips/${id}` });
        }
      }
    }

    // 2. Add or update trips
    for (const nt of newTrips) {
      const isNew = !oldTrips.some(ot => ot.id === nt.id || ot._id === nt._id);
      if (isNew) {
        try {
          await apiFetch(`${API_URL}/api/trips`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              destination: nt.destination,
              startDate: nt.startDate,
              endDate: nt.endDate,
              timezone: nt.timezone,
              sharedWithCircles: nt.sharedWithCircles || []
            })
          });
        } catch (err) {
          // Not queued for retry — see lib/mutation-queue.ts: replaying a failed create
          // safely needs a server-side idempotency key to avoid double-creating the trip,
          // which is separate, larger scope than this pass. Same behavior as before.
          console.warn(`Failed to create trip (not retried, see lib/mutation-queue.ts):`, err);
        }
      } else {
        // Check if updated
        const ot = oldTrips.find(o => o.id === nt.id || o._id === nt._id);
        const hasChanged = ot && (
          ot.destination !== nt.destination ||
          new Date(ot.startDate).getTime() !== new Date(nt.startDate).getTime() ||
          new Date(ot.endDate).getTime() !== new Date(nt.endDate).getTime() ||
          ot.timezone !== nt.timezone ||
          JSON.stringify(ot.sharedWithCircles || []) !== JSON.stringify(nt.sharedWithCircles || [])
        );
        if (hasChanged) {
          const id = nt._id || nt.id;
          if (id && !String(id).startsWith('mock_')) {
            const body = {
              destination: nt.destination,
              startDate: nt.startDate,
              endDate: nt.endDate,
              timezone: nt.timezone,
              sharedWithCircles: nt.sharedWithCircles || []
            };
            try {
              await apiFetch(`${API_URL}/api/trips/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
              });
            } catch (err) {
              console.warn(`Failed to update trip ${id}, queuing for retry:`, err);
              await queueMutation(`trip:${id}`, { method: 'PUT', url: `${API_URL}/api/trips/${id}`, body });
            }
          }
        }
      }
    }

    // Refetch trips to sync IDs
    try {
      const res = await apiFetch(`${API_URL}/api/trips?userId=${userId}`);
      if (res.ok) {
        const parsedTrips = parseServerTrips(await res.json());
        setTripsState(parsedTrips);
        AsyncStorage.setItem('@trips', JSON.stringify(parsedTrips)).catch((e) => console.error('Failed to save trips', e));
      }
    } catch (err) {
      console.warn("Failed to refetch trips after sync:", err);
    }
  };

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
      setTripsState(prev => {
        const updated = prev.map(t => (t.id === tripId || t._id === tripId) ? { ...t, dismissedSlots } : t);
        AsyncStorage.setItem('@trips', JSON.stringify(updated)).catch((e) => console.error('Failed to save trips', e));
        return updated;
      });
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
