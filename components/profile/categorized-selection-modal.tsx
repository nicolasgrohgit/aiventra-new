import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hasGoogleMatch } from '@/lib/google-places-types';
import { PreferenceCategoryGroup } from '@/constants/preferences';
import { CircleNode, tapNode } from '@/lib/onboarding-taste';

// Drill-down/collapse preference editor — replaces the old always-expanded flat bubble list
// (all 15 leaves rendered at once regardless of selection) per
// docs/taxonomy-and-social-notifications-plan.md Part 3. Builds a CircleNode tree directly from
// the passed-in *_CATEGORIZED groups: same two-level shape buildVibeTree() produces for
// onboarding's vibe picker (lib/onboarding-taste.ts), just without the outer vibe-bundle
// wrapper — a PreferenceCategoryGroup *is* the top level here, there's no vibe above it. Reuses
// the exact same generic `tapNode`/`isNodeActive` engine rather than reimplementing
// bulk-select/toggle logic, per the doc's explicit ask.
//
// `engagedKeys` and `expandedKeys` are transient, component-local UI state — never persisted.
// Profile's actual saved preference is still just the plain `selected: string[]` leaf-tag array
// it always was (`user.preferences.foodGenres`/etc, via app/(tabs)/profile.tsx's existing
// `updatePreferences` call) — no new field, no migration, matching the "additive/optional, no
// backfill" constraint on this pass.
//
// Expand/collapse is intentionally its own bit of state, separate from tapNode's bulk-select
// side effect: tapping a collapsed category's row both (a) bulk-selects its whole group if it
// wasn't engaged yet — same "tap once to grab the whole bundle, then prune" interaction as a
// vibe circle — and (b) expands it immediately in the same tap (unlike vibe-picker.tsx, which
// waits for a *second* tap on an already-active node before drilling in). That one deliberate
// deviation is because a settings list needs instant visual feedback that something happened,
// where the circle picker instead uses "the circle now glows" as tap-1 feedback before drilling
// on tap-2. Tapping an already-expanded row's header just collapses it again — tapNode is a
// no-op on an already-active parent, so nothing about the selection changes on that tap.

interface CategorizedSelectionModalProps {
  visible: boolean;
  close: () => void;
  title: string;
  description: string;
  groupedOptions: PreferenceCategoryGroup[];
  selected: string[];
  onSelectedChange: (next: string[]) => void;
  category?: string;
}

function buildCategoryTree(groups: PreferenceCategoryGroup[]): CircleNode[] {
  return groups.map(group => ({
    key: group.type,
    label: group.type,
    emoji: '',
    color: '#3B82F6',
    tags: [...group.activities],
    children: group.activities.map(tag => ({
      key: `${group.type}:${tag}`,
      label: tag,
      emoji: '',
      color: '#3B82F6',
      tags: [tag],
    })),
  }));
}

export function CategorizedSelectionModal({
  visible, close, title, description, groupedOptions, selected, onSelectedChange, category,
}: CategorizedSelectionModalProps) {
  const insets = useSafeAreaInsets();
  const tree = useMemo(() => buildCategoryTree(groupedOptions), [groupedOptions]);

  // Seeded from whatever's already selected, so a category with existing picks opens already
  // expanded (matching the mockup: a category with active picks starts open, an empty one
  // starts collapsed) rather than every category defaulting to collapsed on every modal open.
  const seedEngagedKeys = () => tree.filter(node => node.tags.some(t => selected.includes(t))).map(n => n.key);
  const [engagedKeys, setEngagedKeys] = useState<string[]>(seedEngagedKeys);
  const [expandedKeys, setExpandedKeys] = useState<string[]>(seedEngagedKeys);

  const toggleExpanded = (key: string) => {
    setExpandedKeys(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  };

  const handleCategoryTap = (node: CircleNode) => {
    const result = tapNode(node, selected, engagedKeys);
    if (result.selectedTags !== selected) onSelectedChange(result.selectedTags);
    if (result.engagedKeys !== engagedKeys) setEngagedKeys(result.engagedKeys);
    toggleExpanded(node.key);
  };

  const handleLeafTap = (leaf: CircleNode) => {
    const result = tapNode(leaf, selected, engagedKeys);
    if (result.selectedTags !== selected) onSelectedChange(result.selectedTags);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={[styles.modalContainer, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={close} style={styles.backButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.backButtonText}>‹ Back to circle view</Text>
        </TouchableOpacity>
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
          {tree.map((node) => {
            const isExpanded = expandedKeys.includes(node.key);

            if (!isExpanded) {
              return (
                <TouchableOpacity
                  key={node.key}
                  style={styles.collapsedRow}
                  onPress={() => handleCategoryTap(node)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.categoryTitle}>{node.label}</Text>
                  <Text style={styles.plus}>+</Text>
                </TouchableOpacity>
              );
            }

            return (
              <View key={node.key} style={styles.categoryGroup}>
                <TouchableOpacity style={styles.expandedHeader} onPress={() => handleCategoryTap(node)} activeOpacity={0.7}>
                  <Text style={styles.categoryTitle}>{node.label}</Text>
                  <Text style={[styles.plus, styles.plusOpen]}>+</Text>
                </TouchableOpacity>
                <View style={styles.bubblesContainer}>
                  {(node.children ?? []).map((leaf) => {
                    const leafTag = leaf.tags[0];
                    const active = selected.includes(leafTag);
                    const comingSoon = !hasGoogleMatch(leafTag);
                    return (
                      <TouchableOpacity
                        key={leaf.key}
                        style={[styles.bubbleOption, active && styles.bubbleOptionActive, comingSoon && styles.bubbleOptionComingSoon]}
                        onPress={() => handleLeafTap(leaf)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.bubbleOptionText, active && styles.bubbleOptionTextActive]}>{leaf.label}</Text>
                        {comingSoon && <Text style={styles.comingSoonBadge}>Soon</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // paddingTop is overridden inline with useSafeAreaInsets().top (see render) so the back
  // button clears the device's actual status bar/notch instead of a hardcoded guess.
  modalContainer: { flex: 1, backgroundColor: '#0F172A', padding: 24 },
  backButton: { marginBottom: 12, alignSelf: 'flex-start' },
  backButtonText: { color: '#64748B', fontSize: 14, fontWeight: '600' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: '#FFF', fontSize: 24, fontWeight: 'bold', flex: 1, paddingRight: 20 },
  closeButton: { padding: 8 },
  closeButtonText: { color: '#3B82F6', fontSize: 16, fontWeight: '600' },
  modalSubtitle: { color: '#94A3B8', fontSize: 15, lineHeight: 22, marginBottom: 32 },

  // Collapsed row: title + "+" only, the compact single-line state item 3 asked for.
  collapsedRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  categoryGroup: { marginBottom: 28 },
  expandedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  categoryTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  plus: { color: '#64748B', fontSize: 20, fontWeight: '700' },
  plusOpen: { color: '#3B82F6', transform: [{ rotate: '45deg' }] },

  bubblesContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  bubbleOption: { backgroundColor: '#1E293B', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#334155' },
  bubbleOptionActive: { backgroundColor: 'rgba(59, 130, 246, 0.15)', borderColor: '#3B82F6' },
  bubbleOptionText: { color: '#94A3B8', fontSize: 14, fontWeight: '600' },
  bubbleOptionTextActive: { color: '#3B82F6' },
  bubbleOptionComingSoon: { borderStyle: 'dashed' },
  comingSoonBadge: { color: '#F59E0B', fontSize: 9, fontWeight: '700', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
  categoryNote: { color: '#64748B', fontSize: 13, lineHeight: 18, marginBottom: 18 },
});
