import { Router } from 'express';
import { requireAdmin } from '../auth';
import { roomNameFor, roomService } from '../livekit';
import { Ledger, Payout, Report, Stream, User, isObjectId } from '../models';

// Ops endpoints, called with the `x-admin-key` header (curl / a future admin page).
export const admin = Router();
admin.use('/admin', requireAdmin);

admin.get('/admin/reports', async (req, res) => {
  const reports = await Report.find({ status: String(req.query.status ?? 'open') as 'open' })
    .sort({ createdAt: -1 }).limit(200)
    .populate('reporter target', 'displayName email').lean();
  res.json({ reports });
});

admin.post('/admin/reports/:id', async (req, res) => {
  const status = req.body?.status;
  if (!['actioned', 'dismissed'].includes(status)) return res.status(400).json({ error: 'status must be actioned|dismissed' });
  await Report.updateOne({ _id: req.params.id }, { status });
  res.json({ ok: true });
});

admin.post('/admin/users/:id/ban', async (req, res) => {
  if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid user' });
  await User.updateOne({ _id: req.params.id }, { banned: true });
  const live = await Stream.find({ host: req.params.id, status: 'live' }).select('_id').lean();
  await Stream.updateMany({ host: req.params.id, status: 'live' }, { status: 'ended', endedAt: new Date() });
  await Promise.all(live.map((s) => roomService.deleteRoom(roomNameFor(String(s._id))).catch(() => {})));
  res.json({ ok: true, streamsEnded: live.length });
});

admin.get('/admin/payouts', async (req, res) => {
  const payouts = await Payout.find({ status: String(req.query.status ?? 'pending') as 'pending' })
    .sort({ createdAt: 1 }).populate('user', 'displayName email').lean();
  res.json({ payouts });
});

// Call after you've sent the money from Wise.
admin.post('/admin/payouts/:id/paid', async (req, res) => {
  const payout = await Payout.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },
    { status: 'paid', paidAt: new Date(), note: req.body?.note },
    { new: true },
  );
  if (!payout) return res.status(404).json({ error: 'No pending payout with that id' });
  res.json({ payout });
});

admin.post('/admin/payouts/:id/reject', async (req, res) => {
  const payout = await Payout.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },
    { status: 'rejected', note: req.body?.note },
    { new: true },
  );
  if (!payout) return res.status(404).json({ error: 'No pending payout with that id' });
  await User.updateOne({ _id: payout.user }, { $inc: { diamonds: payout.diamonds } });
  await Ledger.create({ user: payout.user, kind: 'adjust', diamonds: payout.diamonds, meta: { refundOfPayout: payout._id } });
  res.json({ payout });
});
