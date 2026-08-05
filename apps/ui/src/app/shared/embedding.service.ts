import {computed, Inject, Injectable, signal} from '@angular/core';
import {EMBEDDING_MODEL, SCORING_VERSION} from '@resurank/scoring';
import {createWorkerEmbedder, type ModelStatus, type WorkerEmbedder} from '@resurank/scoring/worker-embedder';
import {MODEL_CACHE_DIR} from './model-cache-dir.token';
import {MODEL_HOST, type ModelHostConfig} from './model-host.token';
import type {ScoreProvenance} from './storage/storage-adapter';

export type {ModelStatus};

@Injectable({providedIn: 'root'})
export class EmbeddingService {
  readonly status = signal<ModelStatus>({loading: false, ready: false});

  /**
   * The model in use. Reads from the worker's report once loaded, falling back
   * to the package default before it has reported in — so the UI never renders
   * a blank where a model name belongs.
   */
  readonly modelId = computed(() => this.status().modelId ?? EMBEDDING_MODEL.id);

  /** `modelId` without the `Xenova/` org prefix, for display. */
  readonly modelLabel = computed(() => {
    const id = this.modelId();
    return id.slice(id.lastIndexOf('/') + 1);
  });

  readonly modelDtype = EMBEDDING_MODEL.dtype;
  readonly modelSizeMb = EMBEDDING_MODEL.approxSizeMb;

  private embedder: WorkerEmbedder | null = null;
  private embedderPromise: Promise<WorkerEmbedder> | null = null;

  constructor(
    @Inject(MODEL_CACHE_DIR) private getCacheDir: () => Promise<string | undefined>,
    @Inject(MODEL_HOST) private modelHostConfig: ModelHostConfig | undefined,
  ) {}

  /**
   * What to record against a score produced right now. The model id comes from
   * the worker rather than from `EMBEDDING_MODEL`, so an overridden model is
   * recorded as the one that actually ran; dtype is not overridable.
   */
  provenance(): ScoreProvenance {
    return {
      embeddingModel: this.modelId(),
      embeddingDtype: EMBEDDING_MODEL.dtype,
      scoringVersion: SCORING_VERSION,
    };
  }

  /**
   * The only entry point. Scoring reaches this through `MatcherService`'s
   * `Embedder` adapter, which is what triggers the model download on the first
   * score — there is deliberately no eager warm-up, so a user who never scores
   * never pays for the ~25 MB fetch.
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const embedder = await this.getEmbedder();
    return embedder.embed(texts);
  }

  private async getEmbedder(): Promise<WorkerEmbedder> {
    if (this.embedder) return this.embedder;
    if (this.embedderPromise) return this.embedderPromise;

    this.embedderPromise = (async () => {
      const cacheDir = await this.getCacheDir().catch(() => undefined);
      const worker = new Worker(new URL('./embedding.worker', import.meta.url), {type: 'module'});

      const embedder = createWorkerEmbedder({
        worker,
        cacheDir,
        wasmPaths: new URL('assets/ort/', new URL('.', self.location.href).href).href,
        modelHost: this.modelHostConfig?.modelHost,
        remotePathTemplate: this.modelHostConfig?.remotePathTemplate,
        onStatus: status => this.status.set(status),
      });

      await embedder.warmup();
      this.embedder = embedder;
      return embedder;
    })();

    return this.embedderPromise;
  }
}
