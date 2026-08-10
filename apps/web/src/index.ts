import {buildApp} from './app.js';
import {config} from './config.js';
import {assertDatabaseReachable, closeDatabase} from './db/client.js';
import {seedAdminUser} from './lib/admin-seed.js';

async function main(): Promise<void> {
  await assertDatabaseReachable();

  const app = await buildApp();

  // Runs before listen() so a server that has started accepting connections
  // always has an admin — see the "Leak-recovery model" note in the admin
  // feature plan for why this reruns (and re-hashes) on every boot.
  await seedAdminUser(app.log);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({signal}, 'shutting down');
    await app.close();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({port: config.port, host: config.host});
}

main().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});
