import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {hashSettings, type SettingsPayload} from '../src/lib/settings-hash.js';

/**
 * Pure unit tests — no database, unlike the rest of this suite.
 *
 * What is being pinned down is a single claim: two settings payloads share a
 * `settings_versions` row if and only if they would produce the same score.
 * Collapsing too eagerly hides a real difference behind one version id;
 * collapsing too little writes a near-duplicate row on every score, which is
 * the row explosion the shared table exists to prevent.
 */

const BASE: SettingsPayload = {
  stopwords: ['the', 'and'],
  termBoosts: {java: 3, rust: 2},
  missingKeywordSettings: {
    enabled: true,
    maxPenalty: 0.25,
    pinnedTerms: [
      {term: 'java', importance: 'high'},
      {term: 'sql', importance: 'low'},
    ],
  },
  preferenceMismatchSettings: {enabled: false, maxPenalty: 0.25, text: ''},
};

function withMissing(pinnedTerms: SettingsPayload['missingKeywordSettings']['pinnedTerms']) {
  return {...BASE, missingKeywordSettings: {...BASE.missingKeywordSettings, pinnedTerms}};
}

describe('hashSettings', () => {
  it('is stable across repeated calls', () => {
    assert.equal(hashSettings(BASE), hashSettings(BASE));
  });

  describe('orderings the scorer discards do not mint a new version', () => {
    it('ignores stopword order and duplicates (read into a Set before scoring)', () => {
      assert.equal(
        hashSettings({...BASE, stopwords: ['and', 'the', 'the']}),
        hashSettings(BASE),
      );
    });

    it('ignores term-boost key order (a lookup, not a sequence)', () => {
      assert.equal(hashSettings({...BASE, termBoosts: {rust: 2, java: 3}}), hashSettings(BASE));
    });

    it('ignores pinned-term order (the penalty sums over them)', () => {
      assert.equal(
        hashSettings(
          withMissing([
            {term: 'sql', importance: 'low'},
            {term: 'java', importance: 'high'},
          ]),
        ),
        hashSettings(BASE),
      );
    });

    it('ignores pinned-term case and surrounding space, as the scorer does', () => {
      assert.equal(
        hashSettings(
          withMissing([
            {term: '  Java ', importance: 'high'},
            {term: 'SQL', importance: 'low'},
          ]),
        ),
        hashSettings(BASE),
      );
    });

    it('drops blank pinned terms, which the scorer skips', () => {
      assert.equal(
        hashSettings(
          withMissing([...BASE.missingKeywordSettings.pinnedTerms, {term: '   ', importance: 'high'}]),
        ),
        hashSettings(BASE),
      );
    });

    it('collapses a duplicated pin onto its highest importance, as the scorer does', () => {
      assert.equal(
        hashSettings(
          withMissing([
            {term: 'java', importance: 'low'},
            {term: 'java', importance: 'high'},
            {term: 'sql', importance: 'low'},
          ]),
        ),
        hashSettings(BASE),
      );
    });
  });

  describe('differences that change a score do mint a new version', () => {
    it('separates a changed stopword list', () => {
      assert.notEqual(hashSettings({...BASE, stopwords: ['the']}), hashSettings(BASE));
    });

    it('separates a changed boost value', () => {
      assert.notEqual(
        hashSettings({...BASE, termBoosts: {java: 5, rust: 2}}),
        hashSettings(BASE),
      );
    });

    it('separates a changed pin importance', () => {
      assert.notEqual(
        hashSettings(
          withMissing([
            {term: 'java', importance: 'medium'},
            {term: 'sql', importance: 'low'},
          ]),
        ),
        hashSettings(BASE),
      );
    });

    it('separates a toggled penalty', () => {
      assert.notEqual(
        hashSettings({
          ...BASE,
          missingKeywordSettings: {...BASE.missingKeywordSettings, enabled: false},
        }),
        hashSettings(BASE),
      );
    });

    it('separates a changed penalty ceiling', () => {
      assert.notEqual(
        hashSettings({
          ...BASE,
          missingKeywordSettings: {...BASE.missingKeywordSettings, maxPenalty: 0.5},
        }),
        hashSettings(BASE),
      );
    });

    it('separates changed preference-mismatch text', () => {
      assert.notEqual(
        hashSettings({
          ...BASE,
          preferenceMismatchSettings: {...BASE.preferenceMismatchSettings, text: 'on-call'},
        }),
        hashSettings(BASE),
      );
    });
  });
});
