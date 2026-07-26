#!/usr/bin/env node
// Downloads the embedding model into apps/ui/public/assets/models/, so the
// web build can serve it same-origin (see shared/model-host.token.ts for why:
// COEP `require-corp` blocks a cross-origin fetch from huggingface.co outright,
// it isn't just slower). Desktop is unaffected — it keeps fetching from HF
// directly. Idempotent: skips any file that's already on disk, so a rebuild
// doesn't re-download ~32MB every time.
//
// Layout mirrors env.remoteHost + env.remotePathTemplate = '{model}/' in
// web/app.config.ts: apps/ui/public/assets/models/<MODEL_ID>/<file>.

import {createWriteStream, existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';

const MODEL_ID = 'Xenova/jina-embeddings-v2-small-en';
const REVISION = 'main';
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'vocab.txt',
  'onnx/model_quantized.onnx',
];

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'assets', 'models', MODEL_ID);

async function fetchFile(file) {
  const dest = join(outDir, file);
  if (existsSync(dest)) {
    console.log(`skip (already present): ${file}`);
    return;
  }

  const url = `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/${file}`;
  console.log(`fetching ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  await mkdir(dirname(dest), {recursive: true});
  await pipeline(response.body, createWriteStream(dest));
  console.log(`saved ${file}`);
}

for (const file of FILES) {
  await fetchFile(file);
}

console.log(`model ready at ${outDir}`);
