import React, { createContext, useContext, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch, API_URL } from '@/lib/api-client';
import { scanForUpcomingTripSignals, InferredTrip } from '@/lib/calendar';
import { useAuth } from './useAuth';
import { useTrips, ClientTrip } from './useTrips';

// Proactive trip-discovery feature — see docs/auto-trip-discovery-plan.md. Split into its own
// provider (rather than folded into useAuth.tsx or useTrips.tsx) matching this codebase's
// established one-hook-per-concern convention (docs/useauth-split-plan.md): this owns exactly
// the suggestion/dismissal/scan-trigger state for this one feature, even though it reads
// `user` (for the lastAppAccess 7-day gate) and `trips` (for the "already have a matching
// trip" overlap check) from its own two sibling providers.
//
// Nested inside TripsProvider in app/_layout.tsx (needs `trips`), itself a leaf no other
// provider depends on. Three trigger paths call into this, per the design doc:
//   1. First calendar-permission grant (app/(tabs)/index.tsx's handleConnectCalendar) —
//      handleFirstCalendarGrant() below: an immediate ~30-day scan + starts the server-side
//      lastAppAccess counter.
//   2. App foreground, gated on that counter — the AppState effect below: only re-runs the
//      ~30-day scan (and resets the counter) once 7+ days have elapsed.
//   3. Pull-to-refresh on the trips tab (app/(tabs)/trips.tsx's handlePullRefresh) —
//      runDiscoveryScan(7) directly: narrower, and deliberately does NOT touch the counter.

const DISMISSED_STORAGE_KEY = '@dismissedTripSuggestions';
const FOREGROUND_SCAN_DAYS_AHEAD = 30;
const FOREGROUND_RESCAN_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

interface TripDiscoveryContextType {
  // The one suggestion currently worth surfacing on the Home tab, or null. At most one at a
  // time by design — a scan finding several candidates just means the soonest-upcoming one
  // wins; the rest resurface on a later scan once this one's been accepted/dismissed.
  suggestion: InferredTrip | null;
  // "Not this time" — persists every one of the suggestion's sourceEventIds to
  // @dismissedTripSuggestions (so none of its anchoring signals re-surface a suggestion later)
  // and clears it from state.
  dismissSuggestion: () => void;
  // "Add this trip": moves the current suggestion into `pendingProposal` (for
  // app/(tabs)/trips.tsx to pick up and prefill its create-trip modal from — see below) and
  // clears it from `suggestion` so the Home-tab card disappears. Deliberately does NOT persist
  // a dismissal — if the user opens the create-trip modal and cancels without saving, the same
  // signal is free to resurface on a later scan; only an explicit "Not this time" permanently
  // suppresses it.
  acceptSuggestion: () => void;
  // A one-shot handoff from index.tsx's "Add this trip" to trips.tsx's create-trip modal —
  // two different tab screens (both kept mounted in the background per this app's existing tab
  // behavior) can't share local component state directly, so it rides through this shared
  // provider instead of, say, serializing dates/coordinates through router params.
  // trips.tsx must call consumePendingProposal() once it's read this, or it'll re-trigger the
  // prefill+open-modal effect on every future focus.
  pendingProposal: InferredTrip | null;
  consumePendingProposal: () => void;
  // Runs a scan at the given width and sets `suggestion` if it finds a new, not-dismissed,
  // not-already-covered-by-an-existing-trip candidate. Used directly by path 3
  // (pull-to-refresh) and internally by paths 1/2.
  runDiscoveryScan: (daysAhead: number) => Promise<void>;
  // Path 1 only: runs the ~30-day scan AND starts the lastAppAccess counter server-side.
  handleFirstCalendarGrant: () => Promise<void>;
}

const notReady = async () => {};

const TripDiscoveryContext = createContext<TripDiscoveryContextType>({
  suggestion: null,
  dismissSuggestion: () => {},
  acceptSuggestion: () => {},
  pendingProposal: null,
  consumePendingProposal: () => {},
  runDiscoveryScan: notReady,
  handleFirstCalendarGrant: notReady,
});

export const useTripDiscovery = () => useContext(TripDiscoveryContext);

// Loose "same rough destination" check, same spirit as trips.tsx's own isHomeTurf: both a
// Trip's destination and an InferredTrip's destination are either a "City, Country" string
// (from the destination-city autocomplete, or this feature's own IATA-resolved city) or, for
// a lodging-only suggestion, a raw hotel/venue name — so an exact match is too strict and a
// bare substring check in either direction is the pragmatic middle ground.
function destinationsRoughlyMatch(a: string, b: string): boolean {
  const na = a.split(',')[0].trim().toLowerCase();
  const nb = b.split(',')[0].trim().toLowerCase();
  return !!na && !!nb && (na === nb || na.includes(nb) || nb.includes(na));
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() <= bEnd.getTime() && bStart.getTime() <= aEnd.getTime();
}

// Part D of the design doc: don't surface a suggestion for a trip the user already has.
function hasMatchingExistingTrip(inferred: InferredTrip, trips: ClientTrip[]): boolean {
  return trips.some(t =>
    destinationsRoughlyMatch(t.destination, inferred.destination) &&
    rangesOverlap(new Date(t.startDate), new Date(t.endDate), inferred.startDate, inferred.endDate)
  );
}

async function readDismissedIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(DISMISSED_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn('Failed to read dismissed trip suggestions:', err);
    return [];
  }
}

export const TripDiscoveryProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { trips } = useTrips();
  const [suggestion, setSuggestion] = useState<InferredTrip | null>(null);
  const [pendingProposal, setPendingProposal] = useState<InferredTrip | null>(null);

  // Local override for the server-recorded lastAppAccess counter — updated the instant a scan
  // successfully resets it, so a long-lived session doesn't keep re-triggering the ~30-day
  // scan on every single foreground event just because `user` (refreshed only occasionally,
  // see useAuth.tsx's syncProfileFromServer) hasn't caught up yet. Re-seeded from the server
  // value whenever the logged-in user's identity actually changes (login/logout/switch), not
  // on every `user` object update.
  const lastAppAccessRef = useRef<number | null>(null);
  useEffect(() => {
    lastAppAccessRef.current = user?.lastAppAccess ? new Date(user.lastAppAccess).getTime() : null;
  }, [user?._id, user?.id]);

  const notifyAppAccess = useCallback(async () => {
    try {
      await apiFetch(`${API_URL}/api/users/me/app-access`, { method: 'POST' });
      lastAppAccessRef.current = Date.now();
    } catch (err) {
      console.warn('Failed to record app access:', err);
    }
  }, []);

  const runDiscoveryScan = useCallback(async (daysAhead: number) => {
    try {
      const inferredTrips = await scanForUpcomingTripSignals(daysAhead);
      if (inferredTrips.length === 0) return;

      const dismissed = await readDismissedIds();
      const candidate = inferredTrips
        .filter(t => !t.sourceEventIds.some(id => dismissed.includes(id)))
        .filter(t => !hasMatchingExistingTrip(t, trips))
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];

      if (candidate) setSuggestion(candidate);
    } catch (err) {
      console.warn('Trip discovery scan failed:', err);
    }
  }, [trips]);

  const handleFirstCalendarGrant = useCallback(async () => {
    await runDiscoveryScan(FOREGROUND_SCAN_DAYS_AHEAD);
    await notifyAppAccess();
  }, [runDiscoveryScan, notifyAppAccess]);

  const dismissSuggestion = useCallback(() => {
    if (!suggestion) return;
    const anchored = suggestion;
    setSuggestion(null);
    (async () => {
      try {
        const dismissed = await readDismissedIds();
        const updated = Array.from(new Set([...dismissed, ...anchored.sourceEventIds]));
        await AsyncStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.warn('Failed to persist dismissed trip suggestion:', err);
      }
    })();
  }, [suggestion]);

  const acceptSuggestion = useCallback(() => {
    setSuggestion(current => {
      if (current) setPendingProposal(current);
      return null;
    });
  }, []);

  const consumePendingProposal = useCallback(() => setPendingProposal(null), []);

  // Path 2: app foreground, gated on the server-recorded (locally-mirrored) counter. Only a
  // logged-in user gets this listener at all.
  useEffect(() => {
    if (!user) return;
    const handleChange = (state: AppStateStatus) => {
      if (state !== 'active') return;
      const last = lastAppAccessRef.current ?? 0;
      if (Date.now() - last < FOREGROUND_RESCAN_THRESHOLD_MS) return;
      runDiscoveryScan(FOREGROUND_SCAN_DAYS_AHEAD).then(notifyAppAccess).catch((err) => {
        console.warn('Foreground trip discovery scan failed:', err);
      });
    };
    const subscription = AppState.addEventListener('change', handleChange);
    return () => subscription.remove();
  }, [user, runDiscoveryScan, notifyAppAccess]);

  return (
    <TripDiscoveryContext.Provider value={{
      suggestion,
      dismissSuggestion,
      acceptSuggestion,
      pendingProposal,
      consumePendingProposal,
      runDiscoveryScan,
      handleFirstCalendarGrant,
    }}>
      {children}
    </TripDiscoveryContext.Provider>
  );
};
