import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/hooks/useAuth';
import { apiFetch, API_URL } from '@/lib/api-client';

// New component, following the exact `VersionHistoryModal`/`CategorizedSelectionModal`
// extraction pattern (see components/profile/version-history-modal.tsx): a `Modal` with
// `presentationStyle="pageSheet"`, `{ visible, close }` props, rendered alongside profile.tsx's
// other modals. See docs/rfe-suggestion-form-plan.md for the full design this implements.
//
// The header uses a "‹ Back" control instead of a bare "Close" (unlike VersionHistoryModal) —
// this screen has real unsaved input a user might lose, matching the back-button convention
// already established elsewhere this session (see app/onboarding.tsx, categorized-selection-
// modal.tsx). A second, secondary "Back" button below the text box does the same thing
// (discards without submitting) — kept distinct from the header control per the design doc,
// not because they behave differently.

const MAX_LENGTH = 1500;

interface SuggestionFormModalProps {
  visible: boolean;
  close: () => void;
}

export function SuggestionFormModal({ visible, close }: SuggestionFormModalProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isTextEmpty = text.trim().length === 0;

  const handleSend = async () => {
    if (isTextEmpty || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`${API_URL}/api/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() })
      });
      if (!res.ok) {
        throw new Error('Request failed');
      }
      setText('');
      close();
      Alert.alert('Thanks!', 'Your suggestion has been sent to the Odys.ai team.');
    } catch (err) {
      console.warn('Failed to submit suggestion:', err);
      Alert.alert('Something went wrong', 'We could not send your suggestion. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const sendDisabled = isTextEmpty || isSubmitting;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={[styles.modalContainer, { paddingTop: insets.top + 16 }]}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Have a suggestion?</Text>
          <TouchableOpacity onPress={close} style={styles.closeButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.closeButtonText}>‹ Back</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.modalSubtitle}>Tell us what&apos;s missing or what could be better — this goes straight to the Odys.ai team.</Text>

        <Text style={styles.inputLabel}>From</Text>
        <Text style={styles.nameText}>{user?.full_name || 'You'}</Text>

        <Text style={styles.inputLabel}>Your suggestion</Text>
        <TextInput
          style={styles.textArea}
          value={text}
          onChangeText={(t) => setText(t.slice(0, MAX_LENGTH))}
          placeholder="What would make Odys.ai better for you?"
          placeholderTextColor="#64748B"
          multiline
          maxLength={MAX_LENGTH}
          textAlignVertical="top"
        />
        <Text style={styles.charCount}>{MAX_LENGTH - text.length} characters left</Text>

        <TouchableOpacity
          style={[styles.sendButton, sendDisabled && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={sendDisabled}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.sendButtonText}>Send</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.backButton} onPress={close} disabled={isSubmitting}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
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
  modalSubtitle: { color: '#94A3B8', fontSize: 15, lineHeight: 22, marginBottom: 28 },

  inputLabel: { color: '#DBEAFE', fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 },
  nameText: { color: '#F8FAFC', fontSize: 16, marginBottom: 24 },

  textArea: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    color: '#FFF',
    fontSize: 16,
    minHeight: 160,
  },
  charCount: { color: '#64748B', fontSize: 13, textAlign: 'right', marginTop: 8, marginBottom: 28 },

  sendButton: { backgroundColor: '#3B82F6', paddingVertical: 18, borderRadius: 16, alignItems: 'center', marginBottom: 12 },
  sendButtonDisabled: { backgroundColor: '#1E293B' },
  sendButtonText: { color: '#FFF', fontSize: 16, fontWeight: '800' },

  backButton: { backgroundColor: '#1E293B', paddingVertical: 18, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  backButtonText: { color: '#F8FAFC', fontSize: 16, fontWeight: '800' },
});
