import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Linking, RefreshControl, ActivityIndicator } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { useAuth } from '@/hooks/useAuth';
import { describeSubscription, isPremiumEntitled } from '@/lib/subscription';
import { PlanComparison } from '@/components/subscription/plan-comparison';
import { isPurchasesAvailable, getPremiumPackages, purchasePremiumPackage, restorePremiumPurchases } from '@/lib/purchases';

// The user's plan, this month's trip usage, the free vs. Premium comparison, and the purchase
// flow. Opened from the Profile plan card. Purchases go through RevenueCat (lib/purchases.ts);
// the screen then waits for the server to show Premium (set by the RevenueCat webhook) instead
// of trusting the SDK's result. In builds without a RevenueCat key, "Upgrade" falls back to the
// "Coming soon" explanation.

// How long to wait for the webhook to land after a purchase/restore before telling the user
// it's processing — typically a few seconds.
const ENTITLEMENT_POLL_ATTEMPTS = 8;
const ENTITLEMENT_POLL_INTERVAL_MS = 2000;

const ANDROID_PACKAGE = Constants.expoConfig?.android?.package;

function packageLabel(pkg: PurchasesPackage) {
  switch (pkg.packageType) {
    case 'ANNUAL': return { title: 'Annual', suffix: '/year' };
    case 'MONTHLY': return { title: 'Monthly', suffix: '/month' };
    default: return { title: pkg.product.title, suffix: '' };
  }
}

function formatDate(d: Date | string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function SubscriptionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const billingAvailable = isPurchasesAvailable();

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

  useEffect(() => {
    if (!billingAvailable || isPremium) return;
    let cancelled = false;
    setPackagesLoading(true);
    getPremiumPackages()
      .then((pkgs) => { if (!cancelled) setPackages(pkgs); })
      .finally(() => { if (!cancelled) setPackagesLoading(false); });
    return () => { cancelled = true; };
  }, [billingAvailable, isPremium]);

  // Polls the profile until the webhook-updated subscription shows Premium.
  const waitForPremium = async (): Promise<boolean> => {
    for (let i = 0; i < ENTITLEMENT_POLL_ATTEMPTS; i++) {
      const fresh = await refreshUser();
      if (isPremiumEntitled(fresh)) return true;
      await new Promise((resolve) => setTimeout(resolve, ENTITLEMENT_POLL_INTERVAL_MS));
    }
    return false;
  };

  const handleUpgradePress = () => {
    Alert.alert('Coming soon', 'Payments are launching soon — this will let you upgrade directly.');
  };

  const handlePurchase = async (pkg: PurchasesPackage) => {
    setBusy(true);
    try {
      const { outcome, message } = await purchasePremiumPackage(pkg);
      if (outcome === 'cancelled') return;
      if (outcome === 'failed') {
        Alert.alert('Purchase failed', message || 'Something went wrong. You have not been charged.');
        return;
      }
      const active = await waitForPremium();
      Alert.alert(
        active ? 'Welcome to Premium' : 'Purchase received',
        active ? 'Unlimited trips are unlocked.' : "Your purchase went through — Premium will appear here within a minute. Pull down to refresh."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    try {
      const { ok, hasPremium, message } = await restorePremiumPurchases();
      if (!ok) {
        Alert.alert('Restore failed', message || 'Could not reach Google Play. Try again later.');
      } else if (!hasPremium) {
        Alert.alert('Nothing to restore', 'No active Premium subscription was found for this Google account.');
      } else {
        const active = await waitForPremium();
        Alert.alert('Purchases restored', active ? 'Premium is active again.' : 'Premium will appear here within a minute. Pull down to refresh.');
      }
    } finally {
      setBusy(false);
    }
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

        {!isPremium && billingAvailable ? (
          <View>
            {packagesLoading ? <ActivityIndicator color="#94A3B8" style={{ marginVertical: 20 }} /> : null}
            {!packagesLoading && packages.length === 0 ? (
              <Text style={styles.planDetail}>Plans couldn&apos;t be loaded right now. Pull down to try again.</Text>
            ) : null}
            {packages.map((pkg) => {
              const { title, suffix } = packageLabel(pkg);
              return (
                <TouchableOpacity
                  key={pkg.identifier}
                  style={[styles.buyButton, busy && styles.buttonDisabled]}
                  onPress={() => handlePurchase(pkg)}
                  disabled={busy}
                  activeOpacity={0.8}
                >
                  <Text style={styles.buyButtonTitle}>{title}</Text>
                  <Text style={styles.buyButtonPrice}>{pkg.product.priceString}{suffix}</Text>
                </TouchableOpacity>
              );
            })}
            {busy ? <ActivityIndicator color="#94A3B8" style={{ marginVertical: 12 }} /> : null}
            <TouchableOpacity onPress={handleRestore} disabled={busy} style={styles.restoreButton}>
              <Text style={styles.restoreButtonText}>Restore purchases</Text>
            </TouchableOpacity>
            <Text style={styles.legal}>Billed through Google Play. Renews automatically until canceled — cancel anytime in Google Play.</Text>
          </View>
        ) : null}

        {!isPremium && !billingAvailable ? (
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

  buyButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#3B82F6', paddingVertical: 18, paddingHorizontal: 20, borderRadius: 16, marginBottom: 12 },
  buttonDisabled: { opacity: 0.5 },
  buyButtonTitle: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  buyButtonPrice: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  restoreButton: { alignSelf: 'center', paddingVertical: 12 },
  restoreButtonText: { color: '#3B82F6', fontSize: 14, fontWeight: '600' },
  legal: { color: '#64748B', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 4, marginBottom: 20 },

  upgradeButton: { backgroundColor: '#1E293B', paddingVertical: 18, borderRadius: 16, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#334155', opacity: 0.5 },
  upgradeButtonText: { color: '#94A3B8', fontSize: 16, fontWeight: '800' },
});
