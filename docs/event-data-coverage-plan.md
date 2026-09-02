# Event listings and route-based Activity data — coverage plan

Not attempted this pass — research and a proposal only, same treatment as
`docs/data-encryption-plan.md`. Covers the two gaps documented directly in
`lib/google-places-types.ts`'s module comment and per-tag `note` fields:

1. **Event category, all 14 tags, `quality: 'broad'` or `'none'`** (Theater, Ballet, Opera,
   Concerts, Festivals, DJ Sets, Comedy Shows, Cinema, Magic Shows, Football, Basketball,
   Tennis, Exhibitions, Parades — `Markets` is the one genuine exception, see below): Google
   Places API (New) only returns venues, never scheduled happenings, so every Event tag except
   `Markets` degrades to "we found a venue that plausibly hosts this" with no showtime/fixture
   data at all.
2. **Five Activity tags, `quality: 'none'`** (Walking Tours, Boat Cruises, Bus Tours, Water
   Sports, Scenic Drives — `lib/google-places-types.ts:62-101`): these need route/product data,
   not point-of-interest data, which Places structurally doesn't provide.

Both gaps were already anticipated in `docs/monetization-strategy.md` (lines 42, 57, 74-83,
108-109, 156) as a future *paid affiliate integration* — Viator/GetYourGuide for tours and
activities, Ticketmaster/SeatGeek for ticketing — gated behind a monetization decision, not a
free-data-source gap to quietly patch. This doc checked that assumption seriously rather than
taking it on faith, per this project's actual track record of finding no-key wins where they
exist (`lib/weather.ts` → Open-Meteo, `lib/geocoding.ts` → Open-Meteo geocoding). Conclusion:
the assumption holds. No free, no-key, production-viable source closes either gap. Details below.

## Gap 1: Event ticketing/listings

### What was checked

| Provider | API key? | Free tier reality | Verdict |
|---|---|---|---|
| **Eventbrite** | Yes (OAuth) | Public cross-platform event **search** was removed Dec 2019 / fully shut off Feb 2020 (`GET /v3/events/search/` deprecated). What remains only fetches a *specific known* event/venue/org by ID — useless for "what's on in this city right now," which is what a recommendation feed needs. | Dead end — not just paid, structurally can't do city-wide discovery anymore. |
| **Ticketmaster Discovery API** | Yes | Free key exists (developer.ticketmaster.com), 5,000 calls/day, 5 req/sec. Reasonable coverage for major venues/arenas. | Real candidate, but **requires an API key and vendor sign-up** — same category as the ticketing/listings API the codebase already correctly identifies as out of scope (`lib/google-places-types.ts:17`), and is exactly the integration `docs/monetization-strategy.md` already plans as an affiliate deal, not a silent backend swap. |
| **SeatGeek** | Yes (`client_id`) | Free partner tier exists, already named as a target affiliate partner in `docs/monetization-strategy.md:75-77`. | Same category as Ticketmaster — a deliberate future integration, not a no-key drop-in. |
| **TheSportsDB** (checked specifically for Football/Basketball/Tennis fixtures) | Free test key exists (`key=3`) | Free tier is materially crippled for this use case: team-schedule lookups capped at 1 request, team search returns at most 1 result, no city/location-based search at all (venue search is by exact venue name only), and the newer v2 endpoints are premium-only. Can't answer "what sports fixtures are near this city this week" on the free tier — only "next home game for a team I already know the exact name of." | Not viable even as a narrow win for the three sports tags. |
| **StungEvents** (`docs.stungevents.com`) | No — public `GET /events`, `/search`, `/artists`, `/venues` work unauthenticated, 1,000 req/day/IP | Genuinely no-key and covers concerts/festivals/sports/cinema, which would map well onto this exact Event taxonomy. But: no independent track record found beyond its own docs and third-party API-listing sites (no press, no visible established user base, single-company operator per its own footer). No visibility into coverage depth per city, data freshness, or long-term availability — the kind of "is this vendor's uptime/data quality good enough to build a product feature on" call this task's own instructions say not to make unilaterally. | **Flagged, not implemented** — see recommendation below. |
| Wikidata / Wikipedia (SPARQL) | No | Has structured data for major *recurring* things (annual festivals, famous fixtures) but nothing for one-off/weekly listings — the exact "what's happening this specific week" need. Also not really queryable "near this city, this date range" without heavy SPARQL engineering for a payoff that's still incomplete. | Not viable as a general solution. |
| Meetup, Facebook Events | No (Meetup now requires a key too) | Facebook Events public API was discontinued years ago; Meetup's public unauthenticated search is also gone. | Dead ends. |

### Recommendation

No change to `lib/google-places-types.ts`'s `quality: 'broad'`/`'none'` classification or to
`lib/google-places-client.ts:133` (which already correctly skips Event-category fetches
entirely rather than pretending Places can answer this). The honest fix here is the one
already on the roadmap: a real ticketing/listings API integration (Ticketmaster Discovery API
is the strongest candidate — free-tier key, decent venue/fixture coverage, and already named
as a target affiliate partner in `docs/monetization-strategy.md`), scoped and owned as a
deliberate vendor decision, not slipped in as a "free data source" under this block.

**StungEvents is worth a second look by a human**, specifically because it's the one option
that's actually free/no-key and topically on-target — but only after someone spends 30 minutes
manually spot-checking its coverage for a few real Odys.ai destination cities (does it actually
return real, current concerts/festivals for e.g. Lisbon or Austin, or is it thin outside a few
major markets?) and reading its ToS for what "free" actually permits at product scale. That's a
product/vendor-trust judgment call, not a code change, so it's not implemented here.

## Gap 2: Route-based Activity tags (Walking Tours, Boat Cruises, Bus Tours, Water Sports, Scenic Drives)

### The structural blocker, confirmed against the actual schema

`models/Place.ts:29-30` and `:67-68` define `location` as a single GeoJSON `Point`
(`PlaceSchema.index({ location: '2dsphere' })` at `:84` — a point index). Every one of these
five tags is fundamentally a *route or bookable product*, not a point: a walking tour is a
path plus a schedule/guide, a boat cruise is a route plus a departure time, a scenic drive is a
road segment miles long. Even a perfect free data source for these wouldn't fit today's `Place`
schema without a real modeling change (a `LineString`/`MultiLineString` geometry type, plus
whatever a "tour product" needs beyond geometry — duration, operator, price, schedule). That's
a second, separate decision from "which data source," and out of scope for this doc.

### What was checked as a data source anyway

- **OpenStreetMap / Overpass API** (free, no key, generous rate limits): does have `route=*`
  relations (hiking/cycling/foot networks) and a `scenic=yes`/`tourism=scenic` tag for roads.
  Two real problems, not just theoretical ones:
  - **Coverage is confirmed sparse and inconsistent for exactly this kind of tag.** OSM's own
    documentation explicitly discourages `scenic=yes` outside roads that are independently
    "promoted as such in tourist literature" because scenicness "is not verifiable" — so
    coverage tracks which local mappers happened to add it, not which roads are actually
    scenic. Research on OSM tag completeness confirms mainstream tags (museums, roads) are
    reliably complete in the West, but niche/subjective tags like this are not.
  - **Product mismatch, not just data-quality:** a mapped `route=foot` walking path is a real
    trail, not a bookable/guided "Walking Tour" product a bleisure traveler could show up for.
    Same gap for `route=bicycle` vs. a guided Bus Tour, or a marked marina vs. a bookable Boat
    Cruise. OSM can tell you a path exists; it can't tell you there's a tour operator running
    trips on it, which is the actual content this app needs to recommend.
- **Strava/Visorando-style route APIs** — already named as the realistic future direction for
  the adjacent Cycling tag's `quality: 'broad'` gap (`lib/google-places-types.ts:75-77`'s note).
  Both require paid API access at any real usage volume; not a no-key option.
- **Viator/GetYourGuide** — both already the named target partners in
  `docs/monetization-strategy.md:57, 74-76` for exactly this content (bookable tours/activities).
  Both require partner/API agreements; neither is a no-key public API.

### Recommendation

No free, no-key source closes this gap either, and — separately from the data-source question —
the current `Place` schema's point-only geometry means even a paid source would need a schema
change first. Leave `quality: 'none'` as-is on all five tags; this stays sequenced behind the
same Viator/GetYourGuide affiliate decision `docs/monetization-strategy.md` already scopes, not
something this block should code around.

## What this doc is not

- Not a recommendation to integrate any paid API — that's a vendor/budget decision for a human,
  flagged here, not made here.
- Not a recommendation to build against StungEvents today — flagged as the one candidate worth
  a human spot-check, explicitly not implemented given its unverified track record.
- No code changes. `lib/google-places-types.ts`'s existing `quality`/`note` fields already state
  this gap accurately and don't need edits — this doc just documents the "did we check for a
  free option" work so the roadmap decision is grounded in real research, not assumption.
