// Pure logic behind the "Pick your vibe" circle picker + capped swipe-refine deck in
// app/onboarding.tsx. Kept decoupled from React Native (per CLAUDE.md's `lib/` convention)
// so the drill-down state machine and tag merge/split logic are unit-testable without
// mounting any component — see lib/onboarding-taste.test.ts.

import { TASTE_DOMAINS, VIBE_PRESETS, TasteDomain } from '@/constants/preferences';

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

// Builds the top-level circle-cluster tree from VIBE_PRESETS. Each vibe's sub-circles are
// derived mechanically from its own `tags` list (one leaf CircleNode per tag) rather than
// being hand-declared per vibe, so adding a 9th vibe to VIBE_PRESETS needs no changes here.
export function buildVibeTree(): CircleNode[] {
  return VIBE_PRESETS.map(vibe => ({
    key: vibe.key,
    label: vibe.label,
    emoji: vibe.emoji,
    color: vibe.color,
    tags: vibe.tags,
    children: vibe.tags.map(tag => ({
      key: `${vibe.key}:${tag}`,
      label: tag,
      emoji: '',
      color: vibe.color,
      tags: [tag],
    })),
  }));
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
