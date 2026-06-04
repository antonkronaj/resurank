import {join} from 'node:path';
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {loadResumeText} from '../src/resume-loader.js';

const fixtures = join(process.cwd(), 'test', 'fixtures');

/**
 * These tests exist mainly to catch regressions in resume-loader's external
 * dependencies — most importantly pdfjs-dist's worker setup. The original
 * implementation forgot to set GlobalWorkerOptions.workerSrc; every PDF load
 * threw at runtime but unit-level coverage caught nothing because the loader
 * was never exercised in tests. This file closes that gap.
 *
 * Fixture: resume.pdf is generated from resume.txt via `cupsfilter` (macOS).
 * Both ship in test/fixtures/. The PDF should contain the same content as the
 * .txt; we assert that a few salient terms round-trip through the parser.
 */

describe('loadResumeText', () => {
  it('reads .txt files verbatim', async () => {
    const text = await loadResumeText(join(fixtures, 'resume.txt'));
    assert.match(text, /Jane Doe/);
    assert.match(text, /Senior Backend Engineer/);
    assert.match(text, /TypeScript/);
  });

  it('extracts text from .pdf files (workerSrc regression guard)', async () => {
    const text = await loadResumeText(join(fixtures, 'resume.pdf'));
    // pdfjs emits one text item per glyph cluster, so word boundaries can
    // come back as multiple spaces. Collapse before asserting.
    const normalized = text.replace(/\s+/g, ' ');
    assert.match(normalized, /Jane Doe/, `PDF parse missing "Jane Doe"; got first 200 chars: ${normalized.slice(0, 200)}`);
    assert.match(normalized, /TypeScript/i, 'PDF parse missing "TypeScript"');
    assert.match(normalized, /Postgres/i, 'PDF parse missing "Postgres"');
    assert.match(normalized, /Kafka/i, 'PDF parse missing "Kafka"');
  });

  it('rejects unsupported extensions with a clear error', async () => {
    await assert.rejects(
      () => loadResumeText('/tmp/not-a-real-resume.xyz'),
      /Unsupported resume file extension/,
    );
  });
});
