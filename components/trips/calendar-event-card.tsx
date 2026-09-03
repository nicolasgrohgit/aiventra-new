import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { TripEvent } from '@/lib/trip-types';
import { MapsDestination } from '@/lib/maps-link';

// A real imported (device-calendar-synced) event that classifyImportedEvent (see
// lib/calendar-signals.ts) has recognized as `dining` — surfaced directly in the "Current
// Schedule" timeline (app/(tabs)/trips.tsx) instead of the plain busy-row text every other
// imported event still gets. Deliberately its own small component rather than reusing
// PlaceCard: this isn't a Place (no rating/category/photo/matchScore — those fields don't
// exist for a raw calendar event), and per docs/calendar-signal-detection-plan.md's Part C
// mockup it needs to read as visually distinct from both PlaceCard's "✓ Scheduled" badge and
// its green match-score badge — a "📅 From your calendar" badge instead, since this is
// something the user already has planned, not an AI suggestion or a booking made in-app.
//
// The Navigate action reuses the exact same handleNavigate/buildMapsUrl plumbing every other
// card's tap-to-navigate action uses (see trips.tsx's "Single integration point" comment on
// handleNavigate) — no reason to reinvent map-link building just because this card's data
// came from a synced calendar instead of a Place doc.

interface CalendarEventCardProps {
  event: TripEvent;
  onNavigate: (place: MapsDestination) => void;
}

export function CalendarEventCard({ event, onNavigate }: CalendarEventCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>📅 From your calendar</Text>
        </View>
      </View>
      {event.location ? (
        <TouchableOpacity
          style={styles.addressRow}
          activeOpacity={0.7}
          onPress={() => onNavigate({ name: event.title, address: event.location })}
        >
          <Text style={styles.addressIcon}>📍</Text>
          <Text style={styles.addressText} numberOfLines={1}>{event.location}</Text>
          <Text style={styles.navigateChevron}>Navigate ›</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// Same palette PlaceCard/RefineSearchCard already use (navy #0F172A background, #1E293B
// cards, #334155 borders, #3B82F6 accent) — pulled from trips.tsx's own StyleSheet, matching
// the Part C mockup's use of the app's real colors rather than inventing new ones.
const styles = StyleSheet.create({
  card: { backgroundColor: '#1E293B', padding: 20, borderRadius: 20, marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  title: { color: '#F8FAFC', fontSize: 18, fontWeight: '800', flex: 1, marginRight: 10 },
  // Deliberately a muted/outline treatment (not PlaceCard's solid green "match" or blue
  // "✓ Scheduled" fills) — this isn't an AI proposal or an in-app booking, so it shouldn't
  // read as either.
  badge: { backgroundColor: '#334155', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText: { color: '#CBD5E1', fontSize: 11, fontWeight: '800' },
  addressRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, marginTop: 4, borderWidth: 1, borderColor: '#334155' },
  addressIcon: { fontSize: 16, marginRight: 8 },
  addressText: { color: '#CBD5E1', fontSize: 13, flex: 1 },
  navigateChevron: { color: '#3B82F6', fontSize: 13, fontWeight: '800', marginLeft: 10 },
});
