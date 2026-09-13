import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './api-client';

// Persisted retry queue for failed PUT/DELETE calls — the actual failure mode this covers is
// a dropped connection mid-sync (hotel wifi, tunnel drop), where the optimistic local state
// already shows a change as applied but the server never received it. Deliberately scoped to
// PUT/DELETE only: those are safe to blindly replay (an identical PUT, or a DELETE on an
// already-deleted resource, is a no-op). Retrying a failed POST/create safely needs a
// server-side idempotency key to avoid double-creating the entity on retry — that's separate,
// larger scope, not built here. A failed create keeps behaving exactly as before: dropped and
// logged, not queued.
//
// Keyed by entity (e.g. `trip:<id>`), not a flat list — a newer mutation for the same entity
// simply replaces the queued one rather than stacking, so replaying never applies stale edits
// out of order if the same entity gets mutated again before the first failure ever flushes.

interface QueuedMutation {
  method: 'PUT' | 'DELETE';
  url: string;
  body?: any;
}

const STORAGE_KEY = '@pendingMutations';

let cache: Record<string, QueuedMutation> | null = null;
let loadPromise: Promise<Record<string, QueuedMutation>> | null = null;

async function load(): Promise<Record<string, QueuedMutation>> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      cache = raw ? JSON.parse(raw) : {};
      return cache as Record<string, QueuedMutation>;
    }).catch((e) => {
      console.error('Failed to load pending mutation queue, starting empty:', e);
      cache = {};
      return cache;
    });
  }
  return loadPromise;
}

async function persist() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache || {}));
  } catch (e) {
    console.error('Failed to persist pending mutation queue:', e);
  }
}

export async function queueMutation(key: string, mutation: QueuedMutation): Promise<void> {
  await load();
  cache![key] = mutation;
  await persist();
}

/**
 * Attempts to replay every queued mutation. Successes are removed from the queue; failures
 * stay queued for the next flush attempt (app foreground, or the start of the next normal
 * sync cycle — see hooks/useMutationQueueFlush.ts and the call at the top of
 * useTrips.tsx/useContacts.tsx's setTrips/setContacts).
 */
export async function flushMutationQueue(): Promise<void> {
  const q = await load();
  const keys = Object.keys(q);
  if (keys.length === 0) return;

  let changed = false;
  for (const key of keys) {
    const mutation = q[key];
    try {
      const res = await apiFetch(mutation.url, {
        method: mutation.method,
        headers: mutation.body ? { 'Content-Type': 'application/json' } : undefined,
        body: mutation.body ? JSON.stringify(mutation.body) : undefined
      });
      if (res.ok) {
        delete q[key];
        changed = true;
      } else if (res.status === 404) {
        // A 404 means this mutation's target is already gone server-side — deleted from
        // another device, or (for a PUT) a create that never landed in the first place.
        // Per this file's own top comment, "a DELETE on an already-deleted resource is a
        // no-op": the mutation's intent (this entity should be gone / reflect this update)
        // is already satisfied, so this clears exactly like a genuine success instead of
        // retrying forever with no way to ever resolve itself.
        delete q[key];
        changed = true;
      }
      // Any OTHER non-ok response (401 expired auth, 500, etc.) is a real failure, not a
      // no-op — left queued rather than silently dropped, for the next flush attempt.
    } catch (err) {
      console.warn(`Mutation queue: retry failed for "${key}", will retry again later:`, err);
    }
  }
  if (changed) await persist();
}
