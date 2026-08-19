import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { DEFAULT_CIRCLES } from '@/lib/contacts';

interface CircleShareSelectorProps {
  selected: string[];
  onToggle: (circle: string) => void;
  label?: string;
  helperText?: string;
}

// Multi-select circle picker used for both "share this trip" (trips.tsx) and "share my
// homebase" (profile.tsx) — same bubble-toggle pattern as the app's other multi-selects
// (see components/ui/categorized-picker.tsx), but flat rather than categorized, since
// DEFAULT_CIRCLES isn't grouped. Empty selection = fully private, the default everywhere
// this is used.
export function CircleShareSelector({ selected, onToggle, label = 'Share with', helperText }: CircleShareSelectorProps) {
  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={styles.label}>{label}</Text>
      {helperText && <Text style={styles.helperText}>{helperText}</Text>}
      <View style={styles.bubblesContainer}>
        {DEFAULT_CIRCLES.map(circle => {
          const active = selected.includes(circle);
          return (
            <TouchableOpacity
              key={circle}
              style={[styles.bubbleOption, active && styles.bubbleOptionActive]}
              onPress={() => onToggle(circle)}
              activeOpacity={0.7}
            >
              <Text style={[styles.bubbleOptionText, active && styles.bubbleOptionTextActive]}>{circle}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {selected.length === 0 && (
        <Text style={styles.privateNote}>🔒 Private — not shared with anyone yet.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: '#E2E8F0', fontSize: 14, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 },
  helperText: { color: '#64748B', fontSize: 13, lineHeight: 18, marginBottom: 12 },
  bubblesContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  bubbleOption: { backgroundColor: '#1E293B', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#334155' },
  bubbleOptionActive: { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: '#10B981' },
  bubbleOptionText: { color: '#94A3B8', fontSize: 14, fontWeight: '600' },
  bubbleOptionTextActive: { color: '#10B981' },
  privateNote: { color: '#64748B', fontSize: 12, marginTop: 10, fontStyle: 'italic' },
});
