# Changelog

All notable changes to Odys.ai are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are `0.0.x` while
this is still pre-release/beta.

## [0.0.20] - 2026-08-20
### Fixed
- **Critical: every restored session sent a malformed auth token, 401ing every API call.**
  `hooks/useAuth.tsx`'s `saveState` helper `JSON.stringify`s whatever it's given before
  writing to AsyncStorage — correct for objects, but for the plain JWT string this wraps it
  in literal quote characters (`"eyJhbGci...m0"`). The token restore path on app boot read
  that back with a bare `AsyncStorage.getItem` and passed it straight to `setAuthToken`
  without `JSON.parse`, unlike the adjacent `@user`/`@hasCompletedOnboarding` reads — so
  after any app restart, every request's `Authorization` header carried the token
  double-quoted and failed JWT verification server-side. A token set directly via a fresh
  `login()` call (same-session, no restart) was unaffected, since that path uses the raw
  token in memory and never round-trips through storage first — which is why this was
  invisible in normal development (rarely restarting a running Metro session) and only
  surfaced against a real device that had actually restarted the app. Live-verified against
  the real server log: a restored session's requests were literally arriving as
  `Bearer \"eyJhbGci...\"` and 401ing across every endpoint (trips, contacts,
  recommendations, friends-nearby). Fix is a one-line `JSON.parse` on the read side to match
  how the token is written.

## [0.0.19] - 2026-08-20
### Fixed
- **Critical: curated places were invisible to real trip-based recommendation queries.**
  `buildCityDurationMatchStage`'s city regex only matched when the *stored* `city` field
  contained the *query* string — but real trips store destinations as `"Paris, France"`
  (`trips.tsx`'s `${c.name}, ${c.country}` from the geocoding picker), while the 60 curated
  places from `scripts/seed-curated-places.ts` are stored as bare `city: 'Paris'`. `"Paris"`
  never contains `"Paris, France"`, so every curated place silently never matched — real trip
  planning has been serving almost entirely synthetic `generated` filler instead of the
  hand-curated content this whole time. Fixed with a new `cityNeedle()` helper (reduces either
  side to its name-only prefix before matching) applied consistently across all three sites
  that build a city regex: `buildCityDurationMatchStage`, `ensurePlacesForCity`'s
  existence-check (which also means it no longer over-generates synthetic filler for cities
  that already have curated coverage), and `GET /api/friends-nearby`. Live-verified: a
  `"Paris, France"` query against `POST /api/recommendations` went from 4 synthetic-only
  results to 10, including The Louvre, Musée d'Orsay, Seine River Cruise.

### Added
- **`DEFAULT_MAX_DISTANCE_KM`** (5km) — recommendation queries now apply a "near me" distance
  ceiling by default instead of returning every place in a city regardless of distance;
  `POST /api/recommendations` accepts an optional `maxDistanceKm` override. Live-verified
  against real Paris data: a 1.5km cap correctly excludes a 2.2km-away place that a 5km/50km
  cap includes.
- **Smart Suggestions**: "Expand Search Radius" (`recommendation.tsx`) is now wired up instead
  of showing a "coming soon" alert — tapping it re-queries with `maxDistanceKm: 25` (a single
  metro-area ceiling, not uncapped, to stay in "near your hotel" territory rather than
  suggesting a day trip). Once expanded, the button gives way to a static note instead of
  staying tappable, since a second tap at the same ceiling can't surface anything new.
- **"Coming soon" treatment in preference pickers**: tags with no real data source yet (per
  `lib/google-places-types.ts`'s `hasGoogleMatch`) now show a small dashed border + "Soon"
  badge in both `components/ui/categorized-picker.tsx` (used by onboarding) and
  `app/(tabs)/profile.tsx`'s `CategorizedSelectionModal` (Profile's edit sheets) — they're
  still fully selectable as a stated preference, this is a content-availability note, not a
  feature gate. The Event taxonomy also gets a one-line note ("venues are covered — matching
  what's actually on during your dates is coming soon") since even its Places-API-backed tags
  (Concerts, Theater, etc.) can only ever resolve to a venue, never a schedule, until a
  ticketing API is integrated (see `lib/google-places-types.ts`'s `supportsScheduleData`).
- **`lib/google-places-client.ts`**: real Google Places API (New) integration on top of
  `lib/google-places-types.ts`. Wired but a complete no-op until `GOOGLE_PLACES_API_KEY` is
  set — same "inert until configured" pattern as Sentry — so nothing changes for anyone
  without a key. Fetches Restaurant and Activity content only (Event is structurally
  unsupported — Places API has no scheduled-event data, see `lib/google-places-types.ts`);
  results are classified against our own tag taxonomy via `tagsForPlaceTypes()` and a place
  whose types match nothing in our taxonomy is dropped rather than tagged with a guess. New
  `Place.source: 'google'` (alongside existing `'curated'`/`'generated'`) marks this content as
  real-but-refreshable, distinct from hand-curated data. Wired into `ensurePlacesForCity`
  (`lib/places-population.ts`) as a new middle tier: curated (existing) → Google (new, only if
  a key is configured) → synthetic filler (existing, now only used if still thin after a
  Google attempt). A Google API failure is caught and logged, never thrown — an external API
  problem can't block trip creation or recommendations, it just falls through to synthetic
  content exactly as if no key were configured. **Not live-verified** — no
  `GOOGLE_PLACES_API_KEY` exists in this environment; covered instead by
  `lib/google-places-client.test.ts` with `fetch` mocked (no-key/no-op path, Event-category
  no-op path, type classification against the real mapping table including a cross-category
  collision case, and that a non-2xx response throws rather than silently swallowing).

## [0.0.18] - 2026-08-19
### Added
- **`lib/google-places-types.ts`**: maps every leaf tag in `constants/preferences.ts` (45
  tags across Food/Activity/Event) to Google Places API (New) type IDs, in both directions —
  `getPlaceTypesForTag`/`tagsForPlaceTypes` — plus a `quality: 'direct'|'broad'|'none'` rating
  per tag verified against Google's current Table A type list, not assumed. Confirms the
  structural gap surfaced during the earlier Places API design discussion: the API returns
  venues only, never scheduled happenings, so Event tags (Concerts, Theater, Football, etc.)
  get at best a venue-type proxy (`quality: 'broad'`, always carrying a caveat note) — real
  event data still needs a separate ticketing/listings API later. A handful of Activity tags
  needing route data rather than point data (Walking Tours, Bus Tours, Boat Cruises, Scenic
  Drives, Water Sports) come back `quality: 'none'` for the same reason. Pure data + lookups,
  no network calls yet — this is the mapping layer only, actual Places API calls are a
  separate follow-up. Covered by `lib/google-places-types.test.ts` (includes a taxonomy-drift
  guard: fails if `constants/preferences.ts` ever adds/removes a tag without a matching
  mapping entry).

### Documentation
- Added `docs/monetization-strategy.md`: freemium strategy research — recommends gating by
  usage volume/social depth (trip count, joint-matching invites, event-match alerts) rather
  than by content category, with affiliate/booking commissions (Viator, Ticketmaster-style) as
  an independent revenue stream on top; covers mobile IAP mechanics (Apple/Google's cut,
  RevenueCat) and a rough backend entitlement sketch.

## [0.0.17] - 2026-08-19
### Fixed
- **Home tab**: busy calendar events (red cards) were tappable and routed into the same
  "plan something" flow as free slots — they're purely informational (inherited from the
  device calendar), so this was misleading. Now view-only; free slots (green) are unchanged.
- **Circles**: the "Move Contact" picker built its option list by comparing against the
  page's active *filter tab*, not the contact's actual assigned circle — so viewing the
  default "All" tab meant nothing was ever shown as selected, regardless of the contact's
  real circle. Now correctly checks/highlights the contact's actual current circle
  (`selectedContact.circleTags`), independent of whatever tab the list happens to be on.
  Live-verified against the real database: a circle reassignment round-trips and persists
  correctly. (Also re-confirmed, not a bug: the `setContacts` functional-updater issue from
  earlier this session is still genuinely fixed.)
- **Trips**: tapping a recommended place always defaulted the schedule modal's date/time to
  *today*, regardless of which day's slot the card was actually shown under. Now defaults to
  the tapped slot's real date/time, traced end-to-end to confirm no stale-closure risk in the
  day/slot `.map`.

### Added
- **Smart Suggestions**: an "Expand Search Radius" button on the empty-results state —
  explicitly a placeholder for now (shows a "coming soon" message on tap) since real
  geo/radius matching is separately-tracked, deferred roadmap work, not built here.
- **Trips**: a "Looking for something else?" card at the end of each day's suggestion row
  (and in the empty-results case), opening a new placeholder modal pre-filled with that
  day's date and the trip's destination — a real modal shell, not yet a functional refine
  experience. The actual refine/search behavior behind it is the next focused piece of work.

## [0.0.16] - 2026-08-19
### Changed
- **Replaced localtunnel with `cloudflared` (Cloudflare quick tunnel)** for exposing the
  local backend. localtunnel's free public relay proved unreliable under repeated reconnects
  today — subdomain requests silently fell back to random names even from a genuinely clean
  process state across multiple attempts and multiple distinct names, most likely
  rate-limiting rather than name squatting. `cloudflared` is backed by real infrastructure and
  — verified by test — reconnects to a restarted backend entirely on its own, no tunnel
  restart needed. This let `scripts/restart-server.sh` drop the "kill the tunnel so it
  reconnects" step it needed for localtunnel; the daily 6am restart no longer touches the
  tunnel at all, so the tunnel URL now only changes when `expose-server.sh` itself restarts,
  not on every server restart.
- Trade-off, stated plainly: quick tunnels (no Cloudflare account) can't have a fixed
  hostname the way localtunnel's `--subdomain` flag aimed for — every fresh start of
  `expose-server.sh` gets a new random `*.trycloudflare.com` URL. In practice this ended up
  mattering less than the stability localtunnel was supposed to provide but didn't actually
  hold today.

### Added
- `docs/gcp-migration.md` — since this whole local setup (MongoDB, the tunnel, the cron
  restart, the demo-linker) is confirmed temporary ahead of a move to GCP after the beta,
  documented exactly what's already portable as-is (the Express app, Mongoose models,
  env-var-based config) versus what's local-only and needs a real replacement (MongoDB →
  Atlas or a GCE-hosted Mongo, the always-on process → Cloud Run, the tunnel → a real
  public IP/domain, the cron restart → not needed on Cloud Run, the demo-linker → Cloud
  Scheduler). Also flags that the admin site (`public/admin.html`) has no auth by design and
  must not be deployed publicly as-is.

## [0.0.15] - 2026-08-19
### Added
- **Persisted retry queue for failed trip/contact sync mutations** (`lib/mutation-queue.ts`,
  `hooks/useMutationQueueFlush.ts`). Previously, a PUT/DELETE that failed mid-sync (dropped
  connection — hotel wifi, tunnel drop) was caught, logged, and silently dropped: the
  optimistic local state kept showing the change as applied, and the next full resync would
  quietly revert it with no indication anything was lost. Failed PUT/DELETE calls are now
  queued (AsyncStorage-backed, keyed by entity id — a newer mutation for the same entity
  replaces the queued one rather than stacking, so replay can never apply stale edits out of
  order) and retried on app foreground and at the start of the next sync cycle.
- Deliberately scoped to PUT/DELETE only — those are safe to blindly replay. Retrying a failed
  POST/create isn't attempted here; that needs a server-side idempotency key to avoid
  double-creating on retry, which is separate, larger scope. A failed create still just drops
  and logs, unchanged from before.
- **Live-verified the safety assumption the whole design rests on**: replaying an identical
  PUT twice against a real trip left it in the same correct end state both times; replaying a
  DELETE twice returned 200 then a clean 404 on the second attempt, not an error or corrupted
  state.
- **Verification ceiling, stated plainly**: this task hit a real interruption mid-run (an
  infrastructure connection drop, not a logic problem) after static checks passed but before
  its own live failure-simulation test completed — picked up and finished directly rather than
  re-run from scratch, given the code it had already written was clean and matched the brief.
  `AsyncStorage` is a native module and cannot execute in this environment at all (no RN
  runtime), so the queue's actual persist/replay behavior (as opposed to the server-side
  endpoints it calls) remains unverified beyond `tsc`/`eslint` and careful reading until a real
  device runs it — same ceiling as the rest of this session's client-side work.

## [0.0.14] - 2026-08-19
### Added
- Calendar-import pipeline: `Event` documents can now actually be populated with
  `source: 'imported'` (the model has supported this since the sharing rework, but nothing
  ever wrote to it). `lib/calendar.ts`'s new `getDeviceEventsForDateRange` reads the on-device
  calendar for an arbitrary range without prompting for permission — it only syncs if access
  is already granted, so this never interrupts viewing/creating a trip with a fresh permission
  dialog, it's a silent no-op until the user has separately granted calendar access elsewhere
  (e.g. the Home tab's existing prompt).
- `POST /api/trips/:tripId/events/import` upserts a batch of device events keyed on the
  device's own event id (`google_event_id`), so re-syncing the same trip never duplicates —
  verified live: importing the same batch twice left the trip's event count unchanged.
  Malformed entries in a batch (missing a required field) are skipped individually rather than
  failing the whole import — verified live. Ownership-scoped to the trip like every other
  event route — verified live (a non-owner's import attempt 404s).
- Wired into `trips.tsx`'s existing per-trip effect (same touchpoint that already refreshes
  events/nearby-friends whenever the trip list changes) rather than a new UI element — same
  "opportunistic sync from an existing flow" shape as `ensurePlacesForCity`.
- Imported events are never shareable — `participants` is never set on an import, matching
  how the schema already treats that field as `'created'`-only.

### Explicitly out of scope
- Trip-day scheduling's fixed hardcoded free-time pattern still doesn't consume this data —
  already deprioritized separately ("fine for now, roadmap item"), not reopened here. This is
  just the underlying sync/storage pipeline; nothing yet reads imported events back for
  scheduling purposes.
- No UI rendering of imported events on the trip timeline yet — kept out to avoid improvising
  a design the user hasn't seen; the pipeline itself is verified working via direct API calls.
- **Verification ceiling**: no RN simulator/device in this environment. The API/data layer
  (endpoint, idempotent upsert, ownership scoping) is live-verified against the real database.
  The actual `expo-calendar` read and the trigger-on-trip-view wiring are unverified beyond
  `tsc`/`eslint` until run on a real device — the fake payloads used above simulate what the
  client would send, not a real on-device calendar read.

## [0.0.13] - 2026-08-19
### Added
- `scripts/restart-server.sh` + a daily 6am cron entry — the server previously stayed up
  indefinitely with no scheduled restart, which is exactly how it went ~25 hours on stale
  code earlier this session. Restarting is now automatic, not something to remember.

### Fixed
- **The tunnel silently breaks on every server restart** — the localtunnel client process
  doesn't crash when the backend behind it restarts, it just stops working ("503 Tunnel
  Unavailable" or a timeout) while looking alive. The self-healing loop added in `0.0.6`-era
  work only reconnects on the tunnel *process* dying, so it never caught this. Given the new
  daily cron restart, this would have silently broken connectivity every morning. Fixed by
  having `restart-server.sh` kill the tunnel client as its last step, so `expose-server.sh`'s
  own loop reconnects fresh every time the server does.
- **The `odysai-beta` subdomain stopped binding** — every clean restart attempt fell back to
  a random name instead, including for a second, highly distinctive replacement name
  (`odysai-beta-nico2026`) tried immediately after, which also fell back. That second failure
  rules out simple squatting (an obscure name being taken by someone else in the same few
  minutes is implausible) — more likely the rapid reconnect cycles spent diagnosing this
  rate-limited or otherwise destabilized the connection on localtunnel's free public service.
  Rather than keep fighting for a specific chosen name, settled on whichever URL actually
  came up stable and live (`tiny-deer-39.loca.lt`, verified holding steady), and used that for
  `eas.json`'s `EXPO_PUBLIC_API_URL` and this APK build. `scripts/expose-server.sh`'s default
  and `docs/beta-deploy.md` still reference `odysai-beta-nico2026` as the intended stable name
  to retry once the service settles — if it binds cleanly on a future restart, update
  `eas.json` to match and rebuild; until then, whatever URL a restart actually lands on is the
  one that matters, not the configured default.

## [0.0.12] - 2026-08-19
### Changed
- **Split `hooks/useAuth.tsx`** (previously ~650 lines doing auth + trips + contacts +
  events + token plumbing) into separate providers, per the plan at
  `docs/useauth-split-plan.md`, in the plan's stated order:
  - `lib/api-client.ts` (new, not a provider) — `apiFetch`/`API_URL`/token handling, shared
    by every provider below instead of being duplicated or living only in `useAuth.tsx`.
  - `hooks/useAuth.tsx` (shrunk) — now just identity/session/onboarding: `user`, `login`,
    `logout`, `completeOnboarding`, `updatePreferences`, `updateUser`, `isReady`.
  - `hooks/useContacts.tsx` (new) — `contacts`, `setContacts`, `refreshContacts`.
  - `hooks/useEvents.tsx` (new) — the thin event/recommendation fetch wrappers
    (`fetchTripEvents`, `fetchInvitedEvents`, `createEvent`, `updateEvent`, `respondToEvent`,
    `deleteEvent`, `getJointRecommendations`, `getRecommendations`) plus `getFriendsNearby` —
    the latter wasn't part of the original plan (added to the app after the plan was
    written), placed here as the closest match by shape (stateless request wrapper) rather
    than in Trips or Contacts.
  - `hooks/useTrips.tsx` (new, last) — `trips`, `setTrips`.
  - Nested in `app/_layout.tsx` as `AuthProvider > TripsProvider > ContactsProvider >
    EventsProvider`: Trips/Contacts each now own reacting to auth state themselves (syncing
    from the server when a user logs in, clearing their own state/storage on logout) via
    their own effect watching `user` from `useAuth()`, rather than the old single hook
    orchestrating everyone else's data directly.
  - Updated the 4 screens that actually consumed the moved values: `trips.tsx` (all four new
    hooks), `social.tsx` and `index.tsx` (one each), `recommendation.tsx`
    (`getRecommendations` moved to `useEvents()`). `profile.tsx`, `onboarding.tsx`, and
    `login.tsx` only ever used auth-core values and needed no changes — verified rather than
    assumed.
  - **Verification ceiling, stated plainly**: this environment has no RN simulator/device —
    verification here is `tsc --noEmit` (clean across the whole project, which is fairly
    strong evidence for correct context/prop wiring given how strictly each provider's
    interface is typed), `eslint` (clean, including `react-hooks/exhaustive-deps` on the new
    effects), the existing 28-test suite (unaffected, this is a client-side refactor and
    doesn't touch anything the tests cover), and careful line-by-line preservation of the
    original business logic during the move — not a live run of the actual app. A real
    device test follows immediately after this via a fresh APK build.

## [0.0.11] - 2026-08-19
### Added
- Three real demo accounts (`scripts/seed-demo-accounts.ts`) — Sarah Connor (Paris), Ron
  Burgundy (Palo Alto), Bridget Jones (London) — each with a real homebase shared to "Family
  and Friends" and randomized real taste preferences, so every beta tester has a working,
  self-demonstrating example of "friends nearby" without needing to coordinate with a second
  real tester.
- `scripts/demo-account-linker.ts` (`npm run demo-linker`): a persistent process, left
  running alongside the server/tunnel during a beta session, that checks every 5 minutes for
  any real user not yet linked to the three demo accounts and creates the link — reciprocally,
  in both directions. Bidirectional because `GET /api/friends-nearby`'s visibility is
  sharer-driven (see 0.0.9): a demo account only becomes visible to a tester if *it* has a
  `Contact` pointing at them, which nothing could have pre-created for a tester who didn't
  exist yet when the demo accounts were seeded. Idempotent — safe to leave running
  indefinitely.

### Fixed
- A bug in the same work, caught before it shipped: `demo-account-linker.ts` originally
  imported its email list directly from `seed-demo-accounts.ts`, whose entire seed routine
  (including a `process.exit(0)`) runs as a module-level side effect — importing from it would
  re-run the seed and kill the importing process almost immediately, silently ending the
  "persistent" linker seconds after every start. Fixed by extracting the shared definitions
  into a third, side-effect-free `scripts/demo-accounts.ts` that both import from instead.
- `GET /api/friends-nearby` had its own independent exact-anchored city-match regex (not
  shared with `lib/place-matching.ts`), so it had the identical bug as the "Smart Suggestions"
  fix below, in a third location — bare "Paris" wouldn't match a demo account's stored "Paris,
  France" homebase. Fixed the same way (substring match). Live-verified with the real seeded
  accounts: querying "Paris", "Palo Alto", and "London" each correctly surface exactly the
  matching demo account.
- **The main server process was running stale code for the second time this session** —
  restarted for the 0.0.10 fix below, then several more `server.ts` edits landed (this entry)
  without a further restart before testing, reproducing the exact same class of confusion.
  Restarted again and re-verified. This is clearly a recurring risk in this workflow, not a
  one-off — worth being deliberate about restarting after every `server.ts` change from here
  on, not just remembering to eventually.

## [0.0.10] - 2026-08-19
### Fixed
- **"Smart Suggestions" on the Home tab was silently returning nothing** for almost any real
  location. Two compounding causes: `POST /api/recommendations` never called
  `ensurePlacesForCity`, so a city with no prior trip-driven population had zero candidate
  places to find; and `buildCityDurationMatchStage`'s city match was exact-anchored, so even
  with data present, the Home tab's bare reverse-geocoded city name ("Amsterdam") never
  matched a trip-stored "City, Country" string ("Amsterdam, Netherlands") for the same real
  city. Fixed both — the endpoint now self-populates on first use, and matching is
  substring-based, restoring the leniency the original pre-unification client code had before
  0.0.7's rewrite. `ensurePlacesForCity`'s own existence check had the identical exact-match
  bug (would have generated duplicate synthetic sets under different city-string variants of
  the same city) — fixed the same way. Also cleaned up the synthetic place names/descriptions
  so they read as "Local Amsterdam Cafe" rather than baking in the full "Amsterdam,
  Netherlands" string.
- **The main server process had been running for ~25 hours on stale code** — started early
  in this session and never restarted despite `server.ts` being modified extensively many
  times since (by several rounds of background work). Every "live-verified" claim from that
  work was genuinely tested, but against short-lived test server instances on other ports —
  the actual server backing the tunnel/APK never picked any of it up until restarted here.
  Worth remembering: **the running server needs a restart after any `server.ts` change** for
  it to actually take effect for real usage, not just for a fresh test process.

### Known, low-priority
- City-string matching is substring-based, not truly normalized — creating "Lisbon" then
  later "Lisbon, Portugal" (or the reverse) can still produce two overlapping-but-distinct
  sets of synthetic filler data instead of recognizing them as the same city. Harmless
  (duplicated filler content, not wrong results) but not fully correct. A proper fix would add
  a normalized/indexed city-key field rather than matching on the raw display string.

## [0.0.9] - 2026-08-19
### Added
- Circle-scoped "friends nearby" discovery on trips: `GET /api/friends-nearby` surfaces
  which of your circle-mates already live in, or have a trip to, a given city — as name
  bubbles on the trip card — without you having to search for them. Purely a discovery
  layer in front of the existing "Propose an Event" flow; tapping a bubble pre-selects that
  person there, the underlying blind-matching mechanics are untouched.
- Two separate, privacy-by-default opt-ins, both editable anytime (not just at creation):
  - `User.homebaseSharedCircles` — share "I live here" (not date-bound) with specific
    circles, from a new control on the Profile screen.
  - `Trip.sharedWithCircles` — share a specific trip's destination/dates with specific
    circles, from the trip creation/edit modal.
  Both default to `[]` (fully private). Visibility is sharer-driven, not symmetric: whether
  you can see someone's shared presence depends on *their* own contact list (do they have a
  Contact pointing at you, tagged with a circle they shared that presence with) — never on
  how you've categorized them. Verified live against the real database: correct surfacing
  for homebase matches, trip-date-overlap matches, and someone matching both; correct
  exclusion when dates don't overlap or the viewer isn't one of the sharer's own contacts.
- "Me-Time" as the explicit, positively-framed default in "Propose an Event" (a `Me-Time` /
  `Invite Someone` toggle, `Me-Time` pre-selected) — previously this flow *required* picking
  a friend, so there was no way to plan something just for yourself through it. Me-Time
  reuses the existing solo recommendation endpoint (the same one day-schedule proposals
  already use); inviting someone still goes through the unchanged blind joint-matching flow.
- `components/ui/circle-share-selector.tsx`: shared multi-select used by both new sharing
  controls.

### Fixed
- `trips.tsx`'s `ContactPicker` selected and submitted a contact's linked `contact_user_id`
  (a User id), but `participantContactIds` server-side expects `Contact._id` values — every
  real "Propose an Event" invite would have failed with "not found in your circle". Never
  caught earlier because nothing in this session could actually exercise the rendered RN UI,
  only the API directly. Found while wiring the nearby-friends tap-to-invite shortcut (which
  needed the same resolution), fixed, and verified live end-to-end with a real linked contact.

## [0.0.8] - 2026-08-19
### Fixed
- Replaced all 9 stray `alert()` calls across the app (`trips.tsx` ×8, `profile.tsx`,
  `onboarding.tsx`) with React Native's `Alert.alert(title, message)` — plain browser
  `alert()` doesn't render correctly/consistently on native.
- Copy pass removing leftover over-verbose "scaffolding" phrasing across `trips.tsx`,
  `profile.tsx`, `recommendation.tsx`, `index.tsx`, and `social.tsx` (e.g. "You securely
  haven't populated any trips analytically yet." → "You haven't added any trips yet.";
  dropped an internal implementation detail — "Odys.ai is currently using mock data" —
  that had leaked into user-facing copy on the Home tab).
- `profile.tsx`'s "About" card now reads the app version from `expo-constants`
  (`Constants.expoConfig?.version`) instead of a second hardcoded string that could drift
  from `app.json`'s actual value.

### Removed
- The dead-end "Sync Native Calendar" button (and its now-empty Integrations card) from
  `profile.tsx` — it only fired a permission request + alert with no memory of the result,
  and duplicated what the Home tab's own (kept, functional) calendar-sync banner already
  does.

## [0.0.7] - 2026-08-19
### Added
- `.gitignore`d `.env` properly (was previously only excluding `.env*.local`) and pushed the
  first real commit of the app to GitHub (`0a46100`), followed by a fix commit (`9f088af`).
- EAS Android build pipeline working end-to-end: `EXPO_PUBLIC_API_URL` now declared in
  `eas.json`'s `preview` build profile (a locally-exported shell env var is not picked up by
  EAS's cloud build the way local dev does — this must be declared there explicitly).

### Fixed
- `@react-native-async-storage/async-storage` was pinned to `3.0.2`, which depends on an
  unresolvable native package and fails the Gradle build outright. Corrected to `2.2.0`,
  the version Expo SDK 54's compatibility table actually expects.
- `POST /api/recommendations` (new) and `lib/place-matching.ts` (new, shared scoring logic):
  unified the solo-recommendation path (`trips.tsx` day-schedule proposals,
  `recommendation.tsx` Home-tab suggestions) onto the same server-side, deterministic,
  tag-based scoring the joint-matching endpoint already used — previously these ran
  client-side against a static mock array with `Math.random()`-based scoring, two silently
  disagreeing "sources of truth" for the same concept. Removed the now-dead
  `MOCK_PLACES_DATABASE`/`getRecommendationsForSlot`/`getRecommendationsForTrip`/
  `applyPreferences` from `lib/recommendations.ts` and deleted the superseded
  `scripts/seed-places.ts`.
- `app/(tabs)/profile.tsx` deduplicated: now imports its genre category lists from
  `constants/preferences.ts` instead of keeping a second, driftable copy.
- `hooks/useAuth.tsx`: added `refreshContacts()`, called when the "Propose an Event" modal
  opens — a contact linked via `npm run link-contact` mid-session no longer requires an app
  restart to become usable.

### Testing
- Added a real test suite (`npm test`, Node's built-in `node:test` via `tsx --test`, zero new
  dependencies) — 28 tests. Split `lib/calendar.ts`'s pure free-time-slot math into
  `lib/free-time.ts` (needed to make it testable outside the RN/Expo build pipeline, since
  `expo-calendar` transitively pulls in `react-native`). Covers the free-time-slot algorithm,
  the joint-matching scoring logic, meal-window classification — and, deliberately not
  mocked, a live integration test against the real database reproducing the exact
  `preferences.foodGenres`-returns-`undefined` bug pattern fixed in 0.0.5, so it can't
  silently regress.

### Documentation
- `docs/useauth-split-plan.md`: a concrete plan (provider boundaries, migration order) for
  splitting `hooks/useAuth.tsx` — judged too risky to execute blind in this pass with no way
  to run the RN app live in this environment; written up rather than attempted partially.
- Contact-linking directionality (one-way vs. reciprocal) documented as an open product
  decision, intentionally not changed.

## [0.0.6] - 2026-08-19
### Added
- `models/Place.ts`: `source: 'curated' | 'generated'` field distinguishing hand-vetted
  entries from synthetic filler.
- `lib/places-population.ts` (`ensurePlacesForCity`), called from `POST /api/trips`: tops up
  a destination with synthetic fallback places only if it has fewer than 5 candidates, never
  touching or duplicating existing (especially curated) entries.
- `scripts/seed-curated-places.ts`: 60 real, named restaurants and activities across Paris,
  Rome, and London (10 restaurants + 10 activities each), tagged from the app's actual genre
  taxonomy (`constants/preferences.ts`).
- Local-only admin website for curating vetted places, no auth by design: new
  `GET/POST/PUT/DELETE /admin/api/places` routes in `server.ts` (always forcing
  `source: 'curated'` server-side regardless of request body) and a single static
  `public/admin.html` page, no build step or framework.

### Verified
- A randomized live end-to-end test (3 account pairs, genuinely random tag-preference
  subsets, not hand-picked) independently recomputed every joint-matching score and
  diffed it against the server's actual output across Paris/Rome/London — zero mismatches.
  Also verified the uncurated-city fallback path (a city with no curated data) through the
  real `POST /api/trips` route.

## [0.0.5] - 2026-08-18/19
### Fixed
- **Critical**: `models/User.ts`'s `preferences` subdocument only declared `dietary`/
  `activity_level`; every other preference field (`foodGenres`, `activityGenres`,
  `eventGenres` — exactly what joint-matching scores against) was undeclared. It stored and
  round-tripped through `res.json()` correctly, but returned `undefined` on **direct property
  access** inside server code (a Mongoose nested-subdocument behavior, not something a
  mocked unit test could have caught) — meaning the blind joint-matching feature's
  `jointScore` had been silently `0` for every place, for every user, since it was first
  built. Found only by actually running the full flow against a real database. Fixed by
  formally declaring the real preferences shape in the schema.
- `lib/mongodb.ts` read `MONGODB_URI` from `process.env` at **module import time**, but every
  consumer (`server.ts`, the seed/link scripts) imports it before calling `dotenv.config()` —
  so it was silently always falling back to a no-auth `localhost` connection regardless of
  `.env`, invisible until a real MongoDB existed to expose the mismatch. Fixed by reading the
  env var lazily inside `connectToDatabase()`.
- `scripts/link-contact.ts` queried `contact_user_id: { $exists: false }`, but an unlinked
  invite sets it to explicit `null`, not a missing field — the script would never have found
  anything. Fixed to query `null` directly.
- `app/recommendation.tsx`'s `handleSelectPlace`: selecting a suggestion reached via a
  "Scheduled Conflict" was calling `Calendar.updateEventAsync` on the real, original calendar
  event — silently overwriting its title/location/notes (e.g. a real meeting could become
  "Bistro Voltaire"). Now always creates a new, separate calendar entry instead.

### Added
- A real local MongoDB (user-space binary install, no Docker/apt/sudo, matching the
  credentials already in `.env`) — `scripts/local-mongo.sh` (`npm run mongo start|stop|status`)
  — enabling actual end-to-end testing against a live database for the first time this
  session, which is what surfaced the fixes above.

## [0.0.4] - 2026-08-18
### Added
- `app/onboarding.tsx` extended from 3 to 6 steps: added Food/Activity/Event taste
  collection (previously only reachable via Profile after the fact, so every new user
  started with identical hardcoded defaults). New `constants/preferences.ts` (shared
  category-list source of truth) and `components/ui/categorized-picker.tsx`.
- `lib/geocoding.ts`: free Open-Meteo geocoding lookup (no API key), powering debounced
  city autocomplete/validation on `trips.tsx`'s destination field, `profile.tsx`'s homebase
  field, and onboarding's homebase step — warns on no match, never blocks.
- `scripts/link-contact.ts` (manual stopgap): backfills `contact_user_id` on pending
  contact invites once the invited person has logged in, given real automatic
  account-linking is deliberately deferred.

### Fixed
- `hooks/useAuth.tsx`'s `completeOnboarding` was wholesale-replacing `user.preferences`
  instead of merging into it — every onboarding completion silently wiped server-set
  defaults (budget/currency/dateFormat). Now merges.

## [0.0.3] - 2026-08-18
### Added
- Top-level `Event` model (`trip_id`, `created_by`, `source: 'created'|'imported'`,
  `participants: [{user_id, invited_by, status}]`, nullable `place_id`/`place_name`),
  replacing the previously-orphaned `models/Event.ts` and the embedded `Trip.timeline`
  array — needed because an event you're invited to doesn't live in your own Trip document.
- Blind joint-preference matching: `POST /api/events/:id/recommendations` runs a
  server-side Mongo `$setIntersection` aggregation across every participant's preference
  tags — no participant's individual preferences are ever returned, only the combined score.
- `models/Contact.ts`: added `email` field, so an invited-but-unlinked contact can be
  displayed and later reconciled.
- Event routes: `GET/POST /api/trips/:tripId/events`, `GET /api/events/invited`,
  `PUT /api/events/:id` (organizer-only), `PUT /api/events/:id/respond` (participant-only,
  accept/decline), `DELETE /api/events/:id`.
- `app/(tabs)/trips.tsx`: real "Propose an Event" flow (pick a slot + a linked contact → get
  joint recommendations → pick a place), a placeholder card for an event with no place
  chosen yet, and a pending-invites indicator.
- `app/(tabs)/social.tsx`: "Send Invitation" now actually persists a pending `Contact`
  (was previously `alert()`-only, nothing saved) with a visible "Pending" state.

### Fixed
- `app/login.tsx`: the mock login previously logged **every** tester into the exact same
  hardcoded account (`mock_123` / `nico@example.com`) regardless of who tapped it — meaning
  no two beta testers could ever be distinct accounts. Replaced with a simple name+email
  form (still no real OAuth, deliberately deferred) so each person gets their own account.
- `app/(tabs)/trips.tsx` was importing and filtering the hardcoded `MOCK_CONTACTS` array
  directly instead of the real, server-synced `contacts` from `useAuth()` — every tester saw
  the same four fake people as invite candidates regardless of their actual contacts.
- `app/(tabs)/social.tsx`'s `handleMoveContact` passed a functional updater to
  `setContacts`, whose type didn't accept one — a real, previously-broken runtime bug on the
  one contact-mutation path that was wired to the backend.

## [0.0.2] - 2026-08-18
### Added
- Structured logging (`pino`/`pino-http`) replacing all `console.*` in `server.ts`, with a
  `reportError()` helper wired into every route.
- Error tracking via `@sentry/node` (server) and `@sentry/react-native` (app), fully wired
  but gated on `SENTRY_DSN`/`EXPO_PUBLIC_SENTRY_DSN` — inert until a free-tier key is added.
- `GET /health`.
- `hooks/useAuth.tsx`'s `API_URL` now prefers a build-time `EXPO_PUBLIC_API_URL`, falling
  back to the existing dev-loop auto-detect — required for a sideloaded APK to find the
  backend at all, since a built app has no Metro dev server to infer a host from.
- `scripts/expose-server.sh`: stable `TUNNEL_SUBDOMAIN` (default `odysai-beta`), so
  restarting the tunnel doesn't require rebuilding and redistributing the APK.
- `.env.example` and `docs/beta-deploy.md` (the beta-session runbook).

## [0.0.1] - 2026-08-18
### Added
- JWT-based session authentication: `POST /api/auth/login` issues a signed token; every
  protected route now requires it and scopes queries to the authenticated user
  (`req.userId`) instead of trusting a client-supplied `userId`.

### Fixed
- **Security**: every API route previously trusted a client-supplied `userId` (query
  param or body) with no verification — any request could read or write any other user's
  profile, trips, or contacts by simply changing an id.
- `PUT`/`DELETE /api/trips/:id` and `/api/contacts/:id` had no ownership check at all — any
  valid id could be edited or deleted by anyone. Now scoped to `{_id, owner}` queries.
- Free-time-slot and recommendation-matching math (`lib/calendar.ts`, `lib/recommendations.ts`)
  operated in the device's local timezone throughout, including when planning a trip to a
  different city — silently wrong the moment a user actually travels, which is the app's
  core premise. Rewritten on `luxon` to compute in the trip's destination timezone
  (`lib/timezones.ts`), with the manual itinerary time picker still device-local as a known,
  separately-tracked limitation.
- `.env` was not actually excluded by `.gitignore` (only `.env*.local` was).
