import React, { useState, useCallback } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, Text, Platform, Modal, TextInput, Alert, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/themed-text';
import { DEFAULT_CIRCLES, getContactsByCircle, Contact } from '@/lib/contacts';
import { useContacts } from '@/hooks/useContacts';
import { useAuth } from '@/hooks/useAuth';
import { useFriendRequests } from '@/hooks/useFriendRequests';
import { useEvents } from '@/hooks/useEvents';
import { darkActionSheetStyle } from '@/components/ui/dark-action-sheet-style';

// Same shape GET /api/friends-nearby returns everywhere it's consumed (see NearbyFriend in
// app/(tabs)/trips.tsx) — duplicated locally rather than shared/exported since it's a small,
// screen-local render shape, not a domain type.
interface NearbyFriend {
  userId: string;
  name: string;
  avatarUrl?: string;
  matches: { type: 'lives_here' | 'visiting'; startDate?: string; endDate?: string }[];
}

const formatShortDate = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function SocialScreen() {
  const CIRCLE_FILTERS = ['All', ...DEFAULT_CIRCLES];
  const [activeCircle, setActiveCircle] = useState('All');

  const { user } = useAuth();
  const { contacts, setContacts, refreshContacts } = useContacts();
  const { sendFriendRequest, fetchIncomingRequests, fetchSentRequests, respondToFriendRequest } = useFriendRequests();
  const { getFriendsNearby } = useEvents();
  const [showInviteModal, setShowInviteModal] = useState(false);
  // 'invite' = existing invite-by-email flow (unlinked, unilateral, stays as-is). 'friend' =
  // new friend-request flow — only works for an email that already has an Odys.ai account,
  // requires the recipient to accept before either side gets a Contact document.
  const [addMode, setAddMode] = useState<'invite' | 'friend'>('invite');
  const [inviteEmail, setInviteEmail] = useState('');
  const [friendCircleTag, setFriendCircleTag] = useState(DEFAULT_CIRCLES[0]);
  const [sendingFriendRequest, setSendingFriendRequest] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  // Incoming/pending friend requests — this app's closest thing to a "notification" today
  // (see the Friend Requests section below): no real push infra, so discoverability comes
  // from polling and re-rendering a visible section/count. Deliberately re-polls on every
  // tab FOCUS (useFocusEffect), not just first mount (a plain useEffect) — tab screens stay
  // mounted in the background when you switch tabs, so a mount-only poll only ever saw a
  // request sent before this screen's very first visit. Live-reported: a request sent from
  // another device only showed up after force-quitting and reopening the app, since that was
  // the only thing that actually remounted this screen.
  const [incomingRequests, setIncomingRequests] = useState<any[]>([]);
  const [sentRequests, setSentRequests] = useState<any[]>([]);
  // The request currently being accepted — drives the circle-picker action sheet below,
  // reusing the same "Move Contact" sheet visual pattern as selectedContact does, but with
  // its own state since it picks a circle_tag for a FriendRequest, not an existing Contact.
  const [respondingRequest, setRespondingRequest] = useState<any | null>(null);

  // "Discover nearby friends" — this tab's own subtitle claims it, but until now the only
  // wiring for GET /api/friends-nearby was trips.tsx, gated behind an open trip. Scoped here
  // to the user's home city with no date range ("right now"), not a specific trip's dates —
  // see docs/circles-feature-proposal.md gap #1. Empty until the user has a homebase (set at
  // onboarding, so this is effectively always populated for a real account) and at least one
  // contact who's pointed a Contact back at them with circle-sharing turned on (server-side,
  // see server.ts's /api/friends-nearby comment) — an empty result is normal, not an error.
  const [nearbyFriends, setNearbyFriends] = useState<NearbyFriend[]>([]);

  const refreshFriendRequests = async () => {
    try {
      const [incoming, sent] = await Promise.all([fetchIncomingRequests(), fetchSentRequests()]);
      setIncomingRequests(incoming);
      setSentRequests(sent);
    } catch (err) {
      console.warn('Failed to load friend requests', err);
    }
  };

  const refreshNearbyFriends = async () => {
    if (!user?.homebase) {
      setNearbyFriends([]);
      return;
    }
    // getFriendsNearby already swallows its own errors down to [] (see hooks/useEvents.tsx) —
    // a failed background discovery fetch shouldn't surface an alert on this tab.
    setNearbyFriends(await getFriendsNearby({ city: user.homebase }));
  };

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      refreshFriendRequests();
      refreshNearbyFriends();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?._id, user?.id, user?.homebase])
  );

  const handleTapNearbyFriend = (friend: NearbyFriend) => {
    const visiting = friend.matches.find(m => m.type === 'visiting');
    const livesHere = friend.matches.some(m => m.type === 'lives_here');
    const detail = visiting?.startDate && visiting?.endDate
      ? `Visiting ${formatShortDate(visiting.startDate)} – ${formatShortDate(visiting.endDate)}`
      : (livesHere ? `Lives in ${user?.homebase || 'your home city'}` : 'Near you right now.');
    Alert.alert(friend.name, detail);
  };

  const displayedContacts = activeCircle === 'All' 
    ? contacts 
    : getContactsByCircle(contacts, activeCircle);

  const handleSendInvite = () => {
    if (!inviteEmail) return;
    // Persisted as a real (but "pending") Contact — not yet linked to an account. There's
    // no auto-linking today: if/when this email signs up, reconciling it to a real
    // contact_user_id is a deliberately separate, not-yet-built pass. Until then this
    // contact is visible but can't be invited to events (see the Trips tab).
    setContacts([...contacts, {
      id: `pending_${Date.now()}`,
      name: inviteEmail,
      email: inviteEmail,
      isAppUser: false,
      circleTags: [],
    }]);
    setInviteEmail('');
    setShowInviteModal(false);
  };

  // Toggle, not replace-on-select: Contact.circleTags is a string[] (lib/contacts.ts,
  // models/Contact.ts) and MOCK_CONTACTS already implies multi-tag is a legitimate shape, but
  // this used to always overwrite with a single-element array, making the UI behave like a
  // radio group despite the model being a set. A colleague who's also a genuine friend
  // couldn't be tagged both "Work" and "Family and Friends" — see gap #3 in
  // docs/circles-feature-proposal.md. The sheet stays open across taps now (see the Done
  // button below) so multiple circles can be picked in one visit; `selectedContact` is kept
  // in sync alongside `contacts` so the ✓ marks re-render immediately.
  const handleToggleContactCircle = (contactId: string, circle: string) => {
    const toggleTags = (tags: string[]) =>
      tags.includes(circle) ? tags.filter(t => t !== circle) : [...tags, circle];

    setContacts(contacts.map((c: Contact) =>
      c.id === contactId ? { ...c, circleTags: toggleTags(c.circleTags) } : c
    ));
    setSelectedContact(prev =>
      prev && prev.id === contactId ? { ...prev, circleTags: toggleTags(prev.circleTags) } : prev
    );
  };

  // Gap #5: the only action on a contact used to be re-circling — no way to actually stop
  // being connected to someone. DELETE /api/contacts/:id already exists and is scoped to
  // owner_user_id (server.ts:1065); hooks/useContacts.tsx's setContacts already calls it
  // whenever its old-vs-new array diff detects a contact dropped from local state, so
  // removing here is just producing that diff — no new API wiring needed. Irreversible, so
  // gated behind a native confirm (matches this app's existing Alert.alert usage elsewhere in
  // this file, e.g. the "Already sent" duplicate-request check).
  const handleRemoveContact = (contact: Contact) => {
    Alert.alert(
      contact.isAppUser ? 'Remove friend?' : 'Remove invite?',
      contact.isAppUser
        ? `${contact.name} will be removed from your Circles. This can't be undone — you'd need to send a new friend request to reconnect.`
        : `The pending invite to ${contact.email || contact.name} will be removed. You can invite them again later if you change your mind.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setContacts(contacts.filter((c: Contact) => c.id !== contact.id));
            setSelectedContact(null);
          }
        }
      ]
    );
  };

  // Gap #4: a pending (invite-by-email) contact was a dead end after the initial invite — no
  // resend, no recovery path. There's no email-sending or invite-token infra anywhere in this
  // backend (confirmed: no nodemailer/sendgrid/etc. in server.ts, no /api/invites route), so a
  // real "resend the original email" isn't a prerequisite that's actually in place — this
  // opens the device's own mail client with the invite re-composed and the recipient
  // pre-filled, using Linking (already part of react-native core, no new dependency), so the
  // user can actually re-send something rather than staring at a static "Pending" label.
  const handleResendInvite = async (contact: Contact) => {
    if (!contact.email) {
      Alert.alert('No email on file', "This contact doesn't have an email address saved, so there's nothing to resend to.");
      return;
    }
    const subject = encodeURIComponent('Join me on Odys.ai');
    const body = encodeURIComponent(
      `Hey! I added you as a contact on Odys.ai so we can plan trips and catch up when we're in the same city. ` +
      `Grab the app and sign up with this email address (${contact.email}) so we're connected.`
    );
    try {
      await Linking.openURL(`mailto:${contact.email}?subject=${subject}&body=${body}`);
    } catch {
      Alert.alert('Could not open email', `No email app is set up on this device. Ask them to sign up with ${contact.email} to connect.`);
    }
  };

  const handleSendFriendRequest = async () => {
    if (!inviteEmail) return;
    // Client-side dedup check using fetchSentRequests's data — the server also blocks this
    // (400 "already have a pending friend request"), but catching it here avoids a round
    // trip and gives a clearer message than a generic error alert.
    const alreadyPending = sentRequests.some(r => (r.to_user_id?.email || '').toLowerCase() === inviteEmail.toLowerCase());
    if (alreadyPending) {
      Alert.alert('Already sent', "You already sent this person a friend request — waiting for them to accept.");
      return;
    }
    setSendingFriendRequest(true);
    try {
      await sendFriendRequest(inviteEmail, friendCircleTag);
      setInviteEmail('');
      setShowInviteModal(false);
      setAddMode('invite');
      await refreshFriendRequests();
      Alert.alert('Request sent', "They'll show up in your Circles once they accept.");
    } catch (err: any) {
      Alert.alert('Could not send request', err?.message || 'Something went wrong.');
    } finally {
      setSendingFriendRequest(false);
    }
  };

  const handleDeclineRequest = async (requestId: string) => {
    try {
      await respondToFriendRequest(requestId, 'declined');
      await refreshFriendRequests();
    } catch {
      Alert.alert('Error', 'Could not decline this request.');
    }
  };

  const handleConfirmAcceptCircle = async (circle: string) => {
    if (!respondingRequest) return;
    try {
      await respondToFriendRequest(respondingRequest._id, 'accepted', circle);
      setRespondingRequest(null);
      await Promise.all([refreshFriendRequests(), refreshContacts()]);
    } catch {
      Alert.alert('Error', 'Could not accept this request.');
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerTextContainer}>
            <ThemedText style={styles.title}>Your Circles</ThemedText>
            <ThemedText style={styles.subtitle}>Manage privacy and discover nearby friends.</ThemedText>
          </View>
          <TouchableOpacity style={styles.addButton} onPress={() => { setAddMode('invite'); setShowInviteModal(true); }}>
            <Text style={styles.addButtonText}>+</Text>
          </TouchableOpacity>
        </View>

        {/* Friend Requests — only rendered when there's something to act on. This plus the
            count badge is the closest thing to a "notification" this build has: no push
            infra, so discoverability relies on the badge being visible the moment this tab
            is opened. See the on-mount poll effect above. */}
        {incomingRequests.length > 0 && (
          <View style={styles.requestsSection}>
            <View style={styles.requestsBadgeRow}>
              <View style={styles.requestsBadge}>
                <Text style={styles.requestsBadgeText}>{incomingRequests.length}</Text>
              </View>
              <Text style={styles.requestsSectionTitle}>
                Friend Request{incomingRequests.length !== 1 ? 's' : ''}
              </Text>
            </View>
            {incomingRequests.map(request => (
              <View key={request._id} style={styles.requestCard}>
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarText}>{(request.from_user_id?.full_name || request.from_user_id?.email || '?').charAt(0)}</Text>
                </View>
                <View style={styles.contactInfo}>
                  <Text style={styles.contactName}>{request.from_user_id?.full_name || request.from_user_id?.email}</Text>
                  <Text style={styles.inviteText}>wants to add you</Text>
                </View>
                <View style={styles.requestActions}>
                  <TouchableOpacity style={styles.acceptBtn} onPress={() => setRespondingRequest(request)}>
                    <Text style={styles.requestActionText}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.declineBtn} onPress={() => handleDeclineRequest(request._id)}>
                    <Text style={styles.requestActionText}>Decline</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Nearby friends — GET /api/friends-nearby, scoped to the user's home city with no
            date range ("right now"), not a specific trip. Circle-scoped and sharer-driven:
            only shows someone if THEY put a Contact pointing back at you under a circle
            THEY'VE separately opted into sharing their homebase/trip with (see the copy fix
            in the Move Contact sheet below). Only rendered when there's a match, same
            convention as trips.tsx's own "Friends nearby" bubbles — an empty result is
            normal, not an error, so there's nothing useful to say in the empty case. */}
        {nearbyFriends.length > 0 && (
          <View style={styles.nearbySection}>
            <Text style={styles.nearbySectionTitle}>
              Near {(user?.homebase || 'you').split(',')[0].trim()} right now
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nearbyRow}>
              {nearbyFriends.map(friend => {
                const livesHere = friend.matches.some(m => m.type === 'lives_here');
                return (
                  <TouchableOpacity
                    key={friend.userId}
                    style={styles.nearbyCard}
                    activeOpacity={0.7}
                    onPress={() => handleTapNearbyFriend(friend)}
                  >
                    <Text style={styles.nearbyCardName}>{friend.name}</Text>
                    <Text style={styles.nearbyCardSub}>{livesHere ? 'Lives here' : 'Visiting'}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillScroller}>
          {CIRCLE_FILTERS.map(circle => (
            <TouchableOpacity 
              key={circle} 
              onPress={() => setActiveCircle(circle)}
              style={[styles.pill, activeCircle === circle && styles.activePill]}
            >
              <Text style={[styles.pillText, activeCircle === circle && styles.activePillText]}>
                {circle}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.contactList}>
          {displayedContacts.map(contact => (
             <TouchableOpacity 
               key={contact.id} 
               style={styles.contactCard}
               activeOpacity={0.7}
               onPress={() => setSelectedContact(contact)}
             >
                <View style={styles.avatarPlaceholder}>
                  {contact.avatarUrl ? (
                     <Image source={{uri: contact.avatarUrl}} style={{width: 50, height: 50, borderRadius: 25}} />
                  ) : (
                     <Text style={styles.avatarText}>{contact.name.charAt(0)}</Text>
                  )}
                </View>
                <View style={styles.contactInfo}>
                  <Text style={styles.contactName}>{contact.name}</Text>
                  {contact.isAppUser ? (
                    <View style={styles.appUserBadge}>
                       <Text style={styles.appUserText}>Odys.ai User</Text>
                    </View>
                  ) : (
                    <Text style={styles.inviteText}>
                      {formatShortDate(contact.createdAt)
                        ? `Pending — invited ${formatShortDate(contact.createdAt)}`
                        : "Pending — hasn't joined yet"}
                    </Text>
                  )}
                </View>
  
                {contact.sharedLocation && (
                  <View style={styles.locationBadge}>
                     <Text style={styles.locationTitle}>Nearby</Text>
                     <Text style={styles.locationText}>{contact.sharedLocation}</Text>
                  </View>
                )}
             </TouchableOpacity>
          ))}
          {displayedContacts.length === 0 && (
            <Text style={styles.emptyText}>{"You haven't added anyone to this circle yet."}</Text>
          )}
        </View>
      </ScrollView>

      {/* Move Contact Modal */}
      <Modal 
        visible={!!selectedContact} 
        animationType="fade" 
        transparent={true}
        onRequestClose={() => setSelectedContact(null)}
      >
        <View style={styles.overlay}>
          <View style={styles.actionSheet}>
            <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetTitle}>{selectedContact?.name}</Text>
            {/* Concrete about the actual mechanism, matching the bar CircleShareSelector sets
                elsewhere (trips.tsx's "Lets people in these circles see you're heading here on
                these dates..."). Direction matters here specifically because it's easy to read
                backwards: filing someone under "Work" doesn't limit what THEY see of YOU — it's
                the other way around, and it's contingent on THEIR own separate opt-in. See gap
                #2 in docs/circles-feature-proposal.md. */}
            <Text style={styles.sheetSubtitle}>
              This is about what you can see of them, not what they can see of you. If
              they&apos;ve separately shared their home city or a trip with a circle you put
              them in here, you&apos;ll see it (like &quot;near you right now&quot;) — it has
              no effect on your own privacy. Tap to toggle — they can be in more than one circle.
            </Text>
            {!selectedContact?.isAppUser && (
              <Text style={styles.sheetPendingNote}>
                They haven&apos;t joined Odys.ai yet, so none of this applies until they do — this just files them for later.
              </Text>
            )}

            <View style={styles.sheetOptionsBounds}>
              {DEFAULT_CIRCLES.map(circle => {
                // The contact's OWN current circle(s), not the page's active filter tab —
                // that was the bug: filtering/highlighting against `activeCircle` meant
                // viewing the default "All" tab (which never equals a real circle name)
                // showed every option with nothing marked as selected, regardless of the
                // contact's actual assignment.
                const isCurrent = !!selectedContact?.circleTags?.includes(circle);
                return (
                  <TouchableOpacity
                    key={circle}
                    style={[styles.sheetOption, isCurrent && styles.sheetOptionActive]}
                    onPress={() => handleToggleContactCircle(selectedContact!.id, circle)}
                  >
                    <Text style={[styles.sheetOptionText, isCurrent && styles.sheetOptionTextActive]}>
                      {isCurrent ? '✓  ' : ''}{circle}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {!selectedContact?.isAppUser && (
              <TouchableOpacity
                onPress={() => selectedContact && handleResendInvite(selectedContact)}
                style={styles.resendButton}
              >
                <Text style={styles.resendButtonText}>Resend Invite</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() => selectedContact && handleRemoveContact(selectedContact)}
              style={styles.removeButton}
            >
              <Text style={styles.removeButtonText}>
                {selectedContact?.isAppUser ? 'Remove Friend' : 'Remove Invite'}
              </Text>
            </TouchableOpacity>
            </ScrollView>

            <TouchableOpacity onPress={() => setSelectedContact(null)} style={styles.sheetCloseButton}>
              <Text style={styles.sheetCloseText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Accept Friend Request — circle picker. Reuses the same action-sheet visual pattern
          (and the same maxHeight/paddingTop/ScrollView-wrap fix) as the Move Contact modal
          above, but drives handleConfirmAcceptCircle instead — this is the recipient's own,
          independent circle_tag choice for the sender (the sender already picked theirs when
          they sent the request). */}
      <Modal
        visible={!!respondingRequest}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setRespondingRequest(null)}
      >
        <View style={styles.overlay}>
          <View style={styles.actionSheet}>
            <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetTitle}>Add {respondingRequest?.from_user_id?.full_name || respondingRequest?.from_user_id?.email}</Text>
            <Text style={styles.sheetSubtitle}>Which circle should they go in?</Text>

            <View style={styles.sheetOptionsBounds}>
              {DEFAULT_CIRCLES.map(circle => (
                <TouchableOpacity
                  key={circle}
                  style={styles.sheetOption}
                  onPress={() => handleConfirmAcceptCircle(circle)}
                >
                  <Text style={styles.sheetOptionText}>{circle}</Text>
                </TouchableOpacity>
              ))}
            </View>
            </ScrollView>

            <TouchableOpacity onPress={() => setRespondingRequest(null)} style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Invite Modal */}
      <Modal 
        visible={showInviteModal} 
        animationType="slide" 
        presentationStyle="pageSheet"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{addMode === 'invite' ? 'Invite a Contact' : 'Add a Friend'}</Text>
            <TouchableOpacity onPress={() => setShowInviteModal(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>

          {/* Two distinct flows, deliberately not merged: "Invite" creates an unlinked,
              unilateral Contact for someone who hasn't joined Odys.ai yet (unchanged from
              before). "Add Friend" sends a real friend request to someone who already has an
              account — it only becomes a Contact (for both sides) once they accept. */}
          <View style={styles.modeToggleRow}>
            <TouchableOpacity
              style={[styles.modeToggleBtn, addMode === 'invite' && styles.modeToggleBtnActive]}
              onPress={() => setAddMode('invite')}
            >
              <Text style={[styles.modeToggleText, addMode === 'invite' && styles.modeToggleTextActive]}>Invite by Email</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeToggleBtn, addMode === 'friend' && styles.modeToggleBtnActive]}
              onPress={() => setAddMode('friend')}
            >
              <Text style={[styles.modeToggleText, addMode === 'friend' && styles.modeToggleTextActive]}>Add Friend</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.modalSubtitle}>
            {addMode === 'invite'
              ? "Add someone by email. Once they join Odys.ai, you'll be able to invite them to shared events."
              : "Send a friend request to someone who's already on Odys.ai. They'll need to accept before you show up in each other's Circles."}
          </Text>

          <Text style={styles.inputLabel}>Email Address</Text>
          <TextInput
            style={styles.textInput}
            placeholder="friend@example.com"
            placeholderTextColor="#64748B"
            keyboardType="email-address"
            autoCapitalize="none"
            value={inviteEmail}
            onChangeText={setInviteEmail}
          />

          {addMode === 'friend' && (
            <>
              <Text style={styles.inputLabel}>File them under</Text>
              <View style={[styles.pillScroller, { marginBottom: 32 }]}>
                {DEFAULT_CIRCLES.map(circle => (
                  <TouchableOpacity
                    key={circle}
                    onPress={() => setFriendCircleTag(circle)}
                    style={[styles.pill, friendCircleTag === circle && styles.activePill]}
                  >
                    <Text style={[styles.pillText, friendCircleTag === circle && styles.activePillText]}>{circle}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <TouchableOpacity
            style={styles.submitInviteBtn}
            onPress={addMode === 'invite' ? handleSendInvite : handleSendFriendRequest}
            disabled={sendingFriendRequest}
          >
             <Text style={styles.submitInviteBtnText}>
               {addMode === 'invite' ? 'Send Invitation' : (sendingFriendRequest ? 'Sending…' : 'Send Friend Request')}
             </Text>
          </TouchableOpacity>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scrollContent: { padding: 24, paddingTop: Platform.OS === 'ios' ? 60 : 60, paddingBottom: 100 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32, marginTop: 10 },
  headerTextContainer: { flex: 1, paddingRight: 16 },
  title: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', marginBottom: 8 },
  subtitle: { color: '#94A3B8', fontSize: 16 },
  addButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#3B82F6', justifyContent: 'center', alignItems: 'center', shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 5 },
  addButtonText: { color: '#FFFFFF', fontSize: 28, fontWeight: '400', lineHeight: 30, marginTop: Platform.OS === 'ios' ? -2 : 0 },
  // Reuses the app's existing #3B82F6 accent (already used for locationBadge below) rather
  // than trips.tsx's green nearby-bubble treatment, so "near me" reads as this screen's own
  // visual language rather than importing trips.tsx's.
  nearbySection: { marginBottom: 32 },
  nearbySectionTitle: { color: '#94A3B8', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', marginBottom: 12, letterSpacing: 0.5 },
  nearbyRow: { flexDirection: 'row', gap: 10 },
  nearbyCard: { backgroundColor: 'rgba(59, 130, 246, 0.12)', borderWidth: 1, borderColor: '#3B82F6', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 },
  nearbyCardName: { color: '#93C5FD', fontWeight: '800', fontSize: 14 },
  nearbyCardSub: { color: '#60A5FA', fontSize: 11, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.3 },
  pillScroller: { flexDirection: 'row', marginBottom: 32, maxHeight: 50 },
  pill: { paddingHorizontal: 20, height: 40, borderRadius: 20, backgroundColor: '#1E293B', marginRight: 12, borderWidth: 1, borderColor: '#334155', justifyContent: 'center' },
  activePill: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  pillText: { color: '#94A3B8', fontWeight: '600', fontSize: 14 },
  activePillText: { color: '#FFFFFF' },
  contactList: { gap: 16 },
  contactCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#1E293B' },
  avatarPlaceholder: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#3B82F6', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  avatarText: { color: '#FFFFFF', fontSize: 20, fontWeight: 'bold' },
  contactInfo: { flex: 1 },
  contactName: { color: '#F8FAFC', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  appUserBadge: { backgroundColor: 'rgba(16, 185, 129, 0.2)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  appUserText: { color: '#10B981', fontSize: 11, fontWeight: 'bold' },
  inviteText: { color: '#64748B', fontSize: 13, marginTop: 4 },
  locationBadge: { backgroundColor: 'rgba(59, 130, 246, 0.15)', padding: 12, paddingVertical: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 3, borderLeftColor: '#3B82F6', marginLeft: 12 },
  locationTitle: { color: '#3B82F6', fontSize: 11, fontWeight: '800', marginBottom: 2, textTransform: 'uppercase' },
  locationText: { color: '#DBEAFE', fontSize: 12, fontWeight: '600' },
  emptyText: { color: '#64748B', fontStyle: 'italic', textAlign: 'center', marginTop: 20 },
  
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  // Value now lives in components/ui/dark-action-sheet-style.ts (was byte-for-byte duplicated
  // with trips.tsx's `darkActionSheet` — see CHANGELOG.md's cleanliness-audit entry).
  actionSheet: darkActionSheetStyle,
  sheetTitle: { color: '#FFF', fontSize: 22, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  sheetSubtitle: { color: '#94A3B8', fontSize: 15, marginBottom: 28, textAlign: 'center' },
  sheetOptionsBounds: { backgroundColor: '#1E293B', borderRadius: 16, overflow: 'hidden' },
  sheetOption: { paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: '#334155', alignItems: 'center' },
  sheetOptionActive: { backgroundColor: 'rgba(59, 130, 246, 0.15)' },
  sheetOptionText: { color: '#3B82F6', fontSize: 18, fontWeight: '700' },
  sheetOptionTextActive: { color: '#93C5FD' },
  sheetPendingNote: { color: '#64748B', fontSize: 12, marginTop: -14, marginBottom: 20, textAlign: 'center', lineHeight: 17, fontStyle: 'italic' },
  // Distinct from cancelButton/cancelText (still used by the Accept Friend Request sheet
  // below, which really is a cancel) — circle toggles and the resend/remove actions in this
  // sheet apply immediately as they're tapped, same live-apply pattern as
  // CircleShareSelector's onToggle in profile.tsx, so "Cancel" would be misleading here:
  // there's nothing left to cancel by the time this button is visible.
  sheetCloseButton: { marginTop: 16, paddingVertical: 18, borderRadius: 16, backgroundColor: '#1E293B', alignItems: 'center' },
  sheetCloseText: { color: '#94A3B8', fontSize: 18, fontWeight: '800' },
  resendButton: { marginTop: 20, paddingVertical: 16, borderRadius: 16, backgroundColor: 'rgba(59, 130, 246, 0.12)', borderWidth: 1, borderColor: '#3B82F6', alignItems: 'center' },
  resendButtonText: { color: '#3B82F6', fontSize: 16, fontWeight: '800' },
  removeButton: { marginTop: 12, paddingVertical: 16, borderRadius: 16, backgroundColor: 'rgba(239, 68, 68, 0.12)', borderWidth: 1, borderColor: '#EF4444', alignItems: 'center' },
  removeButtonText: { color: '#EF4444', fontSize: 16, fontWeight: '800' },
  cancelButton: { marginTop: 16, paddingVertical: 18, borderRadius: 16, backgroundColor: '#1E293B', alignItems: 'center' },
  cancelText: { color: '#EF4444', fontSize: 18, fontWeight: '800' },

  modalContainer: { flex: 1, backgroundColor: '#0F172A', padding: 24, paddingTop: Platform.OS === 'ios' ? 40 : 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: '#FFF', fontSize: 24, fontWeight: 'bold' },
  closeButton: { padding: 8 },
  closeButtonText: { color: '#3B82F6', fontSize: 16, fontWeight: '600' },
  modalSubtitle: { color: '#94A3B8', fontSize: 15, lineHeight: 22, marginBottom: 32 },
  inputLabel: { color: '#E2E8F0', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  textInput: { backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155', borderRadius: 12, padding: 16, color: '#FFF', fontSize: 16, marginBottom: 32 },
  submitInviteBtn: { backgroundColor: '#10B981', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  submitInviteBtnText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },

  modeToggleRow: { flexDirection: 'row', backgroundColor: '#1E293B', borderRadius: 12, padding: 4, marginBottom: 24 },
  modeToggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  modeToggleBtnActive: { backgroundColor: '#3B82F6' },
  modeToggleText: { color: '#94A3B8', fontWeight: '600', fontSize: 14 },
  modeToggleTextActive: { color: '#FFFFFF' },

  requestsSection: { marginBottom: 32 },
  requestsBadgeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  requestsBadge: { backgroundColor: '#EF4444', minWidth: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 },
  requestsBadgeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  requestsSectionTitle: { color: '#F8FAFC', fontSize: 18, fontWeight: '800' },
  requestCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#1E293B', marginBottom: 12 },
  requestActions: { gap: 8 },
  acceptBtn: { backgroundColor: '#10B981', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  declineBtn: { backgroundColor: '#334155', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  requestActionText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', textAlign: 'center' }
});
