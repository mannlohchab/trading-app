import { expect, spyOn, test } from 'bun:test';
import { db } from '../src/db';
import { portfolioSummary } from '../src/modules/trading/engine';
import { getMarketDataProvider } from '../src/providers/marketData';

test('portfolio valuation fails when a position has no market quote instead of using its entry price', async () => {
  const account = spyOn(db.query.paperAccounts, 'findFirst').mockResolvedValue({
    id: 'test-account', userId: 'test-user', cashBalance: 1000, startingBalance: 10000,
    realizedPnl: 0, createdAt: '', updatedAt: '',
  });
  const positions = spyOn(db.query.positions, 'findMany').mockResolvedValue([
    { id: 'test-position', userId: 'test-user', accountId: 'test-account', symbol: 'ETHUSDT', exchange: 'BINANCE',
      name: 'Ethereum / Tether', quantity: 0.5, avgPrice: 3200, realizedPnl: 0, createdAt: '', updatedAt: '' },
  ] as any);
  const quotes = spyOn(getMarketDataProvider(), 'quotes').mockResolvedValue([]);
  try {
    await expect(portfolioSummary('test-user')).rejects.toThrow('Market quote unavailable');
  } finally {
    account.mockRestore(); positions.mockRestore(); quotes.mockRestore();
  }
});
