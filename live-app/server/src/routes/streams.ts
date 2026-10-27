import { Router } from 'express';
import { requireUser, type AuthedRequest } from '../auth';
import { diamondsForGift, findGift } from '../lib/economy';
import { findBlockedTerm } from '../lib/moderation';
import { broadcast, createRoomToken, roomNameFor, roomService } from '../livekit';
import { config } from '../config';
import { Ledger, Stream, User, isObjectId } from '../models';

export const streams = Router();

/** Users hidden from each other: anyone I blocked, plus anyone who blocked me. */
async function hiddenUserIds(userId: string) {
  const [me, blockedMe] = await Promise.all([
    User.findById(userId).select('blocked').lean(),
    User.find({ blocked: userId }).select('_id').lean(),
  ]);
  return [...(me?.blocked ?? []), ...blockedMe.map((u) => u._id)];
}

streams.get('/streams', requireUser, async (req: AuthedRequest, res) => {
  const hidden = await hiddenUserIds(req.userId!);
  const list = await Stream.find({ status: 'live', host: { $nin: hidden } })
    .sort({ viewers: -1, createdAt: -1 })
    .limit(100)
    .populate('host', 'displayName')
    .lean();
  res.json({
    streams: list.map((s: any) => ({
      id: String(s._id),
      title: s.title,
      viewers: s.viewers,
      hostId: String(s.host._id),
      hostName: s.host.displayName,
      startedAt: s.createdAt,
    })),
  });
});

streams.post('/streams', requireUser, async (req: AuthedRequest, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (!title || title.length > 80) return res.status(400).json({ error: 'Title must be 1-80 characters' });
  if (findBlockedTerm(title)) return res.status(400).json({ error: 'That title breaks the Community Guidelines' });

  // One live stream per host: close any left open by a crashed app.
  await Stream.updateMany({ host: req.userId, status: 'live' }, { status: 'ended', endedAt: new Date() });
  const user = await User.findById(req.userId).select('displayName').lean();
  const stream = await Stream.create({ host: req.userId, title });
  const token = await createRoomToken({ streamId: String(stream._id), identity: req.userId!, name: user!.displayName, isHost: true });
  res.status(201).json({ stream: { id: String(stream._id), title }, token, url: config.livekitUrl });
});

streams.post('/streams/:id/join', requireUser, async (req: AuthedRequest, res) => {
  if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Stream not found' });
  const stream = await Stream.findById(req.params.id).populate('host', 'displayName').lean<any>();
  if (!stream || stream.status !== 'live') return res.status(404).json({ error: 'This stream has ended' });
  const hidden = await hiddenUserIds(req.userId!);
  if (hidden.some((id) => String(id) === String(stream.host._id))) return res.status(403).json({ error: 'Unavailable' });

  const user = await User.findById(req.userId).select('displayName').lean();
  const isHost = String(stream.host._id) === req.userId;
  const token = await createRoomToken({ streamId: String(stream._id), identity: req.userId!, name: user!.displayName, isHost });
  res.json({
    stream: { id: String(stream._id), title: stream.title, hostId: String(stream.host._id), hostName: stream.host.displayName },
    token,
    url: config.livekitUrl,
  });
});

streams.post('/streams/:id/end', requireUser, async (req: AuthedRequest, res) => {
  if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Stream not found' });
  const stream = await Stream.findOneAndUpdate(
    { _id: req.params.id, host: req.userId, status: 'live' },
    { status: 'ended', endedAt: new Date() },
    { new: true },
  ).lean();
  if (!stream) return res.status(404).json({ error: 'Stream not found' });
  roomService.deleteRoom(roomNameFor(String(stream._id))).catch(() => {});
  res.json({ diamondsEarned: stream.diamondsEarned });
});

streams.post('/streams/:id/gifts', requireUser, async (req: AuthedRequest, res) => {
  const gift = findGift(String(req.body?.giftId));
  const quantity = Number(req.body?.quantity ?? 1);
  if (!gift || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return res.status(400).json({ error: 'Invalid gift' });
  if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'Stream not found' });
  const stream = await Stream.findById(req.params.id).lean();
  if (!stream || stream.status !== 'live') return res.status(404).json({ error: 'This stream has ended' });
  const hostId = String(stream.host);
  if (hostId === req.userId) return res.status(400).json({ error: "You can't gift yourself" });

  const cost = gift.coins * quantity;
  // Conditional decrement is atomic: concurrent taps can never overdraw.
  const sender = await User.findOneAndUpdate(
    { _id: req.userId, coins: { $gte: cost } },
    { $inc: { coins: -cost } },
    { new: true },
  ).lean();
  if (!sender) return res.status(402).json({ error: 'Not enough coins' });

  const diamonds = diamondsForGift(gift, quantity);
  await Promise.all([
    User.updateOne({ _id: hostId }, { $inc: { diamonds } }),
    Stream.updateOne({ _id: stream._id }, { $inc: { diamondsEarned: diamonds } }),
    Ledger.insertMany([
      { user: req.userId, kind: 'gift_sent', coins: -cost, meta: { giftId: gift.id, quantity, stream: stream._id, to: hostId } },
      { user: hostId, kind: 'gift_received', diamonds, meta: { giftId: gift.id, quantity, stream: stream._id, from: req.userId } },
    ]),
  ]);

  broadcast(String(stream._id), 'gift', {
    giftId: gift.id, emoji: gift.emoji, name: gift.name, quantity, from: sender.displayName,
  }).catch((e) => console.warn('gift broadcast failed', e));

  res.json({ coins: sender.coins });
});
