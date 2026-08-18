import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, Platform, ScrollView, TouchableOpacity, Modal, TextInput, ActivityIndicator } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/useAuth';
import { PlaceRecommendation } from '@/lib/recommendations';
import { NativeDatePicker } from '@/components/ui/NativeDatePicker';
import { getTripDaySchedule } from '@/lib/calendar';
import { guessTimezoneForCity } from '@/lib/timezones';
import { searchCities, CityResult } from '@/lib/geocoding';

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
}

const DURATION_OPTIONS = [60, 90, 120, 180];

const formatTripDate = (d: Date, tz: string) => d.toLocaleDateString('en-CA', { timeZone: tz });

export default function TripsScreen() {
  const {
    user, trips, setTrips, contacts,
    fetchTripEvents, fetchInvitedEvents, createEvent, updateEvent, respondToEvent, getJointRecommendations, getRecommendations,
    refreshContacts
  } = useAuth();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editTripId, setEditTripId] = useState<string | null>(null);

  const [newDestination, setNewDestination] = useState('');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date(Date.now() + 86400000 * 3));

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

  const [selectedPlace, setSelectedPlace] = useState<{ place: PlaceRecommendation, tripId: string } | null>(null);
  const [scheduleDate, setScheduleDate] = useState(new Date());
  const [scheduleTime, setScheduleTime] = useState(new Date());
  const [scheduleInviteContactId, setScheduleInviteContactId] = useState<string | null>(null);

  const [expandedTripIds, setExpandedTripIds] = useState<Set<string>>(new Set());

  // Events live in their own collection now (not embedded in the trip), so each trip's
  // events are fetched separately and kept in local screen state — same pattern the Home
  // tab already uses for its own calendar/weather data.
  const [eventsByTrip, setEventsByTrip] = useState<Record<string, TripEvent[]>>({});
  const [invitedEvents, setInvitedEvents] = useState<TripEvent[]>([]);
  const [showInvitedModal, setShowInvitedModal] = useState(false);

  // "Propose an event" — the blind joint-matching flow: pick a slot + one friend, get
  // suggestions computed from both your tastes without either of you seeing the other's.
  const [proposeTripId, setProposeTripId] = useState<string | null>(null);
  const [proposeTitle, setProposeTitle] = useState('');
  const [proposeDate, setProposeDate] = useState(new Date());
  const [proposeTime, setProposeTime] = useState(new Date());
  const [proposeDuration, setProposeDuration] = useState(90);
  const [proposeContactId, setProposeContactId] = useState<string | null>(null);
  const [proposeStep, setProposeStep] = useState<'form' | 'loading' | 'results'>('form');
  const [proposeEventId, setProposeEventId] = useState<string | null>(null);
  const [proposeResults, setProposeResults] = useState<any[]>([]);

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

  useEffect(() => {
    trips.forEach(t => refreshTripEvents(t.id));
    refreshInvitedEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips]);

  // Fetches "AI Schedule Proposals" recommendations for each currently-visible day's free
  // slots (day 1 always, all days once a trip is expanded), one real API call per slot,
  // cached by key so re-renders and re-expanding an already-loaded trip don't refetch.
  useEffect(() => {
    trips.forEach((trip: TripMock) => {
      const isExpanded = expandedTripIds.has(trip.id);
      const daySchedules = getTripDaySchedule(trip.startDate, trip.endDate, 5, trip.timezone);
      const visibleDays = isExpanded ? daySchedules : daySchedules.slice(0, 1);

      visibleDays.forEach(day => {
        day.freeSlots.forEach(slot => {
          const key = `${trip.id}-${slot.startTime.toISOString()}`;
          if (fetchedSlotKeys.current.has(key)) return;
          fetchedSlotKeys.current.add(key);

          getRecommendations({
            city: trip.destination,
            durationMinutes: slot.durationMinutes,
            startTimeIso: slot.startTime.toISOString(),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips, expandedTripIds]);

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
    resetDestinationLookup();
    setShowCreateModal(true);
  };

  const handleOpenEditTarget = (trip: TripMock) => {
    setEditTripId(trip.id);
    setNewDestination(trip.destination);
    setStartDate(trip.startDate);
    setEndDate(trip.endDate);
    resetDestinationLookup();
    setShowCreateModal(true);
  };

  const handleDeleteTrip = (tripId: string) => {
    setTrips(trips.filter(t => t.id !== tripId));
  };

  const handleSaveTrip = () => {
    if (!newDestination) { alert("Please input a destination city explicitly (e.g. Rome)."); return; }
    if (startDate > endDate) { alert("Start Date must naturally precede the End Date sequentially."); return; }

    if (editTripId) {
      setTrips(trips.map(t => t.id === editTripId ? {
        ...t,
        destination: newDestination,
        startDate: startDate,
        endDate: endDate,
        timezone: guessTimezoneForCity(newDestination)
      } : t));
    } else {
      setTrips([{
        id: Date.now().toString(),
        destination: newDestination,
        startDate: startDate,
        endDate: endDate,
        timezone: guessTimezoneForCity(newDestination)
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
      setSelectedPlace(null);
      setScheduleInviteContactId(null);
    } catch (err: any) {
      alert(err.message || 'Could not add this to your itinerary.');
    }
  };

  const openProposeModal = (tripId: string) => {
    setProposeTripId(tripId);
    setProposeTitle('');
    setProposeDate(new Date());
    setProposeTime(new Date());
    setProposeDuration(90);
    setProposeContactId(null);
    setProposeStep('form');
    setProposeEventId(null);
    setProposeResults([]);
    // A contact linked mid-session (via npm run link-contact) only becomes invite-eligible
    // once refetched — contacts otherwise only sync on login/app-boot.
    refreshContacts();
  };

  const closeProposeModal = () => setProposeTripId(null);

  const handleProposeSubmit = async () => {
    if (!proposeTripId) return;
    if (!proposeTitle.trim()) { alert('Give this a name, e.g. "Dinner".'); return; }
    if (!proposeContactId) { alert('Pick a friend to invite.'); return; }

    const finalStart = new Date(proposeDate);
    finalStart.setHours(proposeTime.getHours(), proposeTime.getMinutes(), 0, 0);
    const finalEnd = new Date(finalStart.getTime() + proposeDuration * 60000);

    setProposeStep('loading');
    try {
      const event = await createEvent(proposeTripId, {
        title: proposeTitle.trim(),
        startTime: finalStart.toISOString(),
        endTime: finalEnd.toISOString(),
        participantContactIds: [proposeContactId]
      });
      setProposeEventId(event._id);
      const recs = await getJointRecommendations(event._id);
      setProposeResults(recs);
      setProposeStep('results');
      await refreshTripEvents(proposeTripId);
    } catch (err: any) {
      alert(err.message || 'Could not propose this event.');
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
      alert('Could not save this place to the event.');
    }
  };

  const handleRespond = async (eventId: string, status: 'accepted' | 'declined') => {
    try {
      await respondToEvent(eventId, status);
      await refreshInvitedEvents();
    } catch {
      alert('Could not send your response.');
    }
  };

  const pendingInviteCount = invitedEvents.filter(e =>
    e.participants.find(p => p.user_id === myUserId)?.status === 'pending'
  ).length;

  const PlaceCard = ({ place, tripId }: { place: PlaceRecommendation, tripId: string }) => (
    <TouchableOpacity style={styles.placeCard} activeOpacity={0.8} onPress={() => { setSelectedPlace({ place, tripId }); refreshContacts(); }}>
      <View style={styles.placeHeader}>
        <Text style={styles.placeName} numberOfLines={1}>{place.name}</Text>
        <View style={styles.badge}><Text style={styles.badgeText}>{place.matchScore > 0 ? `${place.matchScore} tag match` : 'New idea'}</Text></View>
      </View>
      <Text style={styles.placeCategory}>{place.category} • {place.rating} ★</Text>
      <Text style={styles.placeDesc} numberOfLines={2}>{place.description}</Text>
    </TouchableOpacity>
  );

  const ContactPicker = ({ selectedId, onSelect }: { selectedId: string | null, onSelect: (id: string | null) => void }) => (
    eligibleContacts.length === 0 ? (
      <Text style={styles.emptyText}>
        No linked friends yet — invite someone from the Circles tab, and once they join Odys.ai they&apos;ll show up here.
      </Text>
    ) : (
      <View style={{ gap: 10 }}>
        {eligibleContacts.map((c: any) => {
          const selected = selectedId === c.contact_user_id;
          return (
            <TouchableOpacity
              key={c.id}
              style={[styles.eventSelectRow, selected && styles.eventSelectRowActive]}
              onPress={() => onSelect(selected ? null : c.contact_user_id)}
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
            <ThemedText style={styles.subtitle}>Scheduled automated itineraries.</ThemedText>
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
          <Text style={styles.emptyText}>{"You securely haven't populated any trips analytically yet."}</Text>
        ) : (
          trips.map(trip => {
            const totalTripDays = Math.round((trip.endDate.getTime() - trip.startDate.getTime()) / 86400000) + 1;
            const daySchedules = getTripDaySchedule(trip.startDate, trip.endDate, 5, trip.timezone);
            const tripEvents = eventsByTrip[trip.id] || [];

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

                 <TouchableOpacity style={styles.sharedContext} activeOpacity={0.8} onPress={() => openProposeModal(trip.id)}>
                   <Text style={styles.sharedText}>+ Propose an Event with a Friend</Text>
                 </TouchableOpacity>

                 {tripEvents.length > 0 && (
                    <View style={styles.timelineContainer}>
                      <Text style={styles.timelineHeader}>Scheduled Sequence</Text>
                      {tripEvents.map((event) => {
                        const isResolved = !!event.place_name;
                        return (
                          <View key={event._id} style={styles.timelineEventCard}>
                            <View style={[styles.timelineIndicator, !isResolved && styles.timelineIndicatorPending]} />
                            <View style={styles.timelineEventContent}>
                              <Text style={styles.timelineEventTime}>
                                {new Date(event.start_time).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: trip.timezone })}
                              </Text>
                              {isResolved ? (
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
                            {day.freeSlots.map(slot => {
                              const slotKey = `${trip.id}-${slot.startTime.toISOString()}`;
                              const slotRecs = slotRecommendations[slotKey];
                              const icon = day.isWeekend ? '☀️' : slot.label === 'Lunch Break' ? '🍽️' : '🌙';
                              const fmt = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: trip.timezone });
                              return (
                                <View key={slot.startTime.toISOString()} style={styles.slotSection}>
                                  <View style={styles.slotHeaderRow}>
                                    <Text style={styles.slotIcon}>{icon}</Text>
                                    <Text style={styles.slotLabelText}>{slot.label}</Text>
                                    <Text style={styles.slotTimeRange}>{fmt(slot.startTime)} – {fmt(slot.endTime)} · {slot.durationMinutes}min</Text>
                                  </View>
                                  {slotRecs === undefined ? (
                                    <ActivityIndicator size="small" color="#3B82F6" />
                                  ) : slotRecs.length === 0 ? (
                                    <Text style={styles.emptyText}>No places fit this slot yet.</Text>
                                  ) : (
                                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll}>
                                      {slotRecs.slice(0, 4).map(p => (
                                        <PlaceCard key={`${slot.startTime.getTime()}-${p.id}`} place={p} tripId={trip.id} />
                                      ))}
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

                <Text style={styles.inputLabel}>Invite</Text>
                <ContactPicker selectedId={proposeContactId} onSelect={setProposeContactId} />

                <TouchableOpacity style={[styles.submitBtnLarge, { marginTop: 24 }]} onPress={handleProposeSubmit}>
                  <Text style={styles.submitBtnText}>Find Places We&apos;d Both Like</Text>
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
                <Text style={styles.modalSubtitle}>Ranked for both of you — pick one to lock it in.</Text>
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
            <Text style={styles.proposalsHeader}>Chronologize Sequence</Text>

            <Text style={styles.inputLabel}>Date</Text>
            <NativeDatePicker value={scheduleDate} onChange={setScheduleDate} mode="date" format="date" />

            <Text style={styles.inputLabel}>Time</Text>
            <NativeDatePicker value={scheduleTime} onChange={setScheduleTime} mode="time" format="time" />

            <Text style={styles.inputLabel}>Invite someone (optional)</Text>
            <ContactPicker selectedId={scheduleInviteContactId} onSelect={setScheduleInviteContactId} />

            <TouchableOpacity style={[styles.submitBtn, {backgroundColor: '#3B82F6', marginTop: 20}]} onPress={handleAddToItinerary}>
               <Text style={styles.submitBtnText}>Add + Chronologize</Text>
            </TouchableOpacity>
          </View>
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

            <Text style={styles.modalSubtitle}>Ensure recursive mapping natively explicitly systematically comprehensively locally safely.</Text>

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

            <View style={{ marginTop: 24 }}>
              <TouchableOpacity style={styles.submitBtnLarge} onPress={handleSaveTrip}>
                 <Text style={styles.submitBtnText}>{editTripId ? 'Secure Modifiers' : 'Initialize Itinerary'}</Text>
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

  timelineContainer: { backgroundColor: '#1E293B', borderRadius: 20, padding: 20, marginBottom: 24, borderWidth: 1, borderColor: '#334155' },
  timelineHeader: { color: '#10B981', fontSize: 18, fontWeight: '800', marginBottom: 20, textTransform: 'uppercase' },
  timelineEventCard: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  timelineIndicator: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#3B82F6', marginTop: 4, marginRight: 16, shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 6 },
  timelineIndicatorPending: { backgroundColor: '#F59E0B', shadowColor: '#F59E0B' },
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
  badgeText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  placeCategory: { color: '#3B82F6', fontWeight: '700', fontSize: 13, marginBottom: 10 },
  placeDesc: { color: '#94A3B8', fontSize: 14, lineHeight: 22 },

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
