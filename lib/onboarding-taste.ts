// Pure logic behind the "Pick your vibe" circle picker + capped swipe-refine deck in
// app/onboarding.tsx. Kept decoupled from React Native (per CLAUDE.md's `lib/` convention)
// so the drill-down state machine and tag merge/split logic are unit-testable without
// mounting any component — see lib/onboarding-taste.test.ts.

import {
  TASTE_DOMAINS, VIBE_PRESETS, TasteDomain,
  PreferenceCategoryGroup, FOOD_GENRES_CATEGORIZED, ACTIVITY_GENRES_CATEGORIZED, EVENT_GENRES_CATEGORIZED,
} from '@/constants/preferences';

// --- Generic circle-cluster tree -------------------------------------------------------
//
// A CircleNode is deliberately depth-agnostic: today VIBE_PRESETS only produces two levels
// (8 top-level vibes, each with 4-5 leaf-tag children), but the tap/drill-down handling below
// doesn't assume that — a node with `children` drills in on a second tap, a node without
// `children` just toggles on/off, at whatever depth it's found. That's what "build it
// generically, not hardcoded per-vibe" (per the task spec) actually means in code: there is
// no per-vibe branching anywhere in this file.
export interface CircleNode {
  key: string;
  label: string;
  emoji: string;
  color: string;
  // The full set of leaf tags this node represents. For a leaf node (no children) this is
  // always a single tag. For a parent node it's every tag its children collectively cover —
  // this is what "select this node" adds/removes in one shot.
  tags: string[];
  children?: CircleNode[];
}

// --- Category-level drill-down augmentation (Part 1 of docs/taxonomy-and-social-notifications-plan.md) --
//
// VIBE_PRESETS' flat tag lists are broad, hand-curated bundles by design (see that file's own
// comment) — they deliberately don't reach cuisine-level (Japanese vs. Chinese) or other
// fine-grained leaves within a *_CATEGORIZED group. That's fine for the fast "just tap Foodie
// and move on" path, but leaves no way for someone who *does* want to specify something finer
// to do so from the vibe picker at all (reported live: tapping Foodie never surfaces a single
// real cuisine tag). The table below appends real PreferenceCategoryGroup nodes as *additional*
// children on specific vibes — it never removes or replaces any of a vibe's existing flat
// leaves, only adds a further drill-in option alongside them, so the 1-tap "select the whole
// vibe" path is completely unaffected and the new depth is purely opt-in.
//
// Each group listed here is thematically core to that vibe's persona AND not already
// substantially reachable through the vibe's own flat tags (at most one incidental tag overlap
// tolerated — the same "a real tag can legitimately signal more than one persona" reuse
// philosophy VIBE_PRESETS' own comments already apply to cross-vibe tag sharing, e.g. `Scenic
// Drives` appearing in 3 vibes). A group already 2-3/3 covered by a vibe's flat tags is
// deliberately left alone: wrapping tags the vibe already exposes directly as top-level leaves
// would just add a redundant extra tap to reach the exact same tags, not new depth. Only 5 of
// the 8 vibes clear that bar — Nightlife & Live Music (`Live Music` is already 3/3 flat),
// Chill & Relax (`Relaxation` is already 3/3 flat) and Shopping & Markets (no group is both
// thematically tight and meaningfully under-covered) don't get a category node and keep
// today's pure-flat structure, per the task's explicit "skip where it doesn't cleanly cluster."
const VIBE_CATEGORY_LINKS: Record<string, PreferenceCategoryGroup[]> = {
  // The doc's own worked example: Foodie's flat tags (Street Food/Cafes/Local Markets/
  // Festivals) touch zero real cuisine leaves. Cuisine is the obvious "go one level deeper"
  // axis for a food vibe, so all three cuisine groups are added (Dining Style/Specialty are
  // deliberately left out — Street Food/Cafes already represent them at the top level).
  foodie: [
    findGroup(FOOD_GENRES_CATEGORIZED, 'Asian'),
    findGroup(FOOD_GENRES_CATEGORIZED, 'European'),
    findGroup(FOOD_GENRES_CATEGORIZED, 'Americas'),
  ],
  // Culture's own name is this activity category's name; only `Galleries` overlaps today —
  // Workshops/Local Markets are net-new, museum-adjacent ways to engage with a city's culture.
  culture: [findGroup(ACTIVITY_GENRES_CATEGORIZED, 'Arts & Culture')],
  // Outdoor & Nature is already 3/3 covered by Outdoors' own flat tags (Hiking/Cycling/Water
  // Sports), so wrapping it adds nothing. Tours & Excursions is zero-overlap and a natural
  // "how do you want to explore" axis (walking/boat/bus tours) for an outdoors-minded vibe.
  outdoors: [findGroup(ACTIVITY_GENRES_CATEGORIZED, 'Tours & Excursions')],
  // Performing Arts is already 3/3 covered (Theater/Ballet/Opera). Entertainment is zero-
  // overlap and a natural "arts, but lighter" axis (comedy/cinema/magic) for the same persona.
  arts: [findGroup(EVENT_GENRES_CATEGORIZED, 'Entertainment')],
  // Attractions & Sights is already 2/3 covered (Viewpoints/Monuments) so it's excluded per the
  // already-covered rule above. Tours & Excursions has one incidental overlap (Boat Cruises,
  // already a Scenic flat tag — the tolerated single-tag case) and fits "sightseeing via a
  // guided tour" well for a scenic/viewing-focused vibe.
  scenic: [findGroup(ACTIVITY_GENRES_CATEGORIZED, 'Tours & Excursions')],
};

function findGroup(groups: PreferenceCategoryGroup[], type: string): PreferenceCategoryGroup {
  const group = groups.find(g => g.type === type);
  if (!group) throw new Error(`onboarding-taste: unknown category group "${type}"`);
  return group;
}

// Wraps one real PreferenceCategoryGroup as a CircleNode: the category itself is a parent node
// (tags = every leaf it covers, for one-tap bulk-select, matching every other parent node's
// behavior) whose children are that group's own leaves, individually toggleable one drill-in
// deeper — e.g. Foodie -> Asian -> Japanese/Chinese/Thai.
function buildCategoryNode(vibeKey: string, color: string, group: PreferenceCategoryGroup): CircleNode {
  return {
    key: `${vibeKey}:cat:${group.type}`,
    label: group.type,
    emoji: '',
    color,
    tags: [...group.activities],
    children: group.activities.map(tag => ({
      key: `${vibeKey}:cat:${group.type}:${tag}`,
      label: tag,
      emoji: '',
      color,
      tags: [tag],
    })),
  };
}

// Builds the top-level circle-cluster tree from VIBE_PRESETS. Each vibe's sub-circles are
// derived mechanically from its own `tags` list (one leaf CircleNode per tag, in order) plus,
// for the vibes named in VIBE_CATEGORY_LINKS above, one or more appended category nodes that
// drill one level deeper into a real *_CATEGORIZED group — so adding a 9th vibe (or a 9th
// category link) to either table needs no changes here. The flat leaves always come first and
// are never reordered/removed, so any code relying on "the first N children mirror vibe.tags
// in order" (see lib/onboarding-taste.test.ts) still holds regardless of what's appended after.
export function buildVibeTree(): CircleNode[] {
  return VIBE_PRESETS.map(vibe => {
    const flatLeaves: CircleNode[] = vibe.tags.map(tag => ({
      key: `${vibe.key}:${tag}`,
      label: tag,
      emoji: '',
      color: vibe.color,
      tags: [tag],
    }));
    const categoryNodes = (VIBE_CATEGORY_LINKS[vibe.key] ?? [])
      .map(group => buildCategoryNode(vibe.key, vibe.color, group));
    return {
      key: vibe.key,
      label: vibe.label,
      emoji: vibe.emoji,
      color: vibe.color,
      tags: vibe.tags,
      children: [...flatLeaves, ...categoryNodes],
    };
  });
}

// Tags are a flat, deliberately un-namespaced pool (per the task's own framing — the vibe
// picker and swipe deck both work over "one cross-cutting pool"), and VIBE_PRESETS
// intentionally reuses the same real tag across multiple vibes (`Festivals` seeds both
// Foodie and Nightlife, etc). That means tag-membership alone can't tell "the user explicitly
// picked this vibe" apart from "one of this vibe's tags happens to be selected only because a
// *different* vibe also seeds it" — tapping Nightlife should bulk-add its whole bundle even if
// Foodie already pulled in `Festivals`, not silently treat Nightlife as already-engaged and
// drill in with 3 of its 4 tags still missing. `engagedKeys` (parent/vibe node keys the user
// has explicitly selected or drilled into at least once) is the extra bit of state that
// disambiguates this — leaf tag-nodes don't need it since they represent exactly one tag with
// no aliasing problem.
//
// A parent node reads as active/glowing only when BOTH are true: the user explicitly engaged
// it, AND at least one of its tags currently survives in selectedTags (so pruning a vibe's
// sub-tags down to zero — including via the shared-tag interaction above — correctly drops it
// back to unselected, and a following tap re-seeds the full bundle rather than drilling into
// an now-empty node). A leaf node's active state is just plain tag membership.
export function isNodeActive(node: CircleNode, selectedTags: string[], engagedKeys: string[] = []): boolean {
  const hasChildren = !!node.children && node.children.length > 0;
  const tagPresent = node.tags.some(t => selectedTags.includes(t));
  if (!hasChildren) return tagPresent;
  return engagedKeys.includes(node.key) && tagPresent;
}

// True when tapping this node should push a drill-down level (it's already active AND has
// somewhere to drill into) rather than toggle a plain selection.
export function shouldDrillIn(node: CircleNode, selectedTags: string[], engagedKeys: string[] = []): boolean {
  return !!node.children && node.children.length > 0 && isNodeActive(node, selectedTags, engagedKeys);
}

export interface TapResult {
  selectedTags: string[];
  engagedKeys: string[];
}

// The core interaction rule, applied uniformly at every depth:
// - unselected -> selected: add every tag this node represents, and (for a node with
//   children) record it as explicitly engaged.
// - selected + has children: drilling in doesn't change the tag/engagement state by itself
//   (the caller is expected to also check shouldDrillIn and push a path) — unchanged.
// - selected + no children (a leaf): a second tap can't drill anywhere, so it toggles off.
export function tapNode(node: CircleNode, selectedTags: string[], engagedKeys: string[] = []): TapResult {
  const active = isNodeActive(node, selectedTags, engagedKeys);
  const hasChildren = !!node.children && node.children.length > 0;
  if (!active) {
    return {
      selectedTags: mergeTagLists(selectedTags, node.tags),
      engagedKeys: hasChildren ? mergeTagLists(engagedKeys, [node.key]) : engagedKeys,
    };
  }
  if (hasChildren) {
    return { selectedTags, engagedKeys }; // drill-in only, no change
  }
  return { selectedTags: selectedTags.filter(t => !node.tags.includes(t)), engagedKeys };
}

// Walks a path of node keys (root -> ... -> current) down the tree, returning the node at
// that path, or null if the path doesn't resolve (e.g. stale path after data changes).
export function nodeAtPath(tree: CircleNode[], path: string[]): CircleNode | null {
  let level = tree;
  let node: CircleNode | null = null;
  for (const key of path) {
    node = level.find(n => n.key === key) ?? null;
    if (!node) return null;
    level = node.children ?? [];
  }
  return node;
}

// --- Tag merge/split helpers -------------------------------------------------------------

// Dedups while preserving first-seen order — used both for unioning a node's tags into the
// current selection and for combining vibe picks + swipe-deck picks into one final pool.
export function mergeTagLists(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const tag of list) {
      if (!seen.has(tag)) {
        seen.add(tag);
        out.push(tag);
      }
    }
  }
  return out;
}

// Which taste domain (and therefore which User.preferences.* bucket) a given leaf tag belongs
// to, or null if it isn't a real taxonomy tag at all (defensive — should never happen for tags
// that only ever came from VIBE_PRESETS or TASTE_DOMAINS themselves).
export function domainForTag(tag: string): TasteDomain['key'] | null {
  for (const domain of TASTE_DOMAINS) {
    for (const group of domain.taxonomy) {
      if (group.activities.includes(tag)) return domain.key;
    }
  }
  return null;
}

export interface DomainTagSets {
  foodGenres: string[];
  activityGenres: string[];
  eventGenres: string[];
}

// Splits one flat cross-taxonomy tag pool (the shape the vibe picker + swipe deck both work
// in) back into the three separate arrays completeOnboarding() expects. Unrecognized tags are
// silently dropped rather than thrown on — defensive, since this only ever runs on tags that
// originated from real taxonomy data in this same codebase, but a dropped bad tag is a much
// safer failure mode here than crashing onboarding.
export function splitTagsByDomain(tags: string[]): DomainTagSets {
  const result: DomainTagSets = { foodGenres: [], activityGenres: [], eventGenres: [] };
  for (const tag of tags) {
    const domain = domainForTag(tag);
    if (domain) result[domain].push(tag);
  }
  return result;
}

// --- Swipe-refine deck candidate pool -----------------------------------------------------

// Every leaf tag across all registered taste domains, in taxonomy order.
export function getAllDomainTags(): string[] {
  return TASTE_DOMAINS.flatMap(d => d.taxonomy.flatMap(g => g.activities));
}

// The capped swipe-deck's candidate pool: every taxonomy tag NOT already selected by the vibe
// picker, capped at `cap` (default 10 per docs/onboarding-redesign.md). Drawing from the gap
// rather than the whole taxonomy is what keeps the deck short even as TASTE_DOMAINS grows.
export function buildSwipeCandidatePool(alreadySelected: string[], cap = 10): string[] {
  const selected = new Set(alreadySelected);
  const remaining = getAllDomainTags().filter(t => !selected.has(t));
  return remaining.slice(0, cap);
}
