# Monetization strategy

Research + recommendation, written pre-implementation. No code changes accompany this
document — it's meant to settle the *model* before `docs/gcp-migration.md`-style technical
work starts on entitlements, affiliate links, or the "coming soon" UI treatment for
Events/Activities.

## The question this answers

The original framing was: *"Freemium — Events and Activities are paid, Restaurants stay
free, because Restaurants are the cheap category (Google Places) and Events/Activities need
paid third-party integrations (ticketing APIs, Strava/Visorando)."*

That's a real, defensible instinct, but it gates by **our cost to source the data**, not by
**what the user is willing to pay for**. Those aren't the same axis, and conflating them is
the main risk in the original framing. This doc evaluates that axis against two others —
usage volume and advanced-feature gating — and against a mechanism that doesn't require
gating at all: affiliate/booking commissions. It lands on a blend, not a single axis, and
explains why.

## What comparable apps actually do

| App | Category | Free tier | Paid tier | Model |
|---|---|---|---|---|
| **Wanderlog** | Collaborative trip planning | Full group planning, unlimited trips/collaborators, reservation imports, budgeting | Wanderlog Pro, $40/yr | Power-user features (offline maps, more AI generations) — **not** category gating |
| **Layla** | AI trip planner / booking agent | Top-level overview only, no day-by-day breakdown | $49.99/yr (~$10–30/mo tiers) | Depth of output gated from day one; positions itself as a booking agent, not just a planner |
| **Tripsy** | Trip organizer | Basic itinerary | $59/yr or $299 lifetime | Classic SaaS-style tiering |
| **Beli** | Social restaurant discovery ("Circles"-like) | Full social graph, rankings, friend-following — kept ad-free and free | Beli Supper Club / "Insider" membership: curated in-person dining events, upscale experiences | Monetizes an *added layer of curated experience*, not the core discovery loop. Also building a B2B analytics product (restaurants/chains as the paying customer, not the end user) |
| **Partiful** | Social event planning | Fully free today | Undecided publicly; CEO has said there's real spend around real-world social plans/events | Hasn't monetized yet — instructive mainly as "growth first, monetize the moment of a real-world plan later" |
| **Triply / Reelstrip / Layla+TripPlannerAI** | Social-content → itinerary apps | Free import from TikTok/Instagram/Google Maps saves into a day-by-day plan | Subscription for deeper AI itinerary generation | This is almost certainly the category behind the Instagram/Reels ads — the hook feature (importing saved reels into a real itinerary) is the free viral loop; the paywall sits behind itinerary depth, not the import itself |

Two patterns repeat across every real competitor:

1. **Nobody gates by data category.** No app puts "restaurants" behind a different wall than
   "activities." They gate by *depth, volume, or advanced/social features* — number of
   trips, AI generations, collaborators, export formats, curated/exclusive layers. The
   free tier is usually the **entire core loop**, just capped or shallower.
2. **Commission/affiliate revenue is treated as a first-class, separate stream, stacked on
   top of subscription — not a substitute for it.** The 2026 guidance across app-monetization
   sources is explicit: successful travel apps stack subscription + affiliate commissions
   (4–15% per booking) + sometimes B2B licensing, because travel has a natural moment where
   the user is already about to pay a third party for something real (a table, a tour, a
   ticket) and the app just needs to be in that path.

Sources: [Wanderlog pricing (Layla blog tier-list)](https://layla.ai/blog/news-and-tips/ai-trip-planners-tier-list), [Layla pricing](https://layla.ai/blog/news-and-tips/ai-trip-planners-tier-list), [AI app monetization strategies 2026](https://www.coherentlab.com/blog/ai-app-monetization-strategies), [Beli: A Recipe for Revenue — Ivey Business Review](https://www.iveybusinessreview.ca/magazine/articles/beli), [Beli business model](https://lastnamesgenerator.com/the-business-model-of-beli-how-it-makes-money/), [Partiful monetization Q&A — Sherwood News](https://sherwood.news/business/partiful-party-event-planning-app-monetization-and-future-q-and-a/), [Best travel apps 2026: social media edition — Plotline](https://getplotline.app/blog/best-travel-planning-apps-social-media), [Triply](https://triplyplanner.com/), [Reelstrip](https://reelstrip.com/tiktok-travel-planner)

## Recommendation

**Don't gate by category. Gate by depth/volume/social features, and layer affiliate
commissions on top — concentrated in Events and Activities because that's where the
commission economics actually exist, not because that's where our data costs are highest.**
This keeps the user's original instinct (Events/Activities end up being where the money is)
but gets there for the right reason, which matters because it changes what "free" means:

- **Free tier = the whole product, capped.** All three categories (Restaurants, Activities,
  Events) are visible and usable for free, including the "coming soon" stubs for
  Walking Tours/Cycling/Scenic Drives and for Events until those integrations land. A free
  user gets solo recommendations, a capped number of active trips (e.g. 1 at a time), and a
  capped number of AI-scored recommendation refreshes per week. This matters for Odys
  specifically because the product thesis (`CLAUDE.md`) is that discovery, work-schedule
  fit, and friends-nearby are **one product** — paywalling a third of that on day one breaks
  the core loop before a new user has any reason to trust the app enough to pay. Wanderlog's
  free tier proves this works: keep the collaborative core free, it's what drives word of
  mouth.
- **Premium subscription gates *volume and social depth*, across all categories:**
  unlimited concurrent trips, unlimited blind joint-matching invites (the actual
  differentiator — this is expensive to compute and valuable, unlike a Google Places call),
  proactive alerts (push notification when an event you'd match with lands inside a trip
  window — the Metallica-in-Paris case), priority/expanded search radius, and first access
  to Strava/Visorando route integration once built. This is a "pay for the app to work
  harder for you," not "pay to unlock a room," framing.
- **Affiliate/commission revenue is the second, independent stream — not a subscription
  substitute — and it should be available to free *and* paying users.** When Odys shows a
  bookable tour, activity, or concert, the outbound link is a tracked affiliate link
  (Viator/GetYourGuide for activities, Ticketmaster/SeatGeek once the ticketing integration
  exists). Commission rates run 8–12% (Viator) and 5–8% (GetYourGuide), both on 30-day
  cookies; SeatGeek's partner program averages ~$11/sale. This is exactly the moment bleisure
  travel apps are built for — "you're already about to buy a ticket for the show your app
  told you about" — and it costs nothing to build relative to a paywall: it's a link with a
  tracking parameter, not an entitlement check.
  - **Restaurants deliberately don't get this treatment.** OpenTable/Resy's commission
    structures (per-cover fees, flat monthly SaaS) are charged *to restaurants* for the
    reservation system itself, not to referral partners the way Viator/Ticketmaster are —
    there's no clean affiliate program to plug into on the restaurant side today. That's the
    real reason Restaurants stay the free, no-monetization-attached category: not because
    Google Places is cheap (it is, but that's a red herring for the business model), but
    because there's currently no commission mechanism there. If Odys later adds reservation
    booking (OpenTable/Resy integration), revisit this — but don't design the tiering system
    around it now.

Net effect: the user's instinct (Events/Activities = the paid side of the product) turns out
to be right, but the mechanism is affiliate commission economics that exist specifically for
bookable things, available to everyone, not a subscription paywall that exists because
Google Places happens to be free. The subscription paywall runs orthogonally, on
volume/social depth, across the whole app.

## Mobile-specific mechanics — what this concretely means for Odys

**Subscriptions are expensive on-platform.** Apple takes 30% of subscription revenue in
year one, dropping to 15% for a subscriber's second year onward, or 15% from day one if
Odys qualifies for the Small Business Program (proceeds under $1M/year — true today and for
the foreseeable beta/early-launch period, so worth enrolling immediately once subscriptions
exist). Google Play takes 15% from day one on the first $1M in proceeds, per-developer, no
enrollment needed, and that's dropping further (20%→ actually 15%→10% for subscriptions) in
key regions through 2026–2027.

**Affiliate/commission revenue does *not* go through in-app purchase, and does not take the
platform cut.** Booking a real-world tour or a concert ticket through an outbound link to
Viator or Ticketmaster is a purchase of a physical/real-world service completed on that
company's own site or app — this is the kind of external link both Apple and Google
permit without routing through their IAP systems (unlike a digital good or subscription
consumed inside the app). Practically: Odys keeps the full affiliate commission, no platform
cut at all. This is a second reason (beyond the product-loop argument above) to lean on
commission revenue rather than trying to push everything through a subscription paywall —
the unit economics are strictly better per dollar of revenue.

**Tooling: use RevenueCat rather than building cross-platform IAP handling directly.**
RevenueCat is free up to $2,500/month in tracked revenue, then 1% above that, with no seat
fees. It normalizes Apple/Google (and web) subscription receipts into a single
"entitlement" concept, handles renewal/grace-period/billing-retry edge cases that are easy
to get wrong by hand, and — most relevantly for Odys's architecture — pushes webhook events
the backend can consume to keep `models/User.ts` in sync with subscription state, instead of
trusting client-reported receipts. Given the backend is already a plain Express/Mongoose
server (not a BaaS with this built in), RevenueCat is the pragmatic choice over rolling
StoreKit/Play Billing verification by hand.

Sources: [RevenueCat: The 15% App Store Fee](https://www.revenuecat.com/blog/engineering/small-business-program), [App Store Small Business Program 2026 — Adapty](https://adapty.io/blog/app-store-small-business-program/), [Google Play and App Store fees 2025/2026 — SplitMetrics](https://splitmetrics.com/blog/google-play-apple-app-store-fees/), [RevenueCat pricing](https://www.revenuecat.com/pricing), [Viator affiliate program](https://phptravels.com/blog/how-to-earn-with-the-viator-affiliate-program), [GetYourGuide affiliate program](https://affiliateprogramsguru.com/programs/getyourguide-affiliate-program/), [Ticketmaster affiliate/distribution partners](https://developer.ticketmaster.com/partners/distribution-partners/), [SeatGeek Partner Program](https://seatgeek.com/build), [OpenTable vs Resy commission structures](https://restaurant.eatapp.co/blog/opentable-vs-resy)

## Rough backend sketch (for later planning — not a spec)

This is deliberately shallow; the point is to leave enough breadcrumbs that implementing the
above doesn't require re-deriving the shape from scratch.

- **`models/User.ts`** would need a `subscription` sub-document, something like:
  `{ tier: 'free' | 'premium', status: 'active' | 'grace_period' | 'canceled' | 'expired', platform: 'ios' | 'android' | 'web', revenueCatAppUserId: string, currentPeriodEnd: Date }`.
  `revenueCatAppUserId` should just be set to Odys's own Mongo `_id` at login/signup, so
  RevenueCat webhook events can be matched back to a `User` without a separate mapping
  table.
- **A new webhook endpoint**, e.g. `POST /api/webhooks/revenuecat`, verifying RevenueCat's
  signed webhook payload and upserting the `subscription` sub-document on the matching
  `User` whenever a `INITIAL_PURCHASE` / `RENEWAL` / `CANCELLATION` / `EXPIRATION` event
  arrives. This is the source of truth — never trust a client-reported "I'm subscribed"
  flag, since that's trivially spoofable from a modified client.
- **Entitlement checks** would sit as light middleware on a small number of endpoints, not
  scattered ad hoc: candidates are the trip-creation endpoint (cap active trips for `free`),
  the blind joint-matching endpoint `POST /api/events/:id/recommendations` (cap invites or
  gate it entirely behind `premium`), and a future event-alert subscription endpoint. Most
  of the app (browsing, viewing places, restaurants generally) needs **no** entitlement
  check at all, consistent with the "free tier = the whole product, capped" framing above.
- **Free-tier quota enforcement** doesn't need new infrastructure at beta/early-launch
  scale — a count against existing `Trip`/recommendation-request documents (with a
  timestamp) is enough; no separate metering service needed until volume actually justifies
  it.
- **Affiliate links need no entitlement logic at all.** A small `lib/affiliate-links.ts`
  helper that appends a tracking/subid parameter (Odys's user or trip ID) to outbound
  Viator/GetYourGuide/Ticketmaster/SeatGeek URLs, attached to the relevant `Place`/event
  payload in the API response, is sufficient engineering-wise — the actual blocker is
  business development (affiliate account approval with each provider), not code.

## Finalized decisions (2026-09-17)

Settled after reviewing a fuller implementation/payments plan (which also covers Google Play
Billing vs. RevenueCat vs. alternative billing, and comparable-app research — not duplicated
here, this section only records the numbers actually decided):

- **Free tier cap: 3 scheduled trips per calendar month**, not 1-active-trip-at-a-time as
  floated in the "Recommendation" section above — superseded by this. Deliberately a
  starting number, expected to change; must be configurable without a redeploy (a small
  Mongo config document + admin-token-gated route, not an env var, since Cloud Run needs a
  new revision to pick up an env var change).
- **Deleting a trip does NOT free up that month's quota slot.** This means the natural
  "count `Trip` documents created this month" approach (in the "Rough backend sketch" above)
  doesn't work as stated — a deleted `Trip` stops matching that query, which would
  incorrectly free the slot. Needs a separate, append-only `TripCreationEvent` log
  (`{ user_id, createdAt }`, one row inserted at trip-creation time, never modified or
  deleted afterward) counted instead of `Trip` itself — same "count documents with a
  timestamp, no drift possible" philosophy, just decoupled from the trip's own lifecycle.
- **During a billing-retry grace period** (a renewal payment fails but Apple/Google are still
  retrying), the user keeps full unlimited/premium access — do not downgrade to the free cap
  just because a charge is pending retry.
- **Pricing: $2.99/month, plus an annual plan at a discount (~$19.99/year, ~44% off the
  monthly-equivalent rate).** Both under one `premium` entitlement in RevenueCat — no
  separate feature difference between the two, purely a billing-cadence/price choice for the
  user.
- **Estonian OÜ + EU OSS VAT question is parked** — revisit before enabling any *direct*
  (non-Play-Billing) payment path, not before standard in-app Play Billing, which keeps
  Google as merchant of record and out of Odys's own VAT-collection obligations for now.

## What this deliberately doesn't cover

The actual UI/copy for a paywall or upsell moment, and ads as a fourth revenue stream
(skipped — Beli's "ad-free ethos" pairs with a name-brand curated-experience upsell, which
fits Odys's positioning better than a generic ad network would). Those remain open.
