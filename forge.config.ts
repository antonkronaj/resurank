import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'jobMatch',
    appBundleId: 'dev.jobmatch.app',
    icon: 'resources/icon',
    asar: {
      unpack: '**/node_modules/{onnxruntime-node,@huggingface}/**/*',
    },
    osxSign: {
      identity: 'Anton Kronaj (HSJNM2MG33)',
    },
    osxNotarize: {
      appleId: process.env['APPLE_ID'] ?? '',
      appleIdPassword: process.env['APPLE_APP_SPECIFIC_PASSWORD'] ?? '',
      teamId: 'HSJNM2MG33',
    },
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
