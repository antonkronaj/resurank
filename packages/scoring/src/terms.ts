import {EXTRA_STOPWORDS} from './stopwords.js';

// Matches common phone number formats: optional country code, optional
// parens around the area code, and `.`/`-`/space separators — e.g.
// "+1 (555) 123-4567", "555-123-4567", "555.123.4567", "5551234567".
// Dashes survive extractTerms's tokenizer (only pure-digit tokens are
// dropped there), so numbers must be redacted before that step runs.
const PHONE_NUMBER_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

export function stripPhoneNumbers(text: string): string {
  return text.replace(PHONE_NUMBER_RE, ' ');
}

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
