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
```

There is no test suite / test script configured in this repo.

The mobile app and the backend are two independent processes — `npm start` does not start the backend. For any feature that hits `/api/*`, run `npm run server` in a second terminal.

## Architecture

### Two separate runtimes, one repo

- **`app/`** — the Expo Router mobile app (React Native). File-based routing: each file under `app/` is a route.
- **`server.ts`** — a standalone Express server exposing a REST API, run via `npm run server`. It is not bundled into the app; it's a plain Node/tsx process using Mongoose against MongoDB (connection string from `MONGODB_URI` env var, see `lib/mongodb.ts` for the cached-connection-across-hot-reloads pattern).
- Mongoose schemas live in `models/` (`User`, `Trip`, `Contact`, `Event`). `Event` is defined but currently has no REST endpoints in `server.ts`. `User` uses `strict: false` to allow arbitrary preference keys.

### Routing / navigation structure

- `app/_layout.tsx` is the root layout. It wraps everything in `AuthProvider` and contains the auth-gated redirect logic in `InitialLayout`: unauthenticated users get bounced to `/login`, authenticated-but-not-onboarded users to `/onboarding`, and both groups get bounced to `/(tabs)` once both conditions are satisfied. This redirect runs on every change to `segments`/`user`/`hasCompletedOnboarding`.
- `app/(tabs)/` is the main tab group (`index` Home, `trips`, `social` "Circles", `profile`; `explore` is hidden via `href: null`).
- `app/login.tsx`, `app/onboarding.tsx` are top-level (non-tab) routes; `app/recommendation.tsx` is presented as a modal.

### Client state: offline-first with opportunistic sync

`hooks/useAuth.tsx` is the single state hub for the app (despite the name — it also owns `trips` and `contacts`, not just auth). Key pattern to preserve when touching this file:

- All state (`user`, `trips`, `contacts`, `hasCompletedOnboarding`) is persisted to `AsyncStorage` (`@user`, `@trips`, `@contacts`, `@hasCompletedOnboarding`) and reloaded on boot — the app is fully usable offline.
- Every mutator (`login`, `setTrips`, `setContacts`, `updatePreferences`, `updateUser`) writes to local state/AsyncStorage first, then best-effort syncs to the backend; network failures are caught and logged, never thrown to the UI.
- `setTrips`/`setContacts` diff the old array against the new array to decide which items to POST/PUT/DELETE against the API, then refetch to reconcile server-assigned IDs.
- Locally-generated IDs are prefixed (`mock_...` for offline users/trips, `c...` for the seeded mock contacts in `lib/contacts.ts`) specifically so sync code can detect "this isn't a real Mongo ObjectId yet" and skip API calls for it. Preserve this convention if you add new locally-created entities.
- The API base URL is auto-detected from Expo's `hostUri` (so it points at your dev machine's LAN IP automatically for physical-device testing) and falls back to `http://localhost:3000`. To point at a tunnel URL instead, set the `tunnelUrl` const at the top of `hooks/useAuth.tsx`.

### `lib/` — pure logic, decoupled from UI and network

- `lib/calendar.ts` — the free-time-slot algorithm (`calculateFreeTimeSlots`, `getTripDaySchedule`) used to figure out open windows in a user's day for recommendations; also wraps `expo-calendar` device access (`getDeviceEventsForToday`) with a mock-data fallback (`generateMockEventsForToday`).
- `lib/recommendations.ts` — mock place/activity/event recommendation "engine" (`MOCK_PLACES_DATABASE` + `getRecommendationsForSlot`/`getRecommendationsForTrip`), filters by city, time-of-day (meal windows vs. activity windows), duration fit, then scores against user preferences. Falls back to synthetic `dyn_*` entries when there's no data for a city.
- `lib/contacts.ts` — mock contacts + circle-tag ("Family and Friends", "Relatives", "Work") filtering used by the Circles tab.
- `lib/weather.ts` — Open-Meteo client (no API key required), WMO weather-code → description/emoji mapping.

These are all synchronous/pure (aside from the calendar and weather fetch calls) — safe to unit-test in isolation if a test setup is added later.

### Path alias

`@/*` maps to the repo root (see `tsconfig.json`), e.g. `@/hooks/useAuth`, `@/lib/calendar`.
