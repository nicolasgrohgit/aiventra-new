import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { searchHotelLocation } from './hotel-geocoding';

// No live network calls in this suite — global.fetch is stubbed per test and restored
// afterward, same reasoning/pattern as lib/google-places-client.test.ts.
const ORIGINAL_FETCH = globalThis.fetch;

function stubFetch(response: { ok: boolean; status?: number; json?: () => Promise<any> }) {
  const calls: { url: string; init: any }[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: response.json ?? (async () => ([])),
    };
  };
  return calls;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('searchHotelLocation', () => {
  test('returns [] and never calls fetch for a too-short query', async () => {
    const calls = stubFetch({ ok: true, json: async () => ([]) });
    const result = await searchHotelLocation('a');
    assert.deepEqual(result, []);
    assert.equal(calls.length, 0);
  });

  test('sends a descriptive User-Agent header, not a personal email', async () => {
    const calls = stubFetch({ ok: true, json: async () => ([]) });
    await searchHotelLocation('Hotel Marriott');
    assert.equal(calls.length, 1);
    const ua = calls[0].init.headers['User-Agent'];
    assert.ok(ua && ua.length > 0);
    assert.ok(!ua.includes('@'), 'User-Agent must not embed a personal email address');
  });

  test('with no cityCenter: does not set viewbox/bounded params', async () => {
    const calls = stubFetch({ ok: true, json: async () => ([]) });
    await searchHotelLocation('Hotel Marriott');
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.has('viewbox'), false);
    assert.equal(url.searchParams.has('bounded'), false);
  });

  test('with a cityCenter: sets a hard viewbox+bounded constraint around it', async () => {
    const calls = stubFetch({ ok: true, json: async () => ([]) });
    await searchHotelLocation('Hotel Marriott', { lat: 48.85, lng: 2.35 });
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('bounded'), '1');
    const viewbox = url.searchParams.get('viewbox');
    assert.ok(viewbox, 'expected a viewbox param');
    const [left, top, right, bottom] = viewbox!.split(',').map(Number);
    // left/right straddle the center longitude, top/bottom straddle the center latitude.
    assert.ok(left < 2.35 && right > 2.35);
    assert.ok(top > 48.85 && bottom < 48.85);
  });

  test('parses real Nominatim-shaped results into HotelLocationResult', async () => {
    stubFetch({
      ok: true,
      json: async () => ([
        { display_name: 'Hôtel Le Marais, Paris, France', lat: '48.8600', lon: '2.3600' }
      ])
    });
    const result = await searchHotelLocation('Hôtel Le Marais', { lat: 48.85, lng: 2.35 });
    assert.deepEqual(result, [{ label: 'Hôtel Le Marais, Paris, France', latitude: 48.86, longitude: 2.36 }]);
  });

  test('drops entries with unparseable lat/lon rather than returning NaN', async () => {
    stubFetch({
      ok: true,
      json: async () => ([
        { display_name: 'Bad entry', lat: 'not-a-number', lon: '2.36' },
        { display_name: 'Good entry', lat: '48.86', lon: '2.36' }
      ])
    });
    const result = await searchHotelLocation('Something');
    assert.equal(result.length, 1);
    assert.equal(result[0].label, 'Good entry');
  });

  test('throws on a non-2xx response', async () => {
    stubFetch({ ok: false, status: 503 });
    await assert.rejects(() => searchHotelLocation('Something'));
  });

  test('returns [] when the response body is not an array (defensive)', async () => {
    stubFetch({ ok: true, json: async () => ({ error: 'unexpected shape' }) });
    const result = await searchHotelLocation('Something');
    assert.deepEqual(result, []);
  });
});
