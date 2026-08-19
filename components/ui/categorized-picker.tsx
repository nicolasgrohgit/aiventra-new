import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { PreferenceCategoryGroup } from '@/constants/preferences';
import { hasGoogleMatch } from '@/lib/google-places-types';

interface CategorizedPickerProps {
  groupedOptions: PreferenceCategoryGroup[];
  selected: string[];
  onToggle: (option: string) => void;
  // Which of the three taxonomies this is (Food/Activity/Event) — used only to decide
  // whether to show the Event-specific "venues only, not schedules" note below. Optional so
  // existing callers keep compiling; omitting it just skips that note.
  category?: 'Restaurant' | 'Activity' | 'Event';
}

// Inline (non-modal) categorized bubble-select — same visual pattern as Profile's
// CategorizedSelectionModal, but rendered directly in a screen rather than a popup, so it
// works as one step of a full-screen flow (onboarding) rather than an "edit" overlay.
//
// Tags with no real data source yet (per lib/google-places-types.ts's hasGoogleMatch — e.g.
// Walking Tours, Boat Cruises, Water Sports) still show up here and are still selectable as a
// stated preference; a "Soon" badge just sets expectations about current content coverage,
// it isn't a feature gate.
export function CategorizedPicker({ groupedOptions, selected, onToggle, category }: CategorizedPickerProps) {
  return (
    <View>
      {category === 'Event' && (
        <Text style={styles.categoryNote}>
          Event venues are covered — matching what&apos;s actually on during your dates is coming soon.
        </Text>
      )}
      {groupedOptions.map(group => (
        <View key={group.type} style={styles.categoryGroup}>
          <Text style={styles.categoryTitle}>{group.type}</Text>
          <View style={styles.bubblesContainer}>
            {group.activities.map(opt => {
              const active = selected.includes(opt);
              const comingSoon = !hasGoogleMatch(opt);
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.bubbleOption, active && styles.bubbleOptionActive, comingSoon && styles.bubbleOptionComingSoon]}
                  onPress={() => onToggle(opt)}
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
    </View>
  );
}

const styles = StyleSheet.create({
  categoryNote: { color: '#64748B', fontSize: 13, lineHeight: 18, marginBottom: 18 },
  categoryGroup: { marginBottom: 24 },
  categoryTitle: { color: '#F8FAFC', fontSize: 14, fontWeight: '700', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  bubblesContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  bubbleOption: { backgroundColor: '#1E293B', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#334155' },
  bubbleOptionActive: { backgroundColor: 'rgba(59, 130, 246, 0.15)', borderColor: '#3B82F6' },
  bubbleOptionComingSoon: { borderStyle: 'dashed' },
  bubbleOptionText: { color: '#94A3B8', fontSize: 14, fontWeight: '600' },
  bubbleOptionTextActive: { color: '#3B82F6' },
  comingSoonBadge: { color: '#F59E0B', fontSize: 9, fontWeight: '700', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
});
