// Server-side push sending via Expo's push HTTPS API (https://exp.host/--/api/v2/push/send)
// — a plain fetch POST, no extra SDK dependency needed beyond Node's built-in fetch (already
// the pattern used elsewhere server-side, see lib/geocoding.ts and lib/google-places-client.ts).
// This is the "server-side sending" half of push notification infra; the client-side token
// registration half lives in lib/push-token.ts instead — kept as two separate files (rather
// than one shared module) specifically so server.ts never ends up importing anything that
// pulls in an RN-only package.
//
// Best-effort only, same reasoning and shape as ensurePlacesForCity in
// lib/places-population.ts: a push notification is a nice-to-have side effect of a friend
// request or event invite, never a precondition for it. Every failure mode here (network
// error, an expired/uninstalled-app/malformed token, a non-2xx or per-ticket error from
// Expo's API) is caught and logged, never thrown — callers can fire this off without their
// own try/catch, though callers in server.ts wrap it anyway for defense in depth, mirroring
// how ensurePlacesForCity is called in three places despite already being best-effort itself.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushNotificationData {
  [key: string]: unknown;
}

/**
 * Sends a single push notification through Expo's push service. `to` must be an Expo push
 * token obtained client-side (see lib/push-token.ts's registerForPushNotificationsAsync) and
 * stored via POST /api/users/me/push-token — never a raw device/FCM/APNs token, Expo's push
 * API only accepts its own token format ("ExponentPushToken[...]").
 */
export async function sendPushNotification(
  to: string,
  title: string,
  body: string,
  data?: PushNotificationData
): Promise<void> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify([{ to, title, body, data, sound: 'default' }])
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '<unreadable body>');
      console.warn(`[push-notifications] Expo push API returned HTTP ${res.status}:`, text);
      return;
    }

    // Expo responds 200 even for a per-message failure (bad token, unregistered device,
    // etc.) — the actual outcome is inside a "ticket" per message in the response body, so a
    // 2xx status alone doesn't mean the notification will actually arrive. Logged here so a
    // stale/invalid token shows up in server logs without ever surfacing to the caller.
    const json: any = await res.json().catch(() => null);
    const ticket = json?.data?.[0];
    if (ticket && ticket.status === 'error') {
      console.warn('[push-notifications] Expo push ticket error:', ticket.message, ticket.details);
    }
  } catch (err) {
    console.warn('[push-notifications] send failed:', err);
  }
}
