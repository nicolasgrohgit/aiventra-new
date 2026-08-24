import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildMapsUrl } from './maps-link';

describe('buildMapsUrl', () => {
  test('prefers coordinates when present, formatted as lat,lng even though input is [lng, lat]', () => {
    const url = buildMapsUrl({ name: 'Musee d\'Orsay', location: { coordinates: [2.3266, 48.8600] } });
    assert.equal(url, 'https://www.google.com/maps/dir/?api=1&destination=48.86,2.3266');
  });

  test('falls back to a "name, address" text query when there are no coordinates', () => {
    const url = buildMapsUrl({ name: 'Le Petit Cafe', address: '12 Rue de Rivoli, Paris' });
    assert.equal(
      url,
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('Le Petit Cafe, 12 Rue de Rivoli, Paris')}`
    );
  });

  test('falls back to "name, city" when there is no address either', () => {
    const url = buildMapsUrl({ name: 'Local Amsterdam Cafe', city: 'Amsterdam, Netherlands' });
    assert.equal(
      url,
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('Local Amsterdam Cafe, Amsterdam, Netherlands')}`
    );
  });

  test('falls back to just the name when neither address nor city is available', () => {
    const url = buildMapsUrl({ name: 'Mystery Spot' });
    assert.equal(url, `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('Mystery Spot')}`);
  });

  test('prefers address over city when both are present', () => {
    const url = buildMapsUrl({ name: 'Bistro X', address: '5 Rue Cler, Paris', city: 'Paris, France' });
    assert.equal(
      url,
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('Bistro X, 5 Rue Cler, Paris')}`
    );
  });

  test('ignores malformed/empty coordinates and falls back to text query', () => {
    const url = buildMapsUrl({ name: 'Bad Coords Place', city: 'Rome, Italy', location: { coordinates: [] as any } });
    assert.equal(
      url,
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('Bad Coords Place, Rome, Italy')}`
    );
  });
});
