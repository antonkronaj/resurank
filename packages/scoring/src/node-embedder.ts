import {EMBEDDING_MAX_LENGTH} from './constants.js';
import {EMBEDDING_MODEL} from './model.js';
import type {Embedder} from './types.js';

export interface NodeEmbedderOptions {
  cacheDir?: string;
  modelId?: string;
  cacheSize?: number;
  onProgress?: (event: {status: string; file?: string; progress?: number; loaded?: number; total?: number}) => void;
  onEmbedStart?: (textCount: number, cacheHits: number) => void;
  onEmbedEnd?: (durationMs: number) => void;
}

export interface NodeEmbedder extends Embedder {
  warmup(): Promise<void>;
  /** The model id in use — `options.modelId` when given, otherwise the package default. */
  readonly modelId: string;
}

const DEFAULT_CACHE_SIZE = 16;

export function createTransformersEmbedder(options: NodeEmbedderOptions = {}): NodeEmbedder {
  const modelId = options.modelId ?? EMBEDDING_MODEL.id;
  let pipelinePromise: Promise<any> | null = null;
  const cacheMax = options.cacheSize ?? DEFAULT_CACHE_SIZE;
  const textCache = new Map<string, number[]>();

  function cachePut(text: string, vector: number[]): void {
    if (textCache.has(text)) textCache.delete(text);
    textCache.set(text, vector);
    while (textCache.size > cacheMax) {
      const oldest = textCache.keys().next().value;
      if (oldest === undefined) break;
      textCache.delete(oldest);
    }
  }

  async function getPipeline(): Promise<any> {
    if (pipelinePromise) return pipelinePromise;
    pipelinePromise = (async () => {
      const {env, pipeline} = await import('@huggingface/transformers');
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      if (options.cacheDir) {
        env.cacheDir = options.cacheDir;
      }
      return pipeline('feature-extraction', modelId, {
        dtype: EMBEDDING_MODEL.dtype,
        progress_callback: (p: any) => options.onProgress?.(p),
      });
    })();
    return pipelinePromise;
  }

  return {
    modelId,

    async warmup(): Promise<void> {
      await getPipeline();
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
        } else {
          missIndices.push(i);
          missTexts.push(texts[i]);
        }
      }

      const cacheHits = texts.length - missTexts.length;
      options.onEmbedStart?.(texts.length, cacheHits);

      if (missTexts.length > 0) {
        const started = Date.now();
        const pipe = await getPipeline();
        const output = await pipe(missTexts, {
          pooling: 'mean',
          normalize: true,
          truncation: true,
          max_length: EMBEDDING_MAX_LENGTH,
        });
        const fetched = output.tolist() as number[][];
        for (let k = 0; k < missIndices.length; k++) {
          out[missIndices[k]] = fetched[k];
          cachePut(missTexts[k], fetched[k]);
        }
        options.onEmbedEnd?.(Date.now() - started);
      } else {
        options.onEmbedEnd?.(0);
      }

      return out as number[][];
    },
  };
}
