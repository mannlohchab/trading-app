import { getBacktest } from './backtestingApi';
import { getResearchExperiment } from './backtestResearchApi';
import { getLiveTest } from './liveTestingApi';
import { liveTerminationDescription, type AiResearchRun } from './aiResearchRun';

/** Keep query-cache cards compact, even when detailed experiment results contain many trades. */
export async function refreshResearchRun(run: AiResearchRun, signal?: AbortSignal): Promise<AiResearchRun> {
  if (run.kind === 'backtest') {
    const current = await getBacktest(run.id, signal);
    return { ...run, status: current.status, title: current.strategy.name ?? run.title, market: current.market, range: current.range,
      summary: current.summary ? { totalReturnPercent: current.summary.totalReturnPercent, netProfit: current.summary.netProfit, maxDrawdownPercent: current.summary.maxDrawdownPercent, totalTrades: current.summary.totalTrades } : undefined,
      message: current.error?.message ?? current.warnings?.map(w => w.message).slice(0, 2).join(' · ') };
  }
  if (run.kind === 'experiment') {
    const current = await getResearchExperiment(run.id, signal), result = current.result;
    return { ...run, status: current.status,
      summary: result?.metrics ? { totalReturnPercent: result.metrics.totalReturnPercent, netProfit: result.metrics.netProfit, maxDrawdownPercent: result.metrics.maxDrawdownPercent, totalTrades: result.metrics.totalTrades }
        : result?.windows ? { testWindows: result.windows.length } : result ? { finalEquity: result.finalEquity, netProfit: result.netProfit } : undefined,
      message: current.error ?? (result?.status === 'MARGIN_BREACH' ? 'Stopped at a maintenance-margin breach; no liquidation fill was assumed.' : result?.windows ? 'Each unseen window starts with fresh capital. Open results to review the separate returns.' : result?.warnings?.slice(0, 2).join(' · ')) };
  }
  const current = await getLiveTest(run.id, signal);
  return { ...run, status: current.status, title: current.strategy?.name ?? run.title,
    market: { exchange: current.exchange, symbol: current.symbol ?? undefined, timeframe: current.timeframe },
    summary: { recentSignals: current.recentSignals.length, closeStatus: current.termination?.closeStatus },
    message: liveTerminationDescription(current.termination) ?? current.errorMessage ?? undefined };
}
