# Splitting `hooks/useAuth.tsx`

**Done.** All 5 steps below are complete: `hooks/useAuth.tsx` is 236 lines (identity/session
only), and `lib/api-client.ts`/`hooks/useContacts.tsx`/`hooks/useEvents.tsx`/
`hooks/useTrips.tsx` all exist, wired up exactly per the provider boundaries and nesting order
below, each carrying a "Step N of 5" comment pointing back at this doc. Corrected as part of a
code-cleanliness pass that found this doc (and `CHANGELOG.md`'s own prior entries) still
describing this as "deliberately deferred" — verified directly by reading each file rather
than trusting the stale status. Left in place, not deleted: the reasoning below (provider
boundaries, migration order, verification standard) is still useful context for anyone
touching these files, e.g. `hooks/useSyncedCollection.ts`, added afterward to de-duplicate
`useTrips.tsx`/`useContacts.tsx`'s shared sync logic on top of this same split.

The paragraph below is kept as-is (historical) — it described the plan's status before this
correction, not the plan's content:

> Not attempted this pass — deliberately deferred. `useAuth.tsx` is ~600 lines now (auth +
> trips + contacts + events + token plumbing) and is imported by 8 screens (`trips.tsx`,
> `social.tsx`, `profile.tsx`, `index.tsx`, `onboarding.tsx`, `login.tsx`, `app/_layout.tsx`,
> `recommendation.tsx`). A full split touches all of them, and this sandbox has no way to
> actually run the RN app (only `tsc`/`eslint` static checks) — attempting the whole thing
> in one pass with no live-app verification risks landing in a half-migrated state, which is
> worse than not starting. This plan is the safe path to do it properly, whenever it's picked
> up next.

## Proposed provider boundaries

1. **`lib/api-client.ts`** (new, not a provider) — the shared `apiFetch` helper, `API_URL`
   resolution, and token get/set. Every provider below needs authenticated requests; this
   is what lets them import a shared client instead of prop-drilling through `AuthProvider`
   or duplicating the fetch/token logic four times.
2. **`AuthProvider`/`useAuth()`** (stays, shrinks) — `user`, `login`, `logout`,
   `completeOnboarding`, `updatePreferences`, `updateUser`, `isReady`. The identity/session
   core everything else depends on.
3. **`ContactsProvider`/`useContacts()`** (new) — `contacts`, `setContacts`,
   `refreshContacts`.
4. **`EventsProvider`/`useEvents()`** (new) — `fetchTripEvents`, `fetchInvitedEvents`,
   `createEvent`, `updateEvent`, `respondToEvent`, `deleteEvent`, `getJointRecommendations`,
   `getRecommendations`.
5. **`TripsProvider`/`useTrips()`** (new) — `trips`, `setTrips`.

Nesting in `app/_layout.tsx`: `AuthProvider` must wrap the others (they all need the current
user to trigger their own syncs). Order among the other three doesn't matter functionally:

```
<AuthProvider><TripsProvider><ContactsProvider><EventsProvider>
  {children}
</EventsProvider></ContactsProvider></TripsProvider></AuthProvider>
```

## Migration order (lowest risk first — verify after each step before starting the next)

1. **Extract `lib/api-client.ts`** — pure decoupling, no provider split yet. `useAuth.tsx`
   imports from it instead of defining `apiFetch`/`API_URL`/token handling inline. Nothing
   about the public `useAuth()` API changes at this step — verify by confirming the app
   behaves identically (login, sync-on-boot) before touching anything else.
2. **Extract `ContactsProvider`**  — smallest, most self-contained; two consumers
   (`social.tsx`, `trips.tsx`). Update both to call `useContacts()` for contacts-related
   values, `useAuth()` for everything else. Verify: contact invite flow, circle
   reassignment, and the "Propose an Event" contact picker still work end to end against a
   real local database (login, invite, `npm run link-contact`, confirm the linked contact
   appears).
3. **Extract `EventsProvider`** — next most self-contained (all thin fetch wrappers, no
   complex local state). Sole consumer: `trips.tsx`. Verify: create/respond/delete event,
   joint recommendations, solo recommendations end to end.
4. **Extract `TripsProvider`** — last, since `trips` is also read by `index.tsx` (Home
   tab's active-trip city fallback) in addition to `trips.tsx` — one more file to update
   than the others. Verify: trip CRUD, and Home tab's fallback-city behavior when location
   permission is denied.
5. `AuthProvider` is now ~150–200 lines, just identity/session/onboarding.

## What stays shared

The auth token and `apiFetch` — every provider needs authenticated requests. That's the
reason step 1 (`lib/api-client.ts`) has to happen first and separately from the rest: get
the shared plumbing decoupled and verified before anything depends on it being split
correctly.

## Verification standard

Same rigor used throughout this session: `tsc --noEmit` + `eslint` after every step, plus a
real end-to-end pass against the local MongoDB (`npm run mongo start`) exercising whatever
that step's screens actually do — not just static checks. If a live RN simulator/device
becomes available, that should replace the curl-level API verification used here.
