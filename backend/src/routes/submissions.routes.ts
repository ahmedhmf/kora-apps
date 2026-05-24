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
    const { template_id, search, limit: limitParam, offset: offsetParam } = req.query;

    const limitVal = limitParam ? parseInt(limitParam as string, 10) : 50;
    const offsetVal = offsetParam ? parseInt(offsetParam as string, 10) : 0;
    const limit = isNaN(limitVal) || limitVal < 1 ? 50 : Math.min(limitVal, 100);
    const offset = isNaN(offsetVal) || offsetVal < 0 ? 0 : offsetVal;

    let query = `
      SELECT
        id, template_id,
        respondent_name, respondent_email, is_anonymous,
        client_identifier, answers, uuid, status,
        created_at AS timestamp
      FROM survey_submissions
    `;

    const params: (string | boolean | number)[] = [];
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

    // Run count query with the same conditions
    let countQuery = 'SELECT COUNT(*) FROM survey_submissions';
    if (conditions.length > 0) {
      countQuery += ` WHERE ${conditions.join(' AND ')}`;
    }
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    query += ' ORDER BY created_at DESC';

    // Add pagination
    params.push(limit);
    query += ` LIMIT $${params.length}`;

    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    res.json({
      submissions: result.rows,
      total
    });
  } catch (err) {
    console.error('[SUBMISSIONS] GET error:', err);
    res.status(500).json({ error: 'Failed to fetch submissions.' });
  }
});

// ─── GET submissions statistics summary (ADMIN only) ─────────────────────────
router.get('/stats', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { template_id } = req.query;
    if (!template_id) {
      res.status(400).json({ error: '`template_id` is required.' });
      return;
    }

    // Fetch all submissions for this template
    const result = await pool.query(
      `SELECT status, client_identifier, answers, created_at AS timestamp
       FROM survey_submissions
       WHERE template_id = $1`,
      [template_id as string]
    );

    const rows = result.rows;
    const total = rows.length;

    // Initialize stats containers
    let syncedCount = 0;
    const starSums: Record<string, number> = {};
    const starCountsForAvg: Record<string, number> = {};
    
    const optionCounts: Record<string, Record<string, number>> = {};
    const starCounts: Record<string, Record<number, number>> = {};
    const numericLists: Record<string, number[]> = {};
    const textComments: Record<string, { client: string; text: string; timestamp: string }[]> = {};

    for (const row of rows) {
      const status: string = row.status || '';
      if (status.toLowerCase().startsWith('synced') || status.toLowerCase().startsWith('submitted')) {
        syncedCount++;
      }

      const client = row.client_identifier || 'Unknown';
      const timestamp = row.timestamp ? new Date(row.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : 'Unknown Time';
      const answers = typeof row.answers === 'string' ? JSON.parse(row.answers) : (row.answers || {});

      for (const [fieldKey, val] of Object.entries(answers)) {
        if (val === undefined || val === null || val === '') continue;

        const stringVal = String(val).trim();

        // 1. Check for options/choices (multiple choices are comma-separated)
        if (!optionCounts[fieldKey]) optionCounts[fieldKey] = {};
        const choices = stringVal.split(',').map(c => c.trim());
        for (const choice of choices) {
          if (choice) {
            optionCounts[fieldKey][choice] = (optionCounts[fieldKey][choice] || 0) + 1;
          }
        }

        // 2. Check for numeric and star rating
        const numVal = Number(stringVal);
        if (!isNaN(numVal)) {
          // It's a number — could be a star rating or numeric parameter
          if (!numericLists[fieldKey]) numericLists[fieldKey] = [];
          numericLists[fieldKey].push(numVal);

          // Star rating counts (1 to 5)
          const starRating = Math.round(numVal);
          if (starRating >= 1 && starRating <= 5) {
            if (!starCounts[fieldKey]) {
              starCounts[fieldKey] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            }
            starCounts[fieldKey][starRating] = (starCounts[fieldKey][starRating] || 0) + 1;

            starSums[fieldKey] = (starSums[fieldKey] || 0) + numVal;
            starCountsForAvg[fieldKey] = (starCountsForAvg[fieldKey] || 0) + 1;
          }
        }

        // 3. Keep text responses (only if it doesn't look like a single choice)
        if (stringVal.length > 0) {
          if (!textComments[fieldKey]) textComments[fieldKey] = [];
          // Keep only the most recent 100 entries to prevent memory overflow
          if (textComments[fieldKey].length < 100) {
            textComments[fieldKey].push({
              client,
              text: stringVal,
              timestamp
            });
          }
        }
      }
    }

    // Post-process metrics
    const starAverages: Record<string, number> = {};
    for (const [key, sum] of Object.entries(starSums)) {
      const count = starCountsForAvg[key] || 0;
      starAverages[key] = count > 0 ? parseFloat((sum / count).toFixed(1)) : 0;
    }

    const numericStats: Record<string, { min: number | string; max: number | string; avg: number | string; count: number }> = {};
    for (const [key, list] of Object.entries(numericLists)) {
      if (list.length === 0) continue;
      const min = Math.min(...list);
      const max = Math.max(...list);
      const sum = list.reduce((a, b) => a + b, 0);
      const avg = parseFloat((sum / list.length).toFixed(1));
      numericStats[key] = { min, max, avg, count: list.length };
    }

    const syncPercentage = total > 0 ? Math.round((syncedCount / total) * 100) : 0;

    res.json({
      total,
      syncPercentage,
      starAverages,
      optionCounts,
      starCounts,
      numericStats,
      textResponses: textComments
    });
  } catch (err) {
    console.error('[SUBMISSIONS] Stats error:', err);
    res.status(500).json({ error: 'Failed to compute submission statistics.' });
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
