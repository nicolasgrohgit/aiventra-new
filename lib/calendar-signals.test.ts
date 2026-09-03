import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyImportedEvent, hasDiningConflict, filterDiningConflicts } from './calendar-signals';
import type { CalendarEvent } from './free-time';
import type { SlotProposal } from './free-time';

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
