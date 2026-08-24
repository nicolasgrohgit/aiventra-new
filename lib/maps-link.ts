// Pure URL-building for the tap-to-navigate action on recommendation cards (trips.tsx's
// selectedPlace detail modal, recommendation.tsx) — kept decoupled from React Native's
// `Linking` (the actual `Linking.openURL(buildMapsUrl(place))` call lives at each call site)
// so this is trivially unit-testable with the plain Node test runner, same as every other
// lib/*.ts helper in this project.
//
// A Google Maps "universal link" (maps.google.com/maps/dir/?api=1&...) is deliberately used
// instead of a platform-specific `maps://`/`geo:` URI scheme: iOS intercepts these links at
// the OS level and opens Apple Maps directly (no Google Maps install required), Android opens
// Google Maps if installed and falls back to a browser otherwise — one URL covers both
// platforms without any Platform.OS branching.

export interface MapsDestination {
  name: string;
  city?: string;
  address?: string;
  // [lng, lat] — same GeoJSON coordinate order used throughout this codebase (Place.location,
  // PlaceRecommendation.location).
  location?: { coordinates: [number, number] };
}

const MAPS_DIRECTIONS_BASE = 'https://www.google.com/maps/dir/?api=1';

/**
 * Coordinates are preferred whenever available — they pin the exact venue, where a text query
 * can land on the wrong branch of a chain or a same-named place across town. Falls back to a
 * "name, address" (or "name, city" when there's no address either) text query for curated/
 * generated places that were never geocoded — see the source: 'curated'/'generated' vs.
 * 'google' distinction on Place in models/Place.ts for why only some places have coordinates.
 */
export function buildMapsUrl(place: MapsDestination): string {
  const coords = place.location?.coordinates;
  if (coords && coords.length === 2 && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
    const [lng, lat] = coords;
    return `${MAPS_DIRECTIONS_BASE}&destination=${lat},${lng}`;
  }

  const queryParts = [place.name, place.address || place.city].filter(Boolean);
  const query = queryParts.join(', ');
  return `${MAPS_DIRECTIONS_BASE}&destination=${encodeURIComponent(query)}`;
}
