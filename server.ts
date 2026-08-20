import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import pino from 'pino';
import pinoHttp from 'pino-http';
import * as Sentry from '@sentry/node';
import connectToDatabase from './lib/mongodb';
import { isMealWindow, flattenPreferenceTags, buildCityDurationMatchStage, escapeRegExp, cityNeedle, shuffled } from './lib/place-matching';
import { guessTimezoneForCity } from './lib/timezones';
import User from './models/User';
import Trip from './models/Trip';
import Contact from './models/Contact';
import Event from './models/Event';
import Place from './models/Place';
import { ensurePlacesForCity } from './lib/places-population';

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

app.use(cors());
app.use(express.json());
// Local-only admin tool for curating vetted places (see /admin/api/places below) — no auth
// by design, matches the user's explicit "local-only, no auth" decision for this tool.
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

// Routes catch and respond to their own errors (rather than calling next(err)), so
// Express's default/Sentry error-handling middleware never sees them — this is what
// actually gets a 500 into the logs and into Sentry (when configured) instead of vanishing.
function reportError(err: unknown, req: AuthedRequest, message: string) {
  req.log.error({ err }, message);
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
}

app.get('/health', (_req: express.Request, res: express.Response) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// REST API Endpoints

// 1. Auth & Profiles
app.post('/api/auth/login', async (req: AuthedRequest, res: express.Response) => {
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/users/:id', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    if (req.params.id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error: any) {
    reportError(error, req, 'update user failed');
    res.status(500).json({ error: error.message });
  }
});

// 2. Trips
app.get('/api/trips', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const trips = await Trip.find({ user_id: req.userId });
    res.json(trips);
  } catch (error: any) {
    reportError(error, req, 'list trips failed');
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/trips', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { destination, startDate, endDate, timezone, sharedWithCircles } = req.body;
    if (!destination || !startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const trip = await Trip.create({
      user_id: req.userId,
      destination,
      start_date: new Date(startDate),
      end_date: new Date(endDate),
      timezone,
      sharedWithCircles: sharedWithCircles || []
    });
    // Best-effort: a thin/uncovered destination shouldn't block trip creation, just miss
    // out on having candidate places ready until the next trip to that city tries again.
    await ensurePlacesForCity(destination).catch((err) => req.log.warn({ err }, 'places population failed'));
    req.log.info({ event: 'trip_created', userId: req.userId, tripId: trip._id.toString(), destination }, 'trip created');
    res.json(trip);
  } catch (error: any) {
    reportError(error, req, 'create trip failed');
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/trips/:id', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { destination, startDate, endDate, timezone, sharedWithCircles } = req.body;
    const updateData: any = {};
    if (destination !== undefined) updateData.destination = destination;
    if (startDate !== undefined) updateData.start_date = new Date(startDate);
    if (endDate !== undefined) updateData.end_date = new Date(endDate);
    if (timezone !== undefined) updateData.timezone = timezone;
    if (sharedWithCircles !== undefined) updateData.sharedWithCircles = sharedWithCircles;

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
    res.status(500).json({ error: error.message });
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
    res.json({ success: true, message: 'Trip deleted successfully' });
  } catch (error: any) {
    reportError(error, req, 'delete trip failed');
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

// 3. Events (created and, in the future, calendar-imported — see models/Event.ts)
// Kept as their own collection rather than embedded in Trip specifically so "events I'm
// invited to" (a participant querying across other people's trips) is a normal indexed
// query instead of a full scan.
app.get('/api/events/invited', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const events = await Event.find({ 'participants.user_id': req.userId }).sort({ start_time: 1 });
    res.json(events);
  } catch (error: any) {
    reportError(error, req, 'list invited events failed');
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/trips/:tripId/events', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const trip = await Trip.findOne({ _id: req.params.tripId, user_id: req.userId });
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    const events = await Event.find({ trip_id: trip._id }).sort({ start_time: 1 });
    res.json(events);
  } catch (error: any) {
    reportError(error, req, 'list trip events failed');
    res.status(500).json({ error: error.message });
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

    const event = await Event.create({
      trip_id: trip._id,
      created_by: req.userId,
      source: 'created',
      title,
      start_time: new Date(startTime),
      end_time: new Date(endTime),
      place_id: placeId,
      place_name: placeName,
      location,
      participants
    });

    req.log.info(
      { event: 'event_created', userId: req.userId, tripId: trip._id.toString(), eventId: event._id.toString(), participantCount: participants.length },
      'event created'
    );
    res.json(event);
  } catch (error: any) {
    reportError(error, req, 'create event failed');
    res.status(500).json({ error: error.message });
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

    const imported = [];
    for (const evt of events) {
      const { id, title, startTime, endTime, location } = evt || {};
      if (!id || !title || !startTime || !endTime) continue; // skip malformed entries rather than failing the whole batch

      const doc = await Event.findOneAndUpdate(
        { trip_id: trip._id, google_event_id: id, source: 'imported' },
        {
          $set: {
            trip_id: trip._id,
            created_by: req.userId,
            source: 'imported',
            title,
            start_time: new Date(startTime),
            end_time: new Date(endTime),
            location,
            google_event_id: id
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
    res.json(imported);
  } catch (error: any) {
    reportError(error, req, 'import events failed');
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/events/:id', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { title, startTime, endTime, placeId, placeName, location } = req.body;
    const updateData: any = {};
    if (title !== undefined) updateData.title = title;
    if (startTime !== undefined) updateData.start_time = new Date(startTime);
    if (endTime !== undefined) updateData.end_time = new Date(endTime);
    if (placeId !== undefined) updateData.place_id = placeId;
    if (placeName !== undefined) updateData.place_name = placeName;
    if (location !== undefined) updateData.location = location;

    // Organizer-only: scoping to created_by (not just _id) is what stops an invited
    // participant from editing the event — they can only respond to it (see /respond).
    // Not-found is returned for both "doesn't exist" and "exists but isn't yours", same
    // ownership-scoping pattern used throughout this file, so existence isn't leaked.
    const event = await Event.findOneAndUpdate(
      { _id: req.params.id, created_by: req.userId },
      { $set: updateData },
      { new: true }
    );
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json(event);
  } catch (error: any) {
    reportError(error, req, 'update event failed');
    res.status(500).json({ error: error.message });
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
    res.json(event);
  } catch (error: any) {
    reportError(error, req, 'respond to event failed');
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/events/:id', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const event = await Event.findOneAndDelete({ _id: req.params.id, created_by: req.userId });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json({ success: true, message: 'Event deleted successfully' });
  } catch (error: any) {
    reportError(error, req, 'delete event failed');
    res.status(500).json({ error: error.message });
  }
});

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
    const matchStage = buildCityDurationMatchStage(trip.destination, durationMinutes, mealWindow);

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

    const places = await Place.aggregate([
      { $match: matchStage },
      { $addFields: scoreFields },
      { $addFields: { jointScore: scoreFieldNames.length > 0 ? { $add: scoreFieldNames } : 0 } },
      { $sort: { jointScore: -1, rating: -1 } },
      { $limit: 10 },
      { $project: { name: 1, city: 1, category: 1, genre: 1, rating: 1, description: 1, estimatedDuration: 1, distanceKm: 1, jointScore: 1 } }
    ]);

    // Shuffled among the top-10 pool so this doesn't always surface the identical place first
    // for every event proposed on the same trip.
    res.json(shuffled(places));
  } catch (error: any) {
    reportError(error, req, 'joint recommendation failed');
    res.status(500).json({ error: error.message });
  }
});

// Solo recommendation endpoint — same real Place collection and deterministic tag-scoring
// as the joint endpoint above (via the shared lib/place-matching helpers), replacing the
// old client-side lib/recommendations.ts path that ran against a static mock array with
// Math.random()-based scoring. No privacy concern here (it's the caller's own preferences),
// so this just scores against one tag set instead of aggregating across participants.
app.post('/api/recommendations', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const { city, durationMinutes, startTimeIso, timezone, maxDistanceKm, tagOverride } = req.body;
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
    // maxDistanceKm is optional — omitted, the default "near me" ceiling applies
    // (DEFAULT_MAX_DISTANCE_KM in lib/place-matching.ts). The "Expand Search Radius" button
    // re-calls this same endpoint with a larger/absent value once the default comes up empty.
    const matchStage = buildCityDurationMatchStage(
      city, durationMinutes, mealWindow, typeof maxDistanceKm === 'number' ? maxDistanceKm : undefined
    );
    // tagOverride lets the "Refine Your Search" flow (trips.tsx) score against a specific set
    // of tags the user picks in the moment ("just show me Museums") instead of always falling
    // back to their saved preference profile — same $setIntersection scoring either way.
    const tags = Array.isArray(tagOverride) && tagOverride.length > 0
      ? tagOverride.filter((t: any) => typeof t === 'string')
      : flattenPreferenceTags(user.preferences);

    const places = await Place.aggregate([
      { $match: matchStage },
      { $addFields: { matchScore: { $size: { $setIntersection: ['$tags', tags] } } } },
      { $sort: { matchScore: -1, rating: -1 } },
      { $limit: 10 },
      { $project: { name: 1, city: 1, category: 1, genre: 1, rating: 1, description: 1, estimatedDuration: 1, distanceKm: 1, matchScore: 1 } }
    ]);

    // Shuffled among the top-10 pool — otherwise every slot/day on a trip that shares a
    // preference profile deterministically surfaces the identical highest-scored place first.
    res.json(shuffled(places));
  } catch (error: any) {
    reportError(error, req, 'solo recommendation failed');
    res.status(500).json({ error: error.message });
  }
});

// 4. Contacts
app.get('/api/contacts', authenticate, async (req: AuthedRequest, res: express.Response) => {
  try {
    const contacts = await Contact.find({ owner_user_id: req.userId });
    res.json(contacts);
  } catch (error: any) {
    reportError(error, req, 'list contacts failed');
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

// 5. Admin — local-only tool for curating vetted places (public/admin.html). No
// `authenticate` middleware anywhere in this section, by design: this is a local dev tool,
// never meant to be exposed beyond localhost. Every write here is forced to
// source: 'curated' server-side, regardless of what a client sends, so this is the one and
// only path that can create permanent, vetted entries — everything else in the app only
// ever produces source: 'generated' filler (see lib/places-population.ts).
app.get('/admin/api/places', async (req: AuthedRequest, res: express.Response) => {
  try {
    const filter: any = {};
    if (typeof req.query.city === 'string' && req.query.city.trim()) {
      filter.city = { $regex: `^${escapeRegExp(req.query.city.trim())}$`, $options: 'i' };
    }
    const places = await Place.find(filter).sort({ city: 1, name: 1 });
    res.json(places);
  } catch (error: any) {
    reportError(error, req, 'list admin places failed');
    res.status(500).json({ error: error.message });
  }
});

app.post('/admin/api/places', async (req: AuthedRequest, res: express.Response) => {
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
    res.status(500).json({ error: error.message });
  }
});

app.put('/admin/api/places/:id', async (req: AuthedRequest, res: express.Response) => {
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
    res.status(500).json({ error: error.message });
  }
});

app.delete('/admin/api/places/:id', async (req: AuthedRequest, res: express.Response) => {
  try {
    const place = await Place.findByIdAndDelete(req.params.id);
    if (!place) {
      return res.status(404).json({ error: 'Place not found' });
    }
    res.json({ success: true, message: 'Place deleted successfully' });
  } catch (error: any) {
    reportError(error, req, 'delete admin place failed');
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  logger.info({ port }, 'Express API server running');
});
