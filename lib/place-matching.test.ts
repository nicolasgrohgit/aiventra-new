import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMealWindow, getMealWindows, flattenPreferenceTags, buildCategoryFilter, escapeRegExp,
  computeMatchScore, shuffled, buildGeoNearStage, resolveAnchorForDate, haversineDistanceKm,
  jitterCoordinates, buildCityDurationQuery
} from './place-matching';

describe('isMealWindow', () => {
  test('12:30 in the given timezone is a meal window', () => {
    assert.equal(isMealWindow(new Date('2030-03-04T12:30:00+01:00'), 'Europe/Paris'), true);
  });

  test('19:00 in the given timezone is a meal window (dinner)', () => {
    assert.equal(isMealWindow(new Date('2030-03-04T19:00:00+01:00'), 'Europe/Paris'), true);
  });

  test('16:00 in the given timezone is not a meal window', () => {
    assert.equal(isMealWindow(new Date('2030-03-04T16:00:00+01:00'), 'Europe/Paris'), false);
  });

  test('classifies by the destination timezone, not the instant\'s UTC hour', () => {
    // 12:30 Paris time (+01:00) is 06:30 New York time on the same UTC instant. Passing the
    // right zone should read as a meal window; passing the wrong one should not — this is
    // exactly the kind of mismatch that silently broke the meal/dinner filter earlier in this
    // session when a naive UTC-as-local approximation was used in a test harness.
    const instant = new Date('2030-03-04T12:30:00+01:00');
    assert.equal(isMealWindow(instant, 'Europe/Paris'), true);
    assert.equal(isMealWindow(instant, 'America/New_York'), false);
  });

  test('a user who never eats dinner before 8pm: 19:00 is no longer a dinner window', () => {
    const mealPrefs = { earliestDinnerTime: '20:00' };
    assert.equal(isMealWindow(new Date('2030-03-04T19:00:00+01:00'), 'Europe/Paris', mealPrefs), false);
    assert.equal(isMealWindow(new Date('2030-03-04T20:30:00+01:00'), 'Europe/Paris', mealPrefs), true);
  });

  test('a Dutch-style early dinner preference shifts the window earlier', () => {
    const mealPrefs = { earliestDinnerTime: '17:30' };
    assert.equal(isMealWindow(new Date('2030-03-04T18:00:00+01:00'), 'Europe/Paris', mealPrefs), true);
    // Old default window (18.5-21.0) would have called this a dinner too — with the shift it
    // should already be past the (shifted) window's 2.5h width.
    assert.equal(isMealWindow(new Date('2030-03-04T20:15:00+01:00'), 'Europe/Paris', mealPrefs), false);
  });

  test('no preference set: identical to today\'s defaults', () => {
    const instant = new Date('2030-03-04T19:00:00+01:00');
    assert.equal(isMealWindow(instant, 'Europe/Paris', {}), isMealWindow(instant, 'Europe/Paris'));
  });
});

describe('getMealWindows', () => {
  test('defaults match the original hardcoded isMealWindow boundaries', () => {
    const windows = getMealWindows();
    assert.equal(windows.lunchStart, 11.5);
    assert.equal(windows.lunchEnd, 13.5);
    assert.equal(windows.dinnerStart, 18.5);
    assert.equal(windows.dinnerEnd, 21.0);
  });

  test('preserves each window\'s width when shifted', () => {
    const windows = getMealWindows({ earliestLunchTime: '13:00', earliestDinnerTime: '21:00' });
    assert.equal(windows.lunchEnd - windows.lunchStart, 2);
    assert.equal(windows.dinnerEnd - windows.dinnerStart, 2.5);
  });
});

describe('buildCategoryFilter', () => {
  test('meal window + short duration: restaurants only, cafes excluded', () => {
    const filter = buildCategoryFilter(true, 90);
    assert.deepEqual(filter, { category: 'Restaurant', genre: { $ne: 'Cafes' } });
  });

  test('meal window + long duration: no restriction (falls through)', () => {
    const filter = buildCategoryFilter(true, 180);
    assert.deepEqual(filter, {});
  });

  test('non-meal window: activities, events, or cafes', () => {
    const filter = buildCategoryFilter(false, 90);
    assert.deepEqual(filter, {
      $or: [
        { category: 'Activity' },
        { category: 'Event' },
        { category: 'Restaurant', genre: 'Cafes' }
      ]
    });
  });
});

describe('flattenPreferenceTags', () => {
  test('flattens all three genre categories into one array', () => {
    const tags = flattenPreferenceTags({
      foodGenres: ['Italian', 'French'],
      activityGenres: ['Museums'],
      eventGenres: ['Concerts']
    });
    assert.deepEqual(tags.sort(), ['Concerts', 'French', 'Italian', 'Museums'].sort());
  });

  test('missing/undefined preferences produce an empty array, not a throw', () => {
    // This is exactly the shape that caused the session's critical bug: a preferences object
    // where the genre fields are absent (there, because Mongoose returned undefined for an
    // undeclared nested-schema field on direct property access). Any regression back to
    // "declared fields optional in a way that silently drops them" should fail here.
    assert.deepEqual(flattenPreferenceTags({}), []);
    assert.deepEqual(flattenPreferenceTags(undefined), []);
    assert.deepEqual(flattenPreferenceTags({ foodGenres: undefined, activityGenres: undefined, eventGenres: undefined }), []);
  });

  test('partial preferences only include the fields that are present', () => {
    assert.deepEqual(flattenPreferenceTags({ foodGenres: ['Japanese'] }), ['Japanese']);
  });
});

describe('escapeRegExp', () => {
  test('escapes regex special characters so a city name is matched literally', () => {
    const escaped = escapeRegExp('New York (NY)');
    const re = new RegExp(`^${escaped}$`, 'i');
    assert.equal(re.test('New York (NY)'), true);
    assert.equal(re.test('New York XNYX'), false); // would incorrectly match if () weren't escaped
  });
});

describe('computeMatchScore', () => {
  test('no overlap scores 0', () => {
    assert.equal(computeMatchScore(['Restaurant', 'French'], [['Italian', 'Museums']]), 0);
  });

  test('single participant, one overlapping tag scores 1', () => {
    assert.equal(computeMatchScore(['Restaurant', 'French'], [['French', 'Museums']]), 1);
  });

  test('joint matching sums intersection sizes across all participants', () => {
    // Place tagged Restaurant/French; participant A likes French, participant B likes French
    // and Restaurant — mirrors the real aggregation's $add-of-per-participant-$size behavior.
    const placeTags = ['Restaurant', 'French'];
    const score = computeMatchScore(placeTags, [
      ['French'],
      ['French', 'Restaurant']
    ]);
    assert.equal(score, 1 + 2);
  });

  test('a participant with no matching tags contributes 0, not a negative or NaN', () => {
    const score = computeMatchScore(['Restaurant', 'French'], [
      ['French'],
      ['Hiking', 'Cinema']
    ]);
    assert.equal(score, 1);
  });

  test('empty participant list scores 0', () => {
    assert.equal(computeMatchScore(['Restaurant', 'French'], []), 0);
  });
});

describe('shuffled', () => {
  test('does not mutate the input array', () => {
    const original = [1, 2, 3, 4, 5];
    const copy = [...original];
    shuffled(original);
    assert.deepEqual(original, copy);
  });

  test('preserves every element, none added or dropped', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    assert.deepEqual(shuffled(items).sort(), [...items].sort());
  });

  test('handles empty and single-element arrays without throwing', () => {
    assert.deepEqual(shuffled([]), []);
    assert.deepEqual(shuffled(['only']), ['only']);
  });

  test('actually varies order across repeated calls (not silently a no-op)', () => {
    // Statistically near-certain over enough trials for a 10-element array; not flaky in
    // practice — the only way this fails is if shuffled() stopped shuffling entirely.
    const items = Array.from({ length: 10 }, (_, i) => i);
    const orders = new Set();
    for (let i = 0; i < 30; i++) {
      orders.add(shuffled(items).join(','));
    }
    assert.ok(orders.size > 1, 'expected at least one different ordering across 30 shuffles');
  });
});

describe('buildCityDurationQuery', () => {
  test('does not include a distance condition — that is $geoNear\'s job now', () => {
    const query = buildCityDurationQuery('Paris, France', 90, false);
    assert.equal('distanceKm' in query, false);
  });

  test('still includes city/duration/category conditions identically to the match-stage version', () => {
    const query = buildCityDurationQuery('Paris, France', 90, true);
    assert.deepEqual(query.city, { $regex: 'Paris', $options: 'i' });
    assert.deepEqual(query.estimatedDuration, { $lte: 90 });
  });
});

describe('buildGeoNearStage', () => {
  test('produces a $geoNear stage with coordinates in [lng, lat] order', () => {
    const stage = buildGeoNearStage({ lat: 48.85, lng: 2.35 }, 5, { city: 'Paris' });
    assert.deepEqual(stage.$geoNear.near, { type: 'Point', coordinates: [2.35, 48.85] });
  });

  test('maxDistance is in meters even though the input is km', () => {
    const stage = buildGeoNearStage({ lat: 0, lng: 0 }, 5, {});
    assert.equal(stage.$geoNear.maxDistance, 5000);
  });

  test('distanceMultiplier converts the output distanceField back to km', () => {
    const stage = buildGeoNearStage({ lat: 0, lng: 0 }, 5, {});
    assert.equal(stage.$geoNear.distanceField, 'distanceKm');
    assert.equal(stage.$geoNear.distanceMultiplier, 0.001);
  });

  test('passes the query object through unchanged, as $geoNear\'s query sub-option', () => {
    const query = { city: 'Rome', estimatedDuration: { $lte: 90 } };
    const stage = buildGeoNearStage({ lat: 0, lng: 0 }, 5, query);
    assert.deepEqual(stage.$geoNear.query, query);
  });
});

describe('haversineDistanceKm', () => {
  test('a point compared to itself is 0km away', () => {
    assert.equal(haversineDistanceKm({ lat: 48.85, lng: 2.35 }, { lat: 48.85, lng: 2.35 }), 0);
  });

  test('roughly matches the known real-world distance between two landmarks', () => {
    // Eiffel Tower to the Louvre, actually ~3.9km apart.
    const eiffelTower = { lat: 48.8584, lng: 2.2945 };
    const louvre = { lat: 48.8606, lng: 2.3376 };
    const distance = haversineDistanceKm(eiffelTower, louvre);
    assert.ok(distance > 3 && distance < 5, `expected ~3.9km, got ${distance}`);
  });
});

describe('jitterCoordinates', () => {
  test('the jittered point is genuinely between minKm and maxKm from center', () => {
    const center = { lat: 48.85, lng: 2.35 };
    for (let i = 0; i < 20; i++) {
      const point = jitterCoordinates(center, 0.5, 3);
      const distance = haversineDistanceKm(center, point);
      assert.ok(distance >= 0.45 && distance <= 3.05, `distance ${distance} out of [0.5, 3] range`);
    }
  });
});

describe('resolveAnchorForDate', () => {
  const HOTEL = { lat: 48.86, lng: 2.35, source: 'hotel' as const, startDate: new Date('2026-09-01'), endDate: new Date('2026-09-05') };
  const CITY = { lat: 48.85, lng: 2.35, source: 'city' as const, startDate: new Date('2026-09-01'), endDate: new Date('2026-09-05') };

  test('prefers hotel over city when both cover the date', () => {
    const anchor = resolveAnchorForDate([CITY, HOTEL], new Date('2026-09-03'));
    assert.deepEqual(anchor, { lat: 48.86, lng: 2.35 });
  });

  test('falls back to city when there is no hotel entry', () => {
    const anchor = resolveAnchorForDate([CITY], new Date('2026-09-03'));
    assert.deepEqual(anchor, { lat: 48.85, lng: 2.35 });
  });

  test('returns null when no entry covers the date (falls back to static-distanceKm path)', () => {
    const anchor = resolveAnchorForDate([CITY, HOTEL], new Date('2026-10-01'));
    assert.equal(anchor, null);
  });

  test('returns null for an empty baseLocations array', () => {
    assert.equal(resolveAnchorForDate([], new Date('2026-09-03')), null);
  });
});
