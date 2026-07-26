# ResuRank

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

Personal resume-to-job-description matcher desktop app. Upload your resume PDF, paste a job description, and get a hybrid semantic + keyword similarity score — no paid AI key required.

Features:
- **Local Scoring**: Uses a small (~25 MB) ONNX model running locally. No data leaves your machine.
- **Term Boosting**: Boost specific keywords (e.g. "Rust", "Security") to influence matching scores.
- **Critical Missing Keywords**: Flag must-have terms — their absence from your resume reduces the score, with adjustable importance tiers and a configurable cap.
- **Preference Mismatch Penalty**: Describe traits you don't want in a role; if a job description matches those traits, the score is reduced proportionally.
- **Stopword Exclusion**: Customize the list of words ignored during scoring.
- **Privacy First**: All data (resume, settings) stays in a local directory.

## Stack

- **Desktop shell**: Electron 42 (ESM main process, Node 22), packaged with [Electron Forge](https://www.electronforge.io/)
- **Main process**: TypeScript, file-based local storage (JSON files in the user-data dir), `ipcMain` handlers for all storage and clipboard operations. No HTTP server.
- **Frontend**: Angular 21 (standalone components, signals). All communication with the main process goes through `contextBridge`/`ipcRenderer` via `window.electronAPI`. The scoring engine runs entirely in the renderer — TF-IDF in the main thread, embedding inference in a dedicated `Worker`.
- **Embedding model**: [`Xenova/jina-embeddings-v2-small-en`](https://huggingface.co/Xenova/jina-embeddings-v2-small-en) (~25 MB ONNX, quantized) loaded via `@huggingface/transformers` inside a web worker. Downloaded on first run and cached in the user-data directory.

## Structure

```
resurank/
├── apps/
│   ├── desktop/     # Electron main process (IPC handlers, file storage, auto-update)
│   │   └── src/
│   │       ├── main/index.ts
│   │       ├── preload/index.cts   # contextBridge — exposes electronAPI to the renderer
│   │       └── config.ts
│   ├── ui/          # Angular UI + scoring engine + embedding web worker
│   └── web/         # Multi-user web API — auth, Postgres CRUD, email, static hosting
└── forge.config.cjs  # Electron Forge packaging config (runs from the repo root)
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

ResuRank uses a hybrid 60% semantic + 40% TF-IDF model with divergence
adjustment and optional critical-keyword and preference-mismatch penalties.

Full scoring documentation lives in
[`packages/scoring/README.md`](packages/scoring/README.md).

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
| `store-write-missing-keyword-settings` | renderer → main | Persists critical missing keyword settings to `missing_keyword_settings.json` |
| `store-write-preference-mismatch-settings` | renderer → main | Persists preference mismatch settings to `preference_mismatch_settings.json` |
| `update-ready` (push) | main → renderer | Fired when a new version has been downloaded |

## Notes

- **Data location**: `~/Library/Application Support/resurank/` (macOS) / `%APPDATA%\resurank` (Windows). All data is stored as JSON files; the resume PDF is saved as `resume.pdf`.
- **Embedding model**: downloaded on first run from Hugging Face into `<userData>/model-cache/`. Inference runs in a web worker inside the renderer — no native binaries required.
- **Custom protocol**: the packaged app is served over `app://localhost/` (a privileged custom scheme) rather than `file://`, so `crossOriginIsolated` headers can be set and `SharedArrayBuffer` / threaded WASM are available.
- **Security**: context isolation and sandboxing are enabled; a Content Security Policy is applied to all renderer responses; all renderer permission requests (mic, camera, notifications) are denied.

## Publishing npm packages

ResuRank ships two packages to npm alongside the desktop app:

| Package | When to publish |
|---|---|
| `@resurank/scoring` | Any scoring logic / constant change that MCP users should get |
| `resurank-mcp` | Any MCP server change, or after a scoring publish |

The **desktop app** consumes `@resurank/scoring` via the npm workspace symlink and
always uses whatever is in `packages/scoring/dist` — it never needs a scoring npm
publish. Just rebuild and dist.

**Scoring + MCP publish flow:**

```bash
# 1. Publish @resurank/scoring
npm -w @resurank/scoring run version:patch   # or version:minor / version:major
cd packages/scoring && npm publish && cd ../..

# 2. Publish resurank-mcp (no package.json edits needed for patch/minor scoring bumps)
npm -w resurank-mcp run version:patch
cd packages/mcp-server && npm publish && cd ../..

# 3. Build and package the desktop app
npm run dist
```

The `^` semver range on `@resurank/scoring` in both `apps/ui/package.json` and
`packages/mcp-server/package.json` covers all patch and minor scoring releases
automatically. Only a major scoring bump requires a manual dependency edit in those files.

See [`packages/scoring/README.md`](packages/scoring/README.md) and
[`packages/mcp-server/README.md`](packages/mcp-server/README.md) for the full
per-package version and publish steps.

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
2. Copying only `dist/`, `apps/ui/dist/`, `resources/`, `app-update.yml`, `forge.config.cjs`, and (if present) `entitlements.plist` into `$RUNNER_TEMP/app-stage`.
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