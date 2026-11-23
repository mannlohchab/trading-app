// Applies pending SQL migrations from ./drizzle. Runs with only drizzle-orm (no drizzle-kit),
// so it is safe to use in production: `bun run db:migrate`.
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDatabase, db } from './client';

try {
  await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
  console.log('Migrations applied');
} finally {
  await closeDatabase();
}
