import React, { createContext, useContext, ReactNode } from 'react';
import { apiFetch, API_URL } from '@/lib/api-client';

// New provider, parallel to EventsProvider (same shape: thin fetch wrappers, no local
// state, throw on failure so the calling screen can alert) — friend requests are simple,
// foreground, user-initiated actions like events, not offline-synced/cached like trips and
// contacts. Sole consumer: app/(tabs)/social.tsx.

interface FriendRequestsContextType {
  sendFriendRequest: (toEmail: string, circleTag: string) => Promise<any>;
  fetchIncomingRequests: () => Promise<any[]>;
  fetchSentRequests: () => Promise<any[]>;
  respondToFriendRequest: (id: string, status: 'accepted' | 'declined', circleTag?: string) => Promise<any>;
}

const notReady = () => { throw new Error('FriendRequestsProvider not mounted'); };

const FriendRequestsContext = createContext<FriendRequestsContextType>({
  sendFriendRequest: notReady,
  fetchIncomingRequests: notReady,
  fetchSentRequests: notReady,
  respondToFriendRequest: notReady
});

export const useFriendRequests = () => useContext(FriendRequestsContext);

export const FriendRequestsProvider = ({ children }: { children: ReactNode }) => {
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

  const fetchIncomingRequests = async () => {
    const res = await apiFetch(`${API_URL}/api/friend-requests/incoming`);
    if (!res.ok) throw new Error('Failed to load incoming friend requests');
    return res.json();
  };

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

  return (
    <FriendRequestsContext.Provider value={{
      sendFriendRequest,
      fetchIncomingRequests,
      fetchSentRequests,
      respondToFriendRequest
    }}>
      {children}
    </FriendRequestsContext.Provider>
  );
};
