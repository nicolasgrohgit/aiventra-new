/**
 * Seeds real, hand-curated top restaurants and activities for Paris, Rome, and London as
 * Place documents with source: 'curated' — vetted, permanent content that
 * lib/places-population.ts's auto-population never touches or duplicates over.
 *
 * This supersedes scripts/seed-places.ts's generic mock output as the primary test/seed
 * data for these three cities. It does NOT touch scripts/seed-places.ts or delete its
 * output for other cities (Modena, Denver, New York) — only Paris/Rome/London entries from
 * the old mock seed are removed first, so the two scripts can coexist without duplicate or
 * conflicting city coverage.
 *
 * Run manually — this does NOT run automatically on server boot:
 *   npx tsx scripts/seed-curated-places.ts
 */
import dotenv from 'dotenv';
import connectToDatabase from '../lib/mongodb';
import Place from '../models/Place';

dotenv.config({ quiet: true });

type Category = 'Restaurant' | 'Activity' | 'Event';

interface CuratedPlace {
  name: string;
  city: string;
  category: Category;
  genre: string;
  rating: number;
  description: string;
  estimatedDuration: number;
  distanceKm: number;
}

// Genres drawn only from constants/preferences.ts's real taxonomy (FOOD_GENRES_CATEGORIZED /
// ACTIVITY_GENRES_CATEGORIZED / EVENT_GENRES_CATEGORIZED), so tag-intersection matching
// against real user preferences has something meaningful to work with.
const PLACES: CuratedPlace[] = [
  // ---- PARIS ----
  { name: 'Le Comptoir du Relais', city: 'Paris', category: 'Restaurant', genre: 'French', rating: 4.7, description: 'Classic Left Bank bistro serving traditional French comfort food in a cozy, bustling room.', estimatedDuration: 90, distanceKm: 2.1 },
  { name: "L'Ami Jean", city: 'Paris', category: 'Restaurant', genre: 'French', rating: 4.8, description: 'Hearty Basque-influenced French fare in a lively, wood-paneled dining room.', estimatedDuration: 100, distanceKm: 3.4 },
  { name: 'Septime', city: 'Paris', category: 'Restaurant', genre: 'Fine Dining', rating: 4.9, description: 'Modern tasting-menu restaurant with a seasonal, produce-driven approach, one of the city\'s top tables.', estimatedDuration: 150, distanceKm: 4.8 },
  { name: 'Breizh Café', city: 'Paris', category: 'Restaurant', genre: 'French', rating: 4.6, description: 'Buckwheat galettes and craft cider in a bright, modern crêperie in Le Marais.', estimatedDuration: 60, distanceKm: 1.9 },
  { name: 'Chez Janou', city: 'Paris', category: 'Restaurant', genre: 'Mediterranean', rating: 4.5, description: 'Provençal cooking on a leafy square, famous for its bottomless bowl of chocolate mousse.', estimatedDuration: 90, distanceKm: 2.3 },
  { name: 'Kunitoraya', city: 'Paris', category: 'Restaurant', genre: 'Japanese', rating: 4.6, description: 'Udon noodle specialist near the Palais-Royal, popular for its rich broths.', estimatedDuration: 45, distanceKm: 1.5 },
  { name: 'Le Grand Véfour', city: 'Paris', category: 'Restaurant', genre: 'Fine Dining', rating: 4.8, description: 'Historic 18th-century dining room under the Palais-Royal arcades, Michelin-starred classic French cuisine.', estimatedDuration: 150, distanceKm: 1.4 },
  { name: 'Bouillon Pigalle', city: 'Paris', category: 'Restaurant', genre: 'Fast Food', rating: 4.4, description: 'Budget-friendly, no-reservations French brasserie serving generous classic dishes fast.', estimatedDuration: 60, distanceKm: 4.0 },
  { name: 'Ladurée Champs-Élysées', city: 'Paris', category: 'Restaurant', genre: 'Cafes', rating: 4.5, description: 'Elegant tearoom famous for macarons and pastries on the Champs-Élysées.', estimatedDuration: 45, distanceKm: 3.2 },
  { name: 'La Coupole', city: 'Paris', category: 'Restaurant', genre: 'Seafood', rating: 4.5, description: 'Grand Art Deco brasserie in Montparnasse known for its seafood platters.', estimatedDuration: 100, distanceKm: 3.9 },

  { name: 'The Louvre', city: 'Paris', category: 'Activity', genre: 'Museums', rating: 4.9, description: 'The world\'s largest art museum, home to the Mona Lisa and Venus de Milo.', estimatedDuration: 180, distanceKm: 1.5 },
  { name: "Musée d'Orsay", city: 'Paris', category: 'Activity', genre: 'Museums', rating: 4.8, description: 'Impressionist and post-Impressionist masterpieces in a converted Belle Époque train station.', estimatedDuration: 150, distanceKm: 2.0 },
  { name: 'Eiffel Tower Summit', city: 'Paris', category: 'Activity', genre: 'Viewpoints', rating: 4.7, description: 'Ascend the city\'s icon for panoramic views over the Seine and beyond.', estimatedDuration: 120, distanceKm: 4.5 },
  { name: 'Montmartre Walking Tour', city: 'Paris', category: 'Activity', genre: 'Walking Tours', rating: 4.7, description: 'Wander cobbled streets, artist squares, and the steps up to Sacré-Cœur.', estimatedDuration: 120, distanceKm: 5.1 },
  { name: 'Seine River Cruise', city: 'Paris', category: 'Activity', genre: 'Boat Cruises', rating: 4.6, description: 'An hour gliding past Notre-Dame, the Louvre, and the Eiffel Tower from the water.', estimatedDuration: 60, distanceKm: 2.4 },
  { name: 'Le Marais Cycling Tour', city: 'Paris', category: 'Activity', genre: 'Cycling', rating: 4.5, description: 'Guided bike route through historic Le Marais and along the Seine.', estimatedDuration: 150, distanceKm: 3.0 },
  { name: 'Catacombs of Paris', city: 'Paris', category: 'Activity', genre: 'Monuments', rating: 4.6, description: 'Descend into ossuary tunnels lined with the remains of six million Parisians.', estimatedDuration: 90, distanceKm: 4.2 },
  { name: 'Marché des Enfants Rouges', city: 'Paris', category: 'Activity', genre: 'Local Markets', rating: 4.5, description: 'Paris\'s oldest covered market, a maze of food stalls in the Marais.', estimatedDuration: 60, distanceKm: 2.2 },
  { name: 'Jardin du Luxembourg', city: 'Paris', category: 'Activity', genre: 'Parks', rating: 4.7, description: 'Elegant palace gardens with fountains, orchards, and shaded paths.', estimatedDuration: 75, distanceKm: 2.8 },
  { name: 'Musée Rodin Sculpture Garden', city: 'Paris', category: 'Activity', genre: 'Galleries', rating: 4.6, description: 'The Thinker and other Rodin works displayed in a rose-filled garden.', estimatedDuration: 90, distanceKm: 3.6 },

  // ---- ROME ----
  { name: 'Roscioli', city: 'Rome', category: 'Restaurant', genre: 'Italian', rating: 4.8, description: 'Legendary deli-restaurant near Campo de\' Fiori famous for its cacio e pepe and salumi.', estimatedDuration: 90, distanceKm: 1.0 },
  { name: 'Armando al Pantheon', city: 'Rome', category: 'Restaurant', genre: 'Italian', rating: 4.7, description: 'Family-run trattoria steps from the Pantheon, serving Roman classics since 1961.', estimatedDuration: 90, distanceKm: 0.3 },
  { name: 'Trattoria Da Enzo', city: 'Rome', category: 'Restaurant', genre: 'Italian', rating: 4.7, description: 'Tiny, always-packed Trastevere trattoria serving authentic Roman pasta dishes.', estimatedDuration: 90, distanceKm: 2.5 },
  { name: 'Pizzarium Bonci', city: 'Rome', category: 'Restaurant', genre: 'Street Food', rating: 4.7, description: 'Gourmet pizza al taglio by the slice from renowned baker Gabriele Bonci.', estimatedDuration: 30, distanceKm: 3.8 },
  { name: 'La Pergola', city: 'Rome', category: 'Restaurant', genre: 'Fine Dining', rating: 4.9, description: 'Three-Michelin-star rooftop dining with sweeping views over Rome.', estimatedDuration: 180, distanceKm: 6.5 },
  { name: 'Sant Eustachio Il Caffè', city: 'Rome', category: 'Restaurant', genre: 'Cafes', rating: 4.6, description: 'One of Rome\'s most celebrated espresso bars, roasting since 1938.', estimatedDuration: 20, distanceKm: 0.6 },
  { name: 'Da Enzo al 29', city: 'Rome', category: 'Restaurant', genre: 'Italian', rating: 4.6, description: 'Trastevere institution for carbonara and classic Roman cucina povera.', estimatedDuration: 90, distanceKm: 2.6 },
  { name: 'Il Sorpasso', city: 'Rome', category: 'Restaurant', genre: 'Mediterranean', rating: 4.5, description: 'Modern wine bar and kitchen near the Vatican with a seasonal Mediterranean menu.', estimatedDuration: 90, distanceKm: 4.1 },
  { name: 'Supplizio', city: 'Rome', category: 'Restaurant', genre: 'Street Food', rating: 4.5, description: 'Gourmet supplì (fried rice croquettes) done right, a quick Roman street-food classic.', estimatedDuration: 20, distanceKm: 1.2 },
  { name: 'Giolitti', city: 'Rome', category: 'Restaurant', genre: 'Cafes', rating: 4.6, description: 'Historic gelateria near the Pantheon serving Rome\'s classic gelato since 1900.', estimatedDuration: 30, distanceKm: 0.5 },

  { name: 'Colosseum & Roman Forum', city: 'Rome', category: 'Activity', genre: 'Monuments', rating: 4.9, description: 'Walk through the ancient amphitheater and the ruins of the Roman Forum.', estimatedDuration: 150, distanceKm: 2.2 },
  { name: 'Vatican Museums & Sistine Chapel', city: 'Rome', category: 'Activity', genre: 'Museums', rating: 4.8, description: "Michelangelo's ceiling and centuries of papal art collections.", estimatedDuration: 180, distanceKm: 5.0 },
  { name: 'Trastevere Evening Walk', city: 'Rome', category: 'Activity', genre: 'Walking Tours', rating: 4.7, description: 'Cobblestone lanes, ivy-covered facades, and lively piazzas across the river.', estimatedDuration: 90, distanceKm: 2.4 },
  { name: 'Trevi Fountain & Spanish Steps', city: 'Rome', category: 'Activity', genre: 'Viewpoints', rating: 4.6, description: 'Two of Rome\'s most iconic landmarks, best seen on foot at golden hour.', estimatedDuration: 60, distanceKm: 1.3 },
  { name: 'Borghese Gallery Bike Ride', city: 'Rome', category: 'Activity', genre: 'Cycling', rating: 4.6, description: 'Rent a bike and explore the sprawling gardens surrounding the Borghese Gallery.', estimatedDuration: 90, distanceKm: 3.5 },
  { name: 'Campo de\' Fiori Market', city: 'Rome', category: 'Activity', genre: 'Local Markets', rating: 4.4, description: 'Bustling open-air produce and flower market in a historic square.', estimatedDuration: 45, distanceKm: 1.1 },
  { name: 'Villa Borghese Gardens', city: 'Rome', category: 'Activity', genre: 'Parks', rating: 4.7, description: 'Rome\'s green heart, with a lake, viewpoints, and shaded avenues.', estimatedDuration: 90, distanceKm: 3.6 },
  { name: 'Baths of Caracalla', city: 'Rome', category: 'Activity', genre: 'Monuments', rating: 4.6, description: 'Monumental ruins of an ancient Roman bathing complex, far quieter than the Colosseum.', estimatedDuration: 75, distanceKm: 3.1 },
  { name: 'MAXXI Contemporary Art Museum', city: 'Rome', category: 'Activity', genre: 'Galleries', rating: 4.4, description: 'Striking Zaha Hadid-designed museum of 21st-century art and architecture.', estimatedDuration: 90, distanceKm: 6.8 },
  { name: 'Appian Way Cycling Trail', city: 'Rome', category: 'Activity', genre: 'Cycling', rating: 4.5, description: 'Ride the ancient Roman road past catacombs and countryside villas.', estimatedDuration: 150, distanceKm: 7.2 },

  // ---- LONDON ----
  { name: 'Dishoom Covent Garden', city: 'London', category: 'Restaurant', genre: 'Fine Dining', rating: 4.7, description: 'Bombay café-inspired dining with legendary bacon naan rolls and black daal.', estimatedDuration: 75, distanceKm: 1.8 },
  { name: 'St. JOHN', city: 'London', category: 'Restaurant', genre: 'Fine Dining', rating: 4.6, description: 'Nose-to-tail British cooking in a stark, whitewashed Smithfield dining room.', estimatedDuration: 100, distanceKm: 2.4 },
  { name: 'Padella', city: 'London', category: 'Restaurant', genre: 'Italian', rating: 4.6, description: 'Compact, always-queuing pasta bar near Borough Market with handmade pasta.', estimatedDuration: 45, distanceKm: 2.0 },
  { name: 'Franco Manca', city: 'London', category: 'Restaurant', genre: 'Italian', rating: 4.4, description: 'Sourdough Neapolitan-style pizza chain that started in Brixton Market.', estimatedDuration: 45, distanceKm: 5.5 },
  { name: 'Poppies Fish & Chips', city: 'London', category: 'Restaurant', genre: 'Fast Food', rating: 4.5, description: 'Retro 1950s-style chippy in Spitalfields serving classic British fish and chips.', estimatedDuration: 40, distanceKm: 3.0 },
  { name: 'Sketch (The Gallery)', city: 'London', category: 'Restaurant', genre: 'Fine Dining', rating: 4.5, description: 'Whimsical pink dining room in Mayfair, equal parts art installation and afternoon tea.', estimatedDuration: 90, distanceKm: 2.9 },
  { name: 'Borough Market Food Stalls', city: 'London', category: 'Restaurant', genre: 'Street Food', rating: 4.6, description: 'One of London\'s oldest food markets, dozens of stalls under a Victorian train shed.', estimatedDuration: 60, distanceKm: 1.9 },
  { name: 'Hoppers Soho', city: 'London', category: 'Restaurant', genre: 'Street Food', rating: 4.5, description: 'Sri Lankan and South Indian small plates, famed for its bowl-shaped hoppers.', estimatedDuration: 60, distanceKm: 1.6 },
  { name: 'Monmouth Coffee', city: 'London', category: 'Restaurant', genre: 'Cafes', rating: 4.6, description: 'Beloved specialty coffee roaster with a queue-out-the-door Borough Market outpost.', estimatedDuration: 25, distanceKm: 1.9 },
  { name: 'Sweetings', city: 'London', category: 'Restaurant', genre: 'Seafood', rating: 4.5, description: 'City of London seafood institution open for lunch only since 1889.', estimatedDuration: 75, distanceKm: 3.3 },

  { name: 'British Museum', city: 'London', category: 'Activity', genre: 'Museums', rating: 4.8, description: 'World-spanning collection including the Rosetta Stone and Parthenon sculptures, free entry.', estimatedDuration: 150, distanceKm: 1.4 },
  { name: 'Tate Modern', city: 'London', category: 'Activity', genre: 'Galleries', rating: 4.7, description: 'Modern and contemporary art in a converted power station on the Thames.', estimatedDuration: 120, distanceKm: 2.7 },
  { name: 'Tower of London', city: 'London', category: 'Activity', genre: 'Monuments', rating: 4.7, description: 'Historic castle and home of the Crown Jewels, with Beefeater guided tours.', estimatedDuration: 150, distanceKm: 3.6 },
  { name: 'London Eye', city: 'London', category: 'Activity', genre: 'Viewpoints', rating: 4.5, description: 'Giant observation wheel on the South Bank with skyline views over the Thames.', estimatedDuration: 45, distanceKm: 2.5 },
  { name: 'South Bank Thames Walk', city: 'London', category: 'Activity', genre: 'Walking Tours', rating: 4.7, description: 'Riverside promenade past the Globe, Tate Modern, and Big Ben views.', estimatedDuration: 90, distanceKm: 2.2 },
  { name: 'Thames River Cruise', city: 'London', category: 'Activity', genre: 'Boat Cruises', rating: 4.5, description: 'Sightseeing boat past Westminster, the Tower, and Greenwich.', estimatedDuration: 60, distanceKm: 2.8 },
  { name: 'Hyde Park & Kensington Gardens', city: 'London', category: 'Activity', genre: 'Parks', rating: 4.7, description: 'Sprawling royal park with the Serpentine lake and Kensington Palace grounds.', estimatedDuration: 90, distanceKm: 4.0 },
  { name: 'Camden Market', city: 'London', category: 'Activity', genre: 'Local Markets', rating: 4.4, description: 'Sprawling alternative market of stalls, street food, and vintage shops by the canal.', estimatedDuration: 90, distanceKm: 5.8 },
  { name: 'Santander Cycles Royal Parks Loop', city: 'London', category: 'Activity', genre: 'Cycling', rating: 4.4, description: 'Rent a city bike and ride the connected loop through Hyde Park and Green Park.', estimatedDuration: 90, distanceKm: 6.0 },
  { name: 'Natural History Museum', city: 'London', category: 'Activity', genre: 'Museums', rating: 4.8, description: 'Dinosaur skeletons and a blue whale beneath a cathedral-like Victorian roof, free entry.', estimatedDuration: 120, distanceKm: 4.3 },
];

async function seed() {
  await connectToDatabase();

  const cities = Array.from(new Set(PLACES.map(p => p.city)));
  // Remove old generic mock-seed entries for these specific cities only, so the richer
  // curated set becomes the sole source of truth for Paris/Rome/London without leaving
  // stale duplicates (e.g. "Bistro Voltaire") mixed in. Other cities from
  // scripts/seed-places.ts (Modena, Denver, New York) are untouched.
  const removed = await Place.deleteMany({
    city: { $in: cities.map(c => new RegExp(`^${c}$`, 'i')) },
  });
  if (removed.deletedCount > 0) {
    console.log(`Removed ${removed.deletedCount} pre-existing place(s) for ${cities.join(', ')} before reseeding.`);
  }

  const docs = PLACES.map(p => ({
    name: p.name,
    city: p.city,
    category: p.category,
    genre: p.genre,
    tags: [p.category, p.genre],
    rating: p.rating,
    description: p.description,
    estimatedDuration: p.estimatedDuration,
    distanceKm: p.distanceKm,
    source: 'curated' as const,
  }));

  await Place.insertMany(docs);
  console.log(`Seeded ${docs.length} curated places across ${cities.join(', ')}.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
