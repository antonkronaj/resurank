/**
 * The embedding model this package loads, in one place.
 *
 * Both embedder entry points (worker.ts in the browser, node-embedder.ts under
 * Node) used to declare the id as a private literal, and the desktop UI
 * repeated the human-readable name in prose. Consumers that want to *show* or
 * *record* which model produced a score need it as data, so it lives here and
 * the embedders import it.
 *
 * `id` is a default, not a guarantee: both embedders accept a `modelId`
 * override. Anything recording provenance should read the id the embedder
 * reports back (`ModelStatus.modelId`) rather than assuming this one.
 * `dtype` is not overridable, so it is accurate as a constant.
 */
export const EMBEDDING_MODEL = {
  /** Hugging Face repo id passed to `pipeline('feature-extraction', ...)`. */
  id: 'Xenova/jina-embeddings-v2-small-en',
  /** Repo id without the org prefix — what the UI shows a user. */
  label: 'jina-embeddings-v2-small-en',
  /** Quantization requested from Transformers.js. Affects scores, so it is provenance. */
  dtype: 'q8',
  /** Output vector length. */
  dimensions: 512,
  /** Rough on-disk size of the quantized ONNX weights, for download messaging. */
  approxSizeMb: 25,
} as const;
