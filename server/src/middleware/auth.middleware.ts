import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db';

// Lazy resolution ensures dotenv has loaded before the secret is read.
function getJwtSecret(): string {
  return process.env.JWT_SECRET || 'secret';
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    username: string;
    role: 'USER' | 'ADMIN';
  };
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Authentication required. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, getJwtSecret()) as any;

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, username: true, role: true },
    });

    if (!user) {
      return res.status(401).json({ message: 'Invalid session or user no longer exists.' });
    }

    req.user = user as any;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired authentication token.' });
  }
}

export function adminOnly(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin privileges required.' });
  }
  next();
}
