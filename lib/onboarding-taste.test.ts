import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVibeTree, isNodeActive, shouldDrillIn, tapNode, nodeAtPath,
  mergeTagLists, domainForTag, splitTagsByDomain, getAllDomainTags, buildSwipeCandidatePool,
  CircleNode,
} from './onboarding-taste';
import {
  VIBE_PRESETS, TASTE_DOMAINS,
  FOOD_GENRES_CATEGORIZED, ACTIVITY_GENRES_CATEGORIZED, EVENT_GENRES_CATEGORIZED,
} from '../constants/preferences';

const ALL_TAXONOMY_TAGS = new Set([
  ...FOOD_GENRES_CATEGORIZED.flatMap(g => g.activities),
  ...ACTIVITY_GENRES_CATEGORIZED.flatMap(g => g.activities),
  ...EVENT_GENRES_CATEGORIZED.flatMap(g => g.activities),
]);

describe('VIBE_PRESETS data integrity', () => {
  test('every mapped tag is a real leaf tag from one of the three taxonomies', () => {
    for (const vibe of VIBE_PRESETS) {
      for (const tag of vibe.tags) {
        assert.ok(ALL_TAXONOMY_TAGS.has(tag), `${vibe.key} references invented tag "${tag}"`);
      }
    }
  });

  test('there are 8 vibes, each with a non-empty, deduped tag list', () => {
    assert.equal(VIBE_PRESETS.length, 8);
    for (const vibe of VIBE_PRESETS) {
      assert.ok(vibe.tags.length > 0, `${vibe.key} has no tags`);
      assert.equal(new Set(vibe.tags).size, vibe.tags.length, `${vibe.key} has duplicate tags`);
    }
  });

  test('vibe keys are unique', () => {
    const keys = VIBE_PRESETS.map(v => v.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  test('every vibe has a distinct accent color', () => {
    const colors = VIBE_PRESETS.map(v => v.color);
    assert.equal(new Set(colors).size, colors.length);
  });
});

describe('TASTE_DOMAINS registry', () => {
  test('covers exactly the three existing preferences.* keys', () => {
    assert.deepEqual(TASTE_DOMAINS.map(d => d.key).sort(), ['activityGenres', 'eventGenres', 'foodGenres']);
  });

  test('getAllDomainTags returns all 45 leaves with no duplicates', () => {
    const tags = getAllDomainTags();
    assert.equal(tags.length, 45);
    assert.equal(new Set(tags).size, 45);
  });
});

describe('buildVibeTree', () => {
  const tree = buildVibeTree();

  test('produces one top-level node per vibe', () => {
    assert.equal(tree.length, VIBE_PRESETS.length);
    tree.forEach((node, i) => assert.equal(node.key, VIBE_PRESETS[i].key));
  });

  test('every vibe tag is represented by a leaf child at the front of the list, in order', () => {
    // The flat leaves always come first and are never reordered/removed by the category-node
    // augmentation below — this is the "still fast for the 1-tap path" guarantee.
    tree.forEach((node, i) => {
      const vibeTags = VIBE_PRESETS[i].tags;
      const flatLeaves = node.children?.slice(0, vibeTags.length) ?? [];
      assert.deepEqual(flatLeaves.map(c => c.tags[0]), vibeTags);
      for (const leaf of flatLeaves) assert.equal(leaf.children, undefined);
    });
  });

  test('nodeAtPath resolves a two-level path and returns null for a bad one', () => {
    const foodie = tree.find(n => n.key === 'foodie')!;
    const leaf = nodeAtPath(tree, ['foodie', 'foodie:Cafes']);
    assert.equal(leaf?.label, 'Cafes');
    assert.equal(nodeAtPath(tree, ['not-a-vibe']), null);
    assert.equal(nodeAtPath(tree, []), null);
    assert.equal(nodeAtPath(tree, ['foodie']), foodie);
  });
});

describe('buildVibeTree category-level drill-down augmentation (Part 1 of the taxonomy doc)', () => {
  const tree = buildVibeTree();

  test('foodie keeps only its 4 occasion leaves and gains no cuisine category nodes', () => {
    // Regression test: Foodie's flat leaves (Street Food/Cafes/Local Markets/Festivals) are
    // food *occasions*; Asian/European/Americas are cuisine *origins* — a different axis.
    // Mixing cuisine-origin category nodes into Foodie's own sub-circles (as a prior pass did)
    // was reported live as showing "choices which aren't type of food" under Foodie, so
    // Foodie is back to a purely flat child list. The cuisine leaf tags themselves aren't
    // gone — they still surface via the swipe-refine deck (see buildSwipeCandidatePool tests).
    const foodie = tree.find(n => n.key === 'foodie')!;
    assert.deepEqual(
      foodie.children!.map(c => c.label),
      ['Street Food', 'Cafes', 'Local Markets', 'Festivals']
    );
    assert.ok(foodie.children!.every(c => c.children === undefined));
  });

  test('a category node (e.g. culture -> Arts & Culture) bulk-selects its whole group in one tap, like any other parent', () => {
    const culture = tree.find(n => n.key === 'culture')!;
    const artsAndCulture = culture.children!.find(c => c.label === 'Arts & Culture')!;
    assert.deepEqual(artsAndCulture.tags.sort(), ['Galleries', 'Local Markets', 'Workshops']);
    const { selectedTags, engagedKeys } = tapNode(artsAndCulture, [], []);
    assert.deepEqual(selectedTags.sort(), ['Galleries', 'Local Markets', 'Workshops']);
    assert.deepEqual(engagedKeys, [artsAndCulture.key]);
    assert.equal(isNodeActive(artsAndCulture, selectedTags, engagedKeys), true);
  });

  test('drilling once more into an engaged category node exposes its leaves as individually toggleable', () => {
    const culture = tree.find(n => n.key === 'culture')!;
    const artsAndCulture = culture.children!.find(c => c.label === 'Arts & Culture')!;
    const selected = [...artsAndCulture.tags];
    const engaged = [artsAndCulture.key];
    assert.equal(shouldDrillIn(artsAndCulture, selected, engaged), true);
    const workshops = artsAndCulture.children!.find(c => c.label === 'Workshops')!;
    assert.equal(workshops.children, undefined);
    const next = tapNode(workshops, selected, engaged);
    assert.deepEqual(next.selectedTags.sort(), ['Galleries', 'Local Markets']);
  });

  test('vibes without a clean category-group match (including foodie) keep a purely flat child list', () => {
    for (const key of ['foodie', 'nightlife', 'chill', 'shopping']) {
      const node = tree.find(n => n.key === key)!;
      assert.ok(node.children!.every(c => c.children === undefined), `${key} should have no category-node children`);
    }
  });

  test('every category node wraps a real *_CATEGORIZED group with real leaf tags', () => {
    for (const node of tree) {
      for (const child of node.children ?? []) {
        if (!child.children) continue;
        assert.ok(child.tags.length > 0);
        for (const leaf of child.children) {
          assert.ok(ALL_TAXONOMY_TAGS.has(leaf.tags[0]), `${node.key} -> ${child.label} -> ${leaf.label} is not a real taxonomy tag`);
        }
      }
    }
  });
});

describe('tap/drill-down state machine (generic, depth-agnostic)', () => {
  const tree = buildVibeTree();
  const foodie = tree.find(n => n.key === 'foodie')!; // tags: Street Food, Cafes, Local Markets, Festivals

  test('tapping an unselected top-level node selects its whole bundle and engages it', () => {
    const { selectedTags, engagedKeys } = tapNode(foodie, [], []);
    assert.deepEqual(selectedTags.sort(), [...foodie.tags].sort());
    assert.deepEqual(engagedKeys, ['foodie']);
    assert.equal(isNodeActive(foodie, selectedTags, engagedKeys), true);
  });

  test('tapping an already-engaged node with children drills in, state unchanged', () => {
    const selectedTags = [...foodie.tags];
    const engagedKeys = ['foodie'];
    assert.equal(shouldDrillIn(foodie, selectedTags, engagedKeys), true);
    const next = tapNode(foodie, selectedTags, engagedKeys);
    assert.deepEqual(next, { selectedTags, engagedKeys });
  });

  test('an unengaged node with children does not trigger drill-in even with all tags selected', () => {
    // All of foodie's tags happen to be present, but it was never explicitly engaged.
    assert.equal(shouldDrillIn(foodie, [...foodie.tags], []), false);
  });

  test('a leaf node (no children) toggles off on a second tap instead of drilling', () => {
    const cafesLeaf = foodie.children!.find(c => c.label === 'Cafes')!;
    assert.equal(shouldDrillIn(cafesLeaf, ['Cafes'], []), false);
    const next = tapNode(cafesLeaf, ['Street Food', 'Cafes'], ['foodie']);
    assert.deepEqual(next, { selectedTags: ['Street Food'], engagedKeys: ['foodie'] });
  });

  test('a leaf node toggles on when unselected', () => {
    const cafesLeaf = foodie.children!.find(c => c.label === 'Cafes')!;
    const next = tapNode(cafesLeaf, ['Street Food'], ['foodie']);
    assert.deepEqual(next, { selectedTags: ['Street Food', 'Cafes'], engagedKeys: ['foodie'] });
  });

  test('pruning an engaged parent down to zero of its tags drops it back to inactive', () => {
    // Simulate the user drilling into Foodie and toggling off every sub-tag one at a time.
    // Foodie is purely flat (no category-node children — see the fix above), so slicing to
    // foodie.tags.length here covers every one of its children, not just a subset.
    let selectedTags: string[] = [...foodie.tags];
    let engagedKeys: string[] = ['foodie'];
    const flatLeaves = foodie.children!.slice(0, foodie.tags.length);
    for (const child of flatLeaves) {
      ({ selectedTags, engagedKeys } = tapNode(child, selectedTags, engagedKeys));
    }
    assert.deepEqual(selectedTags, []);
    assert.equal(isNodeActive(foodie, selectedTags, engagedKeys), false);
    // A fresh tap on the now-inactive parent re-seeds the full bundle again.
    const reselected = tapNode(foodie, selectedTags, engagedKeys);
    assert.deepEqual(reselected.selectedTags.sort(), [...foodie.tags].sort());
  });

  test('an engaged parent still glows after a partial prune', () => {
    const withoutCafes = foodie.tags.filter(t => t !== 'Cafes');
    assert.equal(isNodeActive(foodie, withoutCafes, ['foodie']), true);
  });

  test('selecting two vibes unions their tags without duplicating shared ones', () => {
    const nightlife = tree.find(n => n.key === 'nightlife')!; // shares 'Festivals' with foodie
    let selectedTags: string[] = [];
    let engagedKeys: string[] = [];
    ({ selectedTags, engagedKeys } = tapNode(foodie, selectedTags, engagedKeys));
    ({ selectedTags, engagedKeys } = tapNode(nightlife, selectedTags, engagedKeys));
    assert.equal(selectedTags.filter(t => t === 'Festivals').length, 1);
    assert.equal(selectedTags.length, new Set([...foodie.tags, ...nightlife.tags]).size);
    assert.deepEqual(engagedKeys.sort(), ['foodie', 'nightlife']);
  });

  test('a vibe sharing a tag with an already-selected vibe is not falsely shown as engaged, and bulk-selects on tap rather than drilling', () => {
    // Regression case: selecting Foodie pulls in `Festivals`, which Nightlife also seeds.
    // Nightlife must NOT read as already-engaged (and thus wrongly drill in) just because of
    // that incidental tag overlap.
    const nightlife = tree.find(n => n.key === 'nightlife')!;
    const { selectedTags, engagedKeys } = tapNode(foodie, [], []);
    assert.equal(isNodeActive(nightlife, selectedTags, engagedKeys), false);
    assert.equal(shouldDrillIn(nightlife, selectedTags, engagedKeys), false);
    const afterNightlifeTap = tapNode(nightlife, selectedTags, engagedKeys);
    assert.deepEqual(afterNightlifeTap.selectedTags.sort(), Array.from(new Set([...foodie.tags, ...nightlife.tags])).sort());
  });
});

describe('mergeTagLists', () => {
  test('dedups across lists, preserving first-seen order', () => {
    assert.deepEqual(
      mergeTagLists(['A', 'B'], ['B', 'C'], ['A', 'D']),
      ['A', 'B', 'C', 'D']
    );
  });

  test('handles empty input', () => {
    assert.deepEqual(mergeTagLists(), []);
    assert.deepEqual(mergeTagLists([]), []);
  });
});

describe('domainForTag / splitTagsByDomain', () => {
  test('maps a tag from each of the three taxonomies to its domain key', () => {
    assert.equal(domainForTag('Italian'), 'foodGenres');
    assert.equal(domainForTag('Museums'), 'activityGenres');
    assert.equal(domainForTag('Concerts'), 'eventGenres');
  });

  test('unknown tag maps to null', () => {
    assert.equal(domainForTag('Not A Real Tag'), null);
  });

  test('splits a mixed cross-taxonomy pool into the three completeOnboarding buckets', () => {
    const result = splitTagsByDomain(['Street Food', 'Cafes', 'Local Markets', 'Festivals', 'Not A Real Tag']);
    assert.deepEqual(result, {
      foodGenres: ['Street Food', 'Cafes'],
      activityGenres: ['Local Markets'],
      eventGenres: ['Festivals'],
    });
  });

  test('every VIBE_PRESETS tag round-trips through split without being dropped', () => {
    for (const vibe of VIBE_PRESETS) {
      const split = splitTagsByDomain(vibe.tags);
      const total = split.foodGenres.length + split.activityGenres.length + split.eventGenres.length;
      assert.equal(total, vibe.tags.length, `${vibe.key}'s tags were not fully classified`);
    }
  });
});

describe('buildSwipeCandidatePool', () => {
  test('excludes already-selected tags and respects the cap', () => {
    const pool = buildSwipeCandidatePool([], 10);
    assert.equal(pool.length, 10);
  });

  test('excludes tags already selected by the vibe picker', () => {
    const preselected = getAllDomainTags().slice(0, 5);
    const pool = buildSwipeCandidatePool(preselected, 10);
    for (const tag of preselected) {
      assert.ok(!pool.includes(tag));
    }
  });

  test('shrinks below the cap once the only untouched domain has fewer leaves than the cap', () => {
    // Touch one tag each in Food and Activity (enough to skip those domains entirely, per the
    // domain-skip test below), leaving only Event's 15 leaves as candidates against a cap of 20.
    const oneFoodTag = FOOD_GENRES_CATEGORIZED[0].activities[0];
    const oneActivityTag = ACTIVITY_GENRES_CATEGORIZED[0].activities[0];
    const pool = buildSwipeCandidatePool([oneFoodTag, oneActivityTag], 20);
    assert.equal(pool.length, 15);
  });

  test('returns empty once nothing is left', () => {
    const pool = buildSwipeCandidatePool(getAllDomainTags(), 10);
    assert.deepEqual(pool, []);
  });

  // --- Bug fix: a domain the user already engaged with in the vibe picker is skipped
  // entirely, not just the exact tag(s) picked (reported live: picking a food tag under
  // Foodie still surfaced an unrelated "FOOD: Thai" card in the swipe-refine deck) ----------

  test('skips a whole domain once any one of its tags is already selected, not just that exact tag', () => {
    const pool = buildSwipeCandidatePool(['Japanese'], 50); // cap high enough to see everything left
    const foodTags = new Set(FOOD_GENRES_CATEGORIZED.flatMap(g => g.activities));
    assert.ok(
      pool.every(tag => !foodTags.has(tag)),
      'no Food-domain tag (e.g. "Thai") should be proposed once any Food tag is already selected'
    );
  });

  test('a domain with zero selections is left untouched and still proposes its tags', () => {
    const pool = buildSwipeCandidatePool(['Japanese'], 50);
    const activityTags = ACTIVITY_GENRES_CATEGORIZED.flatMap(g => g.activities);
    const eventTags = EVENT_GENRES_CATEGORIZED.flatMap(g => g.activities);
    for (const tag of [...activityTags, ...eventTags]) {
      assert.ok(pool.includes(tag), `${tag} should still be proposed — its domain has no selections`);
    }
  });

  test('a category-node bulk-selection (e.g. tapping Asian under Foodie pre-fix, or any multi-tag pick) blocks the whole domain', () => {
    const pool = buildSwipeCandidatePool(['Chinese', 'Japanese', 'Thai'], 50);
    const foodTags = new Set(FOOD_GENRES_CATEGORIZED.flatMap(g => g.activities));
    assert.ok(pool.every(tag => !foodTags.has(tag)));
  });
});
