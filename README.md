# ResuRank

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

Personal resume-to-job-description matcher desktop app. Upload your resume PDF, paste a job description, and get a hybrid semantic + keyword similarity score — no paid AI key required.

Features:
- **Local Scoring**: Uses a small (~25 MB) ONNX model running locally. No data leaves your machine.
- **Term Boosting**: Boost specific keywords (e.g. "Rust", "Security") to influence matching scores.
- **Critical Missing Keywords**: Flag must-have terms — their absence from your resume reduces the score, with adjustable importance tiers and a configurable cap.
- **Stopword Exclusion**: Customize the list of words ignored during scoring.
- **Privacy First**: All data (resume, settings) stays in a local directory.

## Stack

- **Desktop shell**: Electron 42 (ESM main process, Node 22), packaged with [Electron Forge](https://www.electronforge.io/)
- **Main process**: TypeScript, file-based local storage (JSON files in the user-data dir), `ipcMain` handlers for all storage and clipboard operations. No HTTP server.
- **Frontend**: Angular 19 (standalone components, signals). All communication with the main process goes through `contextBridge`/`ipcRenderer` via `window.electronAPI`. The scoring engine runs entirely in the renderer — TF-IDF in the main thread, embedding inference in a dedicated `Worker`.
- **Embedding model**: [`Xenova/jina-embeddings-v2-small-en`](https://huggingface.co/Xenova/jina-embeddings-v2-small-en) (~25 MB ONNX, quantized) loaded via `@huggingface/transformers` inside a web worker. Downloaded on first run and cached in the user-data directory.

## Structure

```
resurank/
├── src/
│   ├── main/        # Electron main process (IPC handlers, file storage, auto-update)
│   │   └── index.ts
│   └── preload/     # contextBridge — exposes electronAPI to the renderer
│       └── index.cts
├── frontend/        # Angular UI + scoring engine + embedding web worker
├── shared/          # Shared constants and stopwords
└── forge.config.cjs  # Electron Forge packaging config
```

## Setup

Node is installed via mise (`mise use -g node@22`).

```bash
npm install
npm --prefix frontend install
```

## Run the desktop app

```bash
npm run build      # builds backend, frontend, and electron main + preload
npm start          # launches Electron, loads built bundle
```

## Dev mode (Angular hot reload + DevTools)

```bash
npm run dev:frontend # terminal 1 — Angular dev server on :4200
npm run dev:electron # terminal 2 — Electron pointed at the dev server
```

`dev:electron` sets `JOBDASH_DEV=1`, builds the main process and preload, then opens Electron with DevTools detached.

## Build distributable installers locally

```bash
npm run dist       # runs electron-forge make for the current platform
```

Outputs to `out/` — `.dmg` on macOS, `.exe` (Squirrel) on Windows, `.zip` on Linux. Packaging config (icon, app ID, signing, asar unpack) lives in [`forge.config.cjs`](forge.config.cjs).

Releases ship via the CI workflow on `v*` tag pushes — see [CI & Releases](#ci--releases) below. The `npm run publish` script in `package.json` isn't wired to an electron-forge publisher; CI handles publishing.

## Env vars

- `DATABASE_PATH` — overridden by Electron at startup to the per-user data dir (`app.getPath('userData')`).
- `JOBDASH_DEV=1` — set by `dev:electron`; makes the main process load `http://localhost:4200` and open DevTools.

## Usage

1. Launch the app (`npm start`).
2. Upload your resume PDF in the Settings panel.
3. Paste a job description.
4. The app scores the job against your resume (0–100%).

## How matching works

ResuRank scores a job description against your resume using two independent methods — **semantic embedding** and *
*keyword TF-IDF
** — then combines them into a single percentage. Each method captures something different; together they're more reliable than either alone.

---

### Step 1 — Text preparation

Before any scoring happens, both the resume and the job description are cleaned up:

- **Stopwords are removed.
  ** Common words ("the", "and", "is") and any words you have added to your personal exclusion list are stripped out. These words appear everywhere and would pollute the scores.
- **The job title gets extra weight.
  ** It is repeated twice before the description when building the keyword index, so title terms count more than body text.
- **Text is sanitised for the embedding model.
  ** HTML tags, URLs, emoji, and Markdown formatting are stripped before the text is sent to the AI model. These inflate the token count without adding meaning and can cause the model to run out of memory.
- **Inputs are capped.
  ** The resume and job description are each capped at 32,000 characters for the UI counter, and at 6,000 characters (after sanitisation) before being sent to the embedding model.

---

### Step 2 — Embedding score (semantic similarity)

The embedding score answers: *do these two texts mean the same thing, even if they use different words?*

Both the resume and the job description are passed through a small AI model ([
`Xenova/jina-embeddings-v2-small-en`](https://huggingface.co/Xenova/jina-embeddings-v2-small-en), ~25 MB, runs fully locally as a quantized ONNX file). The model converts each text into a list of numbers — a vector — that represents its meaning in space. The score is the
**cosine similarity** between the two vectors: how closely they point in the same direction.

- A score of 1.0 means the texts are semantically identical.
- A score near 0 means they are completely unrelated in meaning.

The embedding is good at catching paraphrases and related concepts ("led a team" ↔ "people management") but can find abstract similarity between any two professional texts even when they share no keywords, which is why it is not used alone.

---

### Step 3 — TF-IDF score (keyword similarity)

The TF-IDF score answers: *do these two texts share the same specific words?*

TF-IDF (Term Frequency–Inverse Document Frequency) builds a two-document index from the resume and the job description, then computes their
**cosine similarity
** in keyword-weight space. Terms that appear in both documents contribute to the score; terms that appear in only one do not.

The weight of each term is adjusted by how rare it is across the two documents — so a common word like "experience" matters less than a specific one like "Kubernetes".

**Overlap bonus:
** After computing the cosine, a small bonus is added based on how many of your top 100 resume terms also appear in the job description. Each shared term adds a little extra, up to a maximum bonus of +20 percentage points on the TF-IDF score. This rewards jobs that literally use the same vocabulary as your resume. The bonus is already included in the TF-IDF score shown in the breakdown.

**Term boosts:
** If you have configured term boosts in Settings, those terms get their TF-IDF weight multiplied by the boost factor. Boosts only apply to terms that already appear in your resume — boosting a term that isn't in your resume has no effect.

---

### Step 4 — Combining the scores

Under normal conditions (when TF-IDF is meaningful), the final score is a weighted blend:

```
score = 0.60 × embedding + 0.40 × TF-IDF
```

The embedding gets more weight because it captures meaning, not just word choice. The TF-IDF anchors the score to actual shared vocabulary.

---

### Step 5 — Divergence adjustment

The embedding model can find semantic similarity between
*any* two professional documents — a software resume and a nursing job description may both talk about "analysis", "documentation", and "communication", scoring high on embedding even though there is zero keyword overlap.

To correct for this, the embedding weight is **smoothly reduced as TF-IDF approaches zero**:

- **TF-IDF ≥ 15%** — TF-IDF is meaningful. Normal weights apply (60/40). No adjustment.
- **TF-IDF near 0%
  ** — No keyword overlap at all. Embedding weight drops to 10%, TF-IDF weight rises to 90%. This collapses the score toward the near-zero TF-IDF, rather than letting the embedding carry it.
- **In between** — A smooth linear transition between those two extremes.

The "Divergence penalty" shown in the score breakdown is the difference between what the score would have been at normal weights and what it actually is after adjustment. A large penalty means TF-IDF was very low and the embedding was likely detecting false similarity.

---

### Step 6 — Critical missing keywords (optional)

Off by default. The cosine and TF-IDF steps already account for missing words indirectly, but they treat every keyword as equally replaceable. This step lets you flag specific terms as **critical** so their absence from your resume actively reduces the score — useful when one missing keyword (e.g. "C#") is a real deal-breaker for the role.

- **Flagging terms.** Add them in Settings, or click the ⚑ button next to any keyword in the JD keywords panel. The same list applies to every job description you score.
- **Importance tiers.** Each flagged term is tagged Low, Medium (default), or High, which scales its contribution to the penalty by **0.5×, 1×, or 2×** respectively. Tiers are symmetric around medium, so a Medium flag behaves identically to an unweighted flag.
- **Formula.** Only flagged terms that appear in the current JD count. For each one, its *weight* is its JD-side TF-IDF score multiplied by its importance tier. The penalty is then:

  ```
  penalty = (missing_weight ÷ total_weight) × max_reduction
  ```

- **Max reduction slider.** Sets the `max_reduction` term in the formula above. Defaults to **25%** and is capped at **50%**. A JD where every flagged term is missing hits the cap; partial misses scale proportionally. The 50% ceiling exists so the penalty can't single-handedly dominate the score.

The penalty is applied after the divergence adjustment, as a final reduction on the combined score.

---

### Language detection

If more than 3% of the alphabetic characters in the job description are non-ASCII (accented letters, Cyrillic, Chinese characters, etc.), a warning is shown. The embedding model has some cross-lingual capability, so it may find similarity between an English resume and a non-English job description even when there is little real overlap. The divergence adjustment also helps here since TF-IDF will typically be near zero for a foreign-language job.

---

### Score tiers

| Score  | Tier      |
|--------|-----------|
| 0–29%  | Poor fit  |
| 40–49% | Fair      |
| 50–69% | Good      |
| 60%+   | Great fit |

---

> **First run** triggers a one-time download of the scoring model into `<userData>/model-cache/`.

## IPC channels

The renderer talks to the main process via `window.electronAPI` (contextBridge). The underlying IPC handles are:

| Channel | Direction | Description |
|---|---|---|
| `get-app-version` | renderer → main | Returns the current app version string |
| `write-clipboard` | renderer → main | Writes text to the system clipboard |
| `get-user-data-path` | renderer → main | Returns the user-data directory path |
| `store-read` | renderer → main | Reads the full store snapshot (resume, stopwords, term boosts) |
| `store-write-resume` | renderer → main | Persists resume JSON to `resume.json` |
| `store-save-pdf` | renderer → main | Persists the raw PDF buffer to `resume.pdf` |
| `store-write-stopwords` | renderer → main | Persists stopword list to `stopwords.json` |
| `store-write-term-boosts` | renderer → main | Persists term boost map to `term_boosts.json` |
| `update-ready` (push) | main → renderer | Fired when a new version has been downloaded |

## Notes

- **Data location**: `~/Library/Application Support/resurank/` (macOS) / `%APPDATA%\resurank` (Windows). All data is stored as JSON files; the resume PDF is saved as `resume.pdf`.
- **Embedding model**: downloaded on first run from Hugging Face into `<userData>/model-cache/`. Inference runs in a web worker inside the renderer — no native binaries required.
- **Custom protocol**: the packaged app is served over `app://localhost/` (a privileged custom scheme) rather than `file://`, so `crossOriginIsolated` headers can be set and `SharedArrayBuffer` / threaded WASM are available.
- **Security**: context isolation and sandboxing are enabled; a Content Security Policy is applied to all renderer responses; all renderer permission requests (mic, camera, notifications) are denied.

## CI & Releases

The release workflow lives at [`.github/workflows/release.yml`](.github/workflows/release.yml). It runs a 3-OS matrix (`macos-latest`, `windows-latest`, `ubuntu-latest`) on every push and on `v*` tag pushes. `dependabot/**` and `renovate/**` branches are excluded so bot branches don't burn matrix runs.

### Trigger behavior

| Trigger              | Build runs?       | macOS signed + notarized? | Published to GitHub Releases? |
|----------------------|-------------------|----------------------------|--------------------------------|
| Push to any branch   | yes               | no (`SKIP_SIGNING=1`)      | no                             |
| Push of a `v*` tag   | yes               | yes                        | yes                            |

Branch pushes give you a "does it build" signal on all three OSes without paying the cost of macOS notarization (which can add several minutes per run waiting on Apple's notary service). Only `v*` tag pushes import the signing cert, sign + notarize the dmg, and upload artifacts to the GitHub release matching the tag.

### Per-OS build path

- **macOS** — `npm run dist`. On tag pushes the Developer ID Application cert is imported into a temporary keychain and the dmg is signed + notarized. On branch pushes `SKIP_SIGNING=1` is set; `forge.config.cjs` then strips `osxSign` / `osxNotarize` from `packagerConfig` and bypasses the APPLE_* env-var presence check.
- **Linux** — straightforward `npm run dist`, produces a `.zip` via `@electron-forge/maker-zip`.
- **Windows** — uses a *pre-stage* approach (see below) to dodge a >20-minute hang in `electron-packager`'s copy phase against the workspace-hoisted `node_modules`.

### Windows pre-staging

`electron-packager`'s default behavior is to copy the entire project directory (filtered by `packagerConfig.ignore`) into a staging area. On Windows that walk over a workspace-hoisted `node_modules/` (Angular, esbuild, @rolldown, forge tooling, @types, plus the `node_modules/frontend` and `node_modules/shared` junctions that npm-workspaces creates) consistently pegs the runner at ~3 cores for 20+ minutes and never reaches the `afterCopy` hook. Defender exclusions, npm/electron caches, `derefSymlinks: false`, and workspace-junction ignore patterns didn't move the needle.

The workflow sidesteps it by:

1. Running `npm run build` at the project root.
2. Copying only `dist/`, `frontend/dist/`, `resources/`, `app-update.yml`, `forge.config.cjs`, and (if present) `entitlements.plist` into `$RUNNER_TEMP/app-stage`.
3. Writing a slim `package.json` to the stage that drops the `workspaces` key. The `dependencies` and `devDependencies` are kept so forge's CLI, makers, plugin-fuses, `@electron/fuses`, and `electron` install alongside the four runtime deps.
4. Running `npm install` in the stage — pulls a few hundred packages instead of the workspace's ~1000+.
5. `Push-Location $STAGE_DIR` and running `npm run dist` from there. Forge resolves `process.cwd()` to the slim stage, so electron-packager copies ~5k files instead of ~100k+ and completes in seconds.
6. Moving `$STAGE_DIR/out` to `<root>/out` so the publish step finds the artifacts where it expects them.

`forge.config.cjs`'s `generateAssets` hook short-circuits when `STAGE_DIR` is set, since the pre-stage step already ran the build at the project root.

### Cutting a release

1. Bump `version` in `package.json` and commit.
2. Push the commit — the matrix builds unsigned to verify everything compiles.
3. Tag the commit and push the tag:
   ```bash
   git tag v0.1.17
   git push origin v0.1.17
   ```
4. The workflow re-runs on the tag with signing enabled and publishes `*.dmg`, `*.exe`, `*.zip`, and the `latest*.yml` manifests to the GitHub release matching the tag.

### GitHub Secrets

Configure these in **Settings → Secrets and variables → Actions**. None are needed for branch builds; all are required for `v*` tag releases to produce a signed, notarized macOS dmg.

| Secret                        | What it is                                                                                                                |
|-------------------------------|---------------------------------------------------------------------------------------------------------------------------|
| `CSC_LINK`                    | Base64-encoded Developer ID Application `.p12` certificate                                                                |
| `CSC_KEY_PASSWORD`            | Password you set when exporting the `.p12`                                                                                |
| `APPLE_ID`                    | Your Apple ID email                                                                                                       |
| `APPLE_ID_NAME`               | Your name exactly as shown on the Developer ID certificate                                                                |
| `APPLE_TEAM_ID`               | 10-character Team ID from [developer.apple.com/account](https://developer.apple.com/account) → Membership                 |
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