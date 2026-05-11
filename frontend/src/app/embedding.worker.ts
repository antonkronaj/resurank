/// <reference lib="webworker" />

import { pipeline, env } from '@huggingface/transformers';

env.allowRemoteModels = true;
env.allowLocalModels = false;
env.useBrowserCache = false;

// Serve WASM runtime from local assets instead of jsDelivr CDN.
// wasmPaths must be { mjs, wasm } — transformers fetches both and converts
// the .mjs to a blob URL before calling import(), bypassing script-src CSP.
if (env.backends.onnx.wasm) {
  const ortBase = new URL('assets/ort/', new URL('.', self.location.href).href).href;
  (env.backends.onnx.wasm as any).wasmPaths = {
    mjs: `${ortBase}ort-wasm-simd-threaded.asyncify.mjs`,
    wasm: `${ortBase}ort-wasm-simd-threaded.asyncify.wasm`,
  };
  (env.backends.onnx.wasm as any).numThreads = 1;
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
  const output = await embedder(texts, { pooling: 'mean', normalize: true, truncation: true, max_length: 8192 });
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
