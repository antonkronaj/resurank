/// <reference lib="webworker" />

import {EMBEDDING_MAX_LENGTH} from './constants.js';

declare const self: DedicatedWorkerGlobalScope;

const DEFAULT_MODEL_ID = 'Xenova/jina-embeddings-v2-small-en';

let _pipelinePromise: Promise<any> | null = null;
let _config: {
  cacheDir?: string;
  wasmPaths?: string;
  modelId?: string;
  modelHost?: string;
  remotePathTemplate?: string;
} = {};

async function getEmbedder(): Promise<any> {
  if (_pipelinePromise) return _pipelinePromise;
  _pipelinePromise = (async () => {
    const {env, pipeline} = await import('@huggingface/transformers');
    env.allowRemoteModels = true;
    env.allowLocalModels = false;
    (env as any).useBrowserCache = true;

    // Both undefined by default, leaving transformers.js's own default (the
    // Hugging Face Hub) untouched — this is what the desktop build still
    // uses. A same-origin caller (the web build, under COEP `require-corp`,
    // which blocks a cross-origin model fetch entirely) sets both to point
    // at a locally mirrored copy instead.
    if (_config.modelHost) {
      env.remoteHost = _config.modelHost;
    }
    if (_config.remotePathTemplate) {
      env.remotePathTemplate = _config.remotePathTemplate;
    }

    if (_config.cacheDir) {
      env.cacheDir = _config.cacheDir;
    }

    if (env.backends.onnx.wasm) {
      if (_config.wasmPaths) {
        (env.backends.onnx.wasm as any).wasmPaths = _config.wasmPaths;
      }
      const isolated = (self as any).crossOriginIsolated === true;
      const hwc = self.navigator?.hardwareConcurrency ?? 4;
      (env.backends.onnx.wasm as any).numThreads = isolated ? Math.min(4, hwc) : 1;
    }

    return pipeline('feature-extraction', _config.modelId ?? DEFAULT_MODEL_ID, {
      dtype: 'q8',
      progress_callback: (progress: any) => {
        if (progress.status === 'progress') {
          self.postMessage({
            type: 'downloadProgress',
            file: progress.file,
            progress: progress.progress,
            loaded: progress.loaded,
            total: progress.total,
          });
        } else if (progress.status === 'initiate') {
          self.postMessage({type: 'downloadStart', file: progress.file});
        } else if (progress.status === 'done') {
          self.postMessage({type: 'downloadDone', file: progress.file});
        }
      },
    });
  })();
  return _pipelinePromise;
}

async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const embedder = await getEmbedder();
  const output = await embedder(texts, {
    pooling: 'mean',
    normalize: true,
    truncation: true,
    max_length: EMBEDDING_MAX_LENGTH,
  });
  return output.tolist() as number[][];
}

let _eagerLoadStarted = false;
function triggerEagerLoad(): void {
  if (_eagerLoadStarted) return;
  _eagerLoadStarted = true;
  getEmbedder()
    .then(() => self.postMessage({ready: true}))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({type: 'loadError', message});
    });
}

self.addEventListener('message', async (event: MessageEvent) => {
  const message = event.data;

  if (message && message.type === 'setConfig') {
    _config = {
      cacheDir: message.cacheDir,
      wasmPaths: message.wasmPaths,
      modelId: message.modelId,
      modelHost: message.modelHost,
      remotePathTemplate: message.remotePathTemplate,
    };
    triggerEagerLoad();
    return;
  }

  const {id, texts} = message;
  try {
    const vectors = await embed(texts);
    self.postMessage({id, vectors});
  } catch (error) {
    self.postMessage({id, error: error instanceof Error ? error.message : String(error)});
  }
});

setTimeout(triggerEagerLoad, 500);
