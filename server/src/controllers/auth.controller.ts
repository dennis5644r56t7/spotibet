import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Lazy resolution ensures dotenv has loaded before the secret is read.
function getJwtSecret(): string {
  return process.env.JWT_SECRET || 'secret';
}

export class AuthController {
  /**
   * Register a new user
   */
  static async register(req: Request, res: Response) {
    try {
      const { email, username, password } = req.body;

      if (!email || !username || !password) {
        return res.status(400).json({ message: 'Email, username, and password are required' });
      }

      if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
      }

      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [{ email }, { username }],
        },
      });

      if (existingUser) {
        return res.status(400).json({ message: 'A user with this email or username already exists' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: {
          email,
          username,
          password: hashedPassword,
          realBalance: 0.0,
          demoBalance: 10000.0, // generous starter demo balance
        },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          realBalance: true,
          demoBalance: true,
          createdAt: true,
        },
      });

      const token = jwt.sign(
        { id: user.id, email: user.email, username: user.username, role: user.role },
        getJwtSecret(),
        { expiresIn: (JWT_EXPIRES_IN as any) || '7d' }
      );

      return res.status(201).json({
        message: 'Account created successfully',
        user,
        token,
      });
    } catch (error: any) {
      console.error('Registration error:', error);
      return res.status(500).json({ message: 'Failed to create account', error: error.message });
    }
  }

  /**
   * Login with email or username
   */
  static async login(req: Request, res: Response) {
    try {
      const { login, password } = req.body; // login can be email or username

      if (!login || !password) {
        return res.status(400).json({ message: 'Login identifier and password are required' });
      }

      const user = await prisma.user.findFirst({
        where: {
          OR: [{ email: login }, { username: login }],
        },
      });

      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, username: user.username, role: user.role },
        getJwtSecret(),
        { expiresIn: (JWT_EXPIRES_IN as any) || '7d' }
      );

      return res.json({
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          realBalance: user.realBalance,
          demoBalance: user.demoBalance,
        },
        token,
      });
    } catch (error: any) {
      console.error('Login error:', error);
      return res.status(500).json({ message: 'Failed to login', error: error.message });
    }
  }

  /**
   * Instant Guest Play Session (No registration barrier)
   */
  static async guest(req: Request, res: Response) {
    try {
      const guestId = `guest_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const randomPassword = await bcrypt.hash(guestId, 10);

      const user = await prisma.user.create({
        data: {
          email: `${guestId}@casino.demo`,
          username: `Pilot_${guestId.slice(-4)}`,
          password: randomPassword,
          demoBalance: 10000.0,
          realBalance: 0.0,
        },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          realBalance: true,
          demoBalance: true,
        },
      });

      const token = jwt.sign(
        { id: user.id, email: user.email, username: user.username, role: user.role },
        getJwtSecret(),
        { expiresIn: '30d' as any }
      );

      return res.status(201).json({
        message: 'Guest session created',
        user,
        token,
      });
    } catch (error: any) {
      console.error('Guest creation error:', error);
      return res.status(500).json({ message: 'Failed to create guest session', error: error.message });
    }
  }

  /**
   * Get current authenticated user profile
   */
  static async me(req: AuthRequest, res: Response) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          realBalance: true,
          demoBalance: true,
          clientSeed: true,
          createdAt: true,
        },
      });

      if (!user) return res.status(404).json({ message: 'User not found' });
      return res.json({ user });
    } catch (error: any) {
      return res.status(500).json({ message: 'Failed to fetch user', error: error.message });
    }
  }
}
