export interface Contact {
  id: string;
  name: string;
  isAppUser: boolean;
  sharedLocation?: string;
  circleTags: string[];
  avatarUrl?: string; // New relational boundary handling graphical pictures natively
  // Both present on a real synced Contact (parseServerContacts in hooks/useContacts.tsx
  // spreads the raw server doc), but only meaningfully populated for a pending (invite-by-
  // email, !isAppUser) contact — email is what an invite resend targets, createdAt is shown
  // as "invited <date>" so a pending invite doesn't read as a dead end. See social.tsx.
  email?: string;
  createdAt?: string;
}

export const DEFAULT_CIRCLES = ['Family and Friends', 'Relatives', 'Work'];

export const MOCK_CONTACTS: Contact[] = [
  {
    id: 'c1',
    name: 'Sarah Connor',
    isAppUser: true,
    sharedLocation: 'Paris',
    circleTags: ['Family and Friends'],
    avatarUrl: 'https://i.pravatar.cc/150?u=sarah'
  },
  {
    id: 'c2',
    name: 'John Doe',
    isAppUser: true,
    circleTags: ['Work'],
    avatarUrl: 'https://i.pravatar.cc/150?u=john'
  },
  {
    id: 'c3',
    name: 'Emma Smith',
    isAppUser: false,
    circleTags: ['Relatives'],
    avatarUrl: 'https://i.pravatar.cc/150?u=emma'
  },
  {
    id: 'c4',
    name: 'Michael Scott',
    isAppUser: true,
    sharedLocation: 'New York',
    circleTags: ['Family and Friends'],
    avatarUrl: 'https://i.pravatar.cc/150?u=michael'
  }
];

export function getContactsByCircle(contacts: Contact[], circle: string): Contact[] {
  return contacts.filter(c => c.circleTags.includes(circle));
}
