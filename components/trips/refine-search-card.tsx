import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { TripMock } from '@/lib/trip-types';
import { SlotProposal } from '@/lib/calendar';

// Extracted from app/(tabs)/trips.tsx (was a component defined inline inside the screen's
// render body, re-created on every render). See CHANGELOG.md's cleanliness-audit entry.
//
// "Looking for something else?" — appended after the real suggestions (or shown alone when
// there are none), opens a placeholder modal pre-filled with this day/destination.
//
// Takes the originating `proposal` itself (not just a derived `mealWindow` boolean) so
// openRefineSearch (trips.tsx) can seed the form's Time/Duration from the same
// startTime/durationMinutes this card's own mealWindow computation already reads from — see
// CHANGELOG's refine-search-defaults fix. mealWindow's own derivation (proposal.type ===
// 'meal') is unchanged, just computed inline here instead of passed in separately.

interface RefineSearchCardProps {
  trip: TripMock;
  day: { dayLabel: string; date: Date };
  proposal: SlotProposal;
  onPress: (trip: TripMock, day: { dayLabel: string; date: Date }, proposal: SlotProposal) => void;
}

export function RefineSearchCard({ trip, day, proposal, onPress }: RefineSearchCardProps) {
  return (
    <TouchableOpacity
      style={styles.refineCard}
      activeOpacity={0.8}
      onPress={() => onPress(trip, day, proposal)}
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
