import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect, useState } from 'react';
import * as Sentry from '@sentry/react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { TripsProvider } from '@/hooks/useTrips';
import { ContactsProvider } from '@/hooks/useContacts';
import { EventsProvider } from '@/hooks/useEvents';
import { FriendRequestsProvider } from '@/hooks/useFriendRequests';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Stays completely inert (no init, no crash/error capture, zero cost) until
// EXPO_PUBLIC_SENTRY_DSN is set at build time — see docs/beta-deploy.md.
if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}

function InitialLayout() {
  const { user, hasCompletedOnboarding, isReady } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    // Wait until the root navigation layout mounts completely and Auth is ready
    if (!isMounted || !rootNavigationState?.key || !isReady) return;

    // Evaluate the route segment group the user is attempting to reach
    const inAuthGroup = segments[0] === ('login' as any);
    const inOnboardingGroup = segments[0] === ('onboarding' as any);

    // Using a micro-timeout pushes the redirect to the end of the JS event loop
    // guaranteeing the Stack navigator is fully rendered natively before we attempt routing.
    setTimeout(() => {
      if (!user && !inAuthGroup) {
        router.replace('/login' as any);
      } else if (user && !hasCompletedOnboarding && !inOnboardingGroup) {
        router.replace('/onboarding' as any);
      } else if (user && hasCompletedOnboarding && (inAuthGroup || inOnboardingGroup)) {
        router.replace('/(tabs)' as any);
      }
    }, 10);
  }, [user, hasCompletedOnboarding, segments, rootNavigationState?.key, isMounted, isReady, router]);

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="recommendation" options={{ presentation: 'modal', title: 'Smart Suggestions' }} />
    </Stack>
  );
}

function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    // AuthProvider wraps the others — Trips/Contacts/Events/FriendRequests each react to the
    // current user from AuthProvider to sync/clear their own data (see
    // docs/useauth-split-plan.md). Order among them doesn't matter functionally, none depend
    // on each other. FriendRequestsProvider is stateless like EventsProvider (no local cache
    // to sync/clear), so it's placed alongside it.
    <AuthProvider>
      <TripsProvider>
        <ContactsProvider>
          <EventsProvider>
            <FriendRequestsProvider>
              <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                <InitialLayout />
                <StatusBar style="auto" />
              </ThemeProvider>
            </FriendRequestsProvider>
          </EventsProvider>
        </ContactsProvider>
      </TripsProvider>
    </AuthProvider>
  );
}

export default Sentry.wrap(RootLayout);
