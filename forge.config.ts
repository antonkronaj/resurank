import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import type { ForgeConfig } from '@electron-forge/shared-types';
import dotenv from 'dotenv';

dotenv.config();

const isMac = process.platform === 'darwin';
const appleIdName = process.env['APPLE_ID_NAME'];
const appleId = process.env['APPLE_ID'];
const appleAppPass = process.env['APPLE_APP_SPECIFIC_PASSWORD'];
const appleTeamId = process.env['APPLE_TEAM_ID'];

if (isMac && (!appleIdName || !appleTeamId || !appleId || !appleAppPass)) {
  throw new Error('Missing APPLE_ID_NAME or APPLE_TEAM_ID or APPLE_ID or APPLE_APP_SPECIFIC_PASSWORD for macOS code signing');
}

const config: ForgeConfig = {
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
      } as NonNullable<ForgeConfig['packagerConfig']>['osxSign'],
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
      const { execSync } = await import('node:child_process');
      execSync('npm run build:backend && npm run build:frontend && npm run build:electron', {
        stdio: 'inherit',
      });
    },

    postMake: async (_forgeConfig, makeResults) => {
      const { createHash } = await import('node:crypto');
      const { readFileSync, writeFileSync, statSync } = await import('node:fs');
      const { basename, dirname } = await import('node:path');

      const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url).pathname, 'utf8')) as { version: string };
      const releaseDate = new Date().toISOString();

      const manifestName = (artifact: string): string | null => {
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

export default config;
