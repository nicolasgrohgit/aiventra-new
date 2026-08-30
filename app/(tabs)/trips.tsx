import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, View, Text, Platform, ScrollView, RefreshControl, TouchableOpacity, Modal, TextInput, ActivityIndicator, Alert, Image, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/useAuth';
import { useTrips } from '@/hooks/useTrips';
import { useContacts } from '@/hooks/useContacts';
import { useEvents } from '@/hooks/useEvents';
import { PlaceRecommendation, displayCategory } from '@/lib/recommendations';
import { NativeDatePicker } from '@/components/ui/NativeDatePicker';
import { getTripDaySchedule, getDeviceEventsForDateRange, expandSlotForProposals } from '@/lib/calendar';
import { guessTimezoneForCity } from '@/lib/timezones';
import { searchCities, CityResult } from '@/lib/geocoding';
import { searchHotelLocation, HotelLocationResult } from '@/lib/hotel-geocoding';
import { CircleShareSelector } from '@/components/ui/circle-share-selector';
import { FOOD_GENRES_CATEGORIZED, ACTIVITY_GENRES_CATEGORIZED, EVENT_GENRES_CATEGORIZED } from '@/constants/preferences';
import { buildMapsUrl } from '@/lib/maps-link';
import { API_URL } from '@/lib/api-client';

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

interface TripBaseLocation {
  label: string;
  lat: number;
  lng: number;
  source: 'hotel' | 'city';
  startDate: string;
  endDate: string;
}

interface TripMock {
  id: string;
  destination: string;
  startDate: Date;
  endDate: Date;
  timezone: string;
  sharedWithCircles: string[];
  dismissedSlots?: string[];
  baseLocations?: TripBaseLocation[];
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
// Split by the same meal/non-meal dichotomy buildCategoryFilter (lib/place-matching.ts) already
// applies server-side: a meal-window slot only ever gets Restaurant results back, so showing
// Activity/Event tags (e.g. "Walking Tours") as options there was always going to search for
// something the slot could never actually surface — reported live as bubbles that "don't care
// about" mismatching what was actually being searched for.
const REFINE_TAG_GROUPS_MEAL = FOOD_GENRES_CATEGORIZED;
const REFINE_TAG_GROUPS_NON_MEAL = [...ACTIVITY_GENRES_CATEGORIZED, ...EVENT_GENRES_CATEGORIZED];

const formatTripDate = (d: Date, tz: string) => d.toLocaleDateString('en-CA', { timeZone: tz });

// Sub-kilometer distances read as more useful in meters ("450m away" vs "0.5km away") — matches
// how a "near your hotel" walkable distance is actually judged.
const formatDistanceLabel = (km: number) => (km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`);

// Every card/detail-modal thumbnail points at this same server-side proxy (never at
// googleapis.com directly) — see GET /api/places/:id/photo in server.ts for why: resolving a
// Google photoRef into real image bytes needs GOOGLE_PLACES_API_KEY, which must never leave
// the server. Only call this when place.hasPhoto is true — the endpoint 404s otherwise.
const placePhotoUri = (placeId: string) => `${API_URL}/api/places/${placeId}/photo`;

// getTripDaySchedule's real-calendar path (vs. its hardcoded weekday/weekend fallback) needs
// imported events in CalendarEvent shape — only 'imported' events represent an actual busy
// block on the device calendar; 'created' events are things the user is proposing to do
// during their free time, not obstacles to route around.
const toImportedCalendarEvents = (events: TripEvent[]) =>
  events
    .filter(e => e.source === 'imported')
    .map(e => ({ id: e._id, title: e.title, startTime: new Date(e.start_time), endTime: new Date(e.end_time) }));

// A local's own city needs no "what should I do here" AI proposals — they live there, they
// know it. Same loose city-matching as cityNeedle/buildCityDurationQuery in
// lib/place-matching.ts (destinations and homebase are both entered via the same
// geocoding-autocomplete picker, so either can be a bare "Rome" or "Rome, Italy" depending on
// how it was typed) — duplicated here in miniature rather than imported, since that file is
// explicitly server-side-only/DB-pure and this is a one-line comparison, not worth crossing
// that boundary for. Deliberately a render-time check against the *current* user.homebase
// rather than something stored on the Trip itself, so it stays correct if homebase changes
// later and needs no migration for trips (including shadow trips — see linkedTripId in
// models/Trip.ts) that already exist.
const isHomeTurf = (homebase: string | undefined, destination: string) =>
  !!homebase && homebase.split(',')[0].trim().toLowerCase() === destination.split(',')[0].trim().toLowerCase();

export default function TripsScreen() {
  const { user } = useAuth();
  const { trips, setTrips, toggleDismissedSlot } = useTrips();
  const mealPrefs = { earliestLunchTime: user?.preferences?.earliestLunchTime, earliestDinnerTime: user?.preferences?.earliestDinnerTime };
  const { contacts, refreshContacts } = useContacts();
  const {
    fetchTripEvents, fetchInvitedEvents, createEvent, importTripEvents, updateEvent, respondToEvent, getJointRecommendations, getRecommendations,
    getFriendsNearby, getCityPhoto, getPlaceById
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
  // The picked city's own centroid — previously discarded the moment a suggestion was tapped,
  // now kept as the free 'city' baseLocations fallback anchor (see handleSaveTrip) and as the
  // geographic bias for the hotel search below, so a generic hotel name can't resolve to a
  // same-named place in the wrong country.
  const [newDestinationCoords, setNewDestinationCoords] = useState<{ lat: number; lng: number } | null>(null);

  // "Where are you staying? (optional)" — a real geocoded anchor point (Nominatim, see
  // lib/hotel-geocoding.ts) far more precise than the city itself for "near me" distance
  // filtering. Same debounced-suggestions pattern as the destination field above.
  const [newHotelQuery, setNewHotelQuery] = useState('');
  const [newHotelSuggestions, setNewHotelSuggestions] = useState<HotelLocationResult[]>([]);
  const [newHotelFocused, setNewHotelFocused] = useState(false);
  const [newHotelSelected, setNewHotelSelected] = useState<{ label: string; lat: number; lng: number } | null>(null);

  const resetDestinationLookup = () => {
    setDestinationSuggestions([]);
    setDestinationWarning(null);
    setDestinationFocused(false);
  };

  const resetHotelLookup = () => {
    setNewHotelSuggestions([]);
    setNewHotelFocused(false);
  };

  // slotStart carries the actual day+time of the free-time slot the tapped PlaceCard was
  // shown under — scheduleDate/scheduleTime are synced to it below, rather than defaulting
  // to "now" regardless of which day's slot was actually tapped.
  // existingEvent is set (via findScheduledEventForPlace, computed at tap-time) when a real
  // Event already exists for this place within this slot's window — it switches the modal
  // below into a view/edit-existing-event mode instead of always rendering a blank create
  // form, which previously risked POSTing a second, duplicate Event for the same place.
  const [selectedPlace, setSelectedPlace] = useState<{ place: PlaceRecommendation, tripId: string, slotStart: Date, existingEvent: TripEvent | null } | null>(null);
  const [scheduleDate, setScheduleDate] = useState(new Date());
  const [scheduleTime, setScheduleTime] = useState(new Date());
  const [scheduleInviteContactId, setScheduleInviteContactId] = useState<string | null>(null);

  // "Looking for something else?" — a refined-search flow, pre-filled with the day/destination
  // context from wherever it was tapped, letting the user override the time window and/or
  // narrow to specific tags for just this one search (see handleRefineSearch below).
  const [refineSearchContext, setRefineSearchContext] = useState<{ tripId: string, destination: string, dayLabel: string, date: Date, mealWindow: boolean } | null>(null);
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
      if (selectedPlace.existingEvent) {
        // Editing a real, already-scheduled event — prefill from what's actually booked
        // (see findScheduledEventForPlace) instead of the slot's original instant, and
        // prefill the invitee from the event's real participants rather than leaving the
        // picker blank (or worse, carrying over whoever was picked for a previous card).
        setScheduleDate(new Date(selectedPlace.existingEvent.start_time));
        setScheduleTime(new Date(selectedPlace.existingEvent.start_time));
        const firstParticipant = selectedPlace.existingEvent.participants[0];
        setScheduleInviteContactId(firstParticipant ? contactIdForParticipant(firstParticipant.user_id) : null);
      } else {
        setScheduleDate(new Date(selectedPlace.slotStart));
        setScheduleTime(new Date(selectedPlace.slotStart));
        setScheduleInviteContactId(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlace]);

  const [expandedTripIds, setExpandedTripIds] = useState<Set<string>>(new Set());
  // Whole-card collapse — separate from expandedTripIds (which only controls how many of a
  // trip's *days* show in AI Schedule Proposals) since a frequent traveler with several trips
  // on the list needs to shrink a trip down to just its header, not just see fewer of its days.
  const [collapsedTripIds, setCollapsedTripIds] = useState<Set<string>>(new Set());
  // "Current Schedule" (renamed from "Scheduled Sequence") collapse — shows only the first 2
  // entries by default, same reasoning as above but for that list specifically.
  const [expandedTimelineIds, setExpandedTimelineIds] = useState<Set<string>>(new Set());

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

  // Trip card hero photo, keyed by trip id — fetched once per trip (see GET /api/places/
  // city-photo) and cached here for the session; a key absent from this map means "not
  // fetched yet", an explicit null means "fetched, no photo available for this city".
  const [cityPhotoByTrip, setCityPhotoByTrip] = useState<Record<string, string | null>>({});
  const fetchedCityPhotoTripIds = useRef<Set<string>>(new Set());

  // "AI Schedule Proposals" recommendations, keyed by `${tripId}-${slotStartIso}` and
  // fetched from the real server-side Place collection (see hooks/useAuth.tsx's
  // getRecommendations) rather than computed synchronously from a local mock array — a key
  // absent from this map means "not fetched yet", an empty array means "fetched, no matches".
  const [slotRecommendations, setSlotRecommendations] = useState<Record<string, PlaceRecommendation[]>>({});
  const fetchedSlotKeys = useRef<Set<string>>(new Set());
  // Guards the getPlaceById fallback below (keyed by `${slotKey}-${placeId}`) so a scheduled
  // place missing from its slot's own results is only ever fetched once per slot.
  const fetchedPlaceForSlot = useRef<Set<string>>(new Set());

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
    trips.forEach(t => syncDeviceCalendarForTrip(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips]);

  // Split out from the [trips]-dependent effect above and re-polled on every tab FOCUS, not
  // just first mount/whenever `trips` changes: tab screens stay mounted in the background
  // when you switch tabs, so a mount-only poll only ever saw state (an invite, another
  // user's homebase-sharing setting, an accepted event) that existed before this screen's
  // very first visit. Same underlying gap just fixed on the Circles tab for friend requests
  // (social.tsx) — live-reported there as "had to force quit to get it to show up," then
  // again here for nearby friends, then a third time for refreshTripEvents itself: accepting
  // an event invite on the OTHER person's device updates the Event doc server-side, but this
  // trip's own event list only refetched when the `trips` array changed, not on return to
  // this tab — so an accepted invite silently never appeared on the inviter's own trip.
  useFocusEffect(
    useCallback(() => {
      refreshInvitedEvents();
      trips.forEach(t => refreshTripEvents(t.id));
      trips.forEach(t => refreshNearbyFriends(t));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trips])
  );

  // Manual escape hatch alongside the automatic useFocusEffect refresh above — live-suggested
  // ("there is no pull-down resync of the page, maybe something worth adding") after an
  // accepted event invite didn't appear without a full app restart. useFocusEffect now covers
  // the common case (returning to this tab), but pull-to-refresh covers everything else: staying
  // on this tab while someone else accepts/adds something, a flaky sync that focus alone can't
  // detect, or just wanting to force a resync without waiting.
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const handlePullRefresh = async () => {
    setIsPullRefreshing(true);
    try {
      await Promise.all([
        refreshInvitedEvents(),
        ...trips.map(t => refreshTripEvents(t.id)),
        ...trips.map(t => refreshNearbyFriends(t)),
      ]);
    } finally {
      setIsPullRefreshing(false);
    }
  };

  // One city-photo lookup per trip, cached by trip id so switching tabs/re-rendering doesn't
  // refetch — same ref-guard shape as fetchedSlotKeys below.
  useEffect(() => {
    trips.forEach(trip => {
      if (fetchedCityPhotoTripIds.current.has(trip.id)) return;
      fetchedCityPhotoTripIds.current.add(trip.id);
      getCityPhoto(trip.destination).then(placeId => {
        setCityPhotoByTrip(prev => ({ ...prev, [trip.id]: placeId }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips]);

  // Fetches "AI Schedule Proposals" recommendations for each currently-visible day's free
  // slots (day 1 always, all days once a trip is expanded), one real API call per slot,
  // cached by key so re-renders and re-expanding an already-loaded trip don't refetch.
  //
  // Fetched sequentially within each day (not all-parallel, as before) so a slot after the
  // first can anchor its query on the *previous* slot's top pick instead of always anchoring
  // every slot of the day on the trip's static hotel/city location — otherwise a day's plan
  // could logically propose dinner clear across town from where the afternoon activity was,
  // even though the user is realistically still near that activity by dinnertime. The first
  // slot of each day has no predecessor, so it still anchors on the trip's hotel/city as
  // before. If a slot's top pick has no geocoded `location` (not every place does — see
  // models/Place.ts), the chain just breaks there and the next slot falls back to the trip
  // anchor too, same as today's behavior.
  useEffect(() => {
    trips.forEach((trip: TripMock) => {
      // A collapsed card's proposals aren't rendered at all — skip fetching for it entirely
      // rather than fetching-and-hiding.
      if (collapsedTripIds.has(trip.id)) return;
      // Home-turf trips never render this section (see isHomeTurf above and the render loop
      // below) — skip the fetch work too, not just the display, same reasoning as the
      // collapsed-card guard just above.
      if (isHomeTurf(user?.homebase, trip.destination)) return;
      const isExpanded = expandedTripIds.has(trip.id);
      const tripEvents = eventsByTrip[trip.id] || [];
      const importedEvents = toImportedCalendarEvents(tripEvents);
      const daySchedules = getTripDaySchedule(trip.startDate, trip.endDate, 5, trip.timezone, importedEvents, mealPrefs);
      const visibleDays = isExpanded ? daySchedules : daySchedules.slice(0, 1);
      const dismissedSlots = trip.dismissedSlots || [];

      visibleDays.forEach(day => {
        const dayProposals = day.freeSlots.flatMap(slot => expandSlotForProposals(slot, trip.timezone, mealPrefs));

        (async () => {
          let previousAnchor: { lat: number; lng: number } | null = null;
          for (const proposal of dayProposals) {
            const dismissedKey = `${proposal.startTime.toISOString()}-${proposal.type}`;
            if (dismissedSlots.includes(dismissedKey)) continue;

            const key = `${trip.id}-${proposal.startTime.toISOString()}-${proposal.type}`;
            let results: any[] | undefined = slotRecommendations[key];

            if (!results && !fetchedSlotKeys.current.has(key)) {
              fetchedSlotKeys.current.add(key);
              try {
                const places = await getRecommendations({
                  city: trip.destination,
                  durationMinutes: proposal.durationMinutes,
                  startTimeIso: proposal.startTime.toISOString(),
                  timezone: trip.timezone,
                  tripId: trip.id,
                  ...(previousAnchor ? { anchorLat: previousAnchor.lat, anchorLng: previousAnchor.lng } : {})
                });
                results = places.map((p: any) => ({ ...p, id: p._id }));
                setSlotRecommendations(prev => ({ ...prev, [key]: results! }));
              } catch {
                results = [];
                setSlotRecommendations(prev => ({ ...prev, [key]: [] }));
              }
            }

            // Fallback for a scheduled event whose place isn't in this slot's own recommendation
            // results — happens when it was scheduled via a path that queries independently
            // (e.g. "Looking for something else?" refine search) rather than picked from these
            // exact results. handleAddToItinerary merges same-session picks into
            // slotRecommendations immediately, but that merge doesn't survive an app restart —
            // this effect is what makes it durable, fetching the place directly by id so the
            // slot doesn't fall back to "No places fit this slot yet" despite having a real
            // scheduled pick. See CHANGELOG for the "just added a lunch and it doesn't show up"
            // report this fixes.
            const missingScheduled = tripEvents.filter((e: TripEvent) =>
              e.source === 'created' && e.place_id &&
              new Date(e.start_time) < proposal.endTime && new Date(e.end_time) > proposal.startTime &&
              !(results || []).some(p => p.id === e.place_id)
            );
            for (const event of missingScheduled) {
              const fetchKey = `${key}-${event.place_id}`;
              if (fetchedPlaceForSlot.current.has(fetchKey)) continue;
              fetchedPlaceForSlot.current.add(fetchKey);
              getPlaceById(event.place_id!).then(place => {
                if (!place) return;
                setSlotRecommendations(prev => {
                  const existing = prev[key] || [];
                  if (existing.some(p => p.id === place._id)) return prev;
                  return { ...prev, [key]: [{ ...place, id: place._id }, ...existing] };
                });
              });
            }

            const topPickCoords = results?.[0]?.location?.coordinates;
            if (topPickCoords) previousAnchor = { lat: topPickCoords[1], lng: topPickCoords[0] };
          }
        })();
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips, expandedTripIds, eventsByTrip, collapsedTripIds, user?.homebase, user?.preferences?.earliestLunchTime, user?.preferences?.earliestDinnerTime]);

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

  // Debounced hotel/accommodation lookup — biased to the picked destination city's centroid
  // (newDestinationCoords) so a generic name like "Marriott" resolves within the right city,
  // not wherever text-relevance alone would rank first worldwide.
  useEffect(() => {
    if (newHotelQuery.trim().length < 2) {
      setNewHotelSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const results = await searchHotelLocation(newHotelQuery, newDestinationCoords ?? undefined);
        if (!cancelled) setNewHotelSuggestions(results);
      } catch {
        // Geocoding failures shouldn't block trip creation — the hotel field is optional.
        if (!cancelled) setNewHotelSuggestions([]);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [newHotelQuery, newDestinationCoords]);

  // Only contacts who are real, linked app users can be invited — blind matching needs a
  // real account with real preferences on the other side, and there's nothing to match a
  // pending (not-yet-joined) contact against.
  const eligibleContacts = contacts.filter((c: any) => c.isAppUser && c.contact_user_id);

  const getParticipantLabel = (participantUserId: string) => {
    if (participantUserId === myUserId) return 'You';
    const contact = contacts.find((c: any) => c.contact_user_id === participantUserId);
    return contact?.name || 'Someone';
  };

  // Same lookup as getParticipantLabel above, but resolving to the Contact._id ContactPicker
  // actually deals in (see its own comment) rather than a display name — used to prefill the
  // "Schedule It" modal's invitee when reopening an already-scheduled place.
  const contactIdForParticipant = (participantUserId: string): string | null => {
    const contact = contacts.find((c: any) => c.contact_user_id === participantUserId);
    return contact?.id || null;
  };

  // Finds the real Event (if any) already booked for this exact place within this slot's
  // time window — lets a PlaceCard tap detect "this was already scheduled" instead of always
  // treating it as a fresh recommendation, which would let "Add to Itinerary" create a second,
  // duplicate Event for the same place. Matched by place_id within this trip, using the
  // place's own estimated duration as the window width (the same duration handleAddToItinerary
  // uses to compute end_time when an event is first created) and an overlap check rather than
  // exact-instant equality, so a still-pending edit to the time doesn't break detection.
  const findScheduledEventForPlace = (tripId: string, placeId: string, windowStart: Date, durationMinutes: number): TripEvent | undefined => {
    const windowEnd = new Date(windowStart.getTime() + durationMinutes * 60000);
    return (eventsByTrip[tripId] || []).find(e =>
      e.place_id === placeId && new Date(e.start_time) < windowEnd && new Date(e.end_time) > windowStart
    );
  };

  const toggleTripExpand = (tripId: string) => {
    setExpandedTripIds(prev => {
      const next = new Set(prev);
      if (next.has(tripId)) next.delete(tripId);
      else next.add(tripId);
      return next;
    });
  };

  const toggleTripCollapsed = (tripId: string) => {
    setCollapsedTripIds(prev => {
      const next = new Set(prev);
      if (next.has(tripId)) next.delete(tripId);
      else next.add(tripId);
      return next;
    });
  };

  const toggleTimelineExpand = (tripId: string) => {
    setExpandedTimelineIds(prev => {
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
    setNewDestinationCoords(null);
    setNewHotelQuery('');
    setNewHotelSelected(null);
    resetDestinationLookup();
    resetHotelLookup();
    setShowCreateModal(true);
  };

  const handleOpenEditTarget = (trip: TripMock) => {
    setEditTripId(trip.id);
    setNewDestination(trip.destination);
    setStartDate(trip.startDate);
    setEndDate(trip.endDate);
    setNewSharedWithCircles(trip.sharedWithCircles || []);
    // Pre-fill from whatever baseLocations this trip already has — a hotel isn't always known
    // at creation time, so editing it in later needs to work exactly like setting it does.
    const existingCity = (trip.baseLocations || []).find(b => b.source === 'city');
    const existingHotel = (trip.baseLocations || []).find(b => b.source === 'hotel');
    setNewDestinationCoords(existingCity ? { lat: existingCity.lat, lng: existingCity.lng } : null);
    setNewHotelSelected(existingHotel ? { label: existingHotel.label, lat: existingHotel.lat, lng: existingHotel.lng } : null);
    setNewHotelQuery(existingHotel?.label || '');
    resetDestinationLookup();
    resetHotelLookup();
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

    // 'city' is the free centroid fallback (always included when we have it — costs nothing,
    // previously discarded); 'hotel' is the higher-precision anchor when the user picked one.
    // Both cover the trip's full date range — today's app is 1 trip = 1 city, so there's never
    // more than one of each.
    const baseLocations: TripBaseLocation[] = [];
    if (newDestinationCoords) {
      baseLocations.push({
        label: newDestination, lat: newDestinationCoords.lat, lng: newDestinationCoords.lng,
        source: 'city', startDate: startDate.toISOString(), endDate: endDate.toISOString()
      });
    }
    if (newHotelSelected) {
      baseLocations.push({
        label: newHotelSelected.label, lat: newHotelSelected.lat, lng: newHotelSelected.lng,
        source: 'hotel', startDate: startDate.toISOString(), endDate: endDate.toISOString()
      });
    }

    if (editTripId) {
      setTrips(trips.map(t => t.id === editTripId ? {
        ...t,
        destination: newDestination,
        startDate: startDate,
        endDate: endDate,
        timezone: guessTimezoneForCity(newDestination),
        sharedWithCircles: newSharedWithCircles,
        baseLocations
      } : t));
    } else {
      setTrips([{
        id: Date.now().toString(),
        destination: newDestination,
        startDate: startDate,
        endDate: endDate,
        timezone: guessTimezoneForCity(newDestination),
        sharedWithCircles: newSharedWithCircles,
        baseLocations
      }, ...trips]);
    }
    resetDestinationLookup();
    resetHotelLookup();
    setShowCreateModal(false);
  };

  // The one navigate action every card render funnels through via the selectedPlace modal
  // (see the "Single integration point" comment there). Google Maps universal link: Apple Maps
  // intercepts it at the OS level on iOS, Google Maps opens it directly on Android, and a
  // browser is the fallback either way if neither app is installed — no Platform.OS branching
  // needed.
  const handleNavigate = (place: PlaceRecommendation) => {
    Linking.openURL(buildMapsUrl(place)).catch(() => {
      Alert.alert('Error', 'Could not open Maps.');
    });
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

      const tripId = selectedPlace.tripId;
      const scheduledPlace = selectedPlace.place;
      const events = await fetchTripEvents(tripId).catch(() => eventsByTrip[tripId] || []);
      setEventsByTrip(prev => ({ ...prev, [tripId]: events }));

      // Merge the just-scheduled place into whichever AI Schedule Proposals slot(s) its new
      // time window now overlaps — even if that slot's own original query never surfaced it
      // (e.g. it was found via "Looking for something else?" refine search instead, which
      // queries independently and can pick a time the original slot query never saw). Without
      // this, slotRecommendations for that slot stays whatever it was BEFORE this place
      // existed — reported live as "just added a lunch and it doesn't show up": the slot kept
      // rendering "No places fit this slot yet" because that branch runs before the
      // scheduled-item check ever gets a chance, and slotRecommendations is otherwise only
      // ever populated by each slot's own original fetch.
      const trip = trips.find(t => t.id === tripId);
      if (trip) {
        const daySchedules = getTripDaySchedule(trip.startDate, trip.endDate, 5, trip.timezone, toImportedCalendarEvents(events), mealPrefs);
        daySchedules.forEach(day => {
          day.freeSlots.flatMap(slot => expandSlotForProposals(slot, trip.timezone, mealPrefs)).forEach(proposal => {
            if (finalStart < proposal.endTime && finalEnd > proposal.startTime) {
              const key = `${tripId}-${proposal.startTime.toISOString()}-${proposal.type}`;
              setSlotRecommendations(prev => {
                const existing = prev[key] || [];
                if (existing.some(p => p.id === scheduledPlace.id)) return prev;
                return { ...prev, [key]: [scheduledPlace, ...existing] };
              });
            }
          });
        });
      }

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

  // Counterpart to handleAddToItinerary for the "this place is already scheduled" case
  // (selectedPlace.existingEvent set — see findScheduledEventForPlace): saves changes onto
  // the real event via PUT /api/events/:id instead of POSTing a new one, so re-opening an
  // already-scheduled card and tweaking the time/invitee can't create a duplicate booking.
  const handleUpdateScheduledEvent = async () => {
    if (!selectedPlace?.existingEvent) return;
    const finalStart = new Date(scheduleDate);
    finalStart.setHours(scheduleTime.getHours(), scheduleTime.getMinutes(), 0, 0);
    const finalEnd = new Date(finalStart.getTime() + selectedPlace.place.estimatedDuration * 60000);

    try {
      await updateEvent(selectedPlace.existingEvent._id, {
        startTime: finalStart.toISOString(),
        endTime: finalEnd.toISOString(),
        participantContactIds: scheduleInviteContactId ? [scheduleInviteContactId] : []
      });
      await refreshTripEvents(selectedPlace.tripId);
      setSelectedPlace(null);
      setScheduleInviteContactId(null);
      // Same harmless no-op as handleAddToItinerary — only closes the refine modal if it's
      // actually open (an already-scheduled place can still surface from a refine search).
      closeRefineSearch();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not save your changes.');
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

  const openRefineSearch = (trip: TripMock, day: { dayLabel: string, date: Date }, mealWindow: boolean) => {
    setRefineSearchContext({ tripId: trip.id, destination: trip.destination, dayLabel: day.dayLabel, date: day.date, mealWindow });
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
        tagOverride: refineTags.length > 0 ? refineTags : undefined,
        tripId: refineSearchContext.tripId
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
            timezone: trip.timezone,
            tripId: trip.id
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

  // Used by PlaceCard's "✓ Scheduled" badge — deliberately trip-wide (any day), not slot-scoped:
  // a place already added anywhere on the trip should read as scheduled wherever its card
  // reappears, so tapping "Add to Itinerary" doesn't look like a no-op.
  const isPlaceScheduled = (tripEvents: TripEvent[], placeId: string) =>
    tripEvents.some(e => e.source === 'created' && e.place_id === placeId);

  // Used by the slot-collapse logic below — must be scoped to THIS slot's own time window.
  // The recommendation engine can legitimately suggest the same place (e.g. a major attraction)
  // as a candidate for more than one slot on the same day (morning activity AND evening
  // activity). Without the time-window check, scheduling it for one slot made every other
  // slot that also happened to suggest it collapse down to "✓ Scheduled" too, even though
  // no event was ever created in that slot's window — reported as "picked it for the morning
  // and it scheduled the evening too, must be pointing at the same DB record" when in fact
  // there was only ever one Event document; this was a display bug, not a data bug.
  const isPlaceScheduledInSlot = (tripEvents: TripEvent[], placeId: string, slotStart: Date, slotEnd: Date) =>
    tripEvents.some(e =>
      e.source === 'created' && e.place_id === placeId &&
      new Date(e.start_time) < slotEnd && new Date(e.end_time) > slotStart
    );

  const PlaceCard = ({ place, tripId, slotStart, tripEvents }: { place: PlaceRecommendation, tripId: string, slotStart: Date, tripEvents: TripEvent[] }) => {
    // A place already added to this trip (any day) looks identical to an unscheduled one
    // otherwise, which is exactly why tapping "Add to Itinerary" reads as "nothing happened" —
    // it did work, there's just no visible trace of it back on the card you tapped.
    const alreadyScheduled = isPlaceScheduled(tripEvents, place.id);
    return (
    <TouchableOpacity
      style={styles.placeCard}
      activeOpacity={0.8}
      onPress={() => {
        const scheduledEvent = findScheduledEventForPlace(tripId, place.id, slotStart, place.estimatedDuration);
        setSelectedPlace({ place, tripId, slotStart, existingEvent: scheduledEvent || null });
        refreshContacts();
      }}
    >
      <View style={styles.placeHeader}>
        <Text style={styles.placeName} numberOfLines={1}>{place.name}</Text>
        {alreadyScheduled ? (
          <View style={styles.badgeScheduled}><Text style={styles.badgeText}>✓ Scheduled</Text></View>
        ) : (
          <View style={styles.badge}><Text style={styles.badgeText}>{place.matchScore > 0 ? `${place.matchScore} tag match` : 'New idea'}</Text></View>
        )}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {place.hasPhoto && (
          <Image source={{ uri: placePhotoUri(place.id) }} style={styles.placeThumb} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.placeCategory}>{displayCategory(place)} • {place.rating} ★ • {formatDistanceLabel(place.distanceKm)}</Text>
          <Text style={styles.placeDesc} numberOfLines={2}>{place.description}</Text>
        </View>
      </View>
      {/* Same tap-to-navigate as the detail modal (buildMapsUrl always resolves, even with no
          address), but right on the card itself — previously this required opening the detail
          modal first, an extra tap that mattered most for an already-scheduled pick you just
          want directions to. Nested TouchableOpacity resolves to this one over the card's own
          onPress, same pattern as recommendation.tsx's handleNavigate. */}
      <TouchableOpacity
        style={styles.addressRow}
        activeOpacity={0.7}
        onPress={() => handleNavigate(place)}
      >
        <Text style={styles.addressIcon}>📍</Text>
        <Text style={styles.placeAddressText} numberOfLines={1}>
          {place.address || 'Get directions'}
        </Text>
        <Text style={styles.navigateChevron}>Navigate ›</Text>
      </TouchableOpacity>
    </TouchableOpacity>
    );
  };

  // "Looking for something else?" — appended after the real suggestions (or shown alone when
  // there are none), opens a placeholder modal pre-filled with this day/destination.
  const RefineSearchCard = ({ trip, day, mealWindow }: { trip: TripMock, day: { dayLabel: string, date: Date }, mealWindow: boolean }) => (
    <TouchableOpacity
      style={styles.refineCard}
      activeOpacity={0.8}
      onPress={() => openRefineSearch(trip, day, mealWindow)}
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
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isPullRefreshing} onRefresh={handlePullRefresh} tintColor="#3B82F6" />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerTextContainer}>
            <ThemedText style={styles.title}>Your Trips</ThemedText>
            <ThemedText style={styles.subtitle}>Plan and share your upcoming trips.</ThemedText>
          </View>
          <TouchableOpacity style={styles.addButton} onPress={handleOpenCreateTarget}>
            <Text style={styles.addButtonText}>+</Text>
          </TouchableOpacity>
        </View>

        {/* The "Your Invites" modal (below) already correctly lists every invited event
            regardless of status — accepted/declined ones included, not just pending. But this
            banner used to be its ONLY entry point, and used to only render when
            pendingInviteCount > 0 — so the moment you responded to your last pending invite,
            there was no way back into that modal at all. For someone who owns no trips of
            their own (a pure event participant, e.g. invited to one lunch and nothing else),
            that meant the event they'd just accepted effectively vanished from the app —
            live-reported as "can't see anything in the trips" after accepting. Now falls back
            to a calmer, non-urgent variant once nothing's pending but something's still here. */}
        {pendingInviteCount > 0 ? (
          <TouchableOpacity style={styles.inviteBanner} activeOpacity={0.8} onPress={() => setShowInvitedModal(true)}>
            <Text style={styles.inviteBannerText}>
              {pendingInviteCount} pending invite{pendingInviteCount !== 1 ? 's' : ''} — tap to respond
            </Text>
          </TouchableOpacity>
        ) : invitedEvents.length > 0 ? (
          <TouchableOpacity style={styles.inviteBannerCalm} activeOpacity={0.8} onPress={() => setShowInvitedModal(true)}>
            <Text style={styles.inviteBannerCalmText}>
              {invitedEvents.length} invite{invitedEvents.length !== 1 ? 's' : ''} — view your invites
            </Text>
          </TouchableOpacity>
        ) : null}

        {trips.length === 0 ? (
          <Text style={styles.emptyText}>{"You haven't added any trips yet."}</Text>
        ) : (
          trips.map(trip => {
            const totalTripDays = Math.round((trip.endDate.getTime() - trip.startDate.getTime()) / 86400000) + 1;
            const tripEvents = eventsByTrip[trip.id] || [];
            const daySchedules = getTripDaySchedule(trip.startDate, trip.endDate, 5, trip.timezone, toImportedCalendarEvents(tripEvents), mealPrefs);
            const isCardCollapsed = collapsedTripIds.has(trip.id);
            const dismissedSlotKeys = trip.dismissedSlots || [];
            const isLocalTrip = isHomeTurf(user?.homebase, trip.destination);

            return (
              <View key={trip.id} style={styles.tripCard}>
                 {/* Highest-rated place with a real photo for this city — see GET /api/places/
                     city-photo. Negative margins bleed it past tripCard's own padding so it
                     spans full-width with rounded top corners matching the card (tripCard's
                     overflow:'hidden' + borderRadius clip it), rather than sitting inset. */}
                 {cityPhotoByTrip[trip.id] && (
                   <Image source={{ uri: placePhotoUri(cityPhotoByTrip[trip.id]!) }} style={styles.tripHeroPhoto} />
                 )}
                 <View style={styles.tripHeaderContainer}>
                   <TouchableOpacity style={{flex: 1}} activeOpacity={0.7} onPress={() => toggleTripCollapsed(trip.id)}>
                     <Text style={styles.destinationText}>{isCardCollapsed ? '▶' : '▼'}  {trip.destination}</Text>
                     <Text style={styles.dateText}>{formatTripDate(trip.startDate, trip.timezone)} to {formatTripDate(trip.endDate, trip.timezone)}</Text>
                   </TouchableOpacity>
                   <View style={styles.tripActions}>
                     <TouchableOpacity onPress={() => handleOpenEditTarget(trip)} style={styles.iconBtn}><Text style={{fontSize: 18}}>✏️</Text></TouchableOpacity>
                     <TouchableOpacity onPress={() => handleDeleteTrip(trip.id)} style={styles.iconBtnDel}><Text style={{fontSize: 18}}>🗑️</Text></TouchableOpacity>
                   </View>
                 </View>

                 {isCardCollapsed ? null : (
                 <>
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

                 {tripEvents.length > 0 && (() => {
                    const timelineExpanded = expandedTimelineIds.has(trip.id);
                    const visibleEvents = timelineExpanded ? tripEvents : tripEvents.slice(0, 2);
                    return (
                    <View style={styles.timelineContainer}>
                      <Text style={styles.timelineHeader}>Current Schedule</Text>
                      {visibleEvents.map((event) => {
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
                      {tripEvents.length > 2 && (
                        <TouchableOpacity style={styles.expandButton} onPress={() => toggleTimelineExpand(trip.id)}>
                          <Text style={styles.expandButtonText}>
                            {timelineExpanded ? '▲  Show less' : `▼  Show all ${tripEvents.length}`}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    );
                 })()}

                  {isLocalTrip ? (
                    // Home turf: the viewer's own homebase matches this trip's destination, so
                    // they already live/know the city — auto-generated restaurant/activity
                    // proposals are noise here, not help. "+ Propose an Event" above is
                    // untouched and still the right tool if they want to plan something specific.
                    // Live-reported case this fixes: inviting a local contact to dinner in their
                    // home city auto-generated a full day of AI suggestions for a city they
                    // already know inside out.
                    <Text style={styles.emptyText}>You're home here — no AI Schedule Proposals for a city you already know. Tap "+ Propose an Event" above if you want to plan something.</Text>
                  ) : (
                  <>
                  <Text style={styles.proposalsHeader}>AI Schedule Proposals</Text>
                  {(() => {
                    const isExpanded = expandedTripIds.has(trip.id);
                    const visibleDays = isExpanded ? daySchedules : daySchedules.slice(0, 1);
                    return (
                      <>
                        {visibleDays.map(day => {
                          const dayProposals = day.freeSlots.flatMap(slot => expandSlotForProposals(slot, trip.timezone, mealPrefs));
                          const rawKey = (p: typeof dayProposals[number]) => `${p.startTime.toISOString()}-${p.type}`;
                          const visibleProposals = dayProposals.filter(p => !dismissedSlotKeys.includes(rawKey(p)));
                          const dayDismissedKeys = dayProposals.map(rawKey).filter(k => dismissedSlotKeys.includes(k));
                          return (
                          <View key={day.date.toISOString()} style={styles.dayBlock}>
                            <View style={styles.dayHeaderRow}>
                              <Text style={styles.dayLabelText}>{day.dayLabel}</Text>
                              <View style={[styles.dayTypeBadge, day.isWeekend ? styles.dayTypeBadgeWeekend : styles.dayTypeBadgeWeekday]}>
                                <Text style={styles.dayTypeBadgeText}>{day.isWeekend ? '🎉 Weekend' : '💼 Weekday'}</Text>
                              </View>
                            </View>
                            {visibleProposals.map(proposal => {
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
                                    <TouchableOpacity
                                      style={styles.slotDismissBtn}
                                      onPress={() => toggleDismissedSlot(trip.id, rawKey(proposal), true)}
                                    >
                                      <Text style={styles.slotDismissBtnText}>✕</Text>
                                    </TouchableOpacity>
                                  </View>
                                  {slotRecs === undefined ? (
                                    <ActivityIndicator size="small" color="#3B82F6" />
                                  ) : slotRecs.length === 0 ? (
                                    <>
                                      <Text style={styles.emptyText}>No places fit this slot yet.</Text>
                                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll}>
                                        <RefineSearchCard trip={trip} day={day} mealWindow={proposal.type === 'meal'} />
                                      </ScrollView>
                                    </>
                                  ) : (() => {
                                    // Once one of this slot's proposals has been scheduled, the
                                    // remaining unpicked ones are just noise — the choice is
                                    // made. Collapse down to the scheduled card(s) plus "Looking
                                    // for something else?", so changing your mind is still one
                                    // tap away without the other options cluttering the row.
                                    const scheduledRecs = slotRecs.filter(p => isPlaceScheduledInSlot(tripEvents, p.id, proposal.startTime, proposal.endTime));
                                    const displayedRecs = scheduledRecs.length > 0 ? scheduledRecs : slotRecs.slice(0, 3);
                                    return (
                                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll}>
                                        {displayedRecs.map(p => (
                                          <PlaceCard key={`${proposal.startTime.getTime()}-${p.id}`} place={p} tripId={trip.id} slotStart={proposal.startTime} tripEvents={tripEvents} />
                                        ))}
                                        <RefineSearchCard trip={trip} day={day} mealWindow={proposal.type === 'meal'} />
                                      </ScrollView>
                                    );
                                  })()}
                                </View>
                              );
                            })}
                            {dayDismissedKeys.length > 0 && (
                              <TouchableOpacity
                                style={styles.restoreDismissedBtn}
                                onPress={() => dayDismissedKeys.forEach(k => toggleDismissedSlot(trip.id, k, false))}
                              >
                                <Text style={styles.restoreDismissedBtnText}>
                                  {dayDismissedKeys.length} hidden — tap to restore
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                          );
                        })}
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
                  </>
                  )}
                 </>
                 )}
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
                      <View style={{ flexDirection: 'row' }}>
                        {p.hasPhoto && <Image source={{ uri: placePhotoUri(p._id) }} style={styles.placeThumb} />}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.placeCategory}>{displayCategory(p)} • {p.rating} ★ • {formatDistanceLabel(p.distanceKm)}</Text>
                          <Text style={styles.placeDesc} numberOfLines={2}>{p.description}</Text>
                        </View>
                      </View>
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

            <ScrollView showsVerticalScrollIndicator={false}>
              {selectedPlace?.existingEvent && (
                <View style={styles.editingBadge}>
                  <Text style={styles.editingBadgeText}>✎ Editing an existing plan</Text>
                </View>
              )}

              {selectedPlace?.place.hasPhoto && (
                <Image source={{ uri: placePhotoUri(selectedPlace.place.id) }} style={styles.detailPhoto} />
              )}

              <View style={styles.heroDetailsBadge}>
                 <Text style={styles.heroDetailsTarget}>
                   {selectedPlace && displayCategory(selectedPlace.place)} • {selectedPlace?.place.estimatedDuration}m Length
                   {selectedPlace ? ` • ${formatDistanceLabel(selectedPlace.place.distanceKm)}` : ''}
                 </Text>
                 <Text style={styles.ratingLarge}>{selectedPlace?.place.rating} ★</Text>
              </View>

              <Text style={styles.detailedDescText}>{selectedPlace?.place.description}</Text>

              {/* Single integration point for tap-to-navigate — every card render (proposals,
                  joint-match propose flow, refine-search results) funnels through this same
                  selectedPlace modal, so wiring it up here covers all of them at once. Always
                  tappable, even with no address on curated/generated places: buildMapsUrl
                  (lib/maps-link.ts) falls back to real coordinates when available, then to a
                  name+city text query — never a dead end. */}
              <TouchableOpacity
                style={styles.addressRow}
                activeOpacity={0.7}
                onPress={() => selectedPlace && handleNavigate(selectedPlace.place)}
              >
                <Text style={styles.addressIcon}>📍</Text>
                <Text style={styles.placeAddressText} numberOfLines={2}>
                  {selectedPlace?.place.address || 'Get directions'}
                </Text>
                <Text style={styles.navigateChevron}>Navigate ›</Text>
              </TouchableOpacity>

              <View style={styles.separator} />
              <Text style={styles.proposalsHeader}>{selectedPlace?.existingEvent ? 'Update This Plan' : 'Schedule It'}</Text>

              <Text style={styles.inputLabel}>Date</Text>
              <NativeDatePicker value={scheduleDate} onChange={setScheduleDate} mode="date" format="date" />

              <Text style={styles.inputLabel}>Time</Text>
              <NativeDatePicker value={scheduleTime} onChange={setScheduleTime} mode="time" format="time" />

              <Text style={styles.inputLabel}>Invite someone (optional)</Text>
              <ContactPicker selectedId={scheduleInviteContactId} onSelect={setScheduleInviteContactId} />

              <TouchableOpacity
                style={[styles.submitBtn, {backgroundColor: '#3B82F6', marginTop: 20}]}
                onPress={selectedPlace?.existingEvent ? handleUpdateScheduledEvent : handleAddToItinerary}
              >
                 <Text style={styles.submitBtnText}>{selectedPlace?.existingEvent ? 'Save Changes' : 'Add to Itinerary'}</Text>
              </TouchableOpacity>
            </ScrollView>
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
                    {(refineSearchContext.mealWindow ? REFINE_TAG_GROUPS_MEAL : REFINE_TAG_GROUPS_NON_MEAL).map(group => (
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
                            const slotStart = refineStartInstant || refineSearchContext.date;
                            const scheduledEvent = findScheduledEventForPlace(refineSearchContext.tripId, p.id, slotStart, p.estimatedDuration);
                            setSelectedPlace({ place: p, tripId: refineSearchContext.tripId, slotStart, existingEvent: scheduledEvent || null });
                            refreshContacts();
                          }}
                        >
                          <View style={styles.placeHeader}>
                            <Text style={styles.placeName} numberOfLines={1}>{p.name}</Text>
                            <View style={styles.badge}><Text style={styles.badgeText}>{p.matchScore > 0 ? `${p.matchScore} tag match` : 'New idea'}</Text></View>
                          </View>
                          <View style={{ flexDirection: 'row' }}>
                            {p.hasPhoto && <Image source={{ uri: placePhotoUri(p.id) }} style={styles.placeThumb} />}
                            <View style={{ flex: 1 }}>
                              <Text style={styles.placeCategory}>{displayCategory(p)} • {p.rating} ★ • {formatDistanceLabel(p.distanceKm)}</Text>
                              <Text style={styles.placeDesc} numberOfLines={2}>{p.description}</Text>
                            </View>
                          </View>
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
          {/* keyboardShouldPersistTaps="handled": without it, ScrollView's default ('never')
              swallows the FIRST tap on a suggestion row (destination city or hotel below) to
              dismiss the keyboard instead of firing the row's onPress — the tap looks like it
              did nothing (or just closed the dropdown, since the TextInput's onBlur still
              fires and hides it), so the selection is silently never captured. This is the
              root cause of hotel selection appearing to "not take" on save. */}
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
                        setNewDestinationCoords({ lat: c.latitude, lng: c.longitude });
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

            <Text style={styles.inputLabel}>Where are you staying? (optional)</Text>
            <View style={{ marginBottom: 8 }}>
              <TextInput
                style={[styles.textInput, { marginBottom: 0 }]}
                placeholder="Hotel name or address"
                placeholderTextColor="#64748B"
                value={newHotelQuery}
                onChangeText={(text) => { setNewHotelQuery(text); setNewHotelSelected(null); }}
                onFocus={() => setNewHotelFocused(true)}
                onBlur={() => setTimeout(() => setNewHotelFocused(false), 150)}
              />
              {newHotelFocused && newHotelSuggestions.length > 0 && (
                <View style={styles.citySuggestionsBox}>
                  {newHotelSuggestions.map((h, i) => (
                    <TouchableOpacity
                      key={`${h.label}-${i}`}
                      style={styles.citySuggestionRow}
                      onPress={() => {
                        setNewHotelQuery(h.label);
                        setNewHotelSelected({ label: h.label, lat: h.latitude, lng: h.longitude });
                        resetHotelLookup();
                      }}
                    >
                      <Text style={styles.citySuggestionText} numberOfLines={2}>{h.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
            <Text style={styles.hotelHelperText}>
              A precise location gets you much more accurate &quot;near me&quot; restaurant and activity
              suggestions than the city alone — especially in a city as large as your
              destination might be. Powered by OpenStreetMap contributors.
            </Text>

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
  // Calmer variant for "nothing pending, but you have invites worth revisiting" — same shape
  // as inviteBanner, blue (the app's standard informational accent) instead of the pending
  // banner's more attention-grabbing green, since nothing here needs urgent action.
  inviteBannerCalm: { backgroundColor: 'rgba(59, 130, 246, 0.12)', borderWidth: 1, borderColor: '#3B82F6', borderRadius: 14, padding: 16, marginBottom: 24 },
  inviteBannerCalmText: { color: '#3B82F6', fontWeight: '700', fontSize: 14, textAlign: 'center' },

  emptyText: { color: '#64748B', fontStyle: 'italic', textAlign: 'center', marginTop: 30 },
  separator: { height: 1, backgroundColor: '#1E293B', marginVertical: 24 },

  tripCard: { backgroundColor: '#0F172A', padding: 24, borderRadius: 28, marginBottom: 32, borderWidth: 1, borderColor: '#1E293B', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 8, overflow: 'hidden' },
  tripHeroPhoto: { width: '100%', height: 140, marginTop: -24, marginHorizontal: -24, marginBottom: 16, backgroundColor: '#1E293B' },
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
  placeThumb: { width: 56, height: 56, borderRadius: 12, marginRight: 12, backgroundColor: '#334155' },
  placeAddressText: { color: '#CBD5E1', fontSize: 13, flex: 1 },

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
  slotDismissBtn: { paddingHorizontal: 8, paddingVertical: 2, marginLeft: 4 },
  slotDismissBtnText: { color: '#64748B', fontSize: 14, fontWeight: '700' },
  restoreDismissedBtn: { alignItems: 'center', paddingVertical: 8, marginTop: 2, marginBottom: 4 },
  restoreDismissedBtnText: { color: '#3B82F6', fontSize: 12, fontWeight: '700' },
  expandButton: { alignItems: 'center', paddingVertical: 14, marginTop: 8, marginBottom: 4, backgroundColor: '#1E293B', borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  expandButtonText: { color: '#3B82F6', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },

  editingBadge: { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderWidth: 1, borderColor: '#10B981', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16, alignSelf: 'flex-start' },
  editingBadgeText: { color: '#10B981', fontWeight: '800', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.3 },

  darkOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  // maxHeight is load-bearing: without it, long content (photo + description + address +
  // schedule form + invite list) grows the sheet until its header — and the Cancel button in
  // it — gets pushed up behind the status bar, nearly untappable. Capped here and the body
  // wrapped in a ScrollView (see the selectedPlace modal below) so the header stays pinned and
  // reachable regardless of content length.
  // paddingTop (36, vs. the 24 every other side uses) and a lower maxHeight cap (82%, down
  // from 88%) both push the header/Cancel further from the status bar than the first pass at
  // this fix did — still too close to the top on a real device even with the height cap and
  // ScrollView in place, reported live.
  darkActionSheet: { backgroundColor: '#0F172A', borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingHorizontal: 24, paddingTop: 36, paddingBottom: Platform.OS === 'ios' ? 48 : 24, borderWidth: 1, borderColor: '#1E293B', maxHeight: '82%' },
  heroDetailsBadge: { backgroundColor: 'rgba(59, 130, 246, 0.1)', paddingVertical: 14, borderRadius: 14, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, marginBottom: 20, borderWidth: 1, borderColor: '#3B82F630' },
  heroDetailsTarget: { color: '#3B82F6', fontSize: 14, fontWeight: '800' },
  ratingLarge: { color: '#FCD34D', fontSize: 14, fontWeight: '900' },
  detailedDescText: { color: '#F8FAFC', fontSize: 16, lineHeight: 24 },
  detailPhoto: { width: '100%', height: 160, borderRadius: 16, marginBottom: 16, backgroundColor: '#1E293B' },
  addressRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, marginTop: 16, borderWidth: 1, borderColor: '#334155' },
  addressIcon: { fontSize: 16, marginRight: 8 },
  navigateChevron: { color: '#3B82F6', fontSize: 13, fontWeight: '800', marginLeft: 10 },

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
  hotelHelperText: { color: '#64748B', fontSize: 12, lineHeight: 17, marginBottom: 28 },

  submitBtn: { paddingVertical: 18, borderRadius: 16, alignItems: 'center', marginTop: 12 },
  submitBtnLarge: { backgroundColor: '#10B981', paddingVertical: 18, borderRadius: 16, alignItems: 'center', marginTop: 16 },
  submitBtnText: { color: '#FFF', fontSize: 17, fontWeight: '800' }
});
