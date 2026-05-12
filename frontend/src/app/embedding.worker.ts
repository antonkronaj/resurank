/// <reference lib="webworker" />

import { pipeline, env } from '@huggingface/transformers';
import { EMBEDDING_MAX_LENGTH } from '@shared/constants';

env.allowRemoteModels = true;
env.allowLocalModels = false;
env.useBrowserCache = false;

// Serve WASM runtime from local assets instead of jsDelivr CDN. String form is
// the canonical ORT config; the threaded pre-loader resolves all variant
// filenames against this base URL.
if (env.backends.onnx.wasm) {
  const ortBase = new URL('assets/ort/', new URL('.', self.location.href).href).href;
  (env.backends.onnx.wasm as any).wasmPaths = ortBase;
  const isolated = (self as any).crossOriginIsolated === true;
  const hwc = (self as any).navigator?.hardwareConcurrency ?? 4;
  (env.backends.onnx.wasm as any).numThreads = isolated ? Math.min(4, hwc) : 1;
  console.log('[EmbeddingWorker] crossOriginIsolated:', isolated, 'numThreads:', (env.backends.onnx.wasm as any).numThreads);
}

let _embedder: any = null;

async function getEmbedder(): Promise<any> {
  if (!_embedder) {
    _embedder = await pipeline('feature-extraction', 'Xenova/jina-embeddings-v2-small-en', {
      dtype: 'q8',
      progress_callback: (progress: any) => {
        if (progress.status === 'progress') {
          self.postMessage({ type: 'downloadProgress', file: progress.file, progress: progress.progress, loaded: progress.loaded, total: progress.total });
        } else if (progress.status === 'initiate') {
          self.postMessage({ type: 'downloadStart', file: progress.file });
        } else if (progress.status === 'done') {
          self.postMessage({ type: 'downloadDone', file: progress.file });
        }
      },
    });
  }
  return _embedder;
}

async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const embedder = await getEmbedder();
  const output = await embedder(texts, { pooling: 'mean', normalize: true, truncation: true, max_length: EMBEDDING_MAX_LENGTH });
  return output.tolist() as number[][];
}

self.addEventListener('message', async (event: MessageEvent) => {
  const message = event.data;

  if (message.type === 'setCacheDir') {
    env.cacheDir = message.cacheDir;
    return;
  }

  const { id, texts } = message;
  try {
    const vectors = await embed(texts);
    self.postMessage({ id, vectors });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});

// Eagerly load model on startup
getEmbedder()
  .then(() => self.postMessage({ ready: true }))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: 'loadError', message });
  });
