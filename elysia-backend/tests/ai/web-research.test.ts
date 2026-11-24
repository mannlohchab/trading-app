import { describe, expect, test } from 'bun:test';
import { OpenRouterResearchModel } from '../../src/modules/ai/infrastructure/openrouter-research';
import { FirecrawlClient } from '../../src/modules/ai/infrastructure/firecrawl-client';
import { WebResearchAgent, type ResearchModel, type ResearchTurn } from '../../src/modules/ai/application/web-research-agent';
import { createTools, ToolInputError, type MarketGateway, type StrategyDraftChecker } from '../../src/modules/ai/application/tools';
import { assertFreeNemotronModel, FREE_NEMOTRON_MODEL, freeNemotronChatBody } from '../../src/modules/ai/domain/free-nemotron';
import { assertPublicHttpUrl } from '../../src/modules/ai/domain/public-url';
import { buildSystemPrompt } from '../../src/modules/ai/domain/prompt';

const persona = { responseStyle: 'CONCISE' as const, explanationLevel: 'ADVANCED' as const, language: null, timezone: 'UTC' };

describe('free Nemotron routing', () => {
  test('pins the free model and a zero price ceiling, with no fallback list', () => {
    const body = freeNemotronChatBody({
      model: 'NVIDIA/Nemotron-3-Ultra-550B-A55B:free',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
      tools: [{ name: 'search_web', description: 'search', parameters: { type: 'object' } }],
    });
    expect(body.model).toBe(FREE_NEMOTRON_MODEL);
    expect(body.provider).toEqual({
      allow_fallbacks: false,
      sort: 'price',
      max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
    });
    expect(body.provider).not.toHaveProperty('data_collection');
    expect(body.usage).toEqual({ include: true });
    expect(body).not.toHaveProperty('models');
    expect(body).not.toHaveProperty('plugins');
    expect(body).not.toHaveProperty('route');
    expect(assertFreeNemotronModel('nvidia/nemotron-3.5-lightning:free')).toBe('nvidia/nemotron-3.5-lightning:free');
  });

  test('rejects paid models, the unscoped free router, and the paid Nemotron id', () => {
    for (const model of ['openai/gpt-4o-mini', 'openrouter/free', 'nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/nemotron-3-ultra-550b-a55b:free,openai/gpt-4o-mini']) {
      expect(() => assertFreeNemotronModel(model)).toThrow('cannot spend credits');
    }
  });

  test('the client sends that body and discards a billed or unverified completion', async () => {
    const seen: unknown[] = [];
    const fetch = async (_url: string, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)));
      return Response.json({
        model: FREE_NEMOTRON_MODEL,
        usage: { cost: 0, cost_details: { upstream_inference_cost: 0 } },
        choices: [{ message: { content: 'From the page.', tool_calls: [] } }],
      });
    };
    const model = new OpenRouterResearchModel({ apiKey: 'test-key', model: FREE_NEMOTRON_MODEL, fetch });
    const turn = await model.complete({ messages: [{ role: 'user', content: 'What changed?' }], maxOutputTokens: 200 });
    expect(turn.content).toBe('From the page.');
    expect(seen[0]).toMatchObject({ model: FREE_NEMOTRON_MODEL, provider: { allow_fallbacks: false, max_price: { prompt: 0, completion: 0, request: 0, image: 0 } } });
    expect(seen[0]).not.toHaveProperty('models');

    const billed = new OpenRouterResearchModel({
      apiKey: 'test-key', model: FREE_NEMOTRON_MODEL,
      fetch: async () => Response.json({ model: 'openai/gpt-4o-mini', usage: { cost: 0.01 }, choices: [{ message: { content: 'paid answer' } }] }),
    });
    await expect(billed.complete({ messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 20 })).rejects.toThrow(/non-zero cost|different model/);

    const unverified = new OpenRouterResearchModel({
      apiKey: 'test-key', model: FREE_NEMOTRON_MODEL,
      fetch: async () => Response.json({ choices: [{ message: { content: 'no usage' } }] }),
    });
    await expect(unverified.complete({ messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 20 })).rejects.toThrow('did not report a cost');

    let called = false;
    const paid = new OpenRouterResearchModel({
      apiKey: 'test-key', model: 'openai/gpt-4o-mini',
      fetch: async () => { called = true; return Response.json({}); },
    });
    await expect(paid.complete({ messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 20 })).rejects.toThrow('cannot spend credits');
    expect(called).toBe(false);
  });
});

describe('public page URLs', () => {
  test('allows public https and rejects private or internal hosts', () => {
    expect(assertPublicHttpUrl('https://www.sec.gov/news/press-release')).toBe('https://www.sec.gov/news/press-release');
    for (const url of [
      'http://127.0.0.1/latest',
      'http://169.254.169.254/latest/meta-data',
      'http://10.1.2.3/admin',
      'http://192.168.1.8/',
      'http://firecrawl-api:3002/v2/scrape',
      'http://localhost/news',
      'file:///etc/passwd',
      'https://user:secret@example.com/private',
      'http://[::1]/',
      'http://[fc00::1]/',
      'http://[::ffff:127.0.0.1]/',
    ]) {
      expect(() => assertPublicHttpUrl(url)).toThrow();
    }
  });
});

describe('Firecrawl client', () => {
  test('searches and scrapes without sending an LLM request, and drops private results', async () => {
    const calls: { url: string; body: Record<string, unknown>; auth?: string }[] = [];
    const fetch = async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url, body, auth: (init?.headers as Record<string, string>).Authorization });
      if (String(url).endsWith('/v2/search')) {
        return Response.json({
          success: true,
          data: { web: [
            { url: 'https://www.sec.gov/news/etf', title: 'ETF', description: 'A filing' },
            { url: 'http://127.0.0.1/secret', title: 'nope', description: 'internal' },
          ] },
        });
      }
      return Response.json({ success: true, data: { markdown: 'The filing text.', metadata: { title: 'ETF', sourceURL: 'https://www.sec.gov/news/etf' } } });
    };
    const client = new FirecrawlClient({ baseUrl: 'http://firecrawl-api:3002/', apiKey: 'crawl-key', fetch });
    expect(await client.search('bitcoin etf', 5)).toEqual([{ url: 'https://www.sec.gov/news/etf', title: 'ETF', description: 'A filing' }]);
    expect(await client.scrape('https://www.sec.gov/news/etf')).toMatchObject({ markdown: 'The filing text.', title: 'ETF' });
    expect(calls[0]!.body).toEqual({ query: 'bitcoin etf', limit: 5, timeout: 15_000 });
    expect(calls[1]!.body).toMatchObject({ formats: ['markdown'], onlyMainContent: true });
    expect(calls[1]!.body).not.toHaveProperty('extract');
    expect(calls.every(call => call.auth === 'Bearer crawl-key')).toBe(true);
    await expect(client.scrape('http://169.254.169.254/latest')).rejects.toThrow('not a public web page');
    expect(calls).toHaveLength(2);
  });
});

describe('web research sub-agent', () => {
  test('searches, reads a returned page, and answers from it', async () => {
    const script: ResearchTurn[] = [
      { content: '', model: FREE_NEMOTRON_MODEL, toolCalls: [{ id: 's1', name: 'search_web', arguments: JSON.stringify({ query: 'SEC bitcoin ETF' }) }] },
      { content: '', model: FREE_NEMOTRON_MODEL, toolCalls: [{ id: 'r1', name: 'read_page', arguments: JSON.stringify({ url: 'https://www.sec.gov/news/etf/' }) }] },
      { content: 'The SEC published an ETF notice. https://www.sec.gov/news/etf', model: FREE_NEMOTRON_MODEL, toolCalls: [] },
    ];
    const reads: string[] = [];
    const model: ResearchModel = { async complete() { return script.shift()!; } };
    const agent = new WebResearchAgent({
      model,
      crawler: {
        async search() { return [{ url: 'https://www.sec.gov/news/etf', title: 'ETF', description: 'notice' }]; },
        async scrape(url) { reads.push(url); return { url, title: 'ETF', markdown: 'The Commission published a notice.' }; },
      },
    });
    const brief = await agent.research('What did the SEC publish about bitcoin ETFs?');
    expect(brief.sources).toEqual([{ url: 'https://www.sec.gov/news/etf', title: 'ETF' }]);
    expect(brief.answer).toContain('SEC');
    expect(brief.model).toBe(FREE_NEMOTRON_MODEL);
    expect(reads).toEqual(['https://www.sec.gov/news/etf']);
    expect(script).toHaveLength(0);
  });

  test('does not read a page that search did not return', async () => {
    const model: ResearchModel = {
      async complete(input) {
        const last = input.messages.at(-1)!;
        if (last.role === 'user') return { content: '', model: FREE_NEMOTRON_MODEL, toolCalls: [{ id: 's', name: 'search_web', arguments: '{"query":"rates"}' }] };
        if (last.role === 'tool' && last.content.includes('example.com')) {
          return { content: '', model: FREE_NEMOTRON_MODEL, toolCalls: [{ id: 'r', name: 'read_page', arguments: '{"url":"https://evil.example/phish"}' }] };
        }
        return { content: 'Could not verify a source.', model: FREE_NEMOTRON_MODEL, toolCalls: [] };
      },
    };
    const agent = new WebResearchAgent({
      model,
      crawler: {
        async search() { return [{ url: 'https://example.com/news', title: 'News', description: 'item' }]; },
        async scrape() { throw new Error('scrape should not run'); },
      },
    });
    await expect(agent.research('What happened to rates today?')).rejects.toThrow('sourced answer');
  });
});

describe('research_web tool', () => {
  const market: MarketGateway = {
    exchange: 'BINANCE',
    async searchSymbols() { return []; },
    async tickers() { return []; },
    async topMovers() { return []; },
    async analyze() { return { summary: null, source: 'store' }; },
    async candles() { return { candles: [], source: 'store' }; },
  };
  const checker: StrategyDraftChecker = { async validate() { return { ok: false, errors: {} }; } };

  test('is omitted unless configured, and can run once per turn', async () => {
    expect(createTools(market, checker).some(tool => tool.spec.name === 'research_web')).toBe(false);
    const tools = createTools(market, checker, undefined, undefined, undefined, undefined, {
      async research() {
        return { answer: 'A notice was published.', sources: [{ url: 'https://example.com/a', title: 'A' }], searches: 1, pagesRead: 1, model: FREE_NEMOTRON_MODEL };
      },
    });
    const tool = tools.find(item => item.spec.name === 'research_web')!;
    const outcome = await tool.run({ question: 'What did the exchange announce?' });
    expect(outcome.result).toMatchObject({ cost: 0, model: FREE_NEMOTRON_MODEL, answer: 'A notice was published.' });
    await expect(tool.run({ question: 'What else was announced?' })).rejects.toBeInstanceOf(ToolInputError);
  });
});

test('the assistant prompt mentions web research only when the sub-agent is configured', () => {
  expect(buildSystemPrompt(persona, new Date('2026-11-24T00:00:00Z'))).not.toContain('research_web');
  expect(buildSystemPrompt(persona, new Date('2026-11-24T00:00:00Z'), { webResearch: true })).toContain('call research_web once');
});
