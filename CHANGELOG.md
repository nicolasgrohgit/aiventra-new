# Changelog

All notable changes to Odys.ai are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are `0.0.x` while
this is still pre-release/beta.

## [Unreleased]
### Added
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
