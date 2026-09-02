// Shared trip/event shapes and small display helpers used by both app/(tabs)/trips.tsx and
// the extracted components/trips/* components (PlaceCard, RefineSearchCard, ContactPicker —
// see components/trips/place-card.tsx and friends). Pulled out specifically so those
// components can import these types/helpers without creating a circular import back into
// trips.tsx itself.

import { API_URL } from './api-client';

export interface EventParticipant {
  user_id: string;
  invited_by: string;
  status: 'pending' | 'accepted' | 'declined';
}

export interface TripEvent {
  _id: string;
  trip_id: string;
  created_by: string;
  source: 'created' | 'imported';
  title: string;
  start_time: string;
  end_time: string;
  place_id?: string;
  place_name?: string;
  participants: EventParticipant[];
}

export interface TripBaseLocation {
  label: string;
  lat: number;
  lng: number;
  source: 'hotel' | 'city';
  startDate: string;
  endDate: string;
}

export interface TripMock {
  id: string;
  destination: string;
  startDate: Date;
  endDate: Date;
  timezone: string;
  sharedWithCircles: string[];
  dismissedSlots?: string[];
  baseLocations?: TripBaseLocation[];
}

// Sub-kilometer distances read as more useful in meters ("450m away" vs "0.5km away") — matches
// how a "near your hotel" walkable distance is actually judged.
export const formatDistanceLabel = (km: number) => (km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`);

// Every card/detail-modal thumbnail points at this same server-side proxy (never at
// googleapis.com directly) — see GET /api/places/:id/photo in server.ts for why: resolving a
// Google photoRef into real image bytes needs GOOGLE_PLACES_API_KEY, which must never leave
// the server. Only call this when place.hasPhoto is true — the endpoint 404s otherwise.
export const placePhotoUri = (placeId: string) => `${API_URL}/api/places/${placeId}/photo`;
