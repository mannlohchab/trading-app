import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoApi } from '../src/lib/demoData.ts';
import { buildPortfolioAllocation } from '../src/lib/portfolioAllocation.ts';
import { buildHistoryChart } from '../src/lib/marketHistory.ts';
import { buildPreviewChart } from '../src/lib/stockPreview.ts';

const request = (demo, path, method = 'GET', body) => demo.request(path, { method, body });

test('demo portfolio is populated and its allocation and profit totals agree', async () => {
  const demo = createDemoApi();
  const { portfolio, community, user } = await request(demo, '/api/users/me/overview');
  assert.equal(user.id, 'demo-preview-user');
  assert.ok(community.posts > 0);
  assert.ok(portfolio.positions.length >= 4);
  assert.ok(buildPortfolioAllocation(portfolio));
  assert.ok(Math.abs(portfolio.equity - portfolio.startingBalance - portfolio.totalPnl) < 0.01);
  assert.ok(Math.abs(portfolio.realizedPnl + portfolio.unrealizedPnl - portfolio.totalPnl) < 0.01);
});

test('watchlists, explore, overview and all chart ranges have labeled sample data', async () => {
  const demo = createDemoApi();
  const { watchlists } = await request(demo, '/api/watchlists');
  const { items } = await request(demo, `/api/watchlists/${watchlists[0].id}/items`);
  assert.ok(items.length >= 10);
  assert.ok(items.every(item => item.quote.source === 'demo' && item.quote.ltp > 0));
  const explore = await request(demo, '/api/market/explore');
  assert.ok(explore.gainers.length && explore.losers.length);
  for (const [timeframe, range] of [['5m', '1D'], ['1h', '7D'], ['1d', '15D'], ['1d', '1M'], ['1d', '3M']]) {
    const history = await request(demo, `/api/market/candles/RELIANCE?timeframe=${timeframe}&liveOnly=true`);
    assert.equal(history.isDemo, true);
    assert.equal(buildPreviewChart(history, range), null);
    assert.ok(buildPreviewChart(history, range, true)?.points.length > 1);
    if (range === '1D') {
      assert.equal(buildHistoryChart(history), null);
      assert.ok(buildHistoryChart(history, true));
    }
    const { quote } = await request(demo, '/api/market/quote/RELIANCE');
    assert.equal(history.candles.at(-1).close, quote.ltp);
    assert.ok(history.candles.every((c, i, all) => c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && (!i || c.time > all[i - 1].time)));
  }
});

test('local edits round trip without mutating other demo instances or response snapshots', async () => {
  const demo = createDemoApi();
  const before = await request(demo, '/api/users/me/overview');
  await request(demo, '/api/users/me', 'PATCH', { displayName: 'Preview name', bio: '' });
  assert.equal((await request(demo, '/api/users/me/overview')).user.displayName, 'Preview name');
  assert.notEqual(before.user.displayName, 'Preview name');
  assert.notEqual((await request(createDemoApi(), '/api/users/me/overview')).user.displayName, 'Preview name');
  const { watchlists } = await request(demo, '/api/watchlists');
  const path = `/api/watchlists/${watchlists[0].id}/items`;
  const { items } = await request(demo, path);
  await request(demo, `${path}/${items[0].id}`, 'DELETE');
  assert.equal((await request(demo, path)).items.length, items.length - 1);
  await request(demo, path, 'POST', items[0]);
  assert.equal((await request(demo, path)).items.length, items.length);
});

test('community has posts and comments and supports local interaction', async () => {
  const demo = createDemoApi();
  const { posts } = await request(demo, '/api/community/feed?tab=foryou');
  const post = posts[0];
  await request(demo, `/api/community/posts/${post.id}/like`, 'POST');
  const detail = await request(demo, `/api/community/posts/${post.id}`);
  assert.equal(detail.post.likeCount, post.likeCount + 1);
  assert.ok(detail.comments.length);
  await request(demo, `/api/community/posts/${post.id}/comments`, 'POST', { content: 'A preview comment' });
  assert.equal((await request(demo, `/api/community/posts/${post.id}`)).comments.at(-1).content, 'A preview comment');
  await request(demo, '/api/community/posts', 'POST', { content: 'My preview post', symbol: 'TCS' });
  assert.equal((await request(demo, '/api/community/feed?tab=foryou')).posts[0].content, 'My preview post');
});

test('sample AI streams labeled answers into conversation history and handles aborts', async () => {
  const demo = createDemoApi();
  const events = [];
  await demo.stream({ message: 'Review my portfolio', kind: 'portfolio' }, event => events.push(event));
  const id = events.find(event => event.type === 'meta').conversationId;
  assert.equal(events.at(-1).type, 'done');
  assert.match(events.filter(event => event.type === 'token').map(event => event.content).join(''), /sample|demo/i);
  assert.equal((await request(demo, `/api/ai/conversations/${id}`)).messages.length, 2);
  const controller = new AbortController();
  const canceled = [];
  await assert.rejects(demo.stream({ message: 'Stop me' }, event => {
    canceled.push(event);
    if (event.type === 'token') controller.abort();
  }, controller.signal), /abort/i);
  assert.equal(canceled.some(event => event.type === 'done'), false);
});

test('unsupported writes and unknown requests fail instead of contacting the backend', async () => {
  const demo = createDemoApi();
  await assert.rejects(request(demo, '/api/trading/orders', 'POST', { quantity: 1 }), /preview|demo/i);
  await assert.rejects(request(demo, '/api/users/me/password', 'POST', {}), /preview|demo/i);
  await assert.rejects(request(demo, '/api/unknown'), /preview|demo/i);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(demo.request('/api/users/me/overview', { signal: controller.signal }), /abort/i);
});

test('demo quote, homepage and Explore share the same intraday prices and session totals', async () => {
  const demo = createDemoApi();
  for (const symbol of ['NIFTY', 'BANKNIFTY', 'INDIAVIX', 'RELIANCE', 'ITC']) {
    const { quote } = await request(demo, `/api/market/quote/${encodeURIComponent(symbol)}`);
    const { candles } = await request(demo, `/api/market/candles/${encodeURIComponent(symbol)}?timeframe=5m`);
    assert.deepEqual(quote.sparkline, candles.map(c => c.close));
    assert.equal(quote.sparkline.at(-1), quote.ltp);
    assert.equal(quote.open, candles[0].open);
    assert.equal(quote.high, Math.max(...candles.map(c => c.high)));
    assert.equal(quote.low, Math.min(...candles.map(c => c.low)));
    assert.equal(quote.volume, candles.reduce((sum, c) => sum + c.volume, 0));
  }
});

test('demo sessions are stable, distinct per instrument and contain advances and pullbacks', async () => {
  const demo = createDemoApi();
  const shapes = [];
  for (const symbol of ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'INDIAVIX', 'RELIANCE', 'ITC']) {
    const { quote } = await request(demo, `/api/market/quote/${encodeURIComponent(symbol)}`);
    const prices = quote.sparkline;
    assert.ok(prices.length >= 60);
    const moves = prices.slice(1).map((p, i) => p - prices[i]);
    assert.ok(moves.filter(n => n > 0).length >= 5, `${symbol} needs upward moves`);
    assert.ok(moves.filter(n => n < 0).length >= 5, `${symbol} needs pullbacks`);
    shapes.push(moves.map(n => Math.sign(n)).join(','));
    assert.deepEqual((await request(createDemoApi(), `/api/market/quote/${encodeURIComponent(symbol)}`)).quote.sparkline, prices);
  }
  assert.equal(new Set(shapes).size, shapes.length);
});

test('demo discovery prioritizes crypto and forex with correct precision and keeps INR portfolio separate', async () => {
  const demo = createDemoApi();
  const explore = await request(demo, '/api/market/explore');
  assert.ok(explore.crypto.some(q => q.symbol === 'BTCUSDT' && q.currency === 'USDT'));
  assert.ok(explore.forex.some(q => q.symbol === 'EUR/USD' && q.pricePrecision === 5));
  const history = await request(demo, '/api/market/candles/EUR%2FUSD?timeframe=5m&exchange=FOREX');
  assert.equal(history.isDemo, true); assert.equal(history.currency, 'USD');
  assert.ok(history.candles.some(c => Math.round(c.close * 100) / 100 !== c.close));
  const portfolio = await request(demo, '/api/trading/portfolio');
  assert.ok(portfolio.positions.every(p => p.exchange === 'NSE'));
});
