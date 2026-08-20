import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch, API_URL, setAuthToken } from '@/lib/api-client';

// Step 2 of the useAuth.tsx split (see docs/useauth-split-plan.md): this is now just
// identity/session/onboarding. Trips, contacts, and events live in their own providers
// (hooks/useTrips.tsx, hooks/useContacts.tsx, hooks/useEvents.tsx) — each consumes this
// hook's `user`/`isReady` and reacts to them (syncing on login, clearing on logout) rather
// than this hook orchestrating everyone else's data directly.

interface AuthContextType {
  user: any | null;
  hasCompletedOnboarding: boolean;
  login: (userData: any) => void;
  logout: () => void;
  completeOnboarding: (preferences: any) => void;
  updatePreferences: (newPreferences: any) => void;
  updateUser: (newUserData: any) => void;
  isReady: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  hasCompletedOnboarding: false,
  login: () => {},
  logout: () => {},
  completeOnboarding: () => {},
  updatePreferences: () => {},
  updateUser: () => {},
  isReady: false
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);

  const saveState = async (key: string, value: any) => {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Failed to save to local storage', e);
    }
  };

  // Re-fetches just the profile (not trips/contacts — those providers sync themselves)
  // so a returning user's data reflects anything changed server-side since their last visit.
  const syncProfileFromServer = async (userId: string) => {
    try {
      const userRes = await apiFetch(`${API_URL}/api/users/${userId}`);
      if (userRes.ok) {
        const userData = await userRes.json();
        setUser(userData);
        await AsyncStorage.setItem('@user', JSON.stringify(userData));
      }
    } catch (err) {
      console.warn("Could not sync profile with backend server. Offline mode active:", err);
    }
  };

  useEffect(() => {
    const loadStorage = async () => {
      try {
        const storedToken = await AsyncStorage.getItem('@authToken');
        if (storedToken) setAuthToken(JSON.parse(storedToken));

        const storedUser = await AsyncStorage.getItem('@user');
        const storedOnboarding = await AsyncStorage.getItem('@hasCompletedOnboarding');

        if (storedUser) {
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
          // Sync fresh profile data in background
          syncProfileFromServer(parsedUser._id || parsedUser.id);
        }
        if (storedOnboarding) setHasCompletedOnboarding(JSON.parse(storedOnboarding));
      } catch (e) {
        console.error('Failed to load local storage', e);
      } finally {
        setIsReady(true);
      }
    };
    loadStorage();
  }, []);

  const login = async (userData: any) => {
    try {
      const res = await apiFetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });

      if (res.ok) {
        const { user: backendUser, token } = await res.json();
        setAuthToken(token);
        setUser(backendUser);
        await saveState('@user', backendUser);
        await saveState('@authToken', token);
      } else {
        throw new Error('Failed to login via server');
      }
    } catch (err) {
      console.warn("Backend login failed, using offline login mode:", err);
      setAuthToken(null);
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
    setAuthToken(null);
    AsyncStorage.removeItem('@user');
    AsyncStorage.removeItem('@hasCompletedOnboarding');
    AsyncStorage.removeItem('@authToken');
    // Trips/contacts clear themselves reactively — see hooks/useTrips.tsx and
    // hooks/useContacts.tsx, each of which watches `user` from this hook and resets its own
    // state/storage when it goes null, rather than this hook reaching into their concerns.
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

  return (
    <AuthContext.Provider value={{
      user,
      hasCompletedOnboarding,
      login,
      logout,
      completeOnboarding,
      updatePreferences,
      updateUser,
      isReady
    }}>
      {children}
    </AuthContext.Provider>
  );
};
