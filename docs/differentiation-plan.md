# Differentiation plan — what to build so Odys isn't "a chatbot with a calendar"

> **For agentic workers:** this is the roadmap-level plan. Each feature below is one
> independent sub-project: expand it into a task-level plan (superpowers:writing-plans) at
> execution time, then implement it (superpowers:executing-plans). The decisions an executor
> would otherwise have to ask about are already made in each section's **Decided** block —
> don't re-ask them.

**Goal:** ship the beta-gating items, then the features that the general chatbots (ChatGPT,
Gemini, Claude) and the travel apps structurally can't copy quickly — with one "go" per phase
instead of a question per decision.

**Builds on:** `docs/competitive-landscape.md` (travel-app competitors, still accurate except
where noted below), `docs/monetization-strategy.md`, `docs/play-beta-setup.md`.

Written 2026-11-11.

## 1. Where Odys stands

### Corrections to `docs/competitive-landscape.md`

That doc lists two gaps that have since shipped: **auto trip discovery** from flight/lodging
calendar signals (0.0.40) and **friends-nearby discovery** (`GET /api/friends-nearby`,
sharer-driven by circle). The remaining gaps it names are still real: no natural-language
entry point, no booking links, thin event data, calendar-only (no inbox) signal net.

### What Odys already does better

| Strength | Why it matters | Who lacks it |
|---|---|---|
| Free time is *computed*, not asked for — `lib/free-time.ts` carves windows out of the real calendar, meal-aware, on the destination's clock | The user never types "I'm free 18:30–20:15" | Wanderlog, Mindtrip, Layla, Tripsy (plan from a blank slate) |
| Recommendations come from a real `Place` collection scored deterministically (`lib/place-matching.ts`), anchored on the hotel for that night | No invented venues, distances are real | Pure-LLM planners (Vacay, chatbots without grounding) |
| **Blind joint matching** — `POST /api/events/:id/recommendations` ranks places against every participant's tastes and never returns a per-person breakdown | Needs several users' private data on one server, with consent | Every single-user product, including all three chatbots |
| Circle-scoped presence sharing (`sharedWithCircles`, `homebaseSharedCircles`) | "Who I know is here" with privacy by default | TripIt, TripSuite, iMean, Mindtrip; ANEAR has it but nothing else |
| Offline-first (AsyncStorage + mutation queue) | Works in a taxi with no roaming | Every chatbot |
| $2.99/mo, core loop free | 5–7× cheaper than a chatbot subscription | ChatGPT/Gemini/Claude paid tiers (~$20/mo) |

### The chatbots — the honest read

Sources for this section are trade press and comparison blogs from late 2025 to mid 2026, some
of it leak-based; treat specifics as unverified until checked against vendor pages.

- **Gemini** has the strongest raw material: live Maps/Flights/Hotels data and Workspace
  (Calendar, Gmail) context. Its "Personal Intelligence" features were reported as
  **unavailable in the EEA, UK and Switzerland**, and a calendar-driven "Proactive Assistance"
  mode was reported in testing in May 2026.
- **ChatGPT** has Pulse (proactive daily briefings; Gmail/Calendar connectors optional, off by
  default; launched to Pro on mobile) and paid agent mode. Reports conflict on whether it has
  live partner booking inventory.
- **Claude** is rated best for complicated multi-person itineraries; a proactive assistant
  connected to Calendar/Gmail was reported in testing, unconfirmed.

**Conclusion.** "Reads my calendar and suggests something for my free evening" — Odys's
pillar 1 + 2 for a *single* user — is where all three are heading, with better place data than
Odys will ever have. That part is a feature race Odys loses on resources. Three things they
structurally don't have:

1. **Two-sided data.** A chatbot sees one person's calendar. It cannot know that you and a
   colleague are both free Thursday 19:00 in Lisbon, because the colleague's calendar isn't in
   your account. Odys has both users, a consent model (circles), and blind matching already.
2. **A trip object on a phone.** Hotel anchor, destination timezone, per-day schedule, push
   token, offline cache. A chat thread has none of these; it has to be re-told or re-fetch.
3. **Zero-prompt delivery at the right minute**, in Europe, at $2.99. Gemini's personal
   features are region-restricted and the proactive modes sit in $20/mo tiers.

So: stop competing on "better recommendations", compete on **"who can I see, and when are we
both free"**. That is also `docs/competitive-landscape.md`'s own conclusion ("treat Circles as
the moat").

## 2. Differentiating features, ranked

| # | Feature | Moat | Effort | Needs from a human |
|---|---|---|---|---|
| D1 | **Overlap alerts** — push when a contact's shared trip/homebase overlaps yours | High (two-sided) | S | nothing |
| D2 | **Free-window nudges** — a notification before each free window with 3 picks near the hotel | Medium (table stakes done right) | M | nothing |
| D3 | **Mutual free windows** — "you and Sam are both free Thu 19:00–21:00" → one-tap joint invite | **Highest** | L | nothing |
| D4 | **"Say it" box** — a sentence → tags → the existing scoring engine | Low (closes a UX gap) | M | optional `ANTHROPIC_API_KEY` |
| D5 | **Paste/share a booking confirmation → trip** | Medium (TripIt gap, no inbox access needed) | M | optional `ANTHROPIC_API_KEY` |
| D6 | Odys as a connector (MCP server) so chatbots call Odys for free windows / friends in town | High, speculative | L | blocked on real auth |
| D7 | Affiliate booking links (Viator / GetYourGuide) | Revenue, not moat | M | affiliate accounts |

D6 and D7 are parked: D6 can't ship while login is email-only (it would expose calendars to
anyone who knows an address), D7 needs partner accounts only the owner can open.

## 3. Execution contract (how this runs with minimal human input)

- One feature = one branch off `master`, one commit series, merged when green.
- Gate for every feature: `npx tsc --noEmit`, `npm run lint`, `npm test` all clean; new pure
  logic lives in `lib/` with a `.test.ts` sibling; a `CHANGELOG.md` `[Unreleased]` entry.
- Server changes are verified live against the **local** Mongo (`npm run mongo start`,
  `npm run server`) with throwaway accounts, then cleaned up.
- **Never without an explicit go:** an EAS build, a Cloud Run deploy, a push to `origin`, any
  migration/backfill against the live database (and then only after a backup).
- New Mongo fields are additive with defaults — no migration needed for anything below.
- Anything that needs an external key is built inert-without-key, like
  `lib/google-places-client.ts`, so it merges and ships before the key exists.
- Human touchpoints for the whole plan: the console steps in Phase 0, one "go" per phase, one
  "go" per build/deploy.

## 4. Phases

### Phase 0 — Billing and Play setup (scripted)

`npm run setup-billing <phase>` (`scripts/setup-billing.ts`, idempotent, `--dry-run`):

| Phase | Does | Human input |
|---|---|---|
| `gcp` | Enables the Play Developer / Pub/Sub / Secret Manager APIs, creates the `odys-play-billing` service account with the roles RevenueCat needs, writes its key to `secrets/`, generates the webhook secret, stores it in Secret Manager and exposes it to Cloud Run | none (gcloud is already logged in) |
| `revenuecat` | Creates the Play app, uploads the service-account credentials, creates products `premium:monthly` / `premium:annual`, the `premium` entitlement, the `default` offering with `$rc_monthly` / `$rc_annual`, the webhook, and writes the public SDK key into `eas.json` | a v2 secret key saved to `secrets/revenuecat-api-key` |
| `play` | Creates the `premium` subscription with both base plans, prices converted to every region from $2.99 / $19.99, 7-day grace period, and activates them | first AAB uploaded + service account invited |

What no API covers (≈15 minutes, in `docs/play-beta-setup.md`): the first AAB upload and
Play App Signing acceptance, inviting the service account in Play Console, the Play-signing
SHA-1 → Android OAuth client, RevenueCat's "Connect to Google" + pasting the topic into Play
Console, license testers and the tester list.

The `play` and `revenuecat` phases have only been exercised in `--dry-run`; their request
shapes come from the current API references, not from a live run.

### Phase 1 — Beta gate (Play requires these before closed testing)

**B1. Account deletion.** `DELETE /api/users/me` (authenticated, `strictLimiter`) removes the
user and everything keyed to them: trips, events they created, their participation in others'
events, contacts they own and contacts pointing at them, friend requests either way,
suggestions, `TripCreationEvent` rows. Pure `lib/account-deletion.ts` builds the list of
`{ model, filter }` operations so the coverage is unit-tested. App: "Delete account" at the
bottom of Profile → confirm dialog → call → `logout()`. Web: `public/delete-account.html`
(Play needs a URL that works without the app) — email + emailed confirmation link through the
existing `lib/mailer.ts`.
*Decided:* hard delete, no soft-delete window; a still-active Play subscription is not
cancelled by deletion — the confirm dialog says so and links to Play's subscription page.

**B2. Privacy policy.** `public/privacy.html`, served by the existing static handler, written
from what the code actually collects (email, name, avatar, homebase, trips, calendar-derived
events encrypted at rest, contacts, push token, purchase state via RevenueCat, Sentry crash
data). Linked from Profile and the login screen.
*Decided:* English only for the beta; controller named as Nicolas Groh (individual) until a
company exists.

**B3. Sentry on.** Add `EXPO_PUBLIC_SENTRY_DSN` to the `preview` env in `eas.json` and
`SENTRY_DSN` to Cloud Run. Needs the DSN from the owner (or stays off — nothing breaks).

**B4. Feedback link.** Profile already has the suggestion form (`suggestion-form-modal.tsx`);
add a "Report a problem" entry that opens it pre-set to a `bug` type with app version and
device model attached.

**B5. Data Safety draft.** `docs/play-data-safety.md` — the form's answers derived from B2, so
filling the console form is copy-paste.

### Phase 2 — Wave 1: make the social pillar proactive

**D1. Overlap alerts.** Extract the matching in `GET /api/friends-nearby` into
`lib/presence-overlap.ts` (pure: given my trips, the contacts pointing at me and their
shared trips/homebases → `{ friendUserId, city, from, to }[]`). On `POST`/`PUT /api/trips`,
compute overlaps the change *creates* and push both sides through
`lib/push-notifications.ts`: "Sam will be in Lisbon Tue–Thu, same as you". New `Trip` field
`overlapNotifiedUserIds: string[]` so each pair is notified once per trip.
*Decided:* respects the existing sharer-driven visibility exactly (no new consent surface);
free for everyone — it's the growth loop, not a premium feature.

**D2. Free-window nudges.** `lib/slot-nudges.ts` (pure): `DaySchedule` + timezone + meal prefs
→ `{ fireAt, title, body, data: { tripId, slotKey } }[]`, firing 45 minutes before each window
of 60+ minutes, skipping `dismissedSlots`, at most 3 per day. `hooks/useSlotNudges.ts`
reschedules device-local notifications (`expo-notifications`) for the next 3 trip days on app
foreground and whenever trips change — no server cron, works offline. Tapping opens the trip
at that slot. A Profile toggle (default on).
*Decided:* device-local scheduling, not server push; free tier gets the evening window only,
Premium gets every window — this is the "Proactive event alerts" row already in
`components/subscription/plan-comparison.tsx`.

### Phase 3 — Wave 2: the moat, and the missing sentence box

**D3. Mutual free windows.** The app uploads, per trip day, only its free windows —
`PUT /api/trips/:id/free-windows` with `[{ start, end }]`, never event titles or busy detail —
stored on `Trip.freeWindows`. `lib/window-overlap.ts` (pure) intersects two users' windows
(minimum 60 minutes). `GET /api/friends-nearby` gains `mutualWindows` per friend, only for
pairs already visible to each other there. UI: the friends-nearby card shows "Both free Thu
19:00–21:00" with one tap → create an `Event` for that window with the friend invited, which
lands in the existing blind joint-recommendation flow. Push to both when a new mutual window
of 90+ minutes appears.
*Decided:* opt-in per circle with a new `User.freeTimeSharedCircles` (default empty — sharing
*when* you're free is more sensitive than *where* you are); windows are coarsened to 15
minutes; free tier sees that a mutual window exists, Premium sees the times and the one-tap
invite (counts against "Blind joint-matching invites").

**D4. "Say it" box.** `POST /api/recommendations/interpret` `{ text }` → `{ tags, category,
maxDistanceKm? }`, then the client calls the existing `/api/recommendations` with
`tagOverride`. Two interpreters behind one function in `lib/vibe-interpreter.ts`: a keyword
matcher over the taxonomy in `constants/preferences.ts` (always available, unit-tested), and
Claude Haiku constrained to return only tags from that taxonomy when `ANTHROPIC_API_KEY` is
set. Venues always come from the `Place` collection — the model never names a place.
*Decided:* 10 interpretations/day free, unlimited Premium; input capped at 200 characters;
the text is not stored.

### Phase 4 — Wave 3

**D5. Booking confirmation → trip.** A "Paste a confirmation" entry in the create-trip flow
plus an Android share target for text. `lib/confirmation-parser.ts`: regex + `lib/iata-airports.ts`
first (reusing the patterns in `lib/calendar-signals.ts`), Claude Haiku fallback when a key is
set. Output feeds the same prefill path auto trip discovery uses (`hooks/useTripDiscovery.tsx`).
*Decided:* text only, no email inbox access and no forwarding address in this phase.

### Order and why

Phase 0 and 1 unblock the Play beta and are mostly waiting on consoles, so they run first.
D1 before D2 because it is small, server-only, and gives beta testers a reason to invite a
second person. D3 is the feature nobody else can ship, but it needs D1's extracted overlap
logic and a tester base with real pairs to be testable, so it comes after wave 1.

## 5. Out of scope

- iOS (beta is Android-only), email/password or verified login (accepted risk for the closed
  beta; must be fixed before production and before D6).
- Replacing the scoring engine with an LLM planner.
- Event-data vendor choice (`docs/event-data-coverage-plan.md`) — still the owner's call.

Sources: [Dupple — best AI tools for trip planning 2026](https://dupple.com/learn/best-ai-for-trip-planning),
[OpenAI — Introducing ChatGPT Pulse](https://openai.com/index/introducing-chatgpt-pulse/),
[The Decoder — Pulse lets ChatGPT start the conversation](https://the-decoder.com/openais-new-pulse-feature-lets-chatgpt-start-the-conversation/),
[Tripism AI tool for business travellers](https://thebusinesstravelmag.com/tripism-launches-ai-tool-for-friction-free-itineraries/),
[RevenueCat API v2](https://www.revenuecat.com/docs/api-v2),
[Play Developer API — monetization.subscriptions](https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions).
