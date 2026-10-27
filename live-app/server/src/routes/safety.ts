import { Router } from 'express';
import { requireUser, type AuthedRequest } from '../auth';
import { Report, User, isObjectId } from '../models';

export const safety = Router();

safety.post('/reports', requireUser, async (req: AuthedRequest, res) => {
  const { targetUserId, streamId, reason } = req.body ?? {};
  if (!isObjectId(targetUserId) || typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ error: 'Invalid report' });
  await Report.create({
    reporter: req.userId,
    target: targetUserId,
    stream: isObjectId(streamId) ? streamId : undefined,
    reason: reason.trim().slice(0, 500),
  });
  res.status(201).json({ ok: true });
});

safety.post('/blocks/:userId', requireUser, async (req: AuthedRequest, res) => {
  if (!isObjectId(req.params.userId) || req.params.userId === req.userId) return res.status(400).json({ error: 'Invalid user' });
  await User.updateOne({ _id: req.userId }, { $addToSet: { blocked: req.params.userId } });
  res.json({ ok: true });
});

safety.delete('/blocks/:userId', requireUser, async (req: AuthedRequest, res) => {
  await User.updateOne({ _id: req.userId }, { $pull: { blocked: req.params.userId } });
  res.json({ ok: true });
});
