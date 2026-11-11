// Pure mapping from a RevenueCat webhook event to the `User.subscription` update it implies,
// used by POST /api/webhooks/revenuecat (server.ts). The webhook — not anything the client
// reports — is the source of truth for subscription state (docs/monetization-strategy.md's
// "Rough backend sketch"). No DB access here so every event type is unit-testable
// (lib/revenuecat-events.test.ts).
//
// Event reference: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields

import { SubscriptionPlatform, SubscriptionState } from './subscription';

// The single RevenueCat entitlement Odys sells (docs/play-beta-setup.md step 5) — monthly and
// annual are both attached to it.
export const PREMIUM_ENTITLEMENT_ID = 'premium';

export interface RevenueCatEvent {
  id?: string;
  type: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  entitlement_ids?: string[] | null;
  product_id?: string;
  store?: string;
  environment?: string;
  expiration_at_ms?: number | null;
  event_timestamp_ms?: number;
}

// What server.ts persists alongside the user-facing SubscriptionState: provenance (so an admin
// override vs. a real purchase is distinguishable) and the event clock used to drop
// out-of-order deliveries (RevenueCat retries failed deliveries, so an older event can arrive
// after a newer one).
export interface RevenueCatSubscriptionUpdate extends SubscriptionState {
  currentPeriodEnd?: Date;
  source: 'revenuecat';
  productId?: string;
  lastEventAt: Date;
}

export type RevenueCatEventResult =
  | { action: 'update'; subscription: RevenueCatSubscriptionUpdate }
  | { action: 'ignore'; reason: string };

const STORE_TO_PLATFORM: Record<string, SubscriptionPlatform> = {
  PLAY_STORE: 'android',
  APP_STORE: 'ios',
  MAC_APP_STORE: 'ios',
  STRIPE: 'web',
  RC_BILLING: 'web',
  PADDLE: 'web',
};

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

// The app calls Purchases.logIn(<Mongo _id>) (lib/purchases.ts), so app_user_id is normally the
// user's ObjectId. A purchase made before logIn lands on a "$RCAnonymousID:..." id that
// RevenueCat later aliases — check every id the event carries and take the first ObjectId.
export function resolveOdysUserId(event: RevenueCatEvent): string | null {
  const candidates = [event.app_user_id, event.original_app_user_id, ...(event.aliases || [])];
  return candidates.find((id): id is string => typeof id === 'string' && OBJECT_ID_RE.test(id)) ?? null;
}

export function mapRevenueCatEvent(
  event: RevenueCatEvent,
  lastEventAt?: Date | string | null
): RevenueCatEventResult {
  if (!event || typeof event.type !== 'string') {
    return { action: 'ignore', reason: 'malformed event' };
  }
  if (event.type === 'TEST') {
    return { action: 'ignore', reason: 'test event' };
  }
  // Entitlement-less events (e.g. TRANSFER, SUBSCRIBER_ALIAS) and purchases of anything that
  // doesn't unlock Premium don't change subscription state.
  if (!event.entitlement_ids?.includes(PREMIUM_ENTITLEMENT_ID)) {
    return { action: 'ignore', reason: `${event.type} does not concern the ${PREMIUM_ENTITLEMENT_ID} entitlement` };
  }

  const eventAt = new Date(typeof event.event_timestamp_ms === 'number' ? event.event_timestamp_ms : Date.now());
  if (lastEventAt && new Date(lastEventAt).getTime() > eventAt.getTime()) {
    return { action: 'ignore', reason: 'older than the last applied event' };
  }

  const base = {
    source: 'revenuecat' as const,
    platform: event.store ? STORE_TO_PLATFORM[event.store] : undefined,
    productId: event.product_id,
    currentPeriodEnd: typeof event.expiration_at_ms === 'number' ? new Date(event.expiration_at_ms) : undefined,
    lastEventAt: eventAt,
  };

  switch (event.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
    case 'NON_RENEWING_PURCHASE':
    case 'SUBSCRIPTION_EXTENDED':
    case 'TEMPORARY_ENTITLEMENT_GRANT':
      return { action: 'update', subscription: { ...base, tier: 'premium', status: 'active' } };
    case 'BILLING_ISSUE':
      // Store is retrying the charge; keep full access (finalized decision — see
      // docs/monetization-strategy.md). EXPIRATION follows if the retry ultimately fails.
      return { action: 'update', subscription: { ...base, tier: 'premium', status: 'grace_period' } };
    case 'CANCELLATION':
      // Auto-renew off (or a refund, which comes with an expiration at/near now). Access runs
      // until currentPeriodEnd — see isPremiumEntitled in lib/subscription.ts.
      return { action: 'update', subscription: { ...base, tier: 'premium', status: 'canceled' } };
    case 'EXPIRATION':
      return { action: 'update', subscription: { ...base, tier: 'free', status: 'expired' } };
    default:
      // e.g. SUBSCRIPTION_PAUSED (pause starts at period end; EXPIRATION is sent then).
      return { action: 'ignore', reason: `unhandled event type ${event.type}` };
  }
}
