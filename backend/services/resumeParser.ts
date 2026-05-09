import { PDFParse } from 'pdf-parse';
import natural from 'natural';
import { getSetting } from '../db.js';
import { EXTRA_STOPWORDS } from './stopwords.js';

const STOPWORDS = new Set(
  (natural as any).stopwords as string[],
);

// User-defined stopwords from the settings table. Cached on first read; call
// reloadUserStopwords() after the setting changes to invalidate.
let userStopwordsCache: Set<string> | null = null;

export function getUserStopwords(): Set<string> {
  if (userStopwordsCache) return userStopwordsCache;
  const raw = getSetting('user_stopwords');
  if (!raw) {
    userStopwordsCache = new Set();
    return userStopwordsCache;
  }
  try {
    const parsed = JSON.parse(raw);
    userStopwordsCache = new Set(
      Array.isArray(parsed) ? parsed.map((w) => String(w).toLowerCase()) : [],
    );
  } catch {
    userStopwordsCache = new Set();
  }
  return userStopwordsCache;
}

export function reloadUserStopwords(): void {
  userStopwordsCache = null;
}

export async function parseResumePdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

export function extractTerms(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\-\s]/g, ' ')
    .replace(/\s+/g, ' ');

  const userStops = getUserStopwords();
  const tokens = normalized.split(' ').filter(Boolean);
  return tokens.filter((t) => {
    if (t.length < 2) return false;
    if (STOPWORDS.has(t) || EXTRA_STOPWORDS.has(t) || userStops.has(t)) return false;
    if (/^\d+$/.test(t)) return false;
    return true;
  });
}
