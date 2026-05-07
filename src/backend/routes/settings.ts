import { Router } from 'express';
import { getSetting, setSetting } from '../db';
import { reloadUserStopwords } from '../services/resumeParser';

export const settingsRouter = Router();

// Term boosts: a map of {term: weight} that multiplies each term's TF-IDF
// weight at scoring time. Higher weight = more influence on the score.
settingsRouter.get('/term-boosts', (_req, res) => {
  const raw = getSetting('term_boosts');
  let boosts: Record<string, number> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) boosts = parsed;
    } catch { /* ignore malformed */ }
  }
  res.json({ boosts });
});

settingsRouter.put('/term-boosts', (req, res) => {
  const { boosts } = req.body as { boosts?: Record<string, number> };
  if (!boosts || typeof boosts !== 'object') {
    res.status(400).json({ error: 'boosts must be an object' });
    return;
  }

  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(boosts)) {
    const term = String(k).trim().toLowerCase();
    const weight = Number(v);
    if (term && Number.isFinite(weight) && weight > 0) clean[term] = weight;
  }

  setSetting('term_boosts', JSON.stringify(clean));
  res.json({ ok: true });
});

// User stopwords: extra words to ignore during tokenization (in addition to the
// built-in lists).
settingsRouter.get('/stopwords', (_req, res) => {
  const raw = getSetting('user_stopwords');
  let words: string[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) words = parsed.map((w) => String(w));
    } catch { /* ignore malformed */ }
  }
  res.json({ words });
});

settingsRouter.put('/stopwords', (req, res) => {
  const { words } = req.body as { words?: string[] };
  if (!Array.isArray(words)) {
    res.status(400).json({ error: 'words must be an array' });
    return;
  }

  const clean = [...new Set(
    words
      .map((w) => String(w).trim().toLowerCase())
      .filter((w) => w.length > 0),
  )];

  setSetting('user_stopwords', JSON.stringify(clean));
  reloadUserStopwords();
  res.json({ ok: true, count: clean.length });
});
