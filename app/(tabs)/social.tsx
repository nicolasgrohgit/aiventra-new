import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, Text, Platform, Modal, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { ThemedText } from '@/components/themed-text';
import { DEFAULT_CIRCLES, getContactsByCircle, Contact } from '@/lib/contacts';
import { useContacts } from '@/hooks/useContacts';

export default function SocialScreen() {
  const CIRCLE_FILTERS = ['All', ...DEFAULT_CIRCLES];
  const [activeCircle, setActiveCircle] = useState('All');

  const { contacts, setContacts } = useContacts();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

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

  const handleMoveContact = (contactId: string, newCircle: string) => {
    setContacts(contacts.map((c: Contact) =>
      c.id === contactId
        ? { ...c, circleTags: [newCircle] }
        : c
    ));
    setSelectedContact(null);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerTextContainer}>
            <ThemedText style={styles.title}>Your Circles</ThemedText>
            <ThemedText style={styles.subtitle}>Manage privacy and discover nearby friends.</ThemedText>
          </View>
          <TouchableOpacity style={styles.addButton} onPress={() => setShowInviteModal(true)}>
            <Text style={styles.addButtonText}>+</Text>
          </TouchableOpacity>
        </View>

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
                    <Text style={styles.inviteText}>Pending — hasn&apos;t joined yet</Text>
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
            <Text style={styles.sheetTitle}>Move {selectedContact?.name}</Text>
            <Text style={styles.sheetSubtitle}>Assign them to a new Circle privacy tier.</Text>
            
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
                    onPress={() => handleMoveContact(selectedContact!.id, circle)}
                  >
                    <Text style={[styles.sheetOptionText, isCurrent && styles.sheetOptionTextActive]}>
                      {isCurrent ? '✓  ' : ''}{circle}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity onPress={() => setSelectedContact(null)} style={styles.cancelButton}>
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
            <Text style={styles.modalTitle}>Invite a Contact</Text>
            <TouchableOpacity onPress={() => setShowInviteModal(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
          
          <Text style={styles.modalSubtitle}>
            Add someone by email. Once they join Odys.ai, you&apos;ll be able to invite them to shared events.
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
          
          <TouchableOpacity style={styles.submitInviteBtn} onPress={handleSendInvite}>
             <Text style={styles.submitInviteBtnText}>Send Invitation</Text>
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
  actionSheet: { backgroundColor: '#0F172A', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: Platform.OS === 'ios' ? 48 : 24, borderWidth: 1, borderColor: '#1E293B' },
  sheetTitle: { color: '#FFF', fontSize: 22, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  sheetSubtitle: { color: '#94A3B8', fontSize: 15, marginBottom: 28, textAlign: 'center' },
  sheetOptionsBounds: { backgroundColor: '#1E293B', borderRadius: 16, overflow: 'hidden' },
  sheetOption: { paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: '#334155', alignItems: 'center' },
  sheetOptionActive: { backgroundColor: 'rgba(59, 130, 246, 0.15)' },
  sheetOptionText: { color: '#3B82F6', fontSize: 18, fontWeight: '700' },
  sheetOptionTextActive: { color: '#93C5FD' },
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
  submitInviteBtnText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' }
});
