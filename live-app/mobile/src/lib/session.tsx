import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, loadToken, setToken, type Me } from './api';
import { identifyPurchaser, resetPurchaser } from './purchases';

interface Session {
  ready: boolean;
  user: Me | null;
  signUp: (input: { email: string; password: string; displayName: string; dob: string; acceptTerms: boolean }) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<Me | null>(null);

  const adopt = useCallback(async (u: Me) => {
    setUser(u);
    identifyPurchaser(u.id).catch((e) => console.warn('RevenueCat identify failed', e));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (await loadToken()) adopt((await api<{ user: Me }>('/me')).user);
      } catch {
        await setToken(null);
      } finally {
        setReady(true);
      }
    })();
  }, [adopt]);

  const value = useMemo<Session>(() => ({
    ready,
    user,
    async signUp(input) {
      const res = await api<{ token: string; user: Me }>('/auth/signup', { body: input });
      await setToken(res.token);
      await adopt(res.user);
    },
    async signIn(email, password) {
      const res = await api<{ token: string; user: Me }>('/auth/login', { body: { email, password } });
      await setToken(res.token);
      await adopt(res.user);
    },
    async signOut() {
      await setToken(null);
      await resetPurchaser();
      setUser(null);
    },
    async refresh() {
      setUser((await api<{ user: Me }>('/me')).user);
    },
    async deleteAccount() {
      await api('/me', { method: 'DELETE' });
      await setToken(null);
      await resetPurchaser();
      setUser(null);
    },
  }), [ready, user, adopt]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}
