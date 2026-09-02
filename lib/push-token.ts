import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Client-side half of push notification infra — device permission request + Expo push
// token retrieval. The server-side sending half lives in the separate lib/push-
// notifications.ts (plain fetch to Expo's push API, no RN dependency) rather than one shared
// module, specifically so server.ts never ends up importing anything that pulls in an
// RN-only package like expo-notifications.
//
// Decoupled from useAuth.tsx's own storage/network concerns, same reasoning as lib/
// calendar.ts wrapping expo-calendar: this just gets a token (or null) and never throws —
// the caller (hooks/useAuth.tsx's login()) decides what to do with it. Never awaited inline
// with login itself; see the comment at the call site for why.
//
// Web is skipped outright — expo-notifications' push token flow needs a service worker/VAPID
// setup this app hasn't configured, and this app's web build (`npm run web`) is a dev/testing
// target, not a shipped surface push notifications need to reach.
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return null;
  }

  try {
    const Notifications = await import('expo-notifications');

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      // Declined or restricted — this is a normal, expected outcome, not a failure to log.
      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    // Required by getExpoPushTokenAsync in the managed/EAS-build workflow this app uses
    // (app.json's extra.eas.projectId) — omitted only as a fallback for an environment where
    // it's somehow unset, in which case Expo can sometimes infer it, and if not this call
    // throws and is caught below like any other registration failure.
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return tokenResponse.data;
  } catch (err) {
    // Expected on a simulator/emulator (no push capability) and in other edge cases (denied
    // native permission at the OS level, missing native module on an unsupported platform) —
    // logged as a warning, never thrown, so a login can never fail because of this.
    console.warn('Push notification registration failed (non-fatal):', err);
    return null;
  }
}
