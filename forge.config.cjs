const {FusesPlugin} = require('@electron-forge/plugin-fuses');
const {FuseV1Options, FuseVersion} = require('@electron/fuses');
const dotenv = require('dotenv');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const child_process = require('node:child_process');

dotenv.config();

const isMac = process.platform === 'darwin';
const SKIP_SIGNING = process.env['SKIP_SIGNING'] === '1';
const APPLE_ID_NAME_S = process.env['APPLE_ID_NAME'];
const APPLE_ID_S = process.env['APPLE_ID'];
const APPLE_APP_SPECIFIC_PASSWORD_S = process.env['APPLE_APP_SPECIFIC_PASSWORD'];
const APPLE_TEAM_ID_S = process.env['APPLE_TEAM_ID'];

if (isMac && !SKIP_SIGNING) {
  let missing = '';
  if (!APPLE_ID_NAME_S) {
    missing += 'APPLE_ID_NAME';
  }
  if (!APPLE_ID_S) {
    missing += 'APPLE_ID';
  }
  if (!APPLE_APP_SPECIFIC_PASSWORD_S) {
    missing += 'APPLE_APP_SPECIFIC_PASSWORD';
  }
  if (!APPLE_TEAM_ID_S) {
    missing += 'APPLE_TEAM_ID';
  }
  if (missing.length > 3) {
    throw new Error(`Missing ${missing} for macOS code signing`);
  }
}

const config = {
  packagerConfig: {
    name: 'ResuRank',
    appBundleId: 'dev.resurank.app',
    icon: 'resources/icon',
    extraResource: ['app-update.yml'],
    asar: true,
    quiet: false,
    ...(isMac && !SKIP_SIGNING ? {
      osxSign: {
        identity: `Developer ID Application: ${APPLE_ID_NAME_S} (${APPLE_TEAM_ID_S})`,
        hardenedRuntime: true,
        entitlements: 'entitlements.plist',
        entitlementsInherit: 'entitlements.plist',
      },
      osxNotarize: {
        appleId: APPLE_ID_S ?? '',
        appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD_S ?? '',
        teamId: APPLE_TEAM_ID_S ?? '',
      },
    } : {}),
    ignore: [
      /CLAUDE.md/,
      /\.gitignore/,
      /\.claudeignore/,
      /\.map$/,
      /\.env$/,
      /\.ts$/,
      /\/data$/,
      /\.\/.claude\//,
      /\.\/.github\//,
      /\.\/.idea\//,
      /\.\/.out\//,
      /tsconfig.*\.json$/,
      /\/node_modules\/typescript\//,
      /\/node_modules\/@types\//,
      /\/node_modules\/wordnet-db\/dict\//,
      // workspace dev deps — not needed at runtime
      /\/frontend\/node_modules\//,
      // angular build cache — only used to accelerate subsequent ng builds
      /\/frontend\/\.angular\//,
      // angular sources — only the built output under frontend/dist is loaded at runtime
      /\/frontend\/src\//,
      /\/frontend\/public\//,
      /\/frontend\/\.vscode\//,
      /\/frontend\/\.editorconfig$/,
      /\/frontend\/README\.md$/,
      // angular ecosystem — compiled into dist/frontend at build time
      /\/node_modules\/@angular\//,
      /\/node_modules\/@angular-devkit\//,
      /\/node_modules\/@schematics\//,
      // electron-forge toolchain — packaging only, never runs inside the app
      /\/node_modules\/@electron-forge\//,
      /\/node_modules\/electron-winstaller\//,
      /\/node_modules\/postject\//,
      // bundlers and transpilers used by the angular build pipeline
      /\/node_modules\/@rolldown\//,
      /\/node_modules\/@babel\//,
      /\/node_modules\/esbuild-wasm\//,
      /\/node_modules\/@esbuild\//,
      /\/node_modules\/webpack\//,
      // other dev-only tools
      /\/node_modules\/prettier\//,
      /\/node_modules\/sass\//,
      /\/node_modules\/caniuse-lite\//,
      // test and doc cruft inside dependencies
      /\/resources\/test_files\//,
      /\/node_modules\/.*\/(test|tests|__tests__|spec|specs)\//,
      /\/node_modules\/.*\/(example|examples|demo|demos|docs?)\//,
      /\/node_modules\/.*\.(d\.ts\.map)$/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {name: '@electron-forge/maker-dmg', platforms: ['darwin']},
    {name: '@electron-forge/maker-squirrel', platforms: ['win32'], config: {}},
    {name: '@electron-forge/maker-zip', platforms: ['linux']},
  ],
  hooks: {
    generateAssets: async () => {
      // When STAGE_DIR is set, the workflow pre-stage step has already run
      // `npm run build` at the project root and copied the artifacts into
      // the stage. Re-running it here would emit to the project root, not
      // the stage cwd forge is now running from.
      if (process.env['STAGE_DIR']) return;
      child_process.execSync('npm run build', {stdio: 'inherit'});
    },
    postMake: async (_forgeConfig, makeResults) => {
      // Emit latest.yml / latest-mac.yml / latest-linux.yml manifests next
      // to each artifact so electron-updater can resolve them on GitHub
      // Releases.
      const {createHash} = crypto;
      const {readFileSync, writeFileSync, statSync} = fs;
      const {basename, dirname} = path;

      const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
      const releaseDate = new Date().toISOString();

      const manifestName = (artifact) => {
        if (artifact.endsWith('.dmg')) return 'latest-mac.yml';
        if (artifact.endsWith('.exe')) return 'latest.yml';
        if (artifact.endsWith('.deb') || artifact.endsWith('.rpm') || artifact.endsWith('.AppImage')) return 'latest-linux.yml';
        return null;
      };

      for (const result of makeResults) {
        for (const artifact of result.artifacts) {
          const name = manifestName(artifact);
          if (!name) continue;

          const {size} = statSync(artifact);
          const sha512 = createHash('sha512').update(readFileSync(artifact)).digest('base64');
          const filename = basename(artifact);

          const yaml = [
            `version: ${pkg.version}`,
            `files:`,
            `  - url: ${filename}`,
            `    sha512: ${sha512}`,
            `    size: ${size}`,
            `path: ${filename}`,
            `sha512: ${sha512}`,
            `releaseDate: '${releaseDate}'`,
          ].join('\n') + '\n';

          writeFileSync(`${dirname(artifact)}/${name}`, yaml);
        }
      }
    },
  },
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

module.exports = config;
