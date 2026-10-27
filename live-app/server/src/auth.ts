import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config';
import { User } from './models';

export interface AuthedRequest extends Request {
  userId?: string;
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '30d' });
}

export async function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    const { sub } = jwt.verify(token, config.jwtSecret) as { sub: string };
    const user = await User.findById(sub).select('banned deletedAt').lean();
    if (!user || user.deletedAt) return res.status(401).json({ error: 'Not signed in' });
    if (user.banned) return res.status(403).json({ error: 'Account suspended' });
    req.userId = sub;
    next();
  } catch {
    res.status(401).json({ error: 'Not signed in' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!config.adminKey || req.headers['x-admin-key'] !== config.adminKey) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}
