import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// lib/mutation-queue.ts talks to AsyncStorage (a native module outside RN) and, via
// lib/api-client.ts's apiFetch, to expo-constants — which statically imports `react-native`
// itself to read Platform/NativeModules. That's the actual reason this file had no test
// before this pass: react-native's own index.js uses Flow syntax esbuild can't parse
// (`Unexpected "typeof"`), so importing this module's real dependency chain fails outright
// under plain `tsx --test`. expo-constants ships a react-native-free build behind its
// "react-server" export condition (meant for RSC/server contexts, but equally dependency-free
// here) — see the "test" script in package.json, which now runs with
// `--conditions=react-server` specifically so this file's real imports (not reimplementations
// of them) can be exercised. AsyncStorage is a separate, smaller gap: its default build falls
// back to `window.localStorage`, stubbed below — same reasoning/pattern as
// lib/hotel-geocoding.test.ts's fetch stub, extended to cover AsyncStorage too.
//
// AsyncStorage's default (non-RN) build falls back to `window.localStorage` — stubbing that
// with an in-memory Map is enough to make the real module work end to end, with no need to
// touch lib/mutation-queue.ts itself. AsyncStorage only actually reads `window` when a method
// is called (from inside a test, well after this file's module body finishes), so this only
// needs to run before the first queueMutation/flushMutationQueue call below, not before the
// `./mutation-queue` import itself.
class FakeLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}
(globalThis as any).window = { localStorage: new FakeLocalStorage() };

import { queueMutation, flushMutationQueue } from './mutation-queue';

const ORIGINAL_FETCH = globalThis.fetch;

interface StubbedCall { url: string; init: any; }

// `responses` is consumed one-at-a-time per call (so a test can script "fail, then succeed"
// across two flush attempts); the last entry repeats once exhausted.
function stubFetch(...responses: Array<{ ok: boolean; status?: number } | Error>): StubbedCall[] {
  const calls: StubbedCall[] = [];
  let i = 0;
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    const response = responses[Math.min(i, responses.length - 1)];
    i++;
    if (response instanceof Error) throw response;
    return { ok: response.ok, status: response.status ?? (response.ok ? 200 : 500) };
  };
  return calls;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('flushMutationQueue', () => {
  test('a queued PUT is replayed with its method/url/body, then removed from the queue on success', async () => {
    const calls = stubFetch({ ok: true });
    await queueMutation('trip:replay-put', { method: 'PUT', url: 'https://api.test/trips/replay-put', body: { destination: 'Rome' } });

    await flushMutationQueue();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.test/trips/replay-put');
    assert.equal(calls[0].init.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[0].init.body), { destination: 'Rome' });
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');

    // Already resolved — a later flush should not replay it again.
    const secondCalls = stubFetch({ ok: true });
    await flushMutationQueue();
    assert.equal(secondCalls.length, 0);
  });

  test('a queued DELETE (no body) is replayed without a Content-Type header or body', async () => {
    const calls = stubFetch({ ok: true });
    await queueMutation('trip:replay-delete', { method: 'DELETE', url: 'https://api.test/trips/replay-delete' });

    await flushMutationQueue();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'DELETE');
    assert.equal(calls[0].init.body, undefined);
    // apiFetch (lib/api-client.ts) always adds its own headers (tunnel bypass, auth) — what
    // mutation-queue.ts itself controls is just Content-Type, which is only set when there's
    // a body to describe.
    assert.equal(calls[0].init.headers['Content-Type'], undefined);
  });

  test('a dropped connection (fetch throws) leaves the mutation queued for the next attempt', async () => {
    stubFetch(new Error('network dropped'));
    await queueMutation('trip:retry-after-throw', { method: 'PUT', url: 'https://api.test/trips/retry-after-throw', body: { destination: 'Athens' } });

    await flushMutationQueue(); // fails, stays queued
    const failedAttemptCalls = stubFetch(new Error('still down'));
    // Sanity: still present after the failed attempt above, since a second empty-response
    // stub wired up now would otherwise mask a queue that emptied itself incorrectly.
    await flushMutationQueue();
    assert.equal(failedAttemptCalls.length, 1, 'still-queued mutation should be retried, not silently dropped');

    // Connection recovers — now it should succeed and clear.
    stubFetch({ ok: true });
    await flushMutationQueue();
    const postRecoveryCalls = stubFetch({ ok: true });
    await flushMutationQueue();
    assert.equal(postRecoveryCalls.length, 0, 'should be gone from the queue once a replay actually succeeds');
  });

  test('a non-ok response (e.g. 404) leaves the mutation queued rather than dropping it', async () => {
    stubFetch({ ok: false, status: 404 });
    await queueMutation('trip:non-ok-response', { method: 'DELETE', url: 'https://api.test/trips/non-ok-response' });
    await flushMutationQueue();

    const secondAttemptCalls = stubFetch({ ok: false, status: 404 });
    await flushMutationQueue();
    assert.equal(secondAttemptCalls.length, 1, 'a 404 is not treated as "already deleted, safe to drop" — stays queued');

    // Eventually succeeds (e.g. the entity re-synced through some other path) and clears.
    stubFetch({ ok: true });
    await flushMutationQueue();
    const afterSuccessCalls = stubFetch({ ok: true });
    await flushMutationQueue();
    assert.equal(afterSuccessCalls.length, 0);
  });

  test('queuing a newer mutation for the same key replaces the queued one instead of stacking', async () => {
    await queueMutation('contact:replace-not-stack', { method: 'PUT', url: 'https://api.test/contacts/replace-not-stack', body: { name: 'Old Name' } });
    await queueMutation('contact:replace-not-stack', { method: 'PUT', url: 'https://api.test/contacts/replace-not-stack', body: { name: 'New Name' } });

    const calls = stubFetch({ ok: true });
    await flushMutationQueue();

    // Exactly one replay (the newer one), not two stacked mutations for the same key.
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].init.body), { name: 'New Name' });
  });

  test('one failing mutation does not block another queued mutation from replaying in the same flush', async () => {
    let call = 0;
    (globalThis as any).fetch = async (url: string, init: any) => {
      call++;
      if (url.includes('will-fail')) throw new Error('dropped');
      return { ok: true, status: 200 };
    };
    await queueMutation('trip:will-fail', { method: 'PUT', url: 'https://api.test/trips/will-fail', body: {} });
    await queueMutation('trip:will-succeed', { method: 'PUT', url: 'https://api.test/trips/will-succeed', body: {} });

    await flushMutationQueue();
    assert.equal(call, 2, 'both queued mutations should have been attempted');

    // The failing one is still queued; the succeeding one is not.
    const secondAttemptCalls = stubFetch({ ok: true });
    await flushMutationQueue();
    assert.equal(secondAttemptCalls.length, 1);
    assert.ok(secondAttemptCalls[0].url.includes('will-fail'));
  });
});
