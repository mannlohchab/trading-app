import { api } from './api';
import type { BacktestRun, BacktestTrade, CreateBacktestInput, EquityPoint, StrategyDetail, StrategySummary } from './backtesting';

const path = (id: string) => `/api/v1/backtests/${encodeURIComponent(id)}`;
export const listBacktests = (before?: string, signal?: AbortSignal) => api<{ backtests: BacktestRun[]; nextBefore: string | null }>(`/api/v1/backtests?limit=20${before ? `&before=${encodeURIComponent(before)}` : ''}`, { signal });
export const getBacktest = (id: string, signal?: AbortSignal) => api<BacktestRun>(path(id), { signal });
export const createBacktest = (input: CreateBacktestInput) => api<BacktestRun>('/api/v1/backtests', { method: 'POST', body: input });
export const cancelBacktest = (id: string) => api<BacktestRun>(`${path(id)}/cancel`, { method: 'POST' });
export const replayBacktest = (id: string) => api<BacktestRun>(`${path(id)}/replay`, { method: 'POST', body: {} });
export type ArchivedBacktestDataset = {
  backtestId: string; checksum: string;
  dataset: NonNullable<BacktestRun['dataset']>;
  input: {
    tradingStartTime?: number;
    candles: { openTime: number; closeTime: number; open: string; high: string; low: string; close: string; volume: string }[];
  };
};
export const getBacktestDataset = (id: string, signal?: AbortSignal) => api<ArchivedBacktestDataset>(`${path(id)}/dataset`, { signal });
export const getBacktestEquity = (id: string, signal?: AbortSignal) => api<{ backtestId: string; points: EquityPoint[]; initialCapital: string }>(`${path(id)}/equity-curve?maxPoints=200`, { signal });
export const getBacktestTrades = (id: string, offset: number, signal?: AbortSignal) => api<{ trades: BacktestTrade[]; total: number; limit: number; offset: number }>(`${path(id)}/trades?limit=30&offset=${offset}`, { signal });
export const listBacktestStrategies = (offset = 0, signal?: AbortSignal) => api<{ strategies: StrategySummary[]; total: number }>(`/api/v1/strategies?limit=50&offset=${offset}`, { signal });
export const getBacktestStrategy = (id: string, signal?: AbortSignal) => api<StrategyDetail>(`/api/v1/strategies/${encodeURIComponent(id)}`, { signal });
