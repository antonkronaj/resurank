### **Tagline (one line, hero text)**

> **ResuRank** — privately score how well your resume matches any job description, entirely on your own machine.
>

---

### **Short description (app store listing, ~80 words)**

ResuRank is a free, open-source desktop app that scores how well your resume matches a job description. Upload your resume PDF once, paste a job description, and get a 0–100% match score in seconds — combining semantic AI similarity with keyword overlap. All scoring runs locally; nothing leaves your computer. No subscription, no API key, no per-job limits. Customize term boosts to weight skills that matter to you, and exclude stopwords to clean up the match. Available for macOS, Windows, and Linux.

---

### **Long description (website / landing page)**

**ResuRank** is an open-source desktop application for evaluating resume-to-job fit without sending either document to a third party.

Upload your resume PDF once and ResuRank stores it locally. Then paste any job description and you get a 0–100% match score within seconds, computed by two independent methods that complement each other:

- **Semantic similarity** — both texts are converted into vector embeddings by a small, locally-running AI model that captures meaning rather than vocabulary. Catches paraphrases ("led a team" ↔ "people management") that keyword matchers miss.
- **Keyword similarity** — a TF-IDF index weighted by term rarity, with an overlap bonus for shared terms in your top resume vocabulary. Anchors the score to actual shared language.

The two are blended with a divergence adjustment that protects against false positives — if there is no real keyword overlap (e.g. a software resume against a nursing job), the embedding's signal is automatically de-weighted so abstract "professional document" similarity doesn't inflate the score.

You can boost specific terms ("Rust", "Kubernetes") to weight skills you care about, exclude stopwords to remove noise, and inspect the score breakdown to understand how each component contributed.

Everything is local. The ~25 MB embedding model is downloaded once on first launch and cached in your user data directory. Your resume PDF, settings, term boosts, and the job descriptions you paste never leave your machine. No cloud, no API keys, no usage limits, no telemetry.

Source code is AGPL-3.0 licensed.

---

### **Feature list (supplementary bullets)**

- Hybrid scoring — semantic embedding (60%) + keyword TF-IDF (40%) with divergence adjustment
- Local inference — runs entirely on your device, no internet required after first run
- Term boosting — weight specific keywords to reflect skills you want to emphasize
- Critical missing keywords — flag must-have terms; their absence from your resume reduces the score with adjustable importance tiers
- Stopword exclusion — customize the word list ignored during scoring
- Score breakdown — see embedding, TF-IDF, overlap bonus, divergence penalty, and missing keyword penalties separately
- Language detection — warns when a job description appears to be in a different language than your resume
- PDF resume parsing — upload once, reuse for every job
- Auto-update — signed updates delivered via electron-updater on macOS and Windows
- Score tiers — Poor fit / Fair / Good / Great fit at a glance

---

### **Under the hood (technical readers / developer audience)**

- **Desktop shell**: [Electron](https://www.electronjs.org/) 42 (ESM main process), packaged with [Electron Forge](https://www.electronforge.io/) — Squirrel auto-updating installer on Windows, signed + notarized `.dmg` on macOS, `.zip` on Linux.
- **Main process**: TypeScript on Node 22, file-based local storage (JSON), no HTTP server. All renderer ↔ main communication via `contextBridge` + typed `ipcMain` handlers.
- **Frontend**: [Angular](https://angular.dev/) 21, standalone components, signals. Renderer is fully sandboxed with context isolation and CSP enforced; all permission requests (mic, camera, notifications) are denied.
- **Embedding model**: [`Xenova/jina-embeddings-v2-small-en`](https://huggingface.co/Xenova/jina-embeddings-v2-small-en) (~25 MB, quantized ONNX) running via [`@huggingface/transformers`](https://huggingface.co/docs/transformers.js) inside a dedicated web worker. No native binaries required.
- **Security posture**: app served over a custom privileged `app://localhost/` scheme rather than `file://`, enabling `crossOriginIsolated` headers + `SharedArrayBuffer` for threaded WASM. macOS builds use hardened runtime + entitlements; Electron fuses lock down `RunAsNode`, embedded ASAR integrity, and `NODE_OPTIONS` env injection.
- **Data location**: `~/Library/Application Support/resurank/` (macOS), `%APPDATA%\resurank` (Windows), `~/.config/resurank` (Linux).
- **License**: AGPL-3.0.