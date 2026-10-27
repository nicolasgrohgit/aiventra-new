import { Router } from 'express';
import { requireUser, type AuthedRequest } from '../auth';
import { COIN_PACKS, GIFTS, MIN_PAYOUT_DIAMONDS, USD_PER_DIAMOND, payoutUsd } from '../lib/economy';
import { Ledger, Payout, User } from '../models';

export const wallet = Router();

wallet.get('/catalog', (_req, res) => {
  res.json({ gifts: GIFTS, coinPacks: COIN_PACKS, minPayoutDiamonds: MIN_PAYOUT_DIAMONDS, usdPerDiamond: USD_PER_DIAMOND });
});

wallet.get('/wallet', requireUser, async (req: AuthedRequest, res) => {
  const [user, payouts] = await Promise.all([
    User.findById(req.userId).select('coins diamonds').lean(),
    Payout.find({ user: req.userId }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  res.json({
    coins: user!.coins,
    diamonds: user!.diamonds,
    diamondsUsd: payoutUsd(user!.diamonds),
    payouts: payouts.map((p) => ({ id: String(p._id), diamonds: p.diamonds, amountUsd: p.amountUsd, status: p.status, createdAt: p.createdAt })),
  });
});

wallet.post('/payouts', requireUser, async (req: AuthedRequest, res) => {
  const diamonds = Number(req.body?.diamonds);
  const destination = typeof req.body?.destination === 'string' ? req.body.destination.trim() : '';
  if (!Number.isInteger(diamonds) || diamonds < MIN_PAYOUT_DIAMONDS) {
    return res.status(400).json({ error: `Minimum payout is ${MIN_PAYOUT_DIAMONDS} diamonds` });
  }
  if (!destination || destination.length > 300) return res.status(400).json({ error: 'Enter your Wise email or bank details' });
  const user = await User.findOneAndUpdate(
    { _id: req.userId, diamonds: { $gte: diamonds } },
    { $inc: { diamonds: -diamonds } },
    { new: true },
  ).lean();
  if (!user) return res.status(402).json({ error: 'Not enough diamonds' });
  const payout = await Payout.create({ user: req.userId, diamonds, amountUsd: payoutUsd(diamonds), destination });
  await Ledger.create({ user: req.userId, kind: 'payout', diamonds: -diamonds, meta: { payout: payout._id } });
  res.status(201).json({ payout: { id: String(payout._id), amountUsd: payout.amountUsd, status: payout.status }, diamonds: user.diamonds });
});
