import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Linking, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { useAuth } from '@/hooks/useAuth';
import { describeSubscription, isPremiumEntitled } from '@/lib/subscription';
import { PlanComparison } from '@/components/subscription/plan-comparison';

// The user's plan, this month's trip usage, and the free vs. Premium comparison. Opened from
// the Profile plan card. There's no purchase flow yet (RevenueCat/Play Billing not wired), so
// "Upgrade" still just explains that — once RevenueCat lands, this screen is where the
// offerings/purchase/restore calls go, followed by refreshUser() to pick up the
// webhook-updated subscription.

const ANDROID_PACKAGE = Constants.expoConfig?.android?.package;

function formatDate(d: Date | string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function SubscriptionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshUser();
    } finally {
      setRefreshing(false);
    }
  }, [refreshUser]);

  // Fresh on open: plan changes (admin override today, RevenueCat webhook later) happen
  // server-side and are otherwise only picked up at app boot.
  useEffect(() => {
    refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isPremium = isPremiumEntitled(user);
  const { planName, statusLabel, periodEnd } = describeSubscription(user?.subscription);
  const quota = user?.tripQuota;
  const hasQuota = !isPremium && quota && quota.limit !== null;
  const usedRatio = hasQuota ? Math.min(1, quota.used / quota.limit) : 0;

  const handleUpgradePress = () => {
    Alert.alert('Coming soon', 'Payments are launching soon — this will let you upgrade directly.');
  };

  const handleManagePress = () => {
    const url = ANDROID_PACKAGE
      ? `https://play.google.com/store/account/subscriptions?package=${ANDROID_PACKAGE}`
      : 'https://play.google.com/store/account/subscriptions';
    Linking.openURL(url).catch(() => Alert.alert('Could not open Google Play', 'Manage your subscription from the Play Store app.'));
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
          <Text style={styles.backButtonText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Subscription</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#94A3B8" />}
      >
        <View style={[styles.planCard, isPremium && styles.planCardPremium]}>
          <Text style={styles.planEyebrow}>Current plan</Text>
          <Text style={styles.planName}>{planName}</Text>
          {statusLabel ? (
            <Text style={[styles.planStatus, user?.subscription?.status === 'grace_period' && styles.planStatusWarning]}>
              {statusLabel}{periodEnd ? ` ${formatDate(periodEnd)}` : ''}
            </Text>
          ) : null}

          {isPremium ? (
            <Text style={styles.planDetail}>Unlimited trips and every Premium feature.</Text>
          ) : hasQuota ? (
            <View style={styles.usage}>
              <View style={styles.usageLabels}>
                <Text style={styles.usageText}>Trips this month</Text>
                <Text style={styles.usageText}>{quota.used} of {quota.limit}</Text>
              </View>
              <View style={styles.usageTrack}>
                <View style={[styles.usageFill, { width: `${usedRatio * 100}%` }, usedRatio >= 1 && styles.usageFillFull]} />
              </View>
              <Text style={styles.planDetail}>
                {quota.remaining === 0 ? 'Monthly limit reached' : `${quota.remaining} left`}
                {quota.resetsAt ? ` · resets ${formatDate(quota.resetsAt)}` : ''}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Only for an actual Play subscription — an admin-granted Premium has nothing to manage there. */}
        {isPremium && user?.subscription?.platform === 'android' ? (
          <TouchableOpacity style={styles.secondaryButton} onPress={handleManagePress} activeOpacity={0.7}>
            <Text style={styles.secondaryButtonText}>Manage subscription in Google Play</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.sectionTitle}>{isPremium ? "What's included" : 'Compare plans'}</Text>
        <PlanComparison tripCap={quota?.limit ?? null} />

        {!isPremium ? (
          <TouchableOpacity style={styles.upgradeButton} onPress={handleUpgradePress} activeOpacity={0.7}>
            <Text style={styles.upgradeButtonText}>Upgrade to Premium</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A', paddingHorizontal: 20 },
  header: { marginBottom: 20 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 6, marginBottom: 8 },
  backButtonText: { color: '#3B82F6', fontSize: 16, fontWeight: '600' },
  title: { color: '#FFF', fontSize: 28, fontWeight: 'bold' },

  planCard: { backgroundColor: '#1E293B', borderRadius: 20, borderWidth: 1, borderColor: '#334155', padding: 22, marginBottom: 16 },
  planCardPremium: { borderColor: '#3B82F6', backgroundColor: 'rgba(59, 130, 246, 0.1)' },
  planEyebrow: { color: '#64748B', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 },
  planName: { color: '#F8FAFC', fontSize: 26, fontWeight: '800', marginBottom: 4 },
  planStatus: { color: '#94A3B8', fontSize: 14, marginBottom: 8 },
  planStatusWarning: { color: '#FBBF24', fontWeight: '600' },
  planDetail: { color: '#94A3B8', fontSize: 14, lineHeight: 20, marginTop: 8 },

  usage: { marginTop: 12 },
  usageLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  usageText: { color: '#E2E8F0', fontSize: 14, fontWeight: '600' },
  usageTrack: { height: 8, borderRadius: 4, backgroundColor: '#0F172A', overflow: 'hidden' },
  usageFill: { height: 8, borderRadius: 4, backgroundColor: '#3B82F6' },
  usageFillFull: { backgroundColor: '#F87171' },

  secondaryButton: { paddingVertical: 14, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: '#334155', marginBottom: 24 },
  secondaryButtonText: { color: '#3B82F6', fontSize: 15, fontWeight: '700' },

  sectionTitle: { color: '#F8FAFC', fontSize: 18, fontWeight: '700', marginTop: 12, marginBottom: 14 },

  upgradeButton: { backgroundColor: '#1E293B', paddingVertical: 18, borderRadius: 16, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#334155', opacity: 0.5 },
  upgradeButtonText: { color: '#94A3B8', fontSize: 16, fontWeight: '800' },
});
