// Morning Decode: one shared audio briefing per UTC trading day for every user.
// Script LLM + TTS stay server-side; the Home API never returns the transcript.
import { eq } from 'drizzle-orm';
import { aiMarketBriefs } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { MarketDataService } from '../../market/application/market-data.service';
import {
  estimateDurationSeconds,
  MORNING_DECODE_SYSTEM,
  trimToWordBudget,
  type BriefScriptLlm,
  type BriefTts,
} from './brief-script';

export type MorningDecodeView = {
  date: string;
  title: string;
  sessionLabel: string;
  /** Seconds; null until audio exists. */
  durationSeconds: number | null;
  hasAudio: boolean;
  available: boolean;
  generatedAt: string | null;
  disclaimer: string;
};

export type NewsHeadline = { title: string; publisher: string; assets: string[] };

const DISCLAIMER = 'Educational market briefing only — not investment advice.';
const TITLE = 'Morning Decode';

function utcDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function previousSessionLabel(date: string): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return `Previous session · ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
}

export class MorningDecodeService {
  private readonly inflight = new Map<string, Promise<MorningDecodeView>>();

  constructor(
    private readonly deps: {
      db: AppDatabase;
      market: MarketDataService;
      script?: BriefScriptLlm;
      tts?: BriefTts;
      news?: { latest(limit: number): Promise<NewsHeadline[]> };
      clock?: { now(): Date };
    },
  ) {}

  /** Metadata only — never the script text. Generates once per UTC day when missing. */
  async today(): Promise<MorningDecodeView> {
    const date = utcDateString((this.deps.clock ?? { now: () => new Date() }).now());
    const existing = await this.deps.db.query.aiMarketBriefs.findFirst({ where: eq(aiMarketBriefs.briefDate, date) });
    if (existing) return this.view(existing);

    const pending = this.inflight.get(date);
    if (pending) return pending;

    const job = this.generate(date).finally(() => this.inflight.delete(date));
    this.inflight.set(date, job);
    return job;
  }

  /** Replaces today's briefing only after both script and audio succeed. Ops only. */
  async forceToday(): Promise<MorningDecodeView> {
    const date = utcDateString((this.deps.clock ?? { now: () => new Date() }).now());
    const pending = this.inflight.get(date);
    if (pending) await pending;
    const job = this.generate(date, true).finally(() => this.inflight.delete(date));
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

  private view(row: typeof aiMarketBriefs.$inferSelect): MorningDecodeView {
    const hasAudio = !!(row.audio && row.audio.length);
    return {
      date: String(row.briefDate),
      title: TITLE,
      sessionLabel: previousSessionLabel(String(row.briefDate)),
      durationSeconds: row.durationSeconds ?? (hasAudio ? estimateDurationSeconds(row.content) : null),
      hasAudio,
      available: hasAudio,
      generatedAt: row.createdAt.toISOString(),
      disclaimer: DISCLAIMER,
    };
  }

  private async collectFacts(date: string): Promise<string> {
    const [movers, losers, volume, headlines] = await Promise.all([
      this.deps.market.tickerList({ exchange: 'BINANCE', quoteAsset: 'USDT', sort: 'gainers', limit: 8 }).catch(() => []),
      this.deps.market.tickerList({ exchange: 'BINANCE', quoteAsset: 'USDT', sort: 'losers', limit: 5 }).catch(() => []),
      this.deps.market.tickerList({ exchange: 'BINANCE', quoteAsset: 'USDT', sort: 'volume', limit: 8 }).catch(() => []),
      this.deps.news?.latest(8).catch(() => []) ?? Promise.resolve([]),
    ]);
    const lines = [
      `Briefing date (UTC publish day): ${date}`,
      `Session covered: previous completed crypto trading day before ${date} UTC.`,
      'Verified 24h movers (BINANCE USDT):',
      'Gainers: ' + (movers.map(t => `${t.symbol} ${t.priceChangePercent}% last ${t.lastPrice}`).join('; ') || 'unavailable'),
      'Losers: ' + (losers.map(t => `${t.symbol} ${t.priceChangePercent}% last ${t.lastPrice}`).join('; ') || 'unavailable'),
      'Most traded by quote volume: ' + (volume.map(t => `${t.symbol} vol ${t.quoteVolume} last ${t.lastPrice}`).join('; ') || 'unavailable'),
    ];
    if (headlines.length) {
      lines.push('Recent verified headlines:');
      for (const h of headlines) {
        lines.push(`- ${h.title} (${h.publisher}${h.assets.length ? `; assets ${h.assets.join(',')}` : ''})`);
      }
    } else {
      lines.push('Recent headlines: unavailable');
    }
    return lines.join('\n');
  }

  private fallbackScript(date: string, facts: string): string {
    const gainer = facts.match(/Gainers: ([^;\n]+)/)?.[1];
    const loser = facts.match(/Losers: ([^;\n]+)/)?.[1];
    return trimToWordBudget([
      `Good morning. This is your Morning Decode for the session ahead of ${date} UTC.`,
      gainer ? `On the upside, ${gainer} led the verified movers.` : 'Major upside movers were limited in the verified feed.',
      loser ? `On the downside, ${loser} stood out among the losers.` : '',
      'Liquidity remained concentrated in the most-traded USDT pairs. Confirm levels on the chart before you size any paper trade.',
      'That is your Morning Decode.',
    ].filter(Boolean).join(' '));
  }

  private async generate(date: string, replace = false): Promise<MorningDecodeView> {
    const facts = await this.collectFacts(date);
    let script = '';
    let textModel: string | null = null;

    if (this.deps.script) {
      try {
        const result = await this.deps.script.complete({
          system: MORNING_DECODE_SYSTEM,
          user: `Write today's Morning Decode from these verified facts only:\n\n${facts}`,
        });
        script = trimToWordBudget(result.text.replace(/\s+/g, ' ').trim());
        textModel = result.model;
      } catch (error) {
        console.warn('[ai] morning decode script failed', error instanceof Error ? error.message : error);
      }
    }

    if (replace && !script) throw new Error('Morning Decode script generation failed; previous briefing preserved.');
    if (!script) script = this.fallbackScript(date, facts);

    let audio: Buffer | null = null;
    let audioContentType: string | null = null;
    let audioModel: string | null = null;
    let durationSeconds = estimateDurationSeconds(script);

    if (this.deps.tts) {
      try {
        const spoken = script.slice(0, 4000);
        const result = await this.deps.tts.speak(spoken);
        audio = result.bytes;
        audioContentType = result.contentType;
        audioModel = result.model;
      } catch (error) {
        console.warn('[ai] morning decode TTS failed', error instanceof Error ? error.message : error);
      }
    }

    if (replace && !audio?.length) throw new Error('Morning Decode audio generation failed; previous briefing preserved.');

    const values = {
      briefDate: date,
      content: script,
      audio: audio ?? undefined,
      audioContentType: audioContentType ?? undefined,
      durationSeconds,
      textModel: textModel ?? undefined,
      audioModel: audioModel ?? undefined,
    };
    const insert = this.deps.db.insert(aiMarketBriefs).values(values);
    const [row] = await (replace
      ? insert.onConflictDoUpdate({ target: aiMarketBriefs.briefDate, set: { ...values, createdAt: (this.deps.clock ?? { now: () => new Date() }).now() } })
      : insert.onConflictDoNothing()).returning();

    if (row) return this.view(row);
    const again = await this.deps.db.query.aiMarketBriefs.findFirst({ where: eq(aiMarketBriefs.briefDate, date) });
    if (!again) throw new Error('Failed to persist Morning Decode');
    return this.view(again);
  }
}

/** @deprecated Use MorningDecodeService — kept as a type alias for older imports. */
export { MorningDecodeService as DailyBriefService };
export type { MorningDecodeView as DailyBriefView };
