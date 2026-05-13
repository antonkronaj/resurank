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
      // build-time logs and manifests that accidentally got swept in
      /^\/dist\.log$/,
      /^\/package-manifest\.txt$/,
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
    generateAssets: async (_forgeConfig, platform, arch) => {
      console.time('[generateAssets] elapsed');
      console.log(`[generateAssets] platform=${platform} arch=${arch} — running npm run build`);
      const {execSync} = child_process;
      execSync('npm run build', {stdio: 'inherit'});
      console.log('[generateAssets] build complete');
      console.timeEnd('[generateAssets] elapsed');
    },
    readPackageJson: async (_forgeConfig, packageJson) => {
      console.time('[readPackageJson] elapsed');
      console.log(`[readPackageJson] name=${packageJson.name} version=${packageJson.version} main=${packageJson.main}`);
      console.timeEnd('[readPackageJson] elapsed');
    },
    preStart: async () => {
      console.time('[preStart] elapsed');
      console.log('[preStart] starting Electron app');
      console.timeEnd('[preStart] elapsed');
    },
    postStart: async (_forgeConfig, appProcess) => {
      console.time('[postStart] elapsed');
      console.log(`[postStart] Electron process started pid=${appProcess.pid}`);
      appProcess.on('exit', (code, signal) => {
        console.log(`[postStart] Electron process exited code=${code} signal=${signal}`);
      });
      console.timeEnd('[postStart] elapsed');
    },
    prePackage: async (_forgeConfig, platform, arch) => {
      console.time('[prePackage] elapsed');
      console.log(`[prePackage] platform=${platform} arch=${arch}`);
      console.timeEnd('[prePackage] elapsed');
    },
    packageAfterExtract: async (_forgeConfig, buildPath, electronVersion, platform, arch) => {
      console.time('[packageAfterExtract] elapsed');
      console.log(`[packageAfterExtract] platform=${platform} arch=${arch} electronVersion=${electronVersion}`);
      console.log(`[packageAfterExtract] buildPath=${buildPath}`);
      const entries = fs.readdirSync(buildPath).map(name => {
        const full = path.join(buildPath, name);
        try {
          const st = fs.lstatSync(full);
          const kind = st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'symlink' : `file(${st.size}b)`;
          return `  ${name} [${kind}]`;
        } catch {
          return `  ${name} [error]`;
        }
      });
      console.log(`[packageAfterExtract] contents:\n${entries.join('\n')}`);
      console.timeEnd('[packageAfterExtract] elapsed');
    },
    packageAfterCopy: async (_forgeConfig, buildPath, electronVersion, platform, arch) => {
      console.time('[packageAfterCopy] elapsed');
      console.log(`[packageAfterCopy] reached — buildPath=${buildPath} platform=${platform} arch=${arch} electronVersion=${electronVersion}`);
      // Temporarily disabled while diagnosing Windows build hang — we want to
      // confirm execution reaches this hook before re-enabling the full walk.
      // const {readdirSync, writeFileSync, lstatSync} = fs;
      // const collect = (dir) => {
      //   const entries = [];
      //   for (const name of readdirSync(dir)) {
      //     const full = path.join(dir, name);
      //     let st;
      //     try {
      //       st = lstatSync(full);
      //     } catch {
      //       continue;
      //     }
      //     if (st.isSymbolicLink()) entries.push(full.replace(buildPath, '') + ' -> (symlink)');
      //     else if (st.isDirectory()) entries.push(...collect(full));
      //     else entries.push(full.replace(buildPath, ''));
      //   }
      //   return entries;
      // };
      // const manifest = collect(buildPath).sort().join('\n');
      // const out = path.join(process.cwd(), 'package-manifest.txt');
      // writeFileSync(out, manifest);
      // console.log(`[packageAfterCopy] wrote manifest (${manifest.split('\n').length} files) to ${out}`);
      console.timeEnd('[packageAfterCopy] elapsed');
    },
    packageAfterPrune: async (_forgeConfig, buildPath, electronVersion, platform, arch) => {
      console.time('[packageAfterPrune] elapsed');
      console.log(`[packageAfterPrune] platform=${platform} arch=${arch} electronVersion=${electronVersion} buildPath=${buildPath}`);
      const nodeModulesPath = path.join(buildPath, 'node_modules');
      if (fs.existsSync(nodeModulesPath)) {
        const topLevel = fs.readdirSync(nodeModulesPath);
        console.log(`[packageAfterPrune] node_modules has ${topLevel.length} top-level entries`);
      } else {
        console.log('[packageAfterPrune] no node_modules present after prune');
      }
      console.timeEnd('[packageAfterPrune] elapsed');
    },
    postPackage: async (_forgeConfig, packageResult) => {
      console.time('[postPackage] elapsed');
      const {platform, arch, outputPaths} = packageResult;
      console.log(`[postPackage] platform=${platform} arch=${arch}`);
      console.log(`[postPackage] outputPaths:\n${outputPaths.map(p => `  ${p}`).join('\n')}`);
      console.timeEnd('[postPackage] elapsed');
    },
    preMake: async () => {
      console.time('[preMake] elapsed');
      console.log('[preMake] starting make step');
      console.timeEnd('[preMake] elapsed');
    },
    postMake: async (_forgeConfig, makeResults) => {
      console.time('[postMake] elapsed');
      console.log(`[postMake] processing ${makeResults.length} make result(s)`);
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
        console.log(`[postMake] maker=${result.make} platform=${result.platform} arch=${result.arch} artifacts=${result.artifacts.join(', ')}`);
        for (const artifact of result.artifacts) {
          const name = manifestName(artifact);
          if (!name) {
            console.log(`[postMake] skipping ${path.basename(artifact)} (no manifest mapping)`);
            continue;
          }

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
          console.log(`[postMake] wrote ${name} for ${filename} (${size} bytes)`);
        }
      }
      console.timeEnd('[postMake] elapsed');
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
