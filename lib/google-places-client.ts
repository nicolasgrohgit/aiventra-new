import { PLACES_TYPE_MAPPINGS, tagsForPlaceTypes, supportsScheduleData } from './google-places-types';

// Real Google Places API (New) integration on top of the tag mapping in
// lib/google-places-types.ts. Wired but a complete no-op until GOOGLE_PLACES_API_KEY is set —
// same "inert until configured" pattern already used for Sentry (see server.ts, .env.example):
// no throwing, no crash, callers get [] and the existing synthetic-fallback path in
// lib/places-population.ts takes over exactly as it does today.
//
// Only Restaurant and Activity are ever fetched — Event is structurally unsupported (see
// supportsScheduleData() / the module doc comment in lib/google-places-types.ts): Places API
// has no scheduled-event data at all, so faking Event content from a venue type would be
// actively misleading rather than just incomplete.
//
// Design note on the search shape: Places API (New) Text Search (`searchText`) accepts at most
// ONE `includedType` per request (unlike Nearby Search's `includedTypes` array) — there is no
// single call that can filter by our whole per-category tag list at once. Rather than firing
// one HTTP call per supported tag (15 Restaurant tags + ~10 supported Activity tags = up to 25
// calls per city per population run — real latency and free-credit cost at any real usage
// volume), this does ONE broad, category-scoped textQuery per city ("restaurants in Paris,
// France" / "tourist attractions and activities in Paris, France") and uses
// tagsForPlaceTypes() to classify + filter results afterwards — a place whose returned
// `types[]` don't map to anything in our taxonomy is dropped, not kept with a fabricated tag.

const TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
// Places API (New) requires an explicit field mask on every request (no "return everything"
// default) — this also controls which SKU/pricing tier the call falls under, so keep it to
// only what's actually used below.
const FIELD_MASK = 'places.id,places.displayName,places.types,places.rating,places.editorialSummary,places.location';
const MAX_RESULTS = 20;

// No real per-visit duration is available from a text search keyed only by city (Places API
// doesn't report typical visit length at all) — DEFAULT_DURATION_MINUTES below is a coarse,
// clearly-approximate stand-in, same order of accuracy the synthetic generator in
// lib/places-population.ts already uses, not a claim of real measurement.
//
// Distance is different: Places API (New) returns real lat/lng per place (see `location` in
// FIELD_MASK below), stored on Place.location and used by buildGeoNearStage
// (lib/place-matching.ts) once a trip has a real anchor point (Trip.baseLocations). pseudoDistanceKm
// below is now only a fallback for the static-field query path (trips with no anchor point
// yet) — not the source of truth it used to be.
const DEFAULT_DURATION_MINUTES: Record<'Restaurant' | 'Activity', number> = {
  Restaurant: 75,
  Activity: 90,
};
const MIN_DISTANCE_KM = 0.3;
const MAX_DISTANCE_KM = 6.5;

export interface GooglePlaceDraft {
  name: string;
  city: string;
  category: 'Restaurant' | 'Activity';
  genre: string;
  tags: string[];
  rating: number;
  description: string;
  estimatedDuration: number;
  distanceKm: number;
  source: 'google';
  location?: { type: 'Point'; coordinates: [number, number] };
}

// Deterministic (not random) so the same place gets the same placeholder distance across
// repeated fetches, instead of jittering every time ensurePlacesForCity happens to run again.
function pseudoDistanceKm(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const unit = (Math.abs(hash) % 1000) / 1000; // 0..1
  return Math.round((MIN_DISTANCE_KM + unit * (MAX_DISTANCE_KM - MIN_DISTANCE_KM)) * 10) / 10;
}

function buildTextQuery(category: 'Restaurant' | 'Activity', city: string): string {
  return category === 'Restaurant'
    ? `restaurants in ${city}`
    : `tourist attractions and activities in ${city}`;
}

async function searchText(query: string, apiKey: string): Promise<any[]> {
  const res = await fetch(TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: MAX_RESULTS }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Places API error: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.places || [];
}

/**
 * Fetches real places for a city/category from Google Places API (New), tagged against our
 * own taxonomy via lib/google-places-types.ts. Returns [] (never throws) when
 * GOOGLE_PLACES_API_KEY isn't set or the category is Event — both are routine, expected states,
 * not errors. A genuine API failure (network error, non-2xx response) DOES throw, same
 * convention as lib/weather.ts's fetchWeather — the caller (lib/places-population.ts) decides
 * how to handle that, matching the existing catch-and-fall-back-to-synthetic pattern already at
 * every ensurePlacesForCity call site in server.ts.
 */
export async function fetchGooglePlacesForCity(
  city: string,
  category: 'Restaurant' | 'Activity' | 'Event'
): Promise<GooglePlaceDraft[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];
  if (category === 'Event' || !supportsScheduleData(category)) return [];

  const results = await searchText(buildTextQuery(category, city), apiKey);
  const drafts: GooglePlaceDraft[] = [];

  for (const place of results) {
    const types: string[] = place.types || [];
    // A returned type can belong to a tag in a *different* category (e.g. 'museum' maps to
    // both Activity "Museums" and Event "Exhibitions") — restrict to tags whose own category
    // matches what we actually asked for, so an Activity-sourced place never ends up genred
    // under an Event-only tag.
    const tags = tagsForPlaceTypes(types).filter(
      tag => PLACES_TYPE_MAPPINGS.find(m => m.tag === tag)?.category === category
    );
    if (tags.length === 0) continue; // nothing in our taxonomy matched — drop, don't fabricate

    const name: string = place.displayName?.text || 'Unnamed place';
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;
    drafts.push({
      name,
      city,
      category,
      genre: tags[0],
      tags: [category, ...tags],
      rating: typeof place.rating === 'number' ? place.rating : 4.3,
      description: place.editorialSummary?.text || `A ${category.toLowerCase()} in ${city} (via Google Places).`,
      estimatedDuration: DEFAULT_DURATION_MINUTES[category],
      // Fallback only — real distance comes from `location` below via buildGeoNearStage once
      // the requesting trip has a real anchor point.
      distanceKm: pseudoDistanceKm(place.id || name),
      source: 'google',
      location: typeof lat === 'number' && typeof lng === 'number'
        ? { type: 'Point', coordinates: [lng, lat] }
        : undefined,
    });
  }

  return drafts;
}
