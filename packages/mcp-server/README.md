# resurank-mcp

**Score your resume against any job description, from inside Claude Desktop. Locally.**

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets Claude
(or any MCP-compatible client) tell you how well your resume matches a job posting,
using a hybrid 60% semantic + 40% keyword model. Everything runs on-device — no API
keys, no uploads, no cloud calls. A ~25 MB embedding model is downloaded once into
the standard Hugging Face cache and re-used across sessions.

Companion to the [ResuRank desktop app](https://github.com/antonkronaj/resurank);
they share the same scoring engine via [`@resurank/scoring`](../scoring).

---

## Quick start

### Option 1: npx (recommended)

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

Restart Claude Desktop. The first scoring call downloads the embedding model
(~25 MB); subsequent calls are sub-second.

### Option 2: From inside the ResuRank desktop app

If you have the [ResuRank Electron app](https://github.com/antonkronaj/resurank)
installed, open **Settings → Claude Desktop integration → Connect**. The app
writes the MCP config for you, syncs the resume automatically when you edit it,
and gives you a Disconnect button when you're done.

---

## What you'll see in chat

> **You:** Score this against my resume. Title is Senior Backend Engineer.
> [pastes job description]
>
> **Claude:** *[calls `resurank_score`]*
>
> Your resume scored **73.4 / 100** for this role.
>
> - **Strong semantic fit (87%)** — the embedding model sees this as a very
>   strong match conceptually.
> - **Matched keywords:** typescript, postgres, docker, kubernetes, rest, ci/cd, …
> - **Missing keywords worth a look:** kafka, grpc, terraform
> - **Critical gaps** (high-weight JD terms not in your resume): kafka, grpc

The model paraphrases a `summary_for_user` field the server pre-computes, and is
explicitly instructed to trust the matched/missing arrays verbatim rather than
inferring what's on your resume.

---

## Tool reference

### `resurank_score`

Score the resume at `RESUME_PATH` against a job posting.

**Required input**

| field             | type   | description                                                                       |
| ----------------- | ------ | --------------------------------------------------------------------------------- |
| `job_title`       | string | Job title as the **user states it**. Weighted 2x in keyword scoring.              |
| `job_description` | string | Full job description body.                                                        |

**Optional input** — for iterating on resume variants without restarting Claude

| field         | type   | description                                                                |
| ------------- | ------ | -------------------------------------------------------------------------- |
| `resume_path` | string | Local path to a different resume file. Bypasses `RESUME_PATH` for this call. |
| `resume_text` | string | Inline resume text. Bypasses both `RESUME_PATH` and any file load.          |

**Output** (JSON)

```jsonc
{
  "assistant_instructions": "How to report this to the user; consumed by the model.",
  "resume": {
    "source": "env",                       // "env" | "argument_path" | "inline_text"
    "path":   "/Users/anton/resume.pdf",
    "chars":  4823,
    "modified_at": "2026-06-04T17:42:18.000Z",
    "preview": "Anton Kronaj — Senior Software Engineer…",
    "note":   "How RESUME_PATH was resolved (for the model)."
  },
  "score": 73.4,                           // 0–100
  "summary_for_user": "Score: 73.4 / 100. Semantic fit: strong (87%). …",
  "matched_keywords":  ["typescript", "postgres", "docker", "..."],
  "missing_keywords":  ["kafka", "grpc", "..."],
  "critical_gaps":     ["kafka", "grpc"],  // high-weight JD terms absent from resume
  "score_breakdown": {
    "semantic_score":    0.87,             // embedding cosine
    "keyword_score":     0.62,             // TF-IDF cosine + overlap bonus
    "combined_score":    0.734,
    "overlap_bonus":     0.13,
    "divergence_penalty": 0.0
  },
  "language_warning": false                // true when JD looks non-English
}
```

---

## Configuration

| env var       | required | description                                          |
| ------------- | -------- | ---------------------------------------------------- |
| `RESUME_PATH` | yes      | Absolute path to a `.pdf`, `.docx`, `.txt`, or `.md` |

The server `stat`s `RESUME_PATH` on every call. **Edit your resume on disk, save,
re-score — no restart required.** The cache invalidates automatically on mtime
change.

If the resume parses to fewer than 100 characters, the server returns a clear
error rather than silently scoring against an empty document. This catches
image-only PDFs (no OCR) and other parse failures.

---

## How the score works

A hybrid of two signals:

- **Semantic similarity (60%)** — cosine similarity between the embedding of the
  resume and the embedding of the JD. Uses [`Xenova/jina-embeddings-v2-small-en`](https://huggingface.co/Xenova/jina-embeddings-v2-small-en),
  a small (q8 ONNX) English embedding model that runs in Node.js via
  [Transformers.js](https://huggingface.co/docs/transformers.js). Captures
  paraphrasing and conceptual overlap.
- **Keyword overlap (40%)** — TF-IDF cosine plus an overlap bonus that rewards
  shared important terms. The JD's title is duplicated when tokenizing so it
  gets ~2x weight — a wrong title meaningfully skews the score.

A **divergence penalty** kicks in when the semantic score is high but the keyword
overlap is near zero — protects against the model finding "professional-sounding
text" similarity where no real keyword match exists.

A configurable **critical-keyword penalty** and **preference-mismatch penalty**
are wired in but use shipped defaults in this server; the ResuRank desktop app
exposes UI for them. See [`@resurank/scoring`](../scoring) for the math.

---

## Distribution

- **npm:** [`resurank-mcp`](https://www.npmjs.com/package/resurank-mcp), `npx -y resurank-mcp`
- **Source:** [github.com/antonkronaj/resurank](https://github.com/antonkronaj/resurank)

## Local registration (during development)

```bash
cd packages/mcp-server
npm run build
```

Then in `claude_desktop_config.json`:

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

Restart Claude Desktop after editing.

---

## License

[AGPL-3.0-only](../../LICENSE). If you build a hosted service that integrates
this server, the AGPL's network-clause obligations apply.

## Limitations

- English embedding model only. Non-English JDs are flagged via `language_warning`
  but still scored using whatever overlap the multilingual fallback produces.
- The embedding model is small (q8 quantized) and tuned for speed, not maximum
  semantic quality. For most resume/JD scoring this is the right tradeoff.
- This server uses shipped defaults for stopwords, term boosts, critical-keyword
  pins, and preference mismatch. The ResuRank desktop app exposes these as UI;
  customizing them here is not yet supported.
