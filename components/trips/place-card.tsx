import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { PlaceRecommendation, displayCategory } from '@/lib/recommendations';
import { TripEvent, formatDistanceLabel, placePhotoUri } from '@/lib/trip-types';

// Extracted from app/(tabs)/trips.tsx (was a component defined inline inside the screen's
// render body, re-created on every render). See CHANGELOG.md's cleanliness-audit entry.
//
// isPlaceScheduled/findScheduledEventForPlace/handleNavigate are passed in as callbacks
// rather than reimplemented here — they close over trips.tsx's own eventsByTrip/selectedPlace
// state, which stays in the screen, not in this presentational component.

interface PlaceCardProps {
  place: PlaceRecommendation;
  tripId: string;
  slotStart: Date;
  tripEvents: TripEvent[];
  isPlaceScheduled: (tripEvents: TripEvent[], placeId: string) => boolean;
  onPress: (place: PlaceRecommendation, tripId: string, slotStart: Date, existingEvent?: TripEvent) => void;
  onNavigate: (place: PlaceRecommendation) => void;
  // When the caller already knows exactly which Event this card represents (the "Current
  // Schedule" timeline does, rendering directly from a real Event doc), pass it through to
  // onPress instead of leaving the caller to re-derive it via a time-window overlap match.
  existingEvent?: TripEvent;
  // The AI Schedule Proposals flow renders these in a horizontal ScrollView, sized
  // (`placeCard`'s fixed width) to sit alongside siblings; a single-column context like the
  // Current Schedule timeline has no siblings to scroll past, so this swaps in `placeCardWide`
  // instead — same card, same fields, same tap behavior, just not scroll-sized.
  fullWidth?: boolean;
}

export function PlaceCard({ place, tripId, slotStart, tripEvents, isPlaceScheduled, onPress, onNavigate, existingEvent, fullWidth }: PlaceCardProps) {
  // A place already added to this trip (any day) looks identical to an unscheduled one
  // otherwise, which is exactly why tapping "Add to Itinerary" reads as "nothing happened" —
  // it did work, there's just no visible trace of it back on the card you tapped.
  const alreadyScheduled = isPlaceScheduled(tripEvents, place.id);
  return (
    <TouchableOpacity
      style={fullWidth ? styles.placeCardWide : styles.placeCard}
      activeOpacity={0.8}
      onPress={() => onPress(place, tripId, slotStart, existingEvent)}
    >
      <View style={styles.placeHeader}>
        <Text style={styles.placeName} numberOfLines={1}>{place.name}</Text>
        {alreadyScheduled ? (
          <View style={styles.badgeScheduled}><Text style={styles.badgeText}>✓ Scheduled</Text></View>
        ) : (
          <View style={styles.badge}><Text style={styles.badgeText}>{place.matchScore > 0 ? `${place.matchScore} tag match` : 'New idea'}</Text></View>
        )}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {place.hasPhoto && (
          <Image source={{ uri: placePhotoUri(place.id) }} style={styles.placeThumb} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.placeCategory}>{displayCategory(place)} • {place.rating} ★ • {formatDistanceLabel(place.distanceKm)}</Text>
          <Text style={styles.placeDesc} numberOfLines={2}>{place.description}</Text>
        </View>
      </View>
      {/* Same tap-to-navigate as the detail modal (buildMapsUrl always resolves, even with no
          address), but right on the card itself — previously this required opening the detail
          modal first, an extra tap that mattered most for an already-scheduled pick you just
          want directions to. Nested TouchableOpacity resolves to this one over the card's own
          onPress, same pattern as recommendation.tsx's handleNavigate. */}
      <TouchableOpacity
        style={styles.addressRow}
        activeOpacity={0.7}
        onPress={() => onNavigate(place)}
      >
        <Text style={styles.addressIcon}>📍</Text>
        <Text style={styles.placeAddressText} numberOfLines={1}>
          {place.address || 'Get directions'}
        </Text>
        <Text style={styles.navigateChevron}>Navigate ›</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  placeCard: { backgroundColor: '#1E293B', padding: 20, borderRadius: 20, width: 280, marginRight: 16, borderWidth: 1, borderColor: '#334155' },
  // Matches app/(tabs)/trips.tsx's own placeCardWide (used there for the joint-recommendation
  // and refine-search results lists) — duplicated here since this component has its own
  // StyleSheet, not trips.tsx's.
  placeCardWide: { backgroundColor: '#1E293B', padding: 20, borderRadius: 20, marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  placeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  placeName: { color: '#F8FAFC', fontSize: 18, fontWeight: '800', flex: 1 },
  badge: { backgroundColor: '#10B981', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeScheduled: { backgroundColor: '#3B82F6', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  placeCategory: { color: '#3B82F6', fontWeight: '700', fontSize: 13, marginBottom: 10 },
  placeDesc: { color: '#94A3B8', fontSize: 14, lineHeight: 22 },
  placeThumb: { width: 56, height: 56, borderRadius: 12, marginRight: 12, backgroundColor: '#334155' },
  addressRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, marginTop: 16, borderWidth: 1, borderColor: '#334155' },
  addressIcon: { fontSize: 16, marginRight: 8 },
  placeAddressText: { color: '#CBD5E1', fontSize: 13, flex: 1 },
  navigateChevron: { color: '#3B82F6', fontSize: 13, fontWeight: '800', marginLeft: 10 },
});
