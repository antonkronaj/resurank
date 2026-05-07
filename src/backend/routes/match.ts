import { Router } from 'express';
import { getResumeText } from '../dal';
import { getSetting } from '../db';
import { scoreSingleJob } from '../services/matcher';

export const matchRouter = Router();

function loadBoosts(): Record<string, number> {
  const raw = getSetting('term_boosts');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

matchRouter.post('/', async (req, res) => {
  const { title, description } = req.body as { title?: string; description?: string };

  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    res.status(400).json({ error: 'description is required' });
    return;
  }

  const resumeText = getResumeText();
  if (!resumeText) {
    res.status(400).json({ error: 'No resume uploaded' });
    return;
  }

  try {
    const result = await scoreSingleJob(
      resumeText,
      { title: title?.trim() || 'Untitled', description },
      loadBoosts(),
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
