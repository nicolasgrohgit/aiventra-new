import React, { useState, useEffect } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, Text, Platform, TextInput, Alert, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/useAuth';
import { NativeDatePicker } from '@/components/ui/NativeDatePicker';
import { searchCities, CityResult } from '@/lib/geocoding';
import { FOOD_GENRES_CATEGORIZED, ACTIVITY_GENRES_CATEGORIZED, EVENT_GENRES_CATEGORIZED } from '@/constants/preferences';
import { CircleShareSelector } from '@/components/ui/circle-share-selector';
import { getAvatarResizeActions, AVATAR_JPEG_QUALITY, isAvatarBase64SizeAcceptable, toAvatarDataUri } from '@/lib/avatar';
import { OptionRow } from '@/components/profile/option-row';
import { ConfigRowModal } from '@/components/profile/config-row-modal';
import { CategorizedSelectionModal } from '@/components/profile/categorized-selection-modal';
import { GenericSelectionModal } from '@/components/profile/generic-selection-modal';
import { VersionHistoryModal } from '@/components/profile/version-history-modal';

export const COMMON_DIETS = ['Vegetarian', 'Vegan', 'Halal', 'Kosher', 'Gluten-Free', 'Keto', 'Nut-Free'];

export const CHANGELOG_HISTORY = [
  {
    version: '1.0.1',
    date: 'June 20, 2026',
    title: 'Bug Fixes & Refinements',
    changes: [
      'Fixed real-time calendar gaps recalculation (past slots disappear dynamically).',
      'Configured slot matching to suggest Cafes instead of heavy meals in the afternoon.',
      'Purged adverb-heavy descriptions from all mock database entries and fallback items.',
      'Updated user profile and onboarding subtitles to use natural, user-friendly language.',
      'Renamed technical navigation components and fixed JSX quote escaping warnings.'
    ]
  },
  {
    version: '1.0.0',
    date: 'June 5, 2026',
    title: 'Initial Release',
    changes: [
      'Basic dashboard layout with simulated authentication and user onboarding flow.',
      'Trips tab featuring day-by-day scheduling proposals and collapsible cards.',
      'Location and Open-Meteo weather forecasting integrations.',
      'Device calendar access framework with fallback simulations.'
    ]
  }
];

export default function ProfileScreen() {
  const { user, updatePreferences, updateUser, logout } = useAuth();
  // Derived from app.json rather than a second hardcoded copy, so the two can't drift apart.
  const appVersion = Constants.expoConfig?.version || CHANGELOG_HISTORY[0]?.version || '1.0.0';

  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [dob, setDob] = useState<Date>(new Date(user?.dob || '1990-01-01T12:00:00'));
  const [homebase, setHomebase] = useState(user?.homebase || '');
  // Standing "I live here" presence signal — private by default, opt-in per circle. See
  // Trip.sharedWithCircles (trips.tsx) for the parallel, date-bound "I'm traveling there"
  // signal — these are deliberately separate since one is tied to a trip and one isn't.
  const [homebaseSharedCircles, setHomebaseSharedCircles] = useState<string[]>(user?.homebaseSharedCircles || []);

  // City autocomplete/validation — catches typos before they silently fall through to
  // lib/recommendations.ts's fake "Local {typo} Cafe" placeholder content.
  const [homebaseSuggestions, setHomebaseSuggestions] = useState<CityResult[]>([]);
  const [homebaseWarning, setHomebaseWarning] = useState<string | null>(null);
  const [homebaseFocused, setHomebaseFocused] = useState(false);

  useEffect(() => {
    if (homebase.trim().length < 2) {
      setHomebaseSuggestions([]);
      setHomebaseWarning(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const results = await searchCities(homebase);
        if (cancelled) return;
        setHomebaseSuggestions(results);
        setHomebaseWarning(
          results.length === 0
            ? `We couldn't find a city matching "${homebase.trim()}" — double check the spelling, or continue if you're sure it's right.`
            : null
        );
      } catch {
        if (!cancelled) {
          setHomebaseSuggestions([]);
          setHomebaseWarning(null);
        }
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [homebase]);

  const [budget, setBudget] = useState(user?.preferences?.budget || '30-50');
  const [currency, setCurrency] = useState(user?.preferences?.currency || 'USD');
  const [dateFormat, setDateFormat] = useState(user?.preferences?.dateFormat || 'MM/DD/YYYY');
  const [activityPace, setActivityPace] = useState(user?.preferences?.activityLevel || 'Medium');
  // Earliest this user would eat that meal — shifts every dinner/lunch-window calculation
  // (recommendation category filtering, trip free-slot labeling/splitting) instead of the
  // one-size-fits-all default. Empty = "no preference set" (today's fixed defaults), not a
  // pill selection of its own — OptionRow's `current` just won't match any option then.
  const [earliestLunchTime, setEarliestLunchTime] = useState(user?.preferences?.earliestLunchTime || '');
  const [earliestDinnerTime, setEarliestDinnerTime] = useState(user?.preferences?.earliestDinnerTime || '');

  const [dietary, setDietary] = useState<string[]>(user?.preferences?.dietary || []);
  const [foodGenres, setFoodGenres] = useState<string[]>(user?.preferences?.foodGenres || []);
  const [activityGenres, setActivityGenres] = useState<string[]>(user?.preferences?.activityGenres || []);
  const [eventGenres, setEventGenres] = useState<string[]>(user?.preferences?.eventGenres || []);

  const [showDietModal, setShowDietModal] = useState(false);
  const [showFoodModal, setShowFoodModal] = useState(false);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  // Disables the avatar tap target and swaps in a spinner while the pick -> crop -> resize ->
  // compress pipeline runs, so a slow device/large source photo can't be tapped again mid-flight
  // (which would kick off a second concurrent updateUser call).
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  // Saves immediately on tap rather than waiting for the form's "Save Changes" button —
  // deliberately different from every other field on this screen. Live-reported: toggling
  // this and assuming it was saved (matching how every toggle/switch elsewhere on a phone
  // behaves — iOS Settings, notification permissions, etc. all save instantly) is exactly
  // what happened, and the change silently never reached the server since it was actually
  // sitting behind the separate Save Changes button like every text field. "I indeed
  // completely forgot about that, and so will our users" — the fix is making this control
  // actually match the instant-save behavior it already visually implies, not adding a
  // reminder/blocker for the batched-save button.
  const toggleHomebaseCircle = (circle: string) => {
    const next = homebaseSharedCircles.includes(circle)
      ? homebaseSharedCircles.filter(c => c !== circle)
      : [...homebaseSharedCircles, circle];
    setHomebaseSharedCircles(next);
    updateUser({ homebaseSharedCircles: next });
  };

  // Shared by both the camera and library sources: crops+resizes+compresses whatever the
  // picker returned down to a small, bounded avatar (see lib/avatar.ts for why — no object
  // storage in this stack, so this becomes a base64 data URI stored directly on the user doc),
  // then persists it through the existing offline-first updateUser path.
  const applyPickedAvatar = async (sourceUri: string) => {
    setIsUploadingAvatar(true);
    try {
      const manipulated = await manipulateAsync(sourceUri, getAvatarResizeActions(), {
        compress: AVATAR_JPEG_QUALITY,
        format: SaveFormat.JPEG,
        base64: true
      });
      if (!manipulated.base64) {
        throw new Error('Image processing did not return base64 data');
      }
      if (!isAvatarBase64SizeAcceptable(manipulated.base64)) {
        Alert.alert('Image too large', 'That photo is too large to use as a profile picture. Please try a different one.');
        return;
      }
      updateUser({ avatarUrl: toAvatarDataUri(manipulated.base64) });
    } catch (err) {
      console.warn('Failed to process picked avatar image:', err);
      Alert.alert('Something went wrong', 'We could not update your profile picture. Please try again.');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const pickAvatarFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Odys.ai needs access to your photos to set a profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    await applyPickedAvatar(result.assets[0].uri);
  };

  const pickAvatarFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Odys.ai needs camera access to take a profile picture.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    await applyPickedAvatar(result.assets[0].uri);
  };

  const handleChangeAvatar = () => {
    if (isUploadingAvatar) return;
    Alert.alert('Change Profile Picture', undefined, [
      { text: 'Take Photo', onPress: pickAvatarFromCamera },
      { text: 'Choose from Library', onPress: pickAvatarFromLibrary },
      { text: 'Cancel', style: 'cancel' }
    ]);
  };

  const handleSave = () => {
    updateUser({
      firstName,
      lastName,
      email,
      homebase,
      homebaseSharedCircles,
      dob: dob.toISOString().split('T')[0],
      name: `${firstName} ${lastName}`.trim()
    });
    updatePreferences({ budget, currency, dateFormat, activityLevel: activityPace, dietary, foodGenres, activityGenres, eventGenres, earliestLunchTime, earliestDinnerTime });
    Alert.alert('Saved', 'Your profile has been updated.');
  };

  const toggleArrayItem = (item: string, stateArray: string[], setStateArray: (arr: string[]) => void) => {
    if (stateArray.includes(item)) {
      setStateArray(stateArray.filter(i => i !== item));
    } else {
      setStateArray([...stateArray, item]);
    }
  };

  // OptionRow, ConfigRowModal, CategorizedSelectionModal, GenericSelectionModal, and
  // VersionHistoryModal used to be defined inline here (re-created every render) — extracted
  // to components/profile/*.tsx. See CHANGELOG.md's cleanliness-audit entry.

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.avatarWrapper}
            onPress={handleChangeAvatar}
            activeOpacity={0.7}
            disabled={isUploadingAvatar}
          >
            {user?.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarHolder}><Text style={styles.avatarText}>{firstName ? firstName.charAt(0) : 'U'}</Text></View>
            )}
            {isUploadingAvatar ? (
              <View style={styles.avatarOverlay}><ActivityIndicator color="#FFF" /></View>
            ) : (
              <View style={styles.avatarEditBadge}><Text style={styles.avatarEditBadgeText}>✎</Text></View>
            )}
          </TouchableOpacity>
          <View>
            <ThemedText style={styles.title}>{firstName} {lastName}</ThemedText>
            <ThemedText style={styles.subtitle}>{email}</ThemedText>
          </View>
        </View>

        <View style={styles.engineConfigCard}>
           <Text style={styles.cardHeader}>Personal Details</Text>
           <Text style={styles.cardDesc}>Manage your basic identity and contact information.</Text>
           <View style={styles.separator} />
           
           <Text style={styles.inputLabel}>First Name</Text>
           <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} placeholderTextColor="#64748B" />

           <Text style={styles.inputLabel}>Last Name</Text>
           <TextInput style={styles.input} value={lastName} onChangeText={setLastName} placeholderTextColor="#64748B" />

           <Text style={styles.inputLabel}>Email</Text>
           <TextInput style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholderTextColor="#64748B" />

           <Text style={styles.inputLabel}>Homebase (City)</Text>
           <View style={{ marginBottom: 20 }}>
             <TextInput
               style={[styles.input, { marginBottom: 0 }]}
               value={homebase}
               onChangeText={setHomebase}
               placeholder="e.g. New York, USA"
               placeholderTextColor="#64748B"
               onFocus={() => setHomebaseFocused(true)}
               onBlur={() => setTimeout(() => setHomebaseFocused(false), 150)}
             />
             {homebaseFocused && homebaseSuggestions.length > 0 && (
               <View style={styles.citySuggestionsBox}>
                 {homebaseSuggestions.map((c, i) => (
                   <TouchableOpacity
                     key={`${c.name}-${c.latitude}-${i}`}
                     style={styles.citySuggestionRow}
                     onPress={() => {
                       setHomebase(`${c.name}, ${c.country}`);
                       setHomebaseSuggestions([]);
                       setHomebaseWarning(null);
                       setHomebaseFocused(false);
                     }}
                   >
                     <Text style={styles.citySuggestionText}>{c.name}{c.admin1 ? `, ${c.admin1}` : ''}</Text>
                     <Text style={styles.citySuggestionSub}>{c.country}</Text>
                   </TouchableOpacity>
                 ))}
               </View>
             )}
             {homebaseWarning && <Text style={styles.cityWarningText}>{homebaseWarning}</Text>}
           </View>

           <CircleShareSelector
             label="Share My Home City With"
             helperText="Lets people in these circles see you live here when they're planning a trip there. Private by default — nothing is shared until you pick a circle."
             selected={homebaseSharedCircles}
             onToggle={toggleHomebaseCircle}
           />

           <Text style={styles.inputLabel}>Date of Birth</Text>
           <NativeDatePicker value={dob} onChange={setDob} mode="date" format="date" />
        </View>

        <View style={styles.engineConfigCard}>
           <Text style={styles.cardHeader}>Preferences & Interests</Text>
           <Text style={styles.cardDesc}>Customize your activity and dining preferences to receive better contextual recommendations.</Text>
           <View style={styles.separator} />
           
           <OptionRow label="Travel Pace" options={['Low', 'Medium', 'High']} current={activityPace} onSelect={setActivityPace} />
           <OptionRow label="Budget Range" options={['10-20', '30-50', '70+']} current={budget} onSelect={setBudget} />
           <OptionRow label="Currency" options={['USD', 'EUR', 'GBP']} current={currency} onSelect={setCurrency} />
           <OptionRow label="Date Format" options={['DD/MM/YYYY', 'MM/DD/YYYY']} current={dateFormat} onSelect={setDateFormat} />
           <OptionRow
             label="Earliest Lunch"
             options={['12:00', '12:30', '13:00', '13:30', '14:00']}
             current={earliestLunchTime}
             onSelect={setEarliestLunchTime}
             wrap
           />
           <OptionRow
             label="Earliest Dinner"
             options={['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00']}
             current={earliestDinnerTime}
             onSelect={setEarliestDinnerTime}
             wrap
           />

           <ConfigRowModal title="Dietary Restrictions" arrayString={dietary} openModal={() => setShowDietModal(true)} />
           <ConfigRowModal title="Restaurant Cuisines" arrayString={foodGenres} openModal={() => setShowFoodModal(true)} />
           <ConfigRowModal title="Preferred Activities" arrayString={activityGenres} openModal={() => setShowActivityModal(true)} />
           <ConfigRowModal title="Favorite Event Types" arrayString={eventGenres} openModal={() => setShowEventModal(true)} />
        </View>

        <TouchableOpacity
           style={styles.engineConfigCard}
           activeOpacity={0.7}
           onPress={() => setShowVersionModal(true)}
         >
            <Text style={styles.cardHeader}>About</Text>
            <Text style={styles.cardDesc}>App Version: v{appVersion} (View Changelog)</Text>
         </TouchableOpacity>

        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>Save Changes</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
      <GenericSelectionModal visible={showDietModal} close={() => setShowDietModal(false)} title="Dietary Limiters" description="Select any dietary restrictions to exclude matching food options from your suggestions." options={COMMON_DIETS} selected={dietary} toggle={(i:string) => toggleArrayItem(i, dietary, setDietary)} />
      <CategorizedSelectionModal visible={showFoodModal} close={() => setShowFoodModal(false)} title="Dining Contexts" description="Select your favorite cuisines to prioritize them in dining recommendations." groupedOptions={FOOD_GENRES_CATEGORIZED} selected={foodGenres} onSelectedChange={setFoodGenres} category="Restaurant" />
      <CategorizedSelectionModal visible={showActivityModal} close={() => setShowActivityModal(false)} title="Activity Genres" description="Choose the types of outdoor and indoor activities you enjoy most." groupedOptions={ACTIVITY_GENRES_CATEGORIZED} selected={activityGenres} onSelectedChange={setActivityGenres} category="Activity" />
      <CategorizedSelectionModal visible={showEventModal} close={() => setShowEventModal(false)} title="Event Types" description="Select the categories of live entertainment and events you would like to discover." groupedOptions={EVENT_GENRES_CATEGORIZED} selected={eventGenres} onSelectedChange={setEventGenres} category="Event" />
      <VersionHistoryModal visible={showVersionModal} close={() => setShowVersionModal(false)} history={CHANGELOG_HISTORY} />

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scrollContent: { padding: 24, paddingTop: Platform.OS === 'ios' ? 60 : 60, paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 32 },
  avatarWrapper: { width: 70, height: 70, marginRight: 16 },
  avatarHolder: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#3B82F6', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#FFF', fontSize: 32, fontWeight: 'bold' },
  avatarImage: { width: 70, height: 70, borderRadius: 35 },
  avatarOverlay: { position: 'absolute', top: 0, left: 0, width: 70, height: 70, borderRadius: 35, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  avatarEditBadge: { position: 'absolute', bottom: -2, right: -2, width: 26, height: 26, borderRadius: 13, backgroundColor: '#3B82F6', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#0A0A0A' },
  avatarEditBadgeText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  title: { color: '#FFF', fontSize: 26, fontWeight: '800' },
  subtitle: { color: '#94A3B8', fontSize: 16 },
  engineConfigCard: { backgroundColor: '#0F172A', padding: 24, borderRadius: 20, borderWidth: 1, borderColor: '#1E293B', marginBottom: 32 },
  cardHeader: { color: '#F8FAFC', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  cardDesc: { color: '#64748B', fontSize: 14, lineHeight: 22 },
  separator: { height: 1, backgroundColor: '#1E293B', marginVertical: 24 },
  
  inputLabel: { color: '#DBEAFE', fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 },
  input: { backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#1E293B', borderRadius: 12, padding: 14, color: '#FFF', fontSize: 16, marginBottom: 20 },

  citySuggestionsBox: { backgroundColor: '#1E293B', borderRadius: 12, borderWidth: 1, borderColor: '#334155', marginTop: 8, overflow: 'hidden' },
  citySuggestionRow: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#0F172A' },
  citySuggestionText: { color: '#F8FAFC', fontSize: 15, fontWeight: '600' },
  citySuggestionSub: { color: '#64748B', fontSize: 12, marginTop: 2 },
  cityWarningText: { color: '#F59E0B', fontSize: 13, marginTop: 8, lineHeight: 18 },

  // optionRowContainer/optionLabel/optionsWrapper/optionPill/optionText (+ variants) and
  // dietHeaderRow/editDietBtn/dietTagsView/dietTag/dietTagText removed — those lived only
  // inside the extracted OptionRow/ConfigRowModal components (components/profile/option-row.tsx,
  // components/profile/config-row-modal.tsx), which define their own local styles now.

  saveButton: { backgroundColor: '#1E293B', paddingVertical: 18, borderRadius: 16, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#334155' },
  saveButtonText: { color: '#F8FAFC', fontSize: 16, fontWeight: '800' },
  logoutButton: { backgroundColor: 'rgba(220, 38, 38, 0.1)', paddingVertical: 18, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(220, 38, 38, 0.3)' },
  logoutText: { color: '#FCA5A5', fontSize: 16, fontWeight: '800' },

  // modalContainer/modalHeader/modalTitle/closeButton/closeButtonText/modalSubtitle,
  // dietModalOption*/checkmark, categoryGroup/categoryTitle/bubblesContainer/bubbleOption*/
  // comingSoonBadge/categoryNote, and changelog* removed — those lived only inside the
  // extracted CategorizedSelectionModal/GenericSelectionModal/VersionHistoryModal components
  // (components/profile/{categorized-selection-modal,generic-selection-modal,
  // version-history-modal}.tsx), which define their own local styles now.
});
