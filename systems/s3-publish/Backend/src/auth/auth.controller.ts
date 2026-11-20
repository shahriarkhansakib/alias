import { Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { UserRepository } from './user.repository';
import { hashPassword, verifyPassword, generateToken } from './auth.service';
import { config } from '../config/env';

function safeCompareTokens(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

const signupSchema = z.object({
  email: z.string().email({ message: 'Invalid email format.' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters.' }),
});

const loginSchema = z.object({
  email: z.string().email({ message: 'Invalid email format.' }),
  password: z.string().min(1, { message: 'Password is required.' }),
});

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

export class AuthController {
  private userRepository: UserRepository;

  constructor() {
    this.userRepository = new UserRepository();
  }

  signup = async (req: Request, res: Response): Promise<void> => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }

    const { email, password } = parsed.data;

    try {
      const existing = await this.userRepository.findByEmail(email);
      if (existing) {
        res.status(409).json({ success: false, error: 'Email already in use.' });
        return;
      }

      const passwordHash = await hashPassword(password);
      const user = await this.userRepository.createUser(email, passwordHash, 'user');
      const token = generateToken(user.id, user.role);

      res.cookie('auth_token', token, COOKIE_OPTIONS);
      res.status(201).json({
        success: true,
        user: { id: user.id, email: user.email, role: user.role },
      });
    } catch (err: any) {
      // Handle unique constraint violation from DB directly
      if (err?.code === '23505') {
        res.status(409).json({ success: false, error: 'Email already in use.' });
        return;
      }
      console.error('[AuthController.signup]', err);
      res.status(500).json({ success: false, error: 'Internal server error.' });
    }
  };

  login = async (req: Request, res: Response): Promise<void> => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }

    const { email, password } = parsed.data;

    try {
      const user = await this.userRepository.findByEmail(email);
      if (!user) {
        res.status(401).json({ success: false, error: 'Invalid email or password.' });
        return;
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ success: false, error: 'Invalid email or password.' });
        return;
      }

      const token = generateToken(user.id, user.role);
      res.cookie('auth_token', token, COOKIE_OPTIONS);
      res.status(200).json({
        success: true,
        user: { id: user.id, email: user.email, role: user.role },
      });
    } catch (err: any) {
      console.error('[AuthController.login]', err);
      res.status(500).json({ success: false, error: 'Internal server error.' });
    }
  };

  logout = async (_req: Request, res: Response): Promise<void> => {
    res.clearCookie('auth_token', {
      httpOnly: COOKIE_OPTIONS.httpOnly,
      secure: COOKIE_OPTIONS.secure,
      sameSite: COOKIE_OPTIONS.sameSite,
      path: COOKIE_OPTIONS.path,
    });
    res.status(200).json({ success: true });
  };

  me = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const user = await this.userRepository.findById(userId);
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found.' });
        return;
      }

      res.status(200).json({
        success: true,
        user: { id: user.id, email: user.email, role: user.role },
      });
    } catch (err: any) {
      console.error('[AuthController.me]', err);
      res.status(500).json({ success: false, error: 'Internal server error.' });
    }
  };

  ownerSetup = async (req: Request, res: Response): Promise<void> => {
    const { setupToken, email, password } = req.body;

    const envToken = process.env.OWNER_SETUP_TOKEN;
    if (!envToken || !setupToken || typeof setupToken !== 'string' || !safeCompareTokens(envToken, setupToken)) {
      res.status(403).json({ success: false, error: 'Invalid or missing setup token.' });
      return;
    }

    const parsed = signupSchema.safeParse({ email, password });
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }

    try {
      const alreadyExists = await this.userRepository.ownerExists();
      if (alreadyExists) {
        res.status(409).json({ success: false, error: 'Owner account already exists.' });
        return;
      }

      const passwordHash = await hashPassword(parsed.data.password);
      const owner = await this.userRepository.createOwnerWithAssociations(parsed.data.email, passwordHash);

      const token = generateToken(owner.id, owner.role);
      res.cookie('auth_token', token, COOKIE_OPTIONS);
      res.status(201).json({ success: true, message: 'Owner account created.' });
    } catch (err: any) {
      if (err?.code === '23505') {
        res.status(409).json({ success: false, error: 'Email already in use.' });
        return;
      }
      if (err?.message?.includes('already exists') || err?.message?.includes('Conflict')) {
        res.status(409).json({ success: false, error: err.message });
        return;
      }
      console.error('[AuthController.ownerSetup]', err);
      res.status(500).json({ success: false, error: 'Internal server error.' });
    }
  };
}
