import Place from '../models/Place';
import { escapeRegExp, cityNeedle } from './place-matching';
import { fetchGooglePlacesForCity } from './google-places-client';

const MIN_PLACES_PER_CITY = 5;

// Synthetic fallback content — the same pattern already used client-side in
// lib/recommendations.ts's unknown-city fallback. This is what trip-creation-time
// population falls back to until a real external places API is wired in (deliberately
// deferred for now — see the source: 'generated' vs 'curated' distinction on the Place
// model). Curated entries added through the admin site are never touched by this.
//
// `city` is the full string as given (e.g. "Amsterdam, Netherlands") — used for storage and
// matching. `displayCity` is just the city-name portion, for names/descriptions that read
// naturally ("Local Amsterdam Cafe", not "Local Amsterdam, Netherlands Cafe").
function buildSyntheticPlaces(city: string, displayCity: string) {
  const drafts = [
    { name: `Local ${displayCity} Cafe`, category: 'Restaurant' as const, genre: 'Cafes', rating: 4.6, description: `A lovely local cafe to grab coffee, tea, and fresh pastries in ${displayCity}.`, estimatedDuration: 45, distanceKm: 1.1 },
    { name: `Local ${displayCity} Bistro`, category: 'Restaurant' as const, genre: 'European', rating: 4.7, description: `A highly-rated local dining spot offering classic regional dishes in ${displayCity}.`, estimatedDuration: 75, distanceKm: 1.2 },
    { name: `${displayCity} Cultural Walk`, category: 'Activity' as const, genre: 'Walking Tours', rating: 4.7, description: `Explore the vibrant neighborhoods, street art, and unique architecture of ${displayCity}.`, estimatedDuration: 90, distanceKm: 0.5 },
    { name: `Historical ${displayCity} Site`, category: 'Activity' as const, genre: 'Monuments', rating: 4.8, description: `An iconic local heritage monument rich with history and beautiful photo opportunities.`, estimatedDuration: 45, distanceKm: 1.5 },
    { name: `${displayCity} Main Venue`, category: 'Event' as const, genre: 'Concerts', rating: 4.9, description: `Catch top-tier local live music, performances, and cultural shows.`, estimatedDuration: 120, distanceKm: 2.2 },
  ];

  return drafts.map(p => ({
    ...p,
    city,
    tags: [p.category, p.genre],
    source: 'generated' as const,
  }));
}

/**
 * Called at trip-creation time (and from the solo recommendations endpoint, for whatever
 * city the user's live location resolves to): ensures a destination has a reasonable pool of
 * candidate places before anyone tries to propose an event there. Counts curated +
 * already-generated/google places for the city first, and only tops up if thin — so this
 * never duplicates or overwrites existing entries, curated or otherwise.
 *
 * Fill order: curated (existing, hand-vetted, checked above) -> Google Places API (New), if
 * GOOGLE_PLACES_API_KEY is configured -> synthetic fallback, only if still thin after that. A
 * Google API failure (network error, quota, bad key) is caught and logged here, never thrown —
 * an external API problem must not block trip creation or recommendations; it just falls
 * through to the synthetic generator exactly as if no key were configured at all.
 *
 * The existence check is a substring match, not exact — city strings aren't consistent
 * across the app ("Amsterdam" from reverse-geocoding vs "Amsterdam, Netherlands" from the
 * trip-destination autocomplete are the same real city). An exact-match check here would
 * treat those as different cities and generate duplicate synthetic content under each
 * variant every time a slightly different string for the same city showed up.
 */
export async function ensurePlacesForCity(city: string): Promise<void> {
  const normalized = city.trim();
  if (!normalized) return;

  const existingCount = await Place.countDocuments({
    city: { $regex: escapeRegExp(cityNeedle(normalized)), $options: 'i' }
  });
  if (existingCount >= MIN_PLACES_PER_CITY) return;

  const displayCity = normalized.split(',')[0].trim();
  let filledCount = existingCount;

  if (process.env.GOOGLE_PLACES_API_KEY) {
    try {
      const [restaurants, activities] = await Promise.all([
        fetchGooglePlacesForCity(normalized, 'Restaurant'),
        fetchGooglePlacesForCity(normalized, 'Activity'),
      ]);
      const googleDrafts = [...restaurants, ...activities];
      if (googleDrafts.length > 0) {
        await Place.insertMany(googleDrafts);
        filledCount += googleDrafts.length;
      }
    } catch (err) {
      console.warn('[places-population] Google Places fetch failed, falling back to synthetic content:', err);
    }
  }

  if (filledCount >= MIN_PLACES_PER_CITY) return;
  await Place.insertMany(buildSyntheticPlaces(normalized, displayCity));
}
