// City search/validation via Open-Meteo's geocoding API (free, no API key — same provider
// already used in lib/weather.ts). Used to catch typos in destination/homebase fields
// instead of silently falling through to lib/recommendations.ts's fake "Local {typo}" content.

export interface CityResult {
  name: string;
  country: string;
  admin1?: string; // region/state, when available
  latitude: number;
  longitude: number;
  // Open-Meteo returns this on most real cities/towns for free, already fetched by every
  // caller of this function — previously discarded. Used by lib/place-matching.ts's
  // resolveSearchRadiusKm to size the "near me" search radius by how dense the destination
  // actually is (a fixed radius makes no sense across a 10k-person town and a 10M-person
  // metro). Absent for the rare geocoding result with no population data.
  population?: number;
}

export async function searchCities(query: string): Promise<CityResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const url =
    `https://geocoding-api.open-meteo.com/v1/search` +
    `?name=${encodeURIComponent(trimmed)}&count=5&language=en&format=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding API error: ${res.status}`);
  const data = await res.json();

  return (data.results || []).map((r: any) => ({
    name: r.name,
    country: r.country,
    admin1: r.admin1,
    latitude: r.latitude,
    longitude: r.longitude,
    population: typeof r.population === 'number' ? r.population : undefined,
  }));
}
