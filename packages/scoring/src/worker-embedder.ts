/// <reference lib="dom" />

import type {Embedder} from './types.js';

export interface ModelStatus {
  loading: boolean;
  ready: boolean;
  progress?: number;
  file?: string;
  error?: string;
  /**
   * The model the worker actually loaded, present once `ready` is true.
   * Reported by the worker rather than read from `EMBEDDING_MODEL.id` so that
   * a caller passing `options.modelId` still records what really ran.
   */
  modelId?: string;
}

export interface WorkerEmbedderOptions {
  /**
   * The Web Worker instance, OR a URL pointing to the worker module.
   *
   * Pass a pre-constructed Worker when using a bundler (Vite, esbuild,
   * Angular CLI, webpack 5) — those need `new Worker(new URL(..., import.meta.url), {type:'module'})`
   * to appear syntactically in the consumer's code for worker chunking to work.
   *
   * Pass a URL or string only in environments where workers resolve at runtime
   * (e.g. unbundled vanilla HTML/JS).
   */
  worker: Worker | URL | string;
  wasmPaths?: string;
  cacheDir?: string;
  modelId?: string;
  /** Same-origin host to fetch model files from, in place of the HF Hub. */
  modelHost?: string;
  /** Path template appended to `modelHost`; see transformers.js's `env.remotePathTemplate`. */
  remotePathTemplate?: string;
  onStatus?: (status: ModelStatus) => void;
}

export interface WorkerEmbedder extends Embedder {
  warmup(): Promise<void>;
  embed(texts: string[]): Promise<number[][]>;
  readonly status: ModelStatus;
}

interface WorkerMessage {
  id?: string;
  ready?: boolean;
  modelId?: string;
  vectors?: number[][];
  error?: string;
  message?: string;
  type?: string;
  file?: string;
  progress?: number;
}

/**
 * Embedded texts held in memory per embedder, evicted least-recently-used
 * first. Reads re-put the entry, which is what keeps the resume vector — read
 * on every score but written once — from aging out behind job descriptions.
 */
const CACHE_SIZE = 16;
/** Texts sent to the worker per postMessage round trip. */
const BATCH_SIZE = 10;
const REQUEST_TIMEOUT_MS = 60_000;

export function createWorkerEmbedder(options: WorkerEmbedderOptions): WorkerEmbedder {
  let worker: Worker | null = null;
  let readyPromise: Promise<void> | null = null;
  const pendingRequests = new Map<string, {resolve: (v: number[][]) => void; reject: (e: Error) => void}>();
  const textCache = new Map<string, number[]>();

  let status: ModelStatus = {loading: false, ready: false};
  function setStatus(next: ModelStatus): void {
    status = next;
    options.onStatus?.(next);
  }

  function cachePut(text: string, vector: number[]): void {
    if (textCache.has(text)) textCache.delete(text);
    textCache.set(text, vector);
    while (textCache.size > CACHE_SIZE) {
      const oldest = textCache.keys().next().value;
      if (oldest === undefined) break;
      textCache.delete(oldest);
    }
  }

  async function getWorker(): Promise<Worker> {
    if (worker && status.ready) return worker;
    if (readyPromise) {
      await readyPromise;
      return worker!;
    }

    setStatus({loading: true, ready: false});

    readyPromise = new Promise<void>((resolve, reject) => {
      worker = options.worker instanceof Worker
        ? options.worker
        : new Worker(options.worker, {type: 'module'});

      worker.postMessage({
        type: 'setConfig',
        cacheDir: options.cacheDir,
        wasmPaths: options.wasmPaths,
        modelId: options.modelId,
        modelHost: options.modelHost,
        remotePathTemplate: options.remotePathTemplate,
      });

      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const msg = event.data;

        if (msg.ready) {
          // Fall back to the configured id for workers built before the ready
          // message carried one.
          setStatus({loading: false, ready: true, modelId: msg.modelId ?? options.modelId});
          resolve();
        } else if (msg.type === 'downloadStart') {
          setStatus({loading: true, ready: false, progress: 0, file: msg.file});
        } else if (msg.type === 'downloadProgress') {
          setStatus({loading: true, ready: false, progress: msg.progress, file: msg.file});
        } else if (msg.type === 'downloadDone') {
          setStatus({loading: true, ready: false, progress: 100, file: msg.file});
        } else if (msg.type === 'loadError') {
          setStatus({loading: false, ready: false, error: msg.message});
          reject(new Error(msg.message ?? 'Worker failed to load model'));
        } else if (msg.id && pendingRequests.has(msg.id)) {
          const pending = pendingRequests.get(msg.id)!;
          pendingRequests.delete(msg.id);
          if (msg.error) pending.reject(new Error(msg.error));
          else pending.resolve(msg.vectors ?? []);
        }
      };

      worker.onerror = (err) => {
        const message = err.message || 'Worker error';
        setStatus({loading: false, ready: false, error: message});
        reject(new Error(message));
      };
    });

    await readyPromise;
    return worker!;
  }

  async function embedBatch(texts: string[]): Promise<number[][]> {
    const w = await getWorker();
    const id = Math.random().toString(36).substring(7);

    return new Promise<number[][]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`Embedding request ${id} timed out`));
      }, REQUEST_TIMEOUT_MS);

      pendingRequests.set(id, {
        resolve: (vectors) => {
          clearTimeout(timeout);
          resolve(vectors);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      w.postMessage({id, texts});
    });
  }

  return {
    get status() {
      return status;
    },

    async warmup(): Promise<void> {
      await getWorker();
    },

    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];

      const out: (number[] | undefined)[] = new Array(texts.length);
      const missIndices: number[] = [];
      const missTexts: string[] = [];
      for (let i = 0; i < texts.length; i++) {
        const cached = textCache.get(texts[i]);
        if (cached) {
          out[i] = cached;
          // Re-put on a hit so eviction is by recency, not insertion order.
          // Without this the resume vector — read on every score, written
          // once — is evicted after CACHE_SIZE new job descriptions.
          cachePut(texts[i], cached);
        } else {
          missIndices.push(i);
          missTexts.push(texts[i]);
        }
      }

      if (missTexts.length > 0) {
        const fetched: number[][] = [];
        for (let i = 0; i < missTexts.length; i += BATCH_SIZE) {
          const batch = missTexts.slice(i, i + BATCH_SIZE);
          const batchResults = await embedBatch(batch);
          fetched.push(...batchResults);
        }
        for (let k = 0; k < missIndices.length; k++) {
          out[missIndices[k]] = fetched[k];
          cachePut(missTexts[k], fetched[k]);
        }
      }

      return out as number[][];
    },
  };
}
