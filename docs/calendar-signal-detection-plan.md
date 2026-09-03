# Detecting travel-critical signals in imported calendar events

Not attempted this pass — algorithm design + visual proposal only, per direct instruction.
Triggered by a live report: a real Paris trip (Sep 7) with a genuine synced device calendar
exposed two things the current pipeline is blind to — (1) flight/travel-time/lodging events
that should actively shape the day's schedule, not just subtract from it, and (2) a real
"dinner" already sitting on the calendar (a farewell dinner, "Pot de départ Nico," at a real
restaurant address) that the app never recognizes as a meal — it only sees "busy," then
separately (and confusingly) tries to conjure an AI dinner proposal out of the leftover
60-minute gap before it, which isn't dinner at all, just the window before leaving for dinner.

## What's actually in a real traveller's calendar, grounded in this trip's real data

Pulled via direct API call against the real Paris trip, not hypothetical:

```
09:40-10:40  Travel time to TLS airport         loc: Toulouse - Blagnac Airport (TLS)
10:40-12:05  Flight: TLS (TO7103) to ORY Confirmation O7Z5VR   loc: Toulouse - Blagnac Airport (TLS)
12:05-13:05  Travel time  from ORY airport       loc: Orly Airport (ORY)
12:00-13:00  manger                              loc: (none)
12:00-13:00  Local Marignac-Laspeyres Bistro     loc: Local Marignac-Laspeyres Bistro, Marignac-Laspeyres
19:00-21:00  Save The Date - Pot de depart Nico  loc: Morning, Laffitte, 34 Rue Laffitte, 75009 Paris, France
19:00-21:30  Cirque - Time Off                   loc: (none)
20:00-21:00  Claude Office Hours                 loc: (Zoom link)
```

This is a textbook TripIt/Google-Calendar-auto-detected travel day: a `Travel time to X`
event, a `Flight: ORIGIN (flight#) to DEST Confirmation CODE` event, and a matching
`Travel time from X` event, always adjacent and sharing the same airport-code location. The
`Stay:` pattern the same auto-detection produces for hotel bookings isn't present in this
particular trip's data, but it's the same family (see below) — designed for, not guessed from
nothing: it's the same well-known calendar-auto-add convention these `Flight:`/`Travel time`
entries already come from.

The dinner insight: `Save The Date - Pot de depart Nico` has a real street address
(`34 Rue Laffitte, 75009 Paris`) and sits in the dinner window — that combination (real venue
address + meal-window timing) is a far more reliable "this is a meal" signal than any title
keyword, and it's language-agnostic (works whether the title says "Dinner," "Pot de départ,"
or nothing meal-related at all). `Cirque - Time Off` and `Claude Office Hours` overlap the
same window with no address — realistic calendar noise (a generic PTO block, a work call
someone forgot to decline), not competing signals.

## Part A — Classifying an imported event

New `classifyImportedEvent(event: CalendarEvent): TravelSignal | null` in `lib/`, run once at
calendar-import time (`POST /api/trips/:tripId/events/import`, `server.ts`) or at read time
(cheap enough either way — a handful of regex/heuristic checks per event) and either stored on
the `Event` doc (`models/Event.ts`) as a new optional `signal` field, or computed on the fly by
`lib/free-time.ts`/`trips.tsx` wherever imported events are consumed. Storing it is probably
right: it's a classification of what the event *is*, not a request-scoped concern, and it lets
the timeline UI (Part C) render it without re-deriving the same regex match on every render.

```ts
type TravelSignal =
  | { kind: 'flight'; airline?: string; flightNumber?: string; from?: string; to?: string; confirmation?: string }
  | { kind: 'ground-transit'; direction: 'to' | 'from'; place?: string }   // "Travel time to/from X"
  | { kind: 'lodging'; place?: string }                                    // "Stay: X" / hotel keywords
  | { kind: 'dining'; confidence: 'high' | 'medium' };                     // see heuristic below
```

Pattern rules, each tried in order (first match wins — a `Flight:` title should never also
match the dining heuristic just because it happens to sit in a meal window during a long
layover, for instance):

1. **Flight** — `/^Flight:\s*(\w+)\s*\(([\w\d]+)\)\s*to\s*(\w+)/i` against the title, with a
   trailing `Confirmation\s+(\S+)` capture if present. Matches the real example
   (`Flight: TLS (TO7103) to ORY Confirmation O7Z5VR`) and the looser variants the same
   auto-add convention produces (not every airline confirmation formats identically — the
   regex should degrade gracefully to "it's a flight, direction unknown" rather than fail
   closed when the exact sub-pattern doesn't match, since even a partial parse is more useful
   than falling through to generic "busy").
2. **Ground transit** — `/^Travel\s+time\s+(to|from)\s+(.+)/i` (tolerant of the double-space
   typo already seen in real data — `Travel time  from ORY airport`). Direction and place both
   captured for Part C's grouping logic.
3. **Lodging** — `/^Stay:\s*(.+)/i` on the title, or (looser, since not every calendar tool
   uses that literal prefix) `/\b(hotel|check-in|check-out|resort|airbnb)\b/i` against title
   *or* location. Not present in this trip's sample data, but same family as the flight
   pattern and worth having from day one rather than bolting on later.
4. **Dining (the new insight)** — not a title-keyword match at all, deliberately, since that's
   fragile across languages and phrasing. Instead: the event's own time window overlaps
   `isMealWindow` (`lib/place-matching.ts`, already the single source of truth for what counts
   as a meal-time instant) **and** `location` is non-empty and doesn't look like a URL/video-
   call link (`/^https?:\/\//i` or a known video-call domain) or a bare generic phrase — i.e.,
   it reads like a real place (has a comma-separated address shape, or at minimum isn't just a
   Zoom/Meet URL). `confidence: 'high'` when the location has a street-number-shaped address
   component; `'medium'` when it's just a named place with no street address (covers `Local
   Marignac-Laspeyres Bistro` in the sample data — a real place, just less certain than a full
   address).

Everything else — `PSA - FCTO Dashboard update`, `Kick-Off PG & Semaine`, `RSET Meeting`,
`Claude Office Hours` — classifies as `null` (plain busy time), exactly as today.

## Part B — Feeding classification into the actual scheduling algorithm

Two integration points, both in `lib/free-time.ts`, both currently blind to any of this:

**1. Flights should bound the day, not just subtract from it.** `getTripDaySchedule` computes
every day's free time against a fixed `dayStartHour=8` and a `dayEndHour` derived only from
`getMealWindows`. An arrival-day flight landing at 12:05 doesn't just make 10:40–13:05 "busy"
— the traveller genuinely isn't in the city, isn't reachable for activities, and realistically
needs buffer time after landing (customs, baggage, the ride into town) before "free time"
starts meaning anything. Proposed: when a day's imported events include a `flight` signal,
compute that day's *effective* start (arrival day) or end (departure day) from the flight's
own time plus a fixed buffer (30–45 min is reasonable, not configurable initially — this is a
sensible-default problem, not a preference one), instead of the generic `dayStartHour`/
`dayEndHour`. A departure-day flight should similarly pull the effective day-end *earlier* by
the flight's boarding time minus buffer, not just treat the literal `Travel time to airport`
block as the only constraint (today's algorithm technically already excludes that block as
busy time, but nothing stops it from proposing an activity that starts 10 minutes before that
travel block begins, which is realistic-looking but not realistic).

**2. A slot overlapping a real dining event should surface that event, not compete with it.**
This directly answers the open question left in the previous roadmap entry on this exact
trip/day ("should a short slot touching a meal window still get a meal proposal?") — **no**,
not when a real dining-classified event already occupies that meal window. Concretely: before
`expandSlotForProposals` or the AI-proposal fetch effect (`trips.tsx`) generates a Lunch/Dinner
proposal for a day, check whether any of that day's imported events classify as `dining`
(any confidence) and overlap the relevant meal window. If yes: skip generating an AI meal
proposal for that window entirely (there's nothing useful to suggest — the user already has
dinner plans), and instead surface the real event itself (Part C). The adjoining short free
gap before it (18:00–19:00 in the real example) should NOT be relabeled or force-fit as a meal
slot either — it's genuinely just unstructured free time before an evening plan, and today's
actual classification of it as a plain `activity` slot was *correct*; only the refine-search
defaults bug (already logged separately) made it look broken. This changes the earlier
roadmap item's framing: the fix isn't "make short evening slots try harder to be a meal
proposal" — it's "don't hide the real meal that's already scheduled, and stop treating the
gap before it as if it might secretly be dinner too."

## Part C — Graphical proposal

See the published mockup: **https://claude.ai/code/artifact/48e7c5bc-41d6-4df4-8b26-8135927c8ee2**
("Journey Timeline"). Summary of what it shows for
this exact real day, using the app's actual palette (navy `#0F172A` background, `#1E293B`
cards, `#334155` borders, `#3B82F6` accent — pulled from `trips.tsx`'s own `StyleSheet`, not
invented):

- **A "Journey" card** grouping the `Travel time to` + `Flight` + `Travel time from` triple
  into one connected unit at the top of the arrival day — flight number, route, confirmation
  code, with the two ground-transit legs shown as small connected chips rather than three
  separate generic timeline rows. Communicates "you're not free until ~13:05," which today's
  timeline doesn't make legible at a glance even though the underlying busy-time math already
  (correctly) excludes that whole window.
- **The real "Pot de départ" dinner surfaced directly in the itinerary** — a distinctly-styled
  "From your calendar" card (not an AI proposal — visually differentiated, e.g. a small
  calendar-source badge instead of the "✓ Scheduled"/match-score badge a real `PlaceCard`
  carries), showing the event title, the real address, and a Navigate action (the address is
  real and useful here, same `handleNavigate`/`buildMapsUrl` plumbing every other card
  already uses — no reason to withhold it just because this card's data came from a synced
  calendar instead of `Place`).
- **The 18:00–19:00 gap shown as a plain, honestly-labeled "Free Time" slot** — not "Evening,"
  not attempting a meal proposal — with a small AI proposal or two if the destination has
  anything worth a quick hour, same as any other short activity gap today.

## Explicitly out of scope for this doc

- No code written — proposal only, per direct instruction.
- Exact buffer durations (flight landing/boarding buffers) are a first reasonable guess, not
  researched against real airport transit-time data — worth a sanity check before building.
- A `Stay:`/lodging event's relationship to the existing manually-entered
  `Trip.baseLocations` (`source: 'hotel'`) — auto-filling vs. cross-checking vs. just
  displaying alongside — is a product decision this doc deliberately leaves open rather than
  guessing.
