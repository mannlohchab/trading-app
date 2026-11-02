import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { DEMO_MODE } from '@/lib/demoMode';
import type { HistoryResponse } from '@/lib/marketHistory';

/** Home and Explore share one cached intraday series for each instrument. */
export function useMarketHistory(symbol: string, exchange: string) {
  return useQuery({
    queryKey: ['watchlist-history', symbol, exchange, '5m', DEMO_MODE],
    queryFn: ({ signal }) => api<HistoryResponse>(
      `/api/market/candles/${encodeURIComponent(symbol)}?exchange=${encodeURIComponent(exchange)}&timeframe=5m&liveOnly=true`,
      { signal, auth: false },
    ),
    staleTime: exchange === 'FOREX' ? 300_000 : 60_000,
    refetchInterval: exchange === 'FOREX' ? 300_000 : 60_000,
    retry: false,
  });
}
