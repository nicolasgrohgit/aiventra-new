/**
 * One-time backfill: geocodes real coordinates for every source: 'curated' Place that doesn't
 * have a `location` yet (scripts/seed-curated-places.ts seeded these 60 entries with hand-typed
 * distanceKm values but no real lat/lng — see docs on Place.location in models/Place.ts and
 * buildGeoNearStage in lib/place-matching.ts, which needs real coordinates to do anything).
 *
 * Uses lib/hotel-geocoding.ts's Nominatim client (free, no API key) — rate-limited to Nominatim's
 * ~1 req/sec usage policy, so this run takes roughly as many seconds as there are places to
 * geocode. Safe to re-run: only touches documents with no `location` set yet.
 *
 * Run manually — this does NOT run automatically on server boot:
 *   npx tsx scripts/backfill-curated-place-coords.ts
 */
import dotenv from 'dotenv';
import connectToDatabase from '../lib/mongodb';
import Place from '../models/Place';
import { searchHotelLocation, GeoBiasPoint } from '../lib/hotel-geocoding';
import { searchCities } from '../lib/geocoding';

dotenv.config({ quiet: true });

const NOMINATIM_MIN_INTERVAL_MS = 1100; // stay comfortably under the 1 req/sec policy

// Resolves + caches each city's centroid once (not per place) — used as a hard viewbox
// constraint (see lib/hotel-geocoding.ts) so a generic name like "Appian Way" can't resolve to
// a same-named street in the wrong country, which happened for real during this backfill's
// first run before this constraint existed.
const cityCenterCache = new Map<string, GeoBiasPoint | null>();
async function resolveCityCenter(city: string): Promise<GeoBiasPoint | null> {
  if (cityCenterCache.has(city)) return cityCenterCache.get(city)!;
  const results = await searchCities(city);
  const center = results.length > 0 ? { lat: results[0].latitude, lng: results[0].longitude } : null;
  cityCenterCache.set(city, center);
  return center;
}

// Many curated entries are descriptive activity names ("Colosseum & Roman Forum", "Eiffel
// Tower Summit"), not the literal venue name Nominatim indexes ("Colosseum", "Eiffel Tower") —
// the full string genuinely finds nothing. Rather than hand-mapping each one, try a
// progressively simplified retry: cut at the first "&"/"("/":" (drops a tacked-on second
// venue or qualifier), then strip a small set of generic trailing activity words a real place
// listing wouldn't include.
const TRAILING_ACTIVITY_WORDS = /\s+(Summit|Walk|Evening Walk|Cruise|Trail|Loop|Ride|Tour|Cycling Trail|Bike Ride|Market Stalls|Sculpture Garden)$/i;

function simplifyQuery(name: string): string | null {
  const cut = name.split(/[&(:]/)[0].trim();
  const stripped = cut.replace(TRAILING_ACTIVITY_WORDS, '').trim();
  return stripped && stripped !== name ? stripped : null;
}

async function geocodeWithFallback(name: string, city: string) {
  const cityCenter = await resolveCityCenter(city);
  const attempts = [name, simplifyQuery(name)].filter((q): q is string => !!q);
  for (const query of attempts) {
    const results = await searchHotelLocation(`${query}, ${city}`, cityCenter ?? undefined);
    if (results.length > 0) return results[0];
    if (query !== attempts[attempts.length - 1]) {
      await new Promise(resolve => setTimeout(resolve, NOMINATIM_MIN_INTERVAL_MS));
    }
  }
  return null;
}

async function backfill() {
  await connectToDatabase();

  const places = await Place.find({ source: 'curated', location: { $exists: false } });
  if (places.length === 0) {
    console.log('Nothing to backfill — every curated place already has a location.');
    process.exit(0);
  }
  console.log(`Backfilling coordinates for ${places.length} curated place(s)...`);

  let updated = 0;
  let skipped = 0;

  for (const place of places) {
    try {
      const result = await geocodeWithFallback(place.name, place.city);
      if (!result) {
        console.warn(`  [skip] No geocoding result for "${place.name}, ${place.city}"`);
        skipped++;
      } else {
        const { latitude, longitude } = result;
        place.location = { type: 'Point', coordinates: [longitude, latitude] };
        await place.save();
        updated++;
        console.log(`  [ok] ${place.name} (${place.city}) -> [${longitude}, ${latitude}]`);
      }
    } catch (err) {
      console.warn(`  [error] "${place.name}, ${place.city}":`, err);
      skipped++;
    }
    await new Promise(resolve => setTimeout(resolve, NOMINATIM_MIN_INTERVAL_MS));
  }

  console.log(`Done. Updated ${updated}, skipped ${skipped}.`);
  process.exit(0);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
