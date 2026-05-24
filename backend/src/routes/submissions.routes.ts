import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db';
import { requireAdmin, AuthRequest } from '../auth.middleware';
import { broadcastSubmission } from '../sse-bus';

const router = Router();

// Rate limit: 60 submissions per minute per IP (kiosk friendly)
const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please wait a moment.' },
});

// ─── POST new submission (PUBLIC — kiosk submits here) ────────────────────────
router.post('/', submitLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      template_id,
      respondent_name,
      respondent_email,
      is_anonymous,
      client_identifier,
      answers,
      uuid,
    } = req.body;

    if (!template_id || !answers) {
      res.status(400).json({ error: '`template_id` and `answers` are required.' });
      return;
    }

    // When anonymous: do NOT store name / email
    const safeName  = is_anonymous ? null : (respondent_name  || null);
    const safeEmail = is_anonymous ? null : (respondent_email || null);
    const safeIdentifier = is_anonymous
      ? 'Anonymous'
      : (client_identifier || respondent_name || 'Unknown');

    const result = await pool.query(
      `INSERT INTO survey_submissions
         (template_id, respondent_name, respondent_email, is_anonymous,
          client_identifier, answers, uuid, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted')
       ON CONFLICT (uuid) DO NOTHING
       RETURNING id`,
      [
        template_id,
        safeName,
        safeEmail,
        is_anonymous ?? false,
        safeIdentifier,
        JSON.stringify(answers),
        uuid || null,
      ]
    );

    if (result.rows.length === 0) {
      // Duplicate UUID — idempotent, already saved
      res.json({ message: 'Already submitted.', id: null });
      return;
    }

    const newId: number = result.rows[0].id;

    // ─── Push real-time event to all connected admin SSE clients ──────────────
    broadcastSubmission({
      id: newId,
      template_id,
      respondent_name: safeName,
      respondent_email: safeEmail,
      is_anonymous: is_anonymous ?? false,
      client_identifier: safeIdentifier,
      answers,
      uuid: uuid || null,
      status: 'submitted',
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({ message: 'Submission saved.', id: newId });
  } catch (err) {
    console.error('[SUBMISSIONS] POST error:', err);
    res.status(500).json({ error: 'Failed to save submission.' });
  }
});

// ─── GET submissions (ADMIN only) ────────────────────────────────────────────
router.get('/', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { template_id, search } = req.query;

    let query = `
      SELECT
        id, template_id,
        respondent_name, respondent_email, is_anonymous,
        client_identifier, answers, uuid, status,
        created_at AS timestamp
      FROM survey_submissions
    `;

    const params: (string | boolean)[] = [];
    const conditions: string[] = [];

    if (template_id) {
      params.push(template_id as string);
      conditions.push(`template_id = $${params.length}`);
    }

    if (search) {
      const s = `%${search}%`;
      params.push(s);
      const n = params.length;
      conditions.push(
        `(client_identifier ILIKE $${n} OR respondent_email ILIKE $${n} OR respondent_name ILIKE $${n})`
      );
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[SUBMISSIONS] GET error:', err);
    res.status(500).json({ error: 'Failed to fetch submissions.' });
  }
});

// ─── DELETE submission (ADMIN only) ──────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM survey_submissions WHERE id = $1', [parseInt(id, 10)]);
    res.json({ message: 'Submission deleted.' });
  } catch (err) {
    console.error('[SUBMISSIONS] DELETE error:', err);
    res.status(500).json({ error: 'Failed to delete submission.' });
  }
});

export default router;
