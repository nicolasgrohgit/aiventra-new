// Free-form address/place-name geocoding (a hotel, not a city) via Nominatim (OpenStreetMap) —
// free, no API key, same "no-key provider" bias already used for lib/weather.ts and
// lib/geocoding.ts's city search. Open-Meteo (the city-search provider) can't be reused here:
// it only geocodes city/place *names*, not street addresses or named venues like a hotel.
//
// Deliberately not gated behind GOOGLE_PLACES_API_KEY — that key is optional/inert everywhere
// else in this app (lib/google-places-client.ts), and this feature shouldn't be dead for
// anyone who hasn't configured one.
//
// Usage-policy note (Nominatim ToS: https://operations.osmfoundation.org/policies/nominatim/):
// max ~1 req/sec, a descriptive User-Agent identifying the app (not a personal email — never
// embed a real user's contact info in a request header sent to a third party), and
// "© OpenStreetMap contributors" attribution shown near any UI that surfaces these results.
// Callers here are naturally well under the rate limit: a debounced single-user search box
// (see trips.tsx's existing 300ms destination-search pattern) and the one-time curated-places
// backfill script (scripts/backfill-curated-place-coords.ts), which throttles itself.

const NOMINATIM_USER_AGENT = 'OdysAI/1.0 (+https://odys.ai; travel planning app)';

export interface HotelLocationResult {
  label: string; // Nominatim's display_name, trimmed to something UI-presentable
  latitude: number;
  longitude: number;
}

export interface GeoBiasPoint {
  lat: number;
  lng: number;
}

// Generic street/venue names (a real example hit during the curated-places backfill:
// "Appian Way Cycling Trail" resolved to a street in Illinois, USA instead of Rome's Appian
// Way) can rank above the intended in-city match on text relevance alone — appending the city
// name as a plain text token is too weak a signal to prevent that. A `viewbox` + `bounded=1`
// is a HARD geographic filter, not a hint, so it's used whenever a city center is available
// (it always should be — see lib/geocoding.ts's searchCities, which every caller of this
// function already has access to). ~0.5 degrees is roughly 55km at the equator (less at
// higher latitudes) — generous enough to cover a whole metro area, tight enough to exclude
// same-named places in the wrong country.
const CITY_BIAS_DEGREES = 0.5;

export async function searchHotelLocation(query: string, cityCenter?: GeoBiasPoint): Promise<HotelLocationResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const params = new URLSearchParams({ q: trimmed, format: 'json', limit: '5', addressdetails: '0' });
  if (cityCenter) {
    const { lat, lng } = cityCenter;
    // Nominatim's viewbox order is left,top,right,bottom == lon_min,lat_max,lon_max,lat_min.
    params.set('viewbox', `${lng - CITY_BIAS_DEGREES},${lat + CITY_BIAS_DEGREES},${lng + CITY_BIAS_DEGREES},${lat - CITY_BIAS_DEGREES}`);
    params.set('bounded', '1');
  }

  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': NOMINATIM_USER_AGENT, 'Accept-Language': 'en' }
  });
  if (!res.ok) throw new Error(`Geocoding API error: ${res.status}`);
  const data = await res.json();

  if (!Array.isArray(data)) return [];
  return data.map((r: any) => ({
    label: r.display_name,
    latitude: parseFloat(r.lat),
    longitude: parseFloat(r.lon)
  })).filter((r: HotelLocationResult) => !Number.isNaN(r.latitude) && !Number.isNaN(r.longitude));
}
