import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { aiMarketBriefs } from '../../src/db/schema';
import { MorningDecodeService } from '../../src/modules/ai/application/morning-decode.service';
import type { MarketDataService } from '../../src/modules/market/application/market-data.service';
import { createTestDb } from '../helpers/test-db';

let database: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { database = await createTestDb(); });
afterAll(() => database.close());

for (const failure of ['script', 'audio', null] as const) {
  test(`forced generation ${failure ? `preserves the previous briefing on ${failure} failure` : 'replaces the briefing after successful generation'}`, async () => {
    const date = failure === 'script' ? '2026-11-20' : failure === 'audio' ? '2026-11-21' : '2026-11-22';
    await database.db.insert(aiMarketBriefs).values({ briefDate: date, content: 'Original briefing', audio: Buffer.from('old-audio'), audioContentType: 'audio/mpeg' });
    const service = new MorningDecodeService({
      db: database.appDb, clock: { now: () => new Date(`${date}T09:00:00Z`) },
      market: { tickerList: async () => [] } as unknown as MarketDataService,
      script: { name: 'script', complete: async () => { if (failure === 'script') throw new Error('Script provider failed'); return { text: 'New briefing', model: 'nemotron' }; } },
      tts: { name: 'tts', speak: async () => { if (failure === 'audio') throw new Error('Audio provider failed'); return { bytes: Buffer.from('new-audio'), contentType: 'audio/mpeg', model: 'kokoro' }; } },
    });
    if (failure) await expect(service.forceToday()).rejects.toThrow();
    else expect((await service.forceToday()).hasAudio).toBe(true);
    const row = await database.db.query.aiMarketBriefs.findFirst({ where: eq(aiMarketBriefs.briefDate, date) });
    expect(row?.content).toBe(failure ? 'Original briefing' : 'New briefing');
    expect(Buffer.from(row!.audio!).toString()).toBe(failure ? 'old-audio' : 'new-audio');
  });
}
