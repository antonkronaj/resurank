#!/usr/bin/env node
/**
 * Builds packages/mcp-server/dist/resurank-mcp.dxt.
 *
 * A DXT is a ZIP archive containing:
 *   manifest.json
 *   server/
 *     index.js          (and supporting compiled files)
 *     node_modules/     (production-only)
 *     package.json
 *
 * Build steps:
 *   1. Ensure mcp-server is compiled (`npm run build`).
 *   2. Stage files under build/dxt/staging/.
 *   3. npm install --omit=dev in the staging dir to materialize prod deps.
 *      The workspace-symlinked @resurank/scoring is replaced with a real copy.
 *   4. Zip the staging dir into dist/resurank-mcp.dxt.
 */

import {execSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {platform} from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(PKG_ROOT, '..', '..');
const SCORING_ROOT = join(REPO_ROOT, 'packages', 'scoring');
const MANIFEST_SRC = join(PKG_ROOT, 'dxt', 'manifest.json');
const BUILD_ROOT = join(PKG_ROOT, 'build', 'dxt');
const STAGING = join(BUILD_ROOT, 'staging');
const SERVER_DIR = join(STAGING, 'server');
const OUT_DIR = join(PKG_ROOT, 'dist-dxt');
const OUT_FILE = join(OUT_DIR, 'resurank-mcp.dxt');

const log = (...a) => console.log('[build-dxt]', ...a);

function run(cmd, opts = {}) {
  log('$', cmd, opts.cwd ? `(in ${opts.cwd})` : '');
  execSync(cmd, {stdio: 'inherit', ...opts});
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, {recursive: true});
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function main() {
  if (!existsSync(MANIFEST_SRC)) {
    throw new Error(`Missing manifest at ${MANIFEST_SRC}`);
  }

  // 1. Build dist/ if missing.
  if (!existsSync(join(PKG_ROOT, 'dist', 'index.js'))) {
    log('mcp-server dist not found, compiling first');
    run('npm run build', {cwd: PKG_ROOT});
  }
  if (!existsSync(join(SCORING_ROOT, 'dist', 'index.js'))) {
    log('@resurank/scoring dist not found, compiling first');
    run('npm run build', {cwd: SCORING_ROOT});
  }

  // 2. Stage.
  if (existsSync(BUILD_ROOT)) rmSync(BUILD_ROOT, {recursive: true, force: true});
  ensureDir(SERVER_DIR);

  // 2a. Pack @resurank/scoring so the staging install can consume it as a
  //     real tarball instead of a workspace symlink (workspaces don't survive
  //     packaging into a DXT).
  ensureDir(BUILD_ROOT);
  const packOutput = execSync('npm pack --json --pack-destination "' + BUILD_ROOT + '"', {
    cwd: SCORING_ROOT,
    encoding: 'utf8',
  });
  const packedScoring = JSON.parse(packOutput)[0];
  const scoringTarball = join(BUILD_ROOT, packedScoring.filename);
  log('packed scoring →', scoringTarball);

  // 2b. Copy server dist + package.json into the staging server dir.
  cpSync(join(PKG_ROOT, 'dist'), SERVER_DIR, {recursive: true});
  const pkg = readJson(join(PKG_ROOT, 'package.json'));
  const stagedPkg = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    license: pkg.license,
    main: 'index.js',
    type: 'module',
    dependencies: {
      ...pkg.dependencies,
      // Replace the workspace ref with a file: ref to the tarball.
      '@resurank/scoring': `file:${scoringTarball}`,
    },
  };
  writeJson(join(SERVER_DIR, 'package.json'), stagedPkg);

  // 3. Install prod deps in the staging server dir.
  run('npm install --omit=dev --no-audit --no-fund --no-package-lock', {cwd: SERVER_DIR});

  // 4. macOS fix: Strip code signatures from native binaries.
  // Claude Desktop (Anthropic signed) refuses to load the bundled onnxruntime_binding.node
  // if it has Microsoft's signature (Library Validation Policy). Removing the
  // signature makes it "ad-hoc" signed, which works.
  if (platform() === 'darwin') {
    const onnxBinding = join(
      SERVER_DIR,
      'node_modules',
      'onnxruntime-node',
      'bin',
      'napi-v6',
      'darwin',
      'arm64',
      'onnxruntime_binding.node'
    );
    if (existsSync(onnxBinding)) {
      log('stripping signature from', onnxBinding);
      run(`codesign --remove-signature "${onnxBinding}"`);
    } else {
      log('warn: could not find onnxruntime_binding.node at', onnxBinding);
    }
  }

  // 5. Copy manifest into the staging root (sibling to server/).
  cpSync(MANIFEST_SRC, join(STAGING, 'manifest.json'));

  // 6. Zip the staging contents into the .dxt file.
  ensureDir(OUT_DIR);
  if (existsSync(OUT_FILE)) rmSync(OUT_FILE);
  // Use system `zip`. macOS and Linux ship it; Windows users can use
  // `Compress-Archive -Path *,server -DestinationPath ... -Force` instead,
  // or run this script under WSL/git-bash.
  run(`zip -r -q "${OUT_FILE}" .`, {cwd: STAGING});

  log('✓ wrote', OUT_FILE);
  log('Test it: drag the .dxt onto Claude Desktop, or run');
  log('  open -a "Claude" "' + OUT_FILE + '"   (macOS)');
}

main();
