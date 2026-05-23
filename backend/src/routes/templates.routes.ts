import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAdmin, AuthRequest } from '../auth.middleware';

const router = Router();

// ─── GET all templates (PUBLIC — kiosk needs this to load surveys) ────────────
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, fields, created_at, updated_at
       FROM survey_templates
       ORDER BY created_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[TEMPLATES] GET error:', err);
    res.status(500).json({ error: 'Failed to fetch templates.' });
  }
});

// ─── POST create / upsert template (ADMIN only) ───────────────────────────────
router.post('/', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, name, description, fields } = req.body;

    if (!id || !name || !fields) {
      res.status(400).json({ error: '`id`, `name`, and `fields` are required.' });
      return;
    }

    if (!Array.isArray(fields)) {
      res.status(400).json({ error: '`fields` must be an array.' });
      return;
    }

    await pool.query(
      `INSERT INTO survey_templates (id, name, description, fields)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET name        = $2,
             description = $3,
             fields      = $4,
             updated_at  = NOW()`,
      [id, name, description || '', JSON.stringify(fields)]
    );

    res.status(201).json({ message: 'Template saved successfully.', id });
  } catch (err) {
    console.error('[TEMPLATES] POST error:', err);
    res.status(500).json({ error: 'Failed to save template.' });
  }
});

// ─── PUT update existing template (ADMIN only) ───────────────────────────────
router.put('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, description, fields } = req.body;

    if (!name || !fields) {
      res.status(400).json({ error: '`name` and `fields` are required.' });
      return;
    }

    if (!Array.isArray(fields)) {
      res.status(400).json({ error: '`fields` must be an array.' });
      return;
    }

    const result = await pool.query(
      `UPDATE survey_templates
         SET name = $1, description = $2, fields = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING id`,
      [name, description || '', JSON.stringify(fields), id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Template not found.' });
      return;
    }

    res.json({ message: 'Template updated successfully.', id });
  } catch (err) {
    console.error('[TEMPLATES] PUT error:', err);
    res.status(500).json({ error: 'Failed to update template.' });
  }
});

// ─── DELETE template (ADMIN only) ────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM survey_templates WHERE id = $1', [id]);
    res.json({ message: 'Template deleted.' });
  } catch (err) {
    console.error('[TEMPLATES] DELETE error:', err);
    res.status(500).json({ error: 'Failed to delete template.' });
  }
});

export default router;
