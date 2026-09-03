# Taste taxonomy depth, profile/onboarding unification, and two notification gaps

Not attempted this pass — proposals only, per direct instruction. Seven related items
reported live while testing: three about how the "Pick your vibe" taxonomy and the Profile
preference editor represent taste data, and four narrower gaps (home-city sharing buried in
Profile, no way to go back anywhere in onboarding, no Circles-tab badge for new friend
requests, invite cards with no inviter identity).

## 1. The vibe picker never actually reaches cuisine-level granularity — even though the data already supports it

Reported live from the onboarding screenshot: tapping "Foodie" (fine-tune) shows *Street
Food / Cafes / Local Markets / Festivals* — none of which are cuisine types. The ask: tapping
something like "Asian" should reveal `Japanese / Chinese / Thai` as its own drill-down level.

**This isn't a gap in the data model — it's a gap in which part of the data model onboarding
uses.** `constants/preferences.ts` already has exactly the 2-level structure being asked for:

```ts
export const FOOD_GENRES_CATEGORIZED: PreferenceCategoryGroup[] = [
  { type: 'European', activities: ['Italian', 'French', 'Mediterranean'] },
  { type: 'Asian', activities: ['Japanese', 'Chinese', 'Thai'] },
  { type: 'Americas', activities: ['Mexican', 'American', 'Brazilian'] },
  { type: 'Dining Style', activities: ['Fine Dining', 'Fast Food', 'Street Food'] },
  { type: 'Specialty', activities: ['Seafood', 'Steakhouses', 'Cafes'] },
];
```

But `VIBE_PRESETS` (also in `constants/preferences.ts`) — what the onboarding "Pick your
vibe" screen actually renders via `buildVibeTree()` (`lib/onboarding-taste.ts`) — bypasses
this entirely. Foodie's `tags` is a hand-picked *flat* list
(`['Street Food', 'Cafes', 'Local Markets', 'Festivals']`), and none of the 9 real cuisine
leaves (`Italian`/`French`/`Mediterranean`/`Japanese`/`Chinese`/`Thai`/`Mexican`/`American`/
`Brazilian`) appear anywhere in any vibe's tag list — confirmed by grep, not assumed. A user
completing onboarding via the vibe picker alone captures zero cuisine signal, full stop; the
only path to a cuisine tag is the capped 10-tag swipe-refine deck drawing blind from the
*entire* leftover pool across all three domains, so there's no guarantee even one cuisine
tag surfaces there, let alone a structured choice among them.

**The fix is smaller than it sounds, because the drill-down engine already supports arbitrary
depth.** `lib/onboarding-taste.ts`'s own header comment is explicit about this:
`CircleNode` is "deliberately depth-agnostic... a node with children drills in on a second
tap... at whatever depth it's found... there is no per-vibe branching anywhere in this file."
`isNodeActive`/`shouldDrillIn`/`tapNode` all already operate generically on `node.children`
with no assumption about how deep the tree goes. Only `buildVibeTree()` — the function that
*constructs* the tree from `VIBE_PRESETS` — currently flattens straight from vibe to leaf.
Proposed: let a vibe's children include *category* nodes (each wrapping a real
`PreferenceCategoryGroup` from `FOOD_GENRES_CATEGORIZED`/etc., with the category's own leaves
as *its* children) alongside plain leaf nodes, mixed as needed per vibe. Concretely for
Foodie: keep the existing occasion leaves (Street Food, Cafes, Local Markets, Festivals) as
direct taps, *and* add category nodes for the cuisine groups (Asian, European, Americas) so
`Foodie → Asian → Japanese` becomes a real 3-tap path, with tapping "Asian" itself bulk-adding
all three Asian cuisines (same one-tap-bulk-select behavior every other parent node already
has) for someone who doesn't want to go leaf-by-leaf.

**The real trade-off to flag, not paper over:** `docs/onboarding-redesign.md`'s whole design
goal was keeping onboarding to 1–3 taps, and the vibe picker's hand-picked flat bundles are
*why* it hits that today. Exposing full categories under Foodie makes the deepest path 3 taps
per cuisine instead of 1 tap for the whole vibe — still fast if the user just taps "Foodie"
and moves on (the top-level tap behavior doesn't change), but a materially longer flow for
anyone who actually wants to drill in, which is exactly the behavior being requested. That's
a real product trade-off between "still fast for most people" and "genuinely lets someone who
cares specify Japanese-not-Chinese during onboarding" — worth a deliberate call, not an
assumption either way.

## 2. Redundant tag reuse across vibes — a real audit, not a guess

"Same for the rest, too many things redundant across circles" — checked by diffing every
vibe's tag list against every other vibe's in `VIBE_PRESETS`. Real overlaps found:

| Tag | Appears in |
|---|---|
| `Scenic Drives` | Outdoors & Active, Chill & Relax, **and** Scenic & Views (3 vibes) |
| `Festivals` | Foodie, Nightlife & Live Music |
| `Local Markets` | Foodie, Shopping & Markets |
| `Cafes` | Foodie, Chill & Relax |
| `Galleries` | Culture & Museums, Arts & Theater |
| `Exhibitions` | Culture & Museums, Shopping & Markets |
| `Monuments` | Culture & Museums, Scenic & Views |
| `Parks` | Outdoors & Active, Chill & Relax |

8 of the taxonomy's ~35 vibe-tag slots are shared across 2–3 vibes each. The existing code
comments defend this as deliberate ("a park is legitimately both Outdoor and Chill... that's
fine and expected"), and mechanically it *is* harmless — `engagedKeys`/tag-union dedup already
means picking two overlapping vibes never double-counts a tag in the final preference set.
The friction being reported is purely perceptual: seeing `Scenic Drives` glow under three
different circles in a row reads as cluttered/redundant, not as a feature.

Three ways to actually resolve it, not silently picking one:

- **(a) Keep the status quo philosophy, do nothing.** Mechanically correct already; the
  "problem" is presentation, and a determined product argument that dual-purpose tags are a
  feature (not a bug) is defensible.
- **(b) Assign every tag to exactly one "primary" vibe.** Cleanest structure, but a real loss:
  someone who only ever taps "Chill & Relax" would no longer see `Scenic Drives` at all, even
  though it's a genuine Chill-vibe activity — the overlap existed for a reason in most of
  these cases, not by accident.
- **(c) Prune case-by-case rather than blanket-deduplicating.** Go through the 8 overlaps
  individually and ask, per pair, whether the *vibe still feels complete* without the shared
  tag — e.g. does Shopping & Markets still read as a full vibe without `Exhibitions` (it
  already has `Markets`/`Parades`), even though Culture & Museums keeps it? This is more work
  than (a) or (b) but is the only option that actually distinguishes "this overlap is doing
  real work" from "this overlap is just noise" instead of treating all 8 identically.

No recommendation forced here — this is a taste/brand call as much as a technical one.

## 3. Unify Profile's preference editor with the vibe-circle interaction

Reported live: on Profile, editing e.g. Event Types opens `CategorizedSelectionModal`
(`components/profile/categorized-selection-modal.tsx`) — a flat full-screen list showing
*all 5* categories and *all 15* leaf bubbles simultaneously, regardless of what's already
selected. The ask: reuse the same circle-tap/drill-down/collapse interaction onboarding
already has, with three concrete behaviors:

1. **A "back to circle view" button** — a real navigation control, not just onboarding's
   "tap outside a circle" gesture, since Profile is a settings context where an explicit
   affordance reads more appropriately than a gesture-only back.
2. **Drill one level down on demand** — the same `shouldDrillIn`/`tapNode` mechanics from
   `lib/onboarding-taste.ts`, reused rather than reimplemented (that logic is already
   generic/depth-agnostic per item 1 above — it doesn't know or care whether it's being
   driven from onboarding or Profile).
3. **Collapse an empty category to just its title + a "+"** — e.g. "Performing Arts +" as a
   compact single row when nothing under it is selected, expanding to show its leaves (or
   drilling further, per item 1) only on tap. Directly addresses the current modal's real
   problem: `EVENT_GENRES_CATEGORIZED` alone is 5 categories × 3 leaves = 15 bubbles rendered
   at once even for a brand-new user with nothing picked yet.

This amounts to building one shared drill-down/collapse component (a evolution of
`components/ui/vibe-picker.tsx`, parameterized by which `CircleNode` tree and selection state
it's driving) used by *both* `app/onboarding.tsx` and the Profile preference-editing flow,
replacing `CategorizedSelectionModal` rather than living alongside it — editing preferences
later should feel like the same interaction as picking them the first time, not a
different UI entirely. See the mockup (Part 7) for what the collapsed/expanded states and the
back button could look like concretely.

## 4. Home-city sharing belongs in onboarding, skippable

Reported live: `CircleShareSelector` (`components/ui/circle-share-selector.tsx`) — the
control that lets a user opt specific circles into seeing "I live here" — only exists on
Profile (`app/(tabs)/profile.tsx:307`) today; confirmed by grep, `app/onboarding.tsx` never
imports or renders it. That means the entire "friends nearby" mechanic (`GET
/api/friends-nearby`, and the Circles-tab surfacing shipped this sprint) is invisible to a
user until they separately discover and visit Profile after onboarding — a real activation
gap for a feature that's core to this product's "catch up with friends nearby" pillar per
`CLAUDE.md`. Proposed: add the same `CircleShareSelector` as one more onboarding step,
positioned after circles/friends exist conceptually makes sense in the flow (it reads
naturally right after or alongside the "Pick your vibe" step, not before identity/home-city
entry). **Must be skippable** — this is a privacy-sensitive opt-in, and onboarding's own
design goal (`docs/onboarding-redesign.md`) is staying short; forcing a decision here works
against both. A visible "Skip for now — set this anytime from Profile" affordance, not just a
silent default-to-nothing, so skipping is a legible choice rather than an accident.

## 5. No way to go back anywhere in onboarding — a real gap, made worse by adding another skippable step

Reported live, directly triggered by item 4 above: any step that can be skipped needs a way
back in case that was a mistake, and today none exist at all. Confirmed by reading
`app/onboarding.tsx` in full: `handleNext` only ever calls `setStep(2)`/`setStep(3)`/
`setStep(4)` — there is no `handleBack`, no code path that ever decrements `step`, anywhere
in the file. The step-dots progress indicator (`styles.stepDots`) is purely visual, not
tappable. Once a step is left — by tapping "Next," or by the swipe deck's "Skip — use my
picks" button (`components/ui/swipe-deck.tsx:125-126`, which calls `onComplete` and jumps
straight to step 4) — there is no way back to it, full stop. Adding item 4's new sharing step
without also fixing this means a user who skips it by reflex has no way to reconsider.

Proposed: a `handleBack` (`step > 1 ? setStep(step - 1) : router.back()` or similar) wired to
a visible back control on every step, distinct from — and not conflicting with — step 2's
existing "tap outside a circle to go back" gesture, which is a *different* kind of back
(popping one level out of the vibe picker's own drill-down, not leaving the step). The two
need to coexist legibly: a small "‹ Back" control near the step-dots, pinned above the step
content, handles step-to-step navigation; the vibe picker's outside-tap gesture keeps handling
only its own internal drill state, exactly as it does today.

One real implementation nuance worth flagging rather than deciding blind: step 3 (the swipe
deck) is conditionally rendered (`{step === 3 && (...)}`), so leaving it unmounts `SwipeDeck`
entirely — its own internal card-progress state isn't lifted to `onboarding.tsx`. Going back
to step 3 would remount a *fresh* deck at its first card, not resume wherever the user had
swiped to. The already-accepted tags aren't lost (`handleSwipeDeckComplete` already merged
them into `tasteTags`, which lives in `onboarding.tsx` and isn't reset), but the visual
progress would be. Whether that's fine (return to a fresh deck, previous picks already
counted) or needs the deck's progress lifted up too is a real product call, not resolved here.

## 6. Circles-tab badge for new friend requests

Reported live: no visual signal exists anywhere that a new friend request has arrived —
confirmed by reading `app/(tabs)/_layout.tsx`: `Tabs.Screen`'s `tabBarIcon` is a bare
`IconSymbol`, no `tabBarBadge` (Expo Router's `Tabs.Screen` supports this prop natively —
this is a small addition, not new UI infrastructure). The harder part isn't the badge itself,
it's the count: `hooks/useFriendRequests.tsx` is a thin fetch-wrapper provider today (no
cached/reactive state — `fetchIncomingRequests()` is imperative, called on demand by
`social.tsx`, confirmed by reading the whole file), so there's currently no live "how many
pending" number available at the layout level where the badge needs to render. Two ways to
get one, worth deciding rather than assuming:

- **Poll-based**: `FriendRequestsProvider` (or `app/_layout.tsx`) periodically calls
  `fetchIncomingRequests()` and caches the count, similar in shape to how
  `useMutationQueueFlush` already polls on an `AppState` foreground trigger.
  Simple, but adds a recurring network call purely to answer "is there a badge."
- **Push-driven**: this sprint's new push-notification infrastructure
  (`lib/push-notifications.ts`, `POST /api/friend-requests` already sends a push on a new
  request) already knows the moment a request arrives — a received-notification handler could
  update the badge count directly, no polling needed. Requires the in-app notification
  handling `lib/push-notifications.ts`'s own CHANGELOG entry already flagged as follow-up
  work (`Notifications.setNotificationHandler`) to exist first, so this option is coupled to
  finishing that piece, not independently buildable today.

Either way, the count itself is simple (length of `fetchIncomingRequests()`'s result, or a
dedicated lightweight `GET /api/friend-requests/incoming/count` if avoiding fetching full
request objects just to count them matters).

## 7. Event invite cards show no indication of who invited you

Reported live, screenshot attached: the "Your Invites" modal
(`app/(tabs)/trips.tsx:1284-1324`) renders `event.title`, start time, and `event.place_name`
— never `event.created_by`, even though every `Event` document already carries it. Confirmed
this is a real gap on both ends, not just a missed render: `GET /api/events/invited`
(`server.ts:571-579`) does a bare `Event.find(...)` with no `.populate('created_by', ...)` (or
equivalent lookup), so `created_by` reaches the client as an unresolved ObjectId string with
no name attached even if the UI tried to show it today. Two-part fix needed: the server route
should resolve the organizer's `full_name`/`avatar_url` alongside the event (populate, or a
batched lookup keyed by the distinct `created_by` ids in the result set), and the invite card
should render it plainly — "Invited by Nico" is the obvious bar, an avatar chip if there's
room. Small, contained, no design ambiguity here — unlike items 1–5, this one doesn't need a
product decision, just the fix.

## 8. Graphical proposal (items 1, 3, 4, 5)

See the published mockup: **https://claude.ai/code/artifact/238def10-5b1c-4b4b-8771-fc4a87e0cdf6**
("Taste Depth Proposal"). Covers, using the app's real
palette pulled from `trips.tsx`/`vibe-picker.tsx`'s own stylesheets:

- The 3-level vibe drill-down (`Foodie → Asian → Japanese/Chinese/Thai`), alongside Foodie's
  existing occasion leaves at the same second level.
- Profile's preference editor in collapsed form (`Performing Arts +`, `Sports +`, ...) next to
  one expanded category, plus the "back to circle view" control.
- Onboarding's new skippable home-sharing step, positioned in the flow.

## Explicitly out of scope for this doc

- No code written — proposals only, per direct instruction.
- Item 2's three options are deliberately left as options, not a recommendation — this is a
  taste/brand call more than a technical one.
- Item 5's poll-vs-push decision is coupled to finishing the push-notification
  foreground-handling follow-up already flagged in this sprint's CHANGELOG — not resolved
  here.
- Whether `CategorizedSelectionModal` should be deleted outright once its replacement exists,
  or kept as a fallback, isn't decided here — depends on how item 3's replacement component
  actually turns out.
