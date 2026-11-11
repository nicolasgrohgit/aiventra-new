import { test, describe } from 'node:test';
import assert from 'node:assert';
import { mapRevenueCatEvent, resolveOdysUserId, RevenueCatEvent } from './revenuecat-events';
import { isPremiumEntitled } from './subscription';

const USER_ID = '66f1c2a9b4e5d6f7a8b9c0d1';
const T0 = Date.parse('2026-11-01T10:00:00Z');
const PERIOD_END = Date.parse('2026-12-01T10:00:00Z');

function event(type: string, overrides: Partial<RevenueCatEvent> = {}): RevenueCatEvent {
  return {
    type,
    app_user_id: USER_ID,
    entitlement_ids: ['premium'],
    product_id: 'premium:monthly',
    store: 'PLAY_STORE',
    expiration_at_ms: PERIOD_END,
    event_timestamp_ms: T0,
    ...overrides,
  };
}

function updated(e: RevenueCatEvent, lastEventAt?: Date) {
  const result = mapRevenueCatEvent(e, lastEventAt);
  assert.equal(result.action, 'update', `expected an update, got ${JSON.stringify(result)}`);
  return (result as Extract<typeof result, { action: 'update' }>).subscription;
}

describe('mapRevenueCatEvent', () => {
  for (const type of ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE']) {
    test(`${type} → active premium with the period end and platform`, () => {
      const sub = updated(event(type));
      assert.equal(sub.tier, 'premium');
      assert.equal(sub.status, 'active');
      assert.equal(sub.platform, 'android');
      assert.equal(sub.productId, 'premium:monthly');
      assert.equal(sub.source, 'revenuecat');
      assert.equal(sub.currentPeriodEnd?.getTime(), PERIOD_END);
      assert.equal(sub.lastEventAt.getTime(), T0);
    });
  }

  test('BILLING_ISSUE → grace_period, still entitled', () => {
    const sub = updated(event('BILLING_ISSUE'));
    assert.equal(sub.status, 'grace_period');
    assert.equal(isPremiumEntitled({ subscription: sub }), true);
  });

  test('CANCELLATION → canceled, entitled until the period end, not after', () => {
    const sub = updated(event('CANCELLATION'));
    assert.equal(sub.status, 'canceled');
    assert.equal(isPremiumEntitled({ subscription: sub }, new Date(T0 + 1000)), true);
    assert.equal(isPremiumEntitled({ subscription: sub }, new Date(PERIOD_END + 1000)), false);
  });

  test('EXPIRATION → free/expired, not entitled', () => {
    const sub = updated(event('EXPIRATION'));
    assert.equal(sub.tier, 'free');
    assert.equal(sub.status, 'expired');
    assert.equal(isPremiumEntitled({ subscription: sub }), false);
  });

  test('ignores an event older than the last applied one (out-of-order retry)', () => {
    const result = mapRevenueCatEvent(event('RENEWAL'), new Date(T0 + 60_000));
    assert.equal(result.action, 'ignore');
  });

  test('applies an event at or after the last applied one', () => {
    updated(event('EXPIRATION'), new Date(T0));
  });

  test('ignores TEST events, other entitlements, and entitlement-less events', () => {
    assert.equal(mapRevenueCatEvent(event('TEST')).action, 'ignore');
    assert.equal(mapRevenueCatEvent(event('INITIAL_PURCHASE', { entitlement_ids: ['other'] })).action, 'ignore');
    assert.equal(mapRevenueCatEvent(event('TRANSFER', { entitlement_ids: null })).action, 'ignore');
  });

  test('ignores unhandled types like SUBSCRIPTION_PAUSED', () => {
    assert.equal(mapRevenueCatEvent(event('SUBSCRIPTION_PAUSED')).action, 'ignore');
  });

  test('maps store to platform; unknown store leaves platform unset', () => {
    assert.equal(updated(event('RENEWAL', { store: 'APP_STORE' })).platform, 'ios');
    assert.equal(updated(event('RENEWAL', { store: 'STRIPE' })).platform, 'web');
    assert.equal(updated(event('RENEWAL', { store: 'SOMETHING_NEW' })).platform, undefined);
  });

  test('a non-renewing purchase with no expiration leaves currentPeriodEnd unset', () => {
    assert.equal(updated(event('NON_RENEWING_PURCHASE', { expiration_at_ms: null })).currentPeriodEnd, undefined);
  });
});

describe('resolveOdysUserId', () => {
  test('uses app_user_id when it is an ObjectId', () => {
    assert.equal(resolveOdysUserId(event('RENEWAL')), USER_ID);
  });

  test('falls back to aliases for a purchase made under an anonymous id', () => {
    assert.equal(
      resolveOdysUserId(event('INITIAL_PURCHASE', { app_user_id: '$RCAnonymousID:abc', original_app_user_id: '$RCAnonymousID:abc', aliases: ['$RCAnonymousID:abc', USER_ID] })),
      USER_ID
    );
  });

  test('null when no id looks like a Mongo ObjectId', () => {
    assert.equal(resolveOdysUserId(event('RENEWAL', { app_user_id: '$RCAnonymousID:abc', aliases: [] })), null);
  });
});
