import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { PreferenceCategoryGroup } from '@/constants/preferences';

interface CategorizedPickerProps {
  groupedOptions: PreferenceCategoryGroup[];
  selected: string[];
  onToggle: (option: string) => void;
}

// Inline (non-modal) categorized bubble-select — same visual pattern as Profile's
// CategorizedSelectionModal, but rendered directly in a screen rather than a popup, so it
// works as one step of a full-screen flow (onboarding) rather than an "edit" overlay.
export function CategorizedPicker({ groupedOptions, selected, onToggle }: CategorizedPickerProps) {
  return (
    <View>
      {groupedOptions.map(group => (
        <View key={group.type} style={styles.categoryGroup}>
          <Text style={styles.categoryTitle}>{group.type}</Text>
          <View style={styles.bubblesContainer}>
            {group.activities.map(opt => {
              const active = selected.includes(opt);
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.bubbleOption, active && styles.bubbleOptionActive]}
                  onPress={() => onToggle(opt)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.bubbleOptionText, active && styles.bubbleOptionTextActive]}>{opt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  categoryGroup: { marginBottom: 24 },
  categoryTitle: { color: '#F8FAFC', fontSize: 14, fontWeight: '700', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  bubblesContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  bubbleOption: { backgroundColor: '#1E293B', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#334155' },
  bubbleOptionActive: { backgroundColor: 'rgba(59, 130, 246, 0.15)', borderColor: '#3B82F6' },
  bubbleOptionText: { color: '#94A3B8', fontSize: 14, fontWeight: '600' },
  bubbleOptionTextActive: { color: '#3B82F6' },
});
