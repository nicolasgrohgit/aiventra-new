import express, { Router } from 'express';
import { config } from '../config';
import { coinsForProduct } from '../lib/economy';
import { webhookReceiver } from '../livekit';
import { Ledger, Stream, User, isObjectId } from '../models';

export const webhooks = Router();

const CREDIT_EVENTS = new Set(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE']);

// RevenueCat -> credit coins after Apple/Google confirm a consumable purchase.
// The app identifies users to RevenueCat with our Mongo user id (Purchases.logIn).
webhooks.post('/webhooks/revenuecat', express.json(), async (req, res) => {
  if (req.headers.authorization !== config.revenuecatWebhookAuth) return res.status(401).end();
  const event = req.body?.event;
  if (!event || !CREDIT_EVENTS.has(event.type)) return res.json({ ignored: true });
  const coins = coinsForProduct(event.product_id);
  if (!coins || !isObjectId(event.app_user_id)) {
    console.warn('revenuecat: unknown product or user', event.product_id, event.app_user_id);
    return res.json({ ignored: true });
  }
  try {
    // Ledger first: its unique `ref` makes RevenueCat retries a no-op.
    await Ledger.create({ user: event.app_user_id, kind: 'purchase', coins, ref: `rc_${event.id}`, meta: { productId: event.product_id, store: event.store } });
  } catch (e: any) {
    if (e?.code === 11000) return res.json({ duplicate: true });
    throw e;
  }
  await User.updateOne({ _id: event.app_user_id }, { $inc: { coins } });
  res.json({ credited: coins });
});

// LiveKit -> keep viewer counts fresh and close streams whose room emptied out.
webhooks.post('/webhooks/livekit', express.raw({ type: '*/*' }), async (req, res) => {
  let event;
  try {
    event = await webhookReceiver.receive(req.body.toString(), req.get('Authorization'));
  } catch {
    return res.status(401).end();
  }
  const streamId = event.room?.name?.replace(/^stream_/, '');
  if (!isObjectId(streamId)) return res.end();
  if (event.event === 'room_finished') {
    await Stream.updateOne({ _id: streamId, status: 'live' }, { status: 'ended', endedAt: new Date() });
  } else if (event.event === 'participant_joined' || event.event === 'participant_left') {
    await Stream.updateOne({ _id: streamId }, { viewers: Math.max(0, (event.room?.numParticipants ?? 1) - 1) });
  }
  res.end();
});
