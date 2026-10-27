import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };

// Production: set expo.extra.apiUrl in app.json. Dev: same LAN host as Metro, port 4000.
export const API_URL =
  extra.apiUrl ||
  (Constants.expoConfig?.hostUri ? `http://${Constants.expoConfig.hostUri.split(':')[0]}:4000` : 'http://localhost:4000');

const TOKEN_KEY = 'auth_token';
let token: string | null = null;

export async function loadToken() {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token;
}

export async function setToken(next: string | null) {
  token = next;
  if (next) await SecureStore.setItemAsync(TOKEN_KEY, next);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
  coins: number;
  diamonds: number;
}

export interface Gift {
  id: string;
  name: string;
  emoji: string;
  coins: number;
}
