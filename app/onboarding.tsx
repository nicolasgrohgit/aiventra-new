import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, SafeAreaView, TextInput, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { searchCities, CityResult } from '@/lib/geocoding';
import { FOOD_GENRES_CATEGORIZED, ACTIVITY_GENRES_CATEGORIZED, EVENT_GENRES_CATEGORIZED } from '@/constants/preferences';
import { CategorizedPicker } from '@/components/ui/categorized-picker';

export const COMMON_DIETS = ['Vegetarian', 'Vegan', 'Halal', 'Kosher', 'Gluten-Free', 'Keto', 'Nut-Free'];

const TOTAL_STEPS = 6;

export default function OnboardingScreen() {
  const router = useRouter();
  const { completeOnboarding, updateUser } = useAuth();

  const [step, setStep] = useState(1);
  const [homebase, setHomebase] = useState('');
  const [dietary, setDietary] = useState<string[]>([]);
  const [activity, setActivity] = useState<string>('Medium');
  const [foodGenres, setFoodGenres] = useState<string[]>([]);
  const [activityGenres, setActivityGenres] = useState<string[]>([]);
  const [eventGenres, setEventGenres] = useState<string[]>([]);

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

  const handleNext = () => {
    if (step === 1) {
      if (!homebase) { Alert.alert('Missing Info', 'Please enter your home city.'); return; }
      updateUser({ homebase });
      setStep(2);
    } else if (step < TOTAL_STEPS) {
      setStep(step + 1);
    } else {
      completeOnboarding({
        dietary,
        activityLevel: activity || 'Medium',
        foodGenres,
        activityGenres,
        eventGenres,
      });
      router.replace('/(tabs)' as any);
    }
  };

  const toggleDiet = (diet: string) => {
    if (dietary.includes(diet)) setDietary(dietary.filter(d => d !== diet));
    else setDietary([...dietary, diet]);
  };

  const toggleInArray = (item: string, arr: string[], setArr: (next: string[]) => void) => {
    if (arr.includes(item)) setArr(arr.filter(i => i !== item));
    else setArr([...arr, item]);
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
            <Text style={styles.title}>Dietary Restrictions</Text>
            <Text style={styles.subtitle}>Select any diet restrictions that the suggestion engine should respect.</Text>

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
          </View>
        )}

        {step === 3 && (
          <View style={styles.stepContainer}>
            <Text style={styles.title}>Travel Pace</Text>
            <Text style={styles.subtitle}>How active do you want your scheduled trip itineraries to be?</Text>

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

        {step === 4 && (
          <View style={styles.stepContainer}>
            <Text style={styles.title}>Food Tastes</Text>
            <Text style={styles.subtitle}>Pick a few cuisines you enjoy — this is what both your own suggestions and shared-event matching with friends are based on. Optional, and you can always refine it later in Profile.</Text>
            <CategorizedPicker groupedOptions={FOOD_GENRES_CATEGORIZED} selected={foodGenres} onToggle={(opt) => toggleInArray(opt, foodGenres, setFoodGenres)} category="Restaurant" />
          </View>
        )}

        {step === 5 && (
          <View style={styles.stepContainer}>
            <Text style={styles.title}>Activity Tastes</Text>
            <Text style={styles.subtitle}>What kinds of things do you like doing when you have free time in a new city? Optional, refine anytime in Profile.</Text>
            <CategorizedPicker groupedOptions={ACTIVITY_GENRES_CATEGORIZED} selected={activityGenres} onToggle={(opt) => toggleInArray(opt, activityGenres, setActivityGenres)} category="Activity" />
          </View>
        )}

        {step === 6 && (
          <View style={styles.stepContainer}>
            <Text style={styles.title}>Event Tastes</Text>
            <Text style={styles.subtitle}>Concerts, shows, sports — pick what you&apos;re into. Optional, refine anytime in Profile.</Text>
            <CategorizedPicker groupedOptions={EVENT_GENRES_CATEGORIZED} selected={eventGenres} onToggle={(opt) => toggleInArray(opt, eventGenres, setEventGenres)} category="Event" />
          </View>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
        <Text style={styles.nextText}>{step === TOTAL_STEPS ? 'Complete Setup' : 'Next'}</Text>
      </TouchableOpacity>
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
