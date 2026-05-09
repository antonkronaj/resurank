const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const dotenv = require('dotenv');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const child_process = require('node:child_process');

dotenv.config();

const isMac = process.platform === 'darwin';
const appleIdName = process.env['APPLE_ID_NAME'];
const appleId = process.env['APPLE_ID'];
const appleAppPass = process.env['APPLE_APP_SPECIFIC_PASSWORD'];
const appleTeamId = process.env['APPLE_TEAM_ID'];

if (isMac && (!appleIdName || !appleTeamId || !appleId || !appleAppPass)) {
  throw new Error('Missing APPLE_ID_NAME or APPLE_TEAM_ID or APPLE_ID or APPLE_APP_SPECIFIC_PASSWORD for macOS code signing');
}

const config = {
  packagerConfig: {
    name: 'ResuRank',
    appBundleId: 'dev.resurank.app',
    icon: 'resources/icon',
    extraResource: ['app-update.yml'],
    asar: {
      unpack: '**/node_modules/{onnxruntime-node,@huggingface}/**/*',
    },
    ...(isMac && appleIdName && appleTeamId ? {
      osxSign: {
        identity: `Developer ID Application: ${appleIdName} (${appleTeamId})`,
        hardenedRuntime: true,
        entitlements: 'entitlements.plist',
        entitlementsInherit: 'entitlements.plist',
      },
      osxNotarize: {
        appleId: appleId ?? '',
        appleIdPassword: appleAppPass ?? '',
        teamId: appleTeamId ?? '',
      },
    } : {}),
    ignore: [
      /\.map$/,
      /\.ts$/,
      /tsconfig.*\.json$/,
      /\/node_modules\/typescript\//,
      /\/node_modules\/@types\//,
      /\/node_modules\/onnxruntime-web\/dist\/.*\.wasm$/,
      /\/node_modules\/wordnet-db\/dict\//,
    ],
  },
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-dmg', platforms: ['darwin'] },
    { name: '@electron-forge/maker-squirrel', platforms: ['win32'], config: {} },
    { name: '@electron-forge/maker-zip', platforms: ['linux'] },
  ],
  hooks: {
    generateAssets: async () => {
      const { execSync } = child_process;
      execSync('npm run build:backend && npm run build:frontend && npm run build:electron', {
        stdio: 'inherit',
      });
    },

    postMake: async (_forgeConfig, makeResults) => {
      const { createHash } = crypto;
      const { readFileSync, writeFileSync, statSync } = fs;
      const { basename, dirname } = path;

      const pkg = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
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

          const { size } = statSync(artifact);
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
          console.log(`[postMake] wrote ${name} for ${filename}`);
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
