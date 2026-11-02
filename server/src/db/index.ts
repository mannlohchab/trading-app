import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';

const dbPath = process.env.DATABASE_URL ?? './data/trading.db';
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath, { create: true });
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec('PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;
export { sqlite };
