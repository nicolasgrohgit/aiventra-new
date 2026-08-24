import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, SafeAreaView, TextInput, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { searchCities, CityResult } from '@/lib/geocoding';
import { VibePicker } from '@/components/ui/vibe-picker';
import { SwipeDeck } from '@/components/ui/swipe-deck';
import { buildSwipeCandidatePool, splitTagsByDomain } from '@/lib/onboarding-taste';

export const COMMON_DIETS = ['Vegetarian', 'Vegan', 'Halal', 'Kosher', 'Gluten-Free', 'Keto', 'Nut-Free'];

// Replaces the old 6-step linear form (Home city, Dietary, Pace, Food, Activity, Event tastes
// as three separate 15-chip grids) with the 4-screen flow from docs/onboarding-redesign.md:
// Home city (unchanged) -> Pick your vibe (circle picker) -> Anything else? (capped, skippable
// swipe deck) -> Essentials (dietary + pace combined). See docs/circles-visual-language.md for
// the circle motif and lib/onboarding-taste.ts for the pure tag/state logic behind steps 2-3.
const TOTAL_STEPS = 4;

export default function OnboardingScreen() {
  const router = useRouter();
  const { completeOnboarding, updateUser } = useAuth();

  const [step, setStep] = useState(1);
  const [homebase, setHomebase] = useState('');
  const [dietary, setDietary] = useState<string[]>([]);
  const [activity, setActivity] = useState<string>('Medium');

  // The single cross-taxonomy tag pool steps 2 and 3 both read/write — per the task spec,
  // the vibe picker and swipe deck treat foodGenres/activityGenres/eventGenres as one flat
  // pool, only split back into the three separate buckets completeOnboarding() expects at
  // the very end (see handleNext's step 4 branch below).
  const [tasteTags, setTasteTags] = useState<string[]>([]);
  // Which vibe circles the user has explicitly selected/drilled into — tracked separately
  // from tasteTags because the same real tag can be seeded by more than one vibe (see
  // lib/onboarding-taste.ts's isNodeActive doc comment for why this matters).
  const [engagedVibeKeys, setEngagedVibeKeys] = useState<string[]>([]);

  // Computed once when entering step 3, not recomputed on every render, so swiping through
  // the deck doesn't shuffle the remaining cards' order out from under the user.
  const [swipeCandidates, setSwipeCandidates] = useState<string[]>([]);

  // Home city validation/autocomplete — soft warning only, never blocks proceeding, since a
  // legitimate city might not appear in a partial-query top-5 from the geocoder.
  const [citySuggestions, setCitySuggestions] = useState<CityResult[]>([]);
  const [cityQueryState, setCityQueryState] = useState<'idle' | 'checking' | 'found' | 'notfound'>('idle');
  const [justPickedCity, setJustPickedCity] = useState(false);

  useEffect(() => {
    if (justPickedCity) return;
    if (!homebase || homebase.trim().length < 2) {
      setCitySuggestions([]);
      setCityQueryState('idle');
      return;
    }
    setCityQueryState('checking');
    const handle = setTimeout(async () => {
      try {
        const results = await searchCities(homebase);
        setCitySuggestions(results);
        setCityQueryState(results.length > 0 ? 'found' : 'notfound');
      } catch {
        // Network hiccup — don't punish the user for it, just drop back to no opinion.
        setCityQueryState('idle');
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [homebase, justPickedCity]);

  const handlePickCity = (c: CityResult) => {
    setHomebase(`${c.name}, ${c.country}`);
    setCitySuggestions([]);
    setCityQueryState('found');
    setJustPickedCity(true);
  };

  const finishOnboarding = (finalTasteTags: string[]) => {
    const { foodGenres, activityGenres, eventGenres } = splitTagsByDomain(finalTasteTags);
    completeOnboarding({
      dietary,
      activityLevel: activity || 'Medium',
      foodGenres,
      activityGenres,
      eventGenres,
    });
    router.replace('/(tabs)' as any);
  };

  const handleNext = () => {
    if (step === 1) {
      if (!homebase) { Alert.alert('Missing Info', 'Please enter your home city.'); return; }
      updateUser({ homebase });
      setStep(2);
    } else if (step === 2) {
      setSwipeCandidates(buildSwipeCandidatePool(tasteTags, 10));
      setStep(3);
    } else {
      // step 3 (the swipe deck) has no bottom Next button — it advances itself via
      // handleSwipeDeckComplete (its own "Skip — use my picks" button or the last card
      // resolving), so the only step that reaches here via the bottom button is step 4.
      finishOnboarding(tasteTags);
    }
  };

  const handleSwipeDeckComplete = (acceptedTags: string[]) => {
    setTasteTags(prev => {
      const merged = [...prev];
      for (const tag of acceptedTags) if (!merged.includes(tag)) merged.push(tag);
      return merged;
    });
    setStep(4);
  };

  const toggleDiet = (diet: string) => {
    if (dietary.includes(diet)) setDietary(dietary.filter(d => d !== diet));
    else setDietary([...dietary, diet]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.stepDots}>
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <View key={i} style={[styles.dot, i + 1 === step && styles.dotActive]} />
        ))}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>

        {step === 1 && (
          <View style={styles.stepContainer}>
            <Text style={styles.title}>Home City</Text>
            <Text style={styles.subtitle}>Odys.ai uses your home base to determine when you are traveling vs running everyday errands locally.</Text>
            <TextInput
              style={styles.input}
              value={homebase}
              onChangeText={(t) => { setHomebase(t); setJustPickedCity(false); }}
              placeholder="e.g. New York, USA"
              placeholderTextColor="#64748B"
            />
            {citySuggestions.length > 0 && !justPickedCity && (
              <View style={styles.suggestionList}>
                {citySuggestions.map((c, i) => (
                  <TouchableOpacity key={`${c.name}-${i}`} style={styles.suggestionRow} onPress={() => handlePickCity(c)}>
                    <Text style={styles.suggestionText}>{c.name}{c.admin1 ? `, ${c.admin1}` : ''}, {c.country}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {cityQueryState === 'notfound' && (
              <Text style={styles.cityWarning}>We couldn&apos;t find a matching city — you can still continue, but double-check the spelling.</Text>
            )}
          </View>
        )}

        {step === 2 && (
          <View style={styles.stepContainer}>
            <Text style={styles.title}>Pick your vibe.</Text>
            <Text style={styles.subtitle}>Tap a circle to add it — tap it again to fine-tune what it covers. Pick as many as feel right.</Text>
            <VibePicker
              selectedTags={tasteTags}
              engagedKeys={engagedVibeKeys}
              onChange={(next) => { setTasteTags(next.selectedTags); setEngagedVibeKeys(next.engagedKeys); }}
            />
          </View>
        )}

        {step === 3 && (
          <View style={styles.stepContainer}>
            <Text style={styles.title}>Anything else?</Text>
            <Text style={styles.subtitle}>A few more, if you&apos;re up for it — swipe right to add, left to skip. Totally optional.</Text>
            <SwipeDeck candidates={swipeCandidates} onComplete={handleSwipeDeckComplete} />
          </View>
        )}

        {step === 4 && (
          <View style={styles.stepContainer}>
            <Text style={styles.title}>Essentials</Text>
            <Text style={styles.subtitle}>Medium pace, no restrictions — you can change either of these anytime in Profile.</Text>

            <Text style={styles.sectionLabel}>Dietary Restrictions</Text>
            <View style={styles.optionsGrid}>
              {COMMON_DIETS.map(diet => (
                <TouchableOpacity
                  key={diet}
                  style={[styles.optionBtn, dietary.includes(diet) && styles.optionBtnActive]}
                  onPress={() => toggleDiet(diet)}
                >
                  <Text style={[styles.optionText, dietary.includes(diet) && styles.optionTextActive]}>{diet}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 12 }]}>Travel Pace</Text>
            {['Low', 'Medium', 'High'].map(level => (
              <TouchableOpacity
                 key={level}
                 style={[styles.optionBtn, activity === level && styles.optionBtnActive]}
                 onPress={() => setActivity(level)}
              >
                <Text style={[styles.optionText, activity === level && styles.optionTextActive]}>{level}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {step !== 3 && (
        <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
          <Text style={styles.nextText}>{step === TOTAL_STEPS ? 'Complete Setup' : 'Next'}</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A', padding: 24 },
  content: { flex: 1 },
  contentInner: { justifyContent: 'center', flexGrow: 1 },
  stepContainer: { marginBottom: 40 },
  title: { color: '#FFF', fontSize: 32, fontWeight: 'bold', marginBottom: 12 },
  subtitle: { color: '#64748B', fontSize: 16, lineHeight: 24, marginBottom: 32 },
  sectionLabel: { color: '#F8FAFC', fontSize: 14, fontWeight: '700', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },

  stepDots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 8, marginTop: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1E293B' },
  dotActive: { backgroundColor: '#3B82F6' },

  input: { backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155', borderRadius: 14, padding: 18, color: '#FFF', fontSize: 16, marginBottom: 28 },

  suggestionList: { marginTop: -20, marginBottom: 20, backgroundColor: '#1E293B', borderRadius: 12, borderWidth: 1, borderColor: '#334155', overflow: 'hidden' },
  suggestionRow: { padding: 14, borderBottomWidth: 1, borderBottomColor: '#334155' },
  suggestionText: { color: '#E2E8F0', fontSize: 15 },
  cityWarning: { color: '#F59E0B', fontSize: 13, marginTop: -20, marginBottom: 20, lineHeight: 18 },

  optionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  optionBtn: { backgroundColor: '#1E293B', paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1, borderColor: '#334155', marginBottom: 12 },
  optionBtnActive: { backgroundColor: '#2563EB15', borderColor: '#3B82F6' },
  optionText: { color: '#94A3B8', fontSize: 16, fontWeight: '600' },
  optionTextActive: { color: '#3B82F6' },

  nextButton: { backgroundColor: '#3B82F6', paddingVertical: 18, borderRadius: 14, alignItems: 'center', marginBottom: 20 },
  nextText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
});
