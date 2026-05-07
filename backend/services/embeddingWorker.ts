import { pipeline, env } from '@huggingface/transformers';

// Disable native onnx; fall back to WASM for stability across platforms.
(env.backends.onnx as any).enabled = false;

if (process.env.TRANSFORMERS_CACHE_DIR) {
  env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR;
}

env.allowRemoteModels = true;

if (env.backends.onnx.wasm) {
  (env.backends.onnx.wasm as any).numThreads = 1;
}

env.allowLocalModels = false;

let _embedder: any = null;

async function getEmbedder(): Promise<any> {
  if (!_embedder) {
    console.log('[EmbeddingWorker] Loading model...');
    try {
      console.log('[EmbeddingWorker] Calling pipeline...');
      _embedder = await pipeline('feature-extraction', 'Xenova/jina-embeddings-v2-small-en', {
        dtype: 'fp32',
        progress_callback: (progress: any) => {
          console.log(`[EmbeddingWorker] Progress: ${progress.status} ${progress.file || ''} ${progress.progress || ''}`);
          if (progress.status === 'progress') {
            process.send?.({
              type: 'downloadProgress',
              file: progress.file,
              progress: progress.progress,
              loaded: progress.loaded,
              total: progress.total
            });
          } else if (progress.status === 'initiate') {
            process.send?.({ type: 'downloadStart', file: progress.file });
          } else if (progress.status === 'done') {
            process.send?.({ type: 'downloadDone', file: progress.file });
          }
        }
      });
      console.log('[EmbeddingWorker] Model loaded successfully');
    } catch (err) {
      console.error('[EmbeddingWorker] Error loading model:', err);
      throw err;
    }
  }
  return _embedder;
}

async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const embedder = await getEmbedder();
  const output = await embedder(texts, { pooling: 'mean', normalize: true, truncation: true, max_length: 8192 });
  return output.tolist() as number[][];
}

interface IncomingMessage {
  id: string;
  texts: string[];
}

process.on('message', async (message: IncomingMessage) => {
  console.log(`[EmbeddingWorker] Received batch id: ${message.id} (${message.texts.length} texts)`);
  try {
    const vectors = await embed(message.texts);
    process.send?.({ id: message.id, vectors });
  } catch (error) {
    console.error(`[EmbeddingWorker] Error during embedding for id ${message.id}:`, error);
    process.send?.({ id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
});

console.log('[EmbeddingWorker] Worker script starting...');
getEmbedder()
  .then(() => {
    console.log('[EmbeddingWorker] Sending ready signal...');
    process.send?.({ ready: true });
    console.log('[EmbeddingWorker] Ready signal sent');
    setInterval(() => { /* keep alive */ }, 1000);
  })
  .catch((err) => {
    console.error('[EmbeddingWorker] Failed to load model:', err);
    const message = err instanceof Error ? err.message : String(err);
    process.send?.({ type: 'loadError', message });
    process.exit(1);
  });
