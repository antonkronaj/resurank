/**
 * Applies pending migrations, then exits. Run on deploy:
 *   node dist/db/migrate.js
 *
 * Uses drizzle-orm's migrator rather than `drizzle-kit migrate` so production
 * images do not need drizzle-kit (a devDependency) installed.
 */
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {db, closeDatabase} from './client.js';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

try {
  await migrate(db, {migrationsFolder});
  console.log('Migrations applied successfully.');
} catch (error) {
  console.error('Migration failed:', error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
