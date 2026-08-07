import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {scoreResumeAgainstJob, type Embedder} from '../src/index.js';

/**
 * The premise the whole settings-versioning system (apps/web/src/lib/
 * settings-hash.ts) rests on: two settings states that the client could send
 * in different shapes — reordered stopwords, a duplicated pin, different
 * casing — must score identically whenever `hashSettings` says they're the
 * same version. That file's own tests only check the *hash* is stable under
 * these permutations; this file checks the *scorer* actually agrees, using
 * the same reductions (`canonicalPins` there mirrors
 * `computeMissingKeywordPenalty`'s internal collapse here).
 */

const fixtureDir = join(process.cwd(), 'test', 'fixtures');
const resume = readFileSync(join(fixtureDir, 'resume.txt'), 'utf8');
const jd = readFileSync(join(fixtureDir, 'jd.txt'), 'utf8');
const job = {title: 'Senior Backend Engineer', description: jd};

/** Same fake embedder as score.test.ts — deterministic hash-based vectors, no model dependency. */
function fakeEmbedder(): Embedder {
  return {
    async embed(texts) {
      const dim = 32;
      return texts.map(t => {
        const vec = new Array<number>(dim).fill(0);
        for (let i = 0; i < t.length; i++) {
          vec[t.charCodeAt(i) % dim] += 1;
        }
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map(v => v / norm);
      });
    },
  };
}

describe('scoring determinism', () => {
  it('identical settings + model produce a bit-identical result on repeated calls', async () => {
    const options = {
      termBoosts: {typescript: 2, docker: 1.5},
      userStopwords: ['the', 'and'],
      missingKeyword: {
        enabled: true,
        maxPenalty: 0.2,
        pinnedTerms: [{term: 'kubernetes', importance: 'high' as const}],
      },
    };

    const a = await scoreResumeAgainstJob(resume, job, fakeEmbedder(), options);
    const b = await scoreResumeAgainstJob(resume, job, fakeEmbedder(), options);

    assert.deepEqual(a, b);
  });

  it('stopword order and duplicates do not change the result (matches hashSettings dedup)', async () => {
    const base = await scoreResumeAgainstJob(resume, job, fakeEmbedder(), {
      userStopwords: ['alpha', 'beta', 'gamma'],
    });
    const reorderedWithDupes = await scoreResumeAgainstJob(resume, job, fakeEmbedder(), {
      userStopwords: ['gamma', 'alpha', 'beta', 'alpha', 'gamma'],
    });

    assert.deepEqual(base, reorderedWithDupes);
  });

  it('term-boost key order does not change the result (a lookup, not a sequence)', async () => {
    const a = await scoreResumeAgainstJob(resume, job, fakeEmbedder(), {
      termBoosts: {typescript: 2, docker: 1.5, postgres: 1.2},
    });
    const b = await scoreResumeAgainstJob(resume, job, fakeEmbedder(), {
      termBoosts: {postgres: 1.2, typescript: 2, docker: 1.5},
    });

    assert.deepEqual(a, b);
  });

  it('pinned-term order, case, and a duplicate collapsed to its highest importance do not change the result', async () => {
    const canonical = await scoreResumeAgainstJob(resume, job, fakeEmbedder(), {
      missingKeyword: {
        enabled: true,
        maxPenalty: 0.2,
        pinnedTerms: [
          {term: 'kubernetes', importance: 'high'},
          {term: 'rust', importance: 'high'},
        ],
      },
    });
    const messy = await scoreResumeAgainstJob(resume, job, fakeEmbedder(), {
      missingKeyword: {
        enabled: true,
        maxPenalty: 0.2,
        pinnedTerms: [
          // reordered, re-cased, and "rust" duplicated at a lower importance
          // that should collapse onto the "high" entry below.
          {term: 'Rust', importance: 'low'},
          {term: 'RUST', importance: 'high'},
          {term: '  Kubernetes ', importance: 'high'},
        ],
      },
    });

    assert.deepEqual(canonical, messy);
  });
});
