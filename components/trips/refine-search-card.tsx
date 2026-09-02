import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { TripMock } from '@/lib/trip-types';

// Extracted from app/(tabs)/trips.tsx (was a component defined inline inside the screen's
// render body, re-created on every render). See CHANGELOG.md's cleanliness-audit entry.
//
// "Looking for something else?" — appended after the real suggestions (or shown alone when
// there are none), opens a placeholder modal pre-filled with this day/destination.

interface RefineSearchCardProps {
  trip: TripMock;
  day: { dayLabel: string; date: Date };
  mealWindow: boolean;
  onPress: (trip: TripMock, day: { dayLabel: string; date: Date }, mealWindow: boolean) => void;
}

export function RefineSearchCard({ trip, day, mealWindow, onPress }: RefineSearchCardProps) {
  return (
    <TouchableOpacity
      style={styles.refineCard}
      activeOpacity={0.8}
      onPress={() => onPress(trip, day, mealWindow)}
    >
      <Text style={styles.refineCardIcon}>🔍</Text>
      <Text style={styles.refineCardText}>Looking for{'\n'}something else?</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  refineCard: { backgroundColor: '#1E293B', padding: 20, borderRadius: 20, width: 140, marginRight: 16, borderWidth: 1, borderColor: '#334155', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  refineCardIcon: { fontSize: 24, marginBottom: 10 },
  refineCardText: { color: '#94A3B8', fontSize: 13, fontWeight: '700', textAlign: 'center', lineHeight: 18 },
});
