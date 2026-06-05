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

## Prerequisites

- **Claude Desktop** — [download from claude.ai/download](https://claude.ai/download) (macOS or Windows)
- **Node.js v22 or later** — [download from nodejs.org](https://nodejs.org) (only needed for Option 1)
- **A resume file** — `.pdf`, `.docx`, `.txt`, or `.md`; note the absolute path

---

## Setup

### Option 1 — npx (no app required)

**1. Locate the Claude Desktop config file**

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

The file may not exist yet — create it if so. On macOS you can open it in one
step:

```bash
open -a TextEdit ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

On Windows, press `Win + R`, paste `%APPDATA%\Claude`, press Enter, and open
`claude_desktop_config.json` in Notepad.

**2. Add the resurank server entry**

If the file is empty or doesn't exist yet:

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

If the file already has other MCP servers, add only the `"resurank"` key inside
the existing `"mcpServers"` object — don't replace the whole file:

```json
{
  "mcpServers": {
    "some-other-server": { "...": "..." },
    "resurank": {
      "command": "npx",
      "args": ["-y", "resurank-mcp"],
      "env": { "RESUME_PATH": "/absolute/path/to/your/resume.pdf" }
    }
  }
}
```

**3. Set `RESUME_PATH` to your actual resume**

Replace `/absolute/path/to/your/resume.pdf` with the real path. It must be
absolute (starting with `/` on macOS/Linux, or `C:\` on Windows). Relative
paths won't work. Example:

```
/Users/jane/Documents/resume.pdf
C:\Users\jane\Documents\resume.pdf
```

**4. Restart Claude Desktop**

Quit completely (Cmd-Q on macOS, or right-click the taskbar icon → Quit on
Windows) and relaunch. Claude Desktop reads the config once at startup.

**5. Verify** — see [Verifying it works](#verifying-it-works) below.

---

### Option 2 — ResuRank desktop app (automatic)

If you have the [ResuRank Electron app](https://github.com/antonkronaj/resurank)
installed, the app writes and maintains the config for you.

**1. Open ResuRank and add your resume**

Paste or import your resume text in the main view. The app stores it locally.

**2. Open Settings → Claude Desktop integration**

Click the gear icon to open Settings, then find the **Claude Desktop
integration** card.

**3. Click Connect**

ResuRank will:
- Locate your Node.js installation
- Write the `resurank` entry to `claude_desktop_config.json`
- Export your resume to a managed file and point `RESUME_PATH` at it

The card shows a ✓ Connected status when done. If the button is disabled,
hover over the warning — it will tell you what's missing (Claude Desktop not
found, Node.js not installed, etc.).

**4. Restart Claude Desktop**

Quit completely and relaunch so it picks up the new config.

**Auto-sync:** whenever you update your resume in ResuRank, the exported file
updates automatically. No reconnecting or restarting required — the server
reloads the file on the next score call.

**5. Verify** — see below.

---

## Verifying it works

Open a new conversation in Claude Desktop and type:

> Use the resurank tool to score my resume against a job posting.

Claude should ask you for a job title and description. If it does, the server
is running. (The very first score call downloads the ~25 MB embedding model
— allow 10–30 seconds depending on your connection. Subsequent calls are
sub-second.)

If the tool isn't found, see [Troubleshooting](#troubleshooting) below.

---

## Troubleshooting

**The tool doesn't appear / Claude says it has no resume tool**

Claude Desktop loads MCP tools lazily. Use a priming phrase to surface it:
> "Use the resurank tool to score my resume."

If that still doesn't work, check that you restarted Claude Desktop *after*
editing the config.

**First score is very slow (30+ seconds)**

Normal — the embedding model is downloading for the first time (~25 MB from
Hugging Face). Progress appears in the server log. Subsequent calls are fast.

**"Resume parsed to N characters (minimum 100)"**

The resume file loaded but contained almost no extractable text. Common causes:
- **Image-only PDF** — the PDF is a scan without an OCR text layer. Convert
  it to a searchable PDF first, or use the `.txt` fallback.
- **Wrong path** — double-check that `RESUME_PATH` points to the right file.
- **Unsupported format** — only `.pdf`, `.docx`, `.txt`, and `.md` are supported.

**"npx: command not found" or the server fails to start**

Claude Desktop couldn't find `npx`. Try using the full path to npx instead:

```bash
# Find the path on macOS/Linux:
which npx
```

Then replace `"npx"` in the config with the full path (e.g.
`/opt/homebrew/bin/npx` or `/usr/local/bin/npx`).

**Checking the server log**

```bash
# macOS
tail -f ~/Library/Logs/Claude/mcp-server-resurank.log
```

On Windows: `%APPDATA%\Claude\logs\mcp-server-resurank.log`

The log shows model download progress, resume load/reload events, embed
timing, and any startup errors.

---

## Starting a scoring session

Claude Desktop loads MCP tools lazily — they aren't automatically active in every
conversation. There are two ways to wake the tool up:

**Option A — Use the built-in prompt (easiest)**

The server exposes a prompt called **"score-resume"** that Claude Desktop surfaces
in its prompt picker (the `+` or `/` menu, depending on your version). Selecting it
injects a ready-made opener that tells Claude to ask you for the job posting and
call the tool immediately.

**Option B — Use a priming phrase**

If the prompt picker isn't visible, open a new conversation and say something like:

> "Use the resurank tool to score my resume against this job posting."
> "Score this job description against my resume."
> "How well does my resume match this role?"

Any of these is enough for Claude to search its tool list and find `resurank_score`.

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
