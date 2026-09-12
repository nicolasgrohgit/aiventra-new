import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import pinoHttp from 'pino-http';
import * as Sentry from '@sentry/node';
import connectToDatabase from './lib/mongodb';
import {
  isMealWindow, flattenPreferenceTags, buildCityDurationMatchStage, buildCityDurationQuery,
  buildGeoNearStage, resolveAnchorForDate, escapeRegExp, cityNeedle, tieredShuffle,
  SOURCE_RANK_BONUS, DEFAULT_MAX_DISTANCE_KM, resolveSearchRadiusKm, GeoPoint
} from './lib/place-matching';
import { guessTimezoneForCity } from './lib/timezones';
import { encryptWithKey, decryptWithKey, isEncryptedValue } from './lib/field-encryption';
import { getOrCreateUserDataKey, getUserDataKeyIfExists } from './lib/user-data-key';
import User from './models/User';
import Trip from './models/Trip';
import Contact from './models/Contact';
import Event, { PopulatedEventCreator } from './models/Event';
import FriendRequest from './models/FriendRequest';
import Place from './models/Place';
import Suggestion from './models/Suggestion';
import { ensurePlacesForCity, refreshNearbyPlacesLive } from './lib/places-population';
import { searchCities } from './lib/geocoding';
import { sendPushNotification } from './lib/push-notifications';
import { sendMail } from './lib/mailer';

dotenv.config({ quiet: true });

// Error tracking is fully wired below but stays completely inert (no init, no network
// calls, zero cost) until SENTRY_DSN is set — free-tier Sentry account is a two-minute
// signup whenever you're ready to turn it on.
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
}

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required to start the server.');
}

const app = express();
const port = process.env.PORT || 3000;

// Cheap insurance across the whole app — generous enough to never bother a real client,
// there specifically to blunt scripted abuse now that the app is reachable over the public
// beta tunnel, not just localhost. The two concrete enumeration/brute-force vectors from the
// security audit (POST /api/auth/login handing out a session from an email alone with no
// password, and POST /api/friend-requests distinguishing "no account" via a 404) get their
// own much stricter limiter below, applied on top of this one.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(globalLimiter);

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

app.use(cors());
app.use(express.json());
// Local-only admin tool for curating vetted places (see /admin/api/places below). Was
// "no auth by design" — that assumption didn't survive the beta tunnel making this
// internet-reachable; the /admin/api/places routes below now require ADMIN_TOKEN (see
// requireAdminToken). admin.html itself still can't be gated at this express.static level
// without restructuring, but it's inert without a valid token either way now that the API
// routes it calls are locked down — it prompts for the token client-side and sends it as a
// header on every admin API call it makes.
app.use(express.static('public'));
app.use(pinoHttp({
  logger,
  // Attaches userId to the request log once auth middleware has run, so every log line
  // for an authenticated request is traceable back to who made it.
  customProps: (req) => ({ userId: (req as AuthedRequest).userId })
}));

// Initialize MongoDB connection
connectToDatabase()
  .then(() => logger.info('Connected to MongoDB database successfully.'))
  .catch((err) => logger.error({ err }, 'MongoDB connection error'));

// Every protected route trusts req.userId (set here from a verified token) instead of
// any userId a client sends in a query string or body — that's what actually stops one
// user from reading/writing another user's data by just changing an id.
interface AuthedRequest extends express.Request {
  userId?: string;
}

function authenticate(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing authentication token' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET as string) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

// Shared-secret gate for the /admin/api/places routes (see the express.static comment above).
// Deliberately not JWT/`authenticate` — this is a single ops tool for curating vetted places,
// not a per-user resource, so a single shared token compared header-to-env-var is the right
// weight of protection, not a second full auth system. `admin.html`'s own JS prompts for this
// token and echoes it back on every admin API call (see public/admin.html) — this is what
// actually stops that page from being useful to anyone who doesn't have the token, since the
// page itself can't be gated at the express.static level without restructuring.
function requireAdminToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!ADMIN_TOKEN) {
    // Fails closed, not open: an unset ADMIN_TOKEN disables the admin API entirely rather
    // than falling back to "no check" (which is exactly the bug this middleware exists to fix).
    return res.status(503).json({ error: 'Admin API is disabled: ADMIN_TOKEN is not configured on the server.' });
  }
  const provided = req.headers['x-admin-token'];
  if (provided !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Invalid or missing admin token' });
  }
  next();
}

// Routes catch and respond to their own errors (rather than calling next(err)), so
// Express's default/Sentry error-handling middleware never sees them — this is what
// actually gets a 500 into the logs and into Sentry (when configured) instead of vanishing.
function reportError(err: unknown, req: AuthedRequest, message: string) {
  req.log.error({ err }, message);
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
}

// Places carry `photoRef` (a Google Photo resource name, e.g. "places/xxx/photos/yyy") through
// the aggregation project stages above so GET /api/places/:id/photo below can look it up — but
// the raw resource name has no legitimate client use (only "does a photo exist, so is it worth
// requesting the proxy thumbnail" does), so this is the one place it gets collapsed to a
// boolean before crossing the wire, on every recommendation response.
function stripPhotoRef(places: any[]): any[] {
  return places.map((p: any) => {
    const { photoRef, ...rest } = p.toObject ? p.toObject() : p;
    return { ...rest, hasPhoto: !!photoRef };
  });
}

app.get('/health', (_req: express.Request, res: express.Response) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// REST API Endpoints

// 1. Auth & Profiles
app.post('/api/auth/login', strictLimiter, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { email, name, firstName, lastName, dob, homebase, avatarUrl, preferences } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    let user = await User.findOne({ email });
    const isNewUser = !user;
    if (!user) {
      // Create user with provided details or default values
      user = await User.create({
        email,
        full_name: name || `${firstName || ''} ${lastName || ''}`.trim(),
        avatar_url: avatarUrl || `https://i.pravatar.cc/150?u=${email}`,
        homebase: homebase || 'New York, USA',
        preferences: preferences || {
          budget: '30-50',
          currency: 'USD',
          dateFormat: 'MM/DD/YYYY',
          activityLevel: 'Medium',
          dietary: [],
          foodGenres: ['Italian', 'French'],
          activityGenres: ['Walking Tours', 'Museums'],
          eventGenres: ['Concerts', 'Comedy Shows']
        },
        // Save other custom fields since strict: false is active
        firstName: firstName || name?.split(' ')[0] || '',
        lastName: lastName || name?.split(' ')[1] || '',
        dob: dob || '1990-01-01'
      });
    }
    const token = jwt.sign({ userId: user._id.toString() }, JWT_SECRET as string, { expiresIn: '30d' });
    req.log.info({ event: 'user_login', userId: user._id.toString(), isNewUser }, 'user login');
    res.json({ user, token });
  } catch (error: any) {
    reportError(error, req, 'login failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/users/:id', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    if (req.params.id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error: any) {
    reportError(error, req, 'get user failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Explicit allowlist, not `$set: req.body` — the schema is `strict: false` (see
// models/User.ts) specifically to allow ad hoc top-level fields like firstName/homebase, which
// means an unfiltered $set would let a client set ANY top-level field on their own account,
// including ones that don't exist yet (a real privilege-escalation vector the moment a role/
// isAdmin-type field is ever added). Covers every field the real client callers actually send
// (verified against hooks/useAuth.tsx's completeOnboarding/updatePreferences/updateUser and
// every updateUser(...) call site in app/onboarding.tsx and app/(tabs)/profile.tsx): profile
// edits (firstName, lastName, email, dob, name, homebase), the homebase-sharing toggle
// (homebaseSharedCircles), the avatar picker (avatarUrl — a client-side base64 data URI, see
// lib/avatar.ts, deliberately camelCase and distinct from the snake_case `avatar_url` set at
// account creation in POST /api/auth/login), and preferences (onboarding + the Profile tab's
// preference pills). Mirrors the same explicit-allowlist pattern already used in
// POST /api/trips / PUT /api/trips/:id above.
const USER_UPDATABLE_FIELDS = [
  'firstName', 'lastName', 'email', 'name', 'dob', 'homebase',
  'homebaseSharedCircles', 'avatarUrl', 'preferences'
] as const;

app.put('/api/users/:id', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    if (req.params.id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const updateData: Record<string, any> = {};
    for (const field of USER_UPDATABLE_FIELDS) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error: any) {
    reportError(error, req, 'update user failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Stores this user's Expo push token (see lib/push-token.ts client-side, lib/push-
// notifications.ts server-side). Deliberately its own endpoint rather than folded into PUT
// /api/users/:id above — that route does an unscoped `$set: req.body` against a
// strict:false schema (flagged in this changelog's security audit as needing a field
// allowlist) and is being locked down independently elsewhere; adding push-token storage
// here instead avoids touching it. Scoped to req.userId (never a client-supplied id), same
// as every other authenticated route in this file.
app.post('/api/users/me/push-token', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token is required' });
    }
    await User.findByIdAndUpdate(req.userId, { $set: { expoPushToken: token } });
    res.json({ success: true });
  } catch (error: any) {
    reportError(error, req, 'save push token failed');
    res.status(500).json({ error: error.message });
  }
});

// Bumps this user's lastAppAccess counter (see models/User.ts, docs/auto-trip-discovery-plan.md
// Part B) — called from the first-calendar-permission-grant path and, when it decides to
// actually scan, the ~weekly foreground-gated path (both in app/(tabs)/index.tsx). Same
// "deliberately its own endpoint, not folded into PUT /api/users/:id" reasoning as
// POST /api/users/me/push-token above: lastAppAccess is a server-observed fact, never a
// client-editable preference, so it must never go through USER_UPDATABLE_FIELDS. Scoped to
// req.userId (never a client-supplied id), same as every other authenticated route here.
app.post('/api/users/me/app-access', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const lastAppAccess = new Date();
    await User.findByIdAndUpdate(req.userId, { $set: { lastAppAccess } });
    res.json({ success: true, lastAppAccess });
  } catch (error: any) {
    reportError(error, req, 'save app access timestamp failed');
    res.status(500).json({ error: error.message });
  }
});

// Validates + converts the client's baseLocations payload (date strings) into the shape
// Trip.baseLocations expects — never throws on malformed input, just drops invalid entries,
// since a bad anchor point should degrade to "no anchor for this trip" (the existing
// static-distanceKm fallback), not fail the whole trip create/update.
function parseBaseLocations(raw: any): any[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(b => b && typeof b.lat === 'number' && typeof b.lng === 'number'
      && (b.source === 'hotel' || b.source === 'city') && b.startDate && b.endDate)
    .map(b => ({
      label: typeof b.label === 'string' ? b.label : '',
      lat: b.lat,
      lng: b.lng,
      source: b.source,
      startDate: new Date(b.startDate),
      endDate: new Date(b.endDate)
    }));
}

// 2. Trips
app.get('/api/trips', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const trips = await Trip.find({ user_id: req.userId });
    res.json(trips);
  } catch (error: any) {
    reportError(error, req, 'list trips failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/trips', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { destination, startDate, endDate, timezone, sharedWithCircles, baseLocations } = req.body;
    if (!destination || !startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const trip = await Trip.create({
      user_id: req.userId,
      destination,
      start_date: new Date(startDate),
      end_date: new Date(endDate),
      timezone,
      sharedWithCircles: sharedWithCircles || [],
      baseLocations: parseBaseLocations(baseLocations)
    });
    // Best-effort: a thin/uncovered destination shouldn't block trip creation, just miss
    // out on having candidate places ready until the next trip to that city tries again.
    await ensurePlacesForCity(destination).catch((err) => req.log.warn({ err }, 'places population failed'));
    req.log.info({ event: 'trip_created', userId: req.userId, tripId: trip._id.toString(), destination }, 'trip created');
    res.json(trip);
  } catch (error: any) {
    reportError(error, req, 'create trip failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/trips/:id', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { destination, startDate, endDate, timezone, sharedWithCircles, baseLocations } = req.body;
    const updateData: any = {};
    if (destination !== undefined) updateData.destination = destination;
    if (startDate !== undefined) updateData.start_date = new Date(startDate);
    if (endDate !== undefined) updateData.end_date = new Date(endDate);
    if (timezone !== undefined) updateData.timezone = timezone;
    if (sharedWithCircles !== undefined) updateData.sharedWithCircles = sharedWithCircles;
    if (baseLocations !== undefined) updateData.baseLocations = parseBaseLocations(baseLocations);

    // Scoping the query to user_id (not just _id) is what stops one authenticated
    // user from updating another user's trip by guessing/enumerating its id.
    const trip = await Trip.findOneAndUpdate(
      { _id: req.params.id, user_id: req.userId },
      { $set: updateData },
      { new: true }
    );
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    res.json(trip);
  } catch (error: any) {
    reportError(error, req, 'update trip failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/trips/:id', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const trip = await Trip.findOneAndDelete({ _id: req.params.id, user_id: req.userId });
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    // Events belong to the trip via trip_id (not embedded) — deleting the trip
    // doesn't cascade automatically, so clean up orphaned events explicitly.
    await Event.deleteMany({ trip_id: trip._id });
    // A participant's "shadow" trip (Trip.linkedTripId, see PUT /api/events/:id/respond)
    // mirrors this trip but has no other tie to it — without this, deleting the organizer's
    // trip leaves the participant with a permanently empty trip pointing at a now-404ing id.
    await Trip.deleteMany({ linkedTripId: trip._id });
    res.json({ success: true, message: 'Trip deleted successfully' });
  } catch (error: any) {
    reportError(error, req, 'delete trip failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// AI Schedule Proposals slots the user has explicitly hidden as not applicable (trips.tsx's
// per-slot "✕" control) — a pure display filter, not a data deletion, hence the symmetric
// add/remove pair rather than a single destructive action. slotKey matches the identifier
// shape trips.tsx already uses to cache recommendations per proposal
// (`${proposal.startTime.toISOString()}-${proposal.type}`).
app.post('/api/trips/:tripId/dismissed-slots', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { slotKey } = req.body;
    if (!slotKey || typeof slotKey !== 'string') {
      return res.status(400).json({ error: 'slotKey is required' });
    }
    const trip = await Trip.findOneAndUpdate(
      { _id: req.params.tripId, user_id: req.userId },
      { $addToSet: { dismissedSlots: slotKey } },
      { new: true }
    );
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    res.json({ dismissedSlots: trip.dismissedSlots });
  } catch (error: any) {
    reportError(error, req, 'dismiss slot failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/trips/:tripId/dismissed-slots/:slotKey', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const trip = await Trip.findOneAndUpdate(
      { _id: req.params.tripId, user_id: req.userId },
      { $pull: { dismissedSlots: req.params.slotKey } },
      { new: true }
    );
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    res.json({ dismissedSlots: trip.dismissedSlots });
  } catch (error: any) {
    reportError(error, req, 'restore dismissed slot failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Friend discovery for trip planning — sharer-driven, not symmetric: whether I can see
// someone's shared presence depends on THEIR contact list (do they have a Contact pointing
// at me, tagged with a circle they've shared that presence with), never on how I've
// categorized them. Location is private by default; this only surfaces people who've
// explicitly opted a circle into visibility (see homebaseSharedCircles / Trip.sharedWithCircles).
app.get('/api/friends-nearby', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    if (!city) {
      return res.status(400).json({ error: 'city is required' });
    }
    const startDate = typeof req.query.startDate === 'string' ? new Date(req.query.startDate) : null;
    const endDate = typeof req.query.endDate === 'string' ? new Date(req.query.endDate) : null;
    // Substring, not exact-anchored, and reduced to the name-only prefix — same reasoning as
    // buildCityDurationMatchStage/cityNeedle in lib/place-matching.ts: either side of the
    // comparison (query or stored value) might be a bare city name or "City, Country", and a
    // plain substring match only catches the case where the stored value is the longer one.
    const cityRegex = { $regex: escapeRegExp(cityNeedle(city)), $options: 'i' };

    // Who has ME as a contact, and under which of THEIR circles? Only these people are even
    // candidates — everyone else's sharing, however broad, is invisible to me by construction.
    const contactsPointingAtMe = await Contact.find({ contact_user_id: req.userId });
    const circlesByOwner = new Map<string, Set<string>>();
    for (const c of contactsPointingAtMe) {
      const ownerId = c.owner_user_id.toString();
      if (!circlesByOwner.has(ownerId)) circlesByOwner.set(ownerId, new Set());
      for (const tag of c.circle_tags) circlesByOwner.get(ownerId)!.add(tag);
    }
    const candidateIds = Array.from(circlesByOwner.keys()).filter(id => id !== req.userId);
    if (candidateIds.length === 0) {
      return res.json([]);
    }

    const results = new Map<string, any>();
    const addMatch = (user: any, matchType: 'lives_here' | 'visiting', tripDates?: { startDate: Date; endDate: Date }) => {
      const id = user._id.toString();
      if (!results.has(id)) {
        results.set(id, {
          userId: id,
          name: user.full_name || user.email,
          avatarUrl: user.avatar_url,
          matches: []
        });
      }
      results.get(id).matches.push(matchType === 'visiting' ? { type: matchType, ...tripDates } : { type: matchType });
    };

    // "Living there" — homebase match, not date-bound.
    const homebaseMatches = await User.find({
      _id: { $in: candidateIds },
      homebase: cityRegex,
      homebaseSharedCircles: { $ne: [] }
    });
    for (const u of homebaseMatches) {
      const myCircles = circlesByOwner.get(u._id.toString())!;
      if (u.homebaseSharedCircles.some((c: string) => myCircles.has(c))) {
        addMatch(u, 'lives_here');
      }
    }

    // "Traveling there" — a shared trip, with dates overlapping the given range if provided.
    const tripFilter: any = {
      user_id: { $in: candidateIds },
      destination: cityRegex,
      sharedWithCircles: { $ne: [] }
    };
    if (startDate && endDate && !isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
      tripFilter.start_date = { $lte: endDate };
      tripFilter.end_date = { $gte: startDate };
    }
    const tripMatches = await Trip.find(tripFilter);
    if (tripMatches.length > 0) {
      const tripOwnerIds = Array.from(new Set(tripMatches.map(t => t.user_id.toString())));
      const tripOwners = await User.find({ _id: { $in: tripOwnerIds } });
      const ownerById = new Map(tripOwners.map(u => [u._id.toString(), u]));
      for (const t of tripMatches) {
        const ownerId = t.user_id.toString();
        const myCircles = circlesByOwner.get(ownerId)!;
        const owner = ownerById.get(ownerId);
        if (owner && t.sharedWithCircles.some((c: string) => myCircles.has(c))) {
          addMatch(owner, 'visiting', { startDate: t.start_date, endDate: t.end_date });
        }
      }
    }

    res.json(Array.from(results.values()));
  } catch (error: any) {
    reportError(error, req, 'friends nearby lookup failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Per-user field encryption for Event.title / .location / .place_name — the local-only
// stopgap from docs/data-encryption-plan.md (see lib/field-encryption.ts for the full design
// writeup). Every helper below is a clean no-op — fields read/write as plain strings, current
// behavior unchanged — until ENCRYPTION_MASTER_KEY is actually set, so this is safe to ship
// without requiring every environment to configure it immediately. getOrCreateUserDataKey/
// getUserDataKeyIfExists live in lib/user-data-key.ts (not inline here) so
// scripts/migrate-encrypt-events.ts can share the exact same key-lookup logic instead of
// re-deriving its own copy that could quietly drift from what the live routes do.

function encryptField(value: string | undefined, key: Buffer | null): string | undefined {
  if (value === undefined || key === null) return value;
  return encryptWithKey(value, key);
}

function decryptField(value: string | undefined, key: Buffer | null): string | undefined {
  if (value === undefined || key === null || !isEncryptedValue(value)) return value;
  return decryptWithKey(value, key);
}

// Decrypts title/location/place_name on a batch of Event documents — each potentially
// created by a different user (e.g. GET /api/events/invited spans many organizers) — fetching
// each unique creator's data key at most once. Returns plain objects, not Mongoose documents,
// since the encrypted fields are being rewritten with their decrypted values.
// created_by is normally a bare ObjectId, but GET /api/events/invited populates it (to
// return the organizer's name/avatar alongside each event) — in that case it's a
// sub-document with its own _id instead. Handle both shapes so this stays the one shared
// decrypt path for every route above rather than forking per-route.
function creatorIdOf(createdBy: any): string {
  return (createdBy && createdBy._id ? createdBy._id : createdBy).toString();
}

async function decryptEvents(events: any[]): Promise<any[]> {
  const uniqueCreatorIds = Array.from(new Set(events.map(e => creatorIdOf(e.created_by))));
  const keysByCreator = new Map<string, Buffer | null>();
  for (const id of uniqueCreatorIds) {
    keysByCreator.set(id, await getUserDataKeyIfExists(id));
  }
  return events.map(e => {
    const obj = e.toObject ? e.toObject() : e;
    const key = keysByCreator.get(creatorIdOf(obj.created_by)) ?? null;
    return {
      ...obj,
      title: decryptField(obj.title, key),
      location: decryptField(obj.location, key),
      place_name: decryptField(obj.place_name, key)
    };
  });
}

// 3. Events (created and, in the future, calendar-imported — see models/Event.ts)
// Kept as their own collection rather than embedded in Trip specifically so "events I'm
// invited to" (a participant querying across other people's trips) is a normal indexed
// query instead of a full scan.
app.get('/api/events/invited', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const events = await Event.find({ 'participants.user_id': req.userId })
      .sort({ start_time: 1 })
      .populate<{ created_by: PopulatedEventCreator }>('created_by', 'full_name avatar_url');
    res.json(await decryptEvents(events));
  } catch (error: any) {
    reportError(error, req, 'list invited events failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/trips/:tripId/events', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.tripId, user_id: req.userId });
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    // A linked (shadow) trip — see Trip.linkedTripId — has no events of its own by default: its
    // events actually live under the ORIGINAL organizer's trip_id, filtered to just what this
    // participant is invited to (never the organizer's full itinerary, which would leak every
    // other guest's plans). Still unions in trip._id itself in case the participant creates
    // their own event directly under their shadow trip — that's a normal, independently-owned
    // event with this trip's own id, unrelated to the organizer's.
    const query = trip.linkedTripId
      ? { $or: [
          { trip_id: trip.linkedTripId, 'participants.user_id': req.userId },
          { trip_id: trip._id }
        ] }
      : { trip_id: trip._id };
    const events = await Event.find(query).sort({ start_time: 1 });
    res.json(await decryptEvents(events));
  } catch (error: any) {
    reportError(error, req, 'list trip events failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/trips/:tripId/events', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.tripId, user_id: req.userId });
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    const { title, startTime, endTime, placeId, placeName, location, participantContactIds } = req.body;
    if (!title || !startTime || !endTime) {
      return res.status(400).json({ error: 'title, startTime, and endTime are required' });
    }

    let participants: { user_id: any; invited_by: string; status: string }[] = [];
    if (Array.isArray(participantContactIds) && participantContactIds.length > 0) {
      const contacts = await Contact.find({
        _id: { $in: participantContactIds },
        owner_user_id: req.userId
      });
      if (contacts.length !== participantContactIds.length) {
        return res.status(400).json({ error: 'One or more contacts not found in your circle' });
      }
      // Blind joint-matching needs a real account with real preferences on the other
      // side — a contact who hasn't joined yet has nothing to match against, so they're
      // rejected here rather than silently invited as an inert placeholder.
      const unlinked = contacts.filter(c => !c.contact_user_id);
      if (unlinked.length > 0) {
        return res.status(400).json({
          error: `These contacts haven't joined Odys.ai yet, so they can't be invited to an event: ${unlinked.map(c => c.name).join(', ')}`
        });
      }
      participants = contacts.map(c => ({
        user_id: c.contact_user_id,
        invited_by: req.userId as string,
        status: 'pending'
      }));
    }

    const dataKey = await getOrCreateUserDataKey(req.userId as string);
    const event = await Event.create({
      trip_id: trip._id,
      created_by: req.userId,
      source: 'created',
      title: encryptField(title, dataKey),
      start_time: new Date(startTime),
      end_time: new Date(endTime),
      place_id: placeId,
      place_name: encryptField(placeName, dataKey),
      location: encryptField(location, dataKey),
      participants
    });

    req.log.info(
      { event: 'event_created', userId: req.userId, tripId: trip._id.toString(), eventId: event._id.toString(), participantCount: participants.length },
      'event created'
    );

    // Best-effort push notifications to invited participants — never blocks/fails event
    // creation. Same defense-in-depth wrapping as the friend-request push send above:
    // sendPushNotification (lib/push-notifications.ts) already never throws on its own, this
    // try/catch just covers the User lookups around it.
    if (participants.length > 0) {
      try {
        const participantUsers = await User.find({
          _id: { $in: participants.map(p => p.user_id) },
          expoPushToken: { $exists: true, $ne: null }
        }).select('expoPushToken');
        if (participantUsers.length > 0) {
          const organizer = await User.findById(req.userId).select('full_name');
          await Promise.all(participantUsers.map(u => sendPushNotification(
            u.expoPushToken as string,
            'New event invite',
            `${organizer?.full_name || 'Someone'} invited you to "${title}"`,
            { type: 'event_invite', eventId: event._id.toString(), tripId: trip._id.toString() }
          )));
        }
      } catch (err) {
        req.log.warn({ err }, 'event invite push send failed');
      }
    }

    // Return the plaintext values already in hand rather than re-decrypting — this request
    // already knows them, so there's no need for a second data-key lookup.
    res.json({ ...event.toObject(), title, place_name: placeName, location });
  } catch (error: any) {
    reportError(error, req, 'create event failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Opportunistic device-calendar sync (see lib/calendar.ts's getDeviceEventsForDateRange) —
// upserts a batch of device calendar events as source: 'imported' Event documents, keyed on
// the device event's own id so repeated syncs update rather than duplicate. Imported events
// are never shareable (no participants ever set here) — that's a 'created'-only concept.
app.post('/api/trips/:tripId/events/import', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.tripId, user_id: req.userId });
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    const { events } = req.body;
    if (!Array.isArray(events)) {
      return res.status(400).json({ error: 'events must be an array' });
    }

    // Computed once, not per-event — every imported event in this batch shares the same
    // created_by (req.userId), so this is one data-key lookup/creation for the whole batch.
    const dataKey = await getOrCreateUserDataKey(req.userId as string);

    const imported = [];
    for (const evt of events) {
      const { id, title, startTime, endTime, location, allDay } = evt || {};
      if (!id || !title || !startTime || !endTime) continue; // skip malformed entries rather than failing the whole batch

      const doc = await Event.findOneAndUpdate(
        { trip_id: trip._id, google_event_id: id, source: 'imported' },
        {
          $set: {
            trip_id: trip._id,
            created_by: req.userId,
            source: 'imported',
            title: encryptField(title, dataKey),
            start_time: new Date(startTime),
            end_time: new Date(endTime),
            location: encryptField(location, dataKey),
            google_event_id: id,
            allDay: !!allDay
          }
        },
        { upsert: true, new: true, runValidators: true }
      );
      imported.push(doc);
    }

    req.log.info(
      { event: 'events_imported', userId: req.userId, tripId: trip._id.toString(), count: imported.length },
      'calendar events imported'
    );
    res.json(await decryptEvents(imported));
  } catch (error: any) {
    reportError(error, req, 'import events failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/events/:id', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { title, startTime, endTime, placeId, placeName, location, participantContactIds } = req.body;

    // Organizer-only: scoping to created_by (not just _id) is what stops an invited
    // participant from editing the event — they can only respond to it (see /respond).
    // Loaded (rather than updated in one shot like before) because rebuilding the
    // participants list below needs to see the event's *current* list, to preserve each
    // existing invitee's accepted/declined status instead of resetting everyone back to
    // pending just because the organizer re-saved the event. Not-found is returned for
    // both "doesn't exist" and "exists but isn't yours", same ownership-scoping pattern
    // used throughout this file, so existence isn't leaked.
    const event = await Event.findOne({ _id: req.params.id, created_by: req.userId });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const dataKey = await getOrCreateUserDataKey(req.userId as string);
    if (title !== undefined) event.title = encryptField(title, dataKey) as string;
    if (startTime !== undefined) event.start_time = new Date(startTime);
    if (endTime !== undefined) event.end_time = new Date(endTime);
    if (placeId !== undefined) event.place_id = placeId;
    if (placeName !== undefined) event.place_name = encryptField(placeName, dataKey);
    if (location !== undefined) event.location = encryptField(location, dataKey);

    // participantContactIds, when present, replaces the invite list wholesale — same
    // Contact -> User resolution (and the same "must be a joined, linked contact" rule) as
    // POST /api/trips/:tripId/events. Existing invitees who are still in the new list keep
    // their current accepted/declined status rather than being bounced back to pending;
    // anyone dropped from the list is simply removed.
    if (Array.isArray(participantContactIds)) {
      const contacts = await Contact.find({
        _id: { $in: participantContactIds },
        owner_user_id: req.userId
      });
      if (contacts.length !== participantContactIds.length) {
        return res.status(400).json({ error: 'One or more contacts not found in your circle' });
      }
      const unlinked = contacts.filter(c => !c.contact_user_id);
      if (unlinked.length > 0) {
        return res.status(400).json({
          error: `These contacts haven't joined Odys.ai yet, so they can't be invited to an event: ${unlinked.map(c => c.name).join(', ')}`
        });
      }
      event.participants = contacts.map(c => {
        const existing = event.participants.find((p: any) => p.user_id.toString() === c.contact_user_id!.toString());
        return {
          user_id: c.contact_user_id!,
          invited_by: existing ? existing.invited_by : (req.userId as any),
          status: existing ? existing.status : 'pending'
        };
      }) as any;
    }

    await event.save();
    const [decrypted] = await decryptEvents([event]);
    res.json(decrypted);
  } catch (error: any) {
    reportError(error, req, 'update event failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/events/:id/respond', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { status } = req.body;
    if (status !== 'accepted' && status !== 'declined') {
      return res.status(400).json({ error: 'status must be "accepted" or "declined"' });
    }

    // Scoping the outer query to participants.user_id, and the arrayFilter to the same id,
    // is what stops a participant from responding on behalf of someone else in the list.
    // If everyone ends up declined, that's fine — the event just sits there, no auto-cancel.
    const event = await Event.findOneAndUpdate(
      { _id: req.params.id, 'participants.user_id': req.userId },
      { $set: { 'participants.$[elem].status': status } },
      { new: true, arrayFilters: [{ 'elem.user_id': req.userId }] }
    );
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Find-or-create a "shadow" trip for the accepting participant, linked to the organizer's
    // trip — see Trip.linkedTripId's doc comment for why this exists (an Event always requires
    // a trip_id, so a participant who owns no trip of their own had nowhere for an accepted
    // invite to live). Exact-id lookup, not fuzzy destination/date matching — idempotent, so
    // accepting a second invite from the same organizer trip reuses the one shadow trip rather
    // than multiplying. Declining never creates one; there's nothing to hold on the invitee's
    // side for something they're not attending.
    if (status === 'accepted') {
      const existingShadow = await Trip.findOne({ user_id: req.userId, linkedTripId: event.trip_id });
      if (!existingShadow) {
        const organizerTrip = await Trip.findById(event.trip_id);
        if (organizerTrip) {
          await Trip.create({
            user_id: req.userId,
            destination: organizerTrip.destination,
            start_date: organizerTrip.start_date,
            end_date: organizerTrip.end_date,
            timezone: organizerTrip.timezone,
            baseLocations: organizerTrip.baseLocations,
            linkedTripId: organizerTrip._id
          });
        }
      }
    }

    res.json(event);
  } catch (error: any) {
    reportError(error, req, 'respond to event failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/events/:id', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const event = await Event.findOneAndDelete({ _id: req.params.id, created_by: req.userId });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    // Narrower case of the same cascade as DELETE /api/trips/:id above: deleting this event
    // may have been the trip's last one, which empties it out for any participant's shadow
    // trip (Trip.linkedTripId) mirroring it just as fully as deleting the trip itself would.
    const remainingEvents = await Event.countDocuments({ trip_id: event.trip_id });
    if (remainingEvents === 0) {
      await Trip.deleteMany({ linkedTripId: event.trip_id });
    }
    res.json({ success: true, message: 'Event deleted successfully' });
  } catch (error: any) {
    reportError(error, req, 'delete event failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Shared by both recommendation endpoints below. Resolves how far "near me" should actually
// reach for this request, then — best-effort, live, every single call, not gated on existing
// coverage — refreshes the Place collection with genuinely nearby Google results at that radius
// before the caller's aggregation runs. Exists because a city can look well-covered in
// aggregate (Paris: 18+ curated places) while a specific hotel has nothing walkable nearby at
// all; ensurePlacesForCity's city-wide "is there enough, period" check can't see that gap, only
// an anchor-centered live query can. See docs/ad-monetization.md-adjacent reasoning captured in
// CHANGELOG.md for the real case (a central Paris hotel) that surfaced this.
//
// No anchor -> nothing to search "nearby" of, so this is a no-op returning the flat
// DEFAULT_MAX_DISTANCE_KM, identical to every request's behavior before this existed.
async function resolveRadiusAndRefreshLive(
  city: string,
  anchor: GeoPoint | null,
  mealWindow: boolean,
  req: AuthedRequest
): Promise<number> {
  if (!anchor) return DEFAULT_MAX_DISTANCE_KM;

  // Open-Meteo's city geocoder (already used for the destination-search autocomplete) returns
  // population for free — reused here rather than adding a second provider. A lookup failure
  // degrades to DEFAULT_MAX_DISTANCE_KM's tier (population: null), not a failed request.
  let population: number | null = null;
  try {
    const results = await searchCities(cityNeedle(city));
    population = results[0]?.population ?? null;
  } catch (err) {
    req.log.warn({ err }, 'city population lookup failed, using default radius tier');
  }

  const liveCategory = mealWindow ? 'Restaurant' : 'Activity';
  const radiusKm = resolveSearchRadiusKm(population, liveCategory);
  await refreshNearbyPlacesLive(city, anchor, radiusKm, liveCategory);
  return radiusKm;
}

// The blind joint-matching endpoint: ranks places against every participant's preference
// tags via a Mongo $setIntersection aggregation, without ever returning a per-participant
// breakdown — nobody's individual preferences leave this function, only the combined score.
app.post('/api/events/:id/recommendations', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const isOrganizer = event.created_by.toString() === req.userId;
    const isParticipant = event.participants.some((p: any) => p.user_id.toString() === req.userId);
    if (!isOrganizer && !isParticipant) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const trip = await Trip.findById(event.trip_id);
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    const participantUserIds = Array.from(new Set([
      event.created_by.toString(),
      ...event.participants.map((p: any) => p.user_id.toString())
    ]));
    const users = await User.find({ _id: { $in: participantUserIds } });

    const durationMinutes = Math.round((event.end_time.getTime() - event.start_time.getTime()) / 60000);
    const timezone = trip.timezone || 'UTC';
    // Organizer's meal-time preference decides the window, not each participant's — they're
    // the one who picked this event's time, and there's no single "meal time" that could
    // represent multiple people's preferences at once anyway.
    const organizer = users.find(u => u._id.toString() === event.created_by.toString());
    const mealWindow = isMealWindow(event.start_time, timezone, organizer?.preferences);
    const query = buildCityDurationQuery(trip.destination, durationMinutes, mealWindow);
    const anchor = resolveAnchorForDate(trip.baseLocations || [], event.start_time);
    const radiusKm = await resolveRadiusAndRefreshLive(trip.destination, anchor, mealWindow, req);

    // Per-participant intersection-size fields are computed here but deliberately never
    // included in the final $project below — only the combined jointScore leaves this
    // aggregation, so no participant's individual match strength is ever attributable.
    const scoreFields: any = {};
    const scoreFieldNames: string[] = [];
    users.forEach((u, idx) => {
      const field = `_matchCount${idx}`;
      scoreFields[field] = { $size: { $setIntersection: ['$tags', flattenPreferenceTags(u.preferences)] } };
      scoreFieldNames.push(`$${field}`);
    });

    const firstStage = anchor
      ? buildGeoNearStage(anchor, radiusKm, query)
      : { $match: { ...query, distanceKm: { $lte: radiusKm } } };

    const places = await Place.aggregate([
      firstStage,
      { $addFields: scoreFields },
      { $addFields: { jointScore: scoreFieldNames.length > 0 ? { $add: scoreFieldNames } : 0 } },
      { $addFields: { rankScore: { $add: ['$jointScore', SOURCE_RANK_BONUS] } } },
      { $sort: { rankScore: -1, rating: -1 } },
      { $limit: 10 },
      { $project: { name: 1, city: 1, category: 1, genre: 1, rating: 1, description: 1, estimatedDuration: 1, distanceKm: 1, jointScore: 1, source: 1, location: 1, address: 1, photoRef: 1 } }
    ]);

    // Tiered shuffle among the top-10 pool: still varies order within a source tier so this
    // doesn't always surface the identical place first, but keeps curated/google ahead of
    // generated filler rather than fully randomizing across the source-priority ordering above.
    res.json(stripPhotoRef(tieredShuffle(places)));
  } catch (error: any) {
    reportError(error, req, 'joint recommendation failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Solo recommendation endpoint — same real Place collection and deterministic tag-scoring
// as the joint endpoint above (via the shared lib/place-matching helpers), replacing the
// old client-side lib/recommendations.ts path that ran against a static mock array with
// Math.random()-based scoring. No privacy concern here (it's the caller's own preferences),
// so this just scores against one tag set instead of aggregating across participants.
app.post('/api/recommendations', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { city, durationMinutes, startTimeIso, timezone, maxDistanceKm, tagOverride, tripId, anchorLat, anchorLng } = req.body;
    if (!city || !durationMinutes || !startTimeIso) {
      return res.status(400).json({ error: 'city, durationMinutes, and startTimeIso are required' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Unlike POST /api/trips, nothing else ever populates places for wherever the user
    // currently is — the Home tab's "Smart Suggestions" queries by live location, which was
    // never necessarily used to create a trip. Best-effort: a population failure shouldn't
    // block the request, just leave it returning fewer/no results.
    await ensurePlacesForCity(city).catch((err) => req.log.warn({ err }, 'places population failed'));

    const zone = timezone || guessTimezoneForCity(city);
    const mealWindow = isMealWindow(new Date(startTimeIso), zone, user.preferences);
    // tagOverride lets the "Refine Your Search" flow (trips.tsx) score against a specific set
    // of tags the user picks in the moment ("just show me Museums") instead of always falling
    // back to their saved preference profile — same $setIntersection scoring either way.
    const tags = Array.isArray(tagOverride) && tagOverride.length > 0
      ? tagOverride.filter((t: any) => typeof t === 'string')
      : flattenPreferenceTags(user.preferences);

    // Real anchor point resolution, highest-precision first: an explicit override (the Home
    // tab's live device location) beats resolving from a trip's baseLocations, which beats
    // falling back to the static-distanceKm path for trips with no anchor yet.
    let anchor: { lat: number; lng: number } | null = null;
    if (typeof anchorLat === 'number' && typeof anchorLng === 'number') {
      anchor = { lat: anchorLat, lng: anchorLng };
    } else if (tripId) {
      const trip = await Trip.findOne({ _id: tripId, user_id: req.userId });
      if (trip) anchor = resolveAnchorForDate(trip.baseLocations || [], new Date(startTimeIso));
    }

    // An explicit maxDistanceKm (recommendation.tsx's "Expand Search Radius") always wins over
    // the population-derived tier — still triggers a live refresh, just at the caller's chosen
    // radius instead of computing one. Otherwise resolveRadiusAndRefreshLive sizes the radius by
    // how dense the destination actually is and live-refreshes nearby Google results at it.
    let effectiveMaxDistanceKm: number;
    if (typeof maxDistanceKm === 'number') {
      effectiveMaxDistanceKm = maxDistanceKm;
      if (anchor) await refreshNearbyPlacesLive(city, anchor, maxDistanceKm, mealWindow ? 'Restaurant' : 'Activity');
    } else {
      effectiveMaxDistanceKm = await resolveRadiusAndRefreshLive(city, anchor, mealWindow, req);
    }

    // location included so the client can chain the next free-time slot's anchor off this
    // slot's top pick (trips.tsx) instead of always anchoring every slot on the trip's static
    // hotel/city location — see the anchor-chaining note in trips.tsx's recommendation-fetch
    // effect for why (e.g. proposing dinner near the afternoon activity, not just near the hotel).
    const projectStage = { $project: { name: 1, city: 1, category: 1, genre: 1, rating: 1, description: 1, estimatedDuration: 1, distanceKm: 1, matchScore: 1, source: 1, location: 1, address: 1, photoRef: 1 } };
    const pipeline = anchor
      ? [
          buildGeoNearStage(anchor, effectiveMaxDistanceKm, buildCityDurationQuery(city, durationMinutes, mealWindow)),
          { $addFields: { matchScore: { $size: { $setIntersection: ['$tags', tags] } } } },
          { $addFields: { rankScore: { $add: ['$matchScore', SOURCE_RANK_BONUS] } } },
          { $sort: { rankScore: -1, rating: -1 } },
          { $limit: 10 },
          projectStage
        ]
      : [
          { $match: buildCityDurationMatchStage(city, durationMinutes, mealWindow, effectiveMaxDistanceKm) },
          { $addFields: { matchScore: { $size: { $setIntersection: ['$tags', tags] } } } },
          { $addFields: { rankScore: { $add: ['$matchScore', SOURCE_RANK_BONUS] } } },
          { $sort: { rankScore: -1, rating: -1 } },
          { $limit: 10 },
          projectStage
        ];

    const places = await Place.aggregate(pipeline);

    // Tiered shuffle among the top-10 pool — still varies order within a source tier (so
    // repeated slots on a trip don't always show the identical top place), but keeps
    // curated/google ranked ahead of generated filler rather than erasing that ordering.
    res.json(stripPhotoRef(tieredShuffle(places)));
  } catch (error: any) {
    reportError(error, req, 'solo recommendation failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Server-side photo proxy: GOOGLE_PLACES_API_KEY lives only in this process's env and is never
// sent to the client. Places API (New) has no direct image URL — a place's photoRef (a resource
// name, see models/Place.ts) has to be exchanged for actual bytes via Google's Photo Media
// endpoint, which requires the key as a query param. Building that URL client-side (or handing
// the client a pre-built one) would leak the key into the app's own network traffic, so this
// route does the exchange here and streams the result back instead — the client only ever sees
// `${API_URL}/api/places/:id/photo`, never googleapis.com.
//
// Deliberately no `authenticate` here (unlike every other /api route): it's keyed by an opaque
// Mongo ObjectId, serves nothing more sensitive than a tourist-attraction photo Google already
// serves publicly, and React Native's <Image> doesn't attach custom headers without extra
// plumbing — not worth the complexity for content that was never secret to begin with. The
// actual secret (the API key) never reaches this response either way.
app.get('/api/places/:id/photo', async (req: AuthedRequest, res: express.Response) => {
  try {
    const place = await Place.findById(req.params.id);
    if (!place || !place.photoRef) {
      return res.status(404).json({ error: 'No photo available for this place' });
    }
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return res.status(404).json({ error: 'Photos are not configured' });
    }

    // maxWidthPx=480 is plenty for a card thumbnail (rendered well under 100px in trips.tsx/
    // recommendation.tsx) while keeping the proxied payload small — Places API bills/sizes by
    // the requested width, not the original asset.
    const photoUrl = `https://places.googleapis.com/v1/${place.photoRef}/media?maxWidthPx=480&key=${apiKey}`;
    const photoRes = await fetch(photoUrl, { signal: AbortSignal.timeout(8000) });
    if (!photoRes.ok || !photoRes.body) {
      req.log.warn({ status: photoRes.status }, 'place photo fetch from Google failed');
      return res.status(502).json({ error: 'Failed to fetch photo' });
    }

    res.set('Content-Type', photoRes.headers.get('content-type') || 'image/jpeg');
    // Google's own photo bytes for a given photoRef don't change on any timescale that matters
    // here — safe to let clients/CDNs cache this aggressively instead of re-proxying on every
    // card render.
    res.set('Cache-Control', 'public, max-age=86400');
    const buffer = Buffer.from(await photoRes.arrayBuffer());
    res.send(buffer);
  } catch (error: any) {
    reportError(error, req, 'place photo proxy failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// City hero photo for a trip card: a real Google photo of a landmark in that city (an Eiffel
// Tower for Paris, in the literal example this was built for) — no dedicated Google call
// needed, this rides on the same per-city Place cache every recommendation query already fills
// (ensurePlacesForCity). Tiered rather than a flat "highest-rated place with a photo" query:
// live-tested against Paris, that flat query's #1 result was a 5-star spa — accurate, but not
// what a city's hero photo should be. Landmark-ish Activity genres are tried first, sorted by
// rating; only falls through to "any Activity" then "anything with a photo at all" (a real
// restaurant/spa photo, worse than nothing? no — still beats a blank card) if the city has no
// landmark coverage yet. Returns a Place id the client feeds straight into the existing
// GET /api/places/:id/photo proxy — no new photo plumbing, no API key exposure. No
// `authenticate`, matching that route's own reasoning: an opaque id, a tourist photo Google
// already serves publicly, nothing sensitive.
const CITY_PHOTO_LANDMARK_GENRES = ['Monuments', 'Viewpoints', 'Museums', 'Galleries', 'Parks'];

app.get('/api/places/city-photo', async (req: AuthedRequest, res: express.Response) => {
  try {
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    if (!city) return res.status(400).json({ error: 'city is required' });

    await ensurePlacesForCity(city).catch((err) => req.log.warn({ err }, 'places population failed'));

    const cityFilter = { city: { $regex: escapeRegExp(cityNeedle(city)), $options: 'i' } };
    const hasPhotoFilter = { photoRef: { $exists: true, $ne: null } };

    const place =
      await Place.findOne({ ...cityFilter, ...hasPhotoFilter, genre: { $in: CITY_PHOTO_LANDMARK_GENRES } }).sort({ rating: -1 })
      ?? await Place.findOne({ ...cityFilter, ...hasPhotoFilter, category: 'Activity' }).sort({ rating: -1 })
      ?? await Place.findOne({ ...cityFilter, ...hasPhotoFilter }).sort({ rating: -1 });

    if (!place) return res.status(404).json({ error: 'No photo available for this city' });
    res.json({ placeId: place._id });
  } catch (error: any) {
    reportError(error, req, 'city photo lookup failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Single place by id, same field shape as a /api/recommendations entry (via stripPhotoRef).
// Needed so a slot whose OWN recommendation query came back empty can still render a place
// that got scheduled into its time window through a different path (e.g. "Looking for
// something else?" refine search, which queries independently) — trips.tsx falls back to this
// when a scheduled event's place isn't already sitting in that slot's cached recommendations.
// No `authenticate`, same reasoning as the photo proxy: an opaque id, nothing sensitive.
//
// Registered AFTER the literal /api/places/city-photo route above: Express matches routes in
// registration order, and this single-segment `:id` wildcard would otherwise shadow it
// (matching id="city-photo" and never reaching the real handler) if it came first.
app.get('/api/places/:id', async (req: AuthedRequest, res: express.Response) => {
  try {
    const place = await Place.findById(req.params.id);
    if (!place) return res.status(404).json({ error: 'Place not found' });
    const [result] = stripPhotoRef([place]);
    res.json({ ...result, matchScore: 0 });
  } catch (error: any) {
    reportError(error, req, 'place lookup failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 4. Contacts
app.get('/api/contacts', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const contacts = await Contact.find({ owner_user_id: req.userId });
    res.json(contacts);
  } catch (error: any) {
    reportError(error, req, 'list contacts failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/contacts', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { name, email, circleTags, contactUserId } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    // A contact created with an email but no contactUserId is "pending" — visible in the
    // circle, but not yet a real linked account, so it can't be invited to events (see
    // POST /api/trips/:tripId/events). Auto-linking contactUserId when that email
    // eventually signs up is a deliberately separate, not-yet-built pass.
    const contact = await Contact.create({
      owner_user_id: req.userId,
      name,
      email: email || undefined,
      circle_tags: circleTags || [],
      contact_user_id: contactUserId || null
    });
    req.log.info({ event: 'contact_invited', userId: req.userId, contactId: contact._id.toString(), hasEmail: !!email }, 'contact invited');
    res.json(contact);
  } catch (error: any) {
    reportError(error, req, 'create contact failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/contacts/:id', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { name, circleTags, contactUserId } = req.body;
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (circleTags !== undefined) updateData.circle_tags = circleTags;
    if (contactUserId !== undefined) updateData.contact_user_id = contactUserId;

    const contact = await Contact.findOneAndUpdate(
      { _id: req.params.id, owner_user_id: req.userId },
      { $set: updateData },
      { new: true }
    );
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json(contact);
  } catch (error: any) {
    reportError(error, req, 'update contact failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/contacts/:id', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const contact = await Contact.findOneAndDelete({ _id: req.params.id, owner_user_id: req.userId });
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json({ success: true, message: 'Contact deleted successfully' });
  } catch (error: any) {
    reportError(error, req, 'delete contact failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 4a. Suggestions — the "Have a suggestion for Odys.ai?" form on Profile (see
// components/profile/suggestion-form-modal.tsx). The suggestion is durably saved to Mongo the
// moment this succeeds; the admin-notification email is best-effort on top of that (see
// lib/mailer.ts — a safe no-op until a real mail relay is configured), never a precondition
// for a 200 here. Read the user from the authenticated request, never a client-supplied name —
// same hardening as every other write route in this file.
app.post('/api/suggestions', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }
    if (text.length > 1500) {
      return res.status(400).json({ error: 'text must be 1500 characters or fewer' });
    }

    // The suggestion itself is the one thing that must succeed for a 200 here — it's the
    // durable source of truth (see models/Suggestion.ts). Any failure below this point (the
    // best-effort admin-notification email) is caught separately and never turns into a
    // client-facing error, per the doc's explicit call: the user shouldn't see an error for
    // an email-relay gap that isn't their problem to know about.
    const suggestion = await Suggestion.create({ user: req.userId, text });

    try {
      const user = await User.findById(req.userId).select('full_name email');
      const { sent } = await sendMail({
        to: 'admin@odys.ai',
        subject: 'New Odys.ai suggestion',
        text: `From: ${user?.full_name || user?.email || req.userId}\n\n${text}`
      });
      if (sent) {
        suggestion.emailed = true;
        await suggestion.save();
      }
      req.log.info({ event: 'suggestion_submitted', userId: req.userId, suggestionId: suggestion._id.toString(), emailed: sent }, 'suggestion submitted');
    } catch (mailError: any) {
      reportError(mailError, req, 'suggestion email notification failed');
    }

    res.json({ success: true });
  } catch (error: any) {
    reportError(error, req, 'create suggestion failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 4b. Friend requests — real-account-to-real-account consent step for becoming contacts.
// Deliberately separate from POST /api/contacts (the invite-by-email flow for someone who
// doesn't have an account yet, see app/(tabs)/social.tsx's Invite modal): a FriendRequest
// only ever targets an existing User, looked up by email, and requires the recipient to
// accept before any Contact document is created — invite-by-email stays unilateral by
// design, this is not.
app.post('/api/friend-requests', strictLimiter, authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { toEmail, circleTag } = req.body;
    if (!toEmail || !circleTag) {
      return res.status(400).json({ error: 'toEmail and circleTag are required' });
    }

    const toUser = await User.findOne({ email: toEmail });
    if (!toUser) {
      // Real-account-to-real-account only, by design (see models/FriendRequest.ts) — if
      // nobody has signed up with this email yet, tell the sender clearly rather than
      // silently creating a request nobody can ever see. The invite-by-email flow (POST
      // /api/contacts) is the right tool for that case instead.
      return res.status(404).json({ error: 'No Odys.ai account exists for that email yet. Invite them by email instead — you can send a friend request once they join.' });
    }
    if (toUser._id.toString() === req.userId) {
      return res.status(400).json({ error: "You can't send a friend request to yourself" });
    }

    // Block duplicate pending requests in EITHER direction between these two users, rather
    // than treating an opposite-direction pending request as an implicit accept — accepting
    // is a deliberate act that also requires the recipient to choose their own circle_tag
    // (see /respond below), so it shouldn't happen implicitly as a side effect of someone
    // else also trying to add them.
    const existing = await FriendRequest.findOne({
      status: 'pending',
      $or: [
        { from_user_id: req.userId, to_user_id: toUser._id },
        { from_user_id: toUser._id, to_user_id: req.userId }
      ]
    });
    if (existing) {
      return res.status(400).json({ error: 'You already have a pending friend request with this person' });
    }

    const request = await FriendRequest.create({
      from_user_id: req.userId,
      to_user_id: toUser._id,
      circle_tag: circleTag,
      status: 'pending'
    });
    req.log.info({ event: 'friend_request_sent', userId: req.userId, toUserId: toUser._id.toString(), requestId: request._id.toString() }, 'friend request sent');

    // Best-effort push notification — never blocks/fails the friend request itself. See
    // lib/push-notifications.ts; failure (missing token, network error, bad token) is
    // caught and logged there already, but this is wrapped again here for defense in depth,
    // same as every ensurePlacesForCity call site in this file.
    try {
      if (toUser.expoPushToken) {
        const fromUser = await User.findById(req.userId).select('full_name');
        await sendPushNotification(
          toUser.expoPushToken,
          'New friend request',
          `${fromUser?.full_name || 'Someone'} wants to connect with you on Odys.ai`,
          { type: 'friend_request', requestId: request._id.toString() }
        );
      }
    } catch (err) {
      req.log.warn({ err }, 'friend request push send failed');
    }

    res.json(request);
  } catch (error: any) {
    reportError(error, req, 'send friend request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/friend-requests/incoming', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const requests = await FriendRequest.find({ to_user_id: req.userId, status: 'pending' })
      .populate('from_user_id', 'full_name email avatar_url')
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (error: any) {
    reportError(error, req, 'list incoming friend requests failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/friend-requests/sent', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const requests = await FriendRequest.find({ from_user_id: req.userId, status: 'pending' })
      .populate('to_user_id', 'full_name email avatar_url')
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (error: any) {
    reportError(error, req, 'list sent friend requests failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/friend-requests/:id/respond', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { status, circleTag } = req.body;
    if (status !== 'accepted' && status !== 'declined') {
      return res.status(400).json({ error: 'status must be "accepted" or "declined"' });
    }
    if (status === 'accepted' && !circleTag) {
      return res.status(400).json({ error: 'circleTag is required to accept a friend request' });
    }

    // Scoped to to_user_id so only the recipient can respond — mirrors the participant
    // scoping on PUT /api/events/:id/respond.
    const request = await FriendRequest.findOne({ _id: req.params.id, to_user_id: req.userId, status: 'pending' });
    if (!request) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    if (status === 'declined') {
      request.status = 'declined';
      await request.save();
      return res.json(request);
    }

    // Accepted: create the reciprocal Contact pair in one go. Each side gets to file the
    // other under their own choice of circle — the sender already chose theirs when they
    // sent the request (request.circle_tag), the recipient chooses theirs right now
    // (circleTag from the request body), independently. This is the one place in the app
    // that links two real accounts as contacts of each other automatically.
    const [fromUser, toUser] = await Promise.all([
      User.findById(request.from_user_id),
      User.findById(request.to_user_id)
    ]);
    if (!fromUser || !toUser) {
      return res.status(404).json({ error: 'One of the users in this request no longer exists' });
    }

    await Promise.all([
      Contact.create({
        owner_user_id: request.from_user_id,
        contact_user_id: request.to_user_id,
        name: toUser.full_name || toUser.email,
        email: toUser.email,
        circle_tags: [request.circle_tag]
      }),
      Contact.create({
        owner_user_id: request.to_user_id,
        contact_user_id: request.from_user_id,
        name: fromUser.full_name || fromUser.email,
        email: fromUser.email,
        circle_tags: [circleTag]
      })
    ]);

    request.status = 'accepted';
    await request.save();
    req.log.info({ event: 'friend_request_accepted', userId: req.userId, requestId: request._id.toString() }, 'friend request accepted');
    res.json(request);
  } catch (error: any) {
    reportError(error, req, 'respond to friend request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 5. Admin — local-only tool for curating vetted places (public/admin.html). No
// `authenticate` middleware anywhere in this section, by design: this is a local dev tool,
// never meant to be exposed beyond localhost. Every write here is forced to
// source: 'curated' server-side, regardless of what a client sends, so this is the one and
// only path that can create permanent, vetted entries — everything else in the app only
// ever produces source: 'generated' filler (see lib/places-population.ts).
app.get('/admin/api/places', requireAdminToken, async (req: AuthedRequest, res: express.Response) => {
  try {
    const filter: any = {};
    if (typeof req.query.city === 'string' && req.query.city.trim()) {
      filter.city = { $regex: `^${escapeRegExp(req.query.city.trim())}$`, $options: 'i' };
    }
    const places = await Place.find(filter).sort({ city: 1, name: 1 });
    res.json(places);
  } catch (error: any) {
    reportError(error, req, 'list admin places failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/admin/api/places', requireAdminToken, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { name, city, category, genre, rating, description, estimatedDuration, distanceKm } = req.body;
    if (!name || !city || !category || !genre) {
      return res.status(400).json({ error: 'name, city, category, and genre are required' });
    }
    const place = await Place.create({
      name,
      city,
      category,
      genre,
      tags: [category, genre],
      rating: rating ?? 4.5,
      description: description || '',
      estimatedDuration: estimatedDuration ?? 60,
      distanceKm: distanceKm ?? 1,
      source: 'curated'
    });
    res.json(place);
  } catch (error: any) {
    reportError(error, req, 'create admin place failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/admin/api/places/:id', requireAdminToken, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { name, city, category, genre, rating, description, estimatedDuration, distanceKm } = req.body;
    const updateData: any = { source: 'curated' };
    if (name !== undefined) updateData.name = name;
    if (city !== undefined) updateData.city = city;
    if (rating !== undefined) updateData.rating = rating;
    if (description !== undefined) updateData.description = description;
    if (estimatedDuration !== undefined) updateData.estimatedDuration = estimatedDuration;
    if (distanceKm !== undefined) updateData.distanceKm = distanceKm;
    if (category !== undefined) updateData.category = category;
    if (genre !== undefined) updateData.genre = genre;
    // Tags are re-derived whenever category/genre change, so they never drift out of sync.
    if (category !== undefined || genre !== undefined) {
      const existing = await Place.findById(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'Place not found' });
      }
      updateData.tags = [category ?? existing.category, genre ?? existing.genre];
    }

    const place = await Place.findByIdAndUpdate(req.params.id, { $set: updateData }, { new: true });
    if (!place) {
      return res.status(404).json({ error: 'Place not found' });
    }
    res.json(place);
  } catch (error: any) {
    reportError(error, req, 'update admin place failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/admin/api/places/:id', requireAdminToken, async (req: AuthedRequest, res: express.Response) => {
  try {
    const place = await Place.findByIdAndDelete(req.params.id);
    if (!place) {
      return res.status(404).json({ error: 'Place not found' });
    }
    res.json({ success: true, message: 'Place deleted successfully' });
  } catch (error: any) {
    reportError(error, req, 'delete admin place failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  logger.info({ port }, 'Express API server running');
});
