import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

// Extracted from app/(tabs)/trips.tsx (was a component defined inline inside the screen's
// render body, re-created on every render). See CHANGELOG.md's cleanliness-audit entry.
//
// selectedId/onSelect deal in Contact._id (c.id) — what participantContactIds actually needs
// server-side (see POST /api/trips/:tripId/events). Previously this picked c.contact_user_id
// (the linked User's id) instead, which would have made every real invite fail with "not
// found in your circle" — never caught because nothing in that session could actually run the
// RN UI, only the API directly.

export interface ContactPickerEntry {
  id: string;
  name: string;
}

interface ContactPickerProps {
  contacts: ContactPickerEntry[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function ContactPicker({ contacts, selectedId, onSelect }: ContactPickerProps) {
  if (contacts.length === 0) {
    return (
      <Text style={styles.emptyText}>
        No linked friends yet — invite someone from the Circles tab, and once they join Odys.ai they&apos;ll show up here.
      </Text>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      {contacts.map((c) => {
        const selected = selectedId === c.id;
        return (
          <TouchableOpacity
            key={c.id}
            style={[styles.eventSelectRow, selected && styles.eventSelectRowActive]}
            onPress={() => onSelect(selected ? null : c.id)}
          >
            <View style={[styles.checkboxNative, selected && styles.checkboxNativeActive]}>
              <Text style={styles.checkboxText}>{selected ? '✓' : ''}</Text>
            </View>
            <Text style={[styles.eventSelectName, selected && styles.eventSelectNameActive]}>{c.name}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyText: { color: '#64748B', fontStyle: 'italic', textAlign: 'center', marginTop: 30 },
  eventSelectRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, backgroundColor: '#0F172A', borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#1E293B' },
  eventSelectRowActive: { borderColor: '#10B981', backgroundColor: '#10B98110' },
  checkboxNative: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#334155', marginRight: 16, justifyContent: 'center', alignItems: 'center' },
  checkboxNativeActive: { backgroundColor: '#10B981', borderColor: '#10B981' },
  checkboxText: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  eventSelectName: { color: '#94A3B8', fontSize: 16, fontWeight: '700' },
  eventSelectNameActive: { color: '#F8FAFC' },
});
