import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Free vs. Premium pricing + feature table, used by app/subscription.tsx. Figures are the
// finalized numbers from docs/monetization-strategy.md's "Finalized decisions (2026-09-17)"
// section — update both together if those ever change. The free trip cap shown here comes
// from the server (tripCap prop) rather than being hardcoded, since it's admin-editable.

interface FeatureRow {
  label: string;
  free: string;
  premium: string;
}

function featureRows(tripCap: number | null): FeatureRow[] {
  return [
    { label: 'Scheduled trips', free: tripCap ? `${tripCap} per month` : 'Capped', premium: 'Unlimited' },
    { label: 'Blind joint-matching invites', free: 'Capped', premium: 'Unlimited' },
    { label: 'Proactive event alerts', free: '—', premium: 'Included' },
    { label: 'Recommendation search radius', free: 'Standard', premium: 'Priority / expanded' },
    { label: 'Strava / Visorando routes', free: '—', premium: 'First access' },
  ];
}

export function PlanComparison({ tripCap }: { tripCap: number | null }) {
  return (
    <>
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
        {featureRows(tripCap).map((row) => (
          <View key={row.label} style={styles.featureRow}>
            <Text style={styles.featureLabel}>{row.label}</Text>
            <Text style={styles.featureValue}>{row.free}</Text>
            <Text style={[styles.featureValue, styles.featureValuePremium]}>{row.premium}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
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
});
