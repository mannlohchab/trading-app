// Portfolio aggregation: balances come from the account row (kept in step with the ledger in the same
// transaction as every change), positions are marked with current prices. No ledger replay per request.
import { dec } from '../../backtesting';
import { accountView } from '../accounts/account.service';
import type { AccountRepository } from '../accounts/account.repository';
import { PaperError } from '../paper-trading.errors';
import type { PositionRepository } from '../positions/position.repository';
import type { PositionService } from '../positions/position.service';
import { returnPercent } from './pnl.service';

export class PortfolioService {
  constructor(private readonly deps: { accounts: AccountRepository; positions: PositionRepository; positionService: PositionService }) {}

  async summary(userId: string, accountId: string) {
    const account = await this.deps.accounts.getForUser(userId, accountId);
    if (!account) throw new PaperError('NOT_FOUND', 'Paper account not found.');
    const a = accountView(account);
    const positions = await Promise.all((await this.deps.positions.openForAccount(accountId)).map(p => this.deps.positionService.view(p)));
    const unpriced = positions.filter(p => p.unrealizedPnl === null).map(p => p.symbol);
    const unrealized = dec.sum(positions.map(p => p.unrealizedPnl ?? '0'));
    // Without a fresh price a position is valued at cost (unrealized 0) and listed in `unpricedSymbols`.
    const equity = dec.add(a.cashBalance, unrealized);
    return {
      accountId, currency: a.currency, status: a.status,
      initialBalance: a.initialBalance,
      cashBalance: a.cashBalance,
      availableBalance: a.availableBalance,
      reservedBalance: a.reservedBalance,
      totalEquity: dec.round(equity, 8),
      realizedPnl: a.realizedPnl,
      unrealizedPnl: dec.round(unrealized, 8),
      totalFees: a.totalFees,
      netPnl: dec.round(dec.sub(equity, a.initialBalance), 8),
      returnPercent: returnPercent(equity, a.initialBalance),
      totalExposure: dec.round(dec.sum(positions.map(p => p.exposure)), 8),
      openPositions: positions,
      unpricedSymbols: unpriced,
      valuedAt: new Date().toISOString(),
    };
  }
}
