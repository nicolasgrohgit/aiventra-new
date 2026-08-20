import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, Platform, ScrollView, TouchableOpacity, Modal, TextInput, ActivityIndicator, Alert } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/useAuth';
import { useTrips } from '@/hooks/useTrips';
import { useContacts } from '@/hooks/useContacts';
import { useEvents } from '@/hooks/useEvents';
import { PlaceRecommendation } from '@/lib/recommendations';
import { NativeDatePicker } from '@/components/ui/NativeDatePicker';
import { getTripDaySchedule, getDeviceEventsForDateRange, expandSlotForProposals } from '@/lib/calendar';
import { guessTimezoneForCity } from '@/lib/timezones';
import { searchCities, CityResult } from '@/lib/geocoding';
import { CircleShareSelector } from '@/components/ui/circle-share-selector';
import { FOOD_GENRES_CATEGORIZED, ACTIVITY_GENRES_CATEGORIZED, EVENT_GENRES_CATEGORIZED } from '@/constants/preferences';

interface EventParticipant {
  user_id: string;
  invited_by: string;
  status: 'pending' | 'accepted' | 'declined';
}

interface TripEvent {
  _id: string;
  trip_id: string;
  created_by: string;
  source: 'created' | 'imported';
  title: string;
  start_time: string;
  end_time: string;
  place_id?: string;
  place_name?: string;
  participants: EventParticipant[];
}

interface TripMock {
  id: string;
  destination: string;
  startDate: Date;
  endDate: Date;
  timezone: string;
  sharedWithCircles: string[];
}

interface NearbyFriend {
  userId: string;
  name: string;
  avatarUrl?: string;
  matches: { type: 'lives_here' | 'visiting'; startDate?: string; endDate?: string }[];
}

const DURATION_OPTIONS = [60, 90, 120, 180];

// Every genre tag, grouped for the "Refine Your Search" tag picker — same taxonomy the
// solo-recommendation endpoint scores against (see flattenPreferenceTags in
// lib/place-matching.ts), just offered as an in-the-moment override instead of the user's
// saved preference profile.
const REFINE_TAG_GROUPS = [...FOOD_GENRES_CATEGORIZED, ...ACTIVITY_GENRES_CATEGORIZED, ...EVENT_GENRES_CATEGORIZED];

const formatTripDate = (d: Date, tz: string) => d.toLocaleDateString('en-CA', { timeZone: tz });

// getTripDaySchedule's real-calendar path (vs. its hardcoded weekday/weekend fallback) needs
// imported events in CalendarEvent shape — only 'imported' events represent an actual busy
// block on the device calendar; 'created' events are things the user is proposing to do
// during their free time, not obstacles to route around.
const toImportedCalendarEvents = (events: TripEvent[]) =>
  events
    .filter(e => e.source === 'imported')
    .map(e => ({ id: e._id, title: e.title, startTime: new Date(e.start_time), endTime: new Date(e.end_time) }));

export default function TripsScreen() {
  const { user } = useAuth();
  const { trips, setTrips } = useTrips();
  const { contacts, refreshContacts } = useContacts();
  const {
    fetchTripEvents, fetchInvitedEvents, createEvent, importTripEvents, updateEvent, respondToEvent, getJointRecommendations, getRecommendations,
    getFriendsNearby
  } = useEvents();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editTripId, setEditTripId] = useState<string | null>(null);

  const [newDestination, setNewDestination] = useState('');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date(Date.now() + 86400000 * 3));
  // Who can see this trip's destination/dates as a "traveling there" signal — private
  // (empty) by default, opt-in per circle, editable here whether creating or editing.
  const [newSharedWithCircles, setNewSharedWithCircles] = useState<string[]>([]);

  // Destination city autocomplete/validation — catches typos before they silently fall
  // through to lib/places-population.ts's synthetic "Local {typo} Cafe" fallback content.
  const [destinationSuggestions, setDestinationSuggestions] = useState<CityResult[]>([]);
  const [destinationWarning, setDestinationWarning] = useState<string | null>(null);
  const [destinationFocused, setDestinationFocused] = useState(false);

  const resetDestinationLookup = () => {
    setDestinationSuggestions([]);
    setDestinationWarning(null);
    setDestinationFocused(false);
  };

  // slotStart carries the actual day+time of the free-time slot the tapped PlaceCard was
  // shown under — scheduleDate/scheduleTime are synced to it below, rather than defaulting
  // to "now" regardless of which day's slot was actually tapped.
  const [selectedPlace, setSelectedPlace] = useState<{ place: PlaceRecommendation, tripId: string, slotStart: Date } | null>(null);
  const [scheduleDate, setScheduleDate] = useState(new Date());
  const [scheduleTime, setScheduleTime] = useState(new Date());
  const [scheduleInviteContactId, setScheduleInviteContactId] = useState<string | null>(null);

  // "Looking for something else?" — a refined-search flow, pre-filled with the day/destination
  // context from wherever it was tapped, letting the user override the time window and/or
  // narrow to specific tags for just this one search (see handleRefineSearch below).
  const [refineSearchContext, setRefineSearchContext] = useState<{ tripId: string, destination: string, dayLabel: string, date: Date } | null>(null);
  const [refineDuration, setRefineDuration] = useState(90);
  const [refineTime, setRefineTime] = useState(new Date());
  const [refineTags, setRefineTags] = useState<string[]>([]);
  const [refineStep, setRefineStep] = useState<'form' | 'loading' | 'results'>('form');
  const [refineResults, setRefineResults] = useState<PlaceRecommendation[]>([]);
  // The actual instant last searched for — kept separate from refineTime/refineSearchContext.date
  // so result PlaceCards always schedule against what was really queried, even if the user
  // fiddles with the form controls again before tapping a result.
  const [refineStartInstant, setRefineStartInstant] = useState<Date | null>(null);

  useEffect(() => {
    if (selectedPlace) {
      setScheduleDate(new Date(selectedPlace.slotStart));
      setScheduleTime(new Date(selectedPlace.slotStart));
    }
  }, [selectedPlace]);

  const [expandedTripIds, setExpandedTripIds] = useState<Set<string>>(new Set());

  // Events live in their own collection now (not embedded in the trip), so each trip's
  // events are fetched separately and kept in local screen state — same pattern the Home
  // tab already uses for its own calendar/weather data.
  const [eventsByTrip, setEventsByTrip] = useState<Record<string, TripEvent[]>>({});
  const [invitedEvents, setInvitedEvents] = useState<TripEvent[]>([]);
  const [showInvitedModal, setShowInvitedModal] = useState(false);

  // "Propose an event" — pick a slot, then either keep it as Me-Time (solo — the default,
  // reusing the same solo recommendation endpoint the day-schedule proposals already use) or
  // invite a friend for blind joint-matching (suggestions computed from both your tastes
  // without either of you seeing the other's).
  const [proposeTripId, setProposeTripId] = useState<string | null>(null);
  const [proposeTitle, setProposeTitle] = useState('');
  const [proposeDate, setProposeDate] = useState(new Date());
  const [proposeTime, setProposeTime] = useState(new Date());
  const [proposeDuration, setProposeDuration] = useState(90);
  const [proposeMode, setProposeMode] = useState<'me-time' | 'invite'>('me-time');
  const [proposeContactId, setProposeContactId] = useState<string | null>(null);
  const [proposeStep, setProposeStep] = useState<'form' | 'loading' | 'results'>('form');
  const [proposeEventId, setProposeEventId] = useState<string | null>(null);
  const [proposeResults, setProposeResults] = useState<any[]>([]);

  // "Friends nearby" — circle-scoped, sharer-driven discovery of who's already at (or
  // headed to) a trip's destination. Purely a discovery layer in front of "Propose an
  // Event" — tapping a bubble pre-selects that person there, it doesn't change how events
  // or joint-matching themselves work.
  const [nearbyFriendsByTrip, setNearbyFriendsByTrip] = useState<Record<string, NearbyFriend[]>>({});

  // "AI Schedule Proposals" recommendations, keyed by `${tripId}-${slotStartIso}` and
  // fetched from the real server-side Place collection (see hooks/useAuth.tsx's
  // getRecommendations) rather than computed synchronously from a local mock array — a key
  // absent from this map means "not fetched yet", an empty array means "fetched, no matches".
  const [slotRecommendations, setSlotRecommendations] = useState<Record<string, PlaceRecommendation[]>>({});
  const fetchedSlotKeys = useRef<Set<string>>(new Set());

  const myUserId = user?._id || user?.id;

  const refreshTripEvents = async (tripId: string) => {
    try {
      const events = await fetchTripEvents(tripId);
      setEventsByTrip(prev => ({ ...prev, [tripId]: events }));
    } catch (err) {
      console.warn('Failed to load events for trip', tripId, err);
    }
  };

  const refreshInvitedEvents = async () => {
    try {
      setInvitedEvents(await fetchInvitedEvents());
    } catch (err) {
      console.warn('Failed to load invited events', err);
    }
  };

  const refreshNearbyFriends = async (trip: TripMock) => {
    const friends = await getFriendsNearby({
      city: trip.destination,
      startDate: trip.startDate.toISOString(),
      endDate: trip.endDate.toISOString()
    });
    setNearbyFriendsByTrip(prev => ({ ...prev, [trip.id]: friends }));
  };

  // Opportunistic calendar-import sync — same shape as lib/places-population.ts's
  // ensurePlacesForCity: triggered from an existing touchpoint (viewing/creating a trip),
  // not a new button. Only syncs if calendar access is already granted (never prompts here —
  // see getDeviceEventsForDateRange), so this is a silent no-op for most trips today.
  const syncDeviceCalendarForTrip = async (trip: TripMock) => {
    const events = await getDeviceEventsForDateRange(trip.startDate, trip.endDate);
    if (events.length === 0) return;
    await importTripEvents(trip.id, events.map(e => ({
      id: e.id,
      title: e.title,
      startTime: e.startTime.toISOString(),
      endTime: e.endTime.toISOString(),
      location: e.location
    })));
    refreshTripEvents(trip.id);
  };

  useEffect(() => {
    trips.forEach(t => refreshTripEvents(t.id));
    trips.forEach(t => refreshNearbyFriends(t));
    trips.forEach(t => syncDeviceCalendarForTrip(t));
    refreshInvitedEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips]);

  // Fetches "AI Schedule Proposals" recommendations for each currently-visible day's free
  // slots (day 1 always, all days once a trip is expanded), one real API call per slot,
  // cached by key so re-renders and re-expanding an already-loaded trip don't refetch.
  useEffect(() => {
    trips.forEach((trip: TripMock) => {
      const isExpanded = expandedTripIds.has(trip.id);
      const importedEvents = toImportedCalendarEvents(eventsByTrip[trip.id] || []);
      const daySchedules = getTripDaySchedule(trip.startDate, trip.endDate, 5, trip.timezone, importedEvents);
      const visibleDays = isExpanded ? daySchedules : daySchedules.slice(0, 1);

      visibleDays.forEach(day => {
        day.freeSlots.forEach(slot => {
          expandSlotForProposals(slot, trip.timezone).forEach(proposal => {
            const key = `${trip.id}-${proposal.startTime.toISOString()}-${proposal.type}`;
            if (fetchedSlotKeys.current.has(key)) return;
            fetchedSlotKeys.current.add(key);

            getRecommendations({
              city: trip.destination,
              durationMinutes: proposal.durationMinutes,
              startTimeIso: proposal.startTime.toISOString(),
              timezone: trip.timezone
            })
              .then(places => {
                setSlotRecommendations(prev => ({ ...prev, [key]: places.map((p: any) => ({ ...p, id: p._id })) }));
              })
              .catch(() => {
                setSlotRecommendations(prev => ({ ...prev, [key]: [] }));
              });
          });
        });
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips, expandedTripIds, eventsByTrip]);

  // Debounced city lookup for the destination field — warn, don't block: a legitimate city
  // might genuinely not appear in a partial-query top-5 result.
  useEffect(() => {
    if (newDestination.trim().length < 2) {
      setDestinationSuggestions([]);
      setDestinationWarning(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const results = await searchCities(newDestination);
        if (cancelled) return;
        setDestinationSuggestions(results);
        setDestinationWarning(
          results.length === 0
            ? `We couldn't find a city matching "${newDestination.trim()}" — double check the spelling, or continue if you're sure it's right.`
            : null
        );
      } catch {
        // Geocoding failures shouldn't block trip creation — just skip suggestions/warning.
        if (!cancelled) {
          setDestinationSuggestions([]);
          setDestinationWarning(null);
        }
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [newDestination]);

  // Only contacts who are real, linked app users can be invited — blind matching needs a
  // real account with real preferences on the other side, and there's nothing to match a
  // pending (not-yet-joined) contact against.
  const eligibleContacts = contacts.filter((c: any) => c.isAppUser && c.contact_user_id);

  const getParticipantLabel = (participantUserId: string) => {
    if (participantUserId === myUserId) return 'You';
    const contact = contacts.find((c: any) => c.contact_user_id === participantUserId);
    return contact?.name || 'Someone';
  };

  const toggleTripExpand = (tripId: string) => {
    setExpandedTripIds(prev => {
      const next = new Set(prev);
      if (next.has(tripId)) next.delete(tripId);
      else next.add(tripId);
      return next;
    });
  };

  const handleOpenCreateTarget = () => {
    setEditTripId(null);
    setNewDestination('');
    setStartDate(new Date());
    setEndDate(new Date(Date.now() + 86400000 * 3));
    setNewSharedWithCircles([]);
    resetDestinationLookup();
    setShowCreateModal(true);
  };

  const handleOpenEditTarget = (trip: TripMock) => {
    setEditTripId(trip.id);
    setNewDestination(trip.destination);
    setStartDate(trip.startDate);
    setEndDate(trip.endDate);
    setNewSharedWithCircles(trip.sharedWithCircles || []);
    resetDestinationLookup();
    setShowCreateModal(true);
  };

  const toggleNewSharedCircle = (circle: string) => {
    setNewSharedWithCircles(prev => prev.includes(circle) ? prev.filter(c => c !== circle) : [...prev, circle]);
  };

  const handleDeleteTrip = (tripId: string) => {
    setTrips(trips.filter(t => t.id !== tripId));
  };

  const handleSaveTrip = () => {
    if (!newDestination) { Alert.alert('Missing Destination', 'Please enter a destination city, e.g. Rome.'); return; }
    if (startDate > endDate) { Alert.alert('Invalid Dates', 'The start date must be before the end date.'); return; }

    if (editTripId) {
      setTrips(trips.map(t => t.id === editTripId ? {
        ...t,
        destination: newDestination,
        startDate: startDate,
        endDate: endDate,
        timezone: guessTimezoneForCity(newDestination),
        sharedWithCircles: newSharedWithCircles
      } : t));
    } else {
      setTrips([{
        id: Date.now().toString(),
        destination: newDestination,
        startDate: startDate,
        endDate: endDate,
        timezone: guessTimezoneForCity(newDestination),
        sharedWithCircles: newSharedWithCircles
      }, ...trips]);
    }
    resetDestinationLookup();
    setShowCreateModal(false);
  };

  const handleAddToItinerary = async () => {
    if (!selectedPlace) return;
    const finalStart = new Date(scheduleDate);
    finalStart.setHours(scheduleTime.getHours(), scheduleTime.getMinutes(), 0, 0);
    const finalEnd = new Date(finalStart.getTime() + selectedPlace.place.estimatedDuration * 60000);

    try {
      await createEvent(selectedPlace.tripId, {
        title: selectedPlace.place.name,
        startTime: finalStart.toISOString(),
        endTime: finalEnd.toISOString(),
        placeId: selectedPlace.place.id,
        placeName: selectedPlace.place.name,
        participantContactIds: scheduleInviteContactId ? [scheduleInviteContactId] : []
      });
      await refreshTripEvents(selectedPlace.tripId);
      const invitedName = scheduleInviteContactId
        ? contacts.find((c: any) => c.id === scheduleInviteContactId)?.name
        : null;
      const placeName = selectedPlace.place.name;
      setSelectedPlace(null);
      setScheduleInviteContactId(null);
      // Harmless no-op if the place was picked from a trip's regular AI proposals rather than
      // a refine-search result — only closes the refine modal if it was actually open.
      closeRefineSearch();
      // The event does commit whether or not this alert is seen — this is purely feedback so
      // it doesn't read as "nothing happened" (the recommendation cards behind it don't change
      // shape on their own; see PlaceCard's "✓ Scheduled" badge for the lasting signal).
      Alert.alert(
        'Added to your itinerary',
        invitedName ? `${placeName} is on the schedule — ${invitedName} has been invited.` : `${placeName} is on the schedule.`
      );
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not add this to your itinerary.');
    }
  };

  const openProposeModal = (tripId: string, preselectContactId?: string) => {
    setProposeTripId(tripId);
    setProposeTitle('');
    setProposeDate(new Date());
    setProposeTime(new Date());
    setProposeDuration(90);
    setProposeMode(preselectContactId ? 'invite' : 'me-time');
    setProposeContactId(preselectContactId || null);
    setProposeStep('form');
    setProposeEventId(null);
    setProposeResults([]);
    // A contact linked mid-session (via npm run link-contact) only becomes invite-eligible
    // once refetched — contacts otherwise only sync on login/app-boot.
    refreshContacts();
  };

  // Tapping a "Friends nearby" bubble jumps straight into Propose an Event with that person
  // pre-selected — this is purely a discovery shortcut, it still goes through the same
  // Contact-based invite mechanic as picking someone by hand. If they're not already one of
  // your own linked contacts (nearby-friends is sharer-driven, so seeing them doesn't
  // require you to have added them), we ask you to add them first via Circles rather than
  // silently creating a contact behind your back.
  const handleTapNearbyFriend = (tripId: string, friend: NearbyFriend) => {
    const existingContact = contacts.find((c: any) => c.contact_user_id === friend.userId);
    if (!existingContact) {
      Alert.alert(
        'Add them first',
        `${friend.name} isn't in your Circles yet. Add them as a contact first, then you'll be able to invite them here.`
      );
      return;
    }
    openProposeModal(tripId, existingContact.id);
  };

  const closeProposeModal = () => setProposeTripId(null);

  const openRefineSearch = (trip: TripMock, day: { dayLabel: string, date: Date }) => {
    setRefineSearchContext({ tripId: trip.id, destination: trip.destination, dayLabel: day.dayLabel, date: day.date });
    setRefineDuration(90);
    const defaultTime = new Date(day.date);
    defaultTime.setHours(12, 0, 0, 0);
    setRefineTime(defaultTime);
    setRefineTags([]);
    setRefineStep('form');
    setRefineResults([]);
    setRefineStartInstant(null);
  };

  const closeRefineSearch = () => setRefineSearchContext(null);

  const toggleRefineTag = (tag: string) => {
    setRefineTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const handleRefineSearch = async () => {
    if (!refineSearchContext) return;
    const trip = trips.find(t => t.id === refineSearchContext.tripId);
    const finalStart = new Date(refineSearchContext.date);
    finalStart.setHours(refineTime.getHours(), refineTime.getMinutes(), 0, 0);

    setRefineStep('loading');
    try {
      const places = await getRecommendations({
        city: refineSearchContext.destination,
        durationMinutes: refineDuration,
        startTimeIso: finalStart.toISOString(),
        timezone: trip?.timezone,
        tagOverride: refineTags.length > 0 ? refineTags : undefined
      });
      setRefineResults(places.map((p: any) => ({ ...p, id: p._id })));
      setRefineStartInstant(finalStart);
      setRefineStep('results');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not refine this search.');
      setRefineStep('form');
    }
  };

  const handleProposeSubmit = async () => {
    if (!proposeTripId) return;
    if (!proposeTitle.trim()) { Alert.alert('Missing Info', 'Give this a name, e.g. "Dinner".'); return; }
    if (proposeMode === 'invite' && !proposeContactId) { Alert.alert('Missing Info', 'Pick a friend to invite, or switch to Me-Time.'); return; }

    const trip = trips.find(t => t.id === proposeTripId);
    if (!trip) return;

    const finalStart = new Date(proposeDate);
    finalStart.setHours(proposeTime.getHours(), proposeTime.getMinutes(), 0, 0);
    const finalEnd = new Date(finalStart.getTime() + proposeDuration * 60000);

    setProposeStep('loading');
    try {
      const event = await createEvent(proposeTripId, {
        title: proposeTitle.trim(),
        startTime: finalStart.toISOString(),
        endTime: finalEnd.toISOString(),
        participantContactIds: proposeMode === 'invite' && proposeContactId ? [proposeContactId] : []
      });
      setProposeEventId(event._id);

      // Me-Time reuses the same solo recommendation engine as the day-schedule proposals
      // (one person's tastes, deterministic scoring) — inviting someone switches to the
      // blind joint-matching endpoint instead. Neither of those mechanics changes here.
      const recs = proposeMode === 'invite'
        ? await getJointRecommendations(event._id)
        : (await getRecommendations({
            city: trip.destination,
            durationMinutes: proposeDuration,
            startTimeIso: finalStart.toISOString(),
            timezone: trip.timezone
          })).map((p: any) => ({ ...p, jointScore: p.matchScore }));

      setProposeResults(recs);
      setProposeStep('results');
      await refreshTripEvents(proposeTripId);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not propose this event.');
      setProposeStep('form');
    }
  };

  const handlePickJointPlace = async (place: any) => {
    if (!proposeEventId || !proposeTripId) return;
    try {
      await updateEvent(proposeEventId, { placeId: place._id, placeName: place.name });
      await refreshTripEvents(proposeTripId);
      closeProposeModal();
    } catch {
      Alert.alert('Error', 'Could not save this place to the event.');
    }
  };

  const handleRespond = async (eventId: string, status: 'accepted' | 'declined') => {
    try {
      await respondToEvent(eventId, status);
      await refreshInvitedEvents();
    } catch {
      Alert.alert('Error', 'Could not send your response.');
    }
  };

  const pendingInviteCount = invitedEvents.filter(e =>
    e.participants.find(p => p.user_id === myUserId)?.status === 'pending'
  ).length;

  const PlaceCard = ({ place, tripId, slotStart, tripEvents }: { place: PlaceRecommendation, tripId: string, slotStart: Date, tripEvents: TripEvent[] }) => {
    // A place already added to this trip (any day) looks identical to an unscheduled one
    // otherwise, which is exactly why tapping "Add to Itinerary" reads as "nothing happened" —
    // it did work, there's just no visible trace of it back on the card you tapped.
    const alreadyScheduled = tripEvents.some(e => e.source === 'created' && e.place_id === place.id);
    return (
    <TouchableOpacity style={styles.placeCard} activeOpacity={0.8} onPress={() => { setSelectedPlace({ place, tripId, slotStart }); refreshContacts(); }}>
      <View style={styles.placeHeader}>
        <Text style={styles.placeName} numberOfLines={1}>{place.name}</Text>
        {alreadyScheduled ? (
          <View style={styles.badgeScheduled}><Text style={styles.badgeText}>✓ Scheduled</Text></View>
        ) : (
          <View style={styles.badge}><Text style={styles.badgeText}>{place.matchScore > 0 ? `${place.matchScore} tag match` : 'New idea'}</Text></View>
        )}
      </View>
      <Text style={styles.placeCategory}>{place.category} • {place.rating} ★</Text>
      <Text style={styles.placeDesc} numberOfLines={2}>{place.description}</Text>
    </TouchableOpacity>
    );
  };

  // "Looking for something else?" — appended after the real suggestions (or shown alone when
  // there are none), opens a placeholder modal pre-filled with this day/destination.
  const RefineSearchCard = ({ trip, day }: { trip: TripMock, day: { dayLabel: string, date: Date } }) => (
    <TouchableOpacity
      style={styles.refineCard}
      activeOpacity={0.8}
      onPress={() => openRefineSearch(trip, day)}
    >
      <Text style={styles.refineCardIcon}>🔍</Text>
      <Text style={styles.refineCardText}>Looking for{'\n'}something else?</Text>
    </TouchableOpacity>
  );

  // selectedId/onSelect deal in Contact._id (c.id) — what participantContactIds actually
  // needs server-side (see POST /api/trips/:tripId/events). Previously this picked
  // c.contact_user_id (the linked User's id) instead, which would have made every real
  // invite fail with "not found in your circle" — never caught because nothing in this
  // session could actually run the RN UI, only the API directly.
  const ContactPicker = ({ selectedId, onSelect }: { selectedId: string | null, onSelect: (id: string | null) => void }) => (
    eligibleContacts.length === 0 ? (
      <Text style={styles.emptyText}>
        No linked friends yet — invite someone from the Circles tab, and once they join Odys.ai they&apos;ll show up here.
      </Text>
    ) : (
      <View style={{ gap: 10 }}>
        {eligibleContacts.map((c: any) => {
          const selected = selectedId === c.id;
          return (
            <TouchableOpacity
              key={c.id}
              style={[styles.eventSelectRow, selected && styles.eventSelectRowActive]}
              onPress={() => onSelect(selected ? null : c.id)}
            >
              <View style={[styles.checkboxNative, selected && styles.checkboxNativeActive]}>
                <Text style={styles.checkboxText}>{selected ? '✓' : ''}</Text>
              </View>
              <Text style={[styles.eventSelectName, selected && styles.eventSelectNameActive]}>{c.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    )
  );

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerTextContainer}>
            <ThemedText style={styles.title}>Your Trips</ThemedText>
            <ThemedText style={styles.subtitle}>Plan and share your upcoming trips.</ThemedText>
          </View>
          <TouchableOpacity style={styles.addButton} onPress={handleOpenCreateTarget}>
            <Text style={styles.addButtonText}>+</Text>
          </TouchableOpacity>
        </View>

        {pendingInviteCount > 0 && (
          <TouchableOpacity style={styles.inviteBanner} activeOpacity={0.8} onPress={() => setShowInvitedModal(true)}>
            <Text style={styles.inviteBannerText}>
              {pendingInviteCount} pending invite{pendingInviteCount !== 1 ? 's' : ''} — tap to respond
            </Text>
          </TouchableOpacity>
        )}

        {trips.length === 0 ? (
          <Text style={styles.emptyText}>{"You haven't added any trips yet."}</Text>
        ) : (
          trips.map(trip => {
            const totalTripDays = Math.round((trip.endDate.getTime() - trip.startDate.getTime()) / 86400000) + 1;
            const tripEvents = eventsByTrip[trip.id] || [];
            const daySchedules = getTripDaySchedule(trip.startDate, trip.endDate, 5, trip.timezone, toImportedCalendarEvents(tripEvents));

            return (
              <View key={trip.id} style={styles.tripCard}>
                 <View style={styles.tripHeaderContainer}>
                   <View style={{flex: 1}}>
                     <Text style={styles.destinationText}>{trip.destination}</Text>
                     <Text style={styles.dateText}>{formatTripDate(trip.startDate, trip.timezone)} to {formatTripDate(trip.endDate, trip.timezone)}</Text>
                   </View>
                   <View style={styles.tripActions}>
                     <TouchableOpacity onPress={() => handleOpenEditTarget(trip)} style={styles.iconBtn}><Text style={{fontSize: 18}}>✏️</Text></TouchableOpacity>
                     <TouchableOpacity onPress={() => handleDeleteTrip(trip.id)} style={styles.iconBtnDel}><Text style={{fontSize: 18}}>🗑️</Text></TouchableOpacity>
                   </View>
                 </View>

                 {(nearbyFriendsByTrip[trip.id]?.length || 0) > 0 && (
                   <View style={styles.nearbyContainer}>
                     <Text style={styles.nearbyLabel}>Friends nearby</Text>
                     <View style={styles.nearbyBubbleRow}>
                       {nearbyFriendsByTrip[trip.id].map(friend => {
                         const livesHere = friend.matches.some(m => m.type === 'lives_here');
                         return (
                           <TouchableOpacity
                             key={friend.userId}
                             style={styles.nearbyBubble}
                             activeOpacity={0.7}
                             onPress={() => handleTapNearbyFriend(trip.id, friend)}
                           >
                             <Text style={styles.nearbyBubbleText}>{friend.name}</Text>
                             <Text style={styles.nearbyBubbleSub}>{livesHere ? 'lives here' : 'visiting'}</Text>
                           </TouchableOpacity>
                         );
                       })}
                     </View>
                   </View>
                 )}

                 <TouchableOpacity style={styles.sharedContext} activeOpacity={0.8} onPress={() => openProposeModal(trip.id)}>
                   <Text style={styles.sharedText}>+ Propose an Event</Text>
                 </TouchableOpacity>

                 {tripEvents.length > 0 && (
                    <View style={styles.timelineContainer}>
                      <Text style={styles.timelineHeader}>Scheduled Sequence</Text>
                      {tripEvents.map((event) => {
                        // Imported events are real calendar meetings synced read-only from the
                        // device — they're busy blocks the schedule routes around, not things
                        // needing a place picked, so they never get the "Proposed…" treatment
                        // a genuine user-created event without a place yet does.
                        const isImported = event.source === 'imported';
                        const isResolved = !!event.place_name;
                        return (
                          <View key={event._id} style={styles.timelineEventCard}>
                            <View style={[
                              styles.timelineIndicator,
                              isImported ? styles.timelineIndicatorBusy : (!isResolved && styles.timelineIndicatorPending)
                            ]} />
                            <View style={styles.timelineEventContent}>
                              <Text style={styles.timelineEventTime}>
                                {new Date(event.start_time).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: trip.timezone })}
                              </Text>
                              {isImported ? (
                                <Text style={styles.timelineEventName}>{event.title}</Text>
                              ) : isResolved ? (
                                <Text style={styles.timelineEventName}>{event.place_name}</Text>
                              ) : (
                                <Text style={styles.timelineEventNamePending}>{event.title} — Proposed, picking a place together</Text>
                              )}
                              {event.participants.length > 0 && (
                                <View style={styles.eventGuestTags}>
                                  {event.participants.map((p) => (
                                    <View key={p.user_id} style={[styles.eventGuestBadge, p.status === 'declined' && styles.eventGuestBadgeDeclined]}>
                                      <Text style={styles.eventGuestText}>
                                        with {getParticipantLabel(p.user_id)} · {p.status}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                 )}

                  <Text style={styles.proposalsHeader}>AI Schedule Proposals</Text>
                  {(() => {
                    const isExpanded = expandedTripIds.has(trip.id);
                    const visibleDays = isExpanded ? daySchedules : daySchedules.slice(0, 1);
                    return (
                      <>
                        {visibleDays.map(day => (
                          <View key={day.date.toISOString()} style={styles.dayBlock}>
                            <View style={styles.dayHeaderRow}>
                              <Text style={styles.dayLabelText}>{day.dayLabel}</Text>
                              <View style={[styles.dayTypeBadge, day.isWeekend ? styles.dayTypeBadgeWeekend : styles.dayTypeBadgeWeekday]}>
                                <Text style={styles.dayTypeBadgeText}>{day.isWeekend ? '🎉 Weekend' : '💼 Weekday'}</Text>
                              </View>
                            </View>
                            {day.freeSlots.flatMap(slot => expandSlotForProposals(slot, trip.timezone)).map(proposal => {
                              const slotKey = `${trip.id}-${proposal.startTime.toISOString()}-${proposal.type}`;
                              const slotRecs = slotRecommendations[slotKey];
                              const icon = day.isWeekend && proposal.type === 'activity' ? '☀️' : proposal.icon;
                              const fmt = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: trip.timezone });
                              return (
                                <View key={slotKey} style={styles.slotSection}>
                                  <View style={styles.slotHeaderRow}>
                                    <Text style={styles.slotIcon}>{icon}</Text>
                                    <Text style={styles.slotLabelText}>{proposal.label}</Text>
                                    <Text style={styles.slotTimeRange}>{fmt(proposal.startTime)} – {fmt(proposal.endTime)} · {proposal.durationMinutes}min</Text>
                                  </View>
                                  {slotRecs === undefined ? (
                                    <ActivityIndicator size="small" color="#3B82F6" />
                                  ) : slotRecs.length === 0 ? (
                                    <>
                                      <Text style={styles.emptyText}>No places fit this slot yet.</Text>
                                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll}>
                                        <RefineSearchCard trip={trip} day={day} />
                                      </ScrollView>
                                    </>
                                  ) : (
                                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll}>
                                      {slotRecs.slice(0, 4).map(p => (
                                        <PlaceCard key={`${proposal.startTime.getTime()}-${p.id}`} place={p} tripId={trip.id} slotStart={proposal.startTime} tripEvents={tripEvents} />
                                      ))}
                                      <RefineSearchCard trip={trip} day={day} />
                                    </ScrollView>
                                  )}
                                </View>
                              );
                            })}
                          </View>
                        ))}
                        {daySchedules.length > 1 && (
                          <TouchableOpacity style={styles.expandButton} onPress={() => toggleTripExpand(trip.id)}>
                            <Text style={styles.expandButtonText}>
                              {expandedTripIds.has(trip.id)
                                ? '▲  Show less'
                                : `▼  See all ${Math.min(daySchedules.length, totalTripDays)} days${totalTripDays > 5 ? ` (+ ${totalTripDays - 5} more)` : ''}`}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </>
                    );
                  })()}
              </View>
            )
          })
        )}
      </ScrollView>

      {/* Pending invites */}
      <Modal visible={showInvitedModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowInvitedModal(false)}>
        <View style={styles.modalContainer}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Your Invites</Text>
              <TouchableOpacity onPress={() => setShowInvitedModal(false)} style={styles.closeButton}><Text style={styles.closeButtonText}>Done</Text></TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              No push notifications yet — check back here to see what you&apos;ve been invited to.
            </Text>
            {invitedEvents.length === 0 ? (
              <Text style={styles.emptyText}>Nothing here yet.</Text>
            ) : (
              invitedEvents.map(event => {
                const myStatus = event.participants.find(p => p.user_id === myUserId)?.status;
                return (
                  <View key={event._id} style={styles.friendConfigCard}>
                    <Text style={styles.friendConfigName}>{event.title}</Text>
                    <Text style={styles.eventSelectTime}>
                      {new Date(event.start_time).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    {event.place_name && <Text style={styles.eventSelectTime}>{event.place_name}</Text>}
                    {myStatus === 'pending' ? (
                      <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                        <TouchableOpacity style={[styles.submitBtn, { flex: 1, backgroundColor: '#10B981' }]} onPress={() => handleRespond(event._id, 'accepted')}>
                          <Text style={styles.submitBtnText}>Accept</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.submitBtn, { flex: 1, backgroundColor: '#334155' }]} onPress={() => handleRespond(event._id, 'declined')}>
                          <Text style={styles.submitBtnText}>Decline</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <Text style={[styles.eventSelectTime, { marginTop: 8, textTransform: 'capitalize' }]}>{myStatus}</Text>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Propose an event (blind joint-matching flow) */}
      <Modal visible={!!proposeTripId} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeProposeModal}>
        <View style={styles.modalContainer}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Propose an Event</Text>
              <TouchableOpacity onPress={closeProposeModal} style={styles.closeButton}><Text style={styles.closeButtonText}>Close</Text></TouchableOpacity>
            </View>

            {proposeStep === 'form' && (
              <>
                <Text style={styles.modalSubtitle}>
                  Pick a time and a friend — we&apos;ll suggest places that match both your tastes, without either of you seeing the other&apos;s preferences.
                </Text>

                <Text style={styles.inputLabel}>What</Text>
                <TextInput style={styles.textInput} placeholder="e.g. Dinner" placeholderTextColor="#64748B" value={proposeTitle} onChangeText={setProposeTitle} />

                <Text style={styles.inputLabel}>Date</Text>
                <NativeDatePicker value={proposeDate} onChange={setProposeDate} mode="date" format="date" />

                <Text style={styles.inputLabel}>Time</Text>
                <NativeDatePicker value={proposeTime} onChange={setProposeTime} mode="time" format="time" />

                <Text style={styles.inputLabel}>Duration</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 28 }}>
                  {DURATION_OPTIONS.map(mins => (
                    <TouchableOpacity
                      key={mins}
                      style={[styles.durationPill, proposeDuration === mins && styles.durationPillActive]}
                      onPress={() => setProposeDuration(mins)}
                    >
                      <Text style={[styles.durationPillText, proposeDuration === mins && styles.durationPillTextActive]}>{mins}m</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.inputLabel}>Who&apos;s this for</Text>
                <View style={styles.modeToggleRow}>
                  <TouchableOpacity
                    style={[styles.modeToggleBtn, proposeMode === 'me-time' && styles.modeToggleBtnActive]}
                    onPress={() => { setProposeMode('me-time'); setProposeContactId(null); }}
                  >
                    <Text style={[styles.modeToggleText, proposeMode === 'me-time' && styles.modeToggleTextActive]}>🌿 Me-Time</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modeToggleBtn, proposeMode === 'invite' && styles.modeToggleBtnActive]}
                    onPress={() => setProposeMode('invite')}
                  >
                    <Text style={[styles.modeToggleText, proposeMode === 'invite' && styles.modeToggleTextActive]}>Invite Someone</Text>
                  </TouchableOpacity>
                </View>

                {proposeMode === 'me-time' ? (
                  <Text style={[styles.modalSubtitle, { marginTop: 4 }]}>
                    Just for you — sometimes a little me-time is exactly what you need. We&apos;ll suggest places matching your own tastes.
                  </Text>
                ) : (
                  <View style={{ marginBottom: 28 }}>
                    {(nearbyFriendsByTrip[proposeTripId || '']?.length || 0) > 0 && (
                      <Text style={styles.nearbyHint}>
                        Tip: friends already surfaced on this trip&apos;s card are the easiest picks — tap their bubble instead to jump straight here pre-filled.
                      </Text>
                    )}
                    <ContactPicker selectedId={proposeContactId} onSelect={setProposeContactId} />
                  </View>
                )}

                <TouchableOpacity style={[styles.submitBtnLarge, { marginTop: 24 }]} onPress={handleProposeSubmit}>
                  <Text style={styles.submitBtnText}>
                    {proposeMode === 'me-time' ? 'Find Places For Me' : "Find Places We'd Both Like"}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {proposeStep === 'loading' && (
              <View style={{ alignItems: 'center', marginTop: 40 }}>
                <ActivityIndicator color="#3B82F6" size="large" />
                <Text style={[styles.modalSubtitle, { marginTop: 20, textAlign: 'center' }]}>Matching both your tastes…</Text>
              </View>
            )}

            {proposeStep === 'results' && (
              <>
                <Text style={styles.modalSubtitle}>
                  {proposeMode === 'invite' ? 'Ranked for both of you — pick one to lock it in.' : 'Picked for your tastes — choose one to lock it in.'}
                </Text>
                {proposeResults.length === 0 ? (
                  <Text style={styles.emptyText}>No matches found for this slot yet — the event&apos;s been created, you can pick a place from the trip proposals below instead.</Text>
                ) : (
                  proposeResults.map((p: any) => (
                    <TouchableOpacity key={p._id} style={styles.placeCardWide} activeOpacity={0.8} onPress={() => handlePickJointPlace(p)}>
                      <View style={styles.placeHeader}>
                        <Text style={styles.placeName} numberOfLines={1}>{p.name}</Text>
                        <View style={styles.badge}><Text style={styles.badgeText}>Match {p.jointScore}</Text></View>
                      </View>
                      <Text style={styles.placeCategory}>{p.category} • {p.rating} ★</Text>
                      <Text style={styles.placeDesc} numberOfLines={2}>{p.description}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Place Detail Expansion (place-first flow) */}
      <Modal visible={!!selectedPlace} animationType="fade" transparent={true} onRequestClose={() => setSelectedPlace(null)}>
        <View style={styles.darkOverlay}>
          <View style={styles.darkActionSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={2}>{selectedPlace?.place.name}</Text>
              <TouchableOpacity onPress={() => setSelectedPlace(null)} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.heroDetailsBadge}>
               <Text style={styles.heroDetailsTarget}>{selectedPlace?.place.category} • {selectedPlace?.place.estimatedDuration}m Length</Text>
               <Text style={styles.ratingLarge}>{selectedPlace?.place.rating} ★</Text>
            </View>

            <Text style={styles.detailedDescText}>{selectedPlace?.place.description}</Text>

            <View style={styles.separator} />
            <Text style={styles.proposalsHeader}>Schedule It</Text>

            <Text style={styles.inputLabel}>Date</Text>
            <NativeDatePicker value={scheduleDate} onChange={setScheduleDate} mode="date" format="date" />

            <Text style={styles.inputLabel}>Time</Text>
            <NativeDatePicker value={scheduleTime} onChange={setScheduleTime} mode="time" format="time" />

            <Text style={styles.inputLabel}>Invite someone (optional)</Text>
            <ContactPicker selectedId={scheduleInviteContactId} onSelect={setScheduleInviteContactId} />

            <TouchableOpacity style={[styles.submitBtn, {backgroundColor: '#3B82F6', marginTop: 20}]} onPress={handleAddToItinerary}>
               <Text style={styles.submitBtnText}>Add to Itinerary</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Refined search — override the time window and/or narrow to specific tags for one search */}
      <Modal visible={!!refineSearchContext} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeRefineSearch}>
        <View style={styles.modalContainer}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Refine Your Search</Text>
              <TouchableOpacity onPress={closeRefineSearch} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
            {refineSearchContext && (
              <>
                <View style={styles.refineContextBadge}>
                  <Text style={styles.refineContextText}>{refineSearchContext.dayLabel}</Text>
                  <Text style={styles.refineContextText}>{refineSearchContext.destination}</Text>
                </View>

                {refineStep === 'form' && (
                  <>
                    <Text style={styles.modalSubtitle}>
                      Tell us more specifically what you&apos;re in the mood for — pick a time window
                      and, optionally, the kinds of places to prioritize.
                    </Text>

                    <Text style={styles.inputLabel}>Time</Text>
                    <NativeDatePicker value={refineTime} onChange={setRefineTime} mode="time" format="time" />

                    <Text style={styles.inputLabel}>Duration</Text>
                    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 28 }}>
                      {DURATION_OPTIONS.map(mins => (
                        <TouchableOpacity
                          key={mins}
                          style={[styles.durationPill, refineDuration === mins && styles.durationPillActive]}
                          onPress={() => setRefineDuration(mins)}
                        >
                          <Text style={[styles.durationPillText, refineDuration === mins && styles.durationPillTextActive]}>{mins}m</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <Text style={styles.inputLabel}>What are you in the mood for? (optional)</Text>
                    {REFINE_TAG_GROUPS.map(group => (
                      <View key={group.type} style={{ marginBottom: 16 }}>
                        <Text style={styles.tagGroupLabel}>{group.type}</Text>
                        <View style={styles.tagPillRow}>
                          {group.activities.map(tag => {
                            const selected = refineTags.includes(tag);
                            return (
                              <TouchableOpacity
                                key={tag}
                                style={[styles.tagPill, selected && styles.tagPillActive]}
                                onPress={() => toggleRefineTag(tag)}
                              >
                                <Text style={[styles.tagPillText, selected && styles.tagPillTextActive]}>{tag}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    ))}

                    <TouchableOpacity style={[styles.submitBtnLarge, { marginTop: 8 }]} onPress={handleRefineSearch}>
                      <Text style={styles.submitBtnText}>Search</Text>
                    </TouchableOpacity>
                  </>
                )}

                {refineStep === 'loading' && (
                  <View style={{ alignItems: 'center', marginTop: 40 }}>
                    <ActivityIndicator color="#3B82F6" size="large" />
                    <Text style={[styles.modalSubtitle, { marginTop: 20, textAlign: 'center' }]}>Searching…</Text>
                  </View>
                )}

                {refineStep === 'results' && (
                  <>
                    <TouchableOpacity onPress={() => setRefineStep('form')} style={{ marginBottom: 20 }}>
                      <Text style={styles.closeButtonText}>‹ Adjust search</Text>
                    </TouchableOpacity>
                    {refineResults.length === 0 ? (
                      <Text style={styles.emptyText}>Nothing matched that — try a wider time window or fewer selected tags.</Text>
                    ) : (
                      refineResults.map(p => (
                        <TouchableOpacity
                          key={p.id}
                          style={styles.placeCardWide}
                          activeOpacity={0.8}
                          onPress={() => {
                            setSelectedPlace({ place: p, tripId: refineSearchContext.tripId, slotStart: refineStartInstant || refineSearchContext.date });
                            refreshContacts();
                          }}
                        >
                          <View style={styles.placeHeader}>
                            <Text style={styles.placeName} numberOfLines={1}>{p.name}</Text>
                            <View style={styles.badge}><Text style={styles.badgeText}>{p.matchScore > 0 ? `${p.matchScore} tag match` : 'New idea'}</Text></View>
                          </View>
                          <Text style={styles.placeCategory}>{p.category} • {p.rating} ★</Text>
                          <Text style={styles.placeDesc} numberOfLines={2}>{p.description}</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Trip creator */}
      <Modal visible={showCreateModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCreateModal(false)}>
        <View style={styles.modalContainer}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editTripId ? 'Edit Itinerary Bounds' : 'Plan a New Trip'}</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>Add a destination and travel dates to get started.</Text>

            <Text style={styles.inputLabel}>Destination City</Text>
            <View style={{ marginBottom: 28 }}>
              <TextInput
                style={[styles.textInput, { marginBottom: 0 }]}
                placeholder="e.g. Rome"
                placeholderTextColor="#64748B"
                value={newDestination}
                onChangeText={setNewDestination}
                onFocus={() => setDestinationFocused(true)}
                onBlur={() => setTimeout(() => setDestinationFocused(false), 150)}
              />
              {destinationFocused && destinationSuggestions.length > 0 && (
                <View style={styles.citySuggestionsBox}>
                  {destinationSuggestions.map((c, i) => (
                    <TouchableOpacity
                      key={`${c.name}-${c.latitude}-${i}`}
                      style={styles.citySuggestionRow}
                      onPress={() => {
                        setNewDestination(`${c.name}, ${c.country}`);
                        resetDestinationLookup();
                      }}
                    >
                      <Text style={styles.citySuggestionText}>{c.name}{c.admin1 ? `, ${c.admin1}` : ''}</Text>
                      <Text style={styles.citySuggestionSub}>{c.country}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {destinationWarning && <Text style={styles.cityWarningText}>{destinationWarning}</Text>}
            </View>

            <Text style={styles.inputLabel}>Start Date</Text>
            <NativeDatePicker value={startDate} onChange={setStartDate} mode="date" format="date" />

            <Text style={styles.inputLabel}>End Date</Text>
            <NativeDatePicker value={endDate} onChange={setEndDate} mode="date" format="date" />

            <View style={{ marginTop: 8 }}>
              <CircleShareSelector
                label="Share This Trip With"
                helperText="Lets people in these circles see you're heading here on these dates, so they can notice and invite you when they're planning something too."
                selected={newSharedWithCircles}
                onToggle={toggleNewSharedCircle}
              />
            </View>

            <View style={{ marginTop: 24 }}>
              <TouchableOpacity style={styles.submitBtnLarge} onPress={handleSaveTrip}>
                 <Text style={styles.submitBtnText}>{editTripId ? 'Save Changes' : 'Create Trip'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scrollContent: { padding: 24, paddingTop: Platform.OS === 'ios' ? 60 : 60, paddingBottom: 100 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32, marginTop: 10 },
  headerTextContainer: { flex: 1 },
  title: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', marginBottom: 8 },
  subtitle: { color: '#94A3B8', fontSize: 16 },
  addButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#3B82F6', justifyContent: 'center', alignItems: 'center', shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 5 },
  addButtonText: { color: '#FFFFFF', fontSize: 28, fontWeight: '400', lineHeight: 30, marginTop: Platform.OS === 'ios' ? -2 : 0 },

  inviteBanner: { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderWidth: 1, borderColor: '#10B981', borderRadius: 14, padding: 16, marginBottom: 24 },
  inviteBannerText: { color: '#10B981', fontWeight: '800', fontSize: 14, textAlign: 'center' },

  emptyText: { color: '#64748B', fontStyle: 'italic', textAlign: 'center', marginTop: 30 },
  separator: { height: 1, backgroundColor: '#1E293B', marginVertical: 24 },

  tripCard: { backgroundColor: '#0F172A', padding: 24, borderRadius: 28, marginBottom: 32, borderWidth: 1, borderColor: '#1E293B', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 8, overflow: 'hidden' },
  tripHeaderContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  destinationText: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  dateText: { color: '#3B82F6', fontSize: 16, fontWeight: '700', marginTop: 6 },
  tripActions: { flexDirection: 'row', gap: 12 },
  iconBtn: { padding: 8, backgroundColor: '#1E293B', borderRadius: 10 },
  iconBtnDel: { padding: 8, backgroundColor: '#450a0a', borderRadius: 10, borderWidth: 1, borderColor: '#7f1d1d' },

  sharedContext: { backgroundColor: 'rgba(59, 130, 246, 0.1)', padding: 14, borderRadius: 12, borderLeftWidth: 4, borderLeftColor: '#3B82F6', marginBottom: 24, paddingVertical: 18, alignItems: 'center' },
  sharedText: { color: '#3B82F6', fontWeight: '800', fontSize: 15, textTransform: 'uppercase' },

  nearbyContainer: { marginBottom: 20 },
  nearbyLabel: { color: '#94A3B8', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', marginBottom: 10, letterSpacing: 0.5 },
  nearbyBubbleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  nearbyBubble: { backgroundColor: 'rgba(16, 185, 129, 0.12)', borderWidth: 1, borderColor: '#10B981', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  nearbyBubbleText: { color: '#10B981', fontWeight: '800', fontSize: 13 },
  nearbyBubbleSub: { color: '#6EE7B7', fontSize: 10, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.3 },

  timelineContainer: { backgroundColor: '#1E293B', borderRadius: 20, padding: 20, marginBottom: 24, borderWidth: 1, borderColor: '#334155' },
  timelineHeader: { color: '#10B981', fontSize: 18, fontWeight: '800', marginBottom: 20, textTransform: 'uppercase' },
  timelineEventCard: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  timelineIndicator: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#3B82F6', marginTop: 4, marginRight: 16, shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 6 },
  timelineIndicatorPending: { backgroundColor: '#F59E0B', shadowColor: '#F59E0B' },
  // Matches the Home tab's existing red busy-block convention (see app/(tabs)/index.tsx).
  timelineIndicatorBusy: { backgroundColor: '#EF4444', shadowColor: '#EF4444' },
  timelineEventContent: { flex: 1, borderBottomWidth: 1, borderBottomColor: '#334155', paddingBottom: 16 },
  timelineEventTime: { color: '#F8FAFC', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  timelineEventName: { color: '#94A3B8', fontSize: 15, marginBottom: 8 },
  timelineEventNamePending: { color: '#F59E0B', fontSize: 15, marginBottom: 8, fontStyle: 'italic' },
  eventGuestTags: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  eventGuestBadge: { backgroundColor: 'rgba(16, 185, 129, 0.15)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  eventGuestBadgeDeclined: { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
  eventGuestText: { color: '#10B981', fontSize: 11, fontWeight: '800' },

  proposalsHeader: { color: '#E2E8F0', fontSize: 16, fontWeight: '800', marginBottom: 14, textTransform: 'uppercase' },
  hScroll: { marginHorizontal: -24, paddingHorizontal: 24 },
  placeCard: { backgroundColor: '#1E293B', padding: 20, borderRadius: 20, width: 280, marginRight: 16, borderWidth: 1, borderColor: '#334155' },
  placeCardWide: { backgroundColor: '#1E293B', padding: 20, borderRadius: 20, marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  placeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  placeName: { color: '#F8FAFC', fontSize: 18, fontWeight: '800', flex: 1 },
  badge: { backgroundColor: '#10B981', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeScheduled: { backgroundColor: '#3B82F6', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  placeCategory: { color: '#3B82F6', fontWeight: '700', fontSize: 13, marginBottom: 10 },
  placeDesc: { color: '#94A3B8', fontSize: 14, lineHeight: 22 },

  refineCard: { backgroundColor: '#1E293B', padding: 20, borderRadius: 20, width: 140, marginRight: 16, borderWidth: 1, borderColor: '#334155', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  refineCardIcon: { fontSize: 24, marginBottom: 10 },
  refineCardText: { color: '#94A3B8', fontSize: 13, fontWeight: '700', textAlign: 'center', lineHeight: 18 },
  refineContextBadge: { backgroundColor: 'rgba(59, 130, 246, 0.1)', paddingVertical: 14, borderRadius: 14, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, marginBottom: 20, borderWidth: 1, borderColor: '#3B82F630' },
  refineContextText: { color: '#3B82F6', fontSize: 14, fontWeight: '800' },

  // Day-by-day schedule breakdown
  dayBlock: { borderTopWidth: 1, borderTopColor: '#1E293B', paddingTop: 16, marginTop: 4, marginBottom: 4 },
  dayHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  dayLabelText: { color: '#F8FAFC', fontSize: 15, fontWeight: '800' },
  dayTypeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  dayTypeBadgeWeekend: { backgroundColor: 'rgba(245, 158, 11, 0.15)', borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.3)' },
  dayTypeBadgeWeekday: { backgroundColor: 'rgba(59, 130, 246, 0.1)', borderWidth: 1, borderColor: 'rgba(59, 130, 246, 0.2)' },
  dayTypeBadgeText: { fontSize: 11, fontWeight: '800', color: '#E2E8F0' },
  slotSection: { marginBottom: 16 },
  slotHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  slotIcon: { fontSize: 13 },
  slotLabelText: { color: '#94A3B8', fontSize: 13, fontWeight: '700', flex: 1 },
  slotTimeRange: { color: '#475569', fontSize: 11, fontWeight: '600' },
  expandButton: { alignItems: 'center', paddingVertical: 14, marginTop: 8, marginBottom: 4, backgroundColor: '#1E293B', borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  expandButtonText: { color: '#3B82F6', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },

  darkOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  darkActionSheet: { backgroundColor: '#0F172A', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: Platform.OS === 'ios' ? 48 : 24, borderWidth: 1, borderColor: '#1E293B' },
  heroDetailsBadge: { backgroundColor: 'rgba(59, 130, 246, 0.1)', paddingVertical: 14, borderRadius: 14, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, marginBottom: 20, borderWidth: 1, borderColor: '#3B82F630' },
  heroDetailsTarget: { color: '#3B82F6', fontSize: 14, fontWeight: '800' },
  ratingLarge: { color: '#FCD34D', fontSize: 14, fontWeight: '900' },
  detailedDescText: { color: '#F8FAFC', fontSize: 16, lineHeight: 24 },

  modalContainer: { flex: 1, backgroundColor: '#0F172A', padding: 24, paddingTop: Platform.OS === 'ios' ? 40 : 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: '#FFF', fontSize: 24, fontWeight: 'bold', flex: 1, paddingRight: 20 },
  closeButton: { padding: 8 },
  closeButtonText: { color: '#3B82F6', fontSize: 16, fontWeight: '700', overflow: 'hidden' },
  modalSubtitle: { color: '#64748B', fontSize: 15, lineHeight: 22, marginBottom: 36 },

  friendConfigCard: { backgroundColor: '#1E293B', borderRadius: 20, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  friendConfigName: { color: '#F8FAFC', fontSize: 18, fontWeight: '700', marginBottom: 8 },

  eventSelectRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, backgroundColor: '#0F172A', borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#1E293B' },
  eventSelectRowActive: { borderColor: '#10B981', backgroundColor: '#10B98110' },
  checkboxNative: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#334155', marginRight: 16, justifyContent: 'center', alignItems: 'center' },
  checkboxNativeActive: { backgroundColor: '#10B981', borderColor: '#10B981' },
  checkboxText: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  eventSelectName: { color: '#94A3B8', fontSize: 16, fontWeight: '700' },
  eventSelectNameActive: { color: '#F8FAFC' },
  eventSelectTime: { color: '#64748B', fontSize: 14, marginTop: 4 },

  durationPill: { flex: 1, paddingVertical: 12, backgroundColor: '#1E293B', borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  durationPillActive: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  durationPillText: { color: '#94A3B8', fontWeight: '700', fontSize: 14 },
  durationPillTextActive: { color: '#FFF' },

  tagGroupLabel: { color: '#64748B', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  tagPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagPill: { paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#1E293B', borderRadius: 20, borderWidth: 1, borderColor: '#334155' },
  tagPillActive: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  tagPillText: { color: '#94A3B8', fontWeight: '700', fontSize: 13 },
  tagPillTextActive: { color: '#FFF' },

  modeToggleRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  modeToggleBtn: { flex: 1, paddingVertical: 14, backgroundColor: '#1E293B', borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  modeToggleBtnActive: { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: '#10B981' },
  modeToggleText: { color: '#94A3B8', fontWeight: '700', fontSize: 14 },
  modeToggleTextActive: { color: '#10B981' },
  nearbyHint: { color: '#64748B', fontSize: 12, lineHeight: 17, marginBottom: 14, fontStyle: 'italic' },

  inputLabel: { color: '#E2E8F0', fontSize: 14, fontWeight: '700', textTransform: 'uppercase', marginBottom: 10 },
  textInput: { backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155', borderRadius: 14, padding: 18, color: '#FFF', fontSize: 16, marginBottom: 28 },

  citySuggestionsBox: { backgroundColor: '#1E293B', borderRadius: 12, borderWidth: 1, borderColor: '#334155', marginTop: 8, overflow: 'hidden' },
  citySuggestionRow: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#0F172A' },
  citySuggestionText: { color: '#F8FAFC', fontSize: 15, fontWeight: '600' },
  citySuggestionSub: { color: '#64748B', fontSize: 12, marginTop: 2 },
  cityWarningText: { color: '#F59E0B', fontSize: 13, marginTop: 8, lineHeight: 18 },

  submitBtn: { paddingVertical: 18, borderRadius: 16, alignItems: 'center', marginTop: 12 },
  submitBtnLarge: { backgroundColor: '#10B981', paddingVertical: 18, borderRadius: 16, alignItems: 'center', marginTop: 16 },
  submitBtnText: { color: '#FFF', fontSize: 17, fontWeight: '800' }
});
