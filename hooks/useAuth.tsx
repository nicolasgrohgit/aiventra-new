import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { MOCK_CONTACTS } from '@/lib/contacts';
import { guessTimezoneForCity } from '@/lib/timezones';

const API_URL = (() => {
  // Set at build time, e.g. `EXPO_PUBLIC_API_URL=https://your-tunnel.loca.lt eas build ...`
  // (see docs/beta-deploy.md). Expo inlines EXPO_PUBLIC_* vars into the client bundle, so
  // this is the ONLY way a built/sideloaded APK can know where the backend is — a built
  // app has no Metro dev server to auto-detect a host from, so without this it silently
  // falls back to localhost, which on a tester's phone means their own device.
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // Dev-loop fallback (only reachable via `expo start`): infer the backend host from
  // Metro's own dev-server host, so local development keeps working without any setup.
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const ip = hostUri.split(':')[0];
    return `http://${ip}:3000`;
  }
  return 'http://localhost:3000';
})();

console.log('Connecting to Backend API at:', API_URL);

// Session token issued by POST /api/auth/login. Every protected endpoint now requires
// this — it's what lets the server scope requests to "the authenticated user" instead
// of trusting whatever userId a client happens to send.
let authToken: string | null = null;

const apiFetch = (url: string, options: any = {}) => {
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Bypass-Tunnel-Reminder': 'true',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
    }
  });
};

interface AuthContextType {
  user: any | null;
  hasCompletedOnboarding: boolean;
  login: (userData: any) => void;
  logout: () => void;
  completeOnboarding: (preferences: any) => void;
  updatePreferences: (newPreferences: any) => void;
  updateUser: (newUserData: any) => void;
  trips: any[];
  setTrips: (trips: any[]) => void;
  contacts: any[];
  setContacts: (contacts: any[]) => void;
  isReady: boolean;
  // Events aren't cached/offline-synced like trips and contacts are — they're simple,
  // foreground, user-initiated actions, so these just wrap apiFetch (for the auth header)
  // and throw on failure so the calling screen can show it, rather than swallowing errors.
  fetchTripEvents: (tripId: string) => Promise<any[]>;
  fetchInvitedEvents: () => Promise<any[]>;
  createEvent: (tripId: string, payload: any) => Promise<any>;
  updateEvent: (eventId: string, payload: any) => Promise<any>;
  respondToEvent: (eventId: string, status: 'accepted' | 'declined') => Promise<any>;
  deleteEvent: (eventId: string) => Promise<void>;
  getJointRecommendations: (eventId: string) => Promise<any[]>;
  getRecommendations: (params: { city: string; durationMinutes: number; startTimeIso: string; timezone?: string }) => Promise<any[]>;
  // Contacts otherwise only sync on login/app-boot, so a contact linked mid-session via
  // `npm run link-contact` wouldn't become usable (e.g. invite-eligible) without this —
  // call it whenever a screen is about to rely on a contact's current linked state.
  refreshContacts: () => Promise<void>;
}

const notReady = () => { throw new Error('AuthProvider not mounted'); };

const AuthContext = createContext<AuthContextType>({
  user: null,
  hasCompletedOnboarding: false,
  login: () => {},
  logout: () => {},
  completeOnboarding: () => {},
  updatePreferences: () => {},
  updateUser: () => {},
  trips: [],
  setTrips: () => {},
  contacts: [],
  setContacts: () => {},
  isReady: false,
  fetchTripEvents: notReady,
  fetchInvitedEvents: notReady,
  createEvent: notReady,
  updateEvent: notReady,
  respondToEvent: notReady,
  deleteEvent: notReady,
  getJointRecommendations: notReady,
  getRecommendations: notReady,
  refreshContacts: notReady
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  
  const [trips, setTripsState] = useState<any[]>([]);
  const [contacts, setContactsState] = useState<any[]>(MOCK_CONTACTS);

  // Sync details from server if online
  const syncFromServer = async (userId: string) => {
    try {
      // 1. Fetch profile
      const userRes = await apiFetch(`${API_URL}/api/users/${userId}`);
      if (userRes.ok) {
        const userData = await userRes.json();
        setUser(userData);
        await AsyncStorage.setItem('@user', JSON.stringify(userData));
      }

      // 2. Fetch trips
      const tripsRes = await apiFetch(`${API_URL}/api/trips?userId=${userId}`);
      if (tripsRes.ok) {
        const tripsData = await tripsRes.json();
        const parsedTrips = tripsData.map((t: any) => ({
          ...t,
          id: t._id,
          startDate: new Date(t.start_date),
          endDate: new Date(t.end_date),
          timezone: t.timezone || guessTimezoneForCity(t.destination)
        }));
        setTripsState(parsedTrips);
        await AsyncStorage.setItem('@trips', JSON.stringify(parsedTrips));
      }

      // 3. Fetch contacts
      const contactsRes = await apiFetch(`${API_URL}/api/contacts?userId=${userId}`);
      if (contactsRes.ok) {
        const contactsData = await contactsRes.json();
        const parsedContacts = contactsData.map((c: any) => ({
          ...c,
          id: c._id,
          name: c.name,
          isAppUser: !!c.contact_user_id,
          circleTags: c.circle_tags || [],
          avatarUrl: c.avatar_url || `https://i.pravatar.cc/150?u=${c.name}`
        }));
        // If server has no contacts yet, we default to mock contacts and create them in next steps
        if (parsedContacts.length > 0) {
          setContactsState(parsedContacts);
          await AsyncStorage.setItem('@contacts', JSON.stringify(parsedContacts));
        }
      }
    } catch (err) {
      console.warn("Could not sync with backend server. Offline mode active:", err);
    }
  };

  useEffect(() => {
    const loadStorage = async () => {
      try {
        const storedToken = await AsyncStorage.getItem('@authToken');
        if (storedToken) authToken = storedToken;

        const storedUser = await AsyncStorage.getItem('@user');
        const storedOnboarding = await AsyncStorage.getItem('@hasCompletedOnboarding');
        const storedTrips = await AsyncStorage.getItem('@trips');
        const storedContacts = await AsyncStorage.getItem('@contacts');

        if (storedUser) {
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
          // Sync server data in background
          syncFromServer(parsedUser._id || parsedUser.id);
        }
        if (storedOnboarding) setHasCompletedOnboarding(JSON.parse(storedOnboarding));
        if (storedTrips) {
          const parsedTrips = JSON.parse(storedTrips).map((t: any) => ({
            ...t,
            startDate: new Date(t.startDate),
            endDate: new Date(t.endDate),
            timezone: t.timezone || guessTimezoneForCity(t.destination)
          })); // events live in their own collection now, fetched separately per trip
          setTripsState(parsedTrips);
        }
        if (storedContacts) {
          setContactsState(JSON.parse(storedContacts));
        }
      } catch (e) {
        console.error('Failed to load local storage', e);
      } finally {
        setIsReady(true);
      }
    };
    loadStorage();
  }, []);

  const saveState = async (key: string, value: any) => {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Failed to save to local storage', e);
    }
  };

  const login = async (userData: any) => {
    try {
      const res = await apiFetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });
      
      if (res.ok) {
        const { user: backendUser, token } = await res.json();
        authToken = token;
        setUser(backendUser);
        await saveState('@user', backendUser);
        await saveState('@authToken', token);

        // Sync trips and contacts from server
        await syncFromServer(backendUser._id);
      } else {
        throw new Error('Failed to login via server');
      }
    } catch (err) {
      console.warn("Backend login failed, using offline login mode:", err);
      authToken = null;
      // Offline fallback
      const newUser = {
        ...userData,
        _id: 'mock_user_id',
        firstName: userData.name?.split(' ')[0] || userData.name || '',
        lastName: userData.name?.split(' ')[1] || '',
        dob: '1990-01-01',
        homebase: userData.homebase || 'New York, USA',
        avatarUrl: `https://i.pravatar.cc/150?u=${userData.name?.split(' ')[0] || 'me'}`,
        preferences: userData.preferences || { 
          budget: '30-50', 
          currency: 'USD',
          dateFormat: 'MM/DD/YYYY',
          activityLevel: 'Medium', 
          dietary: [],
          foodGenres: ['Italian', 'French'],
          activityGenres: ['Walking Tours', 'Museums'],
          eventGenres: ['Concerts', 'Comedy Shows']
        }
      };
      setUser(newUser);
      saveState('@user', newUser);
    }
  };

  const logout = () => {
    setUser(null);
    setHasCompletedOnboarding(false);
    setTripsState([]);
    setContactsState(MOCK_CONTACTS);
    authToken = null;
    AsyncStorage.removeItem('@user');
    AsyncStorage.removeItem('@hasCompletedOnboarding');
    AsyncStorage.removeItem('@trips');
    AsyncStorage.removeItem('@contacts');
    AsyncStorage.removeItem('@authToken');
  };

  const completeOnboarding = async (preferences: any) => {
    if (user) {
      // Merge rather than replace — onboarding only collects a subset of preference fields
      // (diet, pace, genre tastes); replacing wholesale would wipe out the budget/currency/
      // dateFormat defaults the server set at account creation.
      const updatedUser = { ...user, preferences: { ...user.preferences, ...preferences } };
      setUser(updatedUser);
      saveState('@user', updatedUser);

      // Save to server
      try {
        const id = user._id || user.id;
        if (id && !String(id).startsWith('mock_')) {
          await apiFetch(`${API_URL}/api/users/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preferences })
          });
        }
      } catch (err) {
        console.warn("Failed to save onboarding preferences to server:", err);
      }
    }
    setHasCompletedOnboarding(true);
    saveState('@hasCompletedOnboarding', true);
  };

  const updatePreferences = async (newPreferences: any) => {
    if (user) {
      const updatedUser = { 
        ...user, 
        preferences: { 
          ...user.preferences, 
          ...newPreferences 
        } 
      };
      setUser(updatedUser);
      saveState('@user', updatedUser);

      // Save to server
      try {
        const id = user._id || user.id;
        if (id && !String(id).startsWith('mock_')) {
          await apiFetch(`${API_URL}/api/users/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preferences: updatedUser.preferences })
          });
        }
      } catch (err) {
        console.warn("Failed to update preferences on server:", err);
      }
    }
  };

  const updateUser = async (newUserData: any) => {
    if (user) {
      const updatedUser = { ...user, ...newUserData };
      setUser(updatedUser);
      saveState('@user', updatedUser);

      // Save to server
      try {
        const id = user._id || user.id;
        if (id && !String(id).startsWith('mock_')) {
          await apiFetch(`${API_URL}/api/users/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newUserData)
          });
        }
      } catch (err) {
        console.warn("Failed to update user data on server:", err);
      }
    }
  };

  const setTrips = async (newTrips: any[]) => {
    setTripsState(newTrips);
    saveState('@trips', newTrips);

    if (!user) return;
    const userId = user._id || user.id;
    if (!userId || String(userId).startsWith('mock_')) return;

    try {
      const oldTrips = trips;

      // 1. Delete trips that are no longer present
      const deletedTrips = oldTrips.filter(ot => !newTrips.some(nt => nt.id === ot.id || nt._id === ot._id));
      for (const t of deletedTrips) {
        const id = t._id || t.id;
        if (id && !String(id).startsWith('mock_')) {
          await apiFetch(`${API_URL}/api/trips/${id}`, { method: 'DELETE' });
        }
      }

      // 2. Add or update trips
      for (const nt of newTrips) {
        const isNew = !oldTrips.some(ot => ot.id === nt.id || ot._id === nt._id);
        if (isNew) {
          await apiFetch(`${API_URL}/api/trips`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              destination: nt.destination,
              startDate: nt.startDate,
              endDate: nt.endDate,
              timezone: nt.timezone
            })
          });
        } else {
          // Check if updated
          const ot = oldTrips.find(o => o.id === nt.id || o._id === nt._id);
          const hasChanged = ot && (
            ot.destination !== nt.destination ||
            new Date(ot.startDate).getTime() !== new Date(nt.startDate).getTime() ||
            new Date(ot.endDate).getTime() !== new Date(nt.endDate).getTime() ||
            ot.timezone !== nt.timezone
          );
          if (hasChanged) {
            const id = nt._id || nt.id;
            if (id && !String(id).startsWith('mock_')) {
              await apiFetch(`${API_URL}/api/trips/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  destination: nt.destination,
                  startDate: nt.startDate,
                  endDate: nt.endDate,
                  timezone: nt.timezone
                })
              });
            }
          }
        }
      }

      // Refetch trips to sync IDs
      const res = await apiFetch(`${API_URL}/api/trips?userId=${userId}`);
      if (res.ok) {
        const tripsData = await res.json();
        const parsedTrips = tripsData.map((t: any) => ({
          ...t,
          id: t._id,
          startDate: new Date(t.start_date),
          endDate: new Date(t.end_date),
          timezone: t.timezone || guessTimezoneForCity(t.destination)
        }));
        setTripsState(parsedTrips);
        saveState('@trips', parsedTrips);
      }
    } catch (err) {
      console.warn("Failed to sync trips with backend:", err);
    }
  };

  const setContacts = async (newContacts: any[]) => {
    setContactsState(newContacts);
    saveState('@contacts', newContacts);

    if (!user) return;
    const userId = user._id || user.id;
    if (!userId || String(userId).startsWith('mock_')) return;

    try {
      const oldContacts = contacts;

      // 1. Delete contacts that are no longer present
      const deletedContacts = oldContacts.filter(oc => !newContacts.some(nc => nc.id === oc.id || nc._id === oc._id));
      for (const c of deletedContacts) {
        const id = c._id || c.id;
        if (id && !String(id).startsWith('mock_') && !String(id).startsWith('c')) {
          await apiFetch(`${API_URL}/api/contacts/${id}`, { method: 'DELETE' });
        }
      }

      // 2. Add or update contacts
      for (const nc of newContacts) {
        const isNew = !oldContacts.some(oc => oc.id === nc.id || oc._id === nc._id);
        if (isNew) {
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
              await apiFetch(`${API_URL}/api/contacts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: nc.name,
                  circleTags: nc.circleTags,
                  contactUserId: nc.contactUserId
                })
              });
            }
          }
        }
      }

      // Refetch contacts to sync IDs
      const res = await apiFetch(`${API_URL}/api/contacts?userId=${userId}`);
      if (res.ok) {
        const contactsData = await res.json();
        const parsedContacts = contactsData.map((c: any) => ({
          ...c,
          id: c._id,
          name: c.name,
          isAppUser: !!c.contact_user_id,
          circleTags: c.circle_tags || [],
          avatarUrl: c.avatar_url || `https://i.pravatar.cc/150?u=${c.name}`
        }));
        setContactsState(parsedContacts);
        saveState('@contacts', parsedContacts);
      }
    } catch (err) {
      console.warn("Failed to sync contacts with backend:", err);
    }
  };

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

  const refreshContacts = async () => {
    const userId = user?._id || user?.id;
    if (!userId || String(userId).startsWith('mock_')) return;
    try {
      const res = await apiFetch(`${API_URL}/api/contacts?userId=${userId}`);
      if (!res.ok) return;
      const contactsData = await res.json();
      const parsedContacts = contactsData.map((c: any) => ({
        ...c,
        id: c._id,
        name: c.name,
        isAppUser: !!c.contact_user_id,
        circleTags: c.circle_tags || [],
        avatarUrl: c.avatar_url || `https://i.pravatar.cc/150?u=${c.name}`
      }));
      setContactsState(parsedContacts);
      await AsyncStorage.setItem('@contacts', JSON.stringify(parsedContacts));
    } catch (err) {
      console.warn('Failed to refresh contacts:', err);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      hasCompletedOnboarding,
      login,
      logout,
      completeOnboarding,
      updatePreferences,
      updateUser,
      trips,
      setTrips,
      contacts,
      setContacts,
      isReady,
      fetchTripEvents,
      fetchInvitedEvents,
      createEvent,
      updateEvent,
      respondToEvent,
      deleteEvent,
      getJointRecommendations,
      getRecommendations,
      refreshContacts
    }}>
      {children}
    </AuthContext.Provider>
  );
};
