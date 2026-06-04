import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {extractTerms, scoreResumeAgainstJob, type Embedder} from '../src/index.js';

// Fixtures live in test/fixtures/ in the source tree. The compiled test file
// runs from build-test/test/, so resolve from the package cwd (npm sets it to
// the package directory when running `npm test`).
const fixtureDir = join(process.cwd(), 'test', 'fixtures');
const resume = readFileSync(join(fixtureDir, 'resume.txt'), 'utf8');
const jd = readFileSync(join(fixtureDir, 'jd.txt'), 'utf8');

/**
 * Deterministic fake embedder for tests. We are NOT testing the embedding
 * model's quality (that belongs to Transformers.js); we are testing that the
 * scoring math, keyword extraction, and output shape don't regress.
 *
 * Strategy: hash each input text into a small vector. Identical texts get
 * identical vectors (so cache behavior is testable); different texts get
 * different but stable vectors. Cosine similarity will be modest — enough to
 * exercise the divergence/blend math without depending on the real model.
 */
function fakeEmbedder(): Embedder {
  return {
    async embed(texts) {
      const dim = 32;
      return texts.map(t => {
        const vec = new Array<number>(dim).fill(0);
        for (let i = 0; i < t.length; i++) {
          vec[t.charCodeAt(i) % dim] += 1;
        }
        // L2 normalize so cosine = dot product.
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map(v => v / norm);
      });
    },
  };
}

describe('extractTerms', () => {
  it('keeps multi-char tokens, drops short tokens and pure numbers', () => {
    const terms = extractTerms('TypeScript 5 yrs, React 18, Node.js 22');
    assert.ok(terms.includes('typescript'));
    assert.ok(terms.includes('react'));
    assert.ok(terms.includes('node.js'));
    assert.ok(!terms.includes('5'));
    assert.ok(!terms.includes('18'));
    assert.ok(!terms.includes('22'));
  });

  it('drops EXTRA_STOPWORDS (e.g. "experience")', () => {
    const terms = extractTerms('experience experience experience typescript');
    assert.deepEqual(terms, ['typescript']);
  });

  it('respects userStopwords', () => {
    const terms = extractTerms('alpha beta gamma', new Set(['beta']));
    assert.ok(terms.includes('alpha'));
    assert.ok(terms.includes('gamma'));
    assert.ok(!terms.includes('beta'));
  });
});

describe('scoreResumeAgainstJob (fixture)', () => {
  it('returns a well-shaped MatchResult', async () => {
    const r = await scoreResumeAgainstJob(
      resume,
      {title: 'Senior Backend Engineer', description: jd},
      fakeEmbedder(),
    );

    // Shape
    assert.equal(typeof r.score, 'number');
    assert.ok(r.score >= 0 && r.score <= 1, `score out of range: ${r.score}`);
    assert.ok(Array.isArray(r.matchedTerms));
    assert.ok(Array.isArray(r.missingTerms));
    assert.ok(Array.isArray(r.pinnedNotInJob));
    assert.ok(Array.isArray(r.jobWeighted));
    assert.ok(Array.isArray(r.jobCounts));
    assert.equal(typeof r.languageWarning, 'boolean');

    // Breakdown shape
    assert.equal(typeof r.breakdown.tfidfScore, 'number');
    assert.equal(typeof r.breakdown.embeddingScore, 'number');
    assert.equal(typeof r.breakdown.overlapBonus, 'number');
    assert.equal(typeof r.breakdown.divergencePenalty, 'number');
  });

  it('matches obvious overlapping terms from the fixture', async () => {
    const r = await scoreResumeAgainstJob(
      resume,
      {title: 'Senior Backend Engineer', description: jd},
      fakeEmbedder(),
    );

    // These terms are in both the resume and the JD; the matcher must find
    // them. If this regresses, something has broken term extraction or the
    // top-N selection.
    const expected = ['typescript', 'postgres', 'docker'];
    for (const term of expected) {
      assert.ok(
        r.matchedTerms.includes(term),
        `expected matched_keywords to include "${term}", got: ${r.matchedTerms.join(', ')}`,
      );
    }
  });

  it('English JD does not trigger languageWarning', async () => {
    const r = await scoreResumeAgainstJob(
      resume,
      {title: 'Senior Backend Engineer', description: jd},
      fakeEmbedder(),
    );
    assert.equal(r.languageWarning, false);
  });

  it('non-English JD does trigger languageWarning', async () => {
    const r = await scoreResumeAgainstJob(
      resume,
      {title: 'Senior Backend Engineer', description: 'シニアバックエンドエンジニアを募集しています。分散システムとマイクロサービスアーキテクチャの経験が必要です。'},
      fakeEmbedder(),
    );
    assert.equal(r.languageWarning, true);
  });

  it('matched_keywords is bounded by MAX_MATCHED_TERMS', async () => {
    const r = await scoreResumeAgainstJob(
      resume,
      {title: 'Senior Backend Engineer', description: jd},
      fakeEmbedder(),
    );
    assert.ok(r.matchedTerms.length <= 25, `matchedTerms exceeded display cap: ${r.matchedTerms.length}`);
  });

  it('missing pinned terms surface via missingKeyword settings', async () => {
    const r = await scoreResumeAgainstJob(
      resume,
      {title: 'Senior Backend Engineer', description: jd},
      fakeEmbedder(),
      {
        missingKeyword: {
          enabled: true,
          maxPenalty: 0.2,
          pinnedTerms: [
            // "kubernetes" is in the resume's SKILLS section, so should be matched (no penalty contribution)
            {term: 'kubernetes', importance: 'high'},
            // "rust" is in neither resume nor JD → pinnedNotInJob
            {term: 'rust', importance: 'high'},
          ],
        },
      },
    );

    assert.ok(
      r.pinnedNotInJob.includes('rust'),
      `expected pinnedNotInJob to flag "rust"; got: ${r.pinnedNotInJob.join(', ')}`,
    );
  });
});
