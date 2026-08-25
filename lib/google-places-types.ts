import { FOOD_GENRES_CATEGORIZED, ACTIVITY_GENRES_CATEGORIZED, EVENT_GENRES_CATEGORIZED } from '../constants/preferences';

// Maps every leaf tag in constants/preferences.ts to Google Places API (New) type IDs
// (https://developers.google.com/maps/documentation/places/web-service/place-types, Table A),
// in both directions: `placeTypes` drives search-time filtering (includedType) once we call
// the real API, and the reverse index lets us classify a fetched place's `types[]` back into
// our own tags so it can be stored as a Place document with the same `tags` shape generated/
// curated places already use (see models/Place.ts, lib/places-population.ts).
//
// Pure data + lookups, no network calls — this is deliberately built and testable before any
// actual Google API integration lands.
//
// Structural gap, confirmed against Google's docs, not assumed: Places API only returns
// venues, never scheduled happenings. It can tell you a concert hall exists; it cannot tell
// you Metallica is playing there on a specific night. So `quality: 'broad'` on an Event tag
// means "a venue-type proxy exists", not "we can show what's on" — that always needs a real
// ticketing/listings API (Ticketmaster/Eventbrite/SeatGeek-style), which is deliberately not
// part of this module. See docs/monetization-strategy.md for how that gap maps to product
// tiering.

export type PlacesMatchQuality = 'direct' | 'broad' | 'none';

export interface PlacesTypeMapping {
  tag: string;
  category: 'Restaurant' | 'Activity' | 'Event';
  // Google Places type IDs, best match first. Empty when quality is 'none'.
  placeTypes: string[];
  quality: PlacesMatchQuality;
  // Present when the mapping needs a caveat beyond what quality alone conveys.
  note?: string;
}

const RESTAURANT_MAPPINGS: PlacesTypeMapping[] = [
  { tag: 'Italian', category: 'Restaurant', placeTypes: ['italian_restaurant'], quality: 'direct' },
  { tag: 'French', category: 'Restaurant', placeTypes: ['french_restaurant'], quality: 'direct' },
  { tag: 'Mediterranean', category: 'Restaurant', placeTypes: ['mediterranean_restaurant'], quality: 'direct' },
  { tag: 'Japanese', category: 'Restaurant', placeTypes: ['japanese_restaurant'], quality: 'direct' },
  { tag: 'Chinese', category: 'Restaurant', placeTypes: ['chinese_restaurant'], quality: 'direct' },
  { tag: 'Thai', category: 'Restaurant', placeTypes: ['thai_restaurant'], quality: 'direct' },
  { tag: 'Mexican', category: 'Restaurant', placeTypes: ['mexican_restaurant'], quality: 'direct' },
  { tag: 'American', category: 'Restaurant', placeTypes: ['american_restaurant'], quality: 'direct' },
  { tag: 'Brazilian', category: 'Restaurant', placeTypes: ['brazilian_restaurant'], quality: 'direct' },
  { tag: 'Fine Dining', category: 'Restaurant', placeTypes: ['fine_dining_restaurant'], quality: 'direct' },
  { tag: 'Fast Food', category: 'Restaurant', placeTypes: ['fast_food_restaurant'], quality: 'direct' },
  {
    tag: 'Street Food', category: 'Restaurant', placeTypes: ['food_court', 'meal_takeaway'], quality: 'broad',
    note: 'No dedicated street-food type; food_court/meal_takeaway are the closest proxies.'
  },
  { tag: 'Seafood', category: 'Restaurant', placeTypes: ['seafood_restaurant'], quality: 'direct' },
  { tag: 'Steakhouses', category: 'Restaurant', placeTypes: ['steak_house'], quality: 'direct' },
  { tag: 'Cafes', category: 'Restaurant', placeTypes: ['cafe', 'coffee_shop'], quality: 'direct' },
];

const ACTIVITY_MAPPINGS: PlacesTypeMapping[] = [
  { tag: 'Museums', category: 'Activity', placeTypes: ['museum', 'art_museum', 'history_museum'], quality: 'direct' },
  {
    tag: 'Monuments', category: 'Activity',
    placeTypes: ['monument', 'historical_landmark', 'historical_place', 'cultural_landmark'], quality: 'direct'
  },
  { tag: 'Viewpoints', category: 'Activity', placeTypes: ['observation_deck', 'scenic_spot'], quality: 'direct' },
  {
    tag: 'Walking Tours', category: 'Activity', placeTypes: [], quality: 'none',
    note: 'No tour/itinerary type exists in the Places API; needs curated content or a tours/booking partner (e.g. Viator-style).'
  },
  {
    tag: 'Boat Cruises', category: 'Activity', placeTypes: [], quality: 'none',
    note: 'marina is the closest place type but represents a dock, not a cruise product; needs curated/booking-partner content.'
  },
  {
    tag: 'Bus Tours', category: 'Activity', placeTypes: [], quality: 'none',
    note: 'No tour/itinerary type exists in the Places API; same gap as Walking Tours.'
  },
  { tag: 'Hiking', category: 'Activity', placeTypes: ['hiking_area'], quality: 'direct' },
  {
    tag: 'Cycling', category: 'Activity', placeTypes: ['cycling_park'], quality: 'broad',
    note: 'Covers cycling parks/tracks as places, not cycling routes — that needs a route-based integration (Strava/Visorando-style), see docs/monetization-strategy.md.'
  },
  {
    tag: 'Water Sports', category: 'Activity', placeTypes: [], quality: 'none',
    note: 'No dedicated type; marina/water_park are too weak to be a real proxy.'
  },
  { tag: 'Galleries', category: 'Activity', placeTypes: ['art_gallery'], quality: 'direct' },
  {
    tag: 'Workshops', category: 'Activity', placeTypes: ['art_studio', 'cultural_center'], quality: 'broad',
    note: 'Covers venues that might host workshops, not the scheduled class itself.'
  },
  {
    tag: 'Local Markets', category: 'Activity', placeTypes: ['farmers_market', 'flea_market'], quality: 'direct',
    note: "Google's bare 'market' type is far broader than the travel-activity sense of "
      + "\"local market\" — live-verified it also tags plain specialty retail (e.g. a florist) "
      + "that has nothing to do with browsing a market, so it's deliberately excluded here "
      + "even though farmers_market/flea_market alone undercount some genuine markets."
  },
  { tag: 'Spas', category: 'Activity', placeTypes: ['spa', 'massage_spa', 'wellness_center'], quality: 'direct' },
  {
    tag: 'Parks', category: 'Activity',
    placeTypes: ['park', 'city_park', 'national_park', 'state_park', 'botanical_garden'], quality: 'direct'
  },
  {
    tag: 'Scenic Drives', category: 'Activity', placeTypes: [], quality: 'none',
    note: 'scenic_spot is a single point of interest, not a drivable route — a routing problem, not a places-lookup one; same future integration idea as Cycling.'
  },
];

// Every Event tag inherits the "venue, not schedule" caveat from the module-level comment
// above; `quality: 'broad'` here specifically means "a venue-type proxy exists", nothing more.
const EVENT_MAPPINGS: PlacesTypeMapping[] = [
  {
    tag: 'Theater', category: 'Event', placeTypes: ['performing_arts_theater'], quality: 'broad',
    note: 'Venue only — no showtime/schedule data.'
  },
  {
    tag: 'Ballet', category: 'Event', placeTypes: ['performing_arts_theater'], quality: 'broad',
    note: 'No ballet-specific type; venue only, no schedule data.'
  },
  {
    tag: 'Opera', category: 'Event', placeTypes: ['opera_house'], quality: 'broad',
    note: 'Venue only — no schedule data.'
  },
  {
    tag: 'Concerts', category: 'Event',
    placeTypes: ['concert_hall', 'live_music_venue', 'philharmonic_hall'], quality: 'broad',
    note: 'Venue only — cannot tell you who is playing when; needs a ticketing/listings API.'
  },
  {
    tag: 'Festivals', category: 'Event', placeTypes: [], quality: 'none',
    note: 'Festivals are typically temporary/outdoor with no matching venue type at all.'
  },
  {
    tag: 'DJ Sets', category: 'Event', placeTypes: ['night_club'], quality: 'broad',
    note: 'Weak venue proxy only — no lineup/schedule data.'
  },
  {
    tag: 'Comedy Shows', category: 'Event', placeTypes: ['comedy_club'], quality: 'broad',
    note: 'Venue only — no schedule data.'
  },
  {
    tag: 'Cinema', category: 'Event', placeTypes: ['movie_theater'], quality: 'broad',
    note: 'Venue exists but Places API has no showtime data.'
  },
  {
    tag: 'Magic Shows', category: 'Event', placeTypes: [], quality: 'none',
    note: 'No dedicated or reasonable proxy type.'
  },
  {
    tag: 'Football', category: 'Event', placeTypes: ['stadium', 'arena'], quality: 'broad',
    note: 'Venue only — no fixture/schedule data.'
  },
  {
    tag: 'Basketball', category: 'Event', placeTypes: ['arena', 'stadium'], quality: 'broad',
    note: 'Venue only — no fixture/schedule data.'
  },
  {
    tag: 'Tennis', category: 'Event', placeTypes: ['tennis_court'], quality: 'broad',
    note: 'tennis_court is a court to play on, not a spectator venue with schedule data.'
  },
  {
    tag: 'Exhibitions', category: 'Event', placeTypes: ['art_gallery', 'museum', 'convention_center'], quality: 'broad',
    note: 'Venue only — no exhibition-schedule data.'
  },
  {
    tag: 'Markets', category: 'Event', placeTypes: ['market', 'flea_market'], quality: 'direct',
    note: 'Genuine exception: recurring markets are themselves places, not scheduled happenings at a venue.'
  },
  {
    tag: 'Parades', category: 'Event', placeTypes: [], quality: 'none',
    note: 'No matching type — inherently a scheduled temporary street event.'
  },
];

export const PLACES_TYPE_MAPPINGS: PlacesTypeMapping[] = [
  ...RESTAURANT_MAPPINGS,
  ...ACTIVITY_MAPPINGS,
  ...EVENT_MAPPINGS,
];

const MAPPING_BY_TAG = new Map<string, PlacesTypeMapping>(
  PLACES_TYPE_MAPPINGS.map(m => [m.tag, m])
);

const TAGS_BY_PLACE_TYPE = new Map<string, string[]>();
for (const mapping of PLACES_TYPE_MAPPINGS) {
  for (const placeType of mapping.placeTypes) {
    const existing = TAGS_BY_PLACE_TYPE.get(placeType);
    if (existing) existing.push(mapping.tag);
    else TAGS_BY_PLACE_TYPE.set(placeType, [mapping.tag]);
  }
}

export function getPlaceTypesForTag(tag: string): string[] {
  return MAPPING_BY_TAG.get(tag)?.placeTypes ?? [];
}

// All distinct Google place types across a whole category's tags, deduped — used as
// `includedTypes` for a category-scoped Nearby Search request (lib/google-places-client.ts's
// searchNearbyPlaces) rather than fetching everything nearby and discarding the unclassified
// majority, the way the city-wide text search (fetchGooglePlacesForCity) has to.
export function getPlaceTypesForCategory(category: 'Restaurant' | 'Activity' | 'Event'): string[] {
  const types = new Set<string>();
  for (const mapping of PLACES_TYPE_MAPPINGS) {
    if (mapping.category !== category) continue;
    for (const t of mapping.placeTypes) types.add(t);
  }
  return Array.from(types);
}

export function getMatchQualityForTag(tag: string): PlacesMatchQuality {
  return MAPPING_BY_TAG.get(tag)?.quality ?? 'none';
}

export function hasGoogleMatch(tag: string): boolean {
  return getMatchQualityForTag(tag) !== 'none';
}

// Given the `types[]` array Google returns on a place, find which of our tags it satisfies.
// Used to populate a fetched place's `tags` field the same way generated/curated places do.
export function tagsForPlaceTypes(placeTypes: string[]): string[] {
  const matched = new Set<string>();
  for (const type of placeTypes) {
    for (const tag of TAGS_BY_PLACE_TYPE.get(type) ?? []) {
      matched.add(tag);
    }
  }
  return Array.from(matched);
}

// A category's Places-API support is never uniform across all its tags (mixed direct/broad/
// none), except Event, where the "venue, not schedule" caveat applies to every tag regardless
// of quality. Exposed as a helper so UI/population code has one place to ask "is this category
// fundamentally not Places-API-backed content" rather than re-deriving it per tag.
export function supportsScheduleData(category: 'Restaurant' | 'Activity' | 'Event'): boolean {
  return category !== 'Event';
}

// Sanity check, exercised by lib/google-places-types.test.ts: every leaf tag declared in the
// taxonomy has exactly one mapping entry here, and vice versa — keeps this file from silently
// drifting out of sync if constants/preferences.ts changes.
export function getAllTaxonomyTags(): string[] {
  return [
    ...FOOD_GENRES_CATEGORIZED.flatMap(g => g.activities),
    ...ACTIVITY_GENRES_CATEGORIZED.flatMap(g => g.activities),
    ...EVENT_GENRES_CATEGORIZED.flatMap(g => g.activities),
  ];
}
