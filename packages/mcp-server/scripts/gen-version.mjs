// Writes src/version.ts from package.json's version field.
//
// The MCP server advertises a version to its client during the handshake, and
// hand-maintaining that literal had already let it drift to 0.1.0 while the
// package was at 1.0.4. Generating it means `npm run version:patch` cannot
// leave the advertised version behind.
//
// Mirrors packages/scoring/scripts/gen-version.mjs — kept per-package rather
// than shared so each published package stays self-contained.

import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const {version} = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

const contents = `// GENERATED FILE — do not edit.
// Written by scripts/gen-version.mjs from package.json on every build.

/** The resurank-mcp version, advertised to MCP clients during the handshake. */
export const MCP_VERSION = '${version}';
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
