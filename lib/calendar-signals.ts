import { DateTime } from 'luxon';
import type { CalendarEvent, SlotProposal } from './free-time';
import { DEVICE_TIMEZONE } from './timezones';
import { isMealWindow, getMealWindows, type MealTimePreferences } from './place-matching';

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
