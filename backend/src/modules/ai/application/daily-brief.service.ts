// Daily market brief for Home: one cached text (+ optional OpenRouter audio) per UTC day.
import { eq } from 'drizzle-orm';
import { aiMarketBriefs } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { MarketDataService } from '../../market/application/market-data.service';
import type { ChatModelProvider, ModelProfile } from './ports';
import type { OpenRouterTts } from '../infrastructure/openrouter-tts';

export type DailyBriefView = {
  date: string;
  content: string;
  hasAudio: boolean;
  generatedAt: string;
  disclaimer: string;
};

const DISCLAIMER = 'Educational market summary only — not investment advice.';

function utcDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

async function collectText(provider: ChatModelProvider, model: string, system: string, user: string): Promise<string> {
  let text = '';
  for await (const event of provider.stream({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxOutputTokens: 450,
    temperature: 0.4,
  })) {
    if (event.type === 'text') text += event.delta;
  }
  return text.trim();
}

export class DailyBriefService {
  private readonly inflight = new Map<string, Promise<DailyBriefView>>();

  constructor(
    private readonly deps: {
      db: AppDatabase;
      market: MarketDataService;
      providers: ChatModelProvider[];
      defaultModelId: string;
      models: ModelProfile[];
      tts?: OpenRouterTts;
      clock?: { now(): Date };
    },
  ) {}

  /** Returns today's brief, generating (and caching) it on first request. */
  async today(): Promise<DailyBriefView> {
    const date = utcDateString((this.deps.clock ?? { now: () => new Date() }).now());
    const existing = await this.deps.db.query.aiMarketBriefs.findFirst({ where: eq(aiMarketBriefs.briefDate, date) });
    if (existing) return this.view(existing);

    const pending = this.inflight.get(date);
    if (pending) return pending;

    const job = this.generate(date).finally(() => this.inflight.delete(date));
    this.inflight.set(date, job);
    return job;
  }

  async audioToday(): Promise<{ bytes: Buffer; contentType: string } | null> {
    const date = utcDateString((this.deps.clock ?? { now: () => new Date() }).now());
    let row = await this.deps.db.query.aiMarketBriefs.findFirst({ where: eq(aiMarketBriefs.briefDate, date) });
    if (!row) {
      await this.today();
      row = await this.deps.db.query.aiMarketBriefs.findFirst({ where: eq(aiMarketBriefs.briefDate, date) });
    }
    if (!row?.audio?.length) return null;
    return { bytes: row.audio, contentType: row.audioContentType || 'audio/mpeg' };
  }

  private view(row: typeof aiMarketBriefs.$inferSelect): DailyBriefView {
    return {
      date: String(row.briefDate),
      content: row.content,
      hasAudio: !!(row.audio && row.audio.length),
      generatedAt: row.createdAt.toISOString(),
      disclaimer: DISCLAIMER,
    };
  }

  private async generate(date: string): Promise<DailyBriefView> {
    const movers = await this.deps.market.tickerList({ exchange: 'BINANCE', quoteAsset: 'USDT', sort: 'gainers', limit: 5 }).catch(() => []);
    const losers = await this.deps.market.tickerList({ exchange: 'BINANCE', quoteAsset: 'USDT', sort: 'losers', limit: 3 }).catch(() => []);
    const volume = await this.deps.market.tickerList({ exchange: 'BINANCE', quoteAsset: 'USDT', sort: 'volume', limit: 5 }).catch(() => []);

    const facts = [
      `Date (UTC): ${date}`,
      'Top gainers (24h): ' + (movers.map(t => `${t.symbol} ${t.priceChangePercent}% @ ${t.lastPrice}`).join('; ') || 'unavailable'),
      'Top losers (24h): ' + (losers.map(t => `${t.symbol} ${t.priceChangePercent}% @ ${t.lastPrice}`).join('; ') || 'unavailable'),
      'Most traded: ' + (volume.map(t => `${t.symbol} vol ${t.quoteVolume}`).join('; ') || 'unavailable'),
    ].join('\n');

    const provider = this.deps.providers[0];
    const model = this.deps.models.find(m => m.id === this.deps.defaultModelId)?.providerModel
      ?? this.deps.models[0]?.providerModel
      ?? this.deps.defaultModelId;

    let content: string;
    let textModel: string | null = null;
    if (provider) {
      try {
        content = await collectText(
          provider,
          model,
          [
            'You write a concise daily crypto market brief for a mobile home screen.',
            'Use ONLY the facts provided. Do not invent prices or percentages.',
            'Structure: 1) one-sentence bias, 2) what moved (2-4 bullets), 3) one line on risk/what to watch.',
            'Under 160 words. No disclaimer (the app adds one). Not investment advice.',
          ].join(' '),
          facts,
        );
        textModel = model;
      } catch {
        content = '';
      }
    } else {
      content = '';
    }

    if (!content) {
      // Deterministic fallback when the LLM is offline — still useful on Home.
      const lines = [
        `Market brief · ${date} (UTC)`,
        movers[0] ? `Bias cue: ${movers[0].symbol} leads gainers at ${movers[0].priceChangePercent}% while ${losers[0]?.symbol ?? 'laggards'} soften.` : 'Live mover data is temporarily unavailable.',
        ...movers.slice(0, 3).map(t => `• ${t.symbol} ${t.priceChangePercent}% (last ${t.lastPrice})`),
        ...losers.slice(0, 2).map(t => `• ${t.symbol} ${t.priceChangePercent}%`),
        'Watch liquidity on the most-traded USDT pairs and confirm levels on the chart before acting.',
      ];
      content = lines.filter(Boolean).join('\n');
    }

    let audio: Buffer | null = null;
    let audioContentType: string | null = null;
    let audioModel: string | null = null;
    if (this.deps.tts) {
      try {
        const spoken = content.replace(/^• /gm, '').slice(0, 1500);
        const result = await this.deps.tts.speak(spoken);
        audio = result.bytes;
        audioContentType = result.contentType;
        audioModel = result.model;
      } catch (error) {
        console.warn('[ai] daily brief TTS failed', error instanceof Error ? error.message : error);
      }
    }

    const [row] = await this.deps.db.insert(aiMarketBriefs).values({
      briefDate: date,
      content,
      audio: audio ?? undefined,
      audioContentType: audioContentType ?? undefined,
      textModel: textModel ?? undefined,
      audioModel: audioModel ?? undefined,
    }).onConflictDoNothing().returning();

    if (row) return this.view(row);
    const again = await this.deps.db.query.aiMarketBriefs.findFirst({ where: eq(aiMarketBriefs.briefDate, date) });
    if (!again) throw new Error('Failed to persist daily brief');
    return this.view(again);
  }
}
