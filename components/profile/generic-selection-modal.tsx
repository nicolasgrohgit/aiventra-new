import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, StyleSheet, Platform } from 'react-native';

// Extracted from app/(tabs)/profile.tsx (was a component defined inline inside the screen's
// render body, re-created on every render). See CHANGELOG.md's cleanliness-audit entry.

interface GenericSelectionModalProps {
  visible: boolean;
  close: () => void;
  title: string;
  description: string;
  options: string[];
  selected: string[];
  toggle: (option: string) => void;
}

export function GenericSelectionModal({ visible, close, title, description, options, selected, toggle }: GenericSelectionModalProps) {
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

        <ScrollView>
          {options.map((opt) => {
            const active = selected.includes(opt);
            return (
              <TouchableOpacity key={opt} style={[styles.dietModalOption, active && styles.dietModalOptionActive]} onPress={() => toggle(opt)} activeOpacity={0.7}>
                <Text style={[styles.dietModalOptionText, active && styles.dietModalOptionTextActive]}>{opt}</Text>
                {active && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
            );
          })}
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
  dietModalOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1E293B', padding: 18, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  dietModalOptionActive: { backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: '#10B981' },
  dietModalOptionText: { color: '#F8FAFC', fontSize: 16, fontWeight: '600' },
  dietModalOptionTextActive: { color: '#10B981' },
  checkmark: { color: '#10B981', fontSize: 18, fontWeight: 'bold' },
});
