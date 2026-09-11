import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyImportedEvent, hasDiningConflict, filterDiningConflicts, inferTripFromSignals } from './calendar-signals';
import type { CalendarEvent } from './free-time';
import type { SlotProposal } from './free-time';
import type { ClassifiedSignal } from './calendar-signals';

const ZONE = 'Europe/Paris';

// A future Monday, so meal-window checks don't depend on "now".
const D = '2030-03-04';
const at = (hhmm: string) => new Date(`${D}T${hhmm}:00+01:00`);

function evt(title: string, start: string, end: string, location?: string): CalendarEvent {
  return { id: title, title, startTime: at(start), endTime: at(end), location };
}

describe('classifyImportedEvent — matchNavan (real sample data)', () => {
  // These are the exact real Navan-synced event titles pulled from the real Paris trip in
  // docs/calendar-signal-detection-plan.md — the whole point of the two-tier design is that
  // this matcher is tested against real vendor text, not guessed-at formats.

  test('classifies a Navan flight event', () => {
    const e = evt('Flight: TLS (TO7103) to ORY Confirmation O7Z5VR', '10:40', '12:05', 'Toulouse - Blagnac Airport (TLS)');
    const signal = classifyImportedEvent(e, ZONE);
    assert.deepEqual(signal, {
      kind: 'flight',
      from: 'TLS',
      flightNumber: 'TO7103',
      to: 'ORY',
      confirmation: 'O7Z5VR',
      source: 'navan',
    });
  });

  test('classifies a Navan "Travel time to" ground-transit event', () => {
    const e = evt('Travel time to TLS airport', '09:40', '10:40', 'Toulouse - Blagnac Airport (TLS)');
    const signal = classifyImportedEvent(e, ZONE);
    assert.deepEqual(signal, { kind: 'ground-transit', direction: 'to', place: 'TLS airport', source: 'navan' });
  });

  test('classifies a Navan "Travel time  from" ground-transit event, tolerant of the real double-space typo', () => {
    const e = evt('Travel time  from ORY airport', '12:05', '13:05', 'Orly Airport (ORY)');
    const signal = classifyImportedEvent(e, ZONE);
    assert.deepEqual(signal, { kind: 'ground-transit', direction: 'from', place: 'ORY airport', source: 'navan' });
  });

  test('classifies a Navan "Stay:" lodging event', () => {
    const e = evt('Stay: Hotel Concorde Opera Paris', '15:00', '15:30', '4 Rue Auber, 75009 Paris');
    const signal = classifyImportedEvent(e, ZONE);
    assert.deepEqual(signal, { kind: 'lodging', place: 'Hotel Concorde Opera Paris', source: 'navan' });
  });

  test('Navan tier is tried before the generic dining heuristic — a flight during a meal window still classifies as a flight', () => {
    // 12:05 lands inside the default lunch window, and the event has a real-looking location
    // — if matchGeneric ran first this would misclassify as dining.
    const e = evt('Flight: TLS (TO7103) to ORY Confirmation O7Z5VR', '10:40', '12:05', 'Toulouse - Blagnac Airport (TLS)');
    const signal = classifyImportedEvent(e, ZONE);
    assert.equal(signal?.kind, 'flight');
    assert.equal(signal?.source, 'navan');
  });
});

describe('classifyImportedEvent — matchGeneric dining heuristic (real sample data)', () => {
  test('a named-place-only location during a meal window classifies as dining, medium confidence', () => {
    // Real sample: "Local Marignac-Laspeyres Bistro" — a bare venue name, no street number.
    const e = evt('Local Marignac-Laspeyres Bistro', '12:00', '13:00', 'Local Marignac-Laspeyres Bistro, Marignac-Laspeyres');
    const signal = classifyImportedEvent(e, ZONE);
    assert.deepEqual(signal, { kind: 'dining', confidence: 'medium', source: 'generic' });
  });

  test('a real street address during a meal window classifies as dining, high confidence', () => {
    // Real sample: the farewell dinner, "Save The Date - Pot de depart Nico" — deliberately no
    // English "dinner" keyword in the title at all, since the dining heuristic is timing +
    // location, not a title-keyword match (language-agnostic on purpose).
    const e = evt('Save The Date - Pot de depart Nico', '19:00', '21:00', 'Morning, Laffitte, 34 Rue Laffitte, 75009 Paris, France');
    const signal = classifyImportedEvent(e, ZONE);
    assert.deepEqual(signal, { kind: 'dining', confidence: 'high', source: 'generic' });
  });

  test('a real address outside any meal window does not classify as dining', () => {
    const e = evt('Client walkthrough', '10:00', '10:30', '34 Rue Laffitte, 75009 Paris, France');
    assert.equal(classifyImportedEvent(e, ZONE), null);
  });

  test('a meal-window event with a Zoom link location does not classify as dining', () => {
    // Real sample: "Claude Office Hours" overlaps the dinner window with a Zoom link as its
    // "location" — realistic calendar noise (a work call), not a competing dining signal.
    const e = evt('Claude Office Hours', '20:00', '21:00', 'https://zoom.us/j/1234567890');
    assert.equal(classifyImportedEvent(e, ZONE), null);
  });

  test('a meal-window event with a bare https URL location does not classify as dining', () => {
    const e = evt('Team sync', '12:15', '12:45', 'https://meet.example.com/abc');
    assert.equal(classifyImportedEvent(e, ZONE), null);
  });

  test('a meal-window event with no location at all does not classify as dining', () => {
    // Real sample: "Cirque - Time Off" — a generic PTO block overlapping the dinner window,
    // no location.
    const e = evt('Cirque - Time Off', '19:00', '21:30', undefined);
    assert.equal(classifyImportedEvent(e, ZONE), null);
  });

  test('mealPrefs shift which instants count as a meal window for the dining heuristic', () => {
    const e = evt('Late Bistro', '21:00', '22:00', 'Le Petit Bistro, 12 Rue de la Paix, Paris');
    assert.equal(classifyImportedEvent(e, ZONE), null); // 21:00 is outside the default dinner window
    const signal = classifyImportedEvent(e, ZONE, { earliestDinnerTime: '20:30' });
    assert.equal(signal?.kind, 'dining');
  });
});

describe('classifyImportedEvent — matchGeneric flight/lodging heuristics', () => {
  test('a bare airline-code + flight-number pattern near a flight keyword classifies as a flight, lower-confidence generic parse', () => {
    const e = evt('Flight UA934 JFK to LHR', '18:00', '19:00', 'JFK Airport');
    const signal = classifyImportedEvent(e, ZONE);
    assert.equal(signal?.kind, 'flight');
    assert.equal(signal?.source, 'generic');
    assert.equal((signal as any).flightNumber, 'UA934');
    assert.equal((signal as any).from, 'JFK');
    assert.equal((signal as any).to, 'LHR');
  });

  test('a bare flight code with no keyword and no direction still partially classifies as a flight', () => {
    const e = evt('AA100', '08:00', '09:00', 'Terminal 4, JFK Airport');
    const signal = classifyImportedEvent(e, ZONE);
    assert.equal(signal?.kind, 'flight');
    assert.equal(signal?.source, 'generic');
    assert.equal((signal as any).flightNumber, 'AA100');
    assert.equal((signal as any).from, undefined);
  });

  test('a non-English flight keyword ("Vol") is recognized', () => {
    const e = evt('Vol Air France AF1234 Paris to Tokyo', '09:00', '10:00');
    const signal = classifyImportedEvent(e, ZONE);
    assert.equal(signal?.kind, 'flight');
    assert.equal((signal as any).flightNumber, 'AF1234');
  });

  test('a hotel-keyword title classifies as generic lodging', () => {
    const e = evt('Hotel check-in — Marriott Downtown', '15:00', '15:30', 'Marriott Downtown, 5th Ave');
    const signal = classifyImportedEvent(e, ZONE);
    assert.deepEqual(signal, { kind: 'lodging', place: 'Marriott Downtown, 5th Ave', source: 'generic' });
  });

  test('a hotel-keyword location (not title) also classifies as generic lodging', () => {
    const e = evt('Check-in', '15:00', '15:30', 'Hilton Paris Opera');
    const signal = classifyImportedEvent(e, ZONE);
    assert.equal(signal?.kind, 'lodging');
  });
});

describe('classifyImportedEvent — plain busy time (no signal)', () => {
  // Real sample data: none of these are travel-relevant, and shouldn't classify as anything.
  for (const title of ['PSA - FCTO Dashboard update', 'Kick-Off PG & Semaine', 'RSET Meeting']) {
    test(`"${title}" classifies as null`, () => {
      const e = evt(title, '10:00', '11:00');
      assert.equal(classifyImportedEvent(e, ZONE), null);
    });
  }

  test('a meeting with no location and outside any meal window classifies as null', () => {
    const e = evt('Weekly Standup', '09:00', '09:30');
    assert.equal(classifyImportedEvent(e, ZONE), null);
  });
});

describe('hasDiningConflict / filterDiningConflicts', () => {
  const dinnerEvent = evt('Save The Date - Pot de depart Nico', '19:00', '21:00', '34 Rue Laffitte, 75009 Paris, France');
  const busyMeeting = evt('Claude Office Hours', '20:00', '21:00', 'https://zoom.us/j/1234567890');

  const mealProposal: SlotProposal = {
    type: 'meal', label: 'Dinner', icon: '🍽️',
    startTime: at('18:30'), endTime: at('20:30'), durationMinutes: 120,
  };
  const overlappingActivityProposal: SlotProposal = {
    type: 'activity', label: 'Evening Activity', icon: '🎭',
    startTime: at('18:00'), endTime: at('19:30'), durationMinutes: 90,
  };
  const nonOverlappingMealProposal: SlotProposal = {
    type: 'meal', label: 'Lunch', icon: '🍽️',
    startTime: at('12:00'), endTime: at('13:00'), durationMinutes: 60,
  };

  test('a meal proposal overlapping a real dining event is a conflict', () => {
    assert.equal(hasDiningConflict(mealProposal, [dinnerEvent, busyMeeting], ZONE), true);
  });

  test('a meal proposal that does not overlap the dining event is not a conflict', () => {
    assert.equal(hasDiningConflict(nonOverlappingMealProposal, [dinnerEvent], ZONE), false);
  });

  test('filterDiningConflicts drops only the conflicting meal proposal, leaving an overlapping activity proposal untouched', () => {
    // overlappingActivityProposal (18:00-19:30) genuinely overlaps dinnerEvent's window
    // (19:00-21:00) — the plain-activity classification of the short gap right before a real
    // dining event is correct today and shouldn't be relabeled or dropped just because a meal
    // follows it (see docs/calendar-signal-detection-plan.md Part B item 2).
    const proposals = [overlappingActivityProposal, mealProposal, nonOverlappingMealProposal];
    const filtered = filterDiningConflicts(proposals, [dinnerEvent, busyMeeting], ZONE);
    assert.deepEqual(filtered, [overlappingActivityProposal, nonOverlappingMealProposal]);
  });

  test('filterDiningConflicts is a no-op when there are no imported events for the day', () => {
    const proposals = [mealProposal, nonOverlappingMealProposal];
    assert.deepEqual(filterDiningConflicts(proposals, [], ZONE), proposals);
  });

  test('filterDiningConflicts is a no-op when no imported event classifies as dining', () => {
    const proposals = [mealProposal];
    assert.deepEqual(filterDiningConflicts(proposals, [busyMeeting], ZONE), proposals);
  });

  test('a dining event still conflicts with a meal proposal that starts right where the event ends (no literal time overlap)', () => {
    // This is the realistic case, not an edge case: expandSlotForProposals only ever carves a
    // meal proposal out of genuinely FREE time, and calculateFreeTimeSlots has already
    // excluded every imported event (dining ones included) as busy — so a generated proposal's
    // own start/end can never literally overlap the dining event that ought to suppress it,
    // they're always adjacent at best. A short dinner reservation (19:00-19:20) leaves
    // 19:20-21:00 as real free time within the same dinner window (18:30-21:00) — a proposal
    // for that leftover time must still be suppressed, since the user already has dinner
    // plans that evening.
    const shortDinner = evt('Pot de depart', '19:00', '19:20', '34 Rue Laffitte, 75009 Paris, France');
    const leftoverDinnerProposal: SlotProposal = {
      type: 'meal', label: 'Dinner', icon: '🍽️',
      startTime: at('19:20'), endTime: at('21:00'), durationMinutes: 100,
    };
    assert.equal(hasDiningConflict(leftoverDinnerProposal, [shortDinner], ZONE), true);
    assert.deepEqual(filterDiningConflicts([leftoverDinnerProposal], [shortDinner], ZONE), []);
  });

  test('a dining event in a different meal window does not conflict', () => {
    // A lunch reservation shouldn't suppress an unrelated Dinner proposal the same day.
    const lunchDining = evt('Lunch with a client', '12:00', '13:00', '10 Rue de Rivoli, 75001 Paris, France');
    assert.equal(hasDiningConflict(mealProposal, [lunchDining], ZONE), false);
  });
});

describe('inferTripFromSignals — docs/auto-trip-discovery-plan.md Part A cases', () => {
  // Independent of the `evt`/`at`/D helpers above (all fixed to one day) — trip inference
  // needs signals spanning many real days, so these build CalendarEvents (and the
  // ClassifiedSignal wrapper) directly rather than reusing classifyImportedEvent, keeping each
  // test's dates/airport codes explicit and easy to read.
  let nextId = 0;
  function ce(startIso: string, endIso: string, location?: string): CalendarEvent {
    nextId += 1;
    return { id: `evt-${nextId}`, title: 'irrelevant', startTime: new Date(startIso), endTime: new Date(endIso), location };
  }
  function flight(from: string, to: string, startIso: string, endIso: string): ClassifiedSignal {
    const event = ce(startIso, endIso);
    return { event, signal: { kind: 'flight', from, to, source: 'generic' } };
  }
  function lodging(place: string, startIso: string, endIso: string): ClassifiedSignal {
    const event = ce(startIso, endIso);
    return { event, signal: { kind: 'lodging', place, source: 'generic' } };
  }
  function transit(direction: 'to' | 'from', startIso: string, endIso: string, place?: string): ClassifiedSignal {
    const event = ce(startIso, endIso);
    return { event, signal: { kind: 'ground-transit', direction, place, source: 'generic' } };
  }
  function dining(startIso: string, endIso: string, location: string): ClassifiedSignal {
    return { event: ce(startIso, endIso, location), signal: { kind: 'dining', confidence: 'high', source: 'generic' } };
  }

  test('case 1: outbound + return flight, no lodging — dates from the two flights, no hotel', () => {
    const outbound = flight('JFK', 'FCO', '2030-03-10T08:00:00Z', '2030-03-10T22:00:00Z');
    const inbound = flight('FCO', 'JFK', '2030-03-17T09:00:00Z', '2030-03-17T14:00:00Z');
    const [trip, ...rest] = inferTripFromSignals([inbound, outbound]); // order-independent

    assert.equal(rest.length, 0);
    assert.equal(trip.destination, 'Rome, Italy');
    assert.deepEqual(trip.destinationCoords, { lat: 41.8003, lng: 12.2389 });
    // Home-to-home, not just the destination-only window — see buildRoundTripSuggestion.
    assert.equal(trip.startDate.toISOString(), outbound.event.startTime.toISOString());
    assert.equal(trip.endDate.toISOString(), inbound.event.endTime.toISOString());
    assert.equal(trip.endDateIsDefault, false);
    assert.equal(trip.hotel, undefined);
    assert.equal(trip.anchorEventId, outbound.event.id);
    assert.deepEqual(trip.sourceEventIds, [outbound.event.id, inbound.event.id]);
  });

  test('case 1b: outbound + return flight, WITH a lodging signal in between — the lodging only contributes hotel metadata, the return flight\'s own arrival still wins for the end date', () => {
    const outbound = flight('JFK', 'FCO', '2030-03-10T08:00:00Z', '2030-03-10T22:00:00Z');
    const stay = lodging('Hotel Artemide', '2030-03-11T15:00:00Z', '2030-03-16T10:00:00Z');
    const inbound = flight('FCO', 'JFK', '2030-03-17T09:00:00Z', '2030-03-17T14:00:00Z');
    const trips = inferTripFromSignals([outbound, stay, inbound]);

    assert.equal(trips.length, 1);
    const [trip] = trips;
    assert.equal(trip.destination, 'Rome, Italy');
    assert.equal(trip.startDate.toISOString(), outbound.event.startTime.toISOString());
    assert.equal(trip.endDate.toISOString(), inbound.event.endTime.toISOString());
    assert.deepEqual(trip.hotel, { label: 'Hotel Artemide' });
    assert.deepEqual(trip.sourceEventIds, [outbound.event.id, inbound.event.id, stay.event.id]);
  });

  test('case 1c: a real "Travel time to/from airport" ground-transit signal next to each flight refines the leave-home/return-home instants further than the flights\' own boundaries', () => {
    const toAirport = transit('to', '2030-03-10T06:30:00Z', '2030-03-10T07:45:00Z');
    const outbound = flight('JFK', 'FCO', '2030-03-10T08:00:00Z', '2030-03-10T22:00:00Z');
    const inbound = flight('FCO', 'JFK', '2030-03-17T09:00:00Z', '2030-03-17T14:00:00Z');
    const fromAirport = transit('from', '2030-03-17T14:30:00Z', '2030-03-17T15:15:00Z');
    const trips = inferTripFromSignals([toAirport, outbound, inbound, fromAirport]);

    assert.equal(trips.length, 1);
    const [trip] = trips;
    // The transit's own startTime (left the house at 06:30) beats the flight's own departure
    // (08:00) as the "left home" instant; symmetrically the transit's own endTime (walked in
    // the door at 15:15) beats the flight's own landing (14:00) for "back home".
    assert.equal(trip.startDate.toISOString(), toAirport.event.startTime.toISOString());
    assert.equal(trip.endDate.toISOString(), fromAirport.event.endTime.toISOString());
    assert.deepEqual(trip.sourceEventIds, [outbound.event.id, inbound.event.id, toAirport.event.id, fromAirport.event.id]);
  });

  test('case 1d: a ground-transit signal far outside the flight\'s window is not trusted', () => {
    // A full day before the outbound flight — an unrelated errand near an airport, not this
    // trip's own "leaving home" instant.
    const toAirport = transit('to', '2030-03-09T06:30:00Z', '2030-03-09T07:45:00Z');
    const outbound = flight('JFK', 'FCO', '2030-03-10T08:00:00Z', '2030-03-10T22:00:00Z');
    const inbound = flight('FCO', 'JFK', '2030-03-17T09:00:00Z', '2030-03-17T14:00:00Z');
    const trips = inferTripFromSignals([toAirport, outbound, inbound]);

    assert.equal(trips.length, 1);
    assert.equal(trips[0].startDate.toISOString(), outbound.event.startTime.toISOString());
  });

  test('case 1e: a wrong-direction ground-transit signal near the flight is not trusted', () => {
    // A 'from'-direction signal sitting right before departure (e.g. "Travel time from home")
    // isn't the "left home for the airport" signal claimHomeDepartureTransit looks for.
    const wrongDirection = transit('from', '2030-03-10T06:30:00Z', '2030-03-10T07:45:00Z');
    const outbound = flight('JFK', 'FCO', '2030-03-10T08:00:00Z', '2030-03-10T22:00:00Z');
    const inbound = flight('FCO', 'JFK', '2030-03-17T09:00:00Z', '2030-03-17T14:00:00Z');
    const trips = inferTripFromSignals([wrongDirection, outbound, inbound]);

    assert.equal(trips.length, 1);
    assert.equal(trips[0].startDate.toISOString(), outbound.event.startTime.toISOString());
  });

  test('case 1f: standalone flight (no return leg) still gets its startDate refined by a preceding ground-transit signal', () => {
    const toAirport = transit('to', '2030-04-01T06:30:00Z', '2030-04-01T07:45:00Z');
    const outbound = flight('JFK', 'FCO', '2030-04-01T08:00:00Z', '2030-04-01T20:00:00Z');
    const trips = inferTripFromSignals([toAirport, outbound]);

    assert.equal(trips.length, 1);
    const [trip] = trips;
    assert.equal(trip.startDate.toISOString(), toAirport.event.startTime.toISOString());
    assert.deepEqual(trip.sourceEventIds, [outbound.event.id, toAirport.event.id]);
    // Unaffected: the default-length guess is still measured from arrival at the destination.
    assert.equal(trip.endDate.getTime() - outbound.event.endTime.getTime(), 3 * 24 * 60 * 60 * 1000);
  });

  test('case 2: outbound flight + lodging, no return flight — end date from lodging checkout', () => {
    const outbound = flight('JFK', 'FCO', '2030-04-01T08:00:00Z', '2030-04-01T20:00:00Z');
    const stay = lodging('Hotel Artemide', '2030-04-01T22:00:00Z', '2030-04-06T10:00:00Z');
    const trips = inferTripFromSignals([outbound, stay]);

    assert.equal(trips.length, 1);
    const [trip] = trips;
    assert.equal(trip.destination, 'Rome, Italy');
    assert.equal(trip.startDate.toISOString(), outbound.event.startTime.toISOString());
    assert.equal(trip.endDate.toISOString(), stay.event.endTime.toISOString());
    assert.equal(trip.endDateIsDefault, false);
    assert.deepEqual(trip.hotel, { label: 'Hotel Artemide' });
    assert.deepEqual(trip.sourceEventIds, [outbound.event.id, stay.event.id]);
  });

  test('case 2b: outbound flight, no return flight, no lodging — end date defaults to arrival + 3 days', () => {
    const outbound = flight('JFK', 'FCO', '2030-04-01T08:00:00Z', '2030-04-01T20:00:00Z');
    const trips = inferTripFromSignals([outbound]);

    assert.equal(trips.length, 1);
    const [trip] = trips;
    assert.equal(trip.destination, 'Rome, Italy');
    assert.equal(trip.startDate.toISOString(), outbound.event.startTime.toISOString());
    // Guessed length is measured from arrival at the destination, not from home-leaving startDate.
    assert.equal(trip.endDate.getTime() - outbound.event.endTime.getTime(), 3 * 24 * 60 * 60 * 1000);
    assert.equal(trip.endDateIsDefault, true);
    assert.equal(trip.hotel, undefined);
  });

  test('case 3: lodging signal with no flight at all — destination/dates come entirely from the lodging event', () => {
    const stay = lodging('Le Grand Hotel Paris', '2030-05-01T15:00:00Z', '2030-05-05T10:00:00Z');
    const trips = inferTripFromSignals([stay]);

    assert.equal(trips.length, 1);
    const [trip] = trips;
    assert.equal(trip.destination, 'Le Grand Hotel Paris'); // raw place text, good enough to prefill an editable field
    assert.equal(trip.destinationCoords, undefined); // never geocoded by this pure function
    assert.equal(trip.startDate.toISOString(), stay.event.startTime.toISOString());
    assert.equal(trip.endDate.toISOString(), stay.event.endTime.toISOString());
    assert.equal(trip.anchorEventId, stay.event.id);
    assert.deepEqual(trip.sourceEventIds, [stay.event.id]);
  });

  test('case 4: two flights that do not form a round trip — each becomes its own independent candidate, not a forced pairing', () => {
    const legA = flight('JFK', 'FCO', '2030-06-01T08:00:00Z', '2030-06-01T20:00:00Z');
    const legB = flight('CDG', 'LHR', '2030-06-15T09:00:00Z', '2030-06-15T10:00:00Z');
    const trips = inferTripFromSignals([legA, legB]);

    assert.equal(trips.length, 2);
    const destinations = trips.map(t => t.destination).sort();
    assert.deepEqual(destinations, ['London, United Kingdom', 'Rome, Italy']);
    trips.forEach(t => assert.equal(t.endDateIsDefault, true)); // no return/lodging for either leg
  });

  test('an unresolvable airport code drops the whole pair rather than guessing', () => {
    const outbound = flight('JFK', 'ZZZ', '2030-03-10T08:00:00Z', '2030-03-10T22:00:00Z');
    const inbound = flight('ZZZ', 'JFK', '2030-03-17T09:00:00Z', '2030-03-17T14:00:00Z');
    assert.deepEqual(inferTripFromSignals([outbound, inbound]), []);
  });

  test('an unresolvable standalone flight (no known destination) produces no suggestion', () => {
    const outbound = flight('JFK', 'ZZZ', '2030-03-10T08:00:00Z', '2030-03-10T22:00:00Z');
    assert.deepEqual(inferTripFromSignals([outbound]), []);
  });

  test('dining never shapes a trip, and a ground-transit signal with no flight nearby to attach to produces no trip on its own', () => {
    const meal = dining('2030-03-10T19:00:00Z', '2030-03-10T20:00:00Z', '34 Rue Laffitte, Paris');
    const strayTransit = transit('to', '2030-05-01T06:30:00Z', '2030-05-01T07:45:00Z');
    assert.deepEqual(inferTripFromSignals([meal, strayTransit]), []);
  });

  test('a lodging signal already claimed by one flight pairing is not reused for an unrelated standalone flight', () => {
    const outbound = flight('JFK', 'FCO', '2030-03-10T08:00:00Z', '2030-03-10T20:00:00Z');
    const stay = lodging('Hotel Artemide', '2030-03-10T22:00:00Z', '2030-03-15T10:00:00Z');
    const inbound = flight('FCO', 'JFK', '2030-03-16T09:00:00Z', '2030-03-16T14:00:00Z');
    // An unrelated later leg to a different city — should NOT pick up the already-claimed stay.
    const unrelatedLeg = flight('CDG', 'LHR', '2030-07-01T09:00:00Z', '2030-07-01T10:00:00Z');

    const trips = inferTripFromSignals([outbound, stay, inbound, unrelatedLeg]);
    assert.equal(trips.length, 2);
    const romeTrip = trips.find(t => t.destination === 'Rome, Italy')!;
    const londonTrip = trips.find(t => t.destination === 'London, United Kingdom')!;
    assert.deepEqual(romeTrip.hotel, { label: 'Hotel Artemide' });
    assert.equal(londonTrip.hotel, undefined);
    assert.equal(londonTrip.endDateIsDefault, true);
  });

  test('multiple independent lodging-only signals each produce their own suggestion', () => {
    const stayA = lodging('Hotel A', '2030-08-01T15:00:00Z', '2030-08-03T10:00:00Z');
    const stayB = lodging('Hotel B', '2030-09-01T15:00:00Z', '2030-09-03T10:00:00Z');
    const trips = inferTripFromSignals([stayA, stayB]);
    assert.equal(trips.length, 2);
    assert.deepEqual(trips.map(t => t.destination).sort(), ['Hotel A', 'Hotel B']);
  });
});
