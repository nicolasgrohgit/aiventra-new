import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { requireUser, signToken, type AuthedRequest } from '../auth';
import { isAdult, parseDob } from '../lib/age';
import { findBlockedTerm } from '../lib/moderation';
import { User } from '../models';

export const account = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20 });

const publicUser = (u: any) => ({
  id: String(u._id),
  email: u.email,
  displayName: u.displayName,
  coins: u.coins,
  diamonds: u.diamonds,
});

account.post('/auth/signup', authLimiter, async (req, res) => {
  const { email, password, displayName, dob, acceptTerms } = req.body ?? {};
  if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 30) return res.status(400).json({ error: 'Display name must be 1-30 characters' });
  if (findBlockedTerm(displayName)) return res.status(400).json({ error: 'That display name is not allowed' });
  const birth = typeof dob === 'string' ? parseDob(dob) : undefined;
  if (!birth) return res.status(400).json({ error: 'Enter your date of birth as YYYY-MM-DD' });
  if (!isAdult(birth)) return res.status(403).json({ error: 'You must be 18 or older to use this app' });
  if (acceptTerms !== true) return res.status(400).json({ error: 'You must accept the Terms and Community Guidelines' });

  if (await User.exists({ email: email.toLowerCase() })) return res.status(409).json({ error: 'An account with this email already exists' });
  const user = await User.create({
    email,
    passwordHash: await bcrypt.hash(password, 10),
    displayName: displayName.trim(),
    dob: birth,
  });
  res.status(201).json({ token: signToken(String(user._id)), user: publicUser(user) });
});

account.post('/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = typeof email === 'string' ? await User.findOne({ email: email.toLowerCase(), deletedAt: null }) : null;
  if (!user || typeof password !== 'string' || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  if (user.banned) return res.status(403).json({ error: 'Account suspended' });
  res.json({ token: signToken(String(user._id)), user: publicUser(user) });
});

account.get('/me', requireUser, async (req: AuthedRequest, res) => {
  const user = await User.findById(req.userId).lean();
  res.json({ user: publicUser(user) });
});

account.patch('/me', requireUser, async (req: AuthedRequest, res) => {
  const { displayName } = req.body ?? {};
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 30 || findBlockedTerm(displayName)) {
    return res.status(400).json({ error: 'Invalid display name' });
  }
  const user = await User.findByIdAndUpdate(req.userId, { displayName: displayName.trim() }, { new: true }).lean();
  res.json({ user: publicUser(user) });
});

// In-app account deletion is mandatory for App Store / Play approval.
account.delete('/me', requireUser, async (req: AuthedRequest, res) => {
  await User.findByIdAndUpdate(req.userId, {
    email: `deleted_${req.userId}@deleted.invalid`,
    passwordHash: '!',
    displayName: 'Deleted user',
    blocked: [],
    deletedAt: new Date(),
  });
  res.status(204).end();
});
