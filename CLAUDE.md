# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Odys.ai — an Expo/React Native app (file-based routing via `expo-router`) with a companion Express + MongoDB backend for persistence. TypeScript throughout, strict mode enabled.

**Product vision:** targets "bleisure" travelers — people traveling for work who still want to experience the city they're in. Three pillars: navigating/discovering a city, finding activities that fit around a work schedule, and catching up with friends who are in or near that city. This is why the app combines trip planning, free-time-slot detection around the user's existing calendar (`lib/calendar.ts`), activity/place recommendations (`lib/recommendations.ts`), and a social graph with "circle" tags like "Family and Friends" / "Work" (`lib/contacts.ts`, the Circles tab) — these are one product, not bolted-together features. Favor features serving "what can I do in my free 90 minutes tonight, near my hotel, ideally with someone I know" over generic city-guide browsing.

## Commands

```bash
npm install              # install deps

npm start                # expo start — Metro dev server (also: npx expo start)
npm run android           # expo start --android
npm run ios               # expo start --ios
npm run web                # expo start --web

npm run server             # runs the Express/Mongoose API (server.ts) via tsx, on $PORT (default 3000)
bash scripts/expose-server.sh  # exposes the local :3000 backend via localtunnel, for testing on a physical device

npm run lint                # expo lint (flat ESLint config extending eslint-config-expo)
npm test                    # runs the test suite (Node's built-in test runner via `tsx --test`)
```

**Changelog**: this project keeps `CHANGELOG.md` up to date — add an entry (grouped under
`## [Unreleased]` for in-progress work, promoted to a dated `0.0.x` version once finished)
for every meaningful change, and bump the `version` field in both `package.json` and
`app.json` to match whenever a version is finalized. Versions are `0.0.x` while pre-release.

The mobile app and the backend are two independent processes — `npm start` does not start the backend. For any feature that hits `/api/*`, run `npm run server` in a second terminal.

## Architecture

### Two separate runtimes, one repo

- **`app/`** — the Expo Router mobile app (React Native). File-based routing: each file under `app/` is a route.
- **`server.ts`** — a standalone Express server exposing a REST API, run via `npm run server`. It is not bundled into the app; it's a plain Node/tsx process using Mongoose against MongoDB (connection string from `MONGODB_URI` env var, see `lib/mongodb.ts` for the cached-connection-across-hot-reloads pattern).
- Mongoose schemas live in `models/` (`User`, `Trip`, `Contact`, `Event`, `FriendRequest`, `Place`). `Event` has 8 REST endpoints in `server.ts` (create/list/import under `/api/trips/:tripId/events`, plus `/api/events/invited`, `/api/events/:id`, `/api/events/:id/respond`, `/api/events/:id/recommendations`). `User` uses `strict: false` to allow arbitrary preference keys.

### Routing / navigation structure

- `app/_layout.tsx` is the root layout. It wraps everything in `AuthProvider` and contains the auth-gated redirect logic in `InitialLayout`: unauthenticated users get bounced to `/login`, authenticated-but-not-onboarded users to `/onboarding`, and both groups get bounced to `/(tabs)` once both conditions are satisfied. This redirect runs on every change to `segments`/`user`/`hasCompletedOnboarding`.
- `app/(tabs)/` is the main tab group (`index` Home, `trips`, `social` "Circles", `profile`; `explore` is hidden via `href: null`).
- `app/login.tsx`, `app/onboarding.tsx` are top-level (non-tab) routes; `app/recommendation.tsx` is presented as a modal.

### Client state: offline-first with opportunistic sync

State used to live entirely in `hooks/useAuth.tsx`; it's since been split (see `docs/useauth-split-plan.md`, completed) into `hooks/useAuth.tsx` (identity/session only — `user`, `login`, `logout`, `completeOnboarding`, `updatePreferences`, `updateUser`, `isReady`), `hooks/useTrips.tsx` (`trips`, `setTrips`, `toggleDismissedSlot`), `hooks/useContacts.tsx` (`contacts`, `setContacts`, `refreshContacts`), and `hooks/useEvents.tsx` (thin stateless fetch wrappers for events/recommendations — not cached/offline-synced like trips and contacts). `lib/api-client.ts` holds the shared `apiFetch`/`API_URL`/auth-token plumbing every provider needs. `app/_layout.tsx` nests them `AuthProvider > TripsProvider > ContactsProvider > EventsProvider`.

`useTrips.tsx`/`useContacts.tsx` share their offline-sync engine via `hooks/useSyncedCollection.ts` (a config-driven hook, not a component) rather than each reimplementing it — key pattern to preserve when touching either file, or that hook:

- All state (`user` in `useAuth.tsx`; `trips`/`contacts` in their own providers; `hasCompletedOnboarding` in `useAuth.tsx`) is persisted to `AsyncStorage` (`@user`, `@trips`, `@contacts`, `@hasCompletedOnboarding`) and reloaded on boot — the app is fully usable offline.
- Every mutator (`login`, `setTrips`, `setContacts`, `updatePreferences`, `updateUser`) writes to local state/AsyncStorage first, then best-effort syncs to the backend; network failures are caught and logged, never thrown to the UI.
- `setTrips`/`setContacts` diff the old array against the new array (via `lib/entity-id.ts`'s `sameEntity`) to decide which items to POST/PUT/DELETE against the API, then refetch to reconcile server-assigned IDs. A failed PUT/DELETE is queued for retry (`lib/mutation-queue.ts`, flushed on app-foreground via `hooks/useMutationQueueFlush.ts` and at the start of the next sync); a failed POST/create is not — safely replaying a create needs a server-side idempotency key, not built yet.
- Locally-generated IDs are prefixed (`mock_...` for offline users/trips, `c...` for the seeded mock contacts in `lib/contacts.ts`, `pending_...` for an invite-flow-created contact placeholder) specifically so sync code can detect "this isn't a real Mongo ObjectId yet" and skip API calls for it. Preserve this convention if you add new locally-created entities.
- The API base URL is auto-detected from Expo's `hostUri` (so it points at your dev machine's LAN IP automatically for physical-device testing) and falls back to `http://localhost:3000`. To point at a tunnel URL instead, set the `tunnelUrl` const at the top of `hooks/useAuth.tsx`.

### `lib/` — pure logic, decoupled from UI and network

Recommendation scoring itself moved server-side a while back (see `POST /api/recommendations`/`POST /api/events/:id/recommendations` in `server.ts`, backed by `lib/place-matching.ts` against the real `Place` Mongo collection) — several files below are what's left client-side, plus the newer server-side scoring/population logic that also lives in `lib/` since it's equally UI/network-decoupled.

- `lib/calendar.ts` — the free-time-slot algorithm (`calculateFreeTimeSlots`, `getTripDaySchedule`) used to figure out open windows in a user's day for recommendations; also wraps `expo-calendar` device access (`getDeviceEventsForToday`) with a mock-data fallback (`generateMockEventsForToday`). Transitively imports `expo-calendar` → `react-native`, so (unlike everything else in this list) it can't be imported from a plain Node test — `lib/free-time.ts` exists specifically to hold the pure date/time math split out of this file so *that* part is still testable.
- `lib/free-time.ts` — the pure meal-window/date-time logic split out of `lib/calendar.ts` for testability (see `lib/free-time.test.ts`).
- `lib/recommendations.ts` — now just the shared `PlaceRecommendation` response shape and `displayCategory()` (a `Restaurant`/`Cafes` place displays as "Cafe"); the mock recommendation engine that used to live here is gone.
- `lib/place-matching.ts` — the server-side scoring/geo logic behind `/api/recommendations` (meal-window detection, tag matching, `$geoNear` stage building, anchor resolution, search-radius tiering by city population) — pure and testable without a database.
- `lib/places-population.ts` — synthetic fallback `Place` generation for a city with no curated/Google data yet, used at trip-creation time.
- `lib/google-places-client.ts` — real Google Places API (New) integration; inert (returns `[]`, no throw) until `GOOGLE_PLACES_API_KEY` is set, so `lib/places-population.ts`'s synthetic fallback takes over.
- `lib/google-places-types.ts` — the taxonomy-tag ↔ Google Places type mapping table used by the client above.
- `lib/contacts.ts` — mock contacts + circle-tag ("Family and Friends", "Relatives", "Work") filtering used by the Circles tab.
- `lib/weather.ts` — Open-Meteo client (no API key required), WMO weather-code → description/emoji mapping.
- `lib/geocoding.ts` — city search/validation via Open-Meteo's geocoding API, used to catch destination/homebase typos.
- `lib/hotel-geocoding.ts` — free-form address/venue geocoding (e.g. a hotel) via Nominatim/OpenStreetMap.
- `lib/api-client.ts` — the shared `apiFetch` wrapper, `API_URL` auto-detection, and auth-token get/set every `hooks/use*` provider builds on.
- `lib/mutation-queue.ts` — the persisted retry queue for a PUT/DELETE that failed mid-sync (see "Client state" above).
- `lib/entity-id.ts` — `sameEntity()`, the shared `id`/`_id` identity check used by the sync diffing in `hooks/useSyncedCollection.ts`.
- `lib/trip-types.ts` — shared trip/event types (`TripEvent`, `TripMock`, `TripBaseLocation`) and small display helpers (`formatDistanceLabel`, `placePhotoUri`) used by both `app/(tabs)/trips.tsx` and its extracted `components/trips/*` components.
- `lib/timezones.ts` — known-destination-city → IANA timezone lookup, so trip-planning math runs on the destination's clock.
- `lib/maps-link.ts` — builds the Google Maps universal link used by every tap-to-navigate action.
- `lib/onboarding-taste.ts` — the "Pick your vibe" circle-picker/swipe-refine state machine behind `app/onboarding.tsx`.
- `lib/avatar.ts` — profile-picture resize/compress-to-base64-data-URI logic (no object storage in this stack — see `models/User.ts`'s `avatar_url`).
- `lib/mongodb.ts` — the cached-connection-across-hot-reloads pattern for `server.ts`'s Mongoose connection.

All of the above (aside from `lib/calendar.ts`'s device-calendar path, and the fetch calls in `lib/weather.ts`/`lib/geocoding.ts`/`lib/hotel-geocoding.ts`/`lib/google-places-client.ts`) are synchronous/pure — unit-tested via `npm test` (Node's built-in test runner, `.test.ts` siblings). Note the `test` script runs with `--conditions=react-server`: `lib/mutation-queue.ts` (via `lib/api-client.ts` → `expo-constants` → `react-native`) is otherwise unimportable outside the RN/Expo build pipeline — see the comment at the top of `lib/mutation-queue.test.ts`.

### Path alias

`@/*` maps to the repo root (see `tsconfig.json`), e.g. `@/hooks/useAuth`, `@/lib/calendar`.
