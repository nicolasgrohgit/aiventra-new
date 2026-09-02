import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

// Extracted from app/(tabs)/profile.tsx (was a component defined inline inside the screen's
// render body, re-created on every render). See CHANGELOG.md's cleanliness-audit entry.
//
// `wrap`: for rows with more options than comfortably fit on one line (e.g. the 9 dinner-time
// presets) — flex:1 pills dividing a single row got so narrow their own text wrapped
// mid-value ("18:0" / "0"). Wrapped pills size to their content and flow onto multiple lines
// instead. Default (no `wrap`) is unchanged for the short rows (Budget/Currency/Date Format)
// that already look right as evenly-filled single-row pills.

interface OptionRowProps {
  label: string;
  options: string[];
  current: string;
  onSelect: (option: string) => void;
  wrap?: boolean;
}

export function OptionRow({ label, options, current, onSelect, wrap }: OptionRowProps) {
  return (
    <View style={styles.optionRowContainer}>
      <Text style={styles.optionLabel}>{label}</Text>
      <View style={[styles.optionsWrapper, wrap && styles.optionsWrapperWrap]}>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt}
            onPress={() => onSelect(opt)}
            activeOpacity={0.8}
            style={[styles.optionPill, wrap && styles.optionPillAuto, current === opt && styles.optionPillActive]}
          >
            <Text style={[styles.optionText, current === opt && styles.optionTextActive]}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  optionRowContainer: { marginBottom: 28 },
  optionLabel: { color: '#DBEAFE', fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginBottom: 16 },
  optionsWrapper: { flexDirection: 'row', gap: 12 },
  optionsWrapperWrap: { flexWrap: 'wrap' },
  optionPill: { flex: 1, paddingVertical: 14, backgroundColor: '#1E293B', borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  optionPillAuto: { flex: 0, paddingHorizontal: 16, minWidth: 64 },
  optionPillActive: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  optionText: { color: '#94A3B8', fontWeight: '600', fontSize: 15 },
  optionTextActive: { color: '#FFF' },
});
