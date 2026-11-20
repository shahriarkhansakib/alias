import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function generateToken(userId: string, role: string): string {
  return jwt.sign({ userId, role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as any });
}

export function verifyToken(token: string): { userId: string; role: string } | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as any;
    if (payload && payload.userId && payload.role) {
      return { userId: payload.userId, role: payload.role };
    }
    return null;
  } catch {
    return null;
  }
}
