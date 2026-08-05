import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {createWorkerEmbedder} from '../src/worker-embedder.js';

/**
 * Stands in for the browser Worker so the caching layer can be exercised in
 * Node. Records every text that actually reached the worker, which is what
 * makes a cache hit observable — a hit is precisely a text that never arrives.
 */
class FakeWorker {
  onmessage: ((event: {data: unknown}) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  /** Every text this worker was asked to embed, in order, including repeats. */
  readonly embedded: string[] = [];

  postMessage(message: any): void {
    if (message?.type === 'setConfig') {
      queueMicrotask(() => this.onmessage?.({data: {ready: true, modelId: 'test/model'}}));
      return;
    }
    const texts: string[] = message.texts;
    this.embedded.push(...texts);
    const vectors = texts.map((t) => [t.length]);
    queueMicrotask(() => this.onmessage?.({data: {id: message.id, vectors}}));
  }

  terminate(): void {}
}

function makeEmbedder() {
  const worker = new FakeWorker();
  // `createWorkerEmbedder` branches on `options.worker instanceof Worker`,
  // which needs the constructor to exist as a global under Node.
  (globalThis as any).Worker = FakeWorker;
  const embedder = createWorkerEmbedder({worker: worker as any});
  return {embedder, worker};
}

/** How many times this exact text reached the worker. */
function timesEmbedded(worker: FakeWorker, text: string): number {
  return worker.embedded.filter((t) => t === text).length;
}

describe('worker embedder cache', () => {
  it('serves a repeated text from cache instead of re-embedding it', async () => {
    const {embedder, worker} = makeEmbedder();

    await embedder.embed(['hello']);
    await embedder.embed(['hello']);

    assert.equal(timesEmbedded(worker, 'hello'), 1);
  });

  it('keeps a text alive when it is read on every call, past the cache size', async () => {
    const {embedder, worker} = makeEmbedder();

    // Mirrors real scoring: the same resume against many job descriptions.
    // The resume is written once and thereafter only ever read, so it survives
    // only if a cache hit refreshes recency.
    for (let i = 0; i < 40; i++) {
      await embedder.embed(['the resume', `job posting ${i}`]);
    }

    assert.equal(
      timesEmbedded(worker, 'the resume'),
      1,
      'the resume should be embedded once and read from cache thereafter',
    );
  });

  it('still evicts texts that stop being used', async () => {
    const {embedder, worker} = makeEmbedder();

    await embedder.embed(['first job']);
    for (let i = 0; i < 40; i++) {
      await embedder.embed([`job posting ${i}`]);
    }
    await embedder.embed(['first job']);

    assert.equal(
      timesEmbedded(worker, 'first job'),
      2,
      'an unused entry should age out rather than the cache growing without bound',
    );
  });

  it('reports the model id the worker says it loaded', async () => {
    const {embedder} = makeEmbedder();

    await embedder.warmup();

    assert.equal(embedder.status.modelId, 'test/model');
  });
});
