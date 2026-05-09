# ResuRank

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

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
resurank/
├── src/
│   ├── main/        # Electron main process (starts backend, opens BrowserWindow)
│   │   └── index.ts
│   └── preload/     # contextBridge — exposes electronAPI to the renderer
│       └── index.ts
├── backend/         # Express API, matching engine, file-based storage
├── frontend/        # Angular UI
├── shared/          # Shared config (data dir resolution)
└── forge.config.cjs  # Electron Forge packaging config
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

ResuRank scores a job description against your resume using two independent methods — **semantic embedding** and **keyword TF-IDF** — then combines them into a single percentage. Each method captures something different; together they're more reliable than either alone.

---

### Step 1 — Text preparation

Before any scoring happens, both the resume and the job description are cleaned up:

- **Stopwords are removed.** Common words ("the", "and", "is") and any words you have added to your personal exclusion list are stripped out. These words appear everywhere and would pollute the scores.
- **The job title gets extra weight.** It is repeated twice before the description when building the keyword index, so title terms count more than body text.
- **Text is sanitised for the embedding model.** HTML tags, URLs, emoji, and Markdown formatting are stripped before the text is sent to the AI model. These inflate the token count without adding meaning and can cause the model to run out of memory.
- **Inputs are capped.** The resume and job description are each capped at 32,000 characters for the UI counter, and at 6,000 characters (after sanitisation) before being sent to the embedding model.

---

### Step 2 — Embedding score (semantic similarity)

The embedding score answers: *do these two texts mean the same thing, even if they use different words?*

Both the resume and the job description are passed through a small AI model ([`Xenova/jina-embeddings-v2-small-en`](https://huggingface.co/Xenova/jina-embeddings-v2-small-en), ~25 MB, runs fully locally as a quantized ONNX file). The model converts each text into a list of numbers — a vector — that represents its meaning in space. The score is the **cosine similarity** between the two vectors: how closely they point in the same direction.

- A score of 1.0 means the texts are semantically identical.
- A score near 0 means they are completely unrelated in meaning.

The embedding is good at catching paraphrases and related concepts ("led a team" ↔ "people management") but can find abstract similarity between any two professional texts even when they share no keywords, which is why it is not used alone.

---

### Step 3 — TF-IDF score (keyword similarity)

The TF-IDF score answers: *do these two texts share the same specific words?*

TF-IDF (Term Frequency–Inverse Document Frequency) builds a two-document index from the resume and the job description, then computes their **cosine similarity** in keyword-weight space. Terms that appear in both documents contribute to the score; terms that appear in only one do not.

The weight of each term is adjusted by how rare it is across the two documents — so a common word like "experience" matters less than a specific one like "Kubernetes".

**Overlap bonus:** After computing the cosine, a small bonus is added based on how many of your top 100 resume terms also appear in the job description. Each shared term adds a little extra, up to a maximum bonus of +20 percentage points on the TF-IDF score. This rewards jobs that literally use the same vocabulary as your resume. The bonus is already included in the TF-IDF score shown in the breakdown.

**Term boosts:** If you have configured term boosts in Settings, those terms get their TF-IDF weight multiplied by the boost factor. Boosts only apply to terms that already appear in your resume — boosting a term that isn't in your resume has no effect.

---

### Step 4 — Combining the scores

Under normal conditions (when TF-IDF is meaningful), the final score is a weighted blend:

```
score = 0.60 × embedding + 0.40 × TF-IDF
```

The embedding gets more weight because it captures meaning, not just word choice. The TF-IDF anchors the score to actual shared vocabulary.

---

### Step 5 — Divergence adjustment

The embedding model can find semantic similarity between *any* two professional documents — a software resume and a nursing job description may both talk about "analysis", "documentation", and "communication", scoring high on embedding even though there is zero keyword overlap.

To correct for this, the embedding weight is **smoothly reduced as TF-IDF approaches zero**:

- **TF-IDF ≥ 15%** — TF-IDF is meaningful. Normal weights apply (60/40). No adjustment.
- **TF-IDF near 0%** — No keyword overlap at all. Embedding weight drops to 10%, TF-IDF weight rises to 90%. This collapses the score toward the near-zero TF-IDF, rather than letting the embedding carry it.
- **In between** — A smooth linear transition between those two extremes.

The "Divergence penalty" shown in the score breakdown is the difference between what the score would have been at normal weights and what it actually is after adjustment. A large penalty means TF-IDF was very low and the embedding was likely detecting false similarity.

---

### Language detection

If more than 3% of the alphabetic characters in the job description are non-ASCII (accented letters, Cyrillic, Chinese characters, etc.), a warning is shown. The embedding model has some cross-lingual capability, so it may find similarity between an English resume and a non-English job description even when there is little real overlap. The divergence adjustment also helps here since TF-IDF will typically be near zero for a foreign-language job.

---

### Score tiers

| Score  | Tier       |
|--------|------------|
| 0–29%  | Poor fit   |
| 40–49% | Fair       |
| 50–69% | Good       |
| 60%+   | Great fit  |

---

> **First run** triggers a one-time download of the scoring model into `~/Library/Application Support/resurank/model-cache/`.

## API

The renderer talks to the backend over `http://127.0.0.1:<random port>` (port injected via `?apiPort=<n>` at launch).

- `GET /api/resume` · `POST /api/resume` (multipart `resume`, PDF)
- `GET /api/settings/stopwords` · `PUT /api/settings/stopwords`
- `GET /api/settings/term-boosts` · `PUT /api/settings/term-boosts`
- `POST /api/match`
- `GET /api/health`

## Notes

- **Data location**: `~/Library/Application Support/resurank/` (macOS) under Electron; `backend/data/` for the standalone backend.
- **macOS builds are arm64 only** (Apple Silicon). `onnxruntime-node` and `@huggingface/transformers` are unpacked from the asar archive so their native binaries can be loaded at runtime.
- **Security**: context isolation and sandboxing are enabled; a Content Security Policy is applied to all renderer responses; all renderer permission requests (mic, camera, notifications) are denied.

## GitHub Secrets (for releases)

Releases are published automatically when a `v*` tag is pushed. The workflow builds on macOS, Windows, and Linux in parallel. Before that works, configure the following secrets in **Settings → Secrets and variables → Actions**.

### macOS code signing & notarization

| Secret | What it is |
|---|---|
| `CSC_LINK` | Base64-encoded Developer ID Application `.p12` certificate |
| `CSC_KEY_PASSWORD` | Password you set when exporting the `.p12` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_ID_NAME` | Your name exactly as shown on the Developer ID certificate |
| `APPLE_TEAM_ID` | 10-character Team ID from [developer.apple.com/account](https://developer.apple.com/account) → Membership |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords |

#### Exporting the certificate

1. Open **Keychain Access** on your Mac.
2. Under **My Certificates**, find your **Developer ID Application** certificate.
3. Right-click → **Export** → save as a `.p12` file and choose a password.

#### Converting the .p12 to base64 for `CSC_LINK`

```bash
base64 -i YourCertificate.p12 | pbcopy
```

This encodes the file and copies the result to your clipboard. Paste it as the `CSC_LINK` secret value.