import {EXTRA_STOPWORDS} from './stopwords.js';

export function extractTerms(text: string, userStopwords: Set<string> = new Set()): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\-\s]/g, ' ')
    .replace(/\s+/g, ' ');

  const tokens = normalized.split(' ').filter(Boolean);
  return tokens.filter((t) => {
    if (t.length < 2) return false;
    if (EXTRA_STOPWORDS.has(t) || userStopwords.has(t)) return false;
    if (/^\d+$/.test(t)) return false;
    return true;
  });
}
