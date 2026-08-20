# Ad monetization

Research, written as a companion to `docs/monetization-strategy.md`, not a replacement for
it. That doc landed on subscription (volume/social depth) + affiliate commissions as the
model, and explicitly **skipped ads as a fourth stream** with this reasoning: *"Beli's
'ad-free ethos' pairs with a name-brand curated-experience upsell, which fits Odys's
positioning better than a generic ad network would."*

This doc takes that seriously rather than re-litigating it from zero, and lands on: **don't
add a generic ad network to the free tier as currently scoped — but there's one narrow,
travel-native ad-adjacent mechanism worth revisiting later.** Read the "Where this disagrees"
section first if you're short on time; the rest is the research behind that call.

## Where this agrees, extends, and disagrees with the existing doc

**Agrees:** a generic banner/interstitial ad network (AdMob, Meta Audience Network,
AppLovin/Unity/ironSource-style mediation) is a bad fit for Odys specifically, for reasons
that go beyond "ads feel cheap":

- The product's actual value prop (`CLAUDE.md`: "what can I do in my free 90 minutes,
  near my hotel, ideally with someone I know") is a *low-frequency, high-intent* flow — a
  user opens the app a handful of times per trip, not dozens of times a day the way a game or
  social feed does. Ad networks monetize *impressions*, and this app structurally can't
  generate enough of them to matter. Rough math: even a generous $8 eCPM (US, travel
  vertical, decent) times a realistic session count for a bleisure traveler (2-4 opens/day,
  a few days a trip) nets low-single-digit dollars per *trip*, not per user per month. That's
  not a rounding error next to a $40-60/yr subscription or an 8-12% cut of a $150 Viator
  tour — it's a distraction from the two channels that already pencil out.
- The screens where ads would technically fit (a banner under "AI Schedule Proposals," an
  interstitial between screens) are exactly the screens `docs/monetization-strategy.md`
  already identified as the free tier's core loop, kept intentionally unencumbered to build
  trust before any paywall. An ad units the same real estate — it doesn't cost a paywall's
  trust, but it does cost UI density and load time in a scroll of place-recommendation cards
  that are already competing for attention.

**Extends:** the existing doc didn't distinguish "ads" as a monolith — worth being explicit
that there are two structurally different things both called "advertising" here, and only one
of them was actually evaluated and rejected above:

1. **Generic ad network inventory** (AdMob, Meta Audience Network, AppLovin/Unity/ironSource
   mediation stacks) — the thing rejected above. Untargeted-by-content, sold by impression or
   click, no relationship to what's actually being shown.
2. **Sponsored/native placements from the same travel-vertical partners already in the
   affiliate plan** — a Viator or GetYourGuide "Featured" tour card, visually distinct but
   native to the recommendation list, paid for by *placement* (a flat fee or CPM from the
   partner) rather than by *booking commission*. This is closer to what OpenTable/Resy or
   Google's own "Sponsored" hotel listings do than to a banner network. It reuses the exact
   integration point `docs/monetization-strategy.md` already scoped (`lib/affiliate-links.ts`,
   attached to the `Place`/event payload) — the only difference is whether the partner pays
   per booking (affiliate, already planned) or per placement (sponsored, not yet planned).

**Disagrees, narrowly:** don't rule out (2) permanently. It's genuinely different from a
generic ad network — it's inventory-relevant, sits in a slot the user already expects to
scroll through recommendations, and Viator/GetYourGuide both run "featured placement"
programs for exactly this (surfaced to their existing affiliate partners once volume
justifies a direct conversation, not a self-serve ad network signup). The reason not to build
it *now* isn't that it's a bad idea — it's that Odys doesn't have booking volume yet to make
that conversation worth either side's time, and the affiliate-link plumbing that would carry
it doesn't exist yet either. Revisit once the affiliate integration in
`docs/monetization-strategy.md` actually ships and has real booking volume through it — that's
the leverage a "sponsored" conversation with Viator/GetYourGuide needs anyway.

## If the business decision goes the other way anyway

Below is the "how" in case ads get greenlit despite the above — either the whole network kind,
or narrowly the sponsored-placement kind once there's affiliate volume to justify it. Not a
recommendation to build this now.

### Network comparison

| Network | Fit for a travel-planning app | Notes |
|---|---|---|
| **Google AdMob** | Best default if this path is taken | Largest fill rates globally, native + banner + rewarded + interstitial ad formats, mediation layer can pull in other networks (Meta, AppLovin, Unity) without separate SDK integrations. `react-native-google-mobile-ads` is the maintained RN wrapper, actively supports Expo config plugins. |
| **Meta Audience Network** | Weak standalone, fine as a mediation source under AdMob | Meta's own standalone SDK integration has gotten progressively less attractive as Meta pushes partners toward its own mediation; better used as one of several networks AdMob mediation calls into than integrated directly. |
| **AppLovin / Unity Ads / ironSource** | Poor fit | These are tuned for gaming/rewarded-video inventory (they're built around game studios' ad-supported free-to-play economics). Odys has no natural rewarded-video moment beyond the "unlock an extra search" idea below, which is a stretch to hang a whole SDK integration on. |
| **Travel-specific "ad networks"** | Don't really exist as a distinct category | What looks like a travel ad network (Skyscanner/Kayak-style monetization) is actually the affiliate/commission model already in `docs/monetization-strategy.md`, not a separate ad product — confirms that doc's framing that affiliate revenue *is* the travel-native monetization mechanism, and a generic ad network would be layering an unrelated model on top. |

**If forced to pick one:** AdMob, as a mediation layer (not necessarily AdMob-only
inventory), for the SDK maturity and Expo support alone.

### Implementation path for this app specifically

- `react-native-google-mobile-ads` is a **native module** — it ships a config plugin
  (`plugins: [["react-native-google-mobile-ads", { androidAppId, iosAppId }]]` in
  `app.json`, alongside the existing `expo-splash-screen`/`expo-calendar` plugin entries) and
  requires a full EAS build, same as every other native-module addition this session (the
  Android APKs built via `eas build -p android --profile preview` in `eas.json`). It **cannot
  run in Expo Go** — not a blocker here since this project already builds via EAS for every
  test cycle, just noting it so nobody tries to iterate on ad placement in Expo Go and gets
  confused when nothing renders.
- `app.json` currently has no `ios.bundleIdentifier` (only `supportsTablet: true`) — iOS
  isn't fully configured for a build yet regardless of ads. If/when iOS ships, App Tracking
  Transparency (below) becomes a hard requirement before any ad SDK can request the
  advertising identifier there; on Android there's no equivalent prompt, just the Play
  Console's "Ads" declaration and (for EU/UK traffic) a consent-management platform, same as
  iOS effectively needs anyway under GDPR.
- No backend changes needed to serve ads themselves (the SDK talks directly to Google's ad
  servers from the client) — the only backend touch would be if a rewarded-ad mechanic
  (below) needs to persist "this user unlocked N extra searches today," which is a small
  addition to `models/User.ts`, same shape as the free-tier quota counting
  `docs/monetization-strategy.md` already sketches for subscription tiers.

### Placement, if built — screen by screen

Read against the actual screens (`app/(tabs)/index.tsx` Home, `app/(tabs)/trips.tsx`,
`app/recommendation.tsx`):

- **Never an interstitial between screens.** The whole product is a chain of small,
  high-intent actions (tap a free slot → see suggestions → schedule one). An interstitial ad
  breaking that chain — the single most common ad-network default — would directly damage the
  thing `docs/monetization-strategy.md` calls the core loop worth protecting pre-paywall.
  If ads happen at all, this format doesn't.
- **A single native ad card, styled like a `PlaceCard`, at a fixed position (e.g. position 4)
  in a recommendation list** (`app/recommendation.tsx`'s `recommendations.map`, or
  `trips.tsx`'s `slotRecs` horizontal scroll) is the least-damaging *generic* ad placement —
  it doesn't add a new visual language, doesn't interrupt navigation, and can be skipped by
  design (horizontal scroll, or just scrolled past). Still generic inventory though — an ad
  for a random product/app, unrelated to the trip, sitting in a list otherwise entirely
  travel-relevant. That mismatch is the actual argument against it, not just format.
- **A rewarded-ad-for-search mechanic** — e.g. a free-tier user who's hit
  `docs/monetization-strategy.md`'s recommendation-refresh cap watches a 15-30s rewarded
  video in exchange for one more refresh, or an early unlock of "Expand Search Radius"
  (`app/recommendation.tsx`'s `handleExpandRadius`, currently free/uncapped) — is the one
  format that doesn't fight the core loop, since it's opt-in and appears only at a point the
  user is already blocked by a quota, not inserted into a flow that was otherwise working.
  This is the one worth a second look if ads get greenlit at all — but it only matters once
  the subscription tier's quotas (not yet built) actually exist to be a wall this bridges.
- **A banner on the Home tab** (`app/(tabs)/index.tsx`, e.g. under the weather card or at the
  bottom of the timeline) is the "least effort to add, least value, least damage" option —
  low eCPM (banners underperform native/rewarded across the board), but also the least likely
  to actually hurt the free-time-slot browsing experience since it doesn't sit inside the
  recommendation cards themselves.

If any of this ships, the native-card and rewarded-search options are the two worth building;
skip interstitials and treat a banner as a last resort, not a default.

### Privacy / consent

- **GDPR**: Odys already collects real personal data with no consent-management layer today
  (`models/User.ts`: email, `homebase`, `preferences` including now `earliestLunchTime`/
  `earliestDinnerTime`; `Contact` records; calendar events via `expo-calendar`; live location
  via `expo-location` in `index.tsx`). None of that currently requires a CMP because none of
  it is shared with a third-party ad network — the moment any ad SDK is added, that changes:
  AdMob (and any mediated network under it) needs a Google-certified Consent Management
  Platform (Funding Choices or an IAB TCF-compliant CMP) shown to EU/UK/EEA users before any
  ad request, per Google's own EU User Consent Policy. This is a real, non-optional
  integration step, not a checkbox — budget for it explicitly if this path is taken.
- **iOS App Tracking Transparency**: not yet relevant (no iOS build configured), but
  `react-native-google-mobile-ads` requires an ATT prompt (`expo-tracking-transparency` or
  equivalent) before requesting `IDFA` on iOS the moment iOS ships with ads enabled — Apple
  rejects apps that skip this. Non-personalized ads can technically run without ATT consent,
  at meaningfully lower eCPM, so this isn't a hard blocker to an iOS build, just a real
  eCPM tradeoff to decide on later.
- **Kids/COPPA**: not applicable — no evidence this targets a under-13 audience, not flagging
  as a real risk, just confirming it was considered.

### How this slots into the tiering plan

`docs/monetization-strategy.md`'s tiering is subscription (volume/social depth) + affiliate
commission (available to everyone, free and paid). If a generic ad network were added on top,
the only coherent place for it is **shown to free tier, removed on premium** — the standard
freemium-ads pattern, and it wouldn't need new backend entitlement logic beyond the
`subscription.tier` field that doc already sketches (an `if (user.subscription.tier ===
'premium') return null` around the ad component, client-side).

The real tension, though, isn't mechanical, it's positioning: `docs/monetization-strategy.md`
explicitly leans on an "ad-free ethos" (citing Beli) as part of why the free tier can stay the
full, uncapped-by-category core loop without feeling exploitative — that's doing real work in
that doc's argument for why gating by volume/social-depth instead of by category is the right
call and will land well with users. Adding a generic ad network to the free tier undercuts
that specific argument, even if it doesn't undercut the revenue math. That's the actual reason
to hold off, more than the eCPM math above — the eCPM math just confirms it's not leaving much
on the table by doing so.

## Roadmap: rank curated places above Google-sourced ones (Nico, 2026-08-20)

A sharper version of the "sponsored/native placement" idea above, raised while reviewing the
Rome trip build: rather than a visually-distinct sponsored *card* (Viator/GetYourGuide-style),
the monetization lever could just be **ranking priority** — `Place.source: 'curated'` results
outrank `'google'` results, which outrank `'generated'` filler, ahead of (or blended with)
matchScore/rating. Not building this now — captured here so it isn't lost.

Why it's a genuinely different (and arguably cleaner) mechanism than the sponsored-card idea:

- **No new UI.** It's a sort-order change, not a new component — nothing to design, no
  "Sponsored" badge to get right, no risk of it reading as an ad in a list of organic results
  (the exact criticism generic ad networks draw, per the section above).
- **The editorial premise is real, not manufactured.** The 60 hand-curated Paris/Rome/London
  places (`scripts/seed-curated-places.ts`) are already genuinely vetted — ranking them first
  is a legitimate quality signal today, with zero monetization attached. The monetization
  angle is what it becomes *later*: curation slots are a scarce, sellable thing ("get your
  venue into the hand-curated set that ranks first") once there's enough traffic for that
  scarcity to matter to a venue — same "needs real volume before that conversation is worth
  having" caveat as the sponsored-placement idea above.
- **Today's ranking has no source-awareness at all** — both recommendation endpoints
  (`server.ts`) sort purely on computed match score: `{ $sort: { matchScore: -1, rating: -1 } }`
  (solo) and `{ jointScore: -1, rating: -1 }` (joint). A `curated` place with a mediocre tag
  match can currently rank *below* a `generated`-filler place with a lucky tag overlap. The
  fix is adding `source` as a leading sort key (curated → google → generated) ahead of or
  blended with the existing score, likely as a small weight added in
  `lib/place-matching.ts`'s scoring rather than a hard tier, so a curated place with a truly
  terrible match doesn't outrank a `google` place with a great one — needs a real design pass,
  not just flipping the sort key order.
- **Interacts with the shuffle just shipped** (`shuffled()` in `lib/place-matching.ts`, applied
  to both endpoints' top-10 pool): if/when this ships, the shuffle should be re-scoped to
  shuffle *within* each source tier, not across them — otherwise a source-priority ordering and
  a full shuffle directly fight each other, and curated places would stop reliably ranking
  first the moment they're mixed into a shuffled pool with everything else.

## What this deliberately doesn't cover

Actual eCPM benchmarking against Odys's real (currently ~zero) traffic, a CMP vendor pick, and
UI mocks for any of the placements above — all downstream of the business decision (build
this at all?) this doc is meant to inform, not a decision this doc makes.
