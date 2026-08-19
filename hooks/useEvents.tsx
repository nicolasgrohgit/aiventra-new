import React, { createContext, useContext, ReactNode } from 'react';
import { apiFetch, API_URL } from '@/lib/api-client';

// Step 4 of the useAuth.tsx split (see docs/useauth-split-plan.md): events, next most
// self-contained after contacts — all thin fetch wrappers, no local state, no dependency on
// auth state directly (apiFetch already carries the token). Sole consumer: trips.tsx, plus
// recommendation.tsx for getRecommendations.
//
// getFriendsNearby wasn't part of the original split plan (added after it was written) —
// placed here rather than in TripsProvider/ContactsProvider because it matches this
// provider's actual shape (stateless request wrapper, swallows its own errors) more closely
// than it matches either of theirs.

interface EventsContextType {
  // These throw on failure so the calling screen can show it, rather than swallowing errors —
  // events aren't cached/offline-synced like trips and contacts are, they're simple,
  // foreground, user-initiated actions.
  fetchTripEvents: (tripId: string) => Promise<any[]>;
  fetchInvitedEvents: () => Promise<any[]>;
  createEvent: (tripId: string, payload: any) => Promise<any>;
  // Opportunistic device-calendar sync — swallows errors to [] rather than throwing, same
  // reasoning as getFriendsNearby: a background nicety, not a blocking action, shouldn't
  // surface an alert if the device calendar or network hiccups.
  importTripEvents: (tripId: string, events: { id: string; title: string; startTime: string; endTime: string; location?: string }[]) => Promise<any[]>;
  updateEvent: (eventId: string, payload: any) => Promise<any>;
  respondToEvent: (eventId: string, status: 'accepted' | 'declined') => Promise<any>;
  deleteEvent: (eventId: string) => Promise<void>;
  getJointRecommendations: (eventId: string) => Promise<any[]>;
  getRecommendations: (params: {
    city: string; durationMinutes: number; startTimeIso: string; timezone?: string;
    // maxDistanceKm: omit for the default "near me" ceiling (see DEFAULT_MAX_DISTANCE_KM in
    // lib/place-matching.ts) — recommendation.tsx's "Expand Search Radius" passes a larger
    // value. tagOverride: score against these specific tags instead of the caller's saved
    // preference profile — trips.tsx's "Refine Your Search" flow.
    maxDistanceKm?: number; tagOverride?: string[];
  }) => Promise<any[]>;
  // Circle-scoped, sharer-driven friend discovery for trip planning — see the privacy model
  // documented on GET /api/friends-nearby in server.ts. Swallows errors to [] rather than
  // throwing, since this is a "nice to notice" discovery layer, not a blocking action.
  getFriendsNearby: (params: { city: string; startDate?: string; endDate?: string }) => Promise<any[]>;
}

const notReady = () => { throw new Error('EventsProvider not mounted'); };

const EventsContext = createContext<EventsContextType>({
  fetchTripEvents: notReady,
  fetchInvitedEvents: notReady,
  createEvent: notReady,
  importTripEvents: async () => [],
  updateEvent: notReady,
  respondToEvent: notReady,
  deleteEvent: notReady,
  getJointRecommendations: notReady,
  getRecommendations: notReady,
  getFriendsNearby: async () => []
});

export const useEvents = () => useContext(EventsContext);

export const EventsProvider = ({ children }: { children: ReactNode }) => {
  const fetchTripEvents = async (tripId: string) => {
    const res = await apiFetch(`${API_URL}/api/trips/${tripId}/events`);
    if (!res.ok) throw new Error('Failed to load events for this trip');
    return res.json();
  };

  const fetchInvitedEvents = async () => {
    const res = await apiFetch(`${API_URL}/api/events/invited`);
    if (!res.ok) throw new Error('Failed to load invited events');
    return res.json();
  };

  const createEvent = async (tripId: string, payload: any) => {
    const res = await apiFetch(`${API_URL}/api/trips/${tripId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to create event');
    }
    return res.json();
  };

  const importTripEvents = async (tripId: string, events: { id: string; title: string; startTime: string; endTime: string; location?: string }[]) => {
    try {
      if (events.length === 0) return [];
      const res = await apiFetch(`${API_URL}/api/trips/${tripId}/events/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events })
      });
      if (!res.ok) return [];
      return await res.json();
    } catch (err) {
      console.warn('Failed to import calendar events:', err);
      return [];
    }
  };

  const updateEvent = async (eventId: string, payload: any) => {
    const res = await apiFetch(`${API_URL}/api/events/${eventId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to update event');
    return res.json();
  };

  const respondToEvent = async (eventId: string, status: 'accepted' | 'declined') => {
    const res = await apiFetch(`${API_URL}/api/events/${eventId}/respond`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Failed to respond to event');
    return res.json();
  };

  const deleteEvent = async (eventId: string) => {
    const res = await apiFetch(`${API_URL}/api/events/${eventId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete event');
  };

  const getJointRecommendations = async (eventId: string) => {
    const res = await apiFetch(`${API_URL}/api/events/${eventId}/recommendations`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to compute joint recommendations');
    return res.json();
  };

  const getRecommendations = async (params: { city: string; durationMinutes: number; startTimeIso: string; timezone?: string }) => {
    const res = await apiFetch(`${API_URL}/api/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (!res.ok) throw new Error('Failed to fetch recommendations');
    return res.json();
  };

  const getFriendsNearby = async (params: { city: string; startDate?: string; endDate?: string }) => {
    try {
      const query = new URLSearchParams({ city: params.city });
      if (params.startDate) query.set('startDate', params.startDate);
      if (params.endDate) query.set('endDate', params.endDate);
      const res = await apiFetch(`${API_URL}/api/friends-nearby?${query.toString()}`);
      if (!res.ok) return [];
      return await res.json();
    } catch (err) {
      console.warn('Failed to fetch nearby friends:', err);
      return [];
    }
  };

  return (
    <EventsContext.Provider value={{
      fetchTripEvents,
      fetchInvitedEvents,
      createEvent,
      importTripEvents,
      updateEvent,
      respondToEvent,
      deleteEvent,
      getJointRecommendations,
      getRecommendations,
      getFriendsNearby
    }}>
      {children}
    </EventsContext.Provider>
  );
};
