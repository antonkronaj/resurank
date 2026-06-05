# @resurank/scoring

Framework-free resume / job-description scoring engine. Hybrid 60% semantic +
40% TF-IDF, runs locally via [Transformers.js](https://huggingface.co/docs/transformers.js).
Powers both the [ResuRank desktop app](https://github.com/antonkronaj/resurank)
and the [`resurank-mcp`](../mcp-server) MCP server.

```bash
npm install @resurank/scoring @huggingface/transformers
```

## API

```ts
import { scoreResumeAgainstJob } from '@resurank/scoring';
import { createTransformersEmbedder } from '@resurank/scoring/node-embedder';

const embedder = createTransformersEmbedder();

const result = await scoreResumeAgainstJob(
  resumeText,
  { title: 'Senior Backend Engineer', description: jdText },
  embedder,
);

console.log(result.score);             // 0–1
console.log(result.matchedTerms);      // top-weight overlapping terms
console.log(result.missingTerms);      // missing pinned terms (when configured)
console.log(result.breakdown);         // semantic / keyword / penalty breakdown
```

### Subpath exports

- `@resurank/scoring` — pure scoring + types + `Embedder` interface (no model deps)
- `@resurank/scoring/node-embedder` — Node-side Transformers.js embedder; pulls
  in `@huggingface/transformers` (peerDep)
- `@resurank/scoring/constants` — the numeric constants that drive the model
  (weights, caps, thresholds)

The split lets browser/worker consumers (e.g. an Angular app with its own
worker-based embedder) avoid bundling the Node-only Transformers.js code.

### `Embedder` interface

```ts
interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}
```

Implement this however you like — Web Worker, ONNX, OpenAI's text embedding API,
a fake for tests. The scoring code doesn't care.

## How scoring works

ResuRank scores a resume against a job description using two independent
methods — **semantic embedding** and **keyword TF-IDF** — then combines them
into a single 0–1 value. Each method captures something different; together
they're more reliable than either alone.

---

### Step 1 — Text preparation

Before any scoring happens, both texts are cleaned up:

- **Stopwords are removed.** Common words ("the", "and", "is") and any
  custom exclusion words are stripped. These appear everywhere and pollute
  scores.
- **The job title gets extra weight.** It is repeated twice before the
  description when building the keyword index, so title terms count more than
  body text.
- **Text is sanitised for the embedding model.** HTML tags, URLs, emoji, and
  Markdown formatting are stripped before the text is sent to the model.
  These inflate the token count without adding meaning.
- **Inputs are capped.** Resume and job description are each capped at 6,000
  characters (after sanitisation) before being sent to the embedding model.

---

### Step 2 — Embedding score (semantic similarity)

*Do these two texts mean the same thing, even if they use different words?*

Both texts are passed through
[`Xenova/jina-embeddings-v2-small-en`](https://huggingface.co/Xenova/jina-embeddings-v2-small-en)
(~25 MB, q8 ONNX, runs fully locally via Transformers.js). The model converts
each text into a vector; the score is the **cosine similarity** between those
vectors.

- 1.0 — texts are semantically identical
- ~0  — completely unrelated in meaning

Good at catching paraphrases and related concepts ("led a team" ↔ "people
management"), but can find abstract similarity between any two professional
texts even when they share no keywords — which is why it's not used alone.

---

### Step 3 — TF-IDF score (keyword similarity)

*Do these two texts share the same specific words?*

TF-IDF (Term Frequency–Inverse Document Frequency) builds a two-document
index from the resume and the job description, then computes their **cosine
similarity** in keyword-weight space. Terms that appear in both contribute;
terms that appear in only one don't.

**Overlap bonus:** a small bonus is added based on how many of the top 100
resume terms also appear in the job description. Each shared term adds a
little extra, up to +20 percentage points on the TF-IDF score. This rewards
jobs that literally use the same vocabulary as the resume.

**Term boosts:** if configured, certain terms get their TF-IDF weight
multiplied by a boost factor. Boosts only affect terms that already appear in
the resume.

---

### Step 4 — Combining the scores

Under normal conditions the final score is a weighted blend:

```
score = 0.60 × embedding + 0.40 × TF-IDF
```

The embedding gets more weight because it captures meaning. The TF-IDF
anchors the score to actual shared vocabulary.

---

### Step 5 — Divergence adjustment

The embedding can find semantic similarity between *any* two professional
documents — a software resume and a nursing job description may both mention
"analysis" and "communication", scoring high on embedding even with zero
keyword overlap.

To correct for this, the embedding weight is **smoothly reduced as TF-IDF
approaches zero**:

| TF-IDF | Embedding weight | TF-IDF weight |
|--------|-----------------|---------------|
| ≥ 15% | 60% (normal) | 40% (normal) |
| ~0% | 10% | 90% |
| between | smooth linear transition | |

The "Divergence penalty" in the breakdown is the score reduction caused by
this adjustment. A large penalty means TF-IDF was very low and the embedding
was likely detecting false similarity.

---

### Step 6 — Critical missing keywords (optional)

Off by default. The cosine steps already account for missing words
indirectly, but treat every keyword as equally replaceable. This step lets
you flag specific terms as **critical** so their absence actively reduces the
score — useful when one missing keyword (e.g. "C#") is a real deal-breaker.

- **Importance tiers** — Low, Medium (default), High → scales contribution
  by **0.5×, 1×, 2×**.
- **Formula** — only flagged terms present in the current JD count:

  ```
  penalty = (missing_weight ÷ total_weight) × max_reduction
  ```

- **Max reduction** — defaults to 25%, capped at 50%. The ceiling exists so
  the penalty can't single-handedly dominate the score.

Applied after the divergence adjustment.

---

### Step 7 — Preference mismatch penalty (optional)

Off by default. Describe traits you *don't* want in a role (e.g. "on-call
rotations", "enterprise bureaucracy"). The text is embedded with the same
local model and compared to the job description's embedding.

- Similarity below a fixed floor has no effect.
- Above the floor the penalty scales linearly up to the configured maximum
  (default 25%, capped at 50%).

Applied after the divergence adjustment and after the missing keyword penalty.

---

### Language detection

If more than 3% of alphabetic characters in the job description are non-ASCII,
a `languageWarning` flag is set. The embedding model has some cross-lingual
capability, so it may find similarity between an English resume and a
non-English JD even when there is little real overlap. The divergence
adjustment also helps here since TF-IDF will typically be near zero for a
foreign-language job.

---

### Score tiers

| Score | Tier |
|-------|------|
| 0–29 | Poor fit |
| 30–49 | Fair |
| 50–69 | Good |
| 70+ | Great fit |

---

## Publishing a new version

**Always use the package scripts to bump the version** — do not use
`npm version -w packages/scoring` from the repo root. The workspace `-w` flag
ignores the package-local `.npmrc` and has a git-repo detection bug that can
silently fail.

**1. Bump the version**

```bash
# From the repo root — pick the appropriate bump:
npm -w @resurank/scoring run version:patch   # 1.0.0 → 1.0.1
npm -w @resurank/scoring run version:minor   # 1.0.0 → 1.1.0
npm -w @resurank/scoring run version:major   # 1.0.0 → 2.0.0
```

This updates `version` in `package.json` only. The commit and tag must be
created manually:

```bash
git add packages/scoring/package.json
git commit -m "scoring-v1.0.1"
git tag scoring-v1.0.1
git push && git push --tags
```

**2. Set your npm token**

```bash
export NPM_TOKEN=xxxx
```

**3. Publish**

```bash
cd packages/scoring && npm publish
```

`prepublishOnly` runs `clean → build → test` automatically before the publish
goes out. If any test fails, the publish is aborted.

## License

[AGPL-3.0-only](./LICENSE).
