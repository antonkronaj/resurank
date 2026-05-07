#!/usr/bin/env node
// Re-rebuild native modules (better-sqlite3) against Electron's Node ABI
// after `npm install` inside backend/. No-op when run outside the monorepo
// (e.g. CI installs that don't need Electron).

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const rebuildPkg = resolve(root, 'node_modules', '@electron', 'rebuild');

if (!existsSync(rebuildPkg)) {
  // Standalone backend install (no monorepo root) — nothing to do.
  process.exit(0);
}

console.log('[backend postinstall] rebuilding native modules for Electron');
try {
  execSync('npx --no-install electron-rebuild -m backend', {
    cwd: root,
    stdio: 'inherit',
  });
} catch (err) {
  console.warn('[backend postinstall] electron-rebuild failed (continuing):', err.message);
}
