import React, { createContext, useContext, ReactNode, useCallback, useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { apiFetch, API_URL } from '@/lib/api-client';
import { useAuth } from './useAuth';

// New provider, parallel to EventsProvider (same shape: thin fetch wrappers, no local
// state, throw on failure so the calling screen can alert) — friend requests are simple,
// foreground, user-initiated actions like events, not offline-synced/cached like trips and
// contacts. Sole consumer: app/(tabs)/social.tsx (plus app/(tabs)/_layout.tsx, for the
// Circles tab badge count below).
//
// incomingRequestCount is the one bit of cached/reactive state this provider does keep —
// the Circles tab badge needs a live "how many pending requests" number at the layout
// level, above where social.tsx's own on-demand fetches live. It's kept in sync two ways:
// every fetchIncomingRequests() call (including social.tsx's own on-demand ones) updates
// it as a side effect, and a poll loop (interval + AppState foreground, same trigger
// useMutationQueueFlush.ts uses for the mutation queue) refreshes it independently so the
// badge stays current even if the Circles tab is never opened. No push-driven alternative
// yet — that depends on the in-app foreground-notification-handling follow-up
// (Notifications.setNotificationHandler) noted in lib/push-notifications.ts's CHANGELOG
// entry, which isn't built yet; polling is simple and a pending friend request isn't
// urgent to the second.
const POLL_INTERVAL_MS = 45000;

interface FriendRequestsContextType {
  sendFriendRequest: (toEmail: string, circleTag: string) => Promise<any>;
  fetchIncomingRequests: () => Promise<any[]>;
  fetchSentRequests: () => Promise<any[]>;
  respondToFriendRequest: (id: string, status: 'accepted' | 'declined', circleTag?: string) => Promise<any>;
  incomingRequestCount: number;
}

const notReady = () => { throw new Error('FriendRequestsProvider not mounted'); };

const FriendRequestsContext = createContext<FriendRequestsContextType>({
  sendFriendRequest: notReady,
  fetchIncomingRequests: notReady,
  fetchSentRequests: notReady,
  respondToFriendRequest: notReady,
  incomingRequestCount: 0
});

export const useFriendRequests = () => useContext(FriendRequestsContext);

export const FriendRequestsProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [incomingRequestCount, setIncomingRequestCount] = useState(0);

  const sendFriendRequest = async (toEmail: string, circleTag: string) => {
    const res = await apiFetch(`${API_URL}/api/friend-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toEmail, circleTag })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to send friend request');
    }
    return res.json();
  };

  const fetchIncomingRequests = useCallback(async () => {
    const res = await apiFetch(`${API_URL}/api/friend-requests/incoming`);
    if (!res.ok) throw new Error('Failed to load incoming friend requests');
    const requests = await res.json();
    // The endpoint already filters to status: 'pending' server-side, so the count is just
    // the result length — no dedicated count endpoint needed for this.
    setIncomingRequestCount(requests.length);
    return requests;
  }, []);

  const fetchSentRequests = async () => {
    const res = await apiFetch(`${API_URL}/api/friend-requests/sent`);
    if (!res.ok) throw new Error('Failed to load sent friend requests');
    return res.json();
  };

  const respondToFriendRequest = async (id: string, status: 'accepted' | 'declined', circleTag?: string) => {
    const res = await apiFetch(`${API_URL}/api/friend-requests/${id}/respond`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, circleTag })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to respond to friend request');
    }
    return res.json();
  };

  // Poll while a user is logged in — on an interval, and again whenever the app comes back
  // to the foreground (same AppState 'active' trigger useMutationQueueFlush.ts uses).
  useEffect(() => {
    if (!user) {
      setIncomingRequestCount(0);
      return;
    }

    fetchIncomingRequests().catch((e) => console.warn('Incoming friend request poll failed:', e));

    const interval = setInterval(() => {
      fetchIncomingRequests().catch((e) => console.warn('Incoming friend request poll failed:', e));
    }, POLL_INTERVAL_MS);

    const handleAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') {
        fetchIncomingRequests().catch((e) => console.warn('Incoming friend request poll failed:', e));
      }
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [user, fetchIncomingRequests]);

  return (
    <FriendRequestsContext.Provider value={{
      sendFriendRequest,
      fetchIncomingRequests,
      fetchSentRequests,
      respondToFriendRequest,
      incomingRequestCount
    }}>
      {children}
    </FriendRequestsContext.Provider>
  );
};
