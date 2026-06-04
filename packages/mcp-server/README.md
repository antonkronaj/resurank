# resurank-mcp

A local stdio MCP server that exposes [ResuRank](https://github.com/akronaj/resurank)'s
resume / job-description scoring as a single tool. Runs entirely on-device — no API keys,
no network calls (except a one-time ~25 MB model download on first run, cached in
`~/.cache/huggingface`).

## Tool

### `resurank_score`

Score the resume at `RESUME_PATH` against a job posting.

**Input**

| field             | type   | description                       |
| ----------------- | ------ | --------------------------------- |
| `job_title`       | string | Title of the job posting          |
| `job_description` | string | Full job description text         |

**Output** (JSON)

```jsonc
{
  "score": 73.4,                     // 0–100
  "matched_keywords": ["typescript", "react", "..."],
  "missing_keywords": ["kubernetes", "..."],
  "critical_gaps": ["kubernetes"],   // high-weight terms absent from the resume
  "score_breakdown": {
    "semantic_score": 0.78,          // embedding cosine
    "keyword_score": 0.62,           // TF-IDF cosine + overlap bonus
    "combined_score": 0.734,
    "overlap_bonus": 0.13,
    "divergence_penalty": 0.0
  },
  "language_warning": false
}
```

## Configuration

| env var       | required | description                                          |
| ------------- | -------- | ---------------------------------------------------- |
| `RESUME_PATH` | yes      | Absolute path to a `.pdf`, `.docx`, `.txt`, or `.md` |

## Local registration (Phase 1 — during development)

Build the package and point Claude Desktop at the local entry point:

```bash
cd packages/mcp-server
npm run build
```

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "resurank": {
      "command": "node",
      "args": ["/absolute/path/to/resurank/packages/mcp-server/dist/index.js"],
      "env": { "RESUME_PATH": "/absolute/path/to/your/resume.pdf" }
    }
  }
}
```

Restart Claude Desktop. The first scoring call will download the embedding model
(~25 MB); subsequent calls are fast.

## npx registration (Phase 2 — once published)

Once `resurank-mcp` is published to npm, no local build is needed:

```json
{
  "mcpServers": {
    "resurank": {
      "command": "npx",
      "args": ["-y", "resurank-mcp"],
      "env": { "RESUME_PATH": "/absolute/path/to/your/resume.pdf" }
    }
  }
}
```

## Notes

- Scoring uses the hybrid 60 % semantic + 40 % TF-IDF model from the
  [`@resurank/scoring`](../scoring) package. Both ResuRank's Electron app and
  this MCP server share the same implementation.
- The embedding model is `Xenova/jina-embeddings-v2-small-en` (q8 ONNX) via
  Transformers.js, cached in the default Hugging Face cache directory.
- v1 uses shipped defaults for stopwords / term boosts / critical-keyword pins /
  preference mismatch. Per-user configuration is not yet exposed.
