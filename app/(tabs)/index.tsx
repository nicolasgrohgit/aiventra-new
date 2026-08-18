import React, { useState, useEffect } from 'react';
import { Platform, StyleSheet, View, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/useAuth';
import { calculateFreeTimeSlots, generateMockEventsForToday, getDeviceEventsForToday, FreeTimeSlot, CalendarEvent } from '@/lib/calendar';
import * as Location from 'expo-location';
import * as Calendar from 'expo-calendar';
import { fetchWeather, WeatherData } from '@/lib/weather';

// ─── Greeting helpers ────────────────────────────────────────────────────────
function getGreeting(): { text: string; emoji: string } {
  const hour = new Date().getHours();
  if (hour >= 5  && hour < 12) return { text: 'Good Morning',   emoji: '☀️' };
  if (hour >= 12 && hour < 17) return { text: 'Good Afternoon', emoji: '🌞' };
  if (hour >= 17 && hour < 21) return { text: 'Good Evening',   emoji: '🌆' };
  return                               { text: 'Good Night',     emoji: '🌙' };
}

export default function HomeScreen() {
  const { user, trips } = useAuth();
  const router = useRouter();

  // Calendar
  const [events,    setEvents]    = useState<CalendarEvent[]>([]);
  const [freeSlots, setFreeSlots] = useState<FreeTimeSlot[]>([]);
  const [showEngineBanner, setShowEngineBanner] = useState(true);
  const [calendarPermissionStatus, setCalendarPermissionStatus] = useState<string | null>(null);
  const [currentTimeKey, setCurrentTimeKey] = useState(Date.now());

  // Location & context
  const [contextCity,    setContextCity]    = useState('');
  const [locationCity,   setLocationCity]   = useState('');
  const [locationRegion, setLocationRegion] = useState('');
  const [locationError,  setLocationError]  = useState<string | null>(null);

  // Weather
  const [weather,        setWeather]        = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);

  // ── Auto-recalculation timer ────────────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimeKey(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // ── Location + Weather ───────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setLocationError('Location access denied');
          setWeatherLoading(false);
          return;
        }

        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const { latitude, longitude } = pos.coords;

        // Reverse geocode → city name
        const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
        const city   = place?.city || place?.district || place?.subregion || '';
        const region = place?.region || place?.country || '';
        setLocationCity(city);
        setLocationRegion(region);
        setContextCity(city);          // real location overrides everything

        // Fetch weather
        const w = await fetchWeather(latitude, longitude);
        setWeather(w);
      } catch {
        setLocationError('Could not get location');
      } finally {
        setWeatherLoading(false);
      }
    })();
  }, []);

  // ── Calendar events ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { status } = await Calendar.getCalendarPermissionsAsync();
      setCalendarPermissionStatus(status);
      
      let finalEvents = generateMockEventsForToday();
      if (status === 'granted') {
        const evts = await getDeviceEventsForToday(false);
        if (evts.length > 0) finalEvents = evts;
      }
      
      setEvents(finalEvents);
      setFreeSlots(calculateFreeTimeSlots(finalEvents, 8, 22, 60));
    })();

    // City fallback if location not yet resolved
    if (!locationCity) {
      const today = new Date();
      const activeTrip = trips.find((t: any) => t.startDate <= today && t.endDate >= today);
      setContextCity(activeTrip ? activeTrip.destination : (user?.homebase || 'New York, USA'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips, user, currentTimeKey]); // recalculate dynamically as time ticks

  const formatTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const handleConnectCalendar = async () => {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    setCalendarPermissionStatus(status);
    if (status === 'granted') {
      const evts = await getDeviceEventsForToday(false);
      const finalEvents = evts.length > 0 ? evts : generateMockEventsForToday();
      setEvents(finalEvents);
      setFreeSlots(calculateFreeTimeSlots(finalEvents, 8, 22, 60));
    }
  };

  const handleSuggest = (slot: FreeTimeSlot) => {
    router.push({
      pathname: '/recommendation' as any,
      params: {
        duration: slot.durationMinutes,
        start:    slot.startTime.toISOString(),
        end:      slot.endTime.toISOString(),
        cityContext: contextCity,
      },
    });
  };

  const handleEventSuggest = (evt: CalendarEvent) => {
    const durationMins = Math.round((evt.endTime.getTime() - evt.startTime.getTime()) / 60000);
    router.push({
      pathname: '/recommendation' as any,
      params: {
        eventId: evt.id,
        duration: durationMins,
        start:    evt.startTime.toISOString(),
        end:      evt.endTime.toISOString(),
        cityContext: contextCity,
      },
    });
  };

  const { text: greetingText, emoji: greetingEmoji } = getGreeting();

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <ThemedText style={styles.greeting}>
            {greetingText}, {user?.name?.split(' ')[0] || 'Traveler'} {greetingEmoji}
          </ThemedText>
          {locationCity ? (
            <ThemedText style={styles.locationLine}>
              📍 {locationCity}{locationRegion ? `, ${locationRegion}` : ''}
            </ThemedText>
          ) : (
            <ThemedText style={styles.subtitle}>{"We've scanned your itinerary for today."}</ThemedText>
          )}
        </View>

        {/* ── Weather Card ── */}
        {weatherLoading ? (
          <View style={styles.weatherLoading}>
            <ActivityIndicator color="#3B82F6" size="small" />
            <ThemedText style={styles.weatherLoadingText}>Fetching local weather…</ThemedText>
          </View>
        ) : weather ? (
          <View style={styles.weatherCard}>
            {/* Left: big temp */}
            <View style={styles.weatherLeft}>
              <ThemedText style={styles.weatherEmoji}>{weather.emoji}</ThemedText>
              <ThemedText style={styles.weatherTemp}>{weather.temperature}°C</ThemedText>
              <ThemedText style={styles.weatherDesc}>{weather.description}</ThemedText>
            </View>
            {/* Right: details */}
            <View style={styles.weatherRight}>
              <ThemedText style={styles.weatherCityLabel}>
                {locationCity || 'Local weather'}
              </ThemedText>
              <View style={styles.weatherHLRow}>
                <View style={styles.weatherHLItem}>
                  <ThemedText style={styles.weatherHLLabel}>HIGH</ThemedText>
                  <ThemedText style={styles.weatherHLValue}>{weather.tempMax}°</ThemedText>
                </View>
                <View style={styles.weatherDivider} />
                <View style={styles.weatherHLItem}>
                  <ThemedText style={styles.weatherHLLabel}>LOW</ThemedText>
                  <ThemedText style={styles.weatherHLValue}>{weather.tempMin}°</ThemedText>
                </View>
              </View>
              <View style={styles.weatherWindRow}>
                <ThemedText style={styles.weatherWindText}>💨 {weather.windspeed} km/h</ThemedText>
              </View>
            </View>
          </View>
        ) : locationError ? (
          <View style={styles.weatherError}>
            <ThemedText style={styles.weatherErrorText}>🌡️ {locationError} — enable location for local weather & proposals</ThemedText>
          </View>
        ) : null}

        {/* ── Engine Banner ── */}
        {showEngineBanner && (
          <View style={styles.heroCard}>
            <View style={styles.heroContent}>
              <ThemedText style={styles.heroTitle}>Odys.ai Time-Gap Engine</ThemedText>
              <ThemedText style={styles.heroText}>
                {freeSlots.length} free block{freeSlots.length !== 1 ? 's' : ''} detected today
                {locationCity ? ` in ${locationCity}` : ''}. Tap a slot for AI suggestions.
              </ThemedText>
            </View>
            <TouchableOpacity
              onPress={() => setShowEngineBanner(false)}
              style={{ position: 'absolute', top: 12, right: 12, padding: 8 }}
            >
              <ThemedText style={{ color: '#BFDBFE', fontSize: 16, fontWeight: 'bold' }}>✕</ThemedText>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Native Calendar Connections ── */}
        {calendarPermissionStatus !== 'granted' && (
          <TouchableOpacity style={styles.connectCalendarCard} onPress={handleConnectCalendar}>
            <View style={styles.connectCalendarContent}>
              <ThemedText style={{fontSize: 24, marginRight: 12}}>📅</ThemedText>
              <View style={{flex: 1}}>
                <ThemedText style={styles.connectCalendarTitle}>Sync Native Calendar</ThemedText>
                <ThemedText style={styles.connectCalendarDesc}>Odys.ai is currently using mock data. Connect your device calendar for real scheduling!</ThemedText>
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* ── Free Slots ── */}
        <ThemedText style={styles.sectionTitle}>
          Free time today{locationCity ? ` · ${locationCity}` : ''}
        </ThemedText>
        <View style={styles.timeline}>
          {events.length === 0 && (
            <ThemedText style={styles.subtitle}>No events today!</ThemedText>
          )}

          {freeSlots.map((slot, idx) => (
            <TouchableOpacity
              key={`slot-${idx}`}
              style={styles.freeSlotCard}
              onPress={() => handleSuggest(slot)}
              activeOpacity={0.8}
            >
              <View style={styles.slotContent}>
                <ThemedText style={styles.slotTime}>
                  {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
                </ThemedText>
                <ThemedText style={styles.slotDuration}>{slot.durationMinutes} min free</ThemedText>
                <ThemedText style={styles.slotDescription}>
                  Tap to get AI suggestions fitting this gap{locationCity ? ` in ${locationCity}` : ''}.
                </ThemedText>
              </View>
              <View style={styles.chevron}>
                <ThemedText style={styles.chevronText}>›</ThemedText>
              </View>
            </TouchableOpacity>
          ))}

          {/* Scheduled conflicts */}
          <ThemedText style={[styles.sectionTitle, { marginTop: 32, marginBottom: 8 }]}>Scheduled Conflicts</ThemedText>
          <ThemedText style={[styles.subtitle, { marginBottom: 20 }]}>Tap on any busy slot below to discover AI alternatives or find nearby activities!</ThemedText>
          {events.map(evt => (
            <TouchableOpacity 
              key={evt.id} 
              style={styles.eventCard}
              onPress={() => handleEventSuggest(evt)}
              activeOpacity={0.8}
            >
              <ThemedText style={styles.eventTime}>
                {formatTime(evt.startTime)} – {formatTime(evt.endTime)}
              </ThemedText>
              <ThemedText style={styles.eventTitle}>{evt.title}</ThemedText>
              <ThemedText style={styles.eventLocation}>{evt.location}</ThemedText>
              <ThemedText style={{ color: '#FCA5A5', marginTop: 8, fontSize: 13, fontWeight: '600' }}>
                Tap to plan something during this event
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scrollContent: {
    padding: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 60,
    paddingBottom: 100,
  },

  // Header
  header:       { marginBottom: 24, marginTop: 10 },
  greeting:     { color: '#FFFFFF', fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginBottom: 6 },
  locationLine: { color: '#3B82F6', fontSize: 15, fontWeight: '600' },
  subtitle:     { color: '#A0A0A0', fontSize: 16, letterSpacing: 0.2 },

  // Weather card
  weatherCard: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 24,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 6,
    alignItems: 'center',
  },
  weatherLeft: { flex: 1, alignItems: 'center', paddingRight: 16, borderRightWidth: 1, borderRightColor: '#1E293B' },
  weatherEmoji: { fontSize: 44, marginBottom: 4 },
  weatherTemp:  { color: '#FFFFFF', fontSize: 40, fontWeight: '800', letterSpacing: -1, lineHeight: 44 },
  weatherDesc:  { color: '#94A3B8', fontSize: 13, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  weatherRight: { flex: 1, paddingLeft: 20 },
  weatherCityLabel: { color: '#F8FAFC', fontSize: 16, fontWeight: '800', marginBottom: 12 },
  weatherHLRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  weatherHLItem: { flex: 1, alignItems: 'center' },
  weatherHLLabel: { color: '#64748B', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  weatherHLValue: { color: '#E2E8F0', fontSize: 20, fontWeight: '800' },
  weatherDivider: { width: 1, height: 32, backgroundColor: '#1E293B', marginHorizontal: 8 },
  weatherWindRow: { },
  weatherWindText: { color: '#64748B', fontSize: 13, fontWeight: '600' },

  weatherLoading: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#0F172A', borderRadius: 16, padding: 18,
    marginBottom: 24, borderWidth: 1, borderColor: '#1E293B',
  },
  weatherLoadingText: { color: '#64748B', fontSize: 14 },
  weatherError: {
    backgroundColor: '#1C1917', borderRadius: 16, padding: 16,
    marginBottom: 24, borderLeftWidth: 4, borderLeftColor: '#EF4444',
  },
  weatherErrorText: { color: '#FCA5A5', fontSize: 14, lineHeight: 20 },

  // Hero banner
  heroCard: {
    backgroundColor: '#1E40AF', borderRadius: 24, padding: 24,
    flexDirection: 'row', alignItems: 'center', marginBottom: 32,
    shadowColor: '#3b82f6', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3, shadowRadius: 20, elevation: 8,
  },
  heroContent: { flex: 1, zIndex: 2 },
  heroTitle:   { color: '#FFFFFF', fontSize: 20, marginBottom: 8, fontWeight: '700' },
  heroText:    { color: '#BFDBFE', fontSize: 14, lineHeight: 20 },

  // Calendar connect
  connectCalendarCard: { backgroundColor: 'rgba(59, 130, 246, 0.15)', borderRadius: 20, padding: 20, marginBottom: 32, borderWidth: 1, borderColor: '#3B82F6' },
  connectCalendarContent: { flexDirection: 'row', alignItems: 'center' },
  connectCalendarTitle: { color: '#3B82F6', fontSize: 16, fontWeight: '800', marginBottom: 4 },
  connectCalendarDesc: { color: '#BFDBFE', fontSize: 13, lineHeight: 18 },

  // Slots
  sectionTitle: { color: '#FFFFFF', fontSize: 20, marginBottom: 20, fontWeight: '700' },
  timeline:     { flexDirection: 'column', gap: 16 },
  freeSlotCard: {
    flexDirection: 'row', backgroundColor: '#0F172A', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#334155', borderLeftWidth: 4, borderLeftColor: '#10B981',
    alignItems: 'center',
  },
  slotContent:     { flex: 1 },
  chevron:         { marginLeft: 12 },
  chevronText:     { color: '#10B981', fontSize: 32, fontWeight: '200', lineHeight: 32 },
  slotTime:        { color: '#10B981', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  slotDuration:    { color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  slotDescription: { color: '#94A3B8', fontSize: 14, lineHeight: 20 },

  // Events
  eventCard: {
    backgroundColor: '#1C1917', borderRadius: 16, padding: 16,
    borderLeftWidth: 4, borderLeftColor: '#EF4444', marginBottom: 8,
  },
  eventTime:     { color: '#FCA5A5', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  eventTitle:    { color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  eventLocation: { color: '#A8A29E', fontSize: 14 },
});
