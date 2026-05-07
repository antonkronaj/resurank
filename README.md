# jobdash

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Personal job-recommendation desktop app. Pulls Software Engineer postings from five sources (Adzuna, The Muse, RemoteOK, Findwork, Workable), parses your resume PDF, and ranks jobs by hybrid semantic + keyword similarity — no paid AI key required.

Features:
- **Local Scoring**: Uses a small (~25 MB) ONNX model running locally to score jobs. No data leaves your machine for matching.
- **Manual Entries**: Add and track jobs you found elsewhere (LinkedIn, etc.).
- **Application Tracking**: Mark jobs as applied, add personal notes, and keep track of your job search progress.
- **Term Boosting**: Boost specific keywords (like "Rust" or "Security") to influence matching scores.
- **Privacy First**: All data (resume, settings) stays in a local directory.

You can visit https://publicapis.io/category/jobs to see what job APIS that are available.
## Stack

- **Desktop shell**: Electron 35 (ESM main process, ships Node 22)
- **Backend**: Node.js + Express + TypeScript, file-based local storage, `pdf-parse` for resume parsing, `natural` for TF-IDF scoring. In the desktop app this runs in-process inside Electron's main process, bound to a random port on `127.0.0.1`.
- **Frontend**: Angular 18 (standalone components, signals).

## Structure

```
jobmatch/
├── electron/     # Electron main process (loads backend in-process, opens BrowserWindow)
├── backend/      # API server, matching engine
├── frontend/     # Angular dashboard
└── package.json  # Top-level: electron + electron-builder + orchestration scripts
```

## Setup

Node is installed via mise (`mise use -g node@22`).

```bash
# from repo root — installs root deps, then both subprojects
npm install
npm --prefix backend install
npm --prefix frontend install
```

The first `npm install` runs `electron-builder install-app-deps`. The `backend/` postinstall does the same automatically whenever you reinstall backend deps, so you generally don't need to think about native rebuilds.

If you ever see `NODE_MODULE_VERSION` errors at launch, run:

```bash
npm run rebuild:native
```

## Run the desktop app

```bash
npm run build      # builds backend, frontend (with relative base href), and electron main
npm start          # launches Electron, loads built bundle
```

## Dev mode (Angular hot reload + DevTools)

```bash
# terminal 1 — Angular dev server on :4200
npm run dev:frontend

# terminal 2 — Electron pointed at the dev server
npm run dev:electron
```

`dev:electron` sets `JOBDASH_DEV=1`, builds the backend + main process, then opens DevTools on launch.

## Build distributable installers

```bash
npm run dist       # runs `npm run build` then electron-builder
```

Outputs to `dist/` (or `release/`) — `.dmg` on macOS, `.exe` (NSIS) on Windows, `AppImage` on Linux. Configure `appId`, icon, and signing in the `build` block of root `package.json`.

## Standalone backend (no Electron)

The Express server still works on its own:

```bash
cd backend
npm run dev        # http://localhost:3001
```

In standalone mode the frontend can be served by `ng serve` separately:

```bash
cd frontend
npm start          # http://localhost:4200
```

## API keys

Two ways to provide keys, in order of precedence:

1. **In-app Settings** (recommended for the desktop app) — click **Settings** in the dashboard, upload your resume or manage exclusion words.
2. **Environment variables** (fallback, also used by the standalone backend in dev) — see `backend/.env.example`.

### Env vars

- `DATABASE_PATH` — overridden by Electron at startup to point at the per-user data dir; defaults to `./data/jobmatch.db` for the standalone backend.

## Usage

1. Launch the app (`npm start`).
2. Upload your resume PDF (Settings panel).
3. Paste a Job Description.
4. The app scores the job against your resume.
5. Scores are 0–100%.

## How matching works

Hybrid scoring blends two signals: **70% semantic embedding similarity + 30% TF-IDF cosine + overlap bonus**.

- PDF text → tokenized, stopwords removed.
- **Embedding half**: resume and each job (`title + description`) are encoded with [`Xenova/jina-embeddings-v2-small-en`](https://huggingface.co/Xenova/jina-embeddings-v2-small-en) (quantized ONNX). Cosine similarity is the dot product of the L2-normalised vectors.
- **TF-IDF half**: TF-IDF over `[resume, job]` cosine similarity, plus a small bonus for overlap with the top resume terms. Matched terms are surfaced in the UI as chips.
- Final score: `0.7 × embedding + 0.3 × tfidf`, clamped to `[0, 1]`.

> **First run after install** triggers a one-time download of the scoring model into `~/Library/Application Support/jobmatch/model-cache`.

## API (consumed by the renderer over `127.0.0.1:<random port>`)

- `GET /api/resume` · `POST /api/resume` (multipart `resume`, PDF)
- `GET /api/settings/stopwords` · `PUT /api/settings/stopwords`
- `GET /api/settings/term-boosts` · `PUT /api/settings/term-boosts`
- `POST /api/match`

The renderer reads its API base from `?apiPort=<n>` injected into `index.html` at launch.

## Notes

- **Data location**: `~/Library/Application Support/jobmatch/` (macOS) when running under Electron; `backend/data/` for the standalone backend.
- **Resume uploads** are saved as PDF and metadata in the data directory.
- **macOS builds are arm64 only** (Apple Silicon). Intel Macs are not supported by the packaged DMG. The `onnxruntime-node` and `@huggingface/transformers` packages are unpacked from the asar archive at install time so their native binaries (`.node`, `.dylib`) can be loaded.

A weighted keyword is a term from the JD with a TF-IDF score attached — it's the matcher's answer to "how important is this word to this job description, relative to the resume?"

The number itself is TF × IDF:

TF (term frequency) — how often the word shows up in the JD (with the title repeated, so title words count double).
IDF (inverse document frequency) — ln(N / df) where N = number of documents in the index and df = how many of them contain this term. We have 2 documents in the index: the resume (doc 0) and the JD (doc 1). So:
Term in only the JD → df=1, IDF = ln(2/1) ≈ 0.69 → contributes weight
Term in both resume and JD → df=2, IDF = ln(2/2) = 0 → weight is zero
Term in only the resume → doesn't appear in the JD list at all
That's why the weighted view tends to surface words that are distinctive to the job — things the JD harps on that 
aren't already in your resume. [A word repeated 8 times in the JD that's nowhere in your resume gets a high weight]; a word the JD mentions twice but is also all over your resume gets weight 0.

What it's used for in the score:

- The job's term-weight vector is one half of the TF-IDF cosine similarity (the other half is the resume's weighted vector with your term boosts applied).
- The matched-term chips are resume top-75 terms that also appear in the JD's term list — the weight determines which 
  terms qualify.

What it is not:

- Not a count of occurrences — that's the "Raw counts" toggle.
- Not affected by your term boosts in the JD breakdown — boosts only multiply the resume side. The JD weights are pure TF-IDF.
- Not affected by the embedding model — embedding works on raw text, never sees these tokens.

Practical reading: 
- scan the weighted list to spot what the JD considers important that your resume doesn't already cover — those are gaps. 
- Scan the raw counts to see what the JD literally repeats most.