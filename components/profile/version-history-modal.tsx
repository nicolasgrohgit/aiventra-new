import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Extracted from app/(tabs)/profile.tsx (was a component defined inline inside the screen's
// render body, re-created on every render). See CHANGELOG.md's cleanliness-audit entry.
//
// `history` is passed in rather than imported from profile.tsx directly — profile.tsx exports
// CHANGELOG_HISTORY, but this component is imported BY profile.tsx, and importing it back
// from there would create a circular module dependency.

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  changes: string[];
}

interface VersionHistoryModalProps {
  visible: boolean;
  close: () => void;
  history: ChangelogEntry[];
}

export function VersionHistoryModal({ visible, close, history }: VersionHistoryModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={[styles.modalContainer, { paddingTop: insets.top + 16 }]}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Version History</Text>
          <TouchableOpacity onPress={close} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.modalSubtitle}>Track the evolution and changes made to Odys.ai.</Text>

        <ScrollView showsVerticalScrollIndicator={false}>
          {history.map((item) => (
            <View key={item.version} style={styles.changelogCard}>
              <View style={styles.changelogHeader}>
                <Text style={styles.changelogVersion}>v{item.version}</Text>
                <Text style={styles.changelogDate}>{item.date}</Text>
              </View>
              <Text style={styles.changelogTitle}>{item.title}</Text>
              <View style={styles.changelogList}>
                {item.changes.map((change, i) => (
                  <View key={i} style={styles.changelogRow}>
                    <Text style={styles.changelogBullet}>•</Text>
                    <Text style={styles.changelogText}>{change}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // paddingTop is overridden inline with useSafeAreaInsets().top (see render) so the header
  // clears the device's actual status bar/notch instead of a hardcoded guess.
  modalContainer: { flex: 1, backgroundColor: '#0F172A', padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: '#FFF', fontSize: 24, fontWeight: 'bold', flex: 1, paddingRight: 20 },
  closeButton: { padding: 8 },
  closeButtonText: { color: '#3B82F6', fontSize: 16, fontWeight: '600' },
  modalSubtitle: { color: '#94A3B8', fontSize: 15, lineHeight: 22, marginBottom: 32 },
  changelogCard: { backgroundColor: '#1E293B', padding: 20, borderRadius: 16, marginBottom: 20, borderWidth: 1, borderColor: '#334155' },
  changelogHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  changelogVersion: { color: '#3B82F6', fontSize: 18, fontWeight: '800' },
  changelogDate: { color: '#64748B', fontSize: 13, fontWeight: '600' },
  changelogTitle: { color: '#F8FAFC', fontSize: 15, fontWeight: '700', marginBottom: 14 },
  changelogList: { gap: 8 },
  changelogRow: { flexDirection: 'row', alignItems: 'flex-start' },
  changelogBullet: { color: '#3B82F6', marginRight: 8, fontSize: 14, fontWeight: 'bold' },
  changelogText: { color: '#CBD5E1', fontSize: 14, lineHeight: 20, flex: 1 },
});
