import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  buildVibeTree, isNodeActive, shouldDrillIn, tapNode, nodeAtPath, CircleNode,
} from '@/lib/onboarding-taste';

// The "Pick your vibe" screen from docs/onboarding-redesign.md, built as the literal
// overlapping-circles motif from docs/circles-visual-language.md — see the top-level task
// spec for the full interaction description. This component owns only the drill-down `path`
// (which cluster is currently showing); the actual tag/engagement selection is lifted to the
// caller (app/onboarding.tsx) since that's the data the rest of the onboarding flow and
// eventual completeOnboarding() call need.
//
// Built entirely from plain RN Views (no react-native-svg/Skia — see the hard no-new-native-
// deps constraint this feature was built under while EAS's free build quota is exhausted).
// Every circle is a slot View sized with percentage width + aspectRatio:1 (scales across
// device widths) containing an inner View with a very large borderRadius, which RN clips to
// a perfect circle regardless of the slot's actual resolved pixel size — no measurement/
// onLayout needed. The "glow" on an active circle is approximated with a second, larger,
// more-transparent aura View behind it plus shadow/elevation, rather than a blur library.

interface VibePickerProps {
  selectedTags: string[];
  engagedKeys: string[];
  onChange: (next: { selectedTags: string[]; engagedKeys: string[] }) => void;
}

// Percentages as template-literal types so they satisfy RN's DimensionValue (which accepts
// `${number}%` but not a bare `string`) without a cast at every call site.
type Pct = `${number}%`;
interface Slot { left: Pct; top: Pct; size: Pct }

// --- Hand-authored cluster layouts (percentage-based, per the task's layout guidance) -------
// 8 top-level vibe circles, order matches VIBE_PRESETS / buildVibeTree() exactly.
const TOP_LEVEL_LAYOUT: Slot[] = [
  { left: '4%', top: '4%', size: '34%' },   // foodie
  { left: '32%', top: '0%', size: '30%' },  // culture
  { left: '56%', top: '34%', size: '30%' }, // nightlife
  { left: '0%', top: '42%', size: '28%' },  // outdoors
  { left: '56%', top: '66%', size: '28%' }, // arts
  { left: '26%', top: '48%', size: '26%' }, // chill
  { left: '8%', top: '72%', size: '24%' },  // shopping
  { left: '66%', top: '8%', size: '26%' },  // scenic
];

// De-emphasized perimeter slots for the 7 non-drilled top-level circles once one is drilled
// into — assigned in order to whichever nodes aren't the current parent.
const EDGE_LAYOUT: Slot[] = [
  { left: '2%', top: '2%', size: '12%' },
  { left: '44%', top: '0%', size: '11%' },
  { left: '86%', top: '2%', size: '12%' },
  { left: '0%', top: '46%', size: '11%' },
  { left: '88%', top: '46%', size: '11%' },
  { left: '2%', top: '86%', size: '12%' },
  { left: '44%', top: '88%', size: '11%' },
  { left: '86%', top: '86%', size: '12%' },
];

const PARENT_PINNED: Slot = { left: '28%', top: '4%', size: '38%' };

// Hand-authored sub-cluster layouts for the child counts VIBE_PRESETS actually produces
// today (4 or 5 tags per vibe — see constants/preferences.ts). A count outside that range
// (a future vibe with a different tag count) falls back to arcLayout() below rather than
// crashing or mis-rendering.
const SUBCLUSTER_LAYOUTS: Record<number, Slot[]> = {
  3: [
    { left: '10%', top: '52%', size: '28%' },
    { left: '40%', top: '46%', size: '28%' },
    { left: '64%', top: '60%', size: '28%' },
  ],
  4: [
    { left: '6%', top: '50%', size: '26%' },
    { left: '38%', top: '46%', size: '24%' },
    { left: '62%', top: '54%', size: '26%' },
    { left: '30%', top: '74%', size: '24%' },
  ],
  5: [
    { left: '4%', top: '48%', size: '22%' },
    { left: '30%', top: '44%', size: '22%' },
    { left: '56%', top: '48%', size: '22%' },
    { left: '16%', top: '70%', size: '22%' },
    { left: '46%', top: '72%', size: '22%' },
  ],
  6: [
    { left: '2%', top: '46%', size: '20%' },
    { left: '26%', top: '42%', size: '20%' },
    { left: '50%', top: '44%', size: '20%' },
    { left: '72%', top: '50%', size: '20%' },
    { left: '14%', top: '70%', size: '20%' },
    { left: '46%', top: '72%', size: '20%' },
  ],
};

// Generic fallback for any child count not hand-authored above — spreads circles evenly
// along an arc beneath the pinned parent. Not a full packing algorithm (deliberately, per the
// task's guidance that one is unnecessary engineering here) — just enough so a future vibe
// with an unusual tag count still renders sensibly instead of breaking.
function arcLayout(count: number): Slot[] {
  if (count <= 0) return [];
  const centerX = 50, centerY = 60, radiusX = 40, radiusY = 26, size = 22;
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const angle = Math.PI * (0.12 + 0.76 * t);
    const cx = centerX - radiusX * Math.cos(angle);
    const cy = centerY + radiusY * Math.sin(angle);
    slots.push({ left: `${cx - size / 2}%` as Pct, top: `${cy - size / 2}%` as Pct, size: `${size}%` as Pct });
  }
  return slots;
}

function subclusterLayout(count: number): Slot[] {
  return SUBCLUSTER_LAYOUTS[count] ?? arcLayout(count);
}

function Circle({
  node, slot, active, dimmed, large, onPress,
}: {
  node: CircleNode; slot: Slot; active: boolean; dimmed?: boolean; large?: boolean; onPress: () => void;
}) {
  return (
    <View style={[styles.slot, { left: slot.left, top: slot.top, width: slot.size }, dimmed && styles.dimmedSlot]}>
      {active && !dimmed && <View style={[styles.aura, { backgroundColor: node.color }]} />}
      <Pressable
        onPress={onPress}
        style={[
          styles.circle,
          { backgroundColor: active ? node.color : '#1E293B', borderColor: node.color },
          active && !dimmed && { shadowColor: node.color },
          large && styles.circleLarge,
        ]}
      >
        {!!node.emoji && <Text style={styles.emoji}>{node.emoji}</Text>}
        <Text style={[styles.label, active && styles.labelActive, dimmed && styles.labelDimmed]} numberOfLines={2}>
          {node.label}
        </Text>
        {active && !dimmed && <Text style={styles.check}>✓</Text>}
      </Pressable>
    </View>
  );
}

export function VibePicker({ selectedTags, engagedKeys, onChange }: VibePickerProps) {
  const tree = useMemo(() => buildVibeTree(), []);
  const [path, setPath] = useState<string[]>([]);

  const parent = path.length > 0 ? nodeAtPath(tree, path) : null;

  // A tap on a node found directly in `tree` (top level, or an edge/context circle while
  // drilled in) always resolves the drill-down path to just that node — these are siblings
  // of each other, not nested. A tap on one of the current parent's `children` appends to the
  // path instead. Both call through the same generic tapNode/shouldDrillIn logic either way.
  const handleTap = (node: CircleNode, isChildOfParent: boolean) => {
    const result = tapNode(node, selectedTags, engagedKeys);
    if (result.selectedTags !== selectedTags || result.engagedKeys !== engagedKeys) {
      onChange(result);
    }
    if (shouldDrillIn(node, selectedTags, engagedKeys)) {
      Haptics.selectionAsync().catch(() => {});
      setPath(isChildOfParent ? [...path, node.key] : [node.key]);
    } else if (!isNodeActive(node, selectedTags, engagedKeys)) {
      Haptics.selectionAsync().catch(() => {});
    }
  };

  if (!parent) {
    return (
      <View style={styles.stage}>
        {tree.map((node, i) => (
          <Circle
            key={node.key}
            node={node}
            slot={TOP_LEVEL_LAYOUT[i]}
            active={isNodeActive(node, selectedTags, engagedKeys)}
            onPress={() => handleTap(node, false)}
          />
        ))}
      </View>
    );
  }

  const others = tree.filter(n => n.key !== parent.key);
  const children = parent.children ?? [];

  return (
    <View style={styles.stage}>
      <Pressable style={styles.backBtn} onPress={() => setPath(path.slice(0, -1))} hitSlop={12}>
        <Text style={styles.backText}>‹ Back</Text>
      </Pressable>

      {others.map((node, i) => (
        <Circle
          key={node.key}
          node={node}
          slot={EDGE_LAYOUT[i % EDGE_LAYOUT.length]}
          active={isNodeActive(node, selectedTags, engagedKeys)}
          dimmed
          onPress={() => handleTap(node, false)}
        />
      ))}

      <Circle node={parent} slot={PARENT_PINNED} active large onPress={() => {}} />

      {children.map((child, i) => (
        <Circle
          key={child.key}
          node={child}
          slot={subclusterLayout(children.length)[i]}
          active={isNodeActive(child, selectedTags, engagedKeys)}
          onPress={() => handleTap(child, true)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Fixed-aspect-ratio stage — every circle position/size below is a percentage of this box,
  // so the whole cluster scales with device width instead of being tuned to one screen size.
  // `maxWidth` is load-bearing, not decorative: without it, `width: '100%'` scales the stage
  // (and every circle's percentage size with it) to the FULL width of whatever container it's
  // in, uncapped. Live-verified via a real browser render at a 1568px viewport: circles came
  // out 400-533px in diameter and the cluster's bottom edge landed at ~1317px, far past the
  // viewport — this is the confirmed root cause of "only saw one giant circle, the rest never
  // appeared" on a real device. 420 is a generous phone-width ceiling (comfortably covers large
  // phones like a 428px-wide iPhone Pro Max) that keeps the cluster's absolute size predictable
  // regardless of the actual screen/container width; `alignSelf: 'center'` keeps it centered on
  // any screen wider than that cap instead of hugging the left edge.
  stage: { width: '100%', maxWidth: 420, alignSelf: 'center', aspectRatio: 0.95, position: 'relative' },
  slot: { position: 'absolute', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dimmedSlot: { opacity: 0.45 },
  aura: { position: 'absolute', width: '130%', height: '130%', borderRadius: 999, opacity: 0.18 },
  circle: {
    width: '100%', height: '100%', borderRadius: 999, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', padding: 6,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12, elevation: 6,
  },
  circleLarge: { borderWidth: 2.5, zIndex: 10 },
  emoji: { fontSize: 22, marginBottom: 2 },
  label: { color: '#CBD5E1', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  labelActive: { color: '#0A0A0A' },
  labelDimmed: { color: '#64748B' },
  check: { position: 'absolute', top: 4, right: 10, color: '#0A0A0A', fontWeight: '900', fontSize: 12 },
  backBtn: { position: 'absolute', top: -36, left: 0, zIndex: 20, padding: 8 },
  backText: { color: '#3B82F6', fontSize: 16, fontWeight: '700' },
});
