# Changelog

All notable changes to Odys.ai are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are `0.0.x` while
this is still pre-release/beta.

## [Unreleased]
### Fixed
- **Circles/Contacts: a real synced contact whose MongoDB `_id` happened to start with the
  letter `c` could never have its delete/edit reach the server, and unlink-then-re-friend could
  leave one side of a friendship with a duplicate `Contact` document ("Vertical C" from the
  Roadmap noted section).**
  - `hooks/useContacts.tsx`'s `canSyncForDelete`/`canSyncForUpdate` guarded against syncing the
    seeded `MOCK_CONTACTS` demo set (`lib/contacts.ts`, ids `c1`..`c4`) via a bare
    `!id.startsWith('c')` check — but a real 24-hex-char Mongo `_id` can itself start with `c`
    (hex includes `a`-`f`), so roughly 1 in 16 real contacts silently stopped syncing
    deletes/edits to the server forever (the "deleted" contact would reappear after
    reinstall/relogin). Now checks exact membership in the fixed `MOCK_CONTACT_IDS` set instead
    of a prefix. `lib/entity-id.ts`'s `sameEntity` was checked too — it already compares `id`/
    `_id` by exact equality, not prefix, so it wasn't affected.
  - `server.ts`'s `PUT /api/friend-requests/:id/respond` accept path unconditionally
    `Contact.create`d a fresh `Contact` for both sides. If one side had previously deleted only
    their own `Contact` for the other (`DELETE /api/contacts/:id` only ever removes the caller's
    side) and then a new friend request was sent and accepted — allowed, since
    `POST /api/friend-requests` only guards against a duplicate *pending* request, not an
    existing `Contact` — the other side's original, untouched `Contact` was left in place
    alongside the newly created one, showing that person twice (potentially under different
    circle tags) in the Circles list. The accept handler now upserts (`findOneAndUpdate` with
    `upsert: true`, matching on `owner_user_id` + `contact_user_id`) and merges the new circle
    tag in via `$addToSet` instead of unconditionally creating, so re-friending after a
    one-sided unlink updates the surviving `Contact` rather than duplicating it.
- **The Home tab's "what can I do in my free time" suggestion flow (`app/recommendation.tsx`)
  never actually scheduled anything in the app — it showed a success message that was
  sometimes an outright lie.** Live-reported as "told me success, but doesn't appear
  afterwards" after picking a place for a free-time slot. Root-caused via the DB and server
  logs: zero API requests reached the backend for the whole interaction. `handleSelectPlace`
  only ever wrote to the device's native calendar (`Calendar.createEventAsync`) — invisible to
  the Trips tab's Current Schedule/AI Schedule Proposals, which only read from the app's own
  Event API — and the route never even received a `tripId` to attach a real event to. Worse,
  when no writable device calendar existed, it hit an `else` branch that alerted **"Scheduled!"
  while doing nothing at all.**
  - `app/(tabs)/index.tsx`'s `handleSuggest` now passes the trip actually covering today (if
    any) as a `tripId` param.
  - `app/recommendation.tsx`'s `handleSelectPlace`, when given a `tripId`, now creates a real
    trip Event via the same API `app/(tabs)/trips.tsx`'s own "Add to Itinerary" flow uses — so
    it shows up in that trip's schedule like any other scheduled place.
  - With no active trip today (nothing to attach an Event to — every Event requires a
    `trip_id`), it still falls back to the device calendar, but the false "Scheduled!" message
    is gone: a genuine failure now says so.
  - Note: this only fixes it going forward for a slot suggested during an actual trip. At the
    moment this was reported there was no trip covering "today" (the gap between two trips'
    date ranges) — that specific pick could only ever have landed in the device calendar (or
    hit the "no writable calendar" case), never in the app's own schedule, regardless of this
    fix.
- **Local APK builds could die silently to OOM with no clear error, and always ran locally even
  when free EAS cloud build quota was sitting unused.** The 0.0.41 local build never produced
  an APK: its Gradle/Kotlin build daemon was killed by the kernel OOM-killer ~80 minutes in,
  mid-compile (confirmed via `journalctl -k` on that boot — a Chrome tab was also OOM-killed 30
  minutes earlier in the same session), on a dev machine with only 16GB RAM. This project had
  originally built exclusively on EAS's free cloud tier (`docs/beta-deploy.md`) and only moved
  to local builds after that monthly quota ran out — but nothing since then re-checked whether
  quota had reset. Added two scripts:
  - `scripts/build-local-apk.sh` (`npm run build-apk-local`) — a preflight-checked wrapper
    around `eas build --local`: checks `free -m`'s "available" column against a threshold (8GB
    default, `EAS_BUILD_MIN_AVAILABLE_MB` to override) and refuses to start the build —
    printing the top memory-consuming processes instead — when memory is too tight, rather than
    letting it run for an hour before failing.
  - `scripts/build-apk.sh` (`npm run build-apk`, the normal entry point) — checks the account's
    remaining free-tier cloud quota via `eas account:usage --json` (resets each monthly billing
    cycle) and uses a cloud build whenever any remains (no local load, immune to this machine's
    RAM limits, artifact auto-downloaded into `public/odys-ai-<version>.apk`), falling back to
    the local script above only once that quota is exhausted for the cycle.
- **A single synced all-day calendar event could silently zero out an entire trip day's AI
  Schedule Proposals (and, as a direct consequence, its "Looking for something else?"
  refine-search entry point too — that card only ever renders attached to a proposal).**
  Live-reported and root-caused via the DB: a real trip had 3 consecutive weekdays with zero
  proposals, each carrying either a Google Calendar "Working Location" status marker (title
  exactly "Home") or a public holiday entry ("Armistice Day") — both all-day events spanning
  midnight-to-midnight. None of `lib/calendar.ts`'s three device-calendar readers ever read
  `evt.allDay`, so each got imported as a literal 24-hour busy block; `calculateFreeTimeSlots`
  then (correctly, given that input) computed zero free time for the whole day. Two different
  fixes for two different cases, per product decision:
  - **Working Location markers are now dropped entirely** (`lib/calendar.ts`'s new
    `isWorkingLocationEvent`, matched by title since expo-calendar's cross-platform bridge
    exposes no dedicated event-type flag for this Google-specific feature) — excluded from
    busy-time calculation AND never synced/displayed at all, since a daily status habit isn't
    necessarily updated for days the user will actually be travelling.
  - **Any other all-day event** (a public holiday, an out-of-office banner) **is now excluded
    from busy-time calculation but still synced and shown** as a small banner on that day
    (`app/(tabs)/trips.tsx`) — and if it's the day's *only* signal, the day is treated as fully
    open (`getHardcodedFreeSlots`'s new `treatAsFullyOpen`) rather than the default Mon-Fri
    "presumably at work" pattern, since a real holiday means the traveller isn't working either.
  `CalendarEvent`/`TripEvent`/`IEvent` (Event model) all gain an `allDay?: boolean` field to
  carry this through device read → sync → DB → API → UI; no backfill needed, existing Event
  docs simply read as `allDay: undefined` (falsy, same as today's behavior). 5 new tests in
  `lib/free-time.test.ts`.

### Roadmap noted
- **"Have a suggestion?" modal (and most other full-screen modals) render too high, crowding
  the status bar** — live-reported from a screenshot where the title sits right against the
  clock/notch. `components/profile/suggestion-form-modal.tsx:105` uses a hardcoded
  `paddingTop: Platform.OS === 'ios' ? 40 : 24`, a fixed guess that doesn't account for the
  device's actual notch/status-bar/Dynamic Island height. This was already identified and
  fixed once this same release cycle for `categorized-selection-modal.tsx` (see the 0.0.40
  "Fix profile modal status-bar padding" work — replaced with `useSafeAreaInsets()` from
  `react-native-safe-area-context`), but the fix was never propagated to its siblings. Same
  hardcoded pattern still present in: `components/profile/version-history-modal.tsx:61`,
  `components/profile/generic-selection-modal.tsx:46`, `app/(tabs)/trips.tsx:2027`,
  `app/(tabs)/social.tsx:674` (all four modal containers), plus the non-modal scroll screens
  `app/(tabs)/profile.tsx:389`, `app/(tabs)/index.tsx:344`, `app/(tabs)/trips.tsx:1902`,
  `app/(tabs)/social.tsx:610`. Slated for next sprint: swap every one of these over to
  `useSafeAreaInsets()` for a consistent, device-correct top inset instead of a per-file guess.
- **Full-codebase audit (general-purpose agent, branch `sprint4-calendar-allday-events`) found 5
  confirmed bugs plus 3 lower-confidence notes.** Grouped below into three verticals by file
  ownership — none of the three touches a file another one does, so they're safe to hand to
  three separate agents/sessions in parallel with zero merge risk. Slated for next sprint.
  - **Vertical A — Trip scheduling timezone correctness** (`app/(tabs)/trips.tsx`,
    `app/(tabs)/index.tsx`, `lib/timezones.ts`/`lib/free-time.ts` for a new shared helper,
    `lib/place-matching.ts` to verify only).
    - *Confirmed:* every manual scheduling flow — `handleAddToItinerary` (:783-784),
      `handleUpdateScheduledEvent` (:855-856), `handleRefineSearch` (:940-941), and
      `handleProposeSubmit` (:970-972), all in `app/(tabs)/trips.tsx` — builds the final event
      instant via `date.setHours(picker.getHours(), picker.getMinutes())`, which always operates
      in the **device's** local timezone, not the trip's destination timezone
      (`Trip.timezone`). Planning a Paris trip from a New York device and manually picking
      "8pm" (meaning 8pm Paris time) silently books 8pm New York = 2am Paris instead — a
      6+ hour, wrong-day event. Same broken pattern duplicated across all four call sites
      instead of one timezone-aware helper (e.g. a luxon `DateTime.fromJSDate(day)
      .setZone(trip.timezone).set({hour, minute})`) — fix once, apply to all four.
    - *Confirmed, same root cause, lower impact:* `app/(tabs)/index.tsx`'s and
      `app/(tabs)/trips.tsx`'s `activeTrip` lookups use naive `t.startDate <= today &&
      t.endDate >= today` on raw device-local `Date`s, instead of the timezone-aware comparison
      `lib/trip-types.ts`'s `isTripPast` already uses elsewhere in this same codebase. Near a
      trip's start/end boundary with a device/destination timezone mismatch, a trip can be
      treated as active/inactive a day early or late.
    - *Unverified, needs confirmation before fixing:* `lib/place-matching.ts:197-206`
      (`resolveAnchorForDate`) compares calendar days via `date.toISOString().slice(0,10)` (UTC
      day), not the trip's destination-timezone day — for a trip far from UTC (e.g. Auckland,
      UTC+13), a near-midnight event could resolve to the wrong day's `baseLocations` anchor.
  - **Vertical B — Offline sync & retry reliability** (`hooks/useSyncedCollection.ts`,
    `lib/mutation-queue.ts`, `hooks/useTripDiscovery.tsx`).
    - *Confirmed:* `hooks/useSyncedCollection.ts`'s delete (:129-139) and update (:157-174)
      loops never check `res.ok` — `apiFetch` resolves normally (doesn't throw) on a non-2xx
      response, so a 401 (expired 30-day JWT) or 404 on a DELETE/PUT is silently treated as
      neither a success nor a failure: nothing is queued for retry, AND the very next
      unconditional refetch (:180-189) pulls the "deleted"/un-edited item back from the server,
      silently undoing the user's action with no error shown. Contrast with
      `hooks/useTrips.tsx:106`'s `toggleDismissedSlot`, which correctly checks `if (!res.ok)
      return;` — this is an inconsistency, not a deliberate design choice.
    - *Confirmed:* `lib/mutation-queue.ts`'s own top comment claims "an identical PUT, or a
      DELETE on an already-deleted resource, is a no-op," but the server returns 404 (not 200)
      for that case, and `flushMutationQueue` (:63-89) only clears an entry on `res.ok` — so a
      mutation whose target is legitimately gone by replay time (deleted from another device,
      or its own create never landed) retries forever on every future flush with no way to
      clear itself.
    - *Confirmed, same bug pattern, low stakes:* `hooks/useTripDiscovery.tsx:126-133`
      (`notifyAppAccess`) doesn't check `res.ok` before updating its local "just synced"
      timestamp mirror — a failed server update can still suppress a legitimate rescan for up
      to 7 days.
- **Need a real email server on GCP for `support@odys.ai` and `admin@odys.ai`.** No email
  infrastructure exists anywhere in this codebase today (no nodemailer/SendGrid/SES dependency,
  no outbound-mail code path). This is two separate needs: receiving mail at those addresses
  (Google Workspace or similar pointed at the `odys.ai` domain's MX records — not a GCP-native
  product) and sending transactional mail from `server.ts` (a SendGrid/Mailgun/SES-style relay).
  Directly blocks the RFE/suggestion-form feature (shipped in 0.0.40) from actually delivering
  mail. Full detail added to `docs/gcp-migration.md`'s local-only-needs-replacement table.
- **Refreshed the competitive landscape analysis**, extending `docs/monetization-strategy.md`'s
  competitor table (previously scoped to monetization models only) into a full capability/
  positioning "tour of the horizon," including AI-native trip-planning agents not covered
  before (Mindtrip, Vacay, GuideGeek, Expedia's "Romie," Gemini, Kayak AI, TripIt) plus ANEAR
  (the closest single-pillar match to Odys's own "friends nearby" premise). Full writeup in
  `docs/competitive-landscape.md`: confirms Odys's three-pillar combination (work-calendar-
  aware free time + recommendations + social circles) has no single direct competitor, but
  every individual pillar already has one (TripSuite for calendar/conflict detection alone,
  iMean for bleisure-specific recommendations alone, ANEAR for travel-proximity social alone) —
  a real but narrower differentiator than "nobody does this." Flags the biggest concrete gaps:
  no conversational/generative entry point (every AI-native competitor leads with this), no
  booking/ticketing integration, a narrower calendar-signal net than TripIt's inbox-scanning,
  no automatic friend-proximity detection, and the local-infra reliability gap versus every
  well-funded competitor named. Investigated, not built.
- **`expo doctor` reports real dependency drift against the installed Expo SDK (54), surfaced
  during the 0.0.40 local build.** Non-fatal today (the local build proceeds past it), but
  worth resolving before it becomes blocking: major-version mismatches on
  `@sentry/react-native` (declared `^8.23.0` in `package.json`, SDK 54 expects `~7.2.0`) and
  `expo-calendar` (declared `~14.0.4`, SDK 54 expects `~15.0.8`), plus patch-level drift on six
  more `expo-*` packages (`expo`, `expo-constants`, `expo-font`, `expo-linking`,
  `expo-router`, `expo-web-browser`). Pre-existing — confirmed via `git diff` against the
  0.0.39 release commit that `package.json` was untouched by the 0.0.40 sprint, so this drift
  predates it. Not investigated further here (which direction is safe to bump, especially the
  Sentry major-version jump, needs its own look) — `npx expo install --check` is the fastest
  way to see current recommendations when this gets picked up.

## [0.0.41] - 2026-09-11
### Added
- **"Past trips" view.** A trip used to never leave the main Trips list, even long after it
  ended — `models/Trip.ts` has no status/archived concept, `GET /api/trips` returns everything
  unconditionally, and `app/(tabs)/trips.tsx` rendered every trip in one list forever (only a
  manual trash-icon delete removed one). The Trips tab now has a "Current & Upcoming" / "Past"
  segmented control:
  1. No new DB field — a trip's bucket is derived at render time from `end_date + 1 day < now`,
     checked in the trip's own `timezone` (not device time). Applies retroactively to every
     trip already in the DB, zero backfill/migration (see `lib/trip-types.ts`'s `isTripPast`).
  2. Past trips render via a new, lightweight `components/trips/past-trip-card.tsx` (destination,
     dates, city photo) that skips AI Schedule Proposals, free-time computation, and
     nearby-friends lookups — none of that applies to a trip that's already happened. Manual
     delete still works there; no other new actions for this pass.
  3. Retention: past trips stay in the DB indefinitely, no auto-purge job — comfortably clears
     the requested 6-month floor without adding a scheduled destructive operation against live
     data with no backup strategy in place (a real incident already happened from a migration
     gone wrong against this same database).
  4. `GET /api/trips`, `useTrips`, and `useSyncedCollection` are unaffected — purely a
     client-side view split over data already synced.

### Fixed
- **An auto-discovered trip's start/end dates were anchored to the destination-only window
  (flight arrival abroad / departure abroad), not the traveler's own home-to-home journey —**
  live-reported as a free morning slot (and an AI activity proposal) spanning right across an
  actual outbound flight, on a trip that had just been auto-discovered from that same flight.
  Two compounding causes, both fixed:
  - `lib/calendar-signals.ts`'s `buildRoundTripSuggestion`/`buildStandaloneFlightSuggestion` set
    `trip.startDate` to the outbound flight's *arrival* time; `app/(tabs)/trips.tsx`'s
    `syncDeviceCalendarForTrip` uses that same value as the left edge of the device-calendar
    import query, so the outbound flight itself (whose own start necessarily precedes its own
    arrival) fell outside its own trip's sync window and was never imported as a busy event. A
    trip's `startDate`/`endDate` are now the actual leave-home/return-home instants (refined
    further by a real `Travel time to/from <airport>` ground-transit signal when one exists
    near the flight, see `claimHomeDepartureTransit`/`claimHomeReturnTransit`) rather than the
    narrower arrival-abroad/departure-abroad window. A lodging signal in between a round trip's
    own flights now only contributes hotel metadata for the create-trip form, not the end date,
    since the return flight's own arrival is already the more direct "back home" signal.
  - `lib/free-time.ts`'s `getTripDaySchedule` had two further gaps in the flight-arrival-buffer
    logic even once the flight was correctly imported: a genuine red-eye (departs the trip's
    start day, lands after midnight) wasn't recognized, since the flight's own `startTime` —
    what buckets an event into a day's `dayEvents` — falls on the *departure* day, not the
    arrival day that actually needs its effective start bounded; and an arrival day with no
    *other* real synced events fell straight through to `getHardcodedFreeSlots`, which has no
    concept of the flight at all. Both fixed: the arrival-buffer check now searches the full
    imported-events list by each flight's own arrival instant across both candidate days
    (gated so an unrelated same-day domestic hop still has no effect), and an arrival-only day
    now computes a real buffered slot instead of falling back to the generic hardcoded schedule.
  - Verified via a fresh QA account in the local web build: created a trip, confirmed it showed
    under Current & Upcoming, backdated it directly in Mongo, confirmed it moved to Past with
    the correct card, deleted it from there. Also 227 tests (7 new, covering the red-eye,
    empty-arrival-day, and ground-transit-refinement cases) + `tsc --noEmit` + lint all pass.

## [0.0.40] - 2026-09-06
### Added
- **"Have a suggestion for Odys.ai?" form on Profile.** A new card between "About" and "Save
  Changes" opens `components/profile/suggestion-form-modal.tsx` (following the
  `VersionHistoryModal` extraction pattern): the user's name (read-only, `user?.full_name`),
  a 1500-character `TextInput` with a live remaining-character counter, and Send/Back buttons.
  Send posts to a new `authenticate`-gated `POST /api/suggestions`, which durably saves the
  submission to a new `models/Suggestion.ts` collection and attempts to notify
  `admin@odys.ai` via a new `lib/mailer.ts`. **Email delivery is inert for now** — `lib/mailer.ts`
  is a safe no-op (logs what it would send, `emailed: false`) until the separate "email server
  on GCP" roadmap item (see `[Unreleased]` above) lands with a real relay; the suggestion itself is never lost in
  the meantime, since it's saved to Mongo regardless of email outcome.
- **Proactive trip discovery from calendar flight/lodging signals.** The app now notices an
  unplanned trip on its own instead of requiring a manual "create trip": a new
  `scanForUpcomingTripSignals` (`lib/calendar.ts`) reads the device calendar, classifies each
  event (`classifyImportedEvent`), and runs the flight/lodging hits through a new pure
  `inferTripFromSignals` (`lib/calendar-signals.ts`) that resolves destination/dates from an
  outbound+return flight pair, a flight plus a lodging signal, or a lodging signal alone — each
  handled independently rather than force-pairing an ambiguous multi-city itinerary. Airport
  codes resolve via a new small static table, `lib/iata-airports.ts` (neither
  `lib/geocoding.ts` nor `lib/hotel-geocoding.ts` handled bare IATA codes before). Three
  triggers: the first calendar-permission grant (`app/(tabs)/index.tsx`) runs an immediate
  ~30-day scan and starts a new server-side `User.lastAppAccess` counter (`models/User.ts`,
  `POST /api/users/me/app-access`, deliberately its own endpoint like `push-token` rather than
  added to `USER_UPDATABLE_FIELDS`); app foreground re-runs that scan only once the counter
  shows 7+ days elapsed; pulling to refresh the Trips tab runs a lighter ~7-day scan every
  time, independent of the counter. A find surfaces as a new opt-in Home-tab card (extending
  `connectCalendarCard`'s styling) that prefills and opens the real create-trip modal —
  accepting or dismissing (`@dismissedTripSuggestions`, keyed by the anchoring
  `CalendarEvent.id`s) both go through a new `TripDiscoveryProvider`
  (`hooks/useTripDiscovery.tsx`) shared between the Home and Trips tabs.

### Fixed
- **An auto-discovered trip's start/end dates were anchored to the destination-only window
  (flight arrival abroad / departure abroad), not the traveler's own home-to-home journey.**
  Reported live: a trip auto-discovered from a same-day outbound flight showed a free morning
  slot (and an AI activity proposal) spanning right across the actual flight time. Cause:
  `lib/calendar-signals.ts`'s `buildRoundTripSuggestion`/`buildStandaloneFlightSuggestion` set
  `trip.startDate` to the outbound flight's *arrival* time, and `app/(tabs)/trips.tsx`'s
  `syncDeviceCalendarForTrip` uses that same value as the left edge of the device-calendar
  import query — so the outbound flight itself (whose own start necessarily precedes its own
  arrival) fell outside its own trip's sync window and was never imported as a busy event,
  leaving the free-time algorithm with nothing to route around. Fixed at the source: a trip's
  `startDate`/`endDate` are now the actual leave-home/return-home instants (the outbound
  flight's departure, the return flight's arrival) rather than the narrower arrival-abroad/
  departure-abroad window — a lodging signal in between a round trip's own flights now only
  contributes hotel metadata for the create-trip form, not the end date, since the return
  flight's own arrival is already the more direct "back home" signal. A follow-up to the same
  live report: a genuine red-eye (departs the trip's start day, lands after midnight) could
  still slip past `lib/free-time.ts`'s `getTripDaySchedule`, since the flight's own startTime
  (what buckets an event into a day's `dayEvents`) falls on the departure day even though its
  arrival — the instant that actually needs to bound the *next* day's effective start — lands
  on the day after. The arrival-buffer check now searches the full imported-events list by
  each flight's own arrival instant, on both the trip's start day and the day right after it,
  gated so a same-day domestic hop that happens to land on that later day still has no effect
  (only a flight that actually departed on the trip's own start day counts).
- **Profile's "‹ Back to circle view" button sits too close to the status bar.** The
  "Dining Contexts" categorized-selection modal (`components/profile/categorized-selection-
  modal.tsx`) used a hardcoded `paddingTop: Platform.OS === 'ios' ? 40 : 24`, so on a device
  whose real status bar is taller than that guess the back button rendered flush against (or
  overlapping) it. Switched to `useSafeAreaInsets()` (`react-native-safe-area-context`) so the
  padding tracks the device's actual inset instead of a hardcoded number — fixes this class of
  bug for good rather than needing another manual bump the next time a taller status bar
  shows up.

### Changed
- **Circles "All" view now shows a contact's real circle(s) instead of a generic "Odys.ai
  User" badge.** An accepted (`isAppUser: true`) contact's card now renders one small pill per
  entry in `contact.circleTags` — every circle a multi-tagged contact belongs to, not just
  one, since a contact can legitimately be tagged both `Work` and `Family and Friends`. Each
  circle gets its own accent color for quick scanning. Renders the same way on a specific
  circle tab too, not just "All". The "Pending — invited ⟨date⟩" / "Pending — hasn't joined
  yet" text for a not-yet-joined contact is unchanged.

## [0.0.39] - 2026-09-03
### Added
- **Onboarding's vibe picker now reaches cuisine-level taste for 6 of the 8 vibes.**
  `buildVibeTree()` (`lib/onboarding-taste.ts`) appends real `PreferenceCategoryGroup`
  category nodes to a vibe's children alongside its existing flat leaves, rather than
  flattening straight from vibe to leaf. Foodie keeps its 4 occasion leaves (Street
  Food/Cafes/Local Markets/Festivals) and gains Asian/European/Americas cuisine categories —
  tapping "Asian" bulk-selects Japanese/Chinese/Thai in one tap (matching every other parent
  node's one-tap bulk-select), drilling once more shows them individually. Culture & Museums,
  Outdoors & Active, Arts & Theater, and Scenic & Views each gain one further category
  (`Arts & Culture`, `Tours & Excursions` ×2, `Entertainment`, respectively) — chosen where a
  *_CATEGORIZED group is thematically core to that vibe's persona and not already ≥2/3
  covered by its own flat tags. Nightlife & Live Music, Chill & Relax, and Shopping & Markets
  deliberately keep today's pure-flat structure — their best-fitting group was already fully
  covered by existing flat tags, so wrapping it would add a tap without exposing any new tag.
  The tap/drill-down engine (`CircleNode`/`tapNode`/`shouldDrillIn`) needed zero changes,
  confirming it really is depth-agnostic as designed; `vibe-picker.tsx`'s sub-cluster layout
  table also needed no changes (its existing arc-layout fallback already handles the new,
  larger child counts). `lib/onboarding-taste.test.ts` extended with coverage for the new
  category nodes' bulk-select-then-prune behavior and for the untouched vibes staying flat.
  Live-verified against the real API: `PUT /api/users/:id` round-trips a `foodGenres` array
  containing newly-reachable cuisine tags (`Japanese`, `Thai`) alongside the original occasion
  tags. Item 2 (the tag-redundancy audit) is a separate, still-undecided product call — not
  touched this pass, see below.
- **Profile's preference editor now uses the same drill-down/collapse interaction as
  onboarding's vibe picker**, instead of a flat always-expanded 15-bubble list.
  `components/profile/categorized-selection-modal.tsx` rebuilt to build a `CircleNode` tree
  directly from `FOOD_GENRES_CATEGORIZED`/`ACTIVITY_GENRES_CATEGORIZED`/
  `EVENT_GENRES_CATEGORIZED` (the same shape `buildVibeTree()` produces, minus the vibe-bundle
  wrapper) and reuses `tapNode` rather than reimplementing bulk-select/toggle logic. A
  category with nothing selected collapses to just its title + "+"; tapping it bulk-selects
  the whole group and expands in place so it can be pruned down, mirroring the vibe circle's
  tap-then-prune pattern (one deliberate difference from `vibe-picker.tsx`: expansion happens
  on the same tap as the bulk-select rather than requiring a second tap, since a settings list
  needs immediate visual feedback that something happened). Added an explicit "‹ Back to
  circle view" button. `app/(tabs)/profile.tsx`'s three call sites switched from a per-item
  `toggle` callback to `onSelectedChange(next: string[])` so a bulk-select commits atomically
  instead of racing itself through repeated stale-closure `toggle` calls. Live-verified:
  `PUT /api/users/:id` round-trips `activityGenres`/`eventGenres` picked through the new
  drill-down (`Walking Tours`/`Boat Cruises`, `Comedy Shows`/`Cinema`).
- **Home-city sharing moved into onboarding as a new, skippable step.** `app/onboarding.tsx`
  gains a new step 3 — `CircleShareSelector`, the same component already used on Profile,
  reused directly — positioned right after "Pick your vibe." A visible "Skip for now — set
  this anytime from Profile" link sits below it, and each circle toggle saves instantly (same
  instant-save convention as Profile's own `toggleHomebaseCircle`) rather than waiting for
  onboarding to finish, so skipping never leaves a half-applied choice behind. `TOTAL_STEPS`
  is now 5 and the swipe-deck/essentials steps shifted to 4/5 accordingly. Live-verified:
  `PUT /api/users/:id` round-trips `homebaseSharedCircles` set from this new step.
- **Onboarding now has a working "‹ Back" control on every step.** `app/onboarding.tsx` gains
  `handleBack` (`setStep(step - 1)`, or `router.back()` — a safe no-op if there's no prior
  screen to return to — on step 1), wired to a small "‹ Back" pinned above the step content
  and structurally outside step 2's own `Pressable`, so it can never be confused with the vibe
  picker's existing "tap outside a circle to go back" gesture — that one still only pops the
  picker's internal drill-down path (now also covering item 1's new category-level drilling
  above), never the onboarding step itself. The step-dots indicator stays purely visual,
  unchanged, per the doc's proposal. The already-decided swipe-deck-resets-to-card-one-on-
  back-navigation nuance is left exactly as accepted — `SwipeDeck`'s internal progress state
  is not lifted to `onboarding.tsx`.
- **Circles-tab badge for pending friend requests.** `app/(tabs)/_layout.tsx`'s Circles
  `Tabs.Screen` now sets `tabBarBadge` to the live pending-incoming-request count (Expo
  Router's native support for the prop). The count comes from a new piece of
  cached/reactive state in `FriendRequestsProvider` (`hooks/useFriendRequests.tsx`):
  `incomingRequestCount`, refreshed as a side effect of every `fetchIncomingRequests()`
  call, plus its own poll loop (45s interval) and an `AppState` foreground trigger — same
  pattern `useMutationQueueFlush.ts` uses for the mutation-queue retry, gated on `user`
  from `useAuth()` so it only runs while logged in and resets to 0 on logout. Poll-based
  rather than push-driven, per the plan doc's own call: the push alternative depends on
  the in-app foreground-notification-handling follow-up
  (`Notifications.setNotificationHandler`) that isn't built yet. Verified live end to end
  against the local backend/MongoDB: created two real test accounts, sent a real friend
  request between them, confirmed `GET /api/friend-requests/incoming` (what the count is
  sourced from) returns length 1 for the pending request and drops to 0 immediately after
  the recipient accepts it — matching what the badge would show at each step.

- **Imported calendar events (flights, ground transit, an already-scheduled dinner) are now
  classified and fed into the free-time algorithm, instead of the trip timeline rendering
  every one of them as an identical plain "busy" row.** Follows up on the real Paris trip
  (Sep 7) reports below: new `classifyImportedEvent()` (`lib/calendar-signals.ts`), a two-tier
  pipeline per `docs/calendar-signal-detection-plan.md` — `matchNavan` (tight patterns for
  Navan's known `Flight: ORIGIN (flight#) to DEST Confirmation CODE` /
  `Travel time to|from X` / `Stay: X` format) tried first, `matchGeneric` (looser
  airline-code/flight-number + directional patterns, hotel keywords, and a dining heuristic —
  a real-looking `location` overlapping a meal-window instant, deliberately not a title-keyword
  match, so it works regardless of language) as fallback. Classification is computed on the fly
  from an event's own `title`/`location` every time it's needed rather than stored on the
  `Event` model — no migration/backfill needed against the shared local MongoDB (there's no
  backup mechanism for it right now, and a real incident happened last sprint from exactly a
  migration going wrong against live shared data). 28 new unit tests
  (`lib/calendar-signals.test.ts`) built from the real Navan sample text in the design doc, plus
  live-verified against the real running local backend: created a throwaway trip under a
  single-use test account, imported the exact real event cluster (`Travel time to TLS airport`
  → `Flight: TLS (TO7103) to ORY Confirmation O7Z5VR` → `Travel time from ORY airport`, plus the
  farewell dinner `Save The Date - Pot de depart Nico`), round-tripped it through the real
  per-user field-encryption pipeline, confirmed every event classifies as expected, then deleted
  the throwaway trip.

  Wired into scheduling (`lib/free-time.ts`'s `getTripDaySchedule`, 9 new tests): a detected
  flight now bounds the trip's own first/last day's *effective* free-time window instead of
  just excluding its literal busy block — the arrival day's effective start becomes the
  flight's landing time plus a 45-minute buffer (customs/baggage/the ride into town — a first
  reasonable guess, not researched against real airport transit-time data, per the design doc),
  and the departure day's effective end is pulled to 45 minutes before boarding. A day with no
  flight signal is completely unaffected. And a detected dining event (either confidence level)
  now suppresses the competing AI Lunch/Dinner proposal for that meal window
  (`filterDiningConflicts`, wired into both the AI-proposals fetch effect and the render loop in
  `app/(tabs)/trips.tsx`) and is surfaced directly in the "Current Schedule" timeline instead, as
  a distinctly-styled `CalendarEventCard` (`components/trips/calendar-event-card.tsx`) — a "📅
  From your calendar" badge rather than `PlaceCard`'s "✓ Scheduled"/match-score treatment, with a
  real Navigate action reusing the existing `handleNavigate`/`buildMapsUrl` plumbing rather than
  reinventing it. The short free gap before such an event is left exactly as-is — still whatever
  plain activity/free-time classification it already got, not force-fit as a meal slot. Live-
  verified end-to-end: a short (20-minute) real dinner reservation correctly suppressed the AI
  Dinner proposal for the rest of that evening's dinner window while leaving an unrelated Lunch
  proposal the same day untouched. Graphical mockup this was built against:
  https://claude.ai/code/artifact/48e7c5bc-41d6-4df4-8b26-8135927c8ee2 ("Journey Timeline") — the
  flight-cluster "Journey card" grouping shown there is not built (out of scope for this pass;
  the underlying free-time math it depends on is, but the dedicated grouped-card UI for
  flight/ground-transit rows is not).

### Fixed
- **Event invite cards showed no indication of who invited you.** Two-part fix:
  `GET /api/events/invited` (`server.ts`) now does
  `.populate('created_by', 'full_name avatar_url')` so each invited event comes back with
  the organizer's identity instead of a bare ObjectId; the shared `decryptEvents()` helper
  (used by several other event routes that do *not* populate `created_by`) was adjusted
  to resolve a creator id from either shape via a small `creatorIdOf()` helper, since a
  populated sub-document's `.toString()` isn't the id. `models/Event.ts` gained a
  `PopulatedEventCreator` type (kept distinct from `IEvent.created_by`'s bare-ObjectId
  type, matching that every other route genuinely still returns the un-populated shape)
  and `lib/trip-types.ts` gained an `InvitedTripEvent` type built the same way for the
  client. The "Your Invites" modal (`app/(tabs)/trips.tsx`) now renders "Invited by
  ⟨name⟩" with an avatar chip (initial-letter fallback when there's no `avatar_url`) on
  each invite card. Verified live end to end against the local backend/MongoDB: created
  two real test accounts, linked them as contacts, had one create a real trip + event and
  invite the other, and confirmed `GET /api/events/invited` returned `created_by` as a
  populated `{ _id, full_name, avatar_url }` object rather than an id string.

- **"Looking for something else?" opened with a Time/Duration disconnected from whichever
  slot was actually tapped.** Reported live against the same real Paris trip: `openRefineSearch`
  (`app/(tabs)/trips.tsx`) hardcoded the form's default `Time` to 12:00 and `Duration` to 90
  minutes unconditionally, so tapping it from e.g. an 18:00–19:00 evening slot still opened
  showing noon/90min. Fixed: `RefineSearchCard` now passes its originating `SlotProposal`
  through to `onPress` (rather than just a derived `mealWindow` boolean), and `openRefineSearch`
  seeds `Time`/`Duration` from that proposal's own `startTime`/`durationMinutes`; `mealWindow` is
  still computed the same way it already was (`proposal.type === 'meal'`), just from the same
  proposal object instead of a separately-passed value. `tsc --noEmit`/`npm run lint` clean.

### Roadmap noted
- **Redundant tag reuse across `VIBE_PRESETS` vibes — audited, not resolved.** 8 of
  `VIBE_PRESETS`' ~35 tag slots are reused across 2–3 vibes each (`Scenic Drives` alone spans
  three) — mechanically harmless (tag-union dedup already handles it) but reads as visual
  clutter. Three options laid out in `docs/taxonomy-and-social-notifications-plan.md` (keep
  as-is, assign every tag one "primary" vibe, or prune case-by-case) — deliberately left
  undecided, a taste/brand call more than a technical one. Not touched this pass;
  `VIBE_PRESETS`' existing tag-overlap structure is untouched.

## [0.0.38] - 2026-09-02
### Fixed
- **New trips could show "nothing proposed" for Lunch (and every other slot) right after
  creation, requiring the app to be backgrounded/reopened before AI proposals appeared.**
  Reported live against a real Rome trip. Root cause, confirmed via server logs
  (`journalctl`/`~/.local/share/odysai-server/server.log`): `handleSaveTrip`
  (`app/(tabs)/trips.tsx`) gave a newly-created trip a plain `Date.now().toString()` local id
  — unlike every other locally-created entity in this app (see CLAUDE.md's "Locally-generated
  IDs are prefixed `mock_...`" convention) — so nothing recognized it as not-yet-synced. The
  AI-Schedule-Proposals fetch effect and the calendar-import effect both fire immediately off
  whatever's in `trips` state, so they fired instantly with this fake id, before the trip's
  real Mongo `_id` came back from the server — every one of those requests 500'd
  (`CastError: Cast to ObjectId failed for value "<timestamp>"`), and the failure got cached
  as an empty result per slot (`fetchedSlotKeys` never retries a key once attempted). A second,
  correct round of fetches does fire moments later once the real id lands, but a user looking
  at the trip in that window saw empty proposals and no built-in reason to expect them to
  reappear. Fixed: the local id is now `mock_${Date.now()}`, and both effects skip a trip
  whose id still has that prefix, waiting for the real synced id instead of firing (and
  failing) early. Verified by reading the exact CastError stack traces in the server log
  against the reported trip, then `tsc --noEmit`/`npm run lint` clean — not verified against a
  live device/simulator (none available in this environment, consistent with this project's
  existing verification-ceiling notes elsewhere in this changelog).
- **The Android home-screen icon read too light.** Root cause, per the prior "Roadmap noted"
  entry below: `icon.png`'s 0.0.37 redesign (navy `#0F172A` background, white "crescent O-sail"
  boat mark) never propagated to the Android *adaptive* icon layers Android actually composites
  on the home screen — `android-icon-background.png` was still the pale `#E6F4FE` left over from
  the pre-0.0.32 map-pin icon (`android-icon-foreground.png` itself, it turns out, already held
  the current boat artwork from the icon swap commit — only the backing plate was stale), and
  `app.json`'s `android.adaptiveIcon.backgroundColor` matched that same stale pale value. Fixed:
  regenerated `android-icon-background.png` as a flat, fully-opaque `#0F172A` (512x512), and
  regenerated `android-icon-foreground.png` from the same hull/mast/sail/O-cutout drawing code
  `icon.png` itself was built from (`scratch/icon-proposals/round2/gen_icons.py`'s
  `render_concept(add_o_cutout=True)`, reused rather than reimplemented, per
  `scratch/icon-proposals/round2/gen_adaptive_icons.py`), scaled down and re-centered so it sits
  well inside Android's adaptive-icon safe zone, and updated `app.json`'s
  `android.adaptiveIcon.backgroundColor` to `#0F172A` to match. No physical device available to
  confirm on a real home screen, so verification was entirely programmatic, reading pixel values
  directly rather than eyeballing renders: background is uniformly `(15,23,42,255)` at every
  sampled point with no stray alpha; foreground's opaque content is centered within half a pixel
  of canvas center and its farthest opaque pixel from center sits at 40.1% of the half-canvas
  radius, well inside Android's documented 66%-diameter (61.1%-of-half-canvas-radius) safe
  circle — confirmed both by that direct radius measurement and by compositing background +
  foreground and simulating the most aggressive case, a full circular launcher mask, which crops
  nothing but empty margin; the sail's "O" ring cutout is genuinely transparent (not baked-in
  navy) so it reads correctly against the new background; and foreground edge pixels were
  checked for premultiplied-alpha fringing (a `resize()`-on-straight-alpha bug that can halo
  partially-transparent edges with black) — none found, edge colors stay pure white/blue at every
  partial-alpha pixel sampled.
- **Security sprint (block 04): admin panel had no auth at all.** None of the 5
  `/admin/api/places` routes (`server.ts`) required `authenticate`, and `public/admin.html` was
  served with no gate — flagged High in the security audit above, made worse by the beta
  tunnel making it internet-reachable. Fixed: a new `requireAdminToken` middleware
  (`server.ts`) checks an `X-Admin-Token` request header against a server-side `ADMIN_TOKEN`
  env var and is applied to all 5 admin routes; it fails closed (503) if `ADMIN_TOKEN` isn't
  configured at all, rather than silently allowing access like the bug it replaces.
  `admin.html` can't be gated at the `express.static` level without restructuring, so instead
  its own JS (`adminFetch`) prompts for the token on first use, caches it in
  `sessionStorage` (cleared on tab close, never written into the page/URL), and sends it as
  that header on every admin API call — the page is inert without a valid token either way now
  that the routes it calls are locked down, which is the part that actually matters.
  `ADMIN_TOKEN` added to `.env.example` (with a generation command) and to `.env` with a real
  generated value. Live-verified against the real local backend: `GET /admin/api/places` with
  no header and with a wrong header both 401; with the real token, 200; `admin.html`'s prompt/
  header/retry-on-401 flow read through end-to-end.
- **Security sprint (block 04): every 500 response leaked the raw internal error message.**
  All ~35 route catch blocks did `res.status(500).json({ error: error.message })` — flagged
  Low in the audit above. Fixed: every one now returns `{ error: 'Internal server error' }` to
  the client; the existing `reportError` call (server-side `req.log.error` + Sentry when
  configured) is untouched, so nothing is lost from the logs, only from what crosses the wire.
  Live-verified: forced a real `CastError` (`PUT /api/trips/:id` with a malformed id) and
  confirmed the HTTP response is the generic message while the structured server log still
  captures the full `Cast to ObjectId failed for value "..."` detail.
- **Security sprint (block 04): `PUT /api/users/:id` allowed mass assignment.** It did
  `User.findByIdAndUpdate(id, { $set: req.body }, ...)` against a `strict: false` schema,
  letting a client set any top-level field on their own account — flagged Low in the audit
  above as "self-inflicted-only today, but a real privilege-escalation vector the moment any
  role field is added." Fixed: `updateData` is now built from an explicit `USER_UPDATABLE_FIELDS`
  allowlist (`server.ts`), the same explicit-allowlist pattern already used in
  `POST /api/trips`/`PUT /api/trips/:id`. The allowlist (`firstName`, `lastName`, `email`,
  `name`, `dob`, `homebase`, `homebaseSharedCircles`, `avatarUrl`, `preferences`) was derived
  by tracing every real caller — `hooks/useAuth.tsx`'s `completeOnboarding`/`updatePreferences`/
  `updateUser`, and every `updateUser(...)` call site in `app/onboarding.tsx` and
  `app/(tabs)/profile.tsx`'s `handleSave` — rather than guessed, including the non-obvious
  camelCase `avatarUrl` field the avatar picker writes (distinct from the snake_case
  `avatar_url` set at account creation in `POST /api/auth/login`). Live-verified against the
  real backend with a throwaway test account: a `PUT` with `{isAdmin: true, role: 'admin',
  google_id: 'hijacked', firstName: 'UpdatedName'}` persisted only `firstName`; a follow-up
  `PUT` with `homebase`/`avatarUrl`/`preferences` persisted all three, confirming real profile
  editing still works unchanged.
- **`docs/useauth-split-plan.md` still claimed the `hooks/useAuth.tsx` split was "not
  attempted this pass — deliberately deferred," which this changelog's own prior entries
  repeated — but the split is actually complete.** Verified directly rather than trusting the
  stale status: `hooks/useAuth.tsx` is 236 lines (identity/session only), and
  `lib/api-client.ts`/`hooks/useContacts.tsx`/`hooks/useEvents.tsx`/`hooks/useTrips.tsx` all
  exist, wired up in `app/_layout.tsx` exactly per the plan's provider boundaries, each
  carrying a "Step N of the useAuth.tsx split" comment pointing back at the doc. The doc's
  header now says so plainly; the rest of the doc (provider boundaries, migration order,
  verification standard) is kept as historical reference rather than deleted — see
  `docs/useauth-split-plan.md`.

### Changed
- **`hooks/useTrips.tsx` and `hooks/useContacts.tsx` no longer each carry their own copy of
  the offline-sync engine.** Found during the code-cleanliness audit run alongside the
  security audit above: the two files
  independently implemented the identical AsyncStorage-load → ref-guarded server-sync-effect →
  diff-based create/update/delete (isolated try/catch + `lib/mutation-queue.ts` fallback) →
  refetch shape, ~90 nearly-identical lines each. Factored into `hooks/useSyncedCollection.ts`,
  a config-driven hook (not a component — each provider still owns its own Context and any
  extra methods, `toggleDismissedSlot`/`refreshContacts`) that both providers now call. The
  hand-rolled `a.id === b.id || a._id === b._id` identity check this sync logic (and 2 other
  call sites) used is now the shared `sameEntity()` helper (`lib/entity-id.ts`). Along the way,
  `TripsContextType`/`ContactsContextType`'s `trips: any[]`/`contacts: any[]` became
  `ClientTrip[]`/`ClientContact[]` (defined next to `parseServerTrips`/`parseServerContacts`,
  the shape those functions already normalized). Verified with a live round-trip against the
  real local backend (login, create/update/delete for both a trip and a contact via direct API
  calls matching exactly what the new hook sends) — not just `tsc --noEmit` passing.
- **`app/(tabs)/trips.tsx`'s `PlaceCard`/`RefineSearchCard`/`ContactPicker` and
  `app/(tabs)/profile.tsx`'s five nested modals (`OptionRow`, `ConfigRowModal`,
  `CategorizedSelectionModal`, `GenericSelectionModal`, `VersionHistoryModal`) no longer get
  re-created on every render of their parent screen.** Extracted to real top-level,
  props-driven components under `components/trips/` and `components/profile/` respectively.
  Both screens' own render bodies were touched only at each component's definition site and
  call sites (props threaded through instead of closures) — everything else left as-is, since
  `trips.tsx`/`social.tsx` are also under active, unrelated feature work elsewhere in this
  sprint. New shared types (`ClientTrip`'s sibling `TripEvent`/`TripMock`/`TripBaseLocation`,
  plus `formatDistanceLabel`/`placePhotoUri`) live in the new `lib/trip-types.ts`, specifically
  to let the extracted components avoid importing back from `trips.tsx` itself.
- **The `darkActionSheet` bottom-sheet style, byte-for-byte duplicated between
  `social.tsx:439` (as `actionSheet`) and `trips.tsx:1885`, is now defined once.** Each file's
  own comment pointed at the other instead of extracting it. Now in
  `components/ui/dark-action-sheet-style.ts`; both screens' style objects just reference it.
- **`CLAUDE.md` corrected to match the current codebase**, found stale during the same audit:
  it described a mock recommendation "engine" in `lib/recommendations.ts` that's since been
  removed (now 41 lines — just the `PlaceRecommendation` type and `displayCategory()`); said
  `Event` "has no REST endpoints" when it has 8; omitted `models/FriendRequest.ts`/`Place.ts`
  and most of `lib/` (`free-time.ts`, `place-matching.ts`, `google-places-client.ts`,
  `google-places-types.ts`, `places-population.ts`, `mutation-queue.ts`, `api-client.ts`,
  `geocoding.ts`, `hotel-geocoding.ts`, `onboarding-taste.ts`, `timezones.ts`, `maps-link.ts`,
  `avatar.ts`, `mongodb.ts`) from its own file lists; and its "Client state" section still
  described the pre-split `useAuth.tsx` as owning trips/contacts directly. All corrected,
  including a note on the new `--conditions=react-server` flag `npm test` now runs with (see
  below).
- **The 3 dead exports the audit flagged are gone — 2 deleted outright, 1 relocated rather
  than deleted along with its test coverage.** `computeMatchScore()`
  (`lib/place-matching.ts`) and `getAllTaxonomyTags()` (`lib/google-places-types.ts`) had no
  callers outside their own test files — confirmed by grepping the whole worktree, not
  assumed. `computeMatchScore()` and its tests were deleted outright (the real scoring lives
  server-side as a Mongo aggregation; this was a since-orphaned testable mirror of it).
  `getAllTaxonomyTags()` existed purely to serve one valuable regression test ("every leaf tag
  in `constants/preferences.ts` has exactly one mapping entry") — rather than delete that
  coverage along with the export, the same flattening logic now lives directly in
  `lib/google-places-types.test.ts` instead of being a production export. `getPendingMutationCount()`
  (`lib/mutation-queue.ts`) was also unused — considered wiring it into a "N pending changes"
  UI indicator instead of deleting it, since offline sync is core to this product per
  `CLAUDE.md`, but there's no existing polling/reactive mechanism to hang it off (the only
  thing that currently "ticks" is `useMutationQueueFlush`'s AppState-foreground listener) —
  building one would be a small UI feature, not a cleanup, so out of scope here. Deleted as
  genuinely dead code for now.
- **`lib/mutation-queue.ts` (retry/reconciliation logic for failed offline-sync writes) now
  has test coverage** (`lib/mutation-queue.test.ts`), matching its siblings
  (`free-time.ts`/`onboarding-taste.ts`/`place-matching.ts`/`hotel-geocoding.ts`/`avatar.ts`
  all already had `.test.ts` files) — this was the one piece of `lib/` where a silent bug is
  most likely to hide (a failed sync just "queues again" with no visible symptom). Covers:
  successful replay-then-remove, a dropped-connection retry that stays queued until it
  succeeds, a non-ok response (e.g. 404) staying queued rather than being dropped, a newer
  mutation for the same key replacing rather than stacking on the older one, and one failing
  mutation not blocking another queued mutation in the same flush. Turned up a real gap while
  writing it: this file's actual dependency chain (`lib/api-client.ts` → `expo-constants` →
  `react-native`) can't be transformed by esbuild outside the RN/Expo build pipeline
  (`react-native/index.js` uses Flow syntax `tsx --test` can't parse) — which is the real
  reason this file had no test before now, not an oversight. Fixed by running `npm test` with
  `--conditions=react-server`, which routes `expo-constants` to its dependency-free build
  (meant for RSC/server contexts, equally applicable here) instead of the one that pulls in
  `react-native` — no production code changed to make this possible. AsyncStorage (also used
  by this file) needed a smaller stub of its own (`window.localStorage`, backed by an
  in-memory `Map`, same stubbing pattern `lib/hotel-geocoding.test.ts` already uses for
  `fetch`).

### Roadmap noted
- **No database backup strategy — a real incident during this sprint, not a hypothetical.**
  Block 04's encryption-at-rest work live-verified its migration script
  (`scripts/migrate-encrypt-events.ts`) against the actual shared local MongoDB (not an
  isolated copy), encrypting all 28 real `Event` documents in place. The systemd-managed
  server actually serving the live beta tunnel was still running the pre-merge code with no
  decryption logic, so the live app broke immediately — every event's title/location came back
  as ciphertext. No backup existed, anywhere, to restore from. Since the data was all test
  data, the fix was to delete the `Event` collection outright rather than reconstruct it — but
  that was a lucky out, not a plan; the same incident against real user data would have meant
  genuine, permanent loss. Not built here — needs: (1) an actual backup mechanism for the local
  MongoDB (even a simple scheduled `mongodump` to a local path would beat what exists today,
  which is nothing), and (2) a hard rule, not just a guideline, that **any migration script
  touching existing data must take a verified backup immediately before writing anything** —
  the migration script pattern this project already has (`migrate-encrypt-events.ts`'s own
  `--dry-run` flag) is a good start but dry-run alone doesn't protect against exactly what
  happened here (a real, non-dry-run execution against shared data with nothing to fall back
  to). Worth revisiting once GCP migration (Block 05) lands, since Atlas's built-in
  point-in-time backups would make this a non-issue — but shouldn't wait until then, since
  local dev/beta work touching real data continues in the meantime.
- **A participant's shadow trip was never cleaned up when the organizer's trip (or its last
  event) was deleted, leaving a permanently empty trip behind.** Reported live: Toto (an event
  participant) saw two trips to Rome — one with the actual accepted restaurant, one showing
  nothing. Root cause, confirmed via direct API calls: `DELETE /api/trips/:id` (`server.ts`)
  cascaded to delete the organizer's own `Event` docs (`Event.deleteMany({ trip_id })`) but
  never touched other users' shadow trips (`Trip.linkedTripId`, added in 0.0.36 —
  auto-created for a participant on accept) that pointed at the deleted trip; `DELETE
  /api/events/:id` had the same gap for the narrower case where deleting one event empties out
  a shadow trip that had others. Fixed: both handlers now also delete any `Trip` docs whose
  `linkedTripId` points at what was just deleted — `DELETE /api/trips/:id` unconditionally
  (mirroring the existing `Event.deleteMany` cascade already there), `DELETE /api/events/:id`
  only when deleting that event left zero events remaining under its `trip_id` (a
  `countDocuments` check first, so a shadow trip with other live events survives). Kept both
  diffs minimal and localized to just these two handlers, since another agent is independently
  touching `server.ts` for security work in a parallel worktree. Live-verified against the real
  backend and MongoDB — via a second local `tsx server.ts` instance on port 3099 pointed at the
  same database, so as not to restart the shared systemd-managed server other agents may be
  testing against: created a throwaway organizer + participant, a trip with two events both
  accepted by the participant (creating one shadow trip). Deleting the first event left the
  shadow trip intact (the second event still live); deleting the second (now the trip's last
  event) correctly cascaded the shadow trip's deletion. Separately, recreated a third event and
  confirmed deleting the whole organizer trip directly also correctly cascades. All test
  data cleaned up afterward.
- **A confirmed event's card no longer looks and behaves completely differently depending on
  who's viewing it — organizer vs. invited participant.** Reported live, same Toto scenario:
  the accepted restaurant had no address, no photo, and no "Navigate" button on Toto's side,
  unlike Nico's. Root cause, confirmed by reading the render logic: the rich card (photo,
  address, rating, "Navigate ›") only appeared when `isPlaceScheduledInSlot` matched a
  confirmed event against an entry in the *current viewer's own* independently-scored
  recommendation results for that slot — true for whoever picked the place from their own
  proposals (the organizer), essentially never true for a participant, whose own recommendation
  query is scored against their own preferences and has no reason to surface the same place.
  Every other case fell back to the plain "Current Schedule" timeline row — a colored dot,
  time, and a text label, not even tappable. Fixed as a rendering-path merge, not a
  viewer-specific special case: `PlaceCard` now accepts an optional `existingEvent` (the
  caller's own known event, skipping the time-window re-derivation `findScheduledEventForPlace`
  otherwise does) and `fullWidth` (swaps in the existing `placeCardWide` style — already used
  by the joint-recommendation and refine-search results lists for the same single-column shape
  — instead of the horizontal-scroll-sized `placeCard`). The "Current Schedule" timeline now
  renders any resolved (`place_name`+`place_id`), non-imported event with this same card,
  sourcing the place first from any slot's own cached `slotRecommendations` (new
  `findPlaceInSlotRecommendations` helper — no extra network call when it's already there, e.g.
  the organizer's own picks) and otherwise via `GET /api/places/:id` (new `placesById` cache +
  a dedicated fetch effect, reusing the same fallback-fetch-by-id pattern already used for the
  analogous "missingScheduled" gap in the AI Schedule Proposals fetch effect, just decoupled
  from any one slot) — falling back to the plain text row only for the brief window before that
  fetch resolves. `tsc --noEmit`/`npm run lint` clean. Not live-verified with an actual
  two-account UI render in this pass — no device/simulator in this environment — so treat the
  rendering side as verified by code-reading/type-checking only, unlike the fully
  live-verified shadow-trip cascade above.
- **Investigated: imported calendar events feeding the free-time algorithm and rendering on
  the trip timeline — found already resolved, no code change needed.** This sprint's brief
  (grounded in 0.0.14's "Explicitly out of scope" note) described `lib/free-time.ts`'s
  free-time algorithm as not consuming `source:'imported'` events, and nothing rendering them
  on the trip timeline. Both were actually already built in 0.0.21 ("Trip day-schedule now uses
  the real imported calendar instead of a hardcoded work-day guess" / "'Scheduled Sequence' no
  longer mislabels real meetings…"), nine versions after the 0.0.14 note this sprint item was
  drawn from — the brief's grounding was stale, not the code. Verified directly against the
  current code, not just this changelog's own claims: `getTripDaySchedule`
  (`lib/free-time.ts`) still takes an `importedEvents` param and uses real
  `calculateFreeTimeSlots` gaps on any day that has imported data, falling back to
  `getHardcodedFreeSlots` only on a day with none; all three call sites in `trips.tsx` (the AI
  Schedule Proposals fetch effect, the calendar-sync effect, and the main render) still pass
  imported events through; `lib/free-time.test.ts`'s "a day with imported events uses real gaps
  instead of the hardcoded pattern" test still exists and passes (re-ran the full suite this
  session: 27/27 passing); and the "Current Schedule" timeline in `trips.tsx` still renders
  `source: 'imported'` events as read-only busy blocks (`isImported` branch,
  `timelineIndicatorBusy`, title + time only, no "Proposed…" treatment). No design decision to
  flag and nothing to build — just correcting the record so this doesn't get re-planned as open
  work by a future pass that also only reads the stale 0.0.14 note.
- **Swipe-refine deck's drag felt sluggish.** `components/ui/swipe-deck.tsx`. Root cause, on
  inspection: `onPanResponderMove`'s `Animated.event` (tracking the card's live drag position
  every touchmove) was wired with `useNativeDriver: false`, forcing every single touch sample
  through the JS bridge before the card's transform could repaint — the classic cause of a drag
  that "feels like it's lagging behind my finger." Fixed by flipping it to
  `useNativeDriver: true`; safe because `position.x`/`position.y` are only ever consumed as
  `transform` (`getTranslateTransform()` plus the `rotate` interpolation), which the native
  driver fully supports — nothing reads the raw numeric value off the JS thread. The
  release-spring and fly-off animations were already `useNativeDriver: true`, so this was the
  one remaining JS-driven step. Deliberately NOT the full `PanResponder`→`Gesture.Pan()`/
  reanimated migration a prior attempt tried (see 0.0.32's "Known issue") — that migration is
  what broke the ✓/✕ round buttons last time (deck silently stopped advancing) and was
  reverted. This fix leaves `PanResponder`, `onMoveShouldSetPanResponder`,
  `onPanResponderRelease`, and the round buttons' own `onPress={() => advance(...)}` wiring
  completely untouched — none of that code path is touched by this diff — so it carries
  essentially none of that regression's risk. Attempted to verify live via `expo start --web`
  in a browser this session (the bundle came up cleanly at localhost:8090); walking a fresh
  account through onboarding to reach this step was still in progress when a session-wide rate
  limit cut the browser session short, unrelated to this change. Falling back to the
  verification this task's brief explicitly allows in that case: `tsc --noEmit`/`npm run lint`
  clean, plus high confidence from the change's narrow, single-flag, button-code-untouched
  scope — but flagging honestly that this was not confirmed with an actual on-screen drag/button
  test, unlike the fully live-verified items above. Worth a real on-device/browser pass before
  calling the "feels slow" report fully closed.
- **Create/Edit Trip: end-date picker now follows the start date.** Building on the two-part
  fix proposed in this changelog previously: `components/ui/NativeDatePicker.tsx` now accepts
  an optional `minimumDate`, passed straight through to the underlying
  `@react-native-community/datetimepicker` on both the iOS inline and Android modal variants;
  the end-date field in `app/(tabs)/trips.tsx` is given `startDate` as its `minimumDate` as a
  safety net for manual backward scrolling. Separately, a new `handleStartDateChange` wraps
  `setStartDate`: whenever the newly-picked start date lands on/after the current end date,
  `endDate` auto-advances by the trip's existing length (minimum 1 day) so the end-date picker
  naturally opens on a relevant month instead of a stale or now-invalid one, matching the
  standard hotel/flight-booking date-picker pattern. `tsc --noEmit`/`npm run lint` clean — not
  live-verified against an actual device date-picker interaction (no simulator in this
  environment); this is a small, synchronous date-arithmetic change with no async/network
  surface likely to hide a bug behind.

### Roadmap noted
- **Full security audit — 1 critical, 1 high, 1 medium, 2 low, and 4 areas verified clean.**
  Requested directly ahead of sprint planning. **Critical:** `POST /api/auth/login`
  (`server.ts:111`) grants a full 30-day session for any email address with zero password/OTP/
  OAuth verification — confirmed no auth mechanism exists anywhere in the codebase
  (`User.google_id` is a schema field but is never checked). Combined with
  `POST /api/friend-requests` (`server.ts:1091`) returning a distinguishable 404 for an
  unregistered email, this is a free email-enumeration oracle paired with a walk-in token for
  any account it finds — live and internet-reachable via the beta tunnel right now, no rate
  limit slowing it down. **High:** `public/admin.html` and all 5 `/admin/api/places` routes
  (`server.ts:1220`) have no auth at all, built on a "local-only" assumption the beta tunnel
  already breaks. **Medium:** no rate limiting anywhere in `server.ts`. **Low:** all ~35 route
  handlers leak raw `error.message` to clients on a 500 (`server.ts:148` +34 more);
  `PUT /api/users/:id` (`server.ts:168`) does `$set: req.body` against a `strict:false` schema
  with no allowlist — self-inflicted-only today, but a real privilege-escalation vector the
  moment any role field is added. **Verified clean:** IDOR (every `:id`-scoped route correctly
  scopes to its owning field, not a bare lookup), regex injection (`escapeRegExp` applied at
  every `$regex` site), the intentionally-unauthenticated photo proxy route (reasoning holds),
  and secrets/dependencies (nothing committed; `npm audit` hits are all transitive build
  tooling, none reachable from the running server). Not fixed here — audit only, feeding
  sprint planning. **Update (sprint block 04):** the High/Medium/Low findings — admin panel
  auth, rate limiting, the `error.message` leak, and the `PUT /api/users/:id` mass-assignment
  gap — are fixed; see the `### Fixed`/`### Added` entries below. The Critical finding
  (`POST /api/auth/login` granting a session from an email alone) is unchanged by design —
  explicit product-owner call to keep it for now ("we aren't even beta"), not an oversight.
- **Full code-cleanliness audit — 9 findings, plus one correction to this very changelog's own
  prior entries.** Requested directly alongside the security audit. **Correction:** the
  `hooks/useAuth.tsx` split (tracked as deferred/not-started in this changelog and in
  `docs/useauth-split-plan.md`) is actually already complete — verified directly:
  `useAuth.tsx` is 236 lines (identity/session only), with `useTrips.tsx`/`useContacts.tsx`/
  `useEvents.tsx` already split out exactly per the plan, each carrying "Step N of 5"
  comments. The plan doc still opens with "Not attempted this pass," which will mislead the
  next person into re-planning finished work. **Medium:** `useTrips.tsx`/`useContacts.tsx`
  duplicate ~90 lines of identical offline-sync logic each (`useTrips.tsx:100-203` vs.
  `useContacts.tsx:96-191`) — a `createSyncedCollectionProvider(config)` factory would remove
  it, the natural next step after the split above; `trips.tsx` (1946 lines/46 `useState`s) and
  `profile.tsx` both define their modal subcomponents inside the parent's render body,
  re-creating them every render; the `darkActionSheet` bottom-sheet style is byte-for-byte
  duplicated between `social.tsx:439` and `trips.tsx:1885`, each file's own comment pointing at
  the other instead of extracting it. **Low:** the documented `id`/`_id` dual-check convention
  is hand-rolled 6 times with no shared helper; `CLAUDE.md` itself is stale in several places
  (describes a mock recommendation engine that's since been removed, says `Event` "has no REST
  endpoints" when it has ~10, omits `models/FriendRequest.ts`/`Place.ts` and most of `lib/`
  from its own file lists); 3 dead exports (`getPendingMutationCount`, `computeMatchScore`,
  `getAllTaxonomyTags`); `lib/mutation-queue.ts`'s retry/reconciliation logic is untested
  despite being exactly the kind of thing that fails silently; type erosion (69 `any` in
  app/hooks/lib, 51 in `server.ts`) where the parse functions already have real shapes to
  reuse. Not fixed here — audit only. Both audits published as a structured, block-organized
  roadmap artifact for sprint planning (link kept locally, not committed here since artifact
  URLs are account-scoped).

### Added
- **Circles: "Discover nearby friends" now actually exists on the Circles tab, and a contact
  can finally be removed, not just re-circled.** Closes gaps #1 and #5 from
  `docs/circles-feature-proposal.md`. `social.tsx`'s own subtitle ("Manage privacy and
  discover nearby friends") promised a feature that had zero code path anywhere in the file —
  `GET /api/friends-nearby` (circle-scoped, sharer-driven presence discovery, `server.ts:337`)
  was wired only into `trips.tsx`, gated behind an open trip. Now also wired into `social.tsx`
  directly (new "Near &lt;home city&gt; right now" section, above the circle filter pills),
  scoped to the user's `homebase` with no date range — no trip required. Tapping a nearby
  friend shows a simple lives-here/visiting detail (no propose-event flow here; that stays
  `trips.tsx`'s job). Separately, the "Move Contact" sheet — previously the only action on a
  contact, and it only ever reassigned `circleTags` — now has a "Remove Friend"/"Remove
  Invite" action gated behind a native destructive confirmation (irreversible: re-adding means
  a new friend request or invite). No new backend work needed: `DELETE /api/contacts/:id`
  already existed and is scoped to `owner_user_id` (`server.ts:1065`), and
  `hooks/useContacts.tsx`'s `setContacts` already calls it whenever its old-vs-new array diff
  detects a contact dropped from local state — the UI just never produced that diff before.
  Live-verified against the real backend end-to-end: created two throwaway accounts sharing a
  homebase city, linked them as contacts on both sides with `homebaseSharedCircles` set, and
  confirmed `GET /api/friends-nearby` returns the correct `lives_here` match for the scoped
  city; then `DELETE /api/contacts/:id` followed by `GET /api/contacts` confirmed the contact
  is actually gone, not just hidden.
- **Circles: contacts can now be tagged into more than one circle, matching the data model.**
  Closes gap #3. `Contact.circleTags` is a `string[]` (`lib/contacts.ts`, `models/Contact.ts`)
  and always supported multiple tags, but `social.tsx`'s `handleMoveContact` always replaced
  the array with a single new value (`circleTags: [newCircle]`), making the "Move Contact"
  sheet behave like a single-select radio group. Replaced with a real toggle
  (`handleToggleContactCircle`): tapping a circle adds/removes it from the contact's tag set,
  the sheet stays open across taps (so multiple circles can be picked in one visit — see the
  new "Done" button, below), and `selectedContact` is kept in sync alongside `contacts` so the
  ✓ marks update immediately. Matters concretely for a colleague who's also a genuine friend
  (normal for this app's "bleisure" audience) — they can now be filed under both `Work` and
  `Family and Friends`, so their own separate circle-sharing choices are visible to you under
  either. Live-verified: `PUT /api/contacts/:id` with `{"circleTags":["Work","Family and
  Friends"]}` against a real contact, confirmed via `GET /api/contacts` that both tags
  persisted together.
- **Circles: pending (invite-by-email) contacts are no longer a dead end.** Closes gap #4.
  Previously a `pending_` contact showed a static "Pending — hasn't joined yet" label with no
  further action, no sent-date, and no recovery path. The contact card now shows "Pending —
  invited &lt;date&gt;" (from the `Contact` doc's own `createdAt`, already returned by the API
  and already flowing through `parseServerContacts` — just never surfaced in the UI). The
  "Move Contact" sheet adds a "Resend Invite" action for pending contacts. There's no
  email-sending or invite-token infrastructure anywhere in this backend (confirmed: no
  nodemailer/sendgrid/etc. dependency, no `/api/invites` route) — building real "resend the
  original email" delivery is a backend prerequisite that isn't in place, so this doesn't fake
  it. Instead it opens the device's own mail client via `Linking.openURL('mailto:...')` (React
  Native core, no new dependency) with the invite re-composed and the recipient's email
  pre-filled, so there's an actual next step instead of a static label. Full email-sending
  infrastructure (so this could be a true one-tap resend) is a separate, larger backend piece
  — flagged, not built here.
- **Security sprint (block 04): no rate limiting anywhere in `server.ts`.** Flagged Medium in
  the security audit above — nothing slowed down scripted abuse of `POST /api/auth/login`
  (grants a session from an email alone, see the Critical finding above, kept as-is by product
  decision) or the email-enumeration oracle in `POST /api/friend-requests` (distinguishable 404
  for an unregistered email). Fixed with `express-rate-limit`: a `strictLimiter` (10 requests /
  15 min, keyed by IP) is applied specifically to those two routes, the two concrete vectors
  named in the audit; a much looser `globalLimiter` (300 requests / 15 min) is applied
  app-wide via `app.use()` as cheap insurance against everything else, generous enough it
  should never bother a real client. Live-verified against the real backend: 12 rapid
  `POST /api/auth/login` calls from the same IP returned 200 for the first several then 429
  for the rest, within the same 15-minute window. `npm audit` after adding the dependency: no
  new advisories (still 0 findings reachable from the running server, same as the audit's
  "verified clean" note above).
- **Security sprint (block 04): per-user AES-256-GCM field encryption at rest for
  `Event.title` / `.location` / `.place_name`, the local-only stopgap
  `docs/data-encryption-plan.md` explicitly called for.** These are the free-text fields the
  plan flagged as most sensitive (calendar-imported titles/locations can reveal medical
  appointments, legal matters, home/work addresses) and, per the plan's own reasoning, the
  ones that can be encrypted transparently — none of them are ever filtered/sorted/indexed
  server-side. Built exactly to the plan's proposed design: `lib/field-encryption.ts` holds
  the pure AES-256-GCM primitives (a versioned `v1:<iv>:<tag>:<ciphertext>` format, unit-tested
  in `lib/field-encryption.test.ts`); `lib/user-data-key.ts` implements the envelope —
  each `User` gets a random 256-bit data key, generated lazily on first write, wrapped under
  a single master key from the new `ENCRYPTION_MASTER_KEY` env var (the plan's explicit
  "local-only stopgap," real KMS swap-in deferred with the still-pending GCP migration) and
  stored as `User.encryptedDataKey`; `server.ts`'s Event routes (`POST`/`PUT`
  `/api/trips/:tripId/events`, the calendar-`/import` upsert, `PUT /api/events/:id`) encrypt
  on write and every read path (`GET /api/trips/:tripId/events`, `GET /api/events/invited`)
  decrypts per-event using that event's *creator's* key, so an invited participant reading the
  organizer's event still sees plaintext without needing a key of their own — this is
  encryption against raw DB access, not a per-viewer access-control layer (that's the existing
  ownership/participant checks, unchanged). A brand-new `scripts/migrate-encrypt-events.ts`
  (with a `--dry-run` mode) backfills existing plaintext records, skipping any field already in
  the versioned ciphertext format so it's safe to re-run, and never force-writes a record it
  can't resolve a key for. Every helper is a clean no-op (fields read/write as plain strings,
  today's behavior) when `ENCRYPTION_MASTER_KEY` isn't set, so this doesn't require every
  environment to configure it immediately. **Deliberately not attempted:** key rotation (the
  plan doc never specifies a policy — out of scope, not an oversight) and the real KMS swap-in
  (explicitly deferred to the GCP migration in the plan itself). Live-verified end to end
  against the real local MongoDB, not just unit tests: created an event with a real
  title/location/place_name through the actual API and confirmed the raw MongoDB document
  holds ciphertext (`v1:...`) while the API response is plaintext; confirmed a second user
  invited to that event (`GET /api/events/invited`) sees the decrypted plaintext via the
  organizer's key, not their own (they have none); confirmed `PUT /api/events/:id` re-encrypts
  edited fields; ran `scripts/migrate-encrypt-events.ts` with `--dry-run` then for real against
  the actual pre-existing 28 Event documents in the local dev database (backed up to JSON
  first) — all 28 migrated with 0 failures, verified every field on every document is now in
  the encrypted format, and re-fetched one of the migrated (previously plaintext) events
  through the live API to confirm it still decrypts correctly end to end.
  **Post-merge correction:** the migration above was run against the live shared MongoDB
  before this branch's decryption code reached the systemd-managed server actually serving
  the beta tunnel — which broke the live app immediately (every event title/location came
  back as ciphertext to the old, pre-merge code). No backup file was actually found on disk
  despite the note above; since all 28 affected events were test data, the `Event` collection
  was deleted outright to restore service rather than reconstructed. See the new "Roadmap
  noted" entry on database backups below — this is the incident that prompted it.
- **The local beta stack (MongoDB, backend server, cloudflared tunnel) now survives a
  reboot on its own.** Triggered by a real incident: an OOM-killed Gradle build forced a
  server reboot, which silently took MongoDB, `npm run server`, and the tunnel down with it —
  discovered only when trying to share a build. Three systemd `--user` units
  (`~/.config/systemd/user/odysai-{mongo,server,tunnel}.service`, not checked into the repo,
  machine-specific) wrap the existing `scripts/local-mongo.sh`, `tsx server.ts`, and
  `scripts/expose-server.sh` respectively, each `enabled` with dependency ordering
  (server requires mongo; tunnel wants server). `loginctl enable-linger` (no root needed) makes
  the user's systemd instance start at boot even with nobody logged in — the systemd-native
  equivalent of an `rcX.d` startup script on this system (Ubuntu 25.10 has no SysV init to hook
  into). `scripts/restart-server.sh` (still run daily at 6am via cron) now does
  `systemctl --user restart odysai-server.service` instead of its old manual `pkill`+`nohup`
  dance, since that would otherwise race with systemd's own `Restart=always` on the same
  process. Live-verified: stopped the manually-started processes, brought all three up via
  `systemctl --user enable --now`, confirmed `/health` responds 200 and the tunnel serves
  traffic end-to-end — not verified against an actual physical reboot in this session.
- **Local EAS Android builds capped to fit available RAM.** A prior local `eas build --local`
  OOM-killed the Gradle daemon mid-build (kernel `Out of memory: Killed process ... (java)`,
  confirmed via `journalctl`) — root cause was compiling native C++ for all 4 Android ABIs in
  parallel on a 4-core/15GB machine. Fixed two ways: `~/.gradle/gradle.properties` (global,
  not checked in) caps `org.gradle.jvmargs`/`kotlin.daemon.jvm.options`/`workers.max` to leave
  headroom; `ORG_GRADLE_PROJECT_reactNativeArchitectures=arm64-v8a` (set at build invocation,
  not committed anywhere) restricts local builds to one ABI, since a preview/test APK only
  ever needs to run on real test devices. Cut a from-scratch local build from OOM-crashing to
  ~10-11 minutes clean.

### Changed
- **Circles: "Move Contact" sheet copy no longer implies the privacy mechanism backwards.**
  Closes gap #2. The sheet's old copy — "Assign them to a new Circle privacy tier" —
  is a hint, not an explanation, and the direction it implies is backwards from how the
  mechanism actually works: `GET /api/friends-nearby` cross-references *their*
  `homebaseSharedCircles`/`Trip.sharedWithCircles` opt-in against *your* `circleTags` on
  *them*, so filing a colleague under "Work" doesn't limit what they see of you — it's the
  precondition for what of *their* separately-shared presence becomes visible to *you*. Rewrote
  the sheet's copy to be concrete about that direction, matching the bar
  `CircleShareSelector` already sets elsewhere in the app (`trips.tsx`'s "Lets people in these
  circles see you're heading here on these dates..."), and added a short note for pending
  (not-yet-joined) contacts clarifying that none of it applies until they actually join. The
  sheet's old always-"Cancel" close button is now "Done" for this sheet specifically (the
  Accept Friend Request sheet keeps "Cancel", which is still accurate there) — circle toggles
  now apply live as they're tapped, same pattern as `profile.tsx`'s
  `toggleHomebaseCircle`/`updateUser`, so "Cancel" was no longer accurate once toggling
  stopped auto-closing the sheet.

### Roadmap noted
- **Per-user field-level encryption at rest (AES-256), starting with calendar-imported data.**
  `POST /api/trips/:tripId/events/import` stores real device-calendar `title`/`location` in
  MongoDB in plaintext today — some of the most sensitive data this app touches, and more so
  once real OAuth (still deferred, see below) potentially brings in real Google Calendar data
  rather than just device-local sync. Requested directly: every user's data encrypted with a
  key unique to that user, before OAuth work proceeds. Not built here — full proposal (scope,
  per-user AES-256-GCM envelope encryption, key-management dependency on the eventual GCP
  migration, which fields can't be transparently encrypted without losing server-side
  query/filter/index capability) written up in new `docs/data-encryption-plan.md`. **Update
  (sprint block 04):** the plan's own explicitly-allowed "local-only stopgap" — a master key
  from an env var, real KMS swap-in still deferred with the GCP migration — is now built and
  live-verified; see the `### Added` entry above (and its post-merge correction on the data
  incident that came with verifying it live). Key rotation is still not designed (the plan
  never specified a policy) and the real KMS migration is still fully out of scope, both
  unchanged from this entry's original scoping.
- **Create/Edit Trip: end-date picker doesn't follow the start date.** Reported directly:
  picking an October start date leaves the end-date calendar still showing September. Root
  cause, confirmed by reading the code: `startDate`/`endDate` in `app/(tabs)/trips.tsx`
  (lines ~128-129) are two fully independent `useState`s with no relationship after their
  initial default (today / today+3 days) — `components/ui/NativeDatePicker.tsx` just renders
  whatever `Date` it's handed as `value`, with no `minimumDate` support and no awareness of the
  other field, so the end-date picker always opens on whatever month `endDate` currently
  happens to be. There's already a submit-time guard (`trips.tsx:615`,
  `if (startDate > endDate) Alert.alert('Invalid Dates', ...)`), but nothing keeps the two in
  sync while the user is actively picking — same root cause as the reported symptom, not a
  separate bug. Not built here — proposed two-part fix: (1) auto-advance `endDate` (preserving
  the existing trip length) whenever `startDate` moves to on/after it, so the end-date picker
  naturally opens on a relevant month; (2) add `minimumDate` support to `NativeDatePicker`
  (the underlying `@react-native-community/datetimepicker` already supports it) and pass
  `startDate` as the end-date field's `minimumDate`, as a safety net for manual backward
  scrolling — the standard pattern from hotel/flight-booking date pickers.
- **Event listings and route-based Activity tags (Walking Tours, Boat Cruises, Bus Tours,
  Water Sports, Scenic Drives) still have no real data source.** `lib/google-places-types.ts`
  already documents both gaps accurately (`quality: 'broad'`/`'none'` on the affected tags —
  Places API only returns venues, never schedules, and has no route/product data at all).
  Checked seriously for a free, no-key source before assuming one doesn't exist, per this
  project's `lib/weather.ts`/`lib/geocoding.ts` precedent: Eventbrite's public search API was
  killed in 2020, TheSportsDB's free tier is too crippled (1-result caps, no city search) to
  answer "what's on nearby," Ticketmaster/SeatGeek/Viator/GetYourGuide all require a vendor
  key or partner agreement (already the plan in `docs/monetization-strategy.md`), and
  OpenStreetMap's route/scenic tags are confirmed sparse/subjective and don't fit `Place`'s
  point-only geometry (`models/Place.ts:29-30, 67-68, 84`) even where they exist. One
  genuinely free/no-key candidate was found (StungEvents, unauthenticated `/events` and
  `/search` endpoints) but has no independently verifiable track record or coverage data, so
  it's flagged for a human spot-check rather than wired in blind. No code changes — full
  research and recommendation in new `docs/event-data-coverage-plan.md`.

### Added
- **Push notification infrastructure — server-side built and live-verified end-to-end;
  client-side registration wired in; in-app display/deep-linking still a follow-up.** Closes
  the gap the 0.0.33 friend-requests entry called out directly ("no push notification infra
  exists anywhere in this app... device tokens, `expo-notifications`, server-side push
  sending"). Built: (1) `User.expoPushToken` (`models/User.ts`) plus a new
  `POST /api/users/me/push-token` (`server.ts`) that stores it, scoped to `req.userId` —
  deliberately a new endpoint rather than folded into `PUT /api/users/:id`, since that route
  is independently being locked down with a field allowlist elsewhere in this sprint and this
  avoids the conflict. (2) `lib/push-notifications.ts`: a `sendPushNotification` helper that
  POSTs to Expo's push HTTPS API (`https://exp.host/--/api/v2/push/send`), no extra SDK
  needed. Best-effort only, same shape as `ensurePlacesForCity`
  (`lib/places-population.ts`): every failure (network error, invalid/expired token, a
  per-ticket error in Expo's response body) is caught and logged, never thrown. Wired into
  the two places this app currently generates a notification-worthy event: `POST
  /api/friend-requests` (new incoming friend request) and `POST /api/trips/:tripId/events`'s
  `participantContactIds` path (new event invite) — both wrapped in their own try/catch at
  the call site too, for defense in depth, matching how `ensurePlacesForCity` itself is
  called in three places despite already being best-effort internally. (3) Client-side:
  `lib/push-token.ts` (`registerForPushNotificationsAsync`, wrapping `expo-notifications`'
  permission request + `getExpoPushTokenAsync`, using `app.json`'s existing EAS
  `projectId`) called from `hooks/useAuth.tsx`'s `login()` on a successful backend login —
  deliberately fire-and-forget (not awaited), so a slow/denied native permission prompt can
  never delay or fail the login flow itself. `expo-notifications` config plugin added to
  `app.json` (notification icon: the existing monochrome Android adaptive-icon asset, tint
  `#0F172A` to match the 0.0.37 navy redesign).
  **Explicitly deferred as follow-up, not started here:** in-app foreground notification
  display config (`Notifications.setNotificationHandler`) and tap-to-navigate deep linking
  from a received notification into the relevant friend-request/event screen; re-registering
  the push token on app reopen for a returning user who never re-calls `login()` (today's
  wiring only registers at the moment of a fresh backend login); multi-device fan-out (the
  schema stores one token per user, last-registered wins).
  **Live-verified against the real local backend and MongoDB**, not just `tsc`/lint: ran this
  worktree's own `server.ts` (not the shared systemd-managed instance at `/home/nico/
  Aiventra-new`, deliberately left untouched) on a scratch port against the same local Mongo;
  logged in as two throwaway accounts via `POST /api/auth/login`; confirmed
  `POST /api/users/me/push-token` validates (400 on a missing token), persists
  (`expoPushToken` round-trips through `GET /api/users/:id`), and requires auth (401 with no
  token). Set a syntactically-valid-but-fake Expo token
  (`ExponentPushToken[fakeTestToken1234567]`) on the second account, then, from the first:
  sent a real `POST /api/friend-requests` and, after linking the two as contacts via the
  accept flow, a real `POST /api/trips/:tripId/events` invite — both calls returned 200 with
  the expected document, and the server log showed `sendPushNotification` actually reaching
  Expo's live API and logging back its real per-ticket error (`"...is not a valid Expo push
  token" / DeviceNotRegistered`) without the friend-request/event-creation response ever
  slowing beyond the extra network round-trip or failing. Independently confirmed the same
  well-formed-request/structured-error behavior with a raw `curl` straight to
  `https://exp.host/--/api/v2/push/send`. Test accounts/trip/event/contact/friend-request
  cleaned up afterward (direct Mongo deletes by the throwaway ids, since neither users nor
  friend requests have a delete endpoint).
  **Verification ceiling:** the actual receiving end — a real device or simulator getting a
  real Expo push token and seeing a notification arrive — cannot be verified in this
  environment (no physical device/simulator available here, consistent with this project's
  existing verification-ceiling notes elsewhere in this changelog); everything server-side up
  to and including Expo's push API accepting a well-formed request is verified, the
  client-to-device leg is not.

## [0.0.37] - 2026-08-30
### Added
- **The "Schedule It" modal now has a real edit mode for already-scheduled places.** Tapping
  a place that already has a real Event booked within the tapped slot now detects it
  (`findScheduledEventForPlace`, matched by place + slot time window) and switches the modal
  into "Update This Plan" / "Save Changes", prefilled from the actual event's date/time/
  invitee, instead of always showing a blank "Schedule It" create form that risked POSTing a
  second, duplicate Event for the same place. `PUT /api/events/:id` now also accepts
  `participantContactIds` and preserves each remaining invitee's accepted/declined status
  instead of resetting everyone back to pending just because the organizer re-saved the
  event. Live-verified against the real backend: time updates persist, an already-accepted
  participant stays accepted, and a non-organizer's PUT correctly 404s.

### Changed
- **AI Schedule Proposals no longer appear on a trip where you're the local.** When a trip
  owner's own homebase matches the trip's destination (`isHomeTurf`), the auto-generated
  restaurant/activity proposals section is skipped entirely (no fetch, no render) — a local
  already knows their own city, so a full day of AI suggestions was noise, not help.
  "+ Propose an Event" is unaffected and still the right tool to plan something specific.
  Fixes the live case of inviting a local contact to dinner generating a full day of unwanted
  AI suggestions for a city they already know inside out.
- **Real app icon, replacing the stock map-pin mark.** Two rounds of proposals (rendered as
  comparison pages, not committed to the app) landed on a "crescent O-sail" concept: a hull
  that sweeps upward at both bow and stern — the classical Greek-vase-galley silhouette,
  since a hull curved at only one end reads as a modern dinghy, not "Odyssean" — topped by a
  wide trapezoidal sail with a ring cut into its center as a quiet nod to the "O" in Odys.ai.
  Same navy/blue palette as the previous icon (`#0F172A` background, `#60A5FA`→`#3B82F6`
  gradient), so this is a shape change, not a rebrand. A ".ai" wordmark variant was tried and
  rejected — the shipped assets are the boat mark alone, no text. All six icon/splash/
  adaptive-icon files regenerated and pixel-verified (transparency, fill colors, safe-zone
  sizing) via the same production pipeline as the previous icon (Pillow, 4x supersample,
  LANCZOS downsample — see `scratch/icon-proposals/round2/gen_icons.py`).

## [0.0.36] - 2026-08-29
### Added
- **Accepting an event invite now auto-creates a "shadow" trip to hold it, if you don't
  already have one.** The real fix behind "can't see anything in the trips" for a pure
  event participant (someone with zero trips of their own — e.g. invited to one lunch and
  nothing else): `Event.trip_id` is a required field, so an accepted invite always needed
  *some* trip to live under, but only the organizer ever had one. It only ever showed up in
  the disconnected "Your Invites" modal, and even that vanished from view once nothing was
  left pending (see the banner fix below). New `Trip.linkedTripId` field: on accept
  (`PUT /api/events/:id/respond`), find-or-creates a trip for the participant — mirroring the
  organizer's destination/dates/timezone/city-level `baseLocations` — linked by exact id to
  the organizer's trip. `GET /api/trips/:tripId/events` resolves a linked trip's events from
  the *original* trip_id, filtered to only what this participant is actually invited to
  (never the organizer's full itinerary, which would leak every other guest's plans).
  Idempotent — a second accepted invite from the same organizer trip reuses the existing
  shadow trip rather than multiplying. Live-verified end-to-end against the real backend:
  re-triggered Toto's existing acceptance, confirmed exactly one shadow trip was created (not
  duplicated on a second accept), and confirmed `GET /api/trips/:id/events` on it correctly
  returns the shared lunch event.
- **"Your Invites" banner now has a calmer fallback once nothing's pending.** The modal
  already correctly listed every invited event regardless of status, but the banner was its
  only entry point and only rendered when something was still pending — so responding to
  your last invite made it disappear with no way back in. Now falls back to a non-urgent
  "N invites — view your invites" variant whenever `invitedEvents.length > 0`, even with
  nothing left to act on. A secondary safety net alongside the shadow-trip fix above, not a
  replacement for it.

## [0.0.35] - 2026-08-29
### Added
- **Pull-to-refresh on the Trips tab.** Live-suggested after an accepted event invite didn't
  appear without a full app restart: alongside the `useFocusEffect` fix below (which covers
  the common "returning to this tab" case), pull-to-refresh gives a manual escape hatch for
  everything else — staying on the tab while someone else accepts/adds something, or just
  wanting to force a resync. Re-runs the same invited-events/trip-events/nearby-friends
  refresh the focus effect does.

### Fixed
- **Homebase-sharing toggle silently never saved unless you also hit the separate "Save
  Changes" button.** Live-reported after testing: toggling "Share My Home City With" and
  assuming it was saved — matching how every toggle/switch elsewhere on a phone behaves — is
  exactly what happened, and the change silently never reached the server, since it was
  actually sitting behind the same batched-save button as every text field on the profile
  form. Now saves immediately on tap (`toggleHomebaseCircle` calls `updateUser` directly),
  matching the instant-save behavior the control already visually implies. The trip-sharing
  use of the same `CircleShareSelector` component (in the Create/Edit Trip form) is
  deliberately unchanged — fields there aren't "live" until the whole trip is submitted, a
  different context where batching behind one submit button is correct.
- **Accepting an event invite on another device didn't show up on the inviter's own trip
  without a full app restart.** Third occurrence of the same root cause as the friend-
  requests/nearby-friends fixes above: `refreshTripEvents` was still sitting in the old
  `[trips]`-only `useEffect`, so an invite accepted on the *other* person's device (which
  updates the Event doc server-side) was never picked up by returning to this tab, only by
  a `trips` array change or a full restart. Moved into the same `useFocusEffect` as the
  other two.
- **Friend requests (and event invites) only ever showed up if you happened to still have the
  app freshly opened when they arrived.** Live-reported during real two-phone testing: a
  friend request sent from another device didn't appear on the Circles tab until force-
  quitting and reopening the app. Root cause: both `social.tsx`'s incoming-friend-request
  poll and `trips.tsx`'s invited-events poll ran in a plain `useEffect` that only fires on
  first mount (or when specific deps change) — tab screens stay mounted in the background
  when you switch tabs, so neither ever re-polled just from navigating back to that tab.
  Force-quitting was the only thing that actually remounted the screen and triggered a fresh
  fetch. Both now use `useFocusEffect` (`@react-navigation/native`, already a dependency via
  expo-router, previously unused anywhere in this codebase) instead, so returning to either
  tab always re-polls.
- **"Friends nearby" wouldn't reflect a contact enabling homebase-sharing without a full app
  restart.** Same root cause as the entry above, extended to `trips.tsx`'s
  `refreshNearbyFriends`: it was bundled into the same `[trips]`-only `useEffect`, so
  returning to a trip after a contact turned on "Share My Home City With" for a matching
  circle wouldn't pick it up — only creating/editing a trip (which changes the `trips` array
  reference) did. Moved into the same `useFocusEffect` as the invited-events poll. Separately
  live-verified (via direct `GET /api/friends-nearby` calls) that the underlying data/query
  logic was already correct — this was purely a client-side "when do we refetch" gap, not a
  server bug.

## [0.0.34] - 2026-08-28
### Changed
- **Vibe-picker "‹ Back" replaced with tap-anywhere-outside-a-circle.** Reported live: the
  small text link (floating above the stage's own top edge with a 12pt hit-slop) was "really
  badly placed, I almost missed it." Removed entirely — `VibePicker` now exposes a `goBack()`
  method via `forwardRef`/`useImperativeHandle`, and `app/onboarding.tsx` wraps the whole step
  (title, subtitle, and the picker itself) in a `Pressable` that calls it. Any tap that isn't
  claimed by a circle's own `Pressable` — the gaps between/around circles, or the title/
  subtitle text — now backs out of a drilled-in vibe; this relies on no special wiring beyond
  React Native's ordinary touch-responder resolution (the most specific view under a touch
  always claims it first), the same behavior `Circle`'s own Pressables already depend on.
  `goBack()` no-ops at the top level, so this is always safe to fire regardless of drill
  state. Not live-verified in a browser this round (the browser automation tooling was
  erroring at the CDP level, unrelated to this change) — `tsc`/tests are clean and the pattern
  is standard, but treat this as needing an on-device pass before considering it fully closed.

## [0.0.33] - 2026-08-27
### Added
- **Real friend-request flow for Circles**, replacing what used to be a purely one-sided
  system. Previously, adding someone as a contact was entirely unilateral (`POST
  /api/contacts`) and linking a pending invite to a real account required manually running
  `npm run link-contact <email>` from a terminal — there was no in-app consent step, and no
  way for both sides to end up filed under *different* circles automatically. New
  `FriendRequest` model + endpoints (`POST /api/friend-requests`, `GET /api/friend-requests/
  incoming`, `GET /api/friend-requests/sent`, `PUT /api/friend-requests/:id/respond`):
  sending a request requires the recipient to already have an Odys.ai account (looked up by
  email — the existing invite-by-email flow stays as the tool for someone who hasn't joined
  yet, unchanged); the sender picks their own circle for the recipient at send time, and the
  recipient independently picks their own circle for the sender at accept time — accepting
  creates both `Contact` documents in one transaction. Circles tab now shows a "Friend
  Requests" section with a count badge (in-app only — no push notification infra exists
  anywhere in this app, and building real push is a separate, much bigger lift: device
  tokens, `expo-notifications`, server-side push sending) and Accept/Decline actions, the
  Accept flow opening a circle picker for the recipient's own choice. New "Add Friend" mode
  alongside the existing "Invite by Email" in the "+" modal.
  Live-verified end-to-end against the real backend and MongoDB (not just unit tests): two
  throwaway accounts, a real request sent, accepted with deliberately different circle tags
  on each side, confirmed via direct DB query that both reciprocal `Contact` documents exist
  with the correct, independent `circle_tags` — exactly the "each side files the other under
  their own circle" case this was built for. Test data cleaned up afterward.

### Fixed
- **Switching vibes while drilled in required two taps on a nearly-invisible edge circle.**
  Reported live: after drilling into a vibe (e.g. Foodie), tapping one of the small dimmed
  sibling circles around the edge only silently selected it — the view stayed on Foodie, with
  no visible feedback beyond a faint highlight on a tiny circle, and switching to actually see
  that sibling's own sub-tags needed a second tap on that same small target. `VibePicker`
  (`components/ui/vibe-picker.tsx`) reused the top-level `handleTap` (select-then-drill-in-on-
  next-tap) for these edge circles too, but that two-step dance makes sense for the initial
  flat browsing grid, not for switching between vibes once already committed to "explore mode."
  New `handleEdgeSiblingTap` always selects (if needed) AND switches the drilled-in view to
  that sibling in one tap. Live-verified: tapping "Outdoors & Active" while drilled into Foodie
  now immediately pins Outdoors and shows its own sub-tags, no second tap needed.

## [0.0.32] - 2026-08-26
### Added
- **Real app icon.** Replaced the stock Expo template icon/splash/adaptive-icon assets (the
  blueprint-guide "A" logo, mistaken live for a leftover default) across `icon.png`,
  `splash-icon.png`, the three `android-icon-*.png` adaptive-icon layers, and `favicon.png`
  with an actual Odys.ai mark — a map-pin silhouette (blue gradient, `#60A5FA`→`#3B82F6`,
  matching the app's existing accent color) with a white center dot, on the app's own navy
  (`#0F172A`). No new dependencies — generated as flat PNGs, no vector/SVG asset introduced.
- **Profile picture picker** (`app/(tabs)/profile.tsx`): tap the avatar to take a photo or
  choose one from the library (`expo-image-picker`, `allowsEditing`/`aspect: [1,1]` square
  crop) and set it as your profile picture. No object storage exists anywhere in this stack
  (no S3/Cloudinary/multer — just MongoDB), so consistent with how `lib/weather.ts`/
  `lib/geocoding.ts` deliberately picked no-key providers instead of new infra, the picked
  photo is downscaled to 300x300 and JPEG-compressed at quality 0.5 client-side
  (`expo-image-manipulator`, params centralized in new `lib/avatar.ts`) and stored as a base64
  data URI directly in `avatarUrl` via the existing `updateUser` path — no new backend route,
  since `PUT /api/users/:id` already does `$set: req.body` against the `strict: false` `User`
  schema. A `lib/avatar.ts` size guard (200KB base64 ceiling) rejects outsized payloads before
  they'd ever reach the User document, which is returned on every login/profile sync.
  Live-verified end-to-end against the real backend: logged in, `PUT /api/users/:id` with a
  real base64 JPEG data URI, confirmed via a follow-up `GET` that it persists.
  Onboarding (`app/onboarding.tsx`) is untouched — out of scope, being redesigned separately.

### Fixed
- **Onboarding regressions found testing the local build on a real device.** Two bugs from
  the "Pick your vibe" redesign (see 0.0.31's changelog entry), both live-verified via a
  browser render of the actual app after fixing:
  - *Travel Pace lost its mockup wording.* The Essentials screen's pace picker had regressed
    to rendering the bare `Low`/`Medium`/`High` enum values with no accompanying description,
    unlike `docs/onboarding-redesign.md`'s mockups. Re-added a `PACE_OPTIONS` list pairing
    each value with its description ("plenty of downtime" / "a balanced day" / "pack it in")
    in `app/onboarding.tsx`; only the display text changed, `activity` still stores the plain
    enum value.
  - *Vibe picker: only the first circle rendered, the rest never appeared.* Root cause found
    via live DOM measurement in a browser render at a 1568px viewport:
    `components/ui/vibe-picker.tsx`'s `stage` style was `width: '100%'` with no cap, so every
    circle's percentage-based size scaled with the full container width — circles came out
    400-533px in diameter and the cluster's bottom edge landed around y=1317px, far past the
    viewport, so only the first (biggest, top-left) circle was ever visible on screen. Fixed
    with `maxWidth: 420, alignSelf: 'center'` on `stage`, capping the cluster to a sane
    phone-width size regardless of container width. Re-verified after the fix: all 8 circles
    render within the viewport, and both tap-to-select and tap-to-drill-in (parent pins,
    siblings dim, sub-tags appear) work as designed.

### Known issue
- **Swipe-refine deck feels slow.** Reported alongside the two bugs above. The standard fix —
  migrating `components/ui/swipe-deck.tsx` from `PanResponder`/`Animated` to
  `react-native-gesture-handler`'s `Gesture.Pan()` + `react-native-reanimated` — was
  attempted, but live browser testing showed it broke the ✓/✕ round buttons (deck stopped
  advancing, no errors thrown). Reverted rather than ship an unverified regression; the deck
  is back on the original, known-working `PanResponder` implementation. Needs a proper
  on-device pass to fix the perceived slowness without repeating this breakage.

### Added
- **Trip card hero photo.** Each trip card now shows a real photo of its destination city
  (`GET /api/places/city-photo`, new `hooks/useEvents.tsx#getCityPhoto`), reusing the same
  per-city `Place` cache/photo proxy every recommendation query already relies on rather than
  a dedicated Google call. Tiered selection, not just "highest-rated place with a photo": live-
  tested against Paris, a flat rating sort surfaced a 5-star spa as the "hero" image, so
  landmark-ish genres (Monuments, Viewpoints, Museums, Galleries, Parks) are tried first,
  falling through to any Activity, then anything with a photo, so a city with no landmark
  coverage yet still gets something rather than a blank card.
- **Tap-to-navigate directly on trip proposal cards.** `trips.tsx`'s inline `PlaceCard`
  (AI Schedule Proposals) now has its own address/Navigate row, same as the detail modal —
  previously getting directions required opening the card first, an extra tap that mattered
  most for a pick you'd already scheduled and just wanted directions to.

### Fixed
- **Slot proposals could look "scheduled" in a slot they were never actually scheduled in.**
  Picking a place for one slot (e.g. a morning activity) could make a *different* slot on the
  same day (e.g. the evening activity) collapse down to show the same place as "✓ Scheduled"
  too — reported as "looks like it's pointing to the same thing in the DB." It wasn't: the
  trip's `Event` collection only ever had the one document. The bug was
  `trips.tsx`'s slot-collapse check (`isPlaceScheduled`), which matched by `place_id` alone
  across the whole trip rather than against the specific slot's own time window — and the
  recommendation engine can legitimately suggest the same well-known place as a candidate for
  more than one slot in a day. New `isPlaceScheduledInSlot` scopes the check to the proposal's
  own start/end time; the trip-wide `isPlaceScheduled` is kept as-is for the card's "✓
  Scheduled" badge, which is intentionally not slot-scoped (see its own comment).
- **Selecting a suggestion could crash with "CALENDAR permission is required."**
  `app/recommendation.tsx`'s `handleSelectPlace` called `Calendar.getCalendarsAsync` directly
  without ever requesting permission first — every other calendar touchpoint in the app
  (`lib/calendar.ts`, the Home tab) requests permission before touching the device calendar.
  On a fresh install with no prior grant this threw straight into the error alert. Now requests
  permission first and falls back to the non-device-calendar "Scheduled!" confirmation if
  denied, instead of erroring.
- **A florist could be suggested as an "Activity."** Traced via a live Google Places lookup:
  Google tags ordinary specialty retail (a flower shop, in the reported case) with the generic
  `market` type alongside `florist`/`store`, and the "Local Markets" activity mapping
  (`lib/google-places-types.ts`) included bare `market` as a trigger — far broader than the
  "farmers market / flea market" sense intended. Removed `market` from that mapping (kept
  `farmers_market`/`flea_market`); the already-cached stale DB record for the reported florist
  was deleted directly.
- **Modal "Cancel" button nearly unreachable behind the status bar.** Two custom
  transparent/fade bottom-sheet modals (`trips.tsx`'s place-detail sheet, `social.tsx`'s "Move
  Contact" sheet) had no height cap and no scroll container, so sufficiently long content (a
  photo, description, address row, schedule form, and invite list, in the reported case) grew
  the whole sheet until its header — and the Cancel button in it — got pushed up behind the
  status bar. Every other modal in the app uses the native `pageSheet` presentation style,
  which doesn't have this failure mode; these two custom sheets were the only ones affected.
  Both now cap at `maxHeight: '88%'` with the body wrapped in a `ScrollView` (header/Cancel
  pinned outside it), so the button stays reachable regardless of content length.
- **A newly-scheduled place could be invisible in its own AI Schedule Proposals slot.**
  Reported live: adding a lunch via "Looking for something else?" (refine search) left the
  "Lunch" slot still showing "No places fit this slot yet," even though the place was really
  scheduled — confirmed via the DB that only one `Event` existed, so this wasn't a duplicate-
  record issue like the earlier slot-collapse bug. Root cause: `slotRecommendations` for a slot
  is only ever populated by that slot's own original query; refine search queries
  independently and can pick a time the original query never saw, and the render logic checked
  `slotRecs.length === 0` before ever checking whether something was already scheduled there —
  so an empty original result always won, regardless. Two-part fix: `handleAddToItinerary` now
  merges a newly-scheduled place directly into every slot its time window overlaps (immediate,
  same-session fix), and a new fallback effect covers the same case durably (e.g. after an app
  restart, when the same in-memory merge is gone) by fetching any scheduled place missing from
  its slot's results via a new `GET /api/places/:id` — added carefully AFTER the existing
  literal `/api/places/city-photo` route, since Express matches routes in registration order
  and this single-segment `:id` wildcard would otherwise have shadowed it.
- **"Looking for something else?" showed every taxonomy tag regardless of what the slot could
  actually return.** Reported live against a Paris trip: refining a restaurant search showed
  Activity/Event tags like "Walking Tours" right alongside Food ones like "Japanese" — options
  that slot could never surface, since a meal-window slot only ever queries Restaurant places
  server-side (`buildCategoryFilter` in `lib/place-matching.ts`). `REFINE_TAG_GROUPS` combined
  all three taxonomies unconditionally, with no notion of which kind of slot opened it. Split
  into `REFINE_TAG_GROUPS_MEAL` (Food only) and `REFINE_TAG_GROUPS_NON_MEAL` (Activity + Event),
  threaded a `mealWindow` flag from the originating proposal's `type` through
  `RefineSearchCard` → `openRefineSearch` → `refineSearchContext`, and picked the matching group
  at render — the same meal/non-meal dichotomy the server-side filter already uses, just
  applied to which tags are even offered.
- **Modal "Cancel"/header still too close to the status bar after yesterday's fix.** The
  `maxHeight`+`ScrollView` fix (see the entry above under [0.0.31]) capped the sheet's overall
  height but left the header flush against its own top edge, which could still land close to
  the status bar on a real device once content pushed the sheet near its cap. Both
  `trips.tsx`'s `darkActionSheet` and `social.tsx`'s `actionSheet` now use an explicit
  `paddingTop: 36` (vs. 24 on every other side) and a lower `maxHeight: '82%'` (down from 88%),
  giving the header more breathing room from the top regardless of content length.

## [0.0.31] - 2026-08-24
### Added
- **Distance, address, tap-to-navigate, and photo thumbnails on recommendation cards.**
  Every card render site (`trips.tsx`'s `PlaceCard`, the joint/blind-matching "propose" flow,
  "Refine Your Search" results, and `recommendation.tsx`) now shows real distance (already
  computed server-side via `$geoNear`, just not always rendered) and, for `source: 'google'`
  places, a real street address and a small photo thumbnail.
  - `lib/google-places-client.ts`'s field masks now request `formattedAddress` and `photos`;
    `Place.address`/`Place.photoRef` (`models/Place.ts`) persist them.
  - New `GET /api/places/:id/photo` server-side proxy: exchanges a place's Google photo
    resource name for real image bytes via Places API (New)'s Photo Media endpoint, with
    `GOOGLE_PLACES_API_KEY` attached only on that server-side call — the key never reaches the
    client, and `photoRef` itself is stripped from every recommendation response (collapsed to
    a `hasPhoto` boolean) before it crosses the wire.
  - New `lib/maps-link.ts` (`buildMapsUrl`, unit-tested) builds a Google Maps universal-link
    directions URL — coordinates when available, else a "name, address"/"name, city" text
    query — opened via `Linking.openURL`. Wired into `trips.tsx`'s `selectedPlace` detail modal
    (the single funnel every card tap already goes through) and directly into
    `recommendation.tsx`'s cards.

## [0.0.30] - 2026-08-24
### Added
- **Live, anchor-centered nearby search, with a population-sized "near me" radius, replacing
  the flat 5km cutoff.** Surfaced by a real case: a hotel with genuine walking-distance
  restaurant coverage (confirmed via a direct Places API probe: real restaurants 30-150m away)
  that never showed up, because the existing Google integration
  (`fetchGooglePlacesForCity`) is a *city-wide* text search ("restaurants in Paris") with no
  location bias, and `ensurePlacesForCity` only tops up a city once its *total* place count
  drops below 5 — both blind to a specific address being under-covered while the city overall
  looks fine.
  - New `searchNearbyPlaces()` (`lib/google-places-client.ts`) — Places API (New) Nearby
    Search, `rankPreference: 'DISTANCE'`, capped to the 10 closest, category-scoped via
    `includedTypes` (new `getPlaceTypesForCategory()` in `lib/google-places-types.ts`) rather
    than fetching broadly and discarding. Real distance computed via `haversineDistanceKm`
    instead of the old deterministic-hash placeholder used for the city-wide search.
  - New `resolveSearchRadiusKm(population, category)` (`lib/place-matching.ts`) — a flat
    radius means something different in a 10M-person metro than an 8,000-person town.
    Restaurant tiers: ≥100k pop. → 500m, 10k-100k → 2km, <10k → 5km. Activity tiers are wider
    at every level (2km/5km/25km) — live-tested and confirmed landmarks/points of interest are
    structurally sparser than restaurants (a 500m Activity search near the same dense-city
    hotel returned mostly spas and hotels, not real points of interest). Population comes from
    Open-Meteo's geocoder (`lib/geocoding.ts`'s `CityResult`, now carries `population` —
    already fetched by every city search this app does, previously discarded).
  - New `refreshNearbyPlacesLive()` (`lib/places-population.ts`) — fires on *every*
    recommendation request with a real anchor point (not gated on existing coverage, unlike
    `ensurePlacesForCity`), logs the live call's latency (`durationMs`) so a caching/skip-if-
    fresh decision later has real numbers behind it, and upserts results into `Place` keyed on
    a new sparse-unique `googlePlaceId` field (`models/Place.ts`) — idempotent on repeat
    queries near the same anchor (confirmed via a real repeat-request test: no duplicate
    documents), rather than either re-inserting forever or needing a separate cache layer yet.
    Upserting (vs. keeping results ephemeral) also means a live-fetched place flows through the
    exact same scoring/ranking pipeline (tag match, source bonus, tiered shuffle) as
    curated/generated content, with no parallel scoring logic to maintain.
  - Both recommendation endpoints (`server.ts`) now use the resolved radius for their existing
    `$geoNear`/static-fallback distance filter too, not just the live fetch — one definition of
    "near" per request. An explicit `maxDistanceKm` override (`recommendation.tsx`'s "Expand
    Search Radius") still wins over the population tier, and still triggers a live refresh at
    that radius. No `GOOGLE_PLACES_API_KEY` configured degrades to exactly today's static-DB
    behavior at the resolved radius, silently, no request failure — confirmed by testing the
    whole flow with no key present before the key was available.
  - Live-verified end-to-end against a real Paris hotel with a real key: the exact restaurants
    seen in a direct API probe (30-150m away) came back through the full recommendation
    pipeline, correctly tagged `source: 'google'`, ranked and tiered-shuffled alongside
    curated/generated results, in ~250ms for the live call within a ~750ms total request.

## [0.0.29] - 2026-08-23
### Changed
- **A scheduled slot no longer keeps showing its unpicked alternatives.** Once a proposal card
  is scheduled (its "✓ Scheduled" badge appears), the slot's other still-unscheduled cards were
  left cluttering the same row even though the choice was already made. `trips.tsx`'s "AI
  Schedule Proposals" row now collapses to just the scheduled card(s) plus "Looking for
  something else?" once one exists, so changing your mind is still one tap away without the
  noise. New shared `isPlaceScheduled()` helper (previously inlined only in `PlaceCard`) keeps
  both the badge and this collapse using the same definition of "scheduled".

## [0.0.28] - 2026-08-23
### Fixed
- **Selecting a hotel (or destination city) suggestion silently didn't take.** Reported as:
  type a hotel name, the dropdown finds it, tap it, but it's never reflected when the trip is
  saved. Traced end-to-end via the real API (`POST /api/trips` with a `source: 'hotel'`
  `baseLocations` entry persisted and round-tripped through `resolveAnchorForDate` correctly,
  preferring hotel over city) — the backend was never the problem. Root cause was purely
  client-side: the trip-creator modal's `ScrollView` (`app/(tabs)/trips.tsx`) never set
  `keyboardShouldPersistTaps`, so React Native's default (`"never"`) swallowed the *first* tap
  on a suggestion row to dismiss the keyboard instead of firing its `onPress` — the input's
  `onBlur` still fired and hid the dropdown, so the tap looked like it did something, but
  `newHotelSelected`/the destination coords were never actually set. Fixed by adding
  `keyboardShouldPersistTaps="handled"` to that ScrollView (covers both the hotel and
  destination-city dropdowns, which share it). Not live-verified on-device (no
  device/emulator available in this environment) — reasoned from the real, well-documented RN
  default-ScrollView-tap-swallowing behavior; worth a real on-device check next test pass.

## [0.0.27] - 2026-08-23
### Fixed
- **Critical: genuine restaurants leaked into non-meal "Free Time" activity slots.** Found by
  live-tracing a real Rome trip (`earliestLunchTime: "12:00"` → lunch window 12:00-14:00): a
  free-time slot starting exactly at 14:00 was correctly labeled "Free Time" by
  `labelFreeSlot`/`expandSlotForProposals` (`lib/free-time.ts`, overlap-based, half-open), but
  `isMealWindow` (`lib/place-matching.ts`) independently re-checked that same 14:00 instant
  with an *inclusive* `<=` end boundary and called it a lunch window anyway — the two boundary
  conventions disagreed on an instant sitting exactly on the line. That misfire then hit a
  second, worse bug: `buildCategoryFilter`'s "meal window but duration > 120min" branch
  returned **no category filter at all**, so any category — including a plain, non-cafe
  restaurant ("Trattoria Da Enzo") — could surface under a slot displayed as "Free Time".
  Fixed both: `isMealWindow`'s end boundary is now exclusive (half-open, matching
  `lib/free-time.ts`), and the long-meal-window fallback is now restaurant-only instead of
  unfiltered. Live-verified against the real trip: the same query now returns only
  Activities/Events/Cafes, no stray restaurants.
- **Cafe recommendations during free time read as a labeling bug.** A `Restaurant`/`Cafes`
  place is deliberately allowed during non-meal free time (a coffee stop is reasonable, not a
  meal) — but its badge showed the raw "Restaurant" category, reading as a mismatch. New
  `displayCategory()` (`lib/recommendations.ts`) shows "Cafe" instead, used everywhere a
  place's category badge renders (`trips.tsx`, `recommendation.tsx`).
### Added
- **Recommendations now anchor on the previous slot's activity, not just the trip's static
  hotel/city location.** Every free-time slot in a day was independently anchored on
  `Trip.baseLocations`, so a day's proposals had no geographic relationship to each other — a
  dinner suggestion could be clear across town from where the afternoon activity was, and for
  a trip with no hotel set at all (confirmed on the real Rome trip used to find this) fell back
  to the old generic, not-really-distance-aware `distanceKm` fallback entirely regardless of
  what else was scheduled that day. `trips.tsx`'s recommendation-fetch effect now fetches each
  day's slots sequentially instead of all-parallel, passing the previous slot's top pick as an
  explicit `anchorLat`/`anchorLng` override for the next slot's query (the first slot of the
  day still anchors on the trip location, as before). Required returning `location` from both
  recommendation endpoints' `$project` (previously dropped before the response). Live-verified:
  anchoring a dinner query on the Colosseum's real coordinates shifted results to genuinely
  nearby restaurants (real computed distances) instead of the generic unanchored pool.

## [0.0.26] - 2026-08-23
### Changed
- **Curated places now rank ahead of Google-sourced/generated ones**, per the roadmap note
  captured in `docs/ad-monetization.md` while reviewing the Rome trip build. Two-part fix in
  `lib/place-matching.ts`, deliberately not a single hard sort key (that would let a
  zero-tag-match curated place bury a genuinely great non-curated match):
  - `SOURCE_RANK_BONUS` — a small (<1) Mongo aggregation bonus (curated: +0.9, google: +0.4,
    generated: +0) added to `matchScore`/`jointScore` before the existing `$sort` in both
    recommendation endpoints (`server.ts`). Small enough to only break ties/near-ties, never
    enough to outrank a place with a real tag-match advantage — a curated place still can't
    leapfrog a google place with even one extra matching tag.
  - `tieredShuffle()` replaces `shuffled()` in both endpoints' response — the existing
    Fisher-Yates shuffle over the whole top-10 pool (0.0.24) was fully erasing source
    priority the moment a curated and a non-curated place landed in the same pool, exactly
    the interaction the roadmap note flagged. `tieredShuffle` buckets by `Place.source`
    (curated → google → generated, unknown sources fall to the lowest bucket) and shuffles
    only within each bucket, so curated places reliably display first while still varying
    order day-to-day within their own tier.
  - `source` added to both endpoints' `$project` (previously dropped before the response),
    since `tieredShuffle` needs it client-side.
  - Live-verified against the real backend/DB: a Paris query returned curated places first
    (including a matchScore-0 curated place ahead of a matchScore-1 generated one, confirming
    the tier takes display priority) with generated filler last, as intended.

## [0.0.25] - 2026-08-20
### Added
- **Real hotel/accommodation-level location precision for "near me" filtering.** "Paris is too
  wide" turned out to be structural, not a tuning problem: `Place.distanceKm` was a flat,
  static number per place — curated places had hand-typed values with no real coordinates at
  all, and Google-sourced places got a deterministic *hash* of the place's name mapped into a
  fixed range (`pseudoDistanceKm`), fabricated rather than measured. There was no real anchor
  point for "near" to be measured from anywhere in the app.
  - New `Trip.baseLocations: BaseLocation[]` (`models/Trip.ts`) — an array from day one even
    though today's UI only ever produces one entry (this app is 1 trip = 1 city today, may
    become 1 trip = N cities later; an array needs no migration when that day comes, a scalar
    field would). A free `source: 'city'` entry comes from the destination autocomplete's own
    geocoding (previously fetched and immediately discarded); an optional higher-precision
    `source: 'hotel'` entry comes from a new "Where are you staying? (optional)" field in the
    trip create/edit modal (`app/(tabs)/trips.tsx`), geocoded via new `lib/hotel-geocoding.ts`
    (Nominatim/OpenStreetMap — free, no API key, consistent with this app's existing no-key
    provider choices; not gated behind the optional `GOOGLE_PLACES_API_KEY`).
  - `Place.location` (a GeoJSON point reserved on the schema for exactly this since early in
    the project but never wired up) is now actually populated: real coordinates straight from
    Google Places API responses for `source: 'google'` places (one field-mask addition), a
    one-time Nominatim backfill (`scripts/backfill-curated-place-coords.ts`) for the 60
    existing curated places (49 successfully geocoded — the rest are generic
    tour/market names with no exact venue match, gracefully left to the fallback path), and a
    small random jitter around the request's city centroid for synthetic `generated` filler
    (no real venue to geocode) so distance filtering still behaves sensibly for thin-coverage
    cities.
  - New `buildGeoNearStage`/`resolveAnchorForDate` (`lib/place-matching.ts`) replace the static
    `distanceKm` filter with a real `$geoNear` aggregation stage (backed by a new 2dsphere
    index) whenever a trip has a usable anchor point; trips with none fall back to exactly
    today's static-field behavior, unchanged. Both recommendation endpoints
    (`POST /api/recommendations`, `POST /api/events/:id/recommendations`) resolve the anchor
    from the request's `tripId` (or an explicit `anchorLat`/`anchorLng` override — used by the
    Home tab's live device GPS, previously fetched for weather/reverse-geocoding and also
    discarded before now) before building the pipeline.
  - Fixed a real data-integrity bug hit while shipping this: Mongoose's array-path default
    (`[]`) meant every `Place.location` was silently materialized as invalid, empty-array
    GeoJSON on every document regardless of whether it was ever set — which breaks 2dsphere
    index creation outright. Fixed at the schema level (`coordinates: { default: undefined }`)
    plus a one-time cleanup of the ~122 already-affected documents.
  - Live-verified end-to-end against the real backend: geocoded a real Rome hotel, confirmed
    `Trip.baseLocations` persists, confirmed recommendation queries against that trip return
    genuine non-round-number computed distances (vs. the old hand-typed/hashed values) that
    correctly respect a tightened radius (a 1km cap correctly excluded a 1.07km-away place),
    and confirmed a trip with no anchor point still returns results via the unchanged fallback
    path. Also caught and fixed a real geocoding accuracy bug during the curated-places
    backfill: a generic name ("Appian Way Cycling Trail") resolved to a same-named street in
    Illinois, USA before a hard `viewbox`+`bounded` geographic constraint was added — worth
    noting since it's exactly the class of bug easy to ship silently with free-text geocoding.

## [0.0.24] - 2026-08-20
### Fixed
- **Critical: long mostly-free slots got mislabeled and queried with the wrong meal category.**
  `expandSlotForProposals` (`lib/free-time.ts`) previously only ever split a slot around the
  *dinner* window — a slot like 08:00-16:00 (only genuinely busy 16:00-17:00) got a single
  "Lunch Break" label purely because lunch was the window it overlapped *most*, but its raw
  start time (08:00) is nowhere near lunch. Since the recommendation query filters by category
  based on whether the queried instant itself falls in a meal window (`isMealWindow` /
  `buildCategoryFilter`), that mismatch meant a slot labeled "Lunch Break" actually queried at
  08:00 and came back with Activity/Event results instead of restaurants — live-verified as an
  actual reported bug, not a hypothetical. `expandSlotForProposals` now generalizes the split
  across both meal windows generically: it walks the slot chronologically and carves out an
  Activity chunk (capped 180min, labeled "Morning/Afternoon/Evening Activity" by time of day)
  before each meal window the slot meaningfully reaches, then a Lunch/Dinner chunk whose own
  start time genuinely sits inside that window — so a long slot spanning both lunch and dinner
  (e.g. a weekend "Full Day" slot) now correctly produces four proposals instead of silently
  only ever surfacing dinner. Live-verified against the real reported trip: the 08:00-16:00
  slot now splits into a "Morning Activity" proposal and a "Lunch" proposal that actually
  returns restaurant-only results.
- **Recommendations no longer always surface the identical top pick.** Every slot/day on a
  trip that shares a preference profile deterministically returned the same highest-scored
  place first, since the aggregation's `$sort`+`$limit: 10` was fully deterministic — visibly
  repetitive when several slots on the same day all show the same "New idea" card. New
  `shuffled()` (`lib/place-matching.ts`, Fisher-Yates) is applied to both recommendation
  endpoints' already-scored top-10 pool right before responding — varies which of the already-
  good matches surface first without ever letting a lower-scored place outrank a better one
  that fell outside that pool. Live-verified: repeated identical queries against the real
  backend now return different top-3 orderings.

## [0.0.23] - 2026-08-20
### Fixed
- **Profile: the "Earliest Dinner" preset pills wrapped their own time text mid-value**
  (e.g. "18:0" / "0" on two lines inside one cramped pill) — `OptionRow`'s pill container had
  no wrap, so 9 evenly-divided `flex: 1` pills in one row squeezed each one narrower than its
  own "HH:mm" text. `OptionRow` now takes an optional `wrap` prop (used for the Earliest
  Lunch/Dinner rows) that switches to content-sized pills flowing across multiple lines
  instead of forcing a single cramped row; unchanged for the short rows (Budget/Currency/Date
  Format) that already looked right as evenly-filled single-row pills.

## [0.0.22] - 2026-08-20
### Added
- **Meal-time preferences**: Profile now has "Earliest Lunch"/"Earliest Dinner" pickers
  (`app/(tabs)/profile.tsx`) — a user who never eats dinner before 8pm, or eats at 9-10pm
  Spanish-style, or 5:30-6pm Dutch-style, gets recommendations timed for them instead of one
  universal schedule. New `lib/place-matching.ts` `getMealWindows`/`parseHourString` are the
  single source of truth for the lunch/dinner windows (shifting each window's *start* by the
  preference, existing widths unchanged) — threaded through `isMealWindow` (both
  `POST /api/recommendations` and the joint `POST /api/events/:id/recommendations`, which uses
  the organizer's preference), and through `lib/free-time.ts`'s `getHardcodedFreeSlots`,
  `labelFreeSlot`, `expandSlotForProposals`, and `getTripDaySchedule` (which also widens the
  day-end bound passed to `calculateFreeTimeSlots` so a late-dinner preference doesn't get
  truncated by the old fixed 22:00 boundary before the split logic ever sees it, capped at
  23:30). New `User.preferences.earliestLunchTime`/`earliestDinnerTime` fields are explicitly
  declared in the schema (not left to `strict:false`) — undefined means today's exact
  defaults, so nobody's behavior changes until they set this. Live-verified against the real
  backend: shifting `earliestDinnerTime` to 21:00 correctly moved what counted as a dinner
  window for real recommendation queries.
- **Dismissible AI Schedule Proposal slots**: a "✕" on each slot (e.g. a calendar-derived
  midday gap while genuinely still at work) hides it; a "N hidden — tap to restore" line per
  day brings it back. New `Trip.dismissedSlots: string[]` (`models/Trip.ts`), new
  `POST`/`DELETE /api/trips/:tripId/dismissed-slots(/:slotKey)` endpoints, and a
  `toggleDismissedSlot` on `TripsContext` (`hooks/useTrips.tsx`) that patches only the
  affected trip's local state directly rather than routing through `setTrips`'s full
  create/update sync-diff (this is a server-authoritative toggle, not a user-edited trip
  field). Purely a display filter — manually adding something to a dismissed window via
  Propose/Refine is unaffected. Live-verified end-to-end against the real database (dismiss →
  persists → restore → clears).
- **Collapsible trip cards and "Current Schedule"** (`app/(tabs)/trips.tsx`, renamed from
  "Scheduled Sequence"): a frequent traveler with several trips on the list needed a way to
  shrink one down to just its header — tapping a trip's destination now collapses/expands the
  whole card. "Current Schedule" independently collapses to its first 2 entries by default
  with its own "Show all N" toggle, mirroring the existing day-schedule expander.

### Changed
- AI Schedule Proposals now caps each slot at 3 place cards instead of 4, to cut down on
  horizontal scrolling.

## [0.0.21] - 2026-08-20
### Fixed
- **Trip day-schedule now uses the real imported calendar instead of a hardcoded work-day
  guess.** `getTripDaySchedule` (`lib/free-time.ts`) previously always used
  `getHardcodedFreeSlots`'s fixed Mon–Fri 8:30–18:00-busy / 12:00–13:30-lunch / 18:00–22:00-
  evening assumption, completely ignoring the real imported calendar events already synced
  per trip (`Event` docs with `source: 'imported'`) — a known, deliberately-deferred gap from
  the calendar-import work (see 0.0.14). It now takes an optional `importedEvents` param: any
  day that actually has synced calendar data computes real gaps via the existing
  `calculateFreeTimeSlots`, correctly excluding times already spoken for (e.g. no longer
  suggesting a "Lunch Break" at noon if there's a real meeting then) and surfacing genuine
  free windows the fixed pattern would've missed entirely; a day with no synced data still
  falls back to the hardcoded pattern exactly as before. New `labelFreeSlot` classifies these
  real slots ('Lunch Break' / 'Evening' / 'Free Time') consistently with the hardcoded path's
  own labels. Live-verified against a real trip's actual synced calendar (a genuine day of
  meetings): free gaps now correctly appear around real meetings instead of a static pattern.
- **"Scheduled Sequence" no longer mislabels real meetings as "Proposed, picking a place
  together."** That timeline (`trips.tsx`) rendered every `Event` the same way regardless of
  `source` — an imported real meeting (never has a `place_name`, by design) fell into the
  same "unresolved, needs a place" branch as a genuine user-created event still awaiting a
  place. Imported events now render as plain read-only busy blocks (title + time only, red
  indicator matching the Home tab's existing busy-block convention); `source: 'created'`
  events are unaffected.
- **No feedback when a recommendation is actually added to the itinerary.** Verified directly
  against the database that "Add to Itinerary" was already committing correctly — the bug was
  purely a lack of UI feedback: no confirmation, and the exact same recommendation card stayed
  visually identical to an unscheduled one, reading as "nothing happened." Adding now shows a
  confirmation alert (naming the invited friend when one was picked), and any place already
  scheduled for the trip gets a "✓ Scheduled" badge on its card instead of the normal
  match-score badge.

### Added
- **Evening slots now propose both an activity and a dinner, not just one.** A free-time slot
  long enough to fit both (≥150min, with a real overlap of the dinner window) now expands into
  two labeled proposal rows — "🎭 Activity" then "🍽️ Dinner" — each independently queried
  against the existing recommendation engine (dinner's duration is capped at 120min so
  `buildCategoryFilter` in `lib/place-matching.ts` stays in its Restaurant-only branch rather
  than falling through to an unfiltered match). New `expandSlotForProposals`
  (`lib/free-time.ts`) is typed as an array of `{ type, ... }` rather than a hardcoded pair
  specifically so a future third suggestion (e.g. a post-dinner show, once a real
  ticketing/listings data source exists — see `lib/google-places-types.ts`'s documented
  venue-vs-schedule gap) can be added without restructuring callers; not built now, this is
  just the shape that leaves room for it. Also fixes an existing gap where weekend "Full Day"
  slots never surfaced dinner options at all (the single full-day slot's meal-window check
  only looked at its start time, which is always morning).


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

- **Onboarding redesign: "Pick your vibe" circle picker + capped swipe-refine deck.**
  Replaces `app/onboarding.tsx`'s old 6-step linear form (three repeated 15-chip grids for
  food/activity/event tastes) with the 4-screen flow from `docs/onboarding-redesign.md`: Home
  city (unchanged) → Pick your vibe → Anything else? → Essentials (dietary + pace combined).
  The vibe screen (`components/ui/vibe-picker.tsx`) renders 8 literal overlapping circles
  (`docs/circles-visual-language.md`'s motif, built from plain RN `View`s — no
  `react-native-svg`/Skia, per the current EAS build-quota constraint) — tapping an unselected
  circle seeds a curated, cross-taxonomy bundle of real leaf tags (new `VIBE_PRESETS` in
  `constants/preferences.ts`, reasoning documented per-vibe); tapping it again drills into its
  own tags as individually-toggleable sub-circles, generically at any depth
  (`lib/onboarding-taste.ts`). The refine screen (`components/ui/swipe-deck.tsx`) is a
  Tinder-style, hard-capped (10 cards), skippable deck drawn only from the taxonomy gap the
  vibes didn't cover. New `TASTE_DOMAINS` registry generalizes the three existing genre
  taxonomies so a future fourth one plugs into the swipe deck automatically. No new
  dependencies, no server/schema changes — reuses the existing `completeOnboarding()`
  persistence path.

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
