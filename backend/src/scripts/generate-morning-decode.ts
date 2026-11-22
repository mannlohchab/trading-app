/**
 * Generate today's Morning Decode (script + TTS) and optionally publish the row to another DB.
 *
 *   bun run morning-decode:generate
 *   bun run morning-decode:generate -- --force
 *   TARGET_DATABASE_URL=postgres://... bun run morning-decode:generate -- --force --publish
 *
 * Requires GEMINI_API_KEY (and/or OPENROUTER_API_KEY) in backend/.env for a real script;
 * OPENROUTER_API_KEY for audio. --publish copies the local row into TARGET_DATABASE_URL.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { composeModules } from '../composition';
import { closeDatabase, db } from '../db/client';
import { aiMarketBriefs } from '../db/schema';
import { fullSchema } from '../db/types';

const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const publish = args.has('--publish');
const targetUrl = process.env.TARGET_DATABASE_URL?.trim() || process.env.PROD_DATABASE_URL?.trim();
if (publish && !targetUrl) throw new Error('Set TARGET_DATABASE_URL (or PROD_DATABASE_URL) to publish.');

const modules = composeModules();
try {
  const view = force ? await modules.ai.morningDecode.forceToday() : await modules.ai.morningDecode.today();
  console.log(JSON.stringify({
    action: force ? 'force-generated' : 'ensured',
    ...view,
    audioBytes: undefined,
  }, null, 2));

  if (!view.hasAudio) {
    throw new Error('No audio stored. Check OPENROUTER_API_KEY and the configured models, then re-run with --force.');
  }

  if (publish) {
    if (!targetUrl) throw new Error('Set TARGET_DATABASE_URL (or PROD_DATABASE_URL) to publish.');
    const date = view.date;
    const row = await db.query.aiMarketBriefs.findFirst({ where: eq(aiMarketBriefs.briefDate, date) });
    if (!row) throw new Error(`Local row for ${date} missing after generation.`);

    const remoteSql = postgres(targetUrl, { max: 1, ssl: 'require', connect_timeout: 15, onnotice: () => {} });
    const remote = drizzle(remoteSql, { schema: fullSchema, casing: 'snake_case' });
    try {
      const values = {
        briefDate: row.briefDate,
        content: row.content,
        audio: row.audio ?? undefined,
        audioContentType: row.audioContentType ?? undefined,
        durationSeconds: row.durationSeconds ?? undefined,
        textModel: row.textModel ?? undefined,
        audioModel: row.audioModel ?? undefined,
        createdAt: row.createdAt,
      };
      await remote.insert(aiMarketBriefs).values(values).onConflictDoUpdate({ target: aiMarketBriefs.briefDate, set: values });
      console.log(JSON.stringify({
        published: true,
        date,
        hasAudio: !!(row.audio && row.audio.length),
        audioBytes: row.audio?.length ?? 0,
        durationSeconds: row.durationSeconds,
      }, null, 2));
    } finally {
      await remoteSql.end({ timeout: 5 });
    }
  }
} finally {
  await closeDatabase();
}
