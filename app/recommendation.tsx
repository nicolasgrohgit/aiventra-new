import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Alert, Image, Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Calendar from 'expo-calendar';
import { useAuth } from '@/hooks/useAuth';
import { useEvents } from '@/hooks/useEvents';
import { PlaceRecommendation, displayCategory } from '@/lib/recommendations';
import { buildMapsUrl } from '@/lib/maps-link';
import { API_URL } from '@/lib/api-client';
import { useEffect, useState } from 'react';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';

// Sub-kilometer distances read as more useful in meters — matches the same formatting used on
// trips.tsx's recommendation cards.
const formatDistanceLabel = (km: number) => (km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`);

// Points at the server-side photo proxy (GET /api/places/:id/photo in server.ts), never at
// googleapis.com directly — see that route's comment for why (GOOGLE_PLACES_API_KEY never
// leaves the server). Only call when place.hasPhoto is true.
const placePhotoUri = (placeId: string) => `${API_URL}/api/places/${placeId}/photo`;

export default function SuggestionsScreen() {
  const { duration, start, end, cityContext, lat, lng } = useLocalSearchParams();
  const { user } = useAuth();
  const { getRecommendations } = useEvents();
  const router = useRouter();
  const [recommendations, setRecommendations] = useState<PlaceRecommendation[]>([]);
  const [isComputing, setIsComputing] = useState(true);
  // undefined = default "near me" ceiling (DEFAULT_MAX_DISTANCE_KM, 5km server-side). Set by
  // handleExpandRadius below once the user asks for a wider search.
  const [maxDistanceKm, setMaxDistanceKm] = useState<number | undefined>(undefined);

  const city = (cityContext as string) || user?.homebase || '';
  const durationMins = parseInt(duration as string, 10);
  const durationLabel = durationMins >= 60
    ? `${Math.floor(durationMins / 60)}h${durationMins % 60 > 0 ? ` ${durationMins % 60}min` : ''}`
    : `${durationMins}min`;

  useEffect(() => {
    if (!duration || !start) return;
    let cancelled = false;
    setIsComputing(true);
    const anchorLat = typeof lat === 'string' ? parseFloat(lat) : NaN;
    const anchorLng = typeof lng === 'string' ? parseFloat(lng) : NaN;
    getRecommendations({
      city: city || 'New York, USA',
      durationMinutes: durationMins,
      startTimeIso: start as string,
      ...(maxDistanceKm !== undefined ? { maxDistanceKm } : {}),
      // The real device GPS point (see index.tsx's handleSuggest) beats any trip-based anchor
      // — it's genuinely where the user is right now, not an approximation.
      ...(!Number.isNaN(anchorLat) && !Number.isNaN(anchorLng) ? { anchorLat, anchorLng } : {})
    })
      .then(places => {
        if (!cancelled) setRecommendations(places.map((p: any) => ({ ...p, id: p._id })));
      })
      .catch(() => {
        if (!cancelled) setRecommendations([]);
      })
      .finally(() => {
        if (!cancelled) setIsComputing(false);
      });
    return () => { cancelled = true; };
  }, [duration, durationMins, city, start, maxDistanceKm, getRecommendations, lat, lng]);

  // Re-runs the same query with the "near me" ceiling raised well past the 5km default —
  // 25km stays within a single metro area (a taxi/transit ride, not a day trip), which fits
  // "free time near your hotel" better than an uncapped search would. Once expanded, the
  // button gives way to a static note rather than staying tappable — a second tap at the same
  // ceiling can't surface anything new, so offering it again would just be misleading.
  const handleExpandRadius = () => {
    setMaxDistanceKm(25);
  };

  // Always creates a new, separate calendar entry — never touches an existing event
  // (including one that was already busy, e.g. reached via "Scheduled Conflicts" on the
  // Home tab). A suggestion is something to add alongside your schedule, not something
  // that should silently overwrite a real meeting's title/location/notes.
  // Google Maps universal link — opens Apple Maps on iOS (OS-level interception), Google Maps
  // on Android, browser fallback otherwise. Nested inside the card's own TouchableOpacity
  // (which schedules the suggestion on tap): React Native's touch responder system resolves to
  // whichever TouchableOpacity is innermost, so this doesn't also fire handleSelectPlace.
  const handleNavigate = (place: PlaceRecommendation) => {
    Linking.openURL(buildMapsUrl(place)).catch(() => {
      Alert.alert('Error', 'Could not open Maps.');
    });
  };

  const handleSelectPlace = async (place: PlaceRecommendation) => {
    try {
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const writableCalendars = calendars.filter(c => c.allowsModifications);

      if (writableCalendars.length > 0) {
        await Calendar.createEventAsync(writableCalendars[0].id, {
          title: place.name,
          location: `${place.name}, ${place.city}`,
          startDate: new Date(start as string),
          endDate: new Date(end as string),
          notes: place.description
        });
        Alert.alert('Success!', 'Added this suggestion to your device calendar as a new event.');
      } else {
        Alert.alert('Scheduled!', `Added "${place.name}" to your schedule!`);
      }
      router.back();
    } catch (e: any) {
      Alert.alert('Error', 'Could not add to calendar: ' + e.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Smart Suggestions</Text>
      <Text style={styles.subtitle}>
        {durationLabel} free window{city ? ` · ${city}` : ''}
      </Text>
      
      <View style={styles.separator} />
      
      <ScrollView contentContainerStyle={styles.scroll}>
        {isComputing ? (
          <Animated.View entering={FadeIn} style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.loadingText}>Odys.ai Engine is analyzing your preferences...</Text>
            
            {/* Skeleton Placeholders */}
            {[1, 2, 3].map((key) => (
              <View key={key} style={styles.skeletonCard}>
                <View style={styles.skeletonHeader} />
                <View style={styles.skeletonRow} />
                <View style={[styles.skeletonRow, { width: '60%' }]} />
              </View>
            ))}
          </Animated.View>
        ) : recommendations.length === 0 ? (
          <Animated.View entering={FadeIn}>
            <Text style={styles.emptyText}>No suggestions fit this time window yet — try a longer slot.</Text>
            {maxDistanceKm === undefined ? (
              <TouchableOpacity style={styles.expandButton} activeOpacity={0.7} onPress={handleExpandRadius}>
                <Text style={styles.expandButtonText}>Expand Search Radius</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.expandedNoteText}>
                Already searching up to {maxDistanceKm}km — nothing fits there either yet.
              </Text>
            )}
          </Animated.View>
        ) : (
          recommendations.map((place, index) => (
            <TouchableOpacity 
              key={place.id}
              activeOpacity={0.7}
              onPress={() => handleSelectPlace(place)}
            >
              <Animated.View 
                entering={FadeInDown.delay(index * 150).springify()}
                style={styles.card}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.placeName}>{place.name}</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{place.matchScore > 0 ? `${place.matchScore} tag match` : 'New idea'}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row' }}>
                  {place.hasPhoto && (
                    <Image source={{ uri: placePhotoUri(place.id) }} style={styles.placeThumb} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.category}>{displayCategory(place)} • {place.estimatedDuration} mins • {formatDistanceLabel(place.distanceKm)} away • {place.rating} ★</Text>
                    <Text style={styles.description}>{place.description}</Text>
                  </View>
                </View>

                {/* Nested touchable — see handleNavigate's comment on why this doesn't also
                    trigger the card's own onPress. Always tappable, even with no address:
                    buildMapsUrl falls back to real coordinates, then a name+city text query. */}
                <TouchableOpacity style={styles.addressRow} activeOpacity={0.7} onPress={() => handleNavigate(place)}>
                  <Text style={styles.addressIcon}>📍</Text>
                  <Text style={styles.addressText} numberOfLines={1}>{place.address || 'Get directions'}</Text>
                  <Text style={styles.navigateChevron}>Navigate ›</Text>
                </TouchableOpacity>

                <View style={{ marginTop: 12, borderTopWidth: 1, borderColor: '#334155', paddingTop: 12 }}>
                  <Text style={{ color: '#F8FAFC', fontWeight: 'bold' }}>Select this option</Text>
                </View>
              </Animated.View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A', padding: 24 },
  scroll: { paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#FFF' },
  subtitle: { fontSize: 16, color: '#94A3B8', marginTop: 4 },
  separator: { marginVertical: 20, height: 1, width: '100%', backgroundColor: '#334155' },
  loadingContainer: { alignItems: 'center', marginTop: 20 },
  loadingText: { color: '#3B82F6', marginTop: 12, marginBottom: 32, fontSize: 16, fontWeight: '600' },
  skeletonCard: { backgroundColor: '#1E293B', padding: 16, borderRadius: 12, marginBottom: 16, width: '100%', opacity: 0.5 },
  skeletonHeader: { height: 20, backgroundColor: '#334155', borderRadius: 4, width: '40%', marginBottom: 16 },
  skeletonRow: { height: 12, backgroundColor: '#334155', borderRadius: 4, width: '100%', marginBottom: 8 },
  emptyText: { color: '#94A3B8', fontStyle: 'italic', lineHeight: 22 },
  expandButton: { marginTop: 20, backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  expandButtonText: { color: '#3B82F6', fontWeight: '700', fontSize: 15 },
  expandedNoteText: { color: '#64748B', fontStyle: 'italic', fontSize: 13, marginTop: 16, textAlign: 'center' },
  card: { backgroundColor: '#1E293B', padding: 16, borderRadius: 12, marginBottom: 16, borderLeftWidth: 3, borderLeftColor: '#3B82F6', borderWidth: 1, borderColor: '#334155' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  placeName: { fontSize: 18, fontWeight: '700', color: '#F8FAFC', flex: 1 },
  badge: { backgroundColor: '#10B981', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  badgeText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  category: { color: '#3B82F6', fontWeight: '600', fontSize: 13, marginBottom: 8 },
  description: { color: '#CBD5E1', fontSize: 14, lineHeight: 20 },
  placeThumb: { width: 56, height: 56, borderRadius: 10, marginRight: 12, backgroundColor: '#334155' },
  addressRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginTop: 12, borderWidth: 1, borderColor: '#334155' },
  addressIcon: { fontSize: 14, marginRight: 6 },
  addressText: { color: '#94A3B8', fontSize: 12, flex: 1 },
  navigateChevron: { color: '#3B82F6', fontSize: 12, fontWeight: '800', marginLeft: 8 }
});
