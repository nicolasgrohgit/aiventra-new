// Categorized taste-preference options, shared by onboarding and Profile's "Edit" modals.

export interface PreferenceCategoryGroup {
  type: string;
  activities: string[];
}

export const FOOD_GENRES_CATEGORIZED: PreferenceCategoryGroup[] = [
  { type: 'European', activities: ['Italian', 'French', 'Mediterranean'] },
  { type: 'Asian', activities: ['Japanese', 'Chinese', 'Thai'] },
  { type: 'Americas', activities: ['Mexican', 'American', 'Brazilian'] },
  { type: 'Dining Style', activities: ['Fine Dining', 'Fast Food', 'Street Food'] },
  { type: 'Specialty', activities: ['Seafood', 'Steakhouses', 'Cafes'] },
];

export const ACTIVITY_GENRES_CATEGORIZED: PreferenceCategoryGroup[] = [
  { type: 'Attractions & Sights', activities: ['Museums', 'Monuments', 'Viewpoints'] },
  { type: 'Tours & Excursions', activities: ['Walking Tours', 'Boat Cruises', 'Bus Tours'] },
  { type: 'Outdoor & Nature', activities: ['Hiking', 'Cycling', 'Water Sports'] },
  { type: 'Arts & Culture', activities: ['Galleries', 'Workshops', 'Local Markets'] },
  { type: 'Relaxation', activities: ['Spas', 'Parks', 'Scenic Drives'] },
];

export const EVENT_GENRES_CATEGORIZED: PreferenceCategoryGroup[] = [
  { type: 'Performing Arts', activities: ['Theater', 'Ballet', 'Opera'] },
  { type: 'Live Music', activities: ['Concerts', 'Festivals', 'DJ Sets'] },
  { type: 'Entertainment', activities: ['Comedy Shows', 'Cinema', 'Magic Shows'] },
  { type: 'Sports', activities: ['Football', 'Basketball', 'Tennis'] },
  { type: 'Culture', activities: ['Exhibitions', 'Markets', 'Parades'] },
];

// --- Taste domain registry ------------------------------------------------------------
//
// Per docs/onboarding-redesign.md's "How new categories slot in" section: registering a
// taxonomy here (rather than referencing FOOD_GENRES_CATEGORIZED/etc. by name all over the
// onboarding/swipe-deck code) is what lets a future fourth taxonomy (e.g. "Nightlife") show
// up in the swipe-refine deck's candidate pool automatically, with zero changes to the flow
// logic in app/onboarding.tsx or lib/onboarding-taste.ts. `key` matches the corresponding
// User.preferences.* field name 1:1 (see models/User.ts) so callers can go straight from a
// domain to the preferences bucket it belongs to.
export interface TasteDomain {
  key: 'foodGenres' | 'activityGenres' | 'eventGenres';
  label: string;
  taxonomy: PreferenceCategoryGroup[];
}

export const TASTE_DOMAINS: TasteDomain[] = [
  { key: 'foodGenres', label: 'Food', taxonomy: FOOD_GENRES_CATEGORIZED },
  { key: 'activityGenres', label: 'Activities', taxonomy: ACTIVITY_GENRES_CATEGORIZED },
  { key: 'eventGenres', label: 'Events', taxonomy: EVENT_GENRES_CATEGORIZED },
];

// --- Vibe presets (onboarding "Pick your vibe" circle screen) -------------------------
//
// Each vibe is a curated, cross-taxonomy bundle of REAL leaf tags (verified against the three
// *_CATEGORIZED arrays above — see lib/onboarding-taste.test.ts's taxonomy-coverage check).
// Selecting a vibe circle adds its whole `tags` list to the user's profile in one tap; drilling
// into a vibe exposes those same tags as individually-toggleable sub-circles so the user can
// prune the bundle rather than being forced to keep all of it. No invented tags — every tag
// below is a real, already-scored leaf from FOOD/ACTIVITY/EVENT_GENRES_CATEGORIZED, per the
// product owner's explicit instruction not to introduce a parallel taxonomy for this feature.
//
// Deliberate design notes, since the specific tag selection is a real product decision:
// - Tags are intentionally reused across multiple vibes (e.g. `Scenic Drives` seeds both
//   Outdoors & Active and Chill & Relax; `Festivals` seeds both Foodie and Nightlife). That's
//   fine and expected — selecting multiple vibes just unions the resulting tag pool (deduped),
//   and the same real-world tag legitimately signals more than one persona.
// - Not every leaf tag is reachable from a vibe (e.g. individual cuisines like `Italian`/
//   `Japanese`, or `Bus Tours`, `Cinema`, the Sports leaves). That's by design, not an
//   oversight: vibes are broad personas meant to cover a lot of ground in 1-3 taps, and the
//   capped swipe-refine deck's whole job (per docs/onboarding-redesign.md) is to catch
//   exactly this kind of narrower, left-over preference from the gap — see
//   lib/onboarding-taste.ts's `buildSwipeCandidatePool`.
// - `color` is a flat accent color per vibe (no gradients — see the no-new-native-deps
//   constraint this feature was built under) used for the circle's fill/glow and, when
//   drilled into, its sub-circles.
export interface VibePreset {
  key: string;
  label: string;
  emoji: string;
  color: string;
  // Real leaf tags from FOOD_GENRES_CATEGORIZED / ACTIVITY_GENRES_CATEGORIZED /
  // EVENT_GENRES_CATEGORIZED this vibe seeds. Order here is the sub-circle drill-down order.
  tags: string[];
}

export const VIBE_PRESETS: VibePreset[] = [
  {
    // The doc's own worked example (Street Food / Cafes / Local Markets / Festivals) —
    // kept verbatim since the product owner already signed off on this exact combination.
    key: 'foodie', label: 'Foodie', emoji: '🍜', color: '#F97316',
    tags: ['Street Food', 'Cafes', 'Local Markets', 'Festivals'],
  },
  {
    // Museums/Monuments/Galleries/Exhibitions are the obvious core; Walking Tours is included
    // because guided-tour takers overwhelmingly skew toward "here to see the culture," not
    // toward Tours & Excursions' other, more logistics-flavored leaves (Boat/Bus).
    key: 'culture', label: 'Culture & Museums', emoji: '🏛', color: '#A855F7',
    tags: ['Museums', 'Monuments', 'Galleries', 'Exhibitions', 'Walking Tours'],
  },
  {
    // The entire real Live Music group (Concerts/Festivals/DJ Sets) is the closest possible
    // match to this vibe's name — this is the exact case CLAUDE.md's task spec calls out as
    // the real equivalent of the illustrative-only Rock/Electro/Jazz/Metal mockup example.
    // Comedy Shows added from Entertainment since late-night comedy sets share this vibe's
    // "going out at night" occasion even though it's not literally music.
    key: 'nightlife', label: 'Nightlife & Live Music', emoji: '🎶', color: '#EC4899',
    tags: ['Concerts', 'Festivals', 'DJ Sets', 'Comedy Shows'],
  },
  {
    // The full Outdoor & Nature group plus the two Relaxation leaves that are outdoor-adjacent
    // (Parks, Scenic Drives) — deliberately overlaps with Chill & Relax below (a park is
    // legitimately both), see the reuse note above.
    key: 'outdoors', label: 'Outdoors & Active', emoji: '🌳', color: '#22C55E',
    tags: ['Hiking', 'Cycling', 'Water Sports', 'Parks', 'Scenic Drives'],
  },
  {
    // The full Performing Arts group is the core; Galleries/Workshops from Arts & Culture
    // round it out since "arts" in the vibe's name reads broader than just stage performance.
    key: 'arts', label: 'Arts & Theater', emoji: '🎭', color: '#EAB308',
    tags: ['Theater', 'Ballet', 'Opera', 'Galleries', 'Workshops'],
  },
  {
    // The full Relaxation group plus Cafes (a cafe is a "chill" occasion as much as a food
    // one) — the cross-taxonomy tag that makes this bundle span food + activity, same
    // mechanism as Foodie's Local Markets/Festivals reaching into activity/event.
    key: 'chill', label: 'Chill & Relax', emoji: '😌', color: '#38BDF8',
    tags: ['Spas', 'Parks', 'Scenic Drives', 'Cafes'],
  },
  {
    // `Local Markets` (activity taxonomy) and `Markets` (event taxonomy) are two distinct
    // real leaves that both belong here — worth calling out since they look like duplicates
    // but aren't. Parades/Exhibitions round out the "browsing a market/fair" occasion.
    key: 'shopping', label: 'Shopping & Markets', emoji: '🛍', color: '#14B8A6',
    tags: ['Local Markets', 'Markets', 'Parades', 'Exhibitions'],
  },
  {
    // Attractions & Sights' Viewpoints plus the two other activity leaves whose whole point
    // is "look at something scenic" (Scenic Drives, Boat Cruises) and Monuments, which is as
    // much a view-from/photograph-of occasion as a history one.
    key: 'scenic', label: 'Scenic & Views', emoji: '🌄', color: '#6366F1',
    tags: ['Viewpoints', 'Scenic Drives', 'Boat Cruises', 'Monuments'],
  },
];
