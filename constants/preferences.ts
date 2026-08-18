// Categorized taste-preference options, shared by onboarding and Profile's "Edit" modals.

export interface PreferenceCategoryGroup {
  type: string;
  activities: string[];
}

export const FOOD_GENRES_CATEGORIZED: PreferenceCategoryGroup[] = [
  { type: 'European', activities: ['Italian', 'French', 'Mediterranean'] },
  { type: 'Asian', activities: ['Japanese', 'Chinese', 'Thai'] },
  { type: 'Americas', activities: ['Mexican', 'American', 'Brazilian'] },
  { type: 'Dining Style', activities: ['Fine Dining', 'Fast Food', 'Street Food'] },
  { type: 'Specialty', activities: ['Seafood', 'Steakhouses', 'Cafes'] },
];

export const ACTIVITY_GENRES_CATEGORIZED: PreferenceCategoryGroup[] = [
  { type: 'Attractions & Sights', activities: ['Museums', 'Monuments', 'Viewpoints'] },
  { type: 'Tours & Excursions', activities: ['Walking Tours', 'Boat Cruises', 'Bus Tours'] },
  { type: 'Outdoor & Nature', activities: ['Hiking', 'Cycling', 'Water Sports'] },
  { type: 'Arts & Culture', activities: ['Galleries', 'Workshops', 'Local Markets'] },
  { type: 'Relaxation', activities: ['Spas', 'Parks', 'Scenic Drives'] },
];

export const EVENT_GENRES_CATEGORIZED: PreferenceCategoryGroup[] = [
  { type: 'Performing Arts', activities: ['Theater', 'Ballet', 'Opera'] },
  { type: 'Live Music', activities: ['Concerts', 'Festivals', 'DJ Sets'] },
  { type: 'Entertainment', activities: ['Comedy Shows', 'Cinema', 'Magic Shows'] },
  { type: 'Sports', activities: ['Football', 'Basketball', 'Tennis'] },
  { type: 'Culture', activities: ['Exhibitions', 'Markets', 'Parades'] },
];
