// Static IATA airport-code → city lookup, purpose-built for
// lib/calendar-signals.ts's inferTripFromSignals(): a flight signal's `from`/`to` fields
// (see classifyImportedEvent) only ever carry a bare 3-letter airport code, and neither
// existing geocoding lib resolves one — lib/geocoding.ts's searchCities is name-based (an
// Open-Meteo query for "JFK" doesn't return New York), and lib/hotel-geocoding.ts's
// searchHotelLocation is for street addresses/venues, not airport codes either. Confirmed by
// reading both files: neither has any airport-code-shaped input handling at all.
//
// Deliberately a small, pragmatic static table — "the handful of major airports likely to
// actually appear," per docs/auto-trip-discovery-plan.md Part A — not a complete global IATA
// database. A live geocoding call for a bare 3-letter code would be fragile anyway (ambiguous
// codes, multi-airport cities), so this is a real coverage trade-off, not an oversight: an
// airport missing from this table means no auto-discovery for that trip, not a wrong guess.
// Includes TLS/ORY (Toulouse/Paris-Orly) specifically because they're the real Navan sample
// codes already used throughout lib/calendar-signals.test.ts and
// docs/calendar-signal-detection-plan.md.

export interface AirportCityInfo {
  // A display-ready "City, Country" string — same shape lib/geocoding.ts's searchCities
  // returns (`${name}, ${country}`), so it can be dropped straight into
  // app/(tabs)/trips.tsx's newDestination field and lib/timezones.ts's guessTimezoneForCity
  // (which matches on a lowercased substring of this) without further parsing.
  city: string;
  latitude: number;
  longitude: number;
}

export const IATA_TO_CITY: Record<string, AirportCityInfo> = {
  // North America
  JFK: { city: 'New York, USA', latitude: 40.6413, longitude: -73.7781 },
  EWR: { city: 'New York, USA', latitude: 40.6895, longitude: -74.1745 },
  LGA: { city: 'New York, USA', latitude: 40.7769, longitude: -73.8740 },
  LAX: { city: 'Los Angeles, USA', latitude: 33.9416, longitude: -118.4085 },
  ORD: { city: 'Chicago, USA', latitude: 41.9742, longitude: -87.9073 },
  SFO: { city: 'San Francisco, USA', latitude: 37.6213, longitude: -122.3790 },
  BOS: { city: 'Boston, USA', latitude: 42.3656, longitude: -71.0096 },
  ATL: { city: 'Atlanta, USA', latitude: 33.6407, longitude: -84.4277 },
  MIA: { city: 'Miami, USA', latitude: 25.7959, longitude: -80.2870 },
  SEA: { city: 'Seattle, USA', latitude: 47.4502, longitude: -122.3088 },
  DEN: { city: 'Denver, USA', latitude: 39.8561, longitude: -104.6737 },
  IAD: { city: 'Washington, USA', latitude: 38.9531, longitude: -77.4565 },
  DFW: { city: 'Dallas, USA', latitude: 32.8998, longitude: -97.0403 },
  YYZ: { city: 'Toronto, Canada', latitude: 43.6777, longitude: -79.6248 },
  YUL: { city: 'Montreal, Canada', latitude: 45.4706, longitude: -73.7408 },
  MEX: { city: 'Mexico City, Mexico', latitude: 19.4363, longitude: -99.0721 },

  // South America
  GRU: { city: 'Sao Paulo, Brazil', latitude: -23.4356, longitude: -46.4731 },
  GIG: { city: 'Rio de Janeiro, Brazil', latitude: -22.8090, longitude: -43.2506 },
  EZE: { city: 'Buenos Aires, Argentina', latitude: -34.8222, longitude: -58.5358 },

  // Europe
  LHR: { city: 'London, United Kingdom', latitude: 51.4700, longitude: -0.4543 },
  LGW: { city: 'London, United Kingdom', latitude: 51.1537, longitude: -0.1821 },
  STN: { city: 'London, United Kingdom', latitude: 51.8860, longitude: 0.2389 },
  CDG: { city: 'Paris, France', latitude: 49.0097, longitude: 2.5479 },
  ORY: { city: 'Paris, France', latitude: 48.7262, longitude: 2.3652 },
  TLS: { city: 'Toulouse, France', latitude: 43.6293, longitude: 1.3638 },
  FRA: { city: 'Frankfurt, Germany', latitude: 50.0379, longitude: 8.5622 },
  MUC: { city: 'Munich, Germany', latitude: 48.3538, longitude: 11.7861 },
  AMS: { city: 'Amsterdam, Netherlands', latitude: 52.3105, longitude: 4.7683 },
  MAD: { city: 'Madrid, Spain', latitude: 40.4983, longitude: -3.5676 },
  BCN: { city: 'Barcelona, Spain', latitude: 41.2974, longitude: 2.0833 },
  FCO: { city: 'Rome, Italy', latitude: 41.8003, longitude: 12.2389 },
  MXP: { city: 'Milan, Italy', latitude: 45.6306, longitude: 8.7281 },
  ZRH: { city: 'Zurich, Switzerland', latitude: 47.4647, longitude: 8.5492 },
  GVA: { city: 'Geneva, Switzerland', latitude: 46.2381, longitude: 6.1090 },
  VIE: { city: 'Vienna, Austria', latitude: 48.1103, longitude: 16.5697 },
  DUB: { city: 'Dublin, Ireland', latitude: 53.4213, longitude: -6.2701 },
  LIS: { city: 'Lisbon, Portugal', latitude: 38.7813, longitude: -9.1359 },
  CPH: { city: 'Copenhagen, Denmark', latitude: 55.6180, longitude: 12.6560 },
  ARN: { city: 'Stockholm, Sweden', latitude: 59.6519, longitude: 17.9186 },
  OSL: { city: 'Oslo, Norway', latitude: 60.1976, longitude: 11.1004 },
  HEL: { city: 'Helsinki, Finland', latitude: 60.3172, longitude: 24.9633 },
  WAW: { city: 'Warsaw, Poland', latitude: 52.1657, longitude: 20.9671 },
  PRG: { city: 'Prague, Czechia', latitude: 50.1008, longitude: 14.2632 },
  BUD: { city: 'Budapest, Hungary', latitude: 47.4298, longitude: 19.2611 },
  ATH: { city: 'Athens, Greece', latitude: 37.9364, longitude: 23.9445 },
  IST: { city: 'Istanbul, Turkey', latitude: 41.2753, longitude: 28.7519 },

  // Middle East
  DXB: { city: 'Dubai, UAE', latitude: 25.2532, longitude: 55.3657 },
  AUH: { city: 'Abu Dhabi, UAE', latitude: 24.4330, longitude: 54.6511 },
  DOH: { city: 'Doha, Qatar', latitude: 25.2731, longitude: 51.6081 },

  // Asia-Pacific
  NRT: { city: 'Tokyo, Japan', latitude: 35.7720, longitude: 140.3929 },
  HND: { city: 'Tokyo, Japan', latitude: 35.5494, longitude: 139.7798 },
  ICN: { city: 'Seoul, South Korea', latitude: 37.4602, longitude: 126.4407 },
  PEK: { city: 'Beijing, China', latitude: 40.0799, longitude: 116.6031 },
  PVG: { city: 'Shanghai, China', latitude: 31.1443, longitude: 121.8083 },
  HKG: { city: 'Hong Kong, China', latitude: 22.3080, longitude: 113.9185 },
  SIN: { city: 'Singapore, Singapore', latitude: 1.3644, longitude: 103.9915 },
  BKK: { city: 'Bangkok, Thailand', latitude: 13.6900, longitude: 100.7501 },
  SYD: { city: 'Sydney, Australia', latitude: -33.9399, longitude: 151.1753 },
  MEL: { city: 'Melbourne, Australia', latitude: -37.6690, longitude: 144.8410 },
};

/**
 * Resolves a bare IATA airport code (case-insensitive, whitespace-tolerant) to its city.
 * Returns null for anything not in the table — including a code that's the wrong shape
 * entirely (matchFlightGeneric's DIRECTIONAL_RE can capture a capitalized place name instead
 * of a real 3-letter code when no provider-specific matcher claimed the event) — never throws,
 * since a resolution miss should just mean "no auto-discovery for this signal," not an error.
 */
export function resolveAirportCity(code: string | undefined): AirportCityInfo | null {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) return null;
  return IATA_TO_CITY[normalized] ?? null;
}
