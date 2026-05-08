# FitCheck

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Personal resume-to-job-description matcher desktop app. Upload your resume PDF, paste a job description, and get a hybrid semantic + keyword similarity score — no paid AI key required.

Features:
- **Local Scoring**: Uses a small (~25 MB) ONNX model running locally. No data leaves your machine.
- **Term Boosting**: Boost specific keywords (e.g. "Rust", "Security") to influence matching scores.
- **Stopword Exclusion**: Customize the list of words ignored during scoring.
- **Privacy First**: All data (resume, settings) stays in a local directory.

## Stack

- **Desktop shell**: Electron 35 (ESM main process, Node 22), packaged with [Electron Forge](https://www.electronforge.io/)
- **Backend**: Node.js + Express + TypeScript, file-based local storage, `pdf-parse` for resume parsing, `natural` for TF-IDF scoring. Runs in-process inside Electron's main process, bound to a random port on `127.0.0.1`.
- **Frontend**: Angular 18 (standalone components, signals). Communicates with the backend over HTTP; native Electron APIs are exposed via a preload/contextBridge.

## Structure

```
fitcheck/
├── src/
│   ├── main/        # Electron main process (starts backend, opens BrowserWindow)
│   │   └── index.ts
│   └── preload/     # contextBridge — exposes electronAPI to the renderer
│       └── index.ts
├── backend/         # Express API, matching engine, file-based storage
├── frontend/        # Angular UI
├── shared/          # Shared config (data dir resolution)
└── forge.config.ts  # Electron Forge packaging config
```

## Setup

Node is installed via mise (`mise use -g node@22`).

```bash
npm install
npm --prefix backend install
npm --prefix frontend install
```

The first `npm install` runs `electron-forge import`. The `backend/` postinstall rebuilds native modules automatically, so you generally don't need to think about native rebuilds.

If you ever see `NODE_MODULE_VERSION` errors at launch, run:

```bash
npm run rebuild:native
```

## Run the desktop app

```bash
npm run build      # builds backend, frontend, and electron main + preload
npm start          # launches Electron, loads built bundle
```

## Dev mode (Angular hot reload + DevTools)

```bash
# terminal 1 — Angular dev server on :4200
npm run dev:frontend

# terminal 2 — Electron pointed at the dev server
npm run dev:electron
```

`dev:electron` sets `JOBDASH_DEV=1`, builds the backend and main process, then opens DevTools on launch.

## Build distributable installers

```bash
npm run dist       # runs electron-forge make
```

Outputs to `out/` — `.dmg` on macOS, `.exe` (Squirrel) on Windows, `.zip` on Linux. Packaging config (icon, app ID, signing, asar unpack) lives in [`forge.config.ts`](forge.config.ts).

```bash
npm run publish    # build + publish a GitHub release
```

## Standalone backend (no Electron)

The Express server works on its own:

```bash
cd backend
npm run dev        # http://localhost:3001
```

The frontend can be served separately:

```bash
cd frontend
npm start          # http://localhost:4200
```

## Env vars

- `DATABASE_PATH` — overridden by Electron at startup to the per-user data dir; defaults to `./data/` for the standalone backend.

## Usage

1. Launch the app (`npm start`).
2. Upload your resume PDF in the Settings panel.
3. Paste a job description.
4. The app scores the job against your resume (0–100%).

## How matching works

Hybrid scoring: **70% semantic embedding + 30% TF-IDF cosine + overlap bonus**.

- Resume PDF is parsed and tokenized; stopwords are removed.
- **Embedding**: resume and job (`title + description`) are encoded with [`Xenova/jina-embeddings-v2-small-en`](https://huggingface.co/Xenova/jina-embeddings-v2-small-en) (quantized ONNX). Score is the cosine similarity of L2-normalised vectors.
- **TF-IDF**: cosine similarity over a two-document index (resume + job), plus a small bonus for term overlap with top resume terms. Matched terms surface as chips in the UI.
- Final score: `0.7 × embedding + 0.3 × tfidf`, clamped to `[0, 1]`.

> **First run** triggers a one-time download of the scoring model into `~/Library/Application Support/fitcheck/model-cache/`.

## API

The renderer talks to the backend over `http://127.0.0.1:<random port>` (port injected via `?apiPort=<n>` at launch).

- `GET /api/resume` · `POST /api/resume` (multipart `resume`, PDF)
- `GET /api/settings/stopwords` · `PUT /api/settings/stopwords`
- `GET /api/settings/term-boosts` · `PUT /api/settings/term-boosts`
- `POST /api/match`
- `GET /api/health`

## Notes

- **Data location**: `~/Library/Application Support/fitcheck/` (macOS) under Electron; `backend/data/` for the standalone backend.
- **macOS builds are arm64 only** (Apple Silicon). `onnxruntime-node` and `@huggingface/transformers` are unpacked from the asar archive so their native binaries can be loaded at runtime.
- **Security**: context isolation and sandboxing are enabled; a Content Security Policy is applied to all renderer responses; all renderer permission requests (mic, camera, notifications) are denied.
