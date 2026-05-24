import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { addSseClient, removeSseClient } from '../sse-bus';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

// ─── GET /api/events/submissions  (Admin SSE stream) ─────────────────────────
// EventSource API cannot set custom Authorization headers, so the JWT is
// passed as a URL query parameter: ?token=<jwt>
//
// The connection sends:
//   - An initial "connected" event when the admin connects
//   - A "submission" event each time a new entry is saved anywhere
//   - A SSE comment heartbeat every 25 s (keeps the connection alive through proxies)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/submissions', (req: Request, res: Response): void => {
  // ── Auth via query-param token ────────────────────────────────────────────
  const token = req.query['token'] as string | undefined;

  if (!token) {
    res.status(401).json({ error: 'Unauthorized: No token provided' });
    return;
  }

  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    return;
  }

  // ── Set SSE response headers ──────────────────────────────────────────────
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx proxy buffering

  res.flushHeaders(); // Send headers immediately so the client opens the stream

  // ── Register this connection ──────────────────────────────────────────────
  addSseClient(res);
  console.log(`[SSE] Admin connected (${(global as any).__sseCount = ((global as any).__sseCount || 0) + 1} active)`);

  // ── Send initial "connected" confirmation event ───────────────────────────
  res.write(`event: connected\ndata: {"status":"live"}\n\n`);

  // ── Heartbeat every 25 s to prevent proxy timeout ────────────────────────
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      clearInterval(heartbeatInterval);
    }
  }, 25_000);

  // ── Cleanup on disconnect ─────────────────────────────────────────────────
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    removeSseClient(res);
    console.log('[SSE] Admin disconnected');
  });
});

export default router;
