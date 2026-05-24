import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

import { initDatabase } from './db';
import authRoutes from './routes/auth.routes';
import templatesRoutes from './routes/templates.routes';
import submissionsRoutes from './routes/submissions.routes';
import eventsRoutes from './routes/events.routes';
import { broadcastHeartbeat } from './sse-bus';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.API_PORT || '3000', 10);

// ─── Security Headers ─────────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
app.use(
  cors({
    origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ─── Body Parsing (limit 2 MB) ────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/submissions', submissionsRoutes);
app.use('/api/events', eventsRoutes);

// ─── 404 Fallback ─────────────────────────────────────────────────────────────
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
const start = async () => {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`[API] Server running on port ${PORT}`);
      // Global heartbeat — pings all connected SSE admin clients every 25 s
      setInterval(broadcastHeartbeat, 25_000);
    });
  } catch (err) {
    console.error('[API] Failed to start:', err);
    process.exit(1);
  }
};

start();
