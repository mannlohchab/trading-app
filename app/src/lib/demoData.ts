import type { User } from '../store/auth';
import type { AiEvent, AiKind } from './aiChat';

type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };
type ChatBody = { conversationId?: string; message: string; kind?: AiKind; symbol?: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string };
type Conversation = { id: string; title: string; kind: AiKind; updatedAt: string; messages: Message[] };
const round = (value: number) => Math.round(value * 100) / 100;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function seededRandom(key: string) {
  let seed = 2166136261;
  for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** Fictional session shapes with irregular movement, never presented as real market history. */
function demoSessionPrices(symbol: string, timeframe: string, start: number, end: number, count: number, precision = 2) {
  const round = (n: number) => Number(n.toFixed(precision));
  const random = seededRandom(`${symbol}:${timeframe}`);
  // Opening rally / recovery / failed breakout / consolidation / late pullback.
  const profiles = [
    [0, 0.35, 0.18, 0.58, 0.42, 0.7, 0.64, 1],
    [0, -0.32, -0.22, 0.15, 0.7, 0.55, 0.85, 1],
    [0, 0.6, 0.4, 0.85, 0.45, 0.55, 1.15, 1],
    [0, 0.12, 0.45, 0.38, 0.88, 0.82, 0.69, 1],
    [0, 0.7, 0.15, 0.28, 0.85, 1.15, 0.95, 1],
  ];
  const profile = profiles[Math.floor(random() * profiles.length)];
  let walk = 0;
  const noise = Array.from({ length: count }, (_, i) => {
    const progress = i / (count - 1);
    const activity = progress < 0.2 ? 1.7 : progress > 0.8 ? 1.25 : 0.8;
    if (i) walk += (random() - random()) * activity * (random() > 0.96 ? 3 : 1);
    return walk;
  });
  const scale = end * (timeframe.endsWith('m') ? 0.009 : 0.035) / Math.sqrt(count);
  return noise.map((n, i) => {
    if (i === 0) return round(start);
    if (i === count - 1) return end;
    const progress = i / (count - 1);
    const position = progress * (profile.length - 1);
    const index = Math.floor(position);
    const trend = profile[index] + (profile[index + 1] - profile[index]) * (position - index);
    // A bridge pins the final observation to the displayed quote without a last-tick jump.
    return round(Math.max(0.01, start + (end - start) * trend + (n - progress * noise[count - 1]) * scale));
  });
}

/** Isolated preview state: never imports the network client or writes to storage. */
export function createDemoApi() {
  const now = Date.now();
  const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  let sequence = 0;
  const id = (prefix: string) => `preview-${prefix}-${++sequence}`;
  const user: User = {
    id: 'demo-preview-user', username: 'aarav.trades', email: 'aarav@example.com',
    displayName: 'Aarav Sharma', bio: 'Learning the markets, one thoughtful trade at a time. Forex & crypto enthusiast • Paper trader',
    avatarUrl: 'https://i.pinimg.com/1200x/35/16/9f/35169f77d14878a39f31ec1ffac3e115.jpg',
    theme: 'light', notifyPush: true, notifyEmail: false, privacyPublicProfile: true, createdAt: ago(24 * 120),
  };
  const session = () => ({ user: copy(user), accessToken: 'demo-preview-access', refreshToken: 'demo-preview-refresh' });
  const instruments: [string, string, string, number, number][] = [
    ['BTCUSDT', 'Bitcoin / Tether', 'BINANCE', 70123.45, 1.82], ['ETHUSDT', 'Ethereum / Tether', 'BINANCE', 2512.34, -0.63],
    ['SOLUSDT', 'Solana / Tether', 'BINANCE', 151.23, 2.14], ['BNBUSDT', 'BNB / Tether', 'BINANCE', 610.12, 0.92],
    ['XRPUSDT', 'XRP / Tether', 'BINANCE', 0.51234, -1.23], ['DOGEUSDT', 'Dogecoin / Tether', 'BINANCE', 0.12345, 1.65],
    ['EUR/USD', 'Euro / US Dollar', 'FOREX', 1.09123, 0.24], ['GBP/USD', 'British Pound / US Dollar', 'FOREX', 1.29123, -0.18],
    ['USD/JPY', 'US Dollar / Japanese Yen', 'FOREX', 153.125, 0.31], ['USD/CHF', 'US Dollar / Swiss Franc', 'FOREX', 0.86543, -0.14],
    ['AUD/USD', 'Australian Dollar / US Dollar', 'FOREX', 0.65123, 0.42], ['USD/CAD', 'US Dollar / Canadian Dollar', 'FOREX', 1.38123, 0.12],
    ['NZD/USD', 'New Zealand Dollar / US Dollar', 'FOREX', 0.59123, -0.21],
  ];
  const quotes = instruments.map(([symbol, name, exchange, ltp, changePercent], index) => {
    const currency = exchange === 'FOREX' ? symbol.slice(-3) : 'USDT';
    const pricePrecision = exchange === 'FOREX' ? currency === 'JPY' ? 3 : 5 : ltp < 1 ? 5 : 2;
    const round = (n: number) => Number(n.toFixed(pricePrecision));
    const close = round(ltp / (1 + changePercent / 100));
    return { symbol, name, exchange, currency, pricePrecision, assetClass: exchange === 'FOREX' ? 'forex' : 'crypto', ltp, changePercent, close, change: round(ltp - close),
      open: round(close * 1.002), high: round(Math.max(ltp, close) * 1.008), low: round(Math.min(ltp, close) * 0.994),
      volume: 850_000 + index * 173_921, source: 'demo' as const,
      sparkline: [] as number[],
    };
  });
  function quoteFor(symbol: string) {
    const quote = quotes.find(q => q.symbol === symbol.toUpperCase());
    if (!quote) throw new Error('This symbol is not included in the demo preview.');
    return quote;
  }
  // Forex ends at the last weekday's 21:00 UTC (New York close), so 1D always has a complete session.
  const sessionEnd = new Date(now);
  sessionEnd.setUTCHours(21, 0, 0, 0);
  if (sessionEnd.getTime() > now) sessionEnd.setUTCDate(sessionEnd.getUTCDate() - 1);
  while ([0, 6].includes(sessionEnd.getUTCDay())) sessionEnd.setUTCDate(sessionEnd.getUTCDate() - 1);
  function history(symbol: string, timeframe: string) {
    const quote = quoteFor(symbol);
    const round = (n: number) => Number(n.toFixed(quote.pricePrecision));
    const steps: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800, '1M': 2592000 };
    const step = steps[timeframe] ?? 300;
    const count = step < 3600 ? Math.floor(86400 / step) + 1 : step < 86400 ? 120 : 100;
    const end = quote.exchange === 'BINANCE' ? Math.floor(now / 1000 / step) * step : sessionEnd.getTime() / 1000;
    const start = step < 3600 ? quote.open : quote.ltp * 0.91;
    const prices = demoSessionPrices(symbol, timeframe, start, quote.ltp, count, quote.pricePrecision);
    const random = seededRandom(`${symbol}:${timeframe}:candles`);
    let previous = start;
    const candles = Array.from({ length: count }, (_, i) => {
      const progress = i / (count - 1);
      const close = prices[i];
      const open = round(previous);
      previous = close;
      const activity = progress < 0.2 || progress > 0.85 ? 2.1 : 1;
      return { time: end - (count - 1 - i) * step, open, close,
        high: round(Math.max(open, close) * (1 + random() * 0.0008)),
        low: round(Math.min(open, close) * (1 - random() * 0.0008)),
        volume: Math.round((20_000 + random() * 90_000) * activity), source: 'demo' as const };
    });
    return { candles, source: 'demo' as const, isDemo: true, currency: quote.currency, pricePrecision: quote.pricePrecision, assetClass: quote.assetClass };
  }

  // Every compact graph uses the same five-minute session as the detail screen.
  for (const quote of quotes) {
    const candles = history(quote.symbol, '5m').candles;
    quote.sparkline = candles.map(candle => candle.close);
    quote.high = Math.max(...candles.map(candle => candle.high));
    quote.low = Math.min(...candles.map(candle => candle.low));
    quote.volume = candles.reduce((sum, candle) => sum + candle.volume, 0);
  }

  const holdings: [string, number, number][] = [['BTCUSDT', 0.4, 64200], ['ETHUSDT', 6, 2380], ['SOLUSDT', 60, 138], ['EUR/USD', 10000, 1.0842], ['XRPUSDT', 8000, 0.48]];
  const positions = holdings.map(([symbol, quantity, avgPrice]) => {
    const quote = quoteFor(symbol);
    return { id: `holding-${symbol}`, symbol, name: quote.name, exchange: quote.exchange, quantity, avgPrice,
      ltp: quote.ltp, marketValue: round(quantity * quote.ltp), unrealizedPnl: round(quantity * (quote.ltp - avgPrice)),
      unrealizedPnlPercent: round((quote.ltp - avgPrice) / avgPrice * 100) };
  });
  const invested = round(positions.reduce((sum, position) => sum + position.quantity * position.avgPrice, 0));
  const startingBalance = 100_000;
  const realizedPnl = 1_250;
  const cashBalance = round(startingBalance - invested + realizedPnl);
  const unrealizedPnl = round(positions.reduce((sum, position) => sum + position.unrealizedPnl, 0));
  const totalPnl = round(realizedPnl + unrealizedPnl);
  const portfolio = { positions, invested, cashBalance, startingBalance, realizedPnl, unrealizedPnl, totalPnl,
    equity: round(startingBalance + totalPnl), totalPnlPercent: round(totalPnl / startingBalance * 100), isDemo: true };
  const transactions = holdings.map(([symbol, quantity, price], i) => ({ id: `transaction-${i}`, type: 'BUY', symbol, quantity, price,
    amount: round(quantity * price), realizedPnl: null, createdAt: ago(3 + i * 25) }));

  const watchlists = [{ id: 'preview-watchlist', name: 'My Watchlist', isDefault: true }];
  const items = quotes.filter(q => ['FOREX','BINANCE'].includes(q.exchange))
    .map(q => ({ id: `watch-${q.symbol}`, watchlistId: watchlists[0].id, symbol: q.symbol, name: q.name, exchange: q.exchange, quote: q }));
  const authors = [
    { id: 'preview-meera', username: 'meera.markets', displayName: 'Meera Iyer', avatarUrl: null },
    { id: 'preview-desk', username: 'marketdesk', displayName: 'Gurukul Market Desk', avatarUrl: null },
    { id: 'preview-rohan', username: 'rohan.learns', displayName: 'Rohan Kapoor', avatarUrl: null },
    user,
  ];
  const postContent = [
    ['EUR/USD', 'My watchlist for the week: focus on the trend, then the entry. In this sample setup, EUR/USD is holding above its previous range. I’m waiting for a retest before adding to my paper position. What is on your watchlist?'],
    ['BTCUSDT', 'A simple trading journal can change how you learn. Record your entry reason, planned risk, and what actually happened. Review the process each week, not just the profit.'],
    ['SOLUSDT', 'Comparing large-cap crypto pairs in my practice portfolio today. Relative strength, volume, and position size matter more to me than trying to predict the next candle.'],
    ['ETHUSDT', 'Added Ethereum to my watchlist and kept some cash aside. My goal this month is to follow the plan consistently and write down one lesson after every trade.'],
    ['GBP/USD', 'Learning note: diversification is about different sources of risk. Five altcoins can still behave like one large position, and several USD pairs share the same dollar exposure. A useful exercise is to group your holdings by the currency they depend on.'],
    ['AUD/USD', 'Finished my weekly portfolio review. Trimmed the distractions, checked my allocation, and updated my trading journal. Small steps make the process easier to repeat.'],
  ];
  const posts = postContent.map(([symbol, content], i) => ({ id: `preview-post-${i}`, content, symbol, exchange: symbol.includes('/') ? 'FOREX' : 'BINANCE',
    likeCount: [42, 86, 24, 18, 57, 12][i], commentCount: 2, createdAt: ago(1 + i * 3), liked: false, bookmarked: i === 1,
    imageUrl: undefined as string | undefined, isEditorsPick: i === 1 || i === 4, author: authors[i % authors.length] }));
  type Comment = { id: string; content: string; parentId: string | null; createdAt: string; author: typeof authors[number] };
  const comments: Record<string, Comment[]> = Object.fromEntries(posts.map(post => [post.id, [
    { id: `${post.id}-c1`, content: 'The focus on process really helps. Adding this to my practice journal.', parentId: null, createdAt: ago(0.5), author: authors[2] },
    { id: `${post.id}-c2`, content: 'I’m tracking position size and sector exposure in my paper portfolio too.', parentId: null, createdAt: ago(0.25), author: authors[0] },
  ]]));
  const following = new Set([authors[0].id, authors[1].id]);
  const enrichPost = (post: typeof posts[number]) => ({ ...post, following: following.has(post.author.id) });
  const sampleAnswer = (kind: AiKind, symbol = 'BTCUSDT') => kind === 'portfolio'
    ? 'Demo portfolio review\n\nYour sample portfolio holds four crypto pairs and one forex position alongside a USD cash reserve. Bitcoin and Ethereum are the largest positions, so most of the risk moves with the broader crypto market.\n\nFor your next review:\n• Compare your allocation with your learning goals.\n• Set a position-size limit before each paper trade.\n• Keep a journal of why you entered and what would change your view.\n\nThis is a prepared sample response for the UI preview, not a live portfolio recommendation.'
    : kind === 'analysis'
      ? `Sample ${symbol} analysis\n\nThe demo chart shows a gradual recovery with several pullbacks. Use the marked high and low to practice identifying a range, then compare price action with volume.\n\nA useful learning exercise: write down both a continuation scenario and a reversal scenario before placing a paper trade.\n\nThese prices and this response are fictional preview data, not current market analysis.`
      : 'Here is a simple framework to explore in your paper-trading journal.\n\n1. Start with the broader market trend.\n2. Define the amount you are willing to risk before entering.\n3. Compare the setup with your plan instead of chasing a price move.\n4. Review both good and bad outcomes to improve the process.\n\nFor example, a sample $100,000 portfolio risking 1% on a practice trade has a $1,000 risk budget. Position size also depends on the distance to the planned stop.\n\nThis is a prepared demo answer so you can preview the chat interface. It is not a live AI response.';
  const conversations: Conversation[] = [
    { id: 'preview-chat-1', title: 'A framework for market risk', kind: 'chat', updatedAt: ago(1), messages: [
      { id: 'chat-1-user', role: 'user', content: 'How can I build a consistent risk-management routine?' },
      { id: 'chat-1-assistant', role: 'assistant', content: sampleAnswer('chat') },
    ] },
    { id: 'preview-chat-2', title: 'Review my paper portfolio', kind: 'portfolio', updatedAt: ago(4), messages: [
      { id: 'chat-2-user', role: 'user', content: 'Help me understand my portfolio allocation.' },
      { id: 'chat-2-assistant', role: 'assistant', content: sampleAnswer('portfolio') },
    ] },
    { id: 'preview-chat-3', title: 'Understanding the Bitcoin chart', kind: 'analysis', updatedAt: ago(24), messages: [
      { id: 'chat-3-user', role: 'user', content: 'Walk me through a sample Bitcoin chart.' },
      { id: 'chat-3-assistant', role: 'assistant', content: sampleAnswer('analysis') },
    ] },
  ];

  async function request(path: string, options: RequestOptions = {}): Promise<unknown> {
    options.signal?.throwIfAborted();
    const url = new URL(path, 'https://demo.invalid');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const method = options.method ?? 'GET';
    const body = (options.body ?? {}) as Record<string, unknown>;
    const text = (key: string) => String(body[key] ?? '');
    const result = (() => {
      if (url.pathname === '/api/auth/logout') return { ok: true };
      if (['/api/auth/login', '/api/auth/register', '/api/auth/refresh'].includes(url.pathname)) return session();
      if (url.pathname === '/api/auth/me') return { user };
      if (url.pathname === '/api/users/me/password') throw new Error('Passwords cannot be changed in demo preview. Switch to live mode to manage your account.');
      if (url.pathname === '/api/users/me' && method === 'PATCH') {
        for (const key of ['displayName', 'bio'] as const) if (typeof body[key] === 'string') user[key] = body[key] as string;
        for (const key of ['notifyPush', 'notifyEmail', 'privacyPublicProfile'] as const) if (typeof body[key] === 'boolean') user[key] = body[key] as boolean;
        return { user };
      }
      if (url.pathname === '/api/users/me/overview') return { user, portfolio,
        community: { posts: posts.filter(p => p.author.id === user.id).length, followers: 248, following: following.size }, isDemo: true };
      if (url.pathname === '/api/trading/portfolio') return portfolio;
      if (url.pathname === '/api/trading/transactions') return { transactions };
      if (url.pathname === '/api/trading/orders') {
        if (method !== 'GET') throw new Error('Orders are disabled in demo preview. Switch to live mode to place paper trades.');
        return { orders: [] };
      }
      if (parts[1] === 'market') {
        if (parts[2] === 'quote') return { quote: quoteFor(parts[3]), isDemo: true };
        if (parts[2] === 'candles') return history(parts[3], url.searchParams.get('timeframe') ?? '5m');
        if (parts[2] === 'search') {
          const query = (url.searchParams.get('q') ?? '').toLowerCase();
          return { results: quotes.filter(q => `${q.symbol} ${q.name}`.toLowerCase().replace(/[\s/_-]/g,'').includes(query.replace(/[\s/_-]/g,''))) };
        }
        const crypto = quotes.filter(q => q.exchange === 'BINANCE');
        const forex = quotes.filter(q => q.exchange === 'FOREX');
        const availability = {crypto: 'Demo · fictional prices', forex: 'Demo · fictional prices'};
        const constituents = [...crypto, ...forex];
        if (parts[2] === 'explore') return { crypto, forex, availability, constituents,
          gainers: constituents.filter(q => q.change > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 5),
          losers: constituents.filter(q => q.change < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 5),
          active: [...constituents].sort((a, b) => b.volume - a.volume).slice(0, 5), isDemo: true, statusLabel: 'Demo market snapshot' };
        if (parts[2] === 'overview') return { crypto, forex, availability, statusLabel: 'Demo market snapshot', sentiment: 'Bullish', volatilityLabel: 'Low', isDemo: true,
          news: [
            { id: 'news-1', title: 'Sample market wrap: forex and crypto in the practice watchlist', source: 'Demo Market Desk' },
            { id: 'news-2', title: 'Learning corner: understanding quote currencies and price precision', source: 'Gurukul Learning' },
            { id: 'news-3', title: 'Five questions to ask before your next paper trade', source: 'Demo Market Desk' },
          ], events: [{ id: 'event-1', title: 'Practice session: reading currency pair charts', date: 'Sample event · Monday, 6 PM' },
            { id: 'event-2', title: 'Community portfolio review', date: 'Sample event · Friday, 5 PM' }] };
      }
      if (parts[1] === 'watchlists') {
        if (parts.length === 2) {
          if (method === 'POST') { const list = { id: id('watchlist'), name: text('name'), isDefault: false }; watchlists.push(list); return { watchlist: list }; }
          return { watchlists };
        }
        if (parts[3] === 'items') {
          if (method === 'DELETE') { const index = items.findIndex(i => i.id === parts[4] && i.watchlistId === parts[2]); if (index >= 0) items.splice(index, 1); return { ok: true }; }
          if (method === 'POST') {
            const quote = quoteFor(text('symbol'));
            if (!items.some(i => i.symbol === quote.symbol && i.watchlistId === parts[2])) items.push({ id: id('watch'), watchlistId: parts[2], symbol: quote.symbol, name: quote.name, exchange: quote.exchange, quote });
          }
          return { items: items.filter(i => i.watchlistId === parts[2]), isDemo: true };
        }
      }
      if (parts[1] === 'community') {
        if (parts[2] === 'feed') {
          const tab = url.searchParams.get('tab');
          const offset = Number(url.searchParams.get('offset') ?? 0);
          const limit = Number(url.searchParams.get('limit') ?? 20);
          if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid pagination');
          const filtered = posts.filter(p => tab === 'editors' ? p.isEditorsPick : tab === 'following' ? following.has(p.author.id) : tab === 'saved' ? p.bookmarked : true);
          const page = filtered.slice(offset, offset + limit);
          return { posts: page.map(enrichPost), nextOffset: offset + page.length, hasMore: offset + page.length < filtered.length };
        }
        if (parts[2] === 'users' && parts[4] === 'follow' && method === 'POST') {
          if (parts[3] === user.id || !authors.some(a => a.id === parts[3])) throw new Error('Cannot follow this user');
          if (following.has(parts[3])) following.delete(parts[3]); else following.add(parts[3]);
          return { following: following.has(parts[3]) };
        }
        if (parts[2] === 'posts') {
          if (parts.length === 3 && method === 'POST') {
            const content = text('content').trim();
            if (!content || content.length > 5000) throw new Error('Post must contain 1–5000 characters');
            const tagged = text('symbol') ? quoteFor(text('symbol').replace(/^([A-Z]{3})([A-Z]{3})$/i, '$1/$2')) : undefined;
            const post = { id: id('post'), content, imageUrl: text('imageUrl') || undefined, symbol: tagged?.symbol ?? '', exchange: tagged?.exchange ?? '', likeCount: 0,
              commentCount: 0, createdAt: new Date().toISOString(), liked: false, bookmarked: false, isEditorsPick: false, author: user };
            posts.unshift(post); comments[post.id] = []; return { post: enrichPost(post) };
          }
          const post = posts.find(p => p.id === parts[3]);
          if (!post) throw new Error('Demo post not found.');
          if (method === 'POST') {
            if (parts[4] === 'like') { post.liked = !post.liked; post.likeCount += post.liked ? 1 : -1; return { liked: post.liked }; }
            else if (parts[4] === 'bookmark') { post.bookmarked = !post.bookmarked; return { bookmarked: post.bookmarked }; }
            else if (parts[4] === 'comments') {
              const content = text('content').trim();
              const parentId = text('parentId') || null;
              if (!content || content.length > 2000) throw new Error('Comment must contain 1–2000 characters');
              if (parentId && !comments[post.id].some(c => c.id === parentId)) throw new Error('Reply must belong to this post');
              comments[post.id].push({ id: id('comment'), content, parentId, createdAt: new Date().toISOString(), author: user });
              post.commentCount = comments[post.id].length;
              return { comment: comments[post.id].at(-1) };
            } else if (parts[4] === 'report') {
              if (text('reason').trim().length < 3) throw new Error('Please enter a report reason');
              return { ok: true, message: 'Report submitted for moderation review' };
            } else if (parts[4] !== 'report') throw new Error('This action is not available in demo preview.');
          }
          return { post: enrichPost(post), comments: comments[post.id] };
        }
      }
      if (url.pathname === '/api/ai/suggestions') return { suggestions: ['How do I size a paper trade?', 'How do forex pips work?', 'Help me build a trading journal.'] };
      if (parts[1] === 'ai' && parts[2] === 'conversations') {
        if (!parts[3]) return { conversations: conversations.map(({ messages: _messages, ...conversation }) => conversation) };
        const conversation = conversations.find(c => c.id === parts[3]);
        if (!conversation) throw new Error('Demo conversation not found.');
        if (method === 'DELETE') { conversations.splice(conversations.indexOf(conversation), 1); return { ok: true }; }
        return { conversation, messages: conversation.messages };
      }
      throw new Error('This action is not available in demo preview.');
    })();
    return copy(result);
  }

  async function stream(body: ChatBody, onEvent: (event: AiEvent) => void, signal?: AbortSignal) {
    signal?.throwIfAborted();
    let conversation = body.conversationId ? conversations.find(c => c.id === body.conversationId) : undefined;
    if (body.conversationId && !conversation) throw new Error('Demo conversation not found.');
    if (!conversation) {
      conversation = { id: id('chat'), title: body.message.slice(0, 70), kind: body.kind ?? 'chat', updatedAt: new Date().toISOString(), messages: [] };
      conversations.unshift(conversation);
    }
    conversation.messages.push({ id: id('message'), role: 'user', content: body.message });
    conversation.updatedAt = new Date().toISOString();
    const assistant: Message = { id: id('message'), role: 'assistant', content: '' };
    conversation.messages.push(assistant);
    onEvent({ type: 'meta', conversationId: conversation.id });
    for (const content of sampleAnswer(conversation.kind, body.symbol).match(/.{1,28}|\n/g) ?? []) {
      signal?.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new Error('Demo response aborted.')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 20);
        signal?.addEventListener('abort', abort, { once: true });
      });
      signal?.throwIfAborted();
      assistant.content += content;
      onEvent({ type: 'token', content });
    }
    signal?.throwIfAborted();
    onEvent({ type: 'done' });
  }
  return { request, stream, session };
}

export const demoApi = createDemoApi();
