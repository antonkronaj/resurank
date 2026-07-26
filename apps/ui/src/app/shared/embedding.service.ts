import {Inject, Injectable, signal} from '@angular/core';
import {createWorkerEmbedder, type ModelStatus, type WorkerEmbedder} from '@resurank/scoring/worker-embedder';
import {MODEL_CACHE_DIR} from './model-cache-dir.token';
import {MODEL_HOST, type ModelHostConfig} from './model-host.token';

export type {ModelStatus};

@Injectable({providedIn: 'root'})
export class EmbeddingService {
  readonly status = signal<ModelStatus>({loading: false, ready: false});
  private embedder: WorkerEmbedder | null = null;
  private embedderPromise: Promise<WorkerEmbedder> | null = null;
  private resumeCache: {text: string; vector: number[]} | null = null;
  private preferenceCache: {text: string; vector: number[]} | null = null;

  constructor(
    @Inject(MODEL_CACHE_DIR) private getCacheDir: () => Promise<string | undefined>,
    @Inject(MODEL_HOST) private modelHostConfig: ModelHostConfig | undefined,
  ) {}

  warmup(): void {
    this.getEmbedder().catch(err => console.error('[EmbeddingService] warmup failed:', err));
  }

  async embedResume(text: string): Promise<number[]> {
    if (this.resumeCache?.text === text) return this.resumeCache.vector;
    const [vector] = await this.embed([text]);
    this.resumeCache = {text, vector};
    return vector;
  }

  invalidateResumeCache(): void {
    this.resumeCache = null;
  }

  async embedPreference(text: string): Promise<number[]> {
    if (this.preferenceCache?.text === text) return this.preferenceCache.vector;
    const [vector] = await this.embed([text]);
    this.preferenceCache = {text, vector};
    return vector;
  }

  invalidatePreferenceCache(): void {
    this.preferenceCache = null;
  }

  async embedJob(text: string): Promise<number[]> {
    const [vector] = await this.embed([text]);
    return vector;
  }

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
