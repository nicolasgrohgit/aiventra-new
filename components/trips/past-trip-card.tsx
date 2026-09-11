import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { TripMock, placePhotoUri } from '@/lib/trip-types';

interface PastTripCardProps {
  trip: TripMock;
  cityPhotoId?: string | null;
  formatTripDate: (d: Date, tz: string) => string;
  onDelete: () => void;
}

// Deliberately lightweight — a past trip has no AI Schedule Proposals, free-time computation,
// or nearby-friends lookup to run (none of that applies to a trip that's already happened), so
// this renders straight from data the screen already has rather than mirroring the full
// current/upcoming trip card. View + delete only, per the approved "Past trips" design (see
// project_past_trips_retention in the assistant's memory).
export function PastTripCard({ trip, cityPhotoId, formatTripDate, onDelete }: PastTripCardProps) {
  return (
    <View style={styles.card}>
      {cityPhotoId ? (
        <Image source={{ uri: placePhotoUri(cityPhotoId) }} style={styles.photo} />
      ) : null}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.destination}>{trip.destination}</Text>
          <Text style={styles.dates}>
            {formatTripDate(trip.startDate, trip.timezone)} – {formatTripDate(trip.endDate, trip.timezone)}
          </Text>
        </View>
        <TouchableOpacity onPress={onDelete} style={styles.deleteBtn}>
          <Text style={{ fontSize: 18 }}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#0F172A', borderRadius: 20, marginBottom: 16, borderWidth: 1, borderColor: '#1E293B', overflow: 'hidden' },
  photo: { width: '100%', height: 100, backgroundColor: '#1E293B' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18 },
  destination: { color: '#E2E8F0', fontSize: 20, fontWeight: '800' },
  dates: { color: '#64748B', fontSize: 14, fontWeight: '600', marginTop: 4 },
  deleteBtn: { padding: 8, backgroundColor: '#450a0a', borderRadius: 10, borderWidth: 1, borderColor: '#7f1d1d' },
});
