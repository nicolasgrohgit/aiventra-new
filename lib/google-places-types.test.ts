import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLACES_TYPE_MAPPINGS,
  getAllTaxonomyTags,
  getPlaceTypesForTag,
  getMatchQualityForTag,
  hasGoogleMatch,
  tagsForPlaceTypes,
  supportsScheduleData,
} from './google-places-types';

describe('taxonomy coverage', () => {
  test('every leaf tag in constants/preferences.ts has exactly one mapping entry', () => {
    const taxonomyTags = getAllTaxonomyTags();
    const mappedTags = PLACES_TYPE_MAPPINGS.map(m => m.tag);
    assert.deepEqual([...mappedTags].sort(), [...taxonomyTags].sort());
  });

  test('no duplicate tags in the mapping table', () => {
    const tags = PLACES_TYPE_MAPPINGS.map(m => m.tag);
    assert.equal(new Set(tags).size, tags.length);
  });

  test('quality "none" mappings carry no place types, and vice versa', () => {
    for (const mapping of PLACES_TYPE_MAPPINGS) {
      if (mapping.quality === 'none') {
        assert.deepEqual(mapping.placeTypes, [], `${mapping.tag} is 'none' but has placeTypes`);
      } else {
        assert.ok(mapping.placeTypes.length > 0, `${mapping.tag} is '${mapping.quality}' but has no placeTypes`);
      }
    }
  });
});

describe('getPlaceTypesForTag / getMatchQuality / hasGoogleMatch', () => {
  test('direct match returns its place types', () => {
    assert.deepEqual(getPlaceTypesForTag('Italian'), ['italian_restaurant']);
    assert.equal(getMatchQualityForTag('Italian'), 'direct');
    assert.equal(hasGoogleMatch('Italian'), true);
  });

  test('structurally unmatched activity tag (no route data in Places API)', () => {
    assert.deepEqual(getPlaceTypesForTag('Walking Tours'), []);
    assert.equal(getMatchQualityForTag('Walking Tours'), 'none');
    assert.equal(hasGoogleMatch('Walking Tours'), false);
  });

  test('unknown tag behaves as unmatched rather than throwing', () => {
    assert.deepEqual(getPlaceTypesForTag('Not A Real Tag'), []);
    assert.equal(getMatchQualityForTag('Not A Real Tag'), 'none');
    assert.equal(hasGoogleMatch('Not A Real Tag'), false);
  });
});

describe('tagsForPlaceTypes (reverse lookup)', () => {
  test('a single returned type maps back to its tag', () => {
    assert.deepEqual(tagsForPlaceTypes(['italian_restaurant']), ['Italian']);
  });

  test('a type shared by multiple tags returns all of them', () => {
    // 'market' is the direct match for both the Activity tag "Local Markets" and the Event
    // tag "Markets" — a real returned place can satisfy both.
    const tags = tagsForPlaceTypes(['market']);
    assert.ok(tags.includes('Local Markets'));
    assert.ok(tags.includes('Markets'));
  });

  test('unrecognized or unmapped types produce no tags', () => {
    assert.deepEqual(tagsForPlaceTypes(['gas_station']), []);
  });

  test('multiple input types are merged without duplicates', () => {
    // 'museum' alone also satisfies "Exhibitions" (art_gallery/museum/convention_center);
    // 'art_museum' only satisfies "Museums" — union of both, no repeats.
    assert.deepEqual(tagsForPlaceTypes(['museum', 'art_museum']).sort(), ['Exhibitions', 'Museums']);
  });
});

describe('supportsScheduleData', () => {
  test('Event category never has real schedule data, regardless of venue-type quality', () => {
    assert.equal(supportsScheduleData('Event'), false);
  });

  test('Restaurant and Activity categories are not schedule-based content', () => {
    assert.equal(supportsScheduleData('Restaurant'), true);
    assert.equal(supportsScheduleData('Activity'), true);
  });

  test('every Event-category mapping is documented as venue-only, not schedule data', () => {
    const eventMappings = PLACES_TYPE_MAPPINGS.filter(m => m.category === 'Event' && m.quality !== 'none');
    for (const mapping of eventMappings) {
      assert.ok(mapping.note, `${mapping.tag} has a Places match but no caveat note explaining it's venue-only`);
    }
  });
});
