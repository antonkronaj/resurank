import {defineConfig} from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://resurank:resurank@localhost:5433/resurank',
  },
  strict: true,
  verbose: true,
});
