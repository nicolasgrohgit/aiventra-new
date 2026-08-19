import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { flushMutationQueue } from '@/lib/mutation-queue';

// Shared by TripsProvider and ContactsProvider — both need identical "retry pending
// mutations when the app comes back to the foreground" behavior against the same queue, so
// this is one hook rather than duplicating the AppState subscription/cleanup twice.
export function useMutationQueueFlush() {
  useEffect(() => {
    const handleChange = (state: AppStateStatus) => {
      if (state === 'active') {
        flushMutationQueue().catch((e) => console.warn('Mutation queue flush on foreground failed:', e));
      }
    };
    const subscription = AppState.addEventListener('change', handleChange);
    return () => subscription.remove();
  }, []);
}
