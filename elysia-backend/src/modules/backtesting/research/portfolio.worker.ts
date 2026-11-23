import { parseMarketDataset } from '../datasets/import';
import { optionsExperimentSchema, simulateOptionsPortfolio } from '../market-models/options';

try {
  const { dataset, execution } = JSON.parse(await Bun.stdin.text());
  const parsed = parseMarketDataset(dataset);
  const result = simulateOptionsPortfolio(parsed.dataset, optionsExperimentSchema.parse(execution));
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Portfolio simulation failed.' }));
}
