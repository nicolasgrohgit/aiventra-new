import AppConfig from '../models/AppConfig';
import TripCreationEvent from '../models/TripCreationEvent';
import { IUser } from '../models/User';

// Server-side free-tier trip cap: entitlement logic shared by POST /api/trips (the actual
// gate) and GET /api/users/:id (the tripQuota field the client reads to show "N of M trips
// left" — see app/(tabs)/trips.tsx). One function computes the shape both call, per
// docs/monetization-strategy.md's "Finalized decisions" section, so the two can never drift.

const DEFAULT_MONTHLY_TRIP_CAP = 3;
const CONFIG_KEY = 'freeTierMonthlyTripCap';
const CACHE_TTL_MS = 60_000;

// Module-level cache, not per-request: a config change (via direct Mongo edit or a future
// admin route) takes effect for every request within ~60s, without a redeploy — see the
// "Rough backend sketch"/"Finalized decisions" sections of the doc above. Deliberately simple
// (no invalidation, no pub/sub) — this is a single small server process, not a fleet that
// needs cache coherence across instances.
let cachedCap: { value: number; fetchedAt: number } | null = null;

// Exported for tests / callers that want to force a fresh read (e.g. right after seeding).
export function clearTripCapCache() {
  cachedCap = null;
}

// Seeds the default (3) on first read if no config document exists yet, so this feature works
// out of the box with no manual DB seeding step.
export async function getMonthlyTripCap(): Promise<number> {
  const now = Date.now();
  if (cachedCap && now - cachedCap.fetchedAt < CACHE_TTL_MS) {
    return cachedCap.value;
  }
  let doc = await AppConfig.findOne({ key: CONFIG_KEY });
  if (!doc) {
    doc = await AppConfig.create({ key: CONFIG_KEY, value: DEFAULT_MONTHLY_TRIP_CAP });
  }
  const value = typeof doc.value === 'number' && doc.value > 0 ? doc.value : DEFAULT_MONTHLY_TRIP_CAP;
  cachedCap = { value, fetchedAt: now };
  return value;
}

// Pure — the calendar-month boundaries (not rolling 30 days, per the finalized decisions)
// a given instant falls in, in UTC. Split out so it's directly unit-testable without a
// database (see lib/trip-quota.test.ts).
export function getCurrentMonthBoundaries(now: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

// Full premium access includes the billing-retry grace period (a renewal payment failed but
// Apple/Google are still retrying) — the user must not be downgraded to the free cap just
// because a charge is pending retry. 'canceled'/'expired' fall through to the free cap even
// if `tier` is still 'premium' (e.g. a lapsed subscription whose tier hasn't been reset yet).
export function isPremiumEntitled(user: Pick<IUser, 'subscription'> | null | undefined): boolean {
  const sub = user?.subscription;
  return sub?.tier === 'premium' && (sub.status === 'active' || sub.status === 'grace_period');
}

export interface TripQuota {
  used: number | null;
  limit: number | null;
  remaining: number | null;
  resetsAt: string | null; // ISO date string, or null for premium (no cap)
}

// The one shared computation — call this from both POST /api/trips (to decide whether to
// reject) and GET /api/users/:id (to expose the shape to the client). Premium/grace-period
// users get an all-null shape, clearly distinguishable from a capped free user (used:0 would
// be ambiguous with "free user, hasn't created anything yet").
export async function getTripQuotaForUser(user: Pick<IUser, 'subscription'> & { _id: any }): Promise<TripQuota> {
  if (isPremiumEntitled(user)) {
    return { used: null, limit: null, remaining: null, resetsAt: null };
  }
  const cap = await getMonthlyTripCap();
  const { start, end } = getCurrentMonthBoundaries();
  const used = await TripCreationEvent.countDocuments({
    user_id: user._id,
    createdAt: { $gte: start, $lt: end }
  });
  return {
    used,
    limit: cap,
    remaining: Math.max(0, cap - used),
    resetsAt: end.toISOString()
  };
}
