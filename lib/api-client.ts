import Constants from 'expo-constants';

// Step 1 of the useAuth.tsx split (see docs/useauth-split-plan.md): the shared HTTP
// plumbing every provider needs for authenticated requests, decoupled so it isn't
// duplicated (or worse, re-implemented slightly differently) across AuthProvider,
// TripsProvider, ContactsProvider, and EventsProvider.

export const API_URL = (() => {
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

// Session token issued by POST /api/auth/login. Every protected endpoint requires this —
// it's what lets the server scope requests to "the authenticated user" instead of trusting
// whatever userId a client happens to send. Module-scoped (not React state) so apiFetch can
// read it synchronously on every call without every provider needing to thread it through;
// AuthProvider is the only thing that calls setAuthToken.
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export const apiFetch = (url: string, options: any = {}) => {
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Bypass-Tunnel-Reminder': 'true',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
    }
  });
};
