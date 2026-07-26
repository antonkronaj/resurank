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
├── frontend/                # Angular 21 app (npm workspace) — builds for BOTH targets
│   └── src/app/
│       ├── shared/          # Common UI + services (app.component, api.service, matcher,
│       │                    #   embedding worker, storage/storage-adapter.ts interface)
│       ├── desktop/         # Electron-only: electron-storage.adapter, claude-desktop card
│       └── web/             # Web-only: http-storage.adapter, auth, routing, history
├── apps/
│   └── web/                 # @resurank/server — Fastify + Postgres + email + static hosting.
│                            #   Performs NO ML; embedding/scoring stay client-side.
├── packages/
│   ├── scoring/             # @resurank/scoring — pure scoring logic, exported as npm package
│   │   └── src/
│   │       ├── score.ts     # Core scoreResumeAgainstJob() function
│   │       ├── constants.ts # All numeric tuning weights
│   │       └── terms.ts     # Text pre-processing and term extraction
│   └── mcp-server/          # resurank-mcp — Claude Desktop integration via MCP protocol
├── shared/config.ts         # Env-based config (database path, port) — Electron main only
├── data/                    # Local user data (resume.json, stopwords, term boosts)
├── resources/               # App icons, test fixtures
└── forge.config.cjs         # Electron Forge packaging config
```

**Layout convention:** `packages/` holds what gets **published to npm**
(`scoring`, `mcp-server`); `apps/` holds what gets **shipped/deployed** and is
never published (`web`). Put new workspaces on the correct side of that line.

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

## Publishing

### Dependency resolution

`@resurank/scoring` is consumed in two different ways depending on context:

| Consumer | How it resolves `@resurank/scoring` | Needs publish? |
|---|---|---|
| `frontend` (desktop app) | npm workspace symlink — always uses local `packages/scoring/dist` | Never |
| `resurank-mcp` (local dev) | npm workspace symlink — always uses local `packages/scoring/dist` | Never |
| `resurank-mcp` (installed by end users via npx) | Pulled from npm registry | Yes |

Both `frontend` and `mcp-server` declare `"@resurank/scoring": "^1.0.x"`. The `^` range covers all patch and minor bumps automatically — no dependency version edit is needed in those `package.json` files unless scoring gets a **major** version bump (`1.x.x → 2.0.0`).

### Releasing a scoring change

**Desktop app only** (no npm publish required):
```bash
npm run build        # compiles scoring → frontend → electron
npm run dist         # packages new installer to out/
```

**Scoring + MCP server** (both published to npm):
```bash
# 1. Bump and publish @resurank/scoring
npm --prefix packages/scoring run version:patch   # or version:minor / version:major
npm publish --workspace packages/scoring

# 2. Bump and publish resurank-mcp
#    (no package.json edits needed for patch/minor scoring bumps)
npm --prefix packages/mcp-server run version:patch
npm publish --workspace packages/mcp-server

# 3. Build and package the desktop app
npm run dist
```

The `version:*` scripts create prefixed git tags (`scoring-v1.0.x`, `mcp-v1.0.x`) to keep scoring and MCP releases independently traceable in git history.

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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
