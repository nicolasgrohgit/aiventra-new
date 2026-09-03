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

  test('foodie keeps its 4 existing occasion leaves AND gains Asian/European/Americas category nodes', () => {
    const foodie = tree.find(n => n.key === 'foodie')!;
    assert.deepEqual(
      foodie.children!.slice(0, 4).map(c => c.label),
      ['Street Food', 'Cafes', 'Local Markets', 'Festivals']
    );
    const categoryChildren = foodie.children!.filter(c => !!c.children);
    assert.deepEqual(categoryChildren.map(c => c.label).sort(), ['Americas', 'Asian', 'European']);
  });

  test('a category node (e.g. Asian) bulk-selects its whole cuisine group in one tap, like any other parent', () => {
    const foodie = tree.find(n => n.key === 'foodie')!;
    const asian = foodie.children!.find(c => c.label === 'Asian')!;
    assert.deepEqual(asian.tags.sort(), ['Chinese', 'Japanese', 'Thai']);
    const { selectedTags, engagedKeys } = tapNode(asian, [], []);
    assert.deepEqual(selectedTags.sort(), ['Chinese', 'Japanese', 'Thai']);
    assert.deepEqual(engagedKeys, [asian.key]);
    assert.equal(isNodeActive(asian, selectedTags, engagedKeys), true);
  });

  test('drilling once more into an engaged Asian exposes Japanese/Chinese/Thai as individually toggleable leaves', () => {
    const foodie = tree.find(n => n.key === 'foodie')!;
    const asian = foodie.children!.find(c => c.label === 'Asian')!;
    const selected = [...asian.tags];
    const engaged = [asian.key];
    assert.equal(shouldDrillIn(asian, selected, engaged), true);
    const japanese = asian.children!.find(c => c.label === 'Japanese')!;
    assert.equal(japanese.children, undefined);
    const next = tapNode(japanese, selected, engaged);
    assert.deepEqual(next.selectedTags.sort(), ['Chinese', 'Thai']);
  });

  test('vibes without a clean category-group match keep a purely flat child list', () => {
    for (const key of ['nightlife', 'chill', 'shopping']) {
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
    // Only the flat leaves represent foodie.tags directly — the category nodes (Asian/etc.)
    // are additional children that don't seed any of foodie.tags, so looping over them too
    // would bulk-*add* cuisine tags instead of pruning, which isn't what this test simulates.
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

  test('shrinks below the cap once the remaining gap is smaller than it', () => {
    const almostEverything = getAllDomainTags().slice(0, 40); // 45 total, 5 left
    const pool = buildSwipeCandidatePool(almostEverything, 10);
    assert.equal(pool.length, 5);
  });

  test('returns empty once nothing is left', () => {
    const pool = buildSwipeCandidatePool(getAllDomainTags(), 10);
    assert.deepEqual(pool, []);
  });
});
