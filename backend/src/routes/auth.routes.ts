import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';

const router = Router();

// Strict rate limiting: 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
});

router.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || '';

    if (!adminPasswordHash) {
      console.error('[AUTH] ADMIN_PASSWORD_HASH is not set in environment.');
      res.status(500).json({ error: 'Server misconfiguration. Contact administrator.' });
      return;
    }

    // Constant-time comparison for username, then bcrypt for password
    if (username !== adminUsername) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, adminPasswordHash);
    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
    const token = jwt.sign(
      { username },
      process.env.JWT_SECRET || 'change-me-in-production',
      { expiresIn } as jwt.SignOptions
    );

    res.json({ token, username, expiresIn });
  } catch (err) {
    console.error('[AUTH] Login error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
