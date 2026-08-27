# "Circles" as a visual language, not just a filter tag

Research only — no code changed. The product owner asked specifically for this: how the *idea*
of circles could refine look and feel across the app, not just the Circles tab itself. Written
as a companion to whatever `docs/circles-feature-proposal.md` lands on for the *feature* side
(chat, richer visualization within that tab) — this doc is scoped to the cross-app visual
system, which is a smaller, cheaper, more foundational thing that the feature work should
probably sit on top of rather than duplicate.

## The actual finding

"Circles" today is a data concept with almost no matching visual identity. Concretely:

- **The tab's own icon is wrong.** `app/(tabs)/_layout.tsx`: the Circles tab uses
  `building.columns.fill` (SF Symbols) → Material Icons' `account-balance` — a bank/government
  building glyph. Almost certainly an unrevisited leftover from scaffolding. This is the single
  cheapest fix in this whole document: swap it for a people/circles glyph (`person.3.fill` →
  Material's `people` or `groups` is the minimal fix; a literal overlapping-circles icon would
  land the metaphor even harder, worth a custom asset if there's any design time at all).
- **Every circle looks the same.** `components/ui/circle-share-selector.tsx` renders circle
  names as plain text pills with one shared active-state color (`#10B981`, green) — "Family and
  Friends," "Relatives," and "Work" are visually indistinguishable except by their label text.
  Same in `app/(tabs)/social.tsx`'s filter pills. There is currently no per-circle color
  identity anywhere in the app.
- **Circle membership is invisible outside the Circles tab.** A contact's avatar on the Home
  tab's nearby-friends surfacing, in the trip-invite contact picker, on a joint event's
  participant list — none of it carries any visual trace of which circle that person belongs
  to. You only find out by going to the Circles tab and checking. For a product whose stated
  third pillar is "catching up with friends... in or near that city" (`CLAUDE.md`), the circle
  identity is disappearing exactly where it should be reinforcing trust (is this a work
  colleague or family, at a glance, before you invite them to something).

## Recommendation: a small per-circle color system, threaded everywhere an avatar/contact appears

The cheapest, highest-leverage move here isn't a big Circles-tab redesign — it's a **consistent
color assigned per circle**, applied as a ring/border around every avatar wherever it renders,
plus matching accent colors on any circle-labeled text/pill. Concretely:

```
Family and Friends → warm coral   (#F97066 or similar)
Relatives           → amber        (#F59E0B)
Work                → the existing app blue (#3B82F6) — already the app's primary accent,
                       fits "Work" being the most "default/neutral" circle
```

(Exact hex values are a design pass, not a technical decision — the point is three genuinely
distinct, consistently-applied hues, not the specific ones above.)

Where this pays off immediately, all reusing the same one new small component (an `AvatarRing`
or similar wrapping the existing bare `<Image>` avatar renders):

- **`app/(tabs)/social.tsx`** — contact avatars get their circle's color ring; the filter pills
  get their circle's color as the active-state fill instead of the current shared green.
- **`components/ui/circle-share-selector.tsx`** — same treatment, so picking who to share a
  trip with visually reinforces which circle you're picking, not just text.
- **Home tab's nearby-friends surfacing** and **Trips' invite/contact-picker flows** — the
  *exact same* colored-ring avatar component, so a Family contact reads as Family everywhere,
  not just inside the Circles tab. This is the actual "refine the UI/UX with that idea of
  circles in various places" ask — it's a cross-cutting consistency fix, not a new screen.
- **Joint/blind-matched event cards** — a small colored dot or ring on the invited participant's
  avatar, so a proposed event visibly reads "this is a Work thing" vs. "this is a Family thing"
  before you even read the description.

This is deliberately the *first* recommendation because it's cheap (one new shared component,
a handful of call sites, no new data — `circleTags` already exists), has zero backend/schema
impact, and immediately makes "circles" feel like a real part of the app's visual identity
instead of a filter label buried in one tab.

## A further step, if there's appetite for it: literal circular layout on the Circles tab itself

The tab is *named* Circles but visually has never once been circular — it's a flat filtered
list. Once the color system above exists, the Circles tab itself could lean into the literal
metaphor:

- **Orbit/ring layout**: your own avatar centered, each circle's members arranged in a ring
  around it (innermost ring = whichever circle has the most recent interaction, or just a fixed
  order — Family and Friends innermost, Work outermost reads naturally as "closest to
  furthest"), using each circle's color for that ring's arc/background. Tapping a ring expands
  it into the existing list view underneath — additive to today's UI, not a replacement, so this
  is a bigger but not risky change (the flat list can stay as the actual data-interaction
  surface, the rings become a navigational/visual header above it).
- **Overlapping avatar clusters** as a lighter-weight alternative to a full radial layout —
  circle members shown as a stacked, slightly-overlapping avatar cluster (the way group-chat
  apps show "who's in this thread"), one cluster per circle, colored border per the system
  above. Meaningfully less engineering than a true radial/orbit layout (no custom geometry,
  just a `FlatList` with negative margins) while still visually distinct from today's plain
  rows.

Both of these are genuinely "circles, drawn as circles" — the radial layout is the more literal
and more impressive version; the avatar-cluster is the pragmatic version that ships faster. If
`docs/circles-feature-proposal.md` recommends real investment in the Circles tab (e.g. because
it's also getting 1:1 chat), the radial layout is worth it as the anchor visual. If that doc
leans toward keeping the tab lighter-weight, the avatar-cluster version gets 80% of the visual
win for a fraction of the build cost.

## Suggested priority order

1. Fix the tab icon (minutes of work, currently actively wrong).
2. Per-circle color system + shared `AvatarRing` component, applied to the Circles tab and
   `circle-share-selector.tsx` first (contained, low-risk).
3. Thread the same `AvatarRing` component into Home's nearby-friends surfacing, Trips' invite
   pickers, and joint-event participant displays — this is where the actual cross-app "circles
   everywhere" payoff lives, and it's just reusing the component from step 2, not new design
   work.
4. Only then, if there's appetite: the bigger Circles-tab-specific layout work (radial or
   cluster), informed by whatever the feature-side proposal (chat, etc.) decides the tab needs
   to support.

## What this doesn't cover

Exact color values (a real design pass, not decided here), the Circles *feature* work (chat,
what's actually missing functionally — that's `docs/circles-feature-proposal.md`'s job), any
accessibility contrast-ratio verification for the proposed colors against this app's existing
dark theme (`#0F172A`/`#1E293B` background family — should be checked before implementation,
not assumed), and no code was written or touched producing this document.
