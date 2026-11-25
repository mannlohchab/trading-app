// Gathers the per-turn user snapshot from other modules. Each section loads independently with a
// short deadline: a slow or failing source is left out instead of delaying or failing the turn.
// Holdings come from the stored table only (no price lookups), so this stays cheap.
import type { UserSnapshotSource } from '../application/ports';
import { SNAPSHOT_LIMITS, type UserSnapshot } from '../domain/turn-context';

type Named = { name?: unknown } | null | undefined;
const nameOf = (s: Named) => (s && typeof s.name === 'string' ? s.name : null);
const numberOr = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export type UserSnapshotDeps = {
  strategies?: { list(userId: string, limit: number, offset: number): Promise<{ items: { name: string }[]; total: number }> };
  backtests?: { list(userId: string, raw: { limit: number }): Promise<{ backtests: { status: string; strategy: Named; market: { symbol?: string; timeframe?: string }; summary: Record<string, unknown> | null }[] }> };
  liveTests?: { list(userId: string, raw: { status: 'CREATED' | 'RUNNING' | 'PAUSED'; limit: number }): Promise<{ strategies: { status: string; strategy: Named; symbol: string | null; timeframe: string | null }[] }> };
  holdings?: { list(userId: string): Promise<{ holdings: { asset: string }[] }> };
  memories?: { list(userId: string): Promise<{ id: string; content: string }[]> };
  timeoutMs?: number;
  log?: (message: string, error?: unknown) => void;
};

export function userSnapshotSource(deps: UserSnapshotDeps): UserSnapshotSource {
  const timeoutMs = deps.timeoutMs ?? 1500;
  const section = async <T>(label: string, load: (() => Promise<T>) | undefined): Promise<T | undefined> => {
    if (!load) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        load(),
        new Promise<undefined>(resolve => { timer = setTimeout(() => { deps.log?.(`User snapshot: ${label} timed out`); resolve(undefined); }, timeoutMs); }),
      ]);
    } catch (error) {
      deps.log?.(`User snapshot: ${label} failed`, error);
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async forUser(userId) {
      const { strategies, backtests, liveTests, holdings, memories } = deps;
      const [s, b, l, h, m] = await Promise.all([
        section('strategies', strategies && (async () => {
          const page = await strategies.list(userId, SNAPSHOT_LIMITS.strategies, 0);
          return { total: page.total, recent: page.items.map(i => ({ name: i.name })) };
        })),
        section('backtests', backtests && (async () => {
          const page = await backtests.list(userId, { limit: SNAPSHOT_LIMITS.backtests });
          return {
            recent: page.backtests.map(r => ({
              strategy: nameOf(r.strategy), symbol: r.market.symbol ?? null, timeframe: r.market.timeframe ?? null,
              status: r.status, totalReturnPercent: numberOr(r.summary?.totalReturnPercent),
            })),
          };
        })),
        section('live tests', liveTests && (async () => {
          const pages = await Promise.all((['RUNNING', 'PAUSED', 'CREATED'] as const).map(status => liveTests.list(userId, { status, limit: SNAPSHOT_LIMITS.liveTests })));
          return {
            active: pages.flatMap(p => p.strategies).slice(0, SNAPSHOT_LIMITS.liveTests)
              .map(i => ({ strategy: nameOf(i.strategy), symbol: i.symbol, timeframe: i.timeframe, status: i.status })),
          };
        })),
        section('holdings', holdings && (async () => {
          const { holdings: rows } = await holdings.list(userId);
          return { lots: rows.length, assets: [...new Set(rows.map(r => r.asset))].slice(0, SNAPSHOT_LIMITS.assets) };
        })),
        section('memories', memories && (async () => (await memories.list(userId)).map(r => ({ id: r.id, content: r.content })))),
      ]);
      const snapshot: UserSnapshot = {};
      if (s) snapshot.strategies = s;
      if (b) snapshot.backtests = b;
      if (l) snapshot.liveTests = l;
      if (h) snapshot.holdings = h;
      if (m) snapshot.memories = m;
      return snapshot;
    },
  };
}
