import { DateTime } from 'luxon';
import type { CalendarEvent, SlotProposal } from './free-time';
import { DEVICE_TIMEZONE } from './timezones';
import { isMealWindow, getMealWindows, type MealTimePreferences } from './place-matching';
import { resolveAirportCity } from './iata-airports';

// Classifies an imported (device-calendar-synced) event into a travel-relevant signal —
// flight/ground-transit/lodging/dining — so the trip timeline and free-time algorithm can
// treat it as more than generic "busy" time. See docs/calendar-signal-detection-plan.md for
// the full design writeup (real Navan sample data, the two-tier rationale, Part B's
// scheduling integration). Deliberately pure/DB-free (no persistence, no `signal` field on
// the Event model) — computed on the fly from the event's own title/location every time it's
// needed, per the product owner's explicit instruction: storing a derived classification would
// need a migration/backfill for every already-imported Event doc, and there is no backup
// mechanism for the shared local MongoDB right now (a real incident happened last sprint from
// exactly a migration going wrong against live shared data). Computing this fresh each time is
// cheap — a handful of regex/heuristic checks per event — so there's no real cost to not
// storing it.

export type SignalSource = 'navan' | 'generic';

export type TravelSignal =
  | { kind: 'flight'; airline?: string; flightNumber?: string; from?: string; to?: string; confirmation?: string; source: SignalSource }
  | { kind: 'ground-transit'; direction: 'to' | 'from'; place?: string; source: SignalSource }
  | { kind: 'lodging'; place?: string; source: SignalSource }
  | { kind: 'dining'; confidence: 'high' | 'medium'; source: SignalSource };

// --- Tier 1: matchNavan ------------------------------------------------------------------
//
// Tight patterns tuned exactly to Navan's (formerly TripActions) own auto-generated calendar
// text — a known, fixed format from one vendor's software, not free text, so this can safely
// assume exact punctuation/field order and extract more than a generic matcher ever safely
// could. If Navan changes its export format, only this matcher's own tests need updating (see
// lib/calendar-signals.test.ts) — matchGeneric and any future provider-specific matcher are
// untouched.

// `Flight: TLS (TO7103) to ORY Confirmation O7Z5VR` — origin, flight number, destination, and
// confirmation code, exactly as Navan writes it.
const NAVAN_FLIGHT_RE = /^Flight:\s*(\w+)\s*\(([\w\d]+)\)\s*to\s*(\w+)\s*Confirmation\s+(\S+)/i;

// `Travel time to TLS airport` / `Travel time  from ORY airport` — tolerant of the real
// double-space typo seen in live Navan-synced data.
const NAVAN_TRANSIT_RE = /^Travel\s+time\s+(to|from)\s+(.+)/i;

// `Stay: <hotel>` — Navan's equivalent hotel-booking prefix. Not present in the sample data
// this doc was built from, but the same vendor/family, so worth a matcher from day one rather
// than bolting on later once a trip with a booked hotel actually surfaces the real format.
const NAVAN_STAY_RE = /^Stay:\s*(.+)/i;

function matchNavan(event: CalendarEvent): TravelSignal | null {
  const title = (event.title || '').trim();

  const flightMatch = title.match(NAVAN_FLIGHT_RE);
  if (flightMatch) {
    const [, from, flightNumber, to, confirmation] = flightMatch;
    return { kind: 'flight', from, flightNumber, to, confirmation, source: 'navan' };
  }

  const transitMatch = title.match(NAVAN_TRANSIT_RE);
  if (transitMatch) {
    const [, direction, place] = transitMatch;
    return { kind: 'ground-transit', direction: direction.toLowerCase() as 'to' | 'from', place: place.trim(), source: 'navan' };
  }

  const stayMatch = title.match(NAVAN_STAY_RE);
  if (stayMatch) {
    return { kind: 'lodging', place: stayMatch[1].trim(), source: 'navan' };
  }

  return null;
}

// Ordered pipeline, not one shared regex family — a provider's own calendar-text format is
// that vendor's implementation detail, not a standard, and different platforms (TripIt,
// Concur, Egencia, a bare airline confirmation email, Google's native flight detection) all
// phrase the same information differently and can each change independently. Append future
// provider-specific matchers here; matchGeneric (the fallback) stays untouched either way.
const PROVIDER_MATCHERS: Array<(event: CalendarEvent) => TravelSignal | null> = [matchNavan];

// --- Tier 2: matchGeneric ------------------------------------------------------------------
//
// Deliberately looser, for anything no provider-specific matcher claims — it doesn't know who
// produced the text, so it should never assume a rigid shape.

const FLIGHT_KEYWORD_RE = /\b(flight|vol|flug)\b/i;
// Bare airline-code + flight-number pattern, e.g. "AA1234", "UA 934".
const FLIGHT_CODE_RE = /\b([A-Z]{2})\s?(\d{2,4})\b/;
// A directional "to"/"→" between two things that look like airport codes (3 uppercase
// letters) or capitalized city/place names. Words that are themselves the flight keyword are
// excluded from the capture so "Flight to Paris" doesn't extract "Flight" as the origin.
const DIRECTIONAL_RE = /\b([A-Z]{3}|[A-Z][a-zA-Z]{2,})\s*(?:to|→)\s*([A-Z]{3}|[A-Z][a-zA-Z]{2,})\b/;

function isFlightKeywordWord(word: string): boolean {
  return /^(flight|vol|flug)s?$/i.test(word);
}

function matchFlightGeneric(event: CalendarEvent): TravelSignal | null {
  const title = (event.title || '').trim();
  const hasKeyword = FLIGHT_KEYWORD_RE.test(title);
  const codeMatch = title.match(FLIGHT_CODE_RE);
  if (!hasKeyword && !codeMatch) return null;

  const rawDirectionMatch = title.match(DIRECTIONAL_RE);
  const directionMatch = rawDirectionMatch && !isFlightKeywordWord(rawDirectionMatch[1]) && !isFlightKeywordWord(rawDirectionMatch[2])
    ? rawDirectionMatch
    : null;

  // Neither a code nor a clean direction extracted, only the bare keyword — still worth
  // flagging as "it's a flight, details uncertain" rather than falling through to generic
  // busy time (a partial parse beats no parse at all for a TripIt-/airline-email-sourced
  // flight event this codebase has never seen a real sample of).
  return {
    kind: 'flight',
    ...(codeMatch ? { flightNumber: `${codeMatch[1]}${codeMatch[2]}` } : {}),
    ...(directionMatch ? { from: directionMatch[1], to: directionMatch[2] } : {}),
    source: 'generic',
  };
}

const LODGING_KEYWORD_RE = /\b(hotel|check-in|check-out|resort|airbnb)\b/i;

function matchLodgingGeneric(event: CalendarEvent): TravelSignal | null {
  const title = event.title || '';
  const location = event.location || '';
  if (!LODGING_KEYWORD_RE.test(title) && !LODGING_KEYWORD_RE.test(location)) return null;
  return { kind: 'lodging', place: location.trim() || undefined, source: 'generic' };
}

const URL_RE = /^https?:\/\//i;
const VIDEO_CALL_DOMAIN_RE = /\b(zoom\.us|meet\.google\.com|teams\.microsoft\.com|webex\.com)\b/i;

function looksLikeVideoCallOrUrl(location: string): boolean {
  return URL_RE.test(location.trim()) || VIDEO_CALL_DOMAIN_RE.test(location);
}

// A street-number-shaped component anywhere in the string — "34 Rue Laffitte" or "75009
// Paris" both match. Presence (not position) is what matters: real addresses commonly have a
// venue name before the actual street address (e.g. "Morning, Laffitte, 34 Rue Laffitte,
// 75009 Paris, France" from the real sample data this heuristic was built against).
const STREET_NUMBER_RE = /\d{1,5}\s+[A-Za-zÀ-ÿ]/;

function looksLikeStreetAddress(location: string): boolean {
  return STREET_NUMBER_RE.test(location);
}

// The dining heuristic — deliberately NOT a title-keyword match (fragile across languages: a
// French "Pot de départ" or a German "Abendessen" carry no English "dinner" keyword at all).
// Instead: the event's own start time falls in a meal window (isMealWindow,
// lib/place-matching.ts — the single source of truth for what counts as a meal-time instant)
// AND it has a real-looking location (non-empty, not a bare video-call/URL link). That
// combination — real venue + meal-window timing — is a far more reliable "this is a meal"
// signal than title text, and it's provider-agnostic: no booking platform (Navan included)
// generates a calendar invite to a real restaurant, so there's no vendor-specific version of
// this rule to write — it stays in the generic tier permanently.
function matchDiningGeneric(event: CalendarEvent, timezone: string, mealPrefs: MealTimePreferences): TravelSignal | null {
  const location = (event.location || '').trim();
  if (!location || looksLikeVideoCallOrUrl(location)) return null;
  if (!isMealWindow(event.startTime, timezone, mealPrefs)) return null;
  return { kind: 'dining', confidence: looksLikeStreetAddress(location) ? 'high' : 'medium', source: 'generic' };
}

function matchGeneric(event: CalendarEvent, timezone: string, mealPrefs: MealTimePreferences): TravelSignal | null {
  return matchFlightGeneric(event) ?? matchLodgingGeneric(event) ?? matchDiningGeneric(event, timezone, mealPrefs);
}

/**
 * Classifies a single imported calendar event. Tries every provider-specific matcher first
 * (tightest/highest-confidence match wins), falling back to the deliberately looser generic
 * heuristics. Returns null for plain busy time — a meeting, a work call, PTO — exactly as
 * every event classifies today.
 *
 * `timezone`/`mealPrefs` are only used by the generic dining heuristic (to evaluate the
 * event's start time against the user's own meal windows) — same defaults as every other
 * lib/free-time.ts function so passing nothing preserves today's device-timezone/no-preference
 * behavior.
 */
export function classifyImportedEvent(
  event: CalendarEvent,
  timezone: string = DEVICE_TIMEZONE,
  mealPrefs: MealTimePreferences = {}
): TravelSignal | null {
  for (const matcher of PROVIDER_MATCHERS) {
    const result = matcher(event);
    if (result) return result;
  }
  return matchGeneric(event, timezone, mealPrefs);
}

// --- Scheduling integration: suppress a competing AI meal proposal -------------------------
//
// See docs/calendar-signal-detection-plan.md Part B item 2: a slot overlapping a real dining
// event should surface that event (app/(tabs)/trips.tsx's "Current Schedule" timeline), not
// compete with it via a separately-generated AI Lunch/Dinner proposal for the same window.
//
// This deliberately does NOT compare a `dining` event's time range against the specific
// meal proposal's own start/end — expandSlotForProposals (lib/free-time.ts) only ever carves
// a Lunch/Dinner proposal out of *free* time (calculateFreeTimeSlots has already excluded
// every imported event, dining ones included, as busy), so a proposal's own range can never
// literally overlap the event it's meant to be suppressed by — they're always adjacent, never
// overlapping, by construction. What actually needs comparing is which *generic* meal window
// (lunch or dinner — the fixed clock-time window from getMealWindows, lib/place-matching.ts)
// the dining event's own start falls into, matched against which meal window the proposal
// itself represents: any dining event touching that window at all means there's already a
// real plan for it, even if it leaves some genuinely free time on either side.

function mealWindowKind(instant: Date, timezone: string, mealPrefs: MealTimePreferences): 'lunch' | 'dinner' | null {
  const zoned = DateTime.fromJSDate(instant).setZone(timezone);
  const hour = zoned.hour + zoned.minute / 60;
  const { lunchStart, lunchEnd, dinnerStart, dinnerEnd } = getMealWindows(mealPrefs);
  if (hour >= lunchStart && hour < lunchEnd) return 'lunch';
  if (hour >= dinnerStart && hour < dinnerEnd) return 'dinner';
  return null;
}

/**
 * True when a `dining`-classified event among `dayEvents` (that day's imported events — see
 * DaySchedule.importedEvents, lib/free-time.ts's getTripDaySchedule) falls in the same generic
 * meal window (lunch or dinner) that `proposal` represents. Always false for a non-`meal`
 * proposal. Confidence level doesn't matter — either level means a real meal plan already
 * exists for that window.
 */
export function hasDiningConflict(
  proposal: SlotProposal,
  dayEvents: CalendarEvent[],
  timezone: string = DEVICE_TIMEZONE,
  mealPrefs: MealTimePreferences = {}
): boolean {
  if (proposal.type !== 'meal') return false;
  const proposalMealKind = mealWindowKind(proposal.startTime, timezone, mealPrefs);
  if (!proposalMealKind) return false; // shouldn't happen for a real 'meal' proposal, but fail safe
  return dayEvents.some(event => {
    const signal = classifyImportedEvent(event, timezone, mealPrefs);
    return signal?.kind === 'dining' && mealWindowKind(event.startTime, timezone, mealPrefs) === proposalMealKind;
  });
}

/**
 * Drops any `type: 'meal'` proposal whose meal window (lunch or dinner) already has a real
 * dining event on the calendar that day — there's nothing useful to suggest, the user already
 * has plans for that meal. Non-meal (`activity`) proposals, and the short free gap before a
 * dining event, are returned untouched: a slot's plain-activity classification today is
 * correct and shouldn't be relabeled or force-fit as a meal just because a meal happens to
 * follow it.
 */
export function filterDiningConflicts(
  proposals: SlotProposal[],
  dayEvents: CalendarEvent[],
  timezone: string = DEVICE_TIMEZONE,
  mealPrefs: MealTimePreferences = {}
): SlotProposal[] {
  if (dayEvents.length === 0) return proposals;
  return proposals.filter(p => !hasDiningConflict(p, dayEvents, timezone, mealPrefs));
}

// --- Proactive trip discovery: inferring a whole trip from flight/lodging signals ----------
//
// See docs/auto-trip-discovery-plan.md Part A for the full reasoning/edge-case catalogue.
// Deliberately kept in this pure/RN-decoupled file, not lib/calendar.ts — the actual device-
// calendar scan (which classifies every event via classifyImportedEvent above, then hands the
// flight/lodging hits here) lives in lib/calendar.ts's scanForUpcomingTripSignals, since only
// that file can touch expo-calendar. This function does no I/O and only ever deals with
// already-classified signals, so it's unit-testable in plain Node (see
// lib/calendar-signals.test.ts) exactly like everything else in this file.

// A classified signal paired with the raw CalendarEvent it came from — classifyImportedEvent
// only returns the signal itself, but trip inference also needs the event's own id (for
// dismissal-key stability, see Part D of the design doc) and start/end times (a flight signal
// carries no date info of its own; a lodging signal's dates ARE the underlying event's own
// start/end, per Part A).
export interface ClassifiedSignal {
  event: CalendarEvent;
  signal: TravelSignal;
}

export interface InferredTrip {
  // Best-guess display name for the create-trip form's destination field. For a flight-
  // anchored trip this is the IATA-resolved city ("Rome, Italy"); for a lodging-only trip
  // (Part A case 3) there's no airport to resolve, so this is the lodging signal's own raw
  // `place` text verbatim — good enough to prefill an editable field (Part C), not a promise
  // of a real, geocodable city string.
  destination: string;
  // Only present when `destination` came from a resolved airport code — a raw lodging `place`
  // string has no known lat/lng without an actual geocoding call, which this pure function
  // deliberately never makes.
  destinationCoords?: { lat: number; lng: number };
  startDate: Date;
  endDate: Date;
  // True when endDate came from the "arrival + 3 days" fallback (Part A case 2) rather than a
  // real return-flight/lodging-checkout signal — lets a caller flag it as extra-rough if it
  // wants to, though Part C's own framing is that every field here is editable regardless.
  endDateIsDefault: boolean;
  // Set whenever a lodging signal contributed to this trip (paired with a flight, or lodging-
  // only) — carries just enough for app/(tabs)/trips.tsx's newHotelSelected shape once a
  // caller adds real coordinates via lib/hotel-geocoding.ts (this function never geocodes).
  hotel?: { label: string };
  // The primary CalendarEvent.id this suggestion is keyed on for @dismissedTripSuggestions
  // (Part D) — the outbound flight's event for a flight-anchored trip, or the lodging event's
  // own id for a lodging-only trip.
  anchorEventId: string;
  // Every CalendarEvent.id that contributed to this suggestion (outbound + return + lodging,
  // where applicable) — a caller dismissing a suggestion may want to suppress re-surfacing
  // from any one of these signals individually, not just the anchor.
  sourceEventIds: string[];
}

// Tolerance either side when deciding whether a lodging signal "belongs" to a given flight (or
// flight pair) — real bookings rarely line up to the minute (e.g. a hotel checkout instant
// vs. a return flight's own scheduled departure), so a same-day-ish window is treated as a
// match rather than requiring exact alignment. Not researched against real booking-gap data —
// a first reasonable guess, same spirit as lib/free-time.ts's FLIGHT_BUFFER_MINUTES.
const LODGING_ASSOCIATION_BUFFER_MS = 24 * 60 * 60 * 1000;

// Part A case 2's fallback when an outbound flight has no return flight AND no lodging signal
// to derive a real checkout date from.
const DEFAULT_TRIP_LENGTH_DAYS = 3;

type FlightSignal = Extract<TravelSignal, { kind: 'flight' }>;
type LodgingSignal = Extract<TravelSignal, { kind: 'lodging' }>;

function normalizeAirportCode(code?: string): string | undefined {
  const trimmed = code?.trim().toUpperCase();
  return trimmed || undefined;
}

// True when two flight signals' own airport codes are exact reverses of each other (A→B and
// B→A) — the only pairing signal used; genuinely ambiguous cases (different city pairs, a
// connecting/multi-city itinerary) are deliberately left unpaired per Part A case 4, not
// guessed at.
function isReverseFlightPair(a: TravelSignal, b: TravelSignal): boolean {
  if (a.kind !== 'flight' || b.kind !== 'flight') return false;
  const aFrom = normalizeAirportCode(a.from), aTo = normalizeAirportCode(a.to);
  const bFrom = normalizeAirportCode(b.from), bTo = normalizeAirportCode(b.to);
  if (!aFrom || !aTo || !bFrom || !bTo) return false;
  return aFrom === bTo && aTo === bFrom;
}

// Finds the first not-yet-consumed lodging signal whose own [startTime, endTime] falls inside
// [windowStart, windowEnd] (with the buffer above applied on both sides), marks it consumed,
// and returns it — or undefined if nothing matches. Shared by the round-trip and standalone-
// flight builders below so both consult (and mutate) the same `consumedLodgingIdx` set, which
// is what actually prevents one lodging signal from being double-counted into two different
// trip suggestions.
function claimMatchingLodging(
  lodgings: ClassifiedSignal[],
  consumedLodgingIdx: Set<number>,
  windowStart: Date,
  windowEnd: Date
): ClassifiedSignal | undefined {
  const idx = lodgings.findIndex((l, i) =>
    !consumedLodgingIdx.has(i) &&
    l.event.startTime.getTime() >= windowStart.getTime() - LODGING_ASSOCIATION_BUFFER_MS &&
    l.event.endTime.getTime() <= windowEnd.getTime() + LODGING_ASSOCIATION_BUFFER_MS
  );
  if (idx === -1) return undefined;
  consumedLodgingIdx.add(idx);
  return lodgings[idx];
}

function lodgingHotelInfo(signal: TravelSignal): { label: string } | undefined {
  const place = (signal as LodgingSignal).place;
  return place ? { label: place } : undefined;
}

// Part A case 1 (+ a same-window lodging signal, if any): a matched outbound/return flight
// pair. Returns null when the outbound's arrival airport isn't in lib/iata-airports.ts's
// table — per Part A, an unresolvable airport means no auto-discovery for this trip, not a
// wrong guess, so this deliberately doesn't fall back to treating the pair as two standalone
// flights.
function buildRoundTripSuggestion(
  outbound: ClassifiedSignal,
  inbound: ClassifiedSignal,
  lodgings: ClassifiedSignal[],
  consumedLodgingIdx: Set<number>
): InferredTrip | null {
  const outboundSignal = outbound.signal as FlightSignal;
  const airport = resolveAirportCity(outboundSignal.to);
  if (!airport) return null;

  const startDate = outbound.event.endTime; // when they land
  let endDate = inbound.event.startTime; // when they leave the destination again
  const sourceEventIds = [outbound.event.id, inbound.event.id];

  // A lodging signal's own endTime is a cleaner checkout instant than the return flight's
  // departure time (Part A), so prefer it when one falls within this trip's window.
  const lodging = claimMatchingLodging(lodgings, consumedLodgingIdx, startDate, endDate);
  let hotel: { label: string } | undefined;
  if (lodging) {
    endDate = lodging.event.endTime;
    hotel = lodgingHotelInfo(lodging.signal);
    sourceEventIds.push(lodging.event.id);
  }

  return {
    destination: airport.city,
    destinationCoords: { lat: airport.latitude, lng: airport.longitude },
    startDate,
    endDate,
    endDateIsDefault: false,
    hotel,
    anchorEventId: outbound.event.id,
    sourceEventIds,
  };
}

// Part A case 2 (no matching return flight found) and, when no lodging signal follows it
// either, the fully-unpaired half of Part A case 4 (two flights that don't form a round trip —
// each unpaired leg's own arrival becomes its own independent candidate trip start, rather
// than forcing a single, possibly-wrong round-trip inference across them).
function buildStandaloneFlightSuggestion(
  flight: ClassifiedSignal,
  lodgings: ClassifiedSignal[],
  consumedLodgingIdx: Set<number>
): InferredTrip | null {
  const flightSignal = flight.signal as FlightSignal;
  const airport = resolveAirportCity(flightSignal.to);
  if (!airport) return null;

  const startDate = flight.event.endTime;
  const sourceEventIds = [flight.event.id];

  // No return flight to bound the window with, so look for a lodging signal starting any time
  // at/after arrival — checkout (whenever it is) becomes the end date.
  const lodging = claimMatchingLodging(
    lodgings, consumedLodgingIdx, startDate, new Date(8640000000000000) // effectively unbounded
  );

  if (lodging) {
    return {
      destination: airport.city,
      destinationCoords: { lat: airport.latitude, lng: airport.longitude },
      startDate,
      endDate: lodging.event.endTime,
      endDateIsDefault: false,
      hotel: lodgingHotelInfo(lodging.signal),
      anchorEventId: flight.event.id,
      sourceEventIds: [...sourceEventIds, lodging.event.id],
    };
  }

  return {
    destination: airport.city,
    destinationCoords: { lat: airport.latitude, lng: airport.longitude },
    startDate,
    endDate: new Date(startDate.getTime() + DEFAULT_TRIP_LENGTH_DAYS * 24 * 60 * 60 * 1000),
    endDateIsDefault: true,
    anchorEventId: flight.event.id,
    sourceEventIds,
  };
}

// Part A case 3: a lodging signal with no flight at all (driving, train, already-known
// transit) — still a perfectly good trip signal on its own, dates and (best-effort)
// destination coming entirely from the lodging event itself.
function buildLodgingOnlySuggestion(lodging: ClassifiedSignal): InferredTrip {
  const lodgingSignal = lodging.signal as LodgingSignal;
  const destination = lodgingSignal.place?.trim() || 'Unknown destination';
  return {
    destination,
    startDate: lodging.event.startTime,
    endDate: lodging.event.endTime,
    endDateIsDefault: false,
    hotel: lodgingHotelInfo(lodgingSignal),
    anchorEventId: lodging.event.id,
    sourceEventIds: [lodging.event.id],
  };
}

/**
 * Turns a batch of already-classified device-calendar signals (flight/lodging only — dining
 * and ground-transit carry no trip-shaping information) into zero or more trip suggestions.
 * Called by lib/calendar.ts's scanForUpcomingTripSignals against everything a scan window
 * turned up; kept pure/synchronous so it's directly unit-testable (lib/calendar-signals.test.ts)
 * without any RN/device-calendar dependency.
 *
 * Handles, per docs/auto-trip-discovery-plan.md Part A: an outbound+return flight pair (with
 * or without a lodging signal sharpening the end date), an outbound flight with a lodging
 * signal but no return flight, a lodging signal with no flight at all, and two flight signals
 * that don't form a sensible round trip (each becomes its own independent candidate rather
 * than a forced, possibly-wrong pairing). Every signal that can't resolve a real destination
 * (an airport code missing from lib/iata-airports.ts's table) is silently dropped, not guessed
 * at — per Part A, that's a deliberate coverage trade-off, not a bug.
 */
export function inferTripFromSignals(signals: ClassifiedSignal[]): InferredTrip[] {
  const flights = signals
    .filter(s => s.signal.kind === 'flight')
    .sort((a, b) => a.event.startTime.getTime() - b.event.startTime.getTime());
  const lodgings = signals.filter(s => s.signal.kind === 'lodging');

  const consumedFlightIdx = new Set<number>();
  const consumedLodgingIdx = new Set<number>();
  const trips: InferredTrip[] = [];

  // Pass 1: pair up round trips — earliest unconsumed outbound with the earliest unconsumed
  // reverse-matching return after it.
  for (let i = 0; i < flights.length; i++) {
    if (consumedFlightIdx.has(i)) continue;
    for (let j = i + 1; j < flights.length; j++) {
      if (consumedFlightIdx.has(j)) continue;
      if (isReverseFlightPair(flights[i].signal, flights[j].signal)) {
        consumedFlightIdx.add(i);
        consumedFlightIdx.add(j);
        const trip = buildRoundTripSuggestion(flights[i], flights[j], lodgings, consumedLodgingIdx);
        if (trip) trips.push(trip);
        break;
      }
    }
  }

  // Pass 2: every flight left over (no reverse-matching partner found) is treated
  // independently — Part A case 4.
  flights.forEach((flight, idx) => {
    if (consumedFlightIdx.has(idx)) return;
    const trip = buildStandaloneFlightSuggestion(flight, lodgings, consumedLodgingIdx);
    if (trip) trips.push(trip);
  });

  // Pass 3: any lodging signal not already claimed by a flight above stands on its own.
  lodgings.forEach((lodging, idx) => {
    if (consumedLodgingIdx.has(idx)) return;
    trips.push(buildLodgingOnlySuggestion(lodging));
  });

  return trips;
}
