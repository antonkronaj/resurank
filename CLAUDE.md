# ResuRank — Developer Guide

## Project Overview

**ResuRank** is a desktop application that scores resume-to-job-description fit using 100% local AI inference (no cloud, no API keys). It is an Electron + Angular monorepo that also ships a standalone npm scoring package and an MCP server for Claude Desktop integration.

---

## Monorepo Structure

```
resurank/
├── src/                     # Electron main process (IPC, file storage, auto-updates)
│   ├── main/index.ts        # App lifecycle, window management, IPC handlers
│   └── preload/index.cts    # contextBridge — exposes electronAPI to renderer
├── frontend/                # Angular 21 app (npm workspace)
│   └── src/app/             # Standalone components, signals-based state
│       ├── app.component.ts # Root — all top-level state lives here
│       ├── *.service.ts     # Services: embedding, resume-parser, matcher, storage
│       └── embedding.worker.ts  # Web worker — ONNX model inference off main thread
├── packages/
│   ├── scoring/             # @resurank/scoring — pure scoring logic, exported as npm package
│   │   └── src/
│   │       ├── score.ts     # Core scoreResumeAgainstJob() function
│   │       ├── constants.ts # All numeric tuning weights
│   │       └── terms.ts     # Text pre-processing and term extraction
│   └── mcp-server/          # resurank-mcp — Claude Desktop integration via MCP protocol
├── shared/config.ts         # Env-based config (database path, port)
├── data/                    # Local user data (resume.json, stopwords, term boosts)
├── resources/               # App icons, test fixtures
└── forge.config.cjs         # Electron Forge packaging config
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 42 + Electron Forge |
| Frontend framework | Angular 21 (standalone components, signals) |
| Main process | TypeScript + Node 22, ESM |
| Scoring engine | Hybrid semantic (60%) + TF-IDF (40%) |
| Embedding model | Xenova/jina-embeddings-v2-small-en via Transformers.js (~25 MB ONNX) |
| Storage | Local JSON files via Electron main process |
| MCP server | Model Context Protocol for Claude Desktop |

---

## Development Workflows

### First-time setup
```bash
npm install
```

### Dev mode (hot reload)
```bash
# Terminal 1 — Angular dev server on :4200
npm run dev:frontend

# Terminal 2 — Electron with DevTools (picks up :4200 automatically)
npm run dev:electron
```

### Build everything
```bash
npm run build        # scoring → frontend → electron main/preload
```

### Run after build
```bash
npm start            # electron-forge start
```

### Create installers
```bash
npm run dist         # Outputs to out/ (.dmg / .exe / .zip)
```

### Tests (scoring package only)
```bash
npm --prefix packages/scoring run test
```

---

## Architecture Notes

- **IPC**: Renderer communicates with main process through typed `contextBridge` (`src/preload/index.cts`). Add new IPC channels there and in `src/main/index.ts` together.
- **Custom protocol**: App uses `app://localhost/` instead of `file://` to enable `crossOriginIsolated` + SharedArrayBuffer for threaded WASM.
- **Embedding**: Model inference runs in a Web Worker (`embedding.worker.ts`) to avoid blocking the UI thread.
- **Scoring formula**: `score = semantic(0.6) + tfidf(0.4)` with divergence penalty when no real keyword overlap exists. Tuning constants live entirely in `packages/scoring/src/constants.ts`.
- **Security**: Context isolation enabled, CSP enforced, all permission requests denied, ASAR integrity locked.

---

## Rules

- Use Angular components for all UI work — no vanilla DOM manipulation.
- Do not add new dependencies without asking first.
- Ask clarifying questions before starting non-trivial tasks.
- Keep scoring logic in `packages/scoring` — it is a published package and must stay framework-agnostic.
- The embedding model path and user data paths are resolved at runtime via `shared/config.ts`; do not hardcode paths.

## Branch Policy

- Work on `main` or feature branches off `main`.
- **Never** commit, merge, push, force-push, rebase, or delete the `main` branch.
