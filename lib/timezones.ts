// Known destination cities → IANA timezone, so trip-planning math runs on the
// destination's clock instead of the traveler's device clock. Extend this map as
// lib/recommendations.ts grows to cover more cities.
const CITY_TIMEZONES: Record<string, string> = {
  'paris': 'Europe/Paris',
  'rome': 'Europe/Rome',
  'new york': 'America/New_York',
  'modena': 'Europe/Rome',
  'denver': 'America/Denver',
};

export const DEVICE_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Best-effort city -> IANA timezone lookup, falling back to the device's own
 * timezone when the city isn't recognized (matches today's behavior for unknown cities).
 */
export function guessTimezoneForCity(city: string): string {
  if (!city) return DEVICE_TIMEZONE;
  const normalized = city.toLowerCase().trim();
  const match = Object.keys(CITY_TIMEZONES).find(
    key => normalized.includes(key) || key.includes(normalized)
  );
  return match ? CITY_TIMEZONES[match] : DEVICE_TIMEZONE;
}
