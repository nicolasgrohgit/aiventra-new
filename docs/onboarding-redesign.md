# Onboarding redesign

Research + proposal, written pre-implementation, same spirit as `docs/monetization-strategy.md`
and `docs/ad-monetization.md` — no code changes accompany this document. It's meant to settle
the *interaction pattern* and the *extensibility contract* before anyone touches
`app/onboarding.tsx`.

## The question this answers

The product owner wants onboarding to feel more interactive — not the current step-dots-and-
chip-grid form — but explicitly **not longer**, because a longer flow is the one failure mode
that reliably loses users before they ever see a recommendation. Two constraints have to hold
at once: more delightful, and no more taps than today, ideally fewer. This doc proposes a
concrete pattern that does both, and treats "easy to extend with more categories later" as a
hard requirement, not a nice-to-have, because `constants/preferences.ts`'s taxonomy has already
grown once (three categorized genre lists, each with five sub-groups) and will again.

## The current flow, concretely

`app/onboarding.tsx` (219 lines) is six linear steps behind a `TOTAL_STEPS = 6` step-dot
header and a single `Next` button:

1. Home city — text input + debounced autocomplete (`lib/geocoding.ts`), soft-validated only.
2. Dietary restrictions — flat multi-select grid, 7 options (`COMMON_DIETS`).
3. Travel pace — 3-option single-select (`Low`/`Medium`/`High`).
4. Food tastes — `CategorizedPicker` over `FOOD_GENRES_CATEGORIZED`: 5 sub-groups x 3 tags = 15 chips.
5. Activity tastes — same shape, `ACTIVITY_GENRES_CATEGORIZED`, 15 chips.
6. Event tastes — same shape, `EVENT_GENRES_CATEGORIZED`, 15 chips.

Nothing here is technically broken. The problem is exactly what the product owner named:
steps 4–6 are the same visual pattern three times in a row (a wall of 15 chips, scroll, tap,
Next), with no cap, no guidance, and no sense of progress within a step — a user who wants to
be thorough is looking at up to 45 individual tag decisions, and a user who wants to be fast
gets no explicit permission to skip, so they either grind through it or leave gaps at random.
That repetition, not the six-screen count itself, is the actual "boring" the product owner is
flagging.

## What comparable apps do

| App | Pattern | Why it's relevant here |
|---|---|---|
| **Spotify** | Onboarding presents a grid of genre/artist tiles, multi-select, no per-item explanation needed — tap density over reading | Same "many small taste tags" shape as food/activity/event genres; validates a *grid of tappable tiles* as the right widget for a taxonomy, not a swipe-per-item deck |
| **Duolingo** | A short questionnaire of single-select preset screens ("why are you learning," "how much time per day"), each pickable in one tap, explicitly told "you can change this later" | Validates *preset, single-tap-per-screen* questions as the way to cover a lot of ground fast, and validates surfacing "you can edit this later" as a legitimate way to justify light-touch answers upfront |
| **Hinge / Tinder-style card decks** | Swipe left/right, one binary decision per card, session naturally self-limits because attention drops off after a bounded number of cards | Validates a *capped* swipe deck as a fast way to binary-classify a list of things — but only for lists short enough that "swipe through all of them" doesn't itself become the boring part |
| **Airbnb / Uber** | Let the user browse and get value before asking for preferences at all; account/preference setup is deferred behind first real usage | The instructive counter-example — see "can this be deferred instead" below for why this doesn't transplant cleanly onto Odys |

Sources: [Duolingo onboarding UX breakdown — UserGuiding](https://userguiding.com/blog/duolingo-onboarding-ux), [Deep-dive into Spotify's onboarding — Medium](https://medium.com/@smarthvasdev/deep-dive-into-spotifys-user-onboarding-experience-f2eefb8619d6), [Progressive disclosure UX guide 2026 — Lollypop Design](https://lollypop.design/blog/2025/may/progressive-disclosure/), [12 apps with great user onboarding 2026 — UXCam](https://uxcam.com/blog/10-apps-with-great-user-onboarding/)

None of these is a travel-app-specific comparable — travel taste-onboarding (Wanderlog, Layla,
TripIt) is mostly unremarkable in this dimension (destination + dates, not taste taxonomy), so
the useful comps here are from taste-heavy consumer apps (music, dating, language learning)
rather than travel planners specifically.

## Recommendation: vibe presets + a capped swipe-refine + a condensed essentials screen

Four screens instead of six, replacing the three repeated 15-chip grids with two screens that
do the same job faster and with a genuinely different interaction each:

**1. Home city** — unchanged. It's functional data (the homebase-vs-traveling distinction
depends on it, per `CLAUDE.md`), not a taste question, so it isn't part of the "make it more
interactive" problem and shouldn't be touched.

**2. "Pick your vibe"** — a grid of 6–8 large preset cards (`🍜 Foodie`, `🏛 Culture & Museums`,
`🎶 Nightlife & Live Music`, `🌳 Outdoors & Active`, `🎭 Arts & Theater`, `😌 Chill & Relax`, …),
multi-select, 1–3 taps expected. Each card is a **preset bundle of tags spanning all three
existing taxonomies at once** — tapping "Foodie" might pre-select `Street Food`, `Cafes`,
`Local Markets` (activity), and `Festivals` (event) in one tap, not just a food tag. This is
the mechanism that does the actual work of "cover 45 possible tags in a few taps": most of a
user's taste profile gets filled by picking 1–3 cards that feel like them, not by reading and
judging 45 individual chips. Big tap targets, `expo-haptics` on selection (already a
dependency) for the "interactive" feel the product owner is asking for.

**3. "Anything else?" — a capped swipe-refine deck, skippable.** A single Tinder-style card
stack, hard-capped at ~10 cards regardless of taxonomy size, drawn from the tags *not* already
covered by the vibes picked in step 2 (union of `FOOD_GENRES_CATEGORIZED` +
`ACTIVITY_GENRES_CATEGORIZED` + `EVENT_GENRES_CATEGORIZED`, minus already-selected). Swipe
right = add, swipe left = skip. A visible "Skip — use my picks" button sits above the deck for
the user who's already happy with what the vibes seeded. This is deliberately *not* a swipe
through the entire taxonomy — 45 swipe decisions is just as boring as 45 chip taps, worse
actually, since each swipe demands a physical gesture. Capping at 10 and drawing from the
*gap*, not the whole taxonomy, is what keeps this fast even as the taxonomy grows (see
"staying short" below).

**4. Essentials** — dietary restrictions and travel pace, combined into one screen instead of
two (`COMMON_DIETS` chip row + the existing 3-button pace picker, stacked vertically). Both are
fast single/multi-select with a handful of options; splitting them into separate screens today
buys nothing. Reuse the existing `optionBtn` chip styling as-is.

### Tap/screen budget, concretely

| | Current | Proposed |
|---|---|---|
| Screens | 6 | 4 |
| Home city | 1 screen, 1 text entry | unchanged |
| Genre taste coverage | 3 screens, up to 45 individual chip taps, no cap, no skip affordance | 1 vibe screen (1–3 taps) + 1 capped swipe deck (≤10 swipes, skippable) |
| Dietary + pace | 2 screens, 2 separate tap sets | 1 screen, same tap count, half the screens |
| Worst case total interactions | ~50+ (thorough user) | ~15 (vibes + full swipe deck + essentials), and the two heaviest screens are both explicitly skippable |
| Best case (skip everything skippable) | Not supported — no skip affordance exists today | 1 city entry + 1–3 vibe taps + 2 essentials taps ≈ 5 interactions |

The proposal is shorter in both the median and worst case, and — unlike today — gives an
impatient user an explicit, sanctioned way to stop early instead of grinding or leaving the
flow.

## Staying short — addressing the hard constraint directly

- **Smart defaults already exist and are safe to lean on.** `server.ts`'s account-creation
  default is `activityLevel: 'Medium', dietary: []` (`server.ts:130-131`) — skipping the
  essentials screen entirely is already a no-op the app tolerates today, not a new risk this
  redesign introduces. The essentials screen should say so explicitly ("Medium pace, no
  restrictions — you can change this anytime") rather than imply it's required.
- **Skip-ahead is a first-class affordance, not a missing feature.** Step 3's "Skip — use my
  picks" button and step 4's implicit skip (defaults hold if untouched) are both real exits,
  not just "the user closes the app" — this is the single biggest lever for keeping the flow
  short for anyone who doesn't want to engage further, without forcing every user through a
  shortened flow.
- **Can genre taste be deferred entirely and learned from behavior instead, the way
  Airbnb/Uber defer preferences?** Checked against `lib/place-matching.ts`:
  `flattenPreferenceTags(preferences)` (line 52) merges `foodGenres`/`activityGenres`/
  `eventGenres` into the tag set both recommendation endpoints score against
  (`server.ts`'s `$setIntersection: ['$tags', flattenPreferenceTags(u.preferences)]`, used by
  both the solo endpoint and the blind joint-matching endpoint). An empty array there doesn't
  crash anything, but it does mean **zero personalization signal on day one** — every place
  scores the same on the tag-match term, and the app's core promise ("what can I do in my free
  90 minutes... near my hotel") degrades to generic proximity/rating sort for a user's entire
  first session. Full deferral is a real product idea (cold-start on implicit signals — saves,
  taps, dismissals — instead of an explicit ask) but it's a bigger change than an onboarding
  redesign: it needs a behavior-tracking pipeline and a way to backfill `preferences` from that
  behavior, neither of which exists today. **Recommendation: keep genre taste in onboarding,
  but make it fast (vibes + capped swipe) rather than removing it.**
- **Dietary and travel pace are, right now, dead weight in scoring — genuinely safe to
  de-prioritize.** A repo-wide check found `dietary` and `activityLevel` referenced only as
  account-creation defaults (`server.ts:130-131`) and nowhere in `lib/place-matching.ts`'s
  scoring/filtering. They're stored, they're in the Mongoose schema, they're presumably meant
  to gate/filter recommendations eventually — but they don't yet. That's exactly why folding
  them into one low-friction "essentials" screen (rather than two dedicated ones) is safe: the
  cost of a fast, skippable answer here is currently zero, since nothing downstream depends on
  it being thoughtfully filled in yet.

## How new categories slot in without redesigning the flow

This is the actual structural requirement, so it needs to hold even for a category nobody's
thought of yet (e.g., "Nightlife" or "Shopping"). Two small additions, zero changes to
`app/onboarding.tsx`'s flow logic:

1. **`constants/preferences.ts`**: add the new `PreferenceCategoryGroup[]` const (same shape as
   `FOOD_GENRES_CATEGORIZED` today), then register it in one new array:
   ```ts
   export interface TasteDomain {
     key: 'foodGenres' | 'activityGenres' | 'eventGenres' | /* new keys append here */ string;
     label: string;
     taxonomy: PreferenceCategoryGroup[];
   }
   export const TASTE_DOMAINS: TasteDomain[] = [
     { key: 'foodGenres', label: 'Food', taxonomy: FOOD_GENRES_CATEGORIZED },
     { key: 'activityGenres', label: 'Activities', taxonomy: ACTIVITY_GENRES_CATEGORIZED },
     { key: 'eventGenres', label: 'Events', taxonomy: EVENT_GENRES_CATEGORIZED },
     // { key: 'nightlifeGenres', label: 'Nightlife', taxonomy: NIGHTLIFE_GENRES_CATEGORIZED },
   ];
   ```
   The swipe-refine deck's candidate pool (step 3) is defined as "flatten every domain in
   `TASTE_DOMAINS`, minus tags already selected" — so a new domain's tags show up in the same
   capped deck automatically, with **no increase in screen count or cap size**. It surfaces
   organically even if no vibe preset references it yet. `VIBE_PRESETS` (the step-2 bundles)
   can optionally reference the new domain's tags too, but that's additive tuning, not a
   required step — the flow works correctly with zero vibe updates.
2. **`models/User.ts`**: add one line to the `preferences` sub-object
   (`nightlifeGenres: [{ type: String }]`) — this is a real requirement, not a formality. See
   the data-shape section below for why.

The one thing that does need a matching update, outside `onboarding.tsx` entirely, is
`lib/place-matching.ts`'s `flattenPreferenceTags` (line 52), which currently hardcodes the
three existing keys rather than iterating `TASTE_DOMAINS`. That's a ~5-line generalization
(`TASTE_DOMAINS.flatMap(d => preferences[d.key] || [])`), and until it happens, a new domain's
tags would be collectable in onboarding but inert in scoring — worth doing in the same PR that
adds the first new domain, not as a follow-up someone forgets.

## Data shape changes on `User.preferences`

**Mostly none — but one real subtlety worth flagging, found while checking.** `models/User.ts`
declares `preferences` as a plain nested object (not a separate `new Schema(...)`) inside a
schema whose top-level `strict: false` is commented as being "only needed now for top-level ad
hoc fields... `preferences.*` is fully declared above" (`models/User.ts:52`). That comment is
correct and matters here: Mongoose's `strict` option does not automatically cascade to a plain
nested-object path — an inline nested object gets its own implicit sub-schema, which defaults
to strict unless explicitly told otherwise. Combined with `PUT /api/users/:id`'s handler
(`server.ts:172-176`, `User.findByIdAndUpdate(id, { $set: req.body }, { runValidators: true })`,
where the client sends the *entire* merged `preferences` object) — an undeclared key inside
`preferences` (e.g., a new `nightlifeGenres` sent before `models/User.ts` knows about it) will
likely be silently dropped on write, not stored. It'd still round-trip fine through
`AsyncStorage` client-side (plain JSON, no schema), so the bug would only show up as "this
preference doesn't survive a fresh login on another device" — an easy one to miss in testing
if you only test against local state. **Practical implication: every new taste domain needs
its one-line schema addition in `models/User.ts` at the same time it's added to
`TASTE_DOMAINS`, not as an afterthought.** This isn't a redesign-scale change, just a real
dependency to keep in the same PR checklist.

One optional addition, not required: a `preferences.selectedVibes: string[]` field to record
which vibe presets the user picked in step 2, purely as a breadcrumb (useful later for e.g.
"since you're into Nightlife, here's tonight's picks" copy, or as a coarse persona signal for a
future recommendation feature) — not needed for scoring, since the vibes only exist to *seed*
the real `foodGenres`/`activityGenres`/`eventGenres` arrays that already drive matching. Skip
it unless a concrete downstream use shows up.

## Implementation effort

**No new dependencies.** `react-native-reanimated` (`~4.1.1`) and `react-native-gesture-handler`
(`~2.28.0`) are both already installed and are the standard combo for a swipeable card deck —
this is the same library pairing every Tinder-clone tutorial and RN swipe-card library uses.
`expo-haptics` is already installed for the vibe-card tap feedback. Nothing here needs a new
native module or an EAS rebuild beyond what's already in the project.

Rough breakdown, one person:

- `constants/preferences.ts`: add `TASTE_DOMAINS` + `VIBE_PRESETS` registries — **~0.5 day**
  (mostly deciding the actual preset bundles' tag lists, not code).
- New `VibeGrid`/`VibeCard` component — large tappable cards, multi-select, haptic feedback.
  Straightforward, same complexity class as the existing `CategorizedPicker` bubbles, just
  bigger touch targets — **~0.5–1 day**.
- New `SwipeDeck` component — pan gesture + spring-back/fly-off animation via
  `react-native-gesture-handler`'s `Gesture.Pan()` + `react-native-reanimated`'s
  `useAnimatedStyle`/`withSpring`. The genuinely new interaction pattern for this codebase, so
  budget real time for gesture feel/tuning, plus a **non-gesture fallback** (visible ✓/✗
  buttons under the deck) — needed both for accessibility and because `react-native-web`
  (also already a dependency) handles pan gestures less reliably than native — **~1–1.5 days**.
- `models/User.ts` — trivial, only relevant when a new domain is actually added, not part of
  this initial build.
- Wiring `app/onboarding.tsx` to the new 4-step flow, reusing the existing homebase step
  and the existing `optionBtn` chip styling for the essentials screen — **~1 day**.
- `app/(tabs)/profile.tsx` needs **no changes** — it already exposes all three genre
  taxonomies via `CategorizedSelectionModal` as an always-available "edit later" escape valve
  (`profile.tsx:402-404`), which is exactly the safety net that makes it fine for onboarding to
  move fast and under-collect.

**Total: roughly 3–4 days of UI engineering**, reusing the existing visual language (same dark
palette, same chip/button styling), not a new design system and not a new dependency footprint.

## What this deliberately doesn't cover

The actual `VIBE_PRESETS` content (which 6–8 personas, which tags each seeds — a product/copy
decision, not an architecture one), visual mocks, the exact spring/gesture tuning values, an
A/B test plan for screen count vs. completion rate, a fuller accessibility pass on the swipe
deck beyond noting the tap-fallback requirement, and the `flattenPreferenceTags` generalization
implementation (flagged above as a required follow-up, not shipped here). Also out of scope:
the bigger "defer taste onboarding entirely, learn from behavior" idea raised and rejected
above for v1 — worth its own design doc if the product direction shifts toward implicit
personalization later, since it's a data-pipeline problem, not an onboarding-flow one.
