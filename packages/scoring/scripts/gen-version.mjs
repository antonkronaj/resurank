// Writes src/version.ts from package.json's version field.
//
// The package version is provenance: a stored score is only reproducible if you
// know which weights in constants.ts produced it, and those move with the
// version. Generating the constant rather than hand-maintaining it means
// `npm run version:patch` can never leave the exported value behind.
//
// Runs as `prebuild`, so every build (including the one inside prepublishOnly)
// refreshes it before tsc reads it.

import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const {version} = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

const contents = `// GENERATED FILE — do not edit.
// Written by scripts/gen-version.mjs from package.json on every build.

/** The @resurank/scoring version that produced a score. See scripts/gen-version.mjs. */
export const SCORING_VERSION = '${version}';
`;

const target = join(packageRoot, 'src', 'version.ts');
const current = (() => {
  try {
    return readFileSync(target, 'utf8');
  } catch {
    return null;
  }
})();

// Skip the write when nothing changed, so watch-mode builds don't loop.
if (current !== contents) {
  writeFileSync(target, contents);
  console.log(`[gen-version] src/version.ts -> ${version}`);
}
