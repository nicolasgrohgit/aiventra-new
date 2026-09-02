import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, PanResponder, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { domainForTag } from '@/lib/onboarding-taste';

// The capped "Anything else?" swipe-refine deck from docs/onboarding-redesign.md: a
// Tinder-style stack over the gap left by the vibe picker (tags not already selected),
// hard-capped at 10 cards by the caller via lib/onboarding-taste.ts's
// buildSwipeCandidatePool. Swipe right = add, swipe left = skip; a visible
// "Skip — use my picks" button and ✓/✗ buttons are first-class, not just a gesture fallback —
// per the design doc, react-native-web handles pan gestures less reliably, and a button pair
// is needed for accessibility regardless of platform.
//
// Judgment call: built on React Native's core `PanResponder` + `Animated` rather than
// react-native-gesture-handler's `Gesture.Pan()` + `react-native-reanimated` (both already
// project dependencies and the design doc's suggested pairing). Reason: gesture-handler
// normally requires the app root to be wrapped in `GestureHandlerRootView`
// (`app/_layout.tsx` isn't currently wrapped in one), and since this feature can't be
// visually/gesture-tested on-device in this environment, avoiding that root-level change
// keeps the blast radius of an unverifiable change smaller. Core `PanResponder`/`Animated`
// need no such setup and are just as capable for a single-axis swipe-and-fly-off. Worth
// revisiting if the team standardizes on gesture-handler for a future swipeable surface.
//
// "Feels slow" fix (this pass): a *prior* attempt fixed this by migrating the whole gesture
// system to Gesture.Pan()/reanimated above — that broke the ✓/✕ round buttons (deck silently
// stopped advancing) and was reverted (see CHANGELOG 0.0.32 "Known issue"). Deliberately not
// repeating that here. Root cause of the actual sluggishness, on inspection: the drag-follow
// event below (onPanResponderMove) was wired with `useNativeDriver: false`, so every single
// touchmove sample bounced through the JS bridge to update `position` before the card's
// transform could repaint — exactly the kind of per-frame JS thread round-trip that reads as
// "the card feels like it's lagging behind my finger." Switched to `useNativeDriver: true`;
// safe because `position.x`/`position.y` are only ever consumed as `transform`
// (`getTranslateTransform()` + the `rotate` interpolation below), which the native driver
// fully supports — nothing here reads the raw numeric value off the JS thread. The
// `onPanResponderRelease` spring-back and `advance()`'s fly-off `Animated.timing` were
// already `useNativeDriver: true`, so this was the one remaining JS-driven path in the
// gesture code. Critically, this leaves `PanResponder` itself, `onMoveShouldSetPanResponder`,
// `onPanResponderRelease`, and the ✓/✕ `Pressable`s' `onPress={() => advance(...)}` wiring
// completely untouched — the round buttons don't go through this event at all, so this
// change carries essentially none of the risk the reverted gesture-handler migration did.

const SWIPE_THRESHOLD = 100;
const FLY_OFF_DISTANCE = 500;

const DOMAIN_LABELS: Record<string, string> = {
  foodGenres: 'Food', activityGenres: 'Activity', eventGenres: 'Event',
};

interface SwipeDeckProps {
  // Capped candidate pool (already excludes anything the vibe picker selected) — see
  // lib/onboarding-taste.ts's buildSwipeCandidatePool. Rendered in the given order.
  candidates: string[];
  // Called exactly once, either when the deck is exhausted or the user taps
  // "Skip — use my picks" partway through, with whatever tags were accepted so far.
  onComplete: (acceptedTags: string[]) => void;
}

export function SwipeDeck({ candidates, onComplete }: SwipeDeckProps) {
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const acceptedRef = useRef<string[]>([]);
  const position = useRef(new Animated.ValueXY()).current;

  const current = candidates[index];
  const upNext = candidates[index + 1];

  const finish = () => {
    if (finished) return;
    setFinished(true);
    onComplete(acceptedRef.current);
  };

  const advance = (accept: boolean, dir: 'left' | 'right') => {
    if (!current || finished) return;
    if (accept) acceptedRef.current = [...acceptedRef.current, current];
    Haptics.selectionAsync().catch(() => {});
    Animated.timing(position, {
      toValue: { x: dir === 'right' ? FLY_OFF_DISTANCE : -FLY_OFF_DISTANCE, y: 0 },
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      position.setValue({ x: 0, y: 0 });
      const next = index + 1;
      if (next >= candidates.length) {
        finish();
      } else {
        setIndex(next);
      }
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 6,
      onPanResponderMove: Animated.event([null, { dx: position.x, dy: position.y }], { useNativeDriver: true }),
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx > SWIPE_THRESHOLD) advance(true, 'right');
        else if (gesture.dx < -SWIPE_THRESHOLD) advance(false, 'left');
        else Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: true, friction: 6 }).start();
      },
    })
  ).current;

  const rotate = position.x.interpolate({ inputRange: [-300, 0, 300], outputRange: ['-12deg', '0deg', '12deg'] });

  // Nothing left in the gap — the vibe picks already covered every real taxonomy tag. Skip
  // straight through with a short explanation rather than showing an empty deck. The
  // auto-finish runs in an effect (not inline during render) so it doesn't call the parent's
  // onComplete/setState while this component is still rendering.
  useEffect(() => {
    if (candidates.length === 0 && !finished) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.length]);

  if (candidates.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>Your vibe picks already cover everything we&apos;d ask here.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable style={styles.skipBtn} onPress={finish} hitSlop={8}>
        <Text style={styles.skipText}>Skip — use my picks</Text>
      </Pressable>

      <View style={styles.deckArea}>
        {upNext && (
          <View style={[styles.card, styles.cardBehind]}>
            <Text style={styles.cardDomain}>{DOMAIN_LABELS[domainForTag(upNext) ?? ''] ?? ''}</Text>
            <Text style={styles.cardTag}>{upNext}</Text>
          </View>
        )}
        {current ? (
          <Animated.View
            {...panResponder.panHandlers}
            style={[styles.card, { transform: [...position.getTranslateTransform(), { rotate }] }]}
          >
            <Text style={styles.cardDomain}>{DOMAIN_LABELS[domainForTag(current) ?? ''] ?? ''}</Text>
            <Text style={styles.cardTag}>{current}</Text>
            <Text style={styles.cardHint}>Swipe right to add, left to skip</Text>
          </Animated.View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTag}>That&apos;s everything — nice work.</Text>
          </View>
        )}
      </View>

      {current && (
        <View style={styles.buttonsRow}>
          <Pressable style={[styles.roundBtn, styles.skipRound]} onPress={() => advance(false, 'left')}>
            <Text style={styles.roundBtnText}>✕</Text>
          </Pressable>
          <Pressable style={[styles.roundBtn, styles.addRound]} onPress={() => advance(true, 'right')}>
            <Text style={styles.roundBtnText}>✓</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.progress}>{Math.min(index, candidates.length)} / {candidates.length}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  skipBtn: { marginBottom: 20, paddingVertical: 8, paddingHorizontal: 16 },
  skipText: { color: '#3B82F6', fontSize: 15, fontWeight: '700' },
  deckArea: { width: '100%', height: 220, alignItems: 'center', justifyContent: 'center' },
  card: {
    position: 'absolute', width: '86%', height: 200, backgroundColor: '#1E293B',
    borderRadius: 24, borderWidth: 1, borderColor: '#334155', alignItems: 'center',
    justifyContent: 'center', padding: 20,
  },
  cardBehind: { transform: [{ scale: 0.94 }, { translateY: 10 }], opacity: 0.6 },
  cardDomain: { color: '#64748B', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  cardTag: { color: '#F8FAFC', fontSize: 28, fontWeight: '800', textAlign: 'center' },
  cardHint: { color: '#475569', fontSize: 12, marginTop: 16 },
  buttonsRow: { flexDirection: 'row', gap: 28, marginTop: 24 },
  roundBtn: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  skipRound: { backgroundColor: '#1E293B', borderColor: '#EF4444' },
  addRound: { backgroundColor: '#1E293B', borderColor: '#22C55E' },
  roundBtnText: { color: '#F8FAFC', fontSize: 22, fontWeight: '700' },
  progress: { color: '#475569', fontSize: 13, marginTop: 18 },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { color: '#94A3B8', fontSize: 15, textAlign: 'center', lineHeight: 22 },
});
