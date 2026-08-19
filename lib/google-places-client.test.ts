import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGooglePlacesForCity } from './google-places-client';

// No live network calls in this suite — global.fetch is stubbed per test and restored
// afterward, same reasoning as any other external-dependency test in this project.
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.GOOGLE_PLACES_API_KEY;

function stubFetch(response: { ok: boolean; status?: number; json?: () => Promise<any>; text?: () => Promise<string> }) {
  const calls: { url: string; init: any }[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: response.json ?? (async () => ({})),
      text: response.text ?? (async () => ''),
    };
  };
  return calls;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = ORIGINAL_KEY;
});

describe('fetchGooglePlacesForCity — no-op paths (never touch the network)', () => {
  test('returns [] and never calls fetch when GOOGLE_PLACES_API_KEY is unset', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const calls = stubFetch({ ok: true, json: async () => ({ places: [] }) });
    const result = await fetchGooglePlacesForCity('Paris, France', 'Restaurant');
    assert.deepEqual(result, []);
    assert.equal(calls.length, 0);
  });

  test('returns [] and never calls fetch for category Event, even with a key set', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    const calls = stubFetch({ ok: true, json: async () => ({ places: [] }) });
    const result = await fetchGooglePlacesForCity('Paris, France', 'Event');
    assert.deepEqual(result, []);
    assert.equal(calls.length, 0);
  });
});

describe('fetchGooglePlacesForCity — request shape', () => {
  test('sends the field mask header and a city-scoped query, and never fetches Restaurant text for an Activity call', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    const calls = stubFetch({ ok: true, json: async () => ({ places: [] }) });
    await fetchGooglePlacesForCity('Rome, Italy', 'Activity');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers['X-Goog-Api-Key'], 'test-key');
    assert.ok(calls[0].init.headers['X-Goog-FieldMask'].length > 0);
    const body = JSON.parse(calls[0].init.body);
    assert.match(body.textQuery, /Rome, Italy/);
    assert.doesNotMatch(body.textQuery.toLowerCase(), /restaurant/);
  });
});

describe('fetchGooglePlacesForCity — classification against lib/google-places-types.ts', () => {
  test('maps a recognized type to our tag/genre and tags the draft source:"google"', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    stubFetch({
      ok: true,
      json: async () => ({
        places: [{ id: 'p1', displayName: { text: 'Italian Place' }, types: ['italian_restaurant'], rating: 4.5 }],
      }),
    });
    const [draft] = await fetchGooglePlacesForCity('Paris, France', 'Restaurant');
    assert.equal(draft.name, 'Italian Place');
    assert.equal(draft.genre, 'Italian');
    assert.equal(draft.source, 'google');
    assert.equal(draft.rating, 4.5);
    assert.ok(draft.tags.includes('Italian'));
    assert.ok(draft.tags.includes('Restaurant'));
  });

  test('drops a place whose types map to nothing in our taxonomy, instead of fabricating a tag', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    stubFetch({
      ok: true,
      json: async () => ({ places: [{ id: 'p2', displayName: { text: 'Gas Station' }, types: ['gas_station'] }] }),
    });
    const result = await fetchGooglePlacesForCity('Paris, France', 'Restaurant');
    assert.deepEqual(result, []);
  });

  test('a type shared across categories ("museum": Activity "Museums" + Event "Exhibitions") only tags within the requested category', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    stubFetch({
      ok: true,
      json: async () => ({ places: [{ id: 'p3', displayName: { text: 'City Museum' }, types: ['museum'] }] }),
    });
    const [draft] = await fetchGooglePlacesForCity('Paris, France', 'Activity');
    assert.equal(draft.genre, 'Museums');
    assert.ok(!draft.tags.includes('Exhibitions'));
  });

  test('missing rating/editorialSummary fall back to sane defaults, not undefined', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    stubFetch({
      ok: true,
      json: async () => ({ places: [{ id: 'p4', displayName: { text: 'No-Frills Cafe' }, types: ['cafe'] }] }),
    });
    const [draft] = await fetchGooglePlacesForCity('Paris, France', 'Restaurant');
    assert.equal(draft.rating, 4.3);
    assert.equal(typeof draft.description, 'string');
    assert.ok(draft.description.length > 0);
    assert.equal(draft.estimatedDuration, 75);
  });

  test('distanceKm is a deterministic placeholder within a plausible range', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    stubFetch({
      ok: true,
      json: async () => ({
        places: [{ id: 'p5', displayName: { text: 'Some Cafe' }, types: ['cafe'] }],
      }),
    });
    const [first] = await fetchGooglePlacesForCity('Paris, France', 'Restaurant');
    assert.ok(first.distanceKm >= 0.3 && first.distanceKm <= 6.5);

    stubFetch({
      ok: true,
      json: async () => ({
        places: [{ id: 'p5', displayName: { text: 'Some Cafe' }, types: ['cafe'] }],
      }),
    });
    const [second] = await fetchGooglePlacesForCity('Paris, France', 'Restaurant');
    // Same place id fetched again (e.g. a later population run) gets the same placeholder,
    // not a fresh random jitter each time.
    assert.equal(first.distanceKm, second.distanceKm);
  });
});

describe('fetchGooglePlacesForCity — propagates real API failures', () => {
  test('a non-2xx response throws rather than silently returning []', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    stubFetch({ ok: false, status: 403, text: async () => 'Forbidden' });
    await assert.rejects(() => fetchGooglePlacesForCity('Paris, France', 'Restaurant'));
  });
});
