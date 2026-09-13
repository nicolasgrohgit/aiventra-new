import { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch, API_URL } from '@/lib/api-client';
import { queueMutation, flushMutationQueue } from '@/lib/mutation-queue';
import { sameEntity, EntityId } from '@/lib/entity-id';
import { useMutationQueueFlush } from './useMutationQueueFlush';
import { useAuth } from './useAuth';

// Shared offline-sync engine behind TripsProvider and ContactsProvider (hooks/useTrips.tsx,
// hooks/useContacts.tsx) — those two used to independently implement the identical shape
// (AsyncStorage load -> ref-guarded server sync effect -> diff-based create/update/delete
// with isolated try/catch + queue fallback -> refetch). See CHANGELOG.md's cleanliness-audit
// entry. This factors out everything that was byte-for-byte (or near enough) identical;
// each provider still owns its own Context/extra methods (toggleDismissedSlot,
// refreshContacts) on top of what this hook returns.
//
// TItem must carry `id`/`_id` the way every parsed trip/contact does (see sameEntity in
// lib/entity-id.ts) — that's what lets diffing and URL/queue-key construction stay generic.

export interface SyncedCollectionConfig<TItem extends EntityId> {
  storageKey: string;   // AsyncStorage key, e.g. '@trips'
  apiPath: string;      // e.g. '/api/trips' (relative to API_URL, no trailing slash)
  entityLabel: string;  // singular, e.g. 'trip' — used in mutation-queue keys and log messages
  emptyState: TItem[];  // starting state, and what a logout resets to (trips: []; contacts: MOCK_CONTACTS)
  // Revives whatever AsyncStorage's JSON.parse can't do on its own (e.g. Date fields) for one
  // cached item.
  parseCached: (raw: any) => TItem;
  // Normalizes a page of raw server documents into this app's client-side shape.
  parseServer: (data: any[]) => TItem[];
  // True for a real MongoDB id worth sending a DELETE for. False for a client-only id that
  // was never synced (e.g. `mock_...`, or a locally-seeded id).
  canSyncForDelete: (id: string) => boolean;
  // Same idea for PUT — defaults to canSyncForDelete. Contacts overrides this to also exclude
  // `pending_...` ids (an invite-flow-created placeholder not yet round-tripped through a
  // create), a case delete never needed to special-case.
  canSyncForUpdate?: (id: string) => boolean;
  hasChanged: (oldItem: TItem, newItem: TItem) => boolean;
  buildCreateBody: (item: TItem, userId: string) => any;
  buildUpdateBody: (item: TItem) => any;
  // Login-time sync only (not the post-mutation refetch): when the server has nothing yet,
  // keep whatever's already in state (contacts' demo/mock set) instead of clearing to [].
  keepStateWhenServerEmptyOnLogin?: boolean;
}

export function useSyncedCollection<TItem extends EntityId>(config: SyncedCollectionConfig<TItem>) {
  const {
    storageKey, apiPath, entityLabel, emptyState,
    parseCached, parseServer, canSyncForDelete, hasChanged,
    buildCreateBody, buildUpdateBody, keepStateWhenServerEmptyOnLogin
  } = config;
  const canSyncForUpdate = config.canSyncForUpdate || canSyncForDelete;
  const apiUrl = `${API_URL}${apiPath}`;
  const syncId = (item: TItem) => item._id || item.id;

  const { user } = useAuth();
  useMutationQueueFlush();
  const [items, setItemsState] = useState<TItem[]>(emptyState);
  // Guards the sync-from-server effect below against re-running for the same user across
  // unrelated re-renders — should fire once per actual login/logout transition.
  const lastSyncedUserId = useRef<string | null>(null);

  // Offline-first: load whatever's cached locally immediately, independent of auth state.
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(storageKey);
        if (stored) setItemsState(JSON.parse(stored).map(parseCached));
      } catch (e) {
        console.error(`Failed to load cached ${entityLabel}s`, e);
      }
    })();
    // parseCached/storageKey/entityLabel come from config, stable for the provider's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reacts to auth state: sync from server once we know who's logged in; reset (or, for
  // contacts, fall back to the demo set) on logout.
  useEffect(() => {
    const userId = user?._id || user?.id;

    if (!userId) {
      if (lastSyncedUserId.current !== null) {
        setItemsState(emptyState);
        AsyncStorage.removeItem(storageKey);
        lastSyncedUserId.current = null;
      }
      return;
    }

    if (String(userId).startsWith('mock_') || lastSyncedUserId.current === userId) return;
    lastSyncedUserId.current = userId;

    (async () => {
      try {
        const res = await apiFetch(`${apiUrl}?userId=${userId}`);
        if (!res.ok) return;
        const parsed = parseServer(await res.json());
        if (parsed.length === 0 && keepStateWhenServerEmptyOnLogin) return;
        setItemsState(parsed);
        await AsyncStorage.setItem(storageKey, JSON.stringify(parsed));
      } catch (err) {
        console.warn(`Could not sync ${entityLabel}s with backend server. Offline mode active:`, err);
      }
    })();
    // apiUrl/parseServer/storageKey/entityLabel/emptyState/keepStateWhenServerEmptyOnLogin all
    // come from config, stable for the provider's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id, user?.id]);

  const setItems = async (newItems: TItem[]) => {
    setItemsState(newItems);
    AsyncStorage.setItem(storageKey, JSON.stringify(newItems)).catch((e) => console.error(`Failed to save ${entityLabel}s`, e));

    if (!user) return;
    const userId = user._id || user.id;
    if (!userId || String(userId).startsWith('mock_')) return;

    // Retry anything left over from a previous dropped connection before layering a new sync
    // on top of it.
    await flushMutationQueue().catch((e) => console.warn('Mutation queue flush failed:', e));

    const oldItems = items;

    // Runs one PUT/DELETE against the API and queues it for retry (lib/mutation-queue.ts) on
    // EITHER a thrown error (dropped connection) OR a non-ok response (401 expired JWT, 404,
    // 500, ...) — apiFetch never throws on a non-2xx response, so without this a failure like
    // an expired token would silently fall through as neither a success nor a queued retry,
    // and the unconditional refetch below would then pull the server's still-unchanged state
    // back, undoing the user's delete/edit with no error shown. Routing both failure shapes
    // through the exact same queueMutation call keeps them equivalent from here on — including
    // flushMutationQueue's own handling of a 404 as an already-satisfied no-op rather than an
    // endless retry.
    const performSyncedMutation = async (method: 'PUT' | 'DELETE', id: string, body?: any) => {
      const url = `${apiUrl}/${id}`;
      try {
        const res = await apiFetch(url, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined
        });
        if (!res.ok) {
          console.warn(`Failed to ${method} ${entityLabel} ${id} (status ${res.status}), queuing for retry`);
          await queueMutation(`${entityLabel}:${id}`, { method, url, body });
        }
      } catch (err) {
        console.warn(`Failed to ${method} ${entityLabel} ${id}, queuing for retry:`, err);
        await queueMutation(`${entityLabel}:${id}`, { method, url, body });
      }
    };

    // 1. Delete items that are no longer present. Each call is isolated (its own try/catch)
    // so one failure doesn't abort the rest of the batch — previously the whole sync was one
    // try/catch, so a single dropped connection meant every subsequent mutation in this call
    // silently never even got attempted.
    const deleted = oldItems.filter(oi => !newItems.some(ni => sameEntity(ni, oi)));
    for (const item of deleted) {
      const id = syncId(item);
      if (id && canSyncForDelete(id)) {
        await performSyncedMutation('DELETE', id);
      }
    }

    // 2. Add or update items
    for (const newItem of newItems) {
      const isNew = !oldItems.some(oi => sameEntity(oi, newItem));
      if (isNew) {
        try {
          await apiFetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildCreateBody(newItem, userId))
          });
        } catch (err) {
          // Not queued for retry — see lib/mutation-queue.ts: replaying a failed create
          // safely needs a server-side idempotency key to avoid double-creating the entity,
          // which is separate, larger scope than this pass. Same behavior as before.
          console.warn(`Failed to create ${entityLabel} (not retried, see lib/mutation-queue.ts):`, err);
        }
      } else {
        const oldItem = oldItems.find(oi => sameEntity(oi, newItem));
        if (oldItem && hasChanged(oldItem, newItem)) {
          const id = syncId(newItem);
          if (id && canSyncForUpdate(id)) {
            await performSyncedMutation('PUT', id, buildUpdateBody(newItem));
          }
        }
      }
    }

    // Refetch to sync IDs — always replaces (unlike the login-time sync above, which can keep
    // stale-but-existing state when the server comes back empty).
    try {
      const res = await apiFetch(`${apiUrl}?userId=${userId}`);
      if (res.ok) {
        const parsed = parseServer(await res.json());
        setItemsState(parsed);
        AsyncStorage.setItem(storageKey, JSON.stringify(parsed)).catch((e) => console.error(`Failed to save ${entityLabel}s`, e));
      }
    } catch (err) {
      console.warn(`Failed to refetch ${entityLabel}s after sync:`, err);
    }
  };

  // Low-level escape hatch for callers that need to patch local state (+ cache) without
  // running the full diff/create/update/delete sync above — e.g. useTrips.tsx's
  // toggleDismissedSlot, which already made its own single, server-authoritative API call and
  // just needs to reflect the result locally.
  const replaceItems = (updater: TItem[] | ((prev: TItem[]) => TItem[])) => {
    setItemsState(prev => {
      const next = typeof updater === 'function' ? (updater as (prev: TItem[]) => TItem[])(prev) : updater;
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch((e) => console.error(`Failed to save ${entityLabel}s`, e));
      return next;
    });
  };

  // Manual "pull the latest from the server into local state" — e.g. useContacts.tsx's
  // refreshContacts, called mid-session after something outside this app's own sync loop
  // (`npm run link-contact`) could have changed server-side state.
  const refetchNow = async () => {
    const userId = user?._id || user?.id;
    if (!userId || String(userId).startsWith('mock_')) return;
    try {
      const res = await apiFetch(`${apiUrl}?userId=${userId}`);
      if (!res.ok) return;
      const parsed = parseServer(await res.json());
      setItemsState(parsed);
      await AsyncStorage.setItem(storageKey, JSON.stringify(parsed));
    } catch (err) {
      console.warn(`Failed to refresh ${entityLabel}s:`, err);
    }
  };

  return { items, setItems, replaceItems, refetchNow };
}
