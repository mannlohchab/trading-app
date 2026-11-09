// Standalone background-jobs worker (no HTTP server). Run with BACKGROUND_JOBS_ENABLED=false on the
// API instances and one or more of these: `bun run jobs`.
import { hostname } from 'node:os';
import { composeModules, startJobRunner } from './composition';
import { closeDatabase } from './db/client';

const modules = composeModules();
const stop = await startJobRunner(modules, `jobs:${hostname()}:${process.pid}`);
console.log('Background jobs worker running');

const shutdown = async () => {
  await stop();
  modules.market.stop();
  await closeDatabase();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
