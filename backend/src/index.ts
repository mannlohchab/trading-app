// Production composition root: real database, real config, real adapters.
import { hostname } from 'node:os';
import { createApp } from './app';
import { composeModules, startJobRunner } from './composition';
import { config } from './config';
import { closeDatabase, pingDatabase } from './db/client';

const modules = composeModules();
const app = createApp({ clientOrigin: config.clientOrigin, pingDatabase, ...modules });
modules.market.startCatalogSync();

const server = Bun.serve({ port: config.port, fetch: app.fetch, websocket: modules.market.websocket });
console.log(`Trading backend listening on ${server.url}`);

const stopJobs = config.backtesting.runJobs ? await startJobRunner(modules, `api:${hostname()}:${process.pid}`) : async () => {};

const shutdown = async () => {
  await stopJobs();
  modules.market.stop();
  await server.stop();
  await closeDatabase();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
