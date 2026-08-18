import Place from '../models/Place';

const MIN_PLACES_PER_CITY = 5;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Synthetic fallback content — the same pattern already used client-side in
// lib/recommendations.ts's unknown-city fallback. This is what trip-creation-time
// population falls back to until a real external places API is wired in (deliberately
// deferred for now — see the source: 'generated' vs 'curated' distinction on the Place
// model). Curated entries added through the admin site are never touched by this.
function buildSyntheticPlaces(city: string) {
  const drafts = [
    { name: `Local ${city} Cafe`, category: 'Restaurant' as const, genre: 'Cafes', rating: 4.6, description: `A lovely local cafe to grab coffee, tea, and fresh pastries in ${city}.`, estimatedDuration: 45, distanceKm: 1.1 },
    { name: `Local ${city} Bistro`, category: 'Restaurant' as const, genre: 'European', rating: 4.7, description: `A highly-rated local dining spot offering classic regional dishes in ${city}.`, estimatedDuration: 75, distanceKm: 1.2 },
    { name: `${city} Cultural Walk`, category: 'Activity' as const, genre: 'Walking Tours', rating: 4.7, description: `Explore the vibrant neighborhoods, street art, and unique architecture of ${city}.`, estimatedDuration: 90, distanceKm: 0.5 },
    { name: `Historical ${city} Site`, category: 'Activity' as const, genre: 'Monuments', rating: 4.8, description: `An iconic local heritage monument rich with history and beautiful photo opportunities.`, estimatedDuration: 45, distanceKm: 1.5 },
    { name: `${city} Main Venue`, category: 'Event' as const, genre: 'Concerts', rating: 4.9, description: `Catch top-tier local live music, performances, and cultural shows.`, estimatedDuration: 120, distanceKm: 2.2 },
  ];

  return drafts.map(p => ({
    ...p,
    city,
    tags: [p.category, p.genre],
    source: 'generated' as const,
  }));
}

/**
 * Called at trip-creation time: ensures a destination has a reasonable pool of candidate
 * places before anyone tries to propose an event there. Counts curated + already-generated
 * places for the city first, and only tops up with synthetic fallback content if thin — so
 * this never duplicates or overwrites existing entries, curated or otherwise.
 */
export async function ensurePlacesForCity(city: string): Promise<void> {
  const normalized = city.trim();
  if (!normalized) return;

  const existingCount = await Place.countDocuments({
    city: { $regex: `^${escapeRegExp(normalized)}$`, $options: 'i' }
  });
  if (existingCount >= MIN_PLACES_PER_CITY) return;

  await Place.insertMany(buildSyntheticPlaces(normalized));
}
