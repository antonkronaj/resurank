import {Injectable, signal} from '@angular/core';
import {StorageService} from './storage.service';

export interface ModelStatus {
  loading: boolean;
  ready: boolean;
  progress?: number;
  file?: string;
  error?: string;
}

interface WorkerMessage {
  id?: string;
  ready?: boolean;
  vectors?: number[][];
  error?: string;
  message?: string;
  type?: string;
  file?: string;
  progress?: number;
}

@Injectable({providedIn: 'root'})
export class EmbeddingService {
  readonly status = signal<ModelStatus>({loading: false, ready: false});
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, { resolve: (v: number[][]) => void; reject: (e: Error) => void }>();
  private readyPromise: Promise<void> | null = null;
  private resumeCache: { text: string; vector: number[] } | null = null;
  private jobCache = new Map<string, number[]>();
  private readonly JOB_CACHE_MAX = 500;

  constructor(private storage: StorageService) {
  }

  warmup(): void {
    this.getWorker().catch(err => console.error('[EmbeddingService] warmup failed:', err));
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

  async embedJob(text: string): Promise<number[]> {
    const hit = this.jobCache.get(text);
    if (hit) {
      this.jobCache.delete(text);
      this.jobCache.set(text, hit);
      return hit;
    }
    const [vector] = await this.embed([text]);
    this.jobCache.set(text, vector);
    if (this.jobCache.size > this.JOB_CACHE_MAX) {
      const oldest = this.jobCache.keys().next().value;
      if (oldest !== undefined) this.jobCache.delete(oldest);
    }
    return vector;
  }

  invalidateJobCache(): void {
    this.jobCache.clear();
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const BATCH_SIZE = 10;
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const batchResults = await this.embedBatch(batch);
      results.push(...batchResults);
    }
    return results;
  }

  private async getWorker(): Promise<Worker> {
    if (this.worker && this.status().ready) return this.worker;

    if (this.readyPromise) {
      await this.readyPromise;
      return this.worker!;
    }

    this.status.set({loading: true, ready: false});

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.worker = new Worker(new URL('./embedding.worker', import.meta.url), {type: 'module'});

      // Configure cache directory
      this.storage.getUserDataPath().then(cacheDir => {
        const fullCacheDir = `${cacheDir}/model-cache`;
        console.log('[EmbeddingService] Configuring cache directory:', fullCacheDir);
        this.worker?.postMessage({type: 'setCacheDir', cacheDir: fullCacheDir});
      }).catch(() => { /* non-fatal */
      });

      this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const msg = event.data;

        if (msg.ready) {
          this.status.set({loading: false, ready: true});
          resolve();
        } else if (msg.type === 'downloadProgress') {
          this.status.set({loading: true, ready: false, progress: msg.progress, file: msg.file});
        } else if (msg.type === 'downloadStart') {
          this.status.set({loading: true, ready: false, progress: 0, file: msg.file});
        } else if (msg.type === 'downloadDone') {
          this.status.set({loading: true, ready: false, progress: 100, file: msg.file});
        } else if (msg.type === 'loadError') {
          this.status.set({loading: false, ready: false, error: msg.message});
          reject(new Error(msg.message));
        } else if (msg.id && this.pendingRequests.has(msg.id)) {
          const pending = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.vectors ?? []);
          }
        }
      };

      this.worker.onerror = (err) => {
        this.status.set({loading: false, ready: false, error: err.message});
        reject(new Error(err.message));
      };
    });

    await this.readyPromise;
    return this.worker!;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const worker = await this.getWorker();
    const id = Math.random().toString(36).substring(7);

    return new Promise<number[][]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Embedding request ${id} timed out`));
      }, 60000);

      this.pendingRequests.set(id, {
        resolve: (vectors) => {
          clearTimeout(timeout);
          resolve(vectors);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      worker.postMessage({id, texts});
    });
  }
}
