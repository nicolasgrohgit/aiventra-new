import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Pure info/comparison screen — no purchase flow exists yet (no RevenueCat/Play Billing
// wired up), so the "Upgrade" button deliberately doesn't do anything beyond an explanatory
// alert. Figures below are the finalized numbers from docs/monetization-strategy.md's
// "Finalized decisions (2026-09-17)" section — update both together if those ever change.

interface PlanComparisonModalProps {
  visible: boolean;
  close: () => void;
}

interface FeatureRow {
  label: string;
  free: string;
  premium: string;
}

const FEATURE_ROWS: FeatureRow[] = [
  { label: 'Scheduled trips', free: '3 per month', premium: 'Unlimited' },
  { label: 'Blind joint-matching invites', free: 'Capped', premium: 'Unlimited' },
  { label: 'Proactive event alerts', free: '—', premium: 'Included' },
  { label: 'Recommendation search radius', free: 'Standard', premium: 'Priority / expanded' },
  { label: 'Strava / Visorando routes', free: '—', premium: 'First access' },
];

export function PlanComparisonModal({ visible, close }: PlanComparisonModalProps) {
  const insets = useSafeAreaInsets();

  const handleUpgradePress = () => {
    Alert.alert('Coming soon', 'Payments are launching soon — this will let you upgrade directly.');
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={[styles.modalContainer, { paddingTop: insets.top + 16 }]}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Odys.ai Plans</Text>
          <TouchableOpacity onPress={close} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.modalSubtitle}>See what&apos;s included free, and what Premium adds.</Text>

        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.pricingRow}>
            <View style={styles.pricingCard}>
              <Text style={styles.pricingPlan}>Free</Text>
              <Text style={styles.pricingAmount}>$0</Text>
            </View>
            <View style={[styles.pricingCard, styles.pricingCardPremium]}>
              <Text style={[styles.pricingPlan, styles.pricingPlanPremium]}>Premium</Text>
              <Text style={styles.pricingAmount}>$2.99<Text style={styles.pricingUnit}>/mo</Text></Text>
              <Text style={styles.pricingAlt}>or $19.99/yr (~44% off)</Text>
            </View>
          </View>

          <View style={styles.featureTable}>
            <View style={styles.featureHeaderRow}>
              <Text style={[styles.featureLabel, styles.featureHeaderText]}>Feature</Text>
              <Text style={[styles.featureValue, styles.featureHeaderText]}>Free</Text>
              <Text style={[styles.featureValue, styles.featureHeaderText]}>Premium</Text>
            </View>
            {FEATURE_ROWS.map((row) => (
              <View key={row.label} style={styles.featureRow}>
                <Text style={styles.featureLabel}>{row.label}</Text>
                <Text style={styles.featureValue}>{row.free}</Text>
                <Text style={[styles.featureValue, styles.featureValuePremium]}>{row.premium}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.upgradeButton} onPress={handleUpgradePress} activeOpacity={0.7}>
            <Text style={styles.upgradeButtonText}>Upgrade to Premium</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: { flex: 1, backgroundColor: '#0F172A', padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: '#FFF', fontSize: 24, fontWeight: 'bold', flex: 1, paddingRight: 20 },
  closeButton: { padding: 8 },
  closeButtonText: { color: '#3B82F6', fontSize: 16, fontWeight: '600' },
  modalSubtitle: { color: '#94A3B8', fontSize: 15, lineHeight: 22, marginBottom: 24 },

  pricingRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  pricingCard: { flex: 1, backgroundColor: '#1E293B', borderRadius: 16, borderWidth: 1, borderColor: '#334155', padding: 18, alignItems: 'center' },
  pricingCardPremium: { borderColor: '#3B82F6', backgroundColor: 'rgba(59, 130, 246, 0.1)' },
  pricingPlan: { color: '#94A3B8', fontSize: 14, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 },
  pricingPlanPremium: { color: '#93C5FD' },
  pricingAmount: { color: '#F8FAFC', fontSize: 24, fontWeight: '800' },
  pricingUnit: { fontSize: 14, fontWeight: '600', color: '#94A3B8' },
  pricingAlt: { color: '#64748B', fontSize: 12, marginTop: 6, textAlign: 'center' },

  featureTable: { backgroundColor: '#1E293B', borderRadius: 16, borderWidth: 1, borderColor: '#334155', overflow: 'hidden', marginBottom: 28 },
  featureHeaderRow: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#0F172A', borderBottomWidth: 1, borderBottomColor: '#334155' },
  featureHeaderText: { color: '#64748B', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  featureRow: { flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#0F172A', alignItems: 'center' },
  featureLabel: { flex: 2, color: '#E2E8F0', fontSize: 13, fontWeight: '600', paddingRight: 8 },
  featureValue: { flex: 1, color: '#94A3B8', fontSize: 13, textAlign: 'center' },
  featureValuePremium: { color: '#93C5FD', fontWeight: '700' },

  upgradeButton: { backgroundColor: '#1E293B', paddingVertical: 18, borderRadius: 16, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#334155', opacity: 0.5 },
  upgradeButtonText: { color: '#94A3B8', fontSize: 16, fontWeight: '800' },
});
