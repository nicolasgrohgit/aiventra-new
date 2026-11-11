// Pure subscription/entitlement logic shared by the server (lib/trip-quota.ts, the admin
// billing routes in server.ts) and the app (Profile plan card, app/subscription.tsx). No
// Mongoose import on purpose — lib/trip-quota.ts can't be imported client-side because it
// pulls in models/, which is why profile.tsx used to keep its own mirrored copy of
// isPremiumEntitled. This file is the one copy now.

export type SubscriptionTier = 'free' | 'premium';
export type SubscriptionStatus = 'active' | 'grace_period' | 'canceled' | 'expired';
export type SubscriptionPlatform = 'ios' | 'android' | 'web';

export interface SubscriptionState {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  platform?: SubscriptionPlatform;
  currentPeriodEnd?: Date | string;
}

// Full premium access includes the billing-retry grace period (a renewal payment failed but
// Apple/Google are still retrying) — the user must not be downgraded to the free cap just
// because a charge is pending retry. 'canceled' means auto-renew was turned off (that's what a
// Play/RevenueCat CANCELLATION is): the user already paid for the current period, so access
// continues until currentPeriodEnd — a canceled subscription with no/past period end (e.g. an
// admin override) is not entitled. 'expired' is never entitled, even if `tier` is still
// 'premium' (a lapsed subscription whose tier hasn't been reset yet).
export function isPremiumEntitled(
  user: { subscription?: SubscriptionState | null } | null | undefined,
  now: Date = new Date()
): boolean {
  const sub = user?.subscription;
  if (sub?.tier !== 'premium') return false;
  if (sub.status === 'active' || sub.status === 'grace_period') return true;
  if (sub.status === 'canceled' && sub.currentPeriodEnd) {
    return new Date(sub.currentPeriodEnd).getTime() > now.getTime();
  }
  return false;
}

// One bucket per user for the admin billing overview — a missing subscription or tier
// 'free' is always 'free' regardless of status, since status only means something for premium.
export type PlanBucket = 'free' | 'premium' | 'grace_period' | 'canceled' | 'expired';

export function classifySubscription(sub: SubscriptionState | null | undefined): PlanBucket {
  if (!sub || sub.tier !== 'premium') return 'free';
  if (sub.status === 'active') return 'premium';
  return sub.status;
}

export type SubscriptionSummary = Record<PlanBucket, number> & { total: number };

export function summarizeSubscriptions(subs: (SubscriptionState | null | undefined)[]): SubscriptionSummary {
  const summary: SubscriptionSummary = { total: 0, free: 0, premium: 0, grace_period: 0, canceled: 0, expired: 0 };
  for (const sub of subs) {
    summary[classifySubscription(sub)] += 1;
    summary.total += 1;
  }
  return summary;
}

// User-facing status line for the plan card / subscription screen. Dates are returned raw
// (not formatted) so the caller formats them in the device locale.
export function describeSubscription(sub: SubscriptionState | null | undefined, now: Date = new Date()): {
  planName: 'Free' | 'Premium';
  statusLabel: string | null;
  periodEnd: Date | null;
} {
  const periodEnd = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const validPeriodEnd = periodEnd && !isNaN(periodEnd.getTime()) ? periodEnd : null;
  switch (classifySubscription(sub)) {
    case 'premium':
      return { planName: 'Premium', statusLabel: validPeriodEnd ? 'Renews' : null, periodEnd: validPeriodEnd };
    case 'grace_period':
      return { planName: 'Premium', statusLabel: 'Payment issue — update your payment method to keep Premium', periodEnd: validPeriodEnd };
    case 'canceled':
      // Still inside the paid period → still Premium, just not renewing (see isPremiumEntitled).
      if (validPeriodEnd && validPeriodEnd.getTime() > now.getTime()) {
        return { planName: 'Premium', statusLabel: 'Canceled — Premium until', periodEnd: validPeriodEnd };
      }
      return { planName: 'Free', statusLabel: 'Premium canceled', periodEnd: null };
    case 'expired':
      return { planName: 'Free', statusLabel: 'Premium expired', periodEnd: null };
    default:
      return { planName: 'Free', statusLabel: null, periodEnd: null };
  }
}

// Validation for the admin-editable free-tier monthly trip cap. Integer only, and bounded so
// a typo (e.g. 30000) can't silently turn the cap off.
export const MAX_MONTHLY_TRIP_CAP = 100;

export function parseTripCap(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_MONTHLY_TRIP_CAP) return null;
  return n;
}
