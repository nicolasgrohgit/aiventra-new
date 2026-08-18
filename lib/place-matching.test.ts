import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isMealWindow, flattenPreferenceTags, buildCategoryFilter, escapeRegExp, computeMatchScore } from './place-matching';

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
