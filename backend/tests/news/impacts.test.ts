import { describe, expect, test } from 'bun:test';
import { classifyAssetCode, detectMacroImpacts, impactsForArticle } from '../../src/modules/news/domain/impacts';
import { normalizeItem } from '../../src/modules/news/domain/article';

describe('macro impact detection', () => {
  test('tags gold, oil and major FX from headlines', () => {
    const impacts = detectMacroImpacts('Spot gold jumps as the US dollar softens; WTI crude oil steadies');
    expect(impacts.map(i => i.code).sort()).toEqual(['USD', 'WTI', 'XAU']);
    expect(impacts.find(i => i.code === 'XAU')?.kind).toBe('commodity');
    expect(impacts.find(i => i.code === 'USD')?.kind).toBe('currency');
  });

  test('classifies stored asset codes for chips', () => {
    expect(classifyAssetCode('BTC')).toMatchObject({ kind: 'crypto', label: 'Bitcoin' });
    expect(classifyAssetCode('EURUSD')).toMatchObject({ kind: 'fx_pair', label: 'EUR/USD' });
  });

  test('normalizeItem stores macro codes in assets for ?asset= filters', () => {
    const draft = normalizeItem({
      url: 'https://example.com/gold-rally',
      title: 'Gold prices surge while EUR/USD holds above 1.08',
      summary: 'Bullion and the euro attracted bids.',
      publisher: 'Example Wire',
    }, 'test', new Date('2026-11-22T12:00:00Z'));
    expect(draft?.assets).toEqual(expect.arrayContaining(['EURUSD', 'XAU']));
    const chips = impactsForArticle(`${draft!.title} ${draft!.summary}`, draft!.assets);
    expect(chips.some(c => c.code === 'XAU' && c.kind === 'commodity')).toBe(true);
    expect(chips.some(c => c.code === 'EURUSD' && c.kind === 'fx_pair')).toBe(true);
  });
});
