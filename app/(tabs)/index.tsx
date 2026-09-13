import React, { useState, useEffect } from 'react';
import { Platform, StyleSheet, View, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/useAuth';
import { useTrips } from '@/hooks/useTrips';
import { useTripDiscovery } from '@/hooks/useTripDiscovery';
import { calculateFreeTimeSlots, generateMockEventsForToday, getDeviceEventsForToday, FreeTimeSlot, CalendarEvent } from '@/lib/calendar';
import * as Location from 'expo-location';
import * as Calendar from 'expo-calendar';
import { fetchWeather, WeatherData } from '@/lib/weather';
import { isTripActive } from '@/lib/trip-types';

const formatSuggestionDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// ─── Greeting helpers ────────────────────────────────────────────────────────
function getGreeting(): { text: string; emoji: string } {
  const hour = new Date().getHours();
  if (hour >= 5  && hour < 12) return { text: 'Good Morning',   emoji: '☀️' };
  if (hour >= 12 && hour < 17) return { text: 'Good Afternoon', emoji: '🌞' };
  if (hour >= 17 && hour < 21) return { text: 'Good Evening',   emoji: '🌆' };
  return                               { text: 'Good Night',     emoji: '🌙' };
}

export default function HomeScreen() {
  const { user } = useAuth();
  const { trips } = useTrips();
  const { suggestion, dismissSuggestion, acceptSuggestion, handleFirstCalendarGrant } = useTripDiscovery();
  const router = useRouter();

  // Calendar
  const [events,    setEvents]    = useState<CalendarEvent[]>([]);
  const [freeSlots, setFreeSlots] = useState<FreeTimeSlot[]>([]);
  const [showEngineBanner, setShowEngineBanner] = useState(true);
  const [calendarPermissionStatus, setCalendarPermissionStatus] = useState<string | null>(null);
  const [currentTimeKey, setCurrentTimeKey] = useState(Date.now());

  // Location & context
  const [contextCity,    setContextCity]    = useState('');
  // The real device GPS point — previously fetched only to reverse-geocode a city name and
  // then discarded; now also passed through to recommendation.tsx as an explicit anchor
  // override, giving "near me" filtering the best possible precision (better than any trip's
  // hotel/city anchor, since this genuinely is where the user is right now).
  const [contextCoords,  setContextCoords]  = useState<{ lat: number; lng: number } | null>(null);
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
        setContextCoords({ lat: latitude, lng: longitude });

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
      // Timezone-aware: a naive device-local Date comparison here could mark a trip
      // active/inactive a day early or late near its start/end boundary whenever the device
      // and destination timezones disagree (see lib/trip-types.ts's isTripActive).
      const activeTrip = trips.find((t: any) => isTripActive(t.startDate, t.endDate, t.timezone));
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

      // Trip-discovery path 1 (docs/auto-trip-discovery-plan.md Part B): this handler only
      // ever runs while calendarPermissionStatus isn't already 'granted' (see the card's own
      // render guard below), so a successful grant here is exactly the "first moment the app
      // can read the calendar" moment the design doc means — the natural trigger for an
      // immediate ~30-day discovery scan and starting the server-side lastAppAccess counter.
      // Fire-and-forget: never block/delay the calendar-connect flow itself on this.
      handleFirstCalendarGrant().catch((err) => console.warn('First-grant trip discovery scan failed:', err));
    }
  };

  const handleAcceptSuggestion = () => {
    if (!suggestion) return;
    acceptSuggestion();
    router.push('/(tabs)/trips' as any);
  };

  const handleSuggest = (slot: FreeTimeSlot) => {
    // The trip actually covering today, if any — passed through so recommendation.tsx can
    // create a real trip Event instead of only writing to the device calendar (see that
    // screen's handleSelectPlace). Excludes a trip that hasn't synced its real Mongo _id yet
    // (still mock_-prefixed — see lib's entity-id convention): the create-event API call would
    // 404/CastError against an id that doesn't exist server-side.
    const activeTrip = trips.find((t: any) => isTripActive(t.startDate, t.endDate, t.timezone) && !t.id.startsWith('mock_'));
    router.push({
      pathname: '/recommendation' as any,
      params: {
        duration: slot.durationMinutes,
        start:    slot.startTime.toISOString(),
        end:      slot.endTime.toISOString(),
        cityContext: contextCity,
        ...(contextCoords ? { lat: String(contextCoords.lat), lng: String(contextCoords.lng) } : {}),
        ...(activeTrip ? { tripId: activeTrip.id } : {}),
      },
    });
  };

  const { text: greetingText, emoji: greetingEmoji } = getGreeting();

  // Free slots (green) and busy conflicts (red) merged into one chronological timeline,
  // rather than two separate stacked sections — each item keeps its own styling/behavior.
  type TimelineItem =
    | { type: 'free'; key: string; startTime: Date; slot: FreeTimeSlot }
    | { type: 'event'; key: string; startTime: Date; event: CalendarEvent };

  const timelineItems: TimelineItem[] = [
    ...freeSlots.map((slot, idx): TimelineItem => ({ type: 'free', key: `slot-${idx}`, startTime: slot.startTime, slot })),
    ...events.map((evt): TimelineItem => ({ type: 'event', key: `evt-${evt.id}`, startTime: evt.startTime, event: evt })),
  ].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

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
                <ThemedText style={styles.connectCalendarDesc}>Connect your device calendar to see your real schedule and get better suggestions.</ThemedText>
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* ── Proactive trip-discovery suggestion (docs/auto-trip-discovery-plan.md Part C) ──
            Extends connectCalendarCard's same blue-bordered treatment rather than inventing a
            new visual language for it. Accepting prefills app/(tabs)/trips.tsx's real
            create-trip modal (via useTripDiscovery's pendingProposal handoff) — the user still
            reviews/edits every field before anything is actually created. */}
        {suggestion && (
          <View style={styles.connectCalendarCard}>
            <View style={styles.connectCalendarContent}>
              <ThemedText style={{fontSize: 24, marginRight: 12}}>✈️</ThemedText>
              <View style={{flex: 1}}>
                <ThemedText style={styles.connectCalendarTitle}>Looks like you&apos;re planning a trip</ThemedText>
                <ThemedText style={styles.connectCalendarDesc}>
                  {suggestion.destination}, {formatSuggestionDate(suggestion.startDate)} – {formatSuggestionDate(suggestion.endDate)}
                  {suggestion.hotel ? ` · ${suggestion.hotel.label}` : ''} — found in your calendar.
                </ThemedText>
                <View style={styles.suggestionActions}>
                  <TouchableOpacity style={styles.suggestionAcceptBtn} onPress={handleAcceptSuggestion}>
                    <ThemedText style={styles.suggestionAcceptText}>Add this trip</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.suggestionDismissBtn} onPress={dismissSuggestion}>
                    <ThemedText style={styles.suggestionDismissText}>Not this time</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── Today's Schedule: free slots (green) and busy conflicts (red), merged into one chronological view ── */}
        <ThemedText style={styles.sectionTitle}>
          Today&apos;s Schedule{locationCity ? ` · ${locationCity}` : ''}
        </ThemedText>
        <View style={styles.timeline}>
          {freeSlots.length === 0 && events.length === 0 && (
            <ThemedText style={styles.subtitle}>Nothing scheduled or free right now.</ThemedText>
          )}

          {timelineItems.map(item => item.type === 'free' ? (
            <TouchableOpacity
              key={item.key}
              style={styles.freeSlotCard}
              onPress={() => handleSuggest(item.slot)}
              activeOpacity={0.8}
            >
              <View style={styles.slotContent}>
                <ThemedText style={styles.slotTime}>
                  {formatTime(item.slot.startTime)} – {formatTime(item.slot.endTime)}
                </ThemedText>
                <ThemedText style={styles.slotDuration}>{item.slot.durationMinutes} min free</ThemedText>
                <ThemedText style={styles.slotDescription}>
                  Tap to get AI suggestions fitting this gap{locationCity ? ` in ${locationCity}` : ''}.
                </ThemedText>
              </View>
              <View style={styles.chevron}>
                <ThemedText style={styles.chevronText}>›</ThemedText>
              </View>
            </TouchableOpacity>
          ) : (
            // Purely informational — inherited from the device calendar, not something to
            // plan around from here, so no onPress/tap affordance at all.
            <View key={item.key} style={styles.eventCard}>
              <ThemedText style={styles.eventTime}>
                {formatTime(item.event.startTime)} – {formatTime(item.event.endTime)}
              </ThemedText>
              <ThemedText style={styles.eventTitle}>{item.event.title}</ThemedText>
              <ThemedText style={styles.eventLocation}>{item.event.location}</ThemedText>
            </View>
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
  suggestionActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  suggestionAcceptBtn: { backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14 },
  suggestionAcceptText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  suggestionDismissBtn: { paddingVertical: 8, paddingHorizontal: 14 },
  suggestionDismissText: { color: '#BFDBFE', fontSize: 13, fontWeight: '600' },

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
