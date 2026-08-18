import React, { useState, useEffect } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, Text, Platform, TextInput, Modal } from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/useAuth';
import { NativeDatePicker } from '@/components/ui/NativeDatePicker';
import * as Calendar from 'expo-calendar';
import { searchCities, CityResult } from '@/lib/geocoding';
import { FOOD_GENRES_CATEGORIZED, ACTIVITY_GENRES_CATEGORIZED, EVENT_GENRES_CATEGORIZED } from '@/constants/preferences';

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
  
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [dob, setDob] = useState<Date>(new Date(user?.dob || '1990-01-01T12:00:00'));
  const [homebase, setHomebase] = useState(user?.homebase || '');

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
  
  const [dietary, setDietary] = useState<string[]>(user?.preferences?.dietary || []);
  const [foodGenres, setFoodGenres] = useState<string[]>(user?.preferences?.foodGenres || []);
  const [activityGenres, setActivityGenres] = useState<string[]>(user?.preferences?.activityGenres || []);
  const [eventGenres, setEventGenres] = useState<string[]>(user?.preferences?.eventGenres || []);

  const [showDietModal, setShowDietModal] = useState(false);
  const [showFoodModal, setShowFoodModal] = useState(false);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);

  const handleSave = () => {
    updateUser({ 
      firstName, 
      lastName, 
      email, 
      homebase,
      dob: dob.toISOString().split('T')[0], 
      name: `${firstName} ${lastName}`.trim() 
    });
    updatePreferences({ budget, currency, dateFormat, activityLevel: activityPace, dietary, foodGenres, activityGenres, eventGenres });
    alert("Profile explicit structures organically mapped globally!");
  };

  const toggleArrayItem = (item: string, stateArray: string[], setStateArray: (arr: string[]) => void) => {
    if (stateArray.includes(item)) {
      setStateArray(stateArray.filter(i => i !== item));
    } else {
      setStateArray([...stateArray, item]);
    }
  };

  const OptionRow = ({ label, options, current, onSelect }: any) => (
    <View style={styles.optionRowContainer}>
      <Text style={styles.optionLabel}>{label}</Text>
      <View style={styles.optionsWrapper}>
        {options.map((opt: string) => (
          <TouchableOpacity 
            key={opt}
            onPress={() => onSelect(opt)}
            activeOpacity={0.8}
            style={[styles.optionPill, current === opt && styles.optionPillActive]}
          >
            <Text style={[styles.optionText, current === opt && styles.optionTextActive]}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const ConfigRowModal = ({ title, arrayString, openModal }: { title: string, arrayString: string[], openModal: () => void }) => (
     <View style={{ marginBottom: 24 }}>
       <View style={styles.dietHeaderRow}>
         <Text style={styles.optionLabel}>{title}</Text>
         <TouchableOpacity style={styles.editDietBtn} onPress={openModal}>
           <Text style={styles.editDietBtnText}>Edit</Text>
         </TouchableOpacity>
       </View>
       <View style={styles.dietTagsView}>
         {arrayString?.map((item: string, i: number) => (
           <View key={i} style={styles.dietTag}><Text style={styles.dietTagText}>{item}</Text></View>
         ))}
         {arrayString.length === 0 && <Text style={styles.cardDesc}>Nothing selected yet.</Text>}
       </View>
     </View>
  );

  const CategorizedSelectionModal = ({ visible, close, title, description, groupedOptions, selected, toggle }: any) => (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{title}</Text>
          <TouchableOpacity onPress={close} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.modalSubtitle}>{description}</Text>
        
        <ScrollView showsVerticalScrollIndicator={false}>
          {groupedOptions.map((group: any) => (
            <View key={group.type} style={styles.categoryGroup}>
              <Text style={styles.categoryTitle}>{group.type}</Text>
              <View style={styles.bubblesContainer}>
                {group.activities.map((opt: string) => {
                  const active = selected.includes(opt);
                  return (
                    <TouchableOpacity 
                      key={opt} 
                      style={[styles.bubbleOption, active && styles.bubbleOptionActive]} 
                      onPress={() => toggle(opt)} 
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.bubbleOptionText, active && styles.bubbleOptionTextActive]}>{opt}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );

  const GenericSelectionModal = ({ visible, close, title, description, options, selected, toggle }: any) => (
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
          {options.map((opt: string) => {
            const active = selected.includes(opt);
            return (
              <TouchableOpacity key={opt} style={[styles.dietModalOption, active && styles.dietModalOptionActive]} onPress={() => toggle(opt)} activeOpacity={0.7}>
                <Text style={[styles.dietModalOptionText, active && styles.dietModalOptionTextActive]}>{opt}</Text>
                {active && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      </View>
    </Modal>
  );

  const VersionHistoryModal = ({ visible, close }: { visible: boolean, close: () => void }) => (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Version History</Text>
          <TouchableOpacity onPress={close} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.modalSubtitle}>Track the evolution and changes made to Odys.ai.</Text>
        
        <ScrollView showsVerticalScrollIndicator={false}>
          {CHANGELOG_HISTORY.map((item) => (
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

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          {user?.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarHolder}><Text style={styles.avatarText}>{firstName ? firstName.charAt(0) : 'U'}</Text></View>
          )}
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
           
           <ConfigRowModal title="Dietary Restrictions" arrayString={dietary} openModal={() => setShowDietModal(true)} />
           <ConfigRowModal title="Restaurant Cuisines" arrayString={foodGenres} openModal={() => setShowFoodModal(true)} />
           <ConfigRowModal title="Preferred Activities" arrayString={activityGenres} openModal={() => setShowActivityModal(true)} />
           <ConfigRowModal title="Favorite Event Types" arrayString={eventGenres} openModal={() => setShowEventModal(true)} />
        </View>

        <View style={styles.engineConfigCard}>
           <Text style={styles.cardHeader}>Integrations</Text>
           <Text style={styles.cardDesc}>Sync external services for better context resolution.</Text>
           <View style={styles.separator} />
           
           <TouchableOpacity style={styles.integrationBtn} onPress={async () => {
             const { status } = await Calendar.requestCalendarPermissionsAsync();
             if (status === 'granted') {
               alert("Native Calendar successfully linked!");
             } else {
               alert("Permission denied. Calendar unlinked.");
             }
           }}>
             <Text style={styles.integrationBtnText}>Sync Native Calendar</Text>
           </TouchableOpacity>
        </View>

        <TouchableOpacity 
           style={styles.engineConfigCard} 
           activeOpacity={0.7} 
           onPress={() => setShowVersionModal(true)}
         >
            <Text style={styles.cardHeader}>About</Text>
            <Text style={styles.cardDesc}>App Version: v1.0.1 (View Changelog)</Text>
         </TouchableOpacity>

        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>Apply Adjustments</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
      <GenericSelectionModal visible={showDietModal} close={() => setShowDietModal(false)} title="Dietary Limiters" description="Select any dietary restrictions to exclude matching food options from your suggestions." options={COMMON_DIETS} selected={dietary} toggle={(i:string) => toggleArrayItem(i, dietary, setDietary)} />
      <CategorizedSelectionModal visible={showFoodModal} close={() => setShowFoodModal(false)} title="Dining Contexts" description="Select your favorite cuisines to prioritize them in dining recommendations." groupedOptions={FOOD_GENRES_CATEGORIZED} selected={foodGenres} toggle={(i:string) => toggleArrayItem(i, foodGenres, setFoodGenres)} />
      <CategorizedSelectionModal visible={showActivityModal} close={() => setShowActivityModal(false)} title="Activity Genres" description="Choose the types of outdoor and indoor activities you enjoy most." groupedOptions={ACTIVITY_GENRES_CATEGORIZED} selected={activityGenres} toggle={(i:string) => toggleArrayItem(i, activityGenres, setActivityGenres)} />
      <CategorizedSelectionModal visible={showEventModal} close={() => setShowEventModal(false)} title="Event Types" description="Select the categories of live entertainment and events you would like to discover." groupedOptions={EVENT_GENRES_CATEGORIZED} selected={eventGenres} toggle={(i:string) => toggleArrayItem(i, eventGenres, setEventGenres)} />
      <VersionHistoryModal visible={showVersionModal} close={() => setShowVersionModal(false)} />

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scrollContent: { padding: 24, paddingTop: Platform.OS === 'ios' ? 60 : 60, paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 32 },
  avatarHolder: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#3B82F6', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  avatarText: { color: '#FFF', fontSize: 32, fontWeight: 'bold' },
  avatarImage: { width: 70, height: 70, borderRadius: 35, marginRight: 16 },
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

  optionRowContainer: { marginBottom: 28 },
  optionLabel: { color: '#DBEAFE', fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginBottom: 16 },
  optionsWrapper: { flexDirection: 'row', gap: 12 },
  optionPill: { flex: 1, paddingVertical: 14, backgroundColor: '#1E293B', borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  optionPillActive: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  optionText: { color: '#94A3B8', fontWeight: '600', fontSize: 15 },
  optionTextActive: { color: '#FFF' },
  
  dietHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  editDietBtn: { backgroundColor: '#1E293B', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  editDietBtnText: { color: '#3B82F6', fontWeight: 'bold', fontSize: 13 },
  dietTagsView: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  dietTag: { backgroundColor: 'rgba(16, 185, 129, 0.1)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.3)' },
  dietTagText: { color: '#10B981', fontWeight: '700', fontSize: 14 },
  
  saveButton: { backgroundColor: '#1E293B', paddingVertical: 18, borderRadius: 16, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#334155' },
  saveButtonText: { color: '#F8FAFC', fontSize: 16, fontWeight: '800' },
  logoutButton: { backgroundColor: 'rgba(220, 38, 38, 0.1)', paddingVertical: 18, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(220, 38, 38, 0.3)' },
  logoutText: { color: '#FCA5A5', fontSize: 16, fontWeight: '800' },
  integrationBtn: { backgroundColor: 'rgba(59, 130, 246, 0.15)', paddingVertical: 16, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#3B82F6' },
  integrationBtnText: { color: '#3B82F6', fontSize: 15, fontWeight: '800' },

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
  categoryGroup: { marginBottom: 28 },
  categoryTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: '700', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
  bubblesContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  bubbleOption: { backgroundColor: '#1E293B', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#334155' },
  bubbleOptionActive: { backgroundColor: 'rgba(59, 130, 246, 0.15)', borderColor: '#3B82F6' },
  bubbleOptionText: { color: '#94A3B8', fontSize: 14, fontWeight: '600' },
  bubbleOptionTextActive: { color: '#3B82F6' },
  
  changelogCard: { backgroundColor: '#1E293B', padding: 20, borderRadius: 16, marginBottom: 20, borderWidth: 1, borderColor: '#334155' },
  changelogHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  changelogVersion: { color: '#3B82F6', fontSize: 18, fontWeight: '800' },
  changelogDate: { color: '#64748B', fontSize: 13, fontWeight: '600' },
  changelogTitle: { color: '#F8FAFC', fontSize: 15, fontWeight: '700', marginBottom: 14 },
  changelogList: { gap: 8 },
  changelogRow: { flexDirection: 'row', alignItems: 'flex-start' },
  changelogBullet: { color: '#3B82F6', marginRight: 8, fontSize: 14, fontWeight: 'bold' },
  changelogText: { color: '#CBD5E1', fontSize: 14, lineHeight: 20, flex: 1 }
});
