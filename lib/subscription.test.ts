import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  isPremiumEntitled,
  classifySubscription,
  summarizeSubscriptions,
  describeSubscription,
  parseTripCap,
  MAX_MONTHLY_TRIP_CAP,
} from './subscription';

describe('isPremiumEntitled', () => {
  test('active and grace_period premium are entitled', () => {
    assert.equal(isPremiumEntitled({ subscription: { tier: 'premium', status: 'active' } }), true);
    assert.equal(isPremiumEntitled({ subscription: { tier: 'premium', status: 'grace_period' } }), true);
  });

  test('canceled/expired premium, free, and missing subscriptions are not', () => {
    assert.equal(isPremiumEntitled({ subscription: { tier: 'premium', status: 'canceled' } }), false);
    assert.equal(isPremiumEntitled({ subscription: { tier: 'premium', status: 'expired' } }), false);
    assert.equal(isPremiumEntitled({ subscription: { tier: 'free', status: 'active' } }), false);
    assert.equal(isPremiumEntitled({}), false);
    assert.equal(isPremiumEntitled(null), false);
  });
});

describe('classifySubscription', () => {
  test('free tier is free regardless of status', () => {
    assert.equal(classifySubscription({ tier: 'free', status: 'expired' }), 'free');
    assert.equal(classifySubscription(undefined), 'free');
  });

  test('premium maps to its status bucket', () => {
    assert.equal(classifySubscription({ tier: 'premium', status: 'active' }), 'premium');
    assert.equal(classifySubscription({ tier: 'premium', status: 'grace_period' }), 'grace_period');
    assert.equal(classifySubscription({ tier: 'premium', status: 'canceled' }), 'canceled');
    assert.equal(classifySubscription({ tier: 'premium', status: 'expired' }), 'expired');
  });
});

describe('summarizeSubscriptions', () => {
  test('counts every user into exactly one bucket', () => {
    const summary = summarizeSubscriptions([
      undefined,
      { tier: 'free', status: 'active' },
      { tier: 'premium', status: 'active' },
      { tier: 'premium', status: 'active' },
      { tier: 'premium', status: 'grace_period' },
      { tier: 'premium', status: 'canceled' },
    ]);
    assert.deepEqual(summary, { total: 6, free: 2, premium: 2, grace_period: 1, canceled: 1, expired: 0 });
  });
});

describe('describeSubscription', () => {
  test('active premium with a period end shows a renewal date', () => {
    const d = describeSubscription({ tier: 'premium', status: 'active', currentPeriodEnd: '2026-11-30T00:00:00Z' });
    assert.equal(d.planName, 'Premium');
    assert.equal(d.statusLabel, 'Renews');
    assert.equal(d.periodEnd?.toISOString(), '2026-11-30T00:00:00.000Z');
  });

  test('active premium without a period end (admin override) has no status line', () => {
    const d = describeSubscription({ tier: 'premium', status: 'active' });
    assert.equal(d.statusLabel, null);
    assert.equal(d.periodEnd, null);
  });

  test('grace period stays Premium but flags the payment issue', () => {
    const d = describeSubscription({ tier: 'premium', status: 'grace_period' });
    assert.equal(d.planName, 'Premium');
    assert.match(d.statusLabel!, /Payment issue/);
  });

  test('canceled/expired premium read as Free (matches the entitlement check)', () => {
    assert.equal(describeSubscription({ tier: 'premium', status: 'canceled' }).planName, 'Free');
    assert.equal(describeSubscription({ tier: 'premium', status: 'expired' }).planName, 'Free');
  });

  test('an invalid date is dropped rather than rendered as "Invalid Date"', () => {
    const d = describeSubscription({ tier: 'premium', status: 'active', currentPeriodEnd: 'not-a-date' });
    assert.equal(d.periodEnd, null);
  });
});

describe('parseTripCap', () => {
  test('accepts integers in range, from numbers or numeric strings', () => {
    assert.equal(parseTripCap(3), 3);
    assert.equal(parseTripCap('5'), 5);
    assert.equal(parseTripCap(MAX_MONTHLY_TRIP_CAP), MAX_MONTHLY_TRIP_CAP);
  });

  test('rejects zero, negatives, fractions, out-of-range and non-numeric input', () => {
    for (const bad of [0, -1, 2.5, MAX_MONTHLY_TRIP_CAP + 1, '', 'abc', null, undefined, '3x']) {
      assert.equal(parseTripCap(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });
});
