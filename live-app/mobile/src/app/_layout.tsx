import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SessionProvider, useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

function Gate() {
  const { ready, user } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === '(auth)';
    if (!user && !inAuth) router.replace('/login');
    else if (user && inAuth) router.replace('/');
  }, [ready, user, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="live/[id]" options={{ animation: 'fade', gestureEnabled: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Gate />
    </SessionProvider>
  );
}
