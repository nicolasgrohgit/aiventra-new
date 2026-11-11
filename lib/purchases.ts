import { Platform } from 'react-native';
import Purchases, { PurchasesPackage, LOG_LEVEL } from 'react-native-purchases';

// Thin wrapper around RevenueCat's SDK. Inert (every call a no-op / empty result) until
// EXPO_PUBLIC_REVENUECAT_ANDROID_KEY is set in the build env — same "works without the key,
// just does nothing" pattern as lib/google-places-client.ts — so builds without billing set up
// keep the "Coming soon" upgrade path. Android only for now (external beta is Play-only).
//
// The app never decides entitlement from this: a purchase is reported to RevenueCat, which
// webhooks the server (POST /api/webhooks/revenuecat), and the app reads the result back via
// useAuth's refreshUser(). The RevenueCat app user id is the Odys Mongo _id, which is how the
// webhook finds the user.

const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;

let configured = false;
let currentUserId: string | null = null;

export function isPurchasesAvailable(): boolean {
  return Platform.OS === 'android' && !!ANDROID_KEY;
}

// Called on login and on boot with a stored session. Configures once, then switches identity
// with logIn() for later account changes. Never throws — billing being unavailable must not
// break sign-in.
export async function identifyPurchasesUser(userId: string): Promise<void> {
  if (!isPurchasesAvailable() || !userId || userId.startsWith('mock_')) return;
  try {
    if (!configured) {
      if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
      Purchases.configure({ apiKey: ANDROID_KEY!, appUserID: userId });
      configured = true;
    } else if (currentUserId !== userId) {
      await Purchases.logIn(userId);
    }
    currentUserId = userId;
  } catch (err) {
    console.warn('RevenueCat identify failed', err);
  }
}

export async function resetPurchasesUser(): Promise<void> {
  if (!configured || !currentUserId) return;
  try {
    await Purchases.logOut();
  } catch (err) {
    // logOut throws if the current user is already anonymous — nothing to undo.
    console.warn('RevenueCat logOut failed', err);
  }
  currentUserId = null;
}

// The current offering's packages (monthly/annual — docs/play-beta-setup.md step 5), with
// store-localized prices on pkg.product.priceString.
export async function getPremiumPackages(): Promise<PurchasesPackage[]> {
  if (!configured) return [];
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current?.availablePackages ?? [];
  } catch (err) {
    console.warn('RevenueCat getOfferings failed', err);
    return [];
  }
}

export type PurchaseOutcome = 'purchased' | 'cancelled' | 'failed';

export async function purchasePremiumPackage(pkg: PurchasesPackage): Promise<{ outcome: PurchaseOutcome; message?: string }> {
  try {
    await Purchases.purchasePackage(pkg);
    return { outcome: 'purchased' };
  } catch (err: any) {
    if (err?.userCancelled) return { outcome: 'cancelled' };
    return { outcome: 'failed', message: err?.message };
  }
}

// Re-syncs the store's purchases to RevenueCat (new phone / reinstall). RevenueCat then
// webhooks the server like any other event, so callers refresh the profile afterwards rather
// than trusting the returned CustomerInfo.
export async function restorePremiumPurchases(): Promise<{ ok: boolean; hasPremium: boolean; message?: string }> {
  if (!configured) return { ok: false, hasPremium: false, message: 'Billing is not available in this build.' };
  try {
    const info = await Purchases.restorePurchases();
    return { ok: true, hasPremium: !!info.entitlements.active.premium };
  } catch (err: any) {
    return { ok: false, hasPremium: false, message: err?.message };
  }
}
