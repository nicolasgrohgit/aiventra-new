import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

// Extracted from app/(tabs)/profile.tsx (was a component defined inline inside the screen's
// render body, re-created on every render). See CHANGELOG.md's cleanliness-audit entry.

interface ConfigRowModalProps {
  title: string;
  arrayString: string[];
  openModal: () => void;
}

export function ConfigRowModal({ title, arrayString, openModal }: ConfigRowModalProps) {
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={styles.dietHeaderRow}>
        <Text style={styles.optionLabel}>{title}</Text>
        <TouchableOpacity style={styles.editDietBtn} onPress={openModal}>
          <Text style={styles.editDietBtnText}>Edit</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.dietTagsView}>
        {arrayString?.map((item, i) => (
          <View key={i} style={styles.dietTag}><Text style={styles.dietTagText}>{item}</Text></View>
        ))}
        {arrayString.length === 0 && <Text style={styles.cardDesc}>Nothing selected yet.</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same value as profile.tsx's own local styles.cardDesc/optionLabel (unavoidable — those
  // stay in profile.tsx too since they're also used outside this component).
  cardDesc: { color: '#64748B', fontSize: 14, lineHeight: 22 },
  optionLabel: { color: '#DBEAFE', fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginBottom: 16 },
  dietHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  editDietBtn: { backgroundColor: '#1E293B', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  editDietBtnText: { color: '#3B82F6', fontWeight: 'bold', fontSize: 13 },
  dietTagsView: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  dietTag: { backgroundColor: 'rgba(16, 185, 129, 0.1)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.3)' },
  dietTagText: { color: '#10B981', fontWeight: '700', fontSize: 14 },
});
