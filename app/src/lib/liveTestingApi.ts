import { api } from './api';
import type { LiveTestTermination } from './aiResearchRun';

export type LiveTest = {
  id: string; status: 'CREATED' | 'RUNNING' | 'PAUSED' | 'STOPPED' | 'FAILED'; accountId: string;
  strategy: { name: string; version: number } | null; exchange: string; symbol: string | null; timeframe: string;
  lastProcessedCandleTime: number | null; errorMessage: string | null; startedAt: string | null;
  positionSizing: { type: string; value: string } | null;
  execution: { commissionPercent: string; slippageBps: number } | null;
  protective: { stopLossPercent?: number; takeProfitPercent?: number } | null;
  endTime?: number | null; closePositionAtEnd?: boolean; termination?: LiveTestTermination | null;
  recentSignals: { id: string; candleOpenTime: number; action: string; status: string; reason: string | null; orderId: string | null }[];
};
export type LiveTestPortfolio = {
  accountId: string; currency: string; initialBalance: string; cashBalance: string; availableBalance: string;
  totalEquity: string; netPnl: string; returnPercent: string; realizedPnl: string; totalFees: string;
  unpricedSymbols: string[]; valuedAt: string;
  openPositions: { id: string; symbol: string; side: string; quantity: string; averageEntryPrice: string; markPrice: string | null; unrealizedPnl: string | null }[];
};
export const getLiveTest = (id: string, signal?: AbortSignal) => api<LiveTest>(`/api/v1/paper/strategies/${encodeURIComponent(id)}`, { signal });
export const getLiveTestPortfolio = (accountId: string, signal?: AbortSignal) => api<LiveTestPortfolio>(`/api/v1/paper/accounts/${encodeURIComponent(accountId)}/portfolio`, { signal });
export const controlLiveTest = (id: string, action: 'pause' | 'resume' | 'stop', closePosition = false) => api<LiveTest>(`/api/v1/paper/strategies/${encodeURIComponent(id)}/${action}`, { method: 'POST', ...(action === 'stop' ? { body: { closePosition } } : {}) });
