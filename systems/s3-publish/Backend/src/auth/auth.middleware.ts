import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './auth.service';
import { config } from '../config/env';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: { userId: string; role: string };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.auth_token;
  if (!token) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ success: false, error: 'Invalid or expired session.' });
    return;
  }

  req.user = payload;
  next();
}

export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return;
  }

  if (req.user.role !== 'owner') {
    res.status(403).json({ success: false, error: 'Owner access required.' });
    return;
  }

  next();
}
