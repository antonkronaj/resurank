import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

/**
 * Enforces the shared/desktop/web physical partition described in
 * docs/web-deployment-plan.md: `shared/` is the app both builds run, and it
 * must not know which one it's in. Concretely — `shared/` never imports
 * `desktop/` or `web/`, and `desktop/`/`web/` never import each other.
 * A build-specific capability `shared/` needs (storage, clipboard, the model
 * cache dir, the Claude Desktop panel) goes through an injection token in
 * `shared/`, with each build's `app.config.ts` supplying the concrete value —
 * see shared/*.token.ts and shared/storage/storage-adapter.ts.
 */
export default tseslint.config(
  {
    // Build caches and output — not source, and not ours to lint.
    ignores: ['.angular/**', 'dist/**', 'coverage/**'],
  },
  {
    files: ['src/app/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {import: importPlugin},
    settings: {
      'import/resolver': {
        node: {extensions: ['.ts', '.js']},
      },
    },
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/app/shared',
              from: './src/app/desktop',
              message: 'shared/ must not import from desktop/ — inject a token instead (see shared/*.token.ts).',
            },
            {
              target: './src/app/shared',
              from: './src/app/web',
              message: 'shared/ must not import from web/ — inject a token instead (see shared/*.token.ts).',
            },
            {
              target: './src/app/desktop',
              from: './src/app/web',
              message: 'desktop/ must not import from web/ — they are separate builds.',
            },
            {
              target: './src/app/web',
              from: './src/app/desktop',
              message: 'web/ must not import from desktop/ — they are separate builds.',
            },
          ],
        },
      ],
    },
  },
);
