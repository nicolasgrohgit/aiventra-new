import React, { createContext, useContext, useState, ReactNode, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch, API_URL } from '@/lib/api-client';
import { MOCK_CONTACTS } from '@/lib/contacts';
import { queueMutation, flushMutationQueue } from '@/lib/mutation-queue';
import { useMutationQueueFlush } from './useMutationQueueFlush';
import { useAuth } from './useAuth';

// Step 3 of the useAuth.tsx split (see docs/useauth-split-plan.md): contacts, extracted
// first as the smallest/most self-contained piece. Consumers: social.tsx, trips.tsx.

interface ContactsContextType {
  contacts: any[];
  setContacts: (contacts: any[]) => void;
  // Contacts otherwise only sync on login/app-boot, so a contact linked mid-session via
  // `npm run link-contact` wouldn't become usable (e.g. invite-eligible) without this —
  // call it whenever a screen is about to rely on a contact's current linked state.
  refreshContacts: () => Promise<void>;
}

const notReady = () => { throw new Error('ContactsProvider not mounted'); };

const ContactsContext = createContext<ContactsContextType>({
  contacts: [],
  setContacts: () => {},
  refreshContacts: notReady
});

export const useContacts = () => useContext(ContactsContext);

const parseServerContacts = (contactsData: any[]) =>
  contactsData.map((c: any) => ({
    ...c,
    id: c._id,
    name: c.name,
    isAppUser: !!c.contact_user_id,
    circleTags: c.circle_tags || [],
    avatarUrl: c.avatar_url || `https://i.pravatar.cc/150?u=${c.name}`
  }));

export const ContactsProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  useMutationQueueFlush();
  const [contacts, setContactsState] = useState<any[]>(MOCK_CONTACTS);
  // Guards the sync-from-server effect below against re-running for the same user across
  // unrelated re-renders — it should fire once per actual login/logout transition, not on
  // every render that happens to include a `user` object.
  const lastSyncedUserId = useRef<string | null>(null);

  // Offline-first: load whatever's cached locally immediately, independent of auth state.
  useEffect(() => {
    (async () => {
      try {
        const storedContacts = await AsyncStorage.getItem('@contacts');
        if (storedContacts) setContactsState(JSON.parse(storedContacts));
      } catch (e) {
        console.error('Failed to load cached contacts', e);
      }
    })();
  }, []);

  // Reacts to auth state: sync from server once we know who's logged in; reset to the
  // mock/demo set on logout. Mirrors what the old monolithic useAuth.tsx did inline.
  useEffect(() => {
    const userId = user?._id || user?.id;

    if (!userId) {
      if (lastSyncedUserId.current !== null) {
        setContactsState(MOCK_CONTACTS);
        AsyncStorage.removeItem('@contacts');
        lastSyncedUserId.current = null;
      }
      return;
    }

    if (String(userId).startsWith('mock_') || lastSyncedUserId.current === userId) return;
    lastSyncedUserId.current = userId;

    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/api/contacts?userId=${userId}`);
        if (!res.ok) return;
        const contactsData = await res.json();
        const parsedContacts = parseServerContacts(contactsData);
        // If server has no contacts yet, keep the mock/demo set rather than clearing to [].
        if (parsedContacts.length > 0) {
          setContactsState(parsedContacts);
          await AsyncStorage.setItem('@contacts', JSON.stringify(parsedContacts));
        }
      } catch (err) {
        console.warn("Could not sync contacts with backend server. Offline mode active:", err);
      }
    })();
  }, [user?._id, user?.id]);

  const setContacts = async (newContacts: any[]) => {
    setContactsState(newContacts);
    AsyncStorage.setItem('@contacts', JSON.stringify(newContacts)).catch((e) => console.error('Failed to save contacts', e));

    if (!user) return;
    const userId = user._id || user.id;
    if (!userId || String(userId).startsWith('mock_')) return;

    // Retry anything left over from a previous dropped connection before layering a new sync
    // on top of it.
    await flushMutationQueue().catch((e) => console.warn('Mutation queue flush failed:', e));

    const oldContacts = contacts;

    // 1. Delete contacts that are no longer present. Each call is isolated (its own
    // try/catch) so one failure doesn't abort the rest of the batch.
    const deletedContacts = oldContacts.filter(oc => !newContacts.some(nc => nc.id === oc.id || nc._id === oc._id));
    for (const c of deletedContacts) {
      const id = c._id || c.id;
      if (id && !String(id).startsWith('mock_') && !String(id).startsWith('c')) {
        try {
          await apiFetch(`${API_URL}/api/contacts/${id}`, { method: 'DELETE' });
        } catch (err) {
          console.warn(`Failed to delete contact ${id}, queuing for retry:`, err);
          await queueMutation(`contact:${id}`, { method: 'DELETE', url: `${API_URL}/api/contacts/${id}` });
        }
      }
    }

    // 2. Add or update contacts
    for (const nc of newContacts) {
      const isNew = !oldContacts.some(oc => oc.id === nc.id || oc._id === nc._id);
      if (isNew) {
        try {
          await apiFetch(`${API_URL}/api/contacts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              name: nc.name,
              email: nc.email,
              circleTags: nc.circleTags || [],
              contactUserId: nc.contactUserId || null
            })
          });
        } catch (err) {
          // Not queued for retry — see lib/mutation-queue.ts: replaying a failed create
          // safely needs a server-side idempotency key, separate/larger scope than this
          // pass. Same behavior as before.
          console.warn(`Failed to create contact (not retried, see lib/mutation-queue.ts):`, err);
        }
      } else {
        // Check if updated
        const oc = oldContacts.find(o => o.id === nc.id || o._id === nc._id);
        const hasChanged = oc && (
          oc.name !== nc.name ||
          JSON.stringify(oc.circleTags) !== JSON.stringify(nc.circleTags) ||
          oc.contactUserId !== nc.contactUserId
        );
        if (hasChanged) {
          const id = nc._id || nc.id;
          // Only update on server if it's a real MongoDB ID
          if (id && !String(id).startsWith('mock_') && !String(id).startsWith('c') && !String(id).startsWith('pending_')) {
            const body = {
              name: nc.name,
              circleTags: nc.circleTags,
              contactUserId: nc.contactUserId
            };
            try {
              await apiFetch(`${API_URL}/api/contacts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
              });
            } catch (err) {
              console.warn(`Failed to update contact ${id}, queuing for retry:`, err);
              await queueMutation(`contact:${id}`, { method: 'PUT', url: `${API_URL}/api/contacts/${id}`, body });
            }
          }
        }
      }
    }

    // Refetch contacts to sync IDs
    try {
      const res = await apiFetch(`${API_URL}/api/contacts?userId=${userId}`);
      if (res.ok) {
        const contactsData = await res.json();
        const parsedContacts = parseServerContacts(contactsData);
        setContactsState(parsedContacts);
        AsyncStorage.setItem('@contacts', JSON.stringify(parsedContacts)).catch((e) => console.error('Failed to save contacts', e));
      }
    } catch (err) {
      console.warn("Failed to refetch contacts after sync:", err);
    }
  };

  const refreshContacts = async () => {
    const userId = user?._id || user?.id;
    if (!userId || String(userId).startsWith('mock_')) return;
    try {
      const res = await apiFetch(`${API_URL}/api/contacts?userId=${userId}`);
      if (!res.ok) return;
      const parsedContacts = parseServerContacts(await res.json());
      setContactsState(parsedContacts);
      await AsyncStorage.setItem('@contacts', JSON.stringify(parsedContacts));
    } catch (err) {
      console.warn('Failed to refresh contacts:', err);
    }
  };

  return (
    <ContactsContext.Provider value={{ contacts, setContacts, refreshContacts }}>
      {children}
    </ContactsContext.Provider>
  );
};
