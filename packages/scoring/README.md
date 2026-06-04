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

## License

[AGPL-3.0-only](./LICENSE).
