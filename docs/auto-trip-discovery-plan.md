# Auto-discovering a trip from calendar signals

Not attempted this pass — algorithm design + visual proposal only. Triggered directly: now
that `classifyImportedEvent()` (`lib/calendar-signals.ts`) can recognize a flight/lodging
event in a synced calendar, the natural next step is using that recognition proactively —
notice an unplanned trip before the user manually creates one, and surface it for them to
confirm rather than fill out a form from scratch for a trip the app already has every detail
of.

## The gap, confirmed by reading the actual code

Every calendar-reading code path today is **reactive, not proactive** — it only ever looks at
a date range the user already told the app matters, for a trip that already exists:

- `getDeviceEventsForDateRange` (`lib/calendar.ts`) takes an explicit `startDate`/`endDate`
  and — deliberately, per its own comment — never prompts for permission, "since this sync is
  a background nicety triggered from viewing/creating a trip." It literally cannot discover a
  trip that doesn't exist yet, by design.
- `getDeviceEventsForToday` does request permission, but only ever scans *today*.
- `syncDeviceCalendarForTrip` (`app/(tabs)/trips.tsx:290-306`) is the only caller of the
  range-scoped function, and only runs `trips.forEach(...)` — i.e. once per *existing* Trip.

There is no code path anywhere that scans, say, the next 60 days of a calendar looking for an
untriaged flight/lodging signal with no matching Trip. Building one is the core of this
proposal.

## Part A — What a flight/lodging signal alone can and can't tell you

`classifyImportedEvent`'s `flight` signal (from `matchNavan`/`matchFlightGeneric`) carries
`from`/`to` (airport codes or loosely-captured place names) and the event's own
`startTime`/`endTime` (the flight's own duration, e.g. 10:40–12:05 — **not** the trip's
duration). Its `lodging` signal carries a `place` string and, importantly, the underlying
`CalendarEvent`'s own `startTime`/`endTime` — a "Stay: X" calendar entry is naturally a single
event spanning the whole booking, so **a lodging signal's own time range already is check-in/
check-out**, no separate date parsing needed. (There's no real `Stay:` sample in this
project's data yet to confirm Navan's exact format, but this holds regardless of vendor: it's
a property of how hotel bookings get auto-added to a calendar, not of Navan's text
specifically.)

A single **flight** signal only gives you one leg. Concretely:

- **Destination**: needs airport-code → city resolution. Neither `lib/geocoding.ts`
  (`searchCities`, name-based) nor `lib/hotel-geocoding.ts` (`searchHotelLocation`, also
  name-based) can resolve a bare 3-letter IATA code today — this is a real, new gap, not an
  oversight. Proposed: a small static `IATA_TO_CITY` lookup table in `lib/`, scoped
  pragmatically (the handful of major airports likely to actually appear, not a complete
  global IATA database) rather than a live geocoding call for a 3-letter code, which is
  fragile (ambiguous codes, multi-airport cities). Explicitly a coverage trade-off, not a
  hidden gap — an airport not in the table means no auto-discovery for that trip, not a wrong
  guess.
- **Start date**: the outbound flight's own `endTime` (when they land) is the natural trip
  start.
- **End date**: needs a **second, return** flight signal — same two airports, reversed
  direction, a later date — to close the loop. A lodging signal's own `endTime` is a cleaner
  source when one exists (it's already exactly the checkout instant); fall back to the return
  flight when it doesn't.

**Realistic cases to actually handle, not just the happy path:**

1. Outbound flight + return flight, no lodging signal at all (e.g. staying with family) → trip
   dates from the two flights, destination from arrival airport, no hotel `baseLocation`.
2. Outbound flight + lodging, no return flight yet (return not booked, or booked through a
   channel that doesn't calendar-sync) → suggest with an end date derived from the lodging
   signal's checkout if present, otherwise leave end date as a rough default (e.g. arrival + 3
   days) that the confirmation step (Part C) makes trivially editable rather than silently
   wrong.
3. Lodging signal with no flight at all (driving, train, already-known transit) → still a
   perfectly good trip signal on its own; destination and dates come entirely from the lodging
   event.
4. Two flight signals that don't form a sensible round trip (different city pairs, e.g. a
   connecting/multi-city itinerary) — genuinely ambiguous. Proposed: don't try to be clever
   here; treat each flight leg's own arrival as a candidate trip start independently rather
   than forcing a single round-trip inference that might be wrong. A multi-city trip is a
   real, unsolved harder case — flagged, not solved, below.

## Part B — Where this actually has to run

`lib/calendar-signals.ts` and `lib/free-time.ts` are deliberately pure/RN-decoupled per this
project's `lib/` convention; real device-calendar access only exists in `lib/calendar.ts`,
which is unavoidably React-Native-coupled (`expo-calendar`). A proactive scan is a **new
function in `lib/calendar.ts`** (e.g. `scanForUpcomingTripSignals(daysAhead = 60)`), not a
pure-lib addition — it needs to actually call `Calendar.getEventsAsync`, then run every
returned event through `classifyImportedEvent` and hand the flight/lodging hits to a new
pure inference function (that part *can* live in `lib/calendar-signals.ts`, kept
DB/RN-free).

**Permission story — a real trade-off, not a detail.** Today's on-demand functions are
deliberately unobtrusive: `getDeviceEventsForDateRange`'s own comment says it "deliberately
does NOT prompt for permission... since this sync is a background nicety." A proactive scan
inherently can't honor that — it has to ask for calendar access *before* the user has told the
app anything about a trip, which is a materially bigger, earlier ask than what exists today.
This needs to be presented as its own explicit opt-in (e.g. a Home-tab card inviting the user
to turn on trip auto-discovery, not a silent permission prompt on first app launch) — the
existing Home tab already has exactly this visual pattern to extend:
`app/(tabs)/index.tsx`'s `connectCalendarCard` (`handleConnectCalendar`) is already a blue-
bordered opt-in banner for calendar connection in general; auto-discovery is a natural,
consistent extension of that same card/flow rather than a separate ask.

**Trigger cadence**: app-foreground is the pragmatic choice — matches this app's existing
`AppState`-foreground-triggered patterns (`hooks/useMutationQueueFlush.ts`, and this sprint's
own friend-request-badge polling) rather than inventing a true background task (React
Native background execution for calendar scanning is a much bigger lift — a native background
task with OS-level scheduling — genuinely out of scope for a first pass, not just deferred for
convenience).

## Part C — Surfacing it: prefill the real create-trip flow, don't hand over a blank form

The suggestion card (Home tab, next to/below the existing weather/hero cards) shows the
inferred destination + dates plainly, with **Add this trip** / **Not this time** actions —
matching the "bubble it up... to acknowledge" framing directly. Accepting it should prefill
`app/(tabs)/trips.tsx`'s actual create-trip state (`newDestination`, `newDestinationCoords`,
`startDate`, `endDate`, and `newHotelSelected` when a lodging signal resolved one) and open
the same create-trip modal already wired to `handleSaveTrip` — the user still sees and can
edit every field before it's actually created (via the existing `setTrips` sync path), rather
than a trip silently appearing with no review step. This also means destination-name
resolution only has to be "good enough to prefill an editable field," not perfect — a wrong
or approximate city name is a one-tap fix in a form the user is already looking at, not a
silent error.

## Part D — Not re-suggesting the same trip forever

Once dismissed ("Not this time") or once a matching real trip already exists, the same
calendar signals shouldn't keep re-surfacing. This app's dismissal precedent
(`Trip.dismissedSlots`, `hooks/useTrips.tsx`'s `toggleDismissedSlot`) is server-persisted
*per-trip* — but a suggestion has no trip yet, so that mechanism doesn't fit directly.
Proposed: a new client-only AsyncStorage key (e.g. `@dismissedTripSuggestions`, a JSON array
of signal-identifying strings), following the exact same offline-first-local-storage
convention already used for `@user`/`@hasCompletedOnboarding`/`@authToken`
(`hooks/useAuth.tsx`) — no new backend endpoint needed for this, since the underlying source
of truth (the device calendar) is itself local. Key each suggestion by something stable across
re-scans — the underlying `CalendarEvent.id` (the device calendar's own event id) of whichever
signal anchored the suggestion is simpler and more robust than trying to hash inferred
destination+dates, which could shift slightly between scans as more signals arrive. Separately
— "already have a matching trip" needs a simple overlap check against existing `trips` state
(same rough destination + overlapping date range) before ever surfacing a suggestion, not just
relying on the user to dismiss a redundant one manually.

## Part E — Graphical proposal

Published mockup: https://claude.ai/code/artifact/bc001545-a8d9-4415-a575-2c3c14ed5761 — three
states side by side: today's Home tab with no discovery, the new suggestion card (extending
`connectCalendarCard`'s treatment), and the resulting prefilled create-trip form.

## Explicitly out of scope for this doc

- No code written — proposal only.
- The `IATA_TO_CITY` table's actual coverage list isn't drafted here — a real scoping pass
  (which airports actually matter for this user base) belongs to implementation, not design.
- Multi-city / multi-leg itineraries (case 4 in Part A) are flagged as a real hard case, not
  solved — this proposal only confidently handles a single-destination round trip (or a
  lodging-only trip).
- True OS-level background scanning (vs. app-foreground-triggered) is out of scope — flagged
  in Part B as a materially bigger lift, not bundled into this pass.
- Whether auto-discovery should be on by default (with an opt-out) vs. the opt-in banner
  proposed in Part B is a product call this doc makes a recommendation on (opt-in, given the
  permission-scope trade-off) but doesn't treat as fully settled.
