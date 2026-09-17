// Only the pure parts of lib/trip-quota.ts are exercised here (getCurrentMonthBoundaries,
// isPremiumEntitled) — getMonthlyTripCap/getTripQuotaForUser hit Mongo directly (via
// models/AppConfig, models/TripCreationEvent) and are exercised instead by the live
// end-to-end verification against a real server + Mongo (see CHANGELOG.md entry / commit
// message for this feature), same "DB-touching parts aren't unit tested" split as
// lib/places-population.ts.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { getCurrentMonthBoundaries, isPremiumEntitled } from './trip-quota';

describe('getCurrentMonthBoundaries', () => {
  test('returns the first instant of the current UTC month through the first instant of next month', () => {
    const now = new Date('2026-09-17T14:23:00Z');
    const { start, end } = getCurrentMonthBoundaries(now);
    assert.equal(start.toISOString(), '2026-09-01T00:00:00.000Z');
    assert.equal(end.toISOString(), '2026-10-01T00:00:00.000Z');
  });

  test('rolls over correctly at a year boundary (December -> January)', () => {
    const now = new Date('2026-12-31T23:59:59Z');
    const { start, end } = getCurrentMonthBoundaries(now);
    assert.equal(start.toISOString(), '2026-12-01T00:00:00.000Z');
    assert.equal(end.toISOString(), '2027-01-01T00:00:00.000Z');
  });

  test('a timestamp exactly at the month start is included in that month, not the previous one', () => {
    const now = new Date('2026-03-01T00:00:00Z');
    const { start } = getCurrentMonthBoundaries(now);
    assert.equal(start.toISOString(), now.toISOString());
  });
});

describe('isPremiumEntitled', () => {
  test('false when subscription is missing entirely (default free user)', () => {
    assert.equal(isPremiumEntitled(undefined), false);
    assert.equal(isPremiumEntitled({ subscription: undefined }), false);
  });

  test('true for an active premium subscription', () => {
    assert.equal(isPremiumEntitled({ subscription: { tier: 'premium', status: 'active' } } as any), true);
  });

  test('true during a billing-retry grace period — must not downgrade to the free cap', () => {
    assert.equal(isPremiumEntitled({ subscription: { tier: 'premium', status: 'grace_period' } } as any), true);
  });

  test('false once canceled, even if tier is still premium', () => {
    assert.equal(isPremiumEntitled({ subscription: { tier: 'premium', status: 'canceled' } } as any), false);
  });

  test('false once expired', () => {
    assert.equal(isPremiumEntitled({ subscription: { tier: 'premium', status: 'expired' } } as any), false);
  });

  test('false for a free-tier user regardless of status', () => {
    assert.equal(isPremiumEntitled({ subscription: { tier: 'free', status: 'active' } } as any), false);
  });
});
