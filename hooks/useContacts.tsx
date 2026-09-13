import React, { createContext, useContext, ReactNode } from 'react';
import { MOCK_CONTACTS } from '@/lib/contacts';
import { useSyncedCollection } from './useSyncedCollection';

// Step 3 of the useAuth.tsx split (see docs/useauth-split-plan.md): contacts, extracted
// first as the smallest/most self-contained piece. Consumers: social.tsx, trips.tsx.
//
// The AsyncStorage-load / server-sync-effect / diff-based create-update-delete machinery
// below is shared with hooks/useTrips.tsx via useSyncedCollection.ts (see
// CHANGELOG.md's cleanliness-audit entry) — this file only owns what's actually
// contact-specific: the shape of a contact, its diff/payload rules, and refreshContacts.

// The normalized shape every contact is in once it's passed through parseServerContacts —
// what app screens actually work with, as opposed to the raw server document.
// `[key: string]: any` because parseServerContacts spreads the raw server object first
// (`...c`) before overriding the fields below, so a few server-only fields (e.g.
// `contact_user_id`, used directly by trips.tsx's eligibleContacts filter) ride along
// unmodeled.
export interface ClientContact {
  id: string;
  _id?: string;
  name: string;
  email?: string;
  isAppUser: boolean;
  circleTags: string[];
  avatarUrl?: string;
  contactUserId?: string;
  [key: string]: any;
}

interface ContactsContextType {
  contacts: ClientContact[];
  setContacts: (contacts: ClientContact[]) => void;
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

const parseServerContacts = (contactsData: any[]): ClientContact[] =>
  contactsData.map((c: any) => ({
    ...c,
    id: c._id,
    name: c.name,
    isAppUser: !!c.contact_user_id,
    circleTags: c.circle_tags || [],
    avatarUrl: c.avatar_url || `https://i.pravatar.cc/150?u=${c.name}`
  }));

const parseCachedContact = (c: any): ClientContact => c;

// The exact set of seeded demo-contact ids (lib/contacts.ts's MOCK_CONTACTS) — used below to
// tell a mock contact apart from a real MongoDB _id. A bare `id.startsWith('c')` prefix check
// was used here previously, but a real 24-hex-char Mongo _id can itself start with the
// character 'c' (hex includes a-f), which made that check silently swallow deletes/updates
// for ~1/16 of real synced contacts forever. Comparing against this fixed set instead.
const MOCK_CONTACT_IDS = new Set(MOCK_CONTACTS.map(c => c.id));

const contactHasChanged = (oc: ClientContact, nc: ClientContact) =>
  oc.name !== nc.name ||
  JSON.stringify(oc.circleTags) !== JSON.stringify(nc.circleTags) ||
  oc.contactUserId !== nc.contactUserId;

export const ContactsProvider = ({ children }: { children: ReactNode }) => {
  const { items: contacts, setItems: setContacts, refetchNow } = useSyncedCollection<ClientContact>({
    storageKey: '@contacts',
    apiPath: '/api/contacts',
    entityLabel: 'contact',
    emptyState: MOCK_CONTACTS,
    parseCached: parseCachedContact,
    parseServer: parseServerContacts,
    // Only update on server if it's a real MongoDB id — ids in MOCK_CONTACT_IDS are the seeded
    // MOCK_CONTACTS demo set (lib/contacts.ts), never real documents. Deliberately an exact-set
    // membership check rather than a `startsWith('c')` prefix check: a real Mongo _id is 24 hex
    // chars and hex includes 'c', so a prefix check would falsely match real contacts too.
    canSyncForDelete: (id) => !id.startsWith('mock_') && !MOCK_CONTACT_IDS.has(id),
    // Same as delete, plus 'pending_' — an invite-flow-created placeholder (social.tsx's
    // handleSendInvite) that hasn't round-tripped through a create yet.
    canSyncForUpdate: (id) => !id.startsWith('mock_') && !MOCK_CONTACT_IDS.has(id) && !id.startsWith('pending_'),
    hasChanged: contactHasChanged,
    buildCreateBody: (c, userId) => ({
      userId,
      name: c.name,
      email: c.email,
      circleTags: c.circleTags || [],
      contactUserId: c.contactUserId || null
    }),
    buildUpdateBody: (c) => ({
      name: c.name,
      circleTags: c.circleTags,
      contactUserId: c.contactUserId
    }),
    // If the server has no contacts yet, keep the mock/demo set rather than clearing to [].
    keepStateWhenServerEmptyOnLogin: true
  });

  return (
    <ContactsContext.Provider value={{ contacts, setContacts, refreshContacts: refetchNow }}>
      {children}
    </ContactsContext.Provider>
  );
};
