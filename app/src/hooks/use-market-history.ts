import { useQuery } from '@tanstack/react-query';

import { DEMO_MODE } from '@/lib/demoMode';
import { fetchHistory } from '@/lib/marketData';

/** Home and Explore share one cached intraday series (5m closes) for each instrument. */
export function useMarketHistory(symbol: string, exchange: string) {
  return useQuery({
    queryKey: ['watchlist-history', symbol, exchange, '5m', DEMO_MODE],
    queryFn: ({ signal }) => fetchHistory(symbol, '5m', 24, signal),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
}
