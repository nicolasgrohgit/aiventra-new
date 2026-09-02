import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, StyleSheet, Platform } from 'react-native';
import { hasGoogleMatch } from '@/lib/google-places-types';

// Extracted from app/(tabs)/profile.tsx (was a component defined inline inside the screen's
// render body, re-created on every render). See CHANGELOG.md's cleanliness-audit entry.

export interface CategorizedOptionGroup {
  type: string;
  activities: string[];
}

interface CategorizedSelectionModalProps {
  visible: boolean;
  close: () => void;
  title: string;
  description: string;
  groupedOptions: CategorizedOptionGroup[];
  selected: string[];
  toggle: (option: string) => void;
  category?: string;
}

export function CategorizedSelectionModal({ visible, close, title, description, groupedOptions, selected, toggle, category }: CategorizedSelectionModalProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{title}</Text>
          <TouchableOpacity onPress={close} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.modalSubtitle}>{description}</Text>

        <ScrollView showsVerticalScrollIndicator={false}>
          {category === 'Event' && (
            <Text style={styles.categoryNote}>
              Event venues are covered — matching what&apos;s actually on during your dates is coming soon.
            </Text>
          )}
          {groupedOptions.map((group) => (
            <View key={group.type} style={styles.categoryGroup}>
              <Text style={styles.categoryTitle}>{group.type}</Text>
              <View style={styles.bubblesContainer}>
                {group.activities.map((opt) => {
                  const active = selected.includes(opt);
                  const comingSoon = !hasGoogleMatch(opt);
                  return (
                    <TouchableOpacity
                      key={opt}
                      style={[styles.bubbleOption, active && styles.bubbleOptionActive, comingSoon && styles.bubbleOptionComingSoon]}
                      onPress={() => toggle(opt)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.bubbleOptionText, active && styles.bubbleOptionTextActive]}>{opt}</Text>
                      {comingSoon && <Text style={styles.comingSoonBadge}>Soon</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: { flex: 1, backgroundColor: '#0F172A', padding: 24, paddingTop: Platform.OS === 'ios' ? 40 : 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: '#FFF', fontSize: 24, fontWeight: 'bold', flex: 1, paddingRight: 20 },
  closeButton: { padding: 8 },
  closeButtonText: { color: '#3B82F6', fontSize: 16, fontWeight: '600' },
  modalSubtitle: { color: '#94A3B8', fontSize: 15, lineHeight: 22, marginBottom: 32 },
  categoryGroup: { marginBottom: 28 },
  categoryTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: '700', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
  bubblesContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  bubbleOption: { backgroundColor: '#1E293B', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#334155' },
  bubbleOptionActive: { backgroundColor: 'rgba(59, 130, 246, 0.15)', borderColor: '#3B82F6' },
  bubbleOptionText: { color: '#94A3B8', fontSize: 14, fontWeight: '600' },
  bubbleOptionTextActive: { color: '#3B82F6' },
  bubbleOptionComingSoon: { borderStyle: 'dashed' },
  comingSoonBadge: { color: '#F59E0B', fontSize: 9, fontWeight: '700', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
  categoryNote: { color: '#64748B', fontSize: 13, lineHeight: 18, marginBottom: 18 },
});
