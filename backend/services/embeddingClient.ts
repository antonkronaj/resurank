import { fork, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface WorkerMessage {
  id?: string;
  ready?: boolean;
  vectors?: number[][];
  error?: string;
  type?: string;
  file?: string;
  progress?: number;
}

export interface ModelStatus {
  loading: boolean;
  ready: boolean;
  progress?: number;
  file?: string;
}

class EmbeddingClient {
  private worker: ChildProcess | null = null;
  private pendingRequests: Map<string, (vectors: number[][]) => void> = new Map();
  private readyPromise: Promise<void> | null = null;
  private status: ModelStatus = { loading: false, ready: false };

  getStatus(): ModelStatus {
    return this.status;
  }

  warmup(): void {
    this.getWorker().catch(err => console.error('[EmbeddingClient] Warmup failed:', err));
  }

  private async getWorker(): Promise<ChildProcess> {
    if (this.worker) return this.worker;

    if (this.readyPromise) {
      await this.readyPromise;
      return this.worker!;
    }

    this.readyPromise = new Promise<void>((resolve, reject) => {
      const isTs = import.meta.url.endsWith('.ts');
      const isAsar = import.meta.url.includes('app.asar');
      const isDev = !isAsar && (isTs || process.env.NODE_ENV !== 'production' || process.argv.includes('watch') || process.env.JOBDASH_DEV === '1');

      console.log(`[EmbeddingClient] Starting worker. isTs: ${isTs}, isAsar: ${isAsar}, isDev: ${isDev}`);

      const workerPath = isTs
        ? path.join(__dirname, 'embeddingWorker.ts')
        : path.join(__dirname, 'embeddingWorker.js');

      let loader: string | undefined;
      if (isDev && isTs) {
        try {
          loader = (import.meta as any).resolve('tsx');
        } catch {
          loader = 'tsx';
        }
      }

      const tsconfigPath = path.resolve(__dirname, '../../tsconfig.json');
      console.log(`[EmbeddingClient] Forking worker at ${workerPath}`);
      this.status.loading = true;

      this.worker = fork(workerPath, [], {
        execArgv: loader ? ['--import', loader] : [],
        env: {
          ...process.env,
          TSX_TSCONFIG_PATH: tsconfigPath,
          TRANSFORMERS_CACHE_DIR: process.env.DATABASE_PATH
            ? path.join(path.dirname(process.env.DATABASE_PATH), 'model-cache')
            : undefined,
          OMP_NUM_THREADS: '1',
          MKL_NUM_THREADS: '1',
          NODE_OPTIONS: '--no-warnings',
        },
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      });

      this.worker.on('message', (message: WorkerMessage) => {
        console.log('[EmbeddingClient] Received worker message:', JSON.stringify(message));
        if (message.ready) {
          this.status.ready = true;
          this.status.loading = false;
          this.status.progress = undefined;
          this.status.file = undefined;
          resolve();
        } else if (message.type === 'downloadProgress') {
          this.status.progress = message.progress;
          this.status.file = message.file;
        } else if (message.type === 'downloadStart') {
          this.status.file = message.file;
          this.status.progress = 0;
        } else if (message.type === 'downloadDone') {
          this.status.file = message.file;
          this.status.progress = 100;
        } else if (message.id && this.pendingRequests.has(message.id)) {
          const resolveReq = this.pendingRequests.get(message.id)!;
          this.pendingRequests.delete(message.id);
          if (message.error) {
            console.error(`[EmbeddingClient] Worker error: ${message.error}`);
            resolveReq([]);
          } else {
            resolveReq(message.vectors ?? []);
          }
        }
      });

      this.worker.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
          console.error(`[EmbeddingClient] Worker exited with code ${code}`);
        } else if (signal) {
          console.error(`[EmbeddingClient] Worker killed by signal ${signal}`);
        } else if (code === null) {
          console.error('[EmbeddingClient] Worker exited with code null (process killed)');
        }
        this.worker = null;
        this.readyPromise = null;
        this.status.ready = false;
        this.status.loading = false;
      });

      this.worker.on('error', (err) => {
        console.error('[EmbeddingClient] Worker error:', err);
        reject(err);
      });
    });

    await this.readyPromise;
    return this.worker!;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Batching to prevent SIGTRAP/OOM with large payloads.
    const BATCH_SIZE = 10;
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const batchResults = await this.embedBatch(batch);
      results.push(...batchResults);
    }
    return results;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const worker = await this.getWorker();
    const id = Math.random().toString(36).substring(7);

    return new Promise<number[][]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Embedding request ${id} timed out`));
      }, 60000);

      this.pendingRequests.set(id, (vectors) => {
        clearTimeout(timeout);
        resolve(vectors);
      });

      worker.send({ id, texts });
    });
  }
}

export const embeddingClient = new EmbeddingClient();
