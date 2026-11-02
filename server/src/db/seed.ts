import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from './index';
import { posts, users, watchlistItems, watchlists } from './schema';
import { globalInstruments } from '../providers/instruments';
import { id } from '../lib/ids';
import './migrate';

async function seed() {
  const existing = await db.query.users.findFirst({ where: eq(users.username, 'demo') });
  if (existing) {
    console.log('Seed skipped — demo user already exists');
    return;
  }

  // Ensure schema via migrate import side effect
  const { config } = await import('../lib/config');
  const userId = id();
  await db.insert(users).values({
    id: userId,
    email: 'demo@trading.app',
    username: 'demo',
    passwordHash: await bcrypt.hash('password123', 12),
    displayName: 'Demo Trader',
    bio: 'Exploring forex and crypto markets.',
  });

  const { paperAccounts } = await import('./schema');
  await db.insert(paperAccounts).values({
    id: id(),
    userId,
    cashBalance: config.defaultPaperBalance,
    startingBalance: config.defaultPaperBalance,
  });

  const wlId = id();
  await db.insert(watchlists).values({ id: wlId, userId, name: 'My Watchlist', isDefault: true });
  for (const {symbol, exchange, name} of globalInstruments) {
    await db.insert(watchlistItems).values({ id: id(), watchlistId: wlId, symbol, exchange, name });
  }

  const educatorId = id();
  await db.insert(users).values({
    id: educatorId,
    email: 'editor@trading.app',
    username: 'marketdesk',
    passwordHash: await bcrypt.hash('password123', 12),
    displayName: 'Market Desk',
    bio: 'Curated forex and crypto education.',
  });
  await db.insert(paperAccounts).values({
    id: id(),
    userId: educatorId,
    cashBalance: config.defaultPaperBalance,
    startingBalance: config.defaultPaperBalance,
  });

  await db.insert(posts).values([
    {
      id: id(),
      userId: educatorId,
      content:
        'Compare Bitcoin trends across multiple timeframes and check the price observation time. This is an educational exercise.',
      symbol: 'BTCUSDT',
      exchange: 'BINANCE',
      isEditorsPick: true,
      likeCount: 42,
      commentCount: 3,
    },
    {
      id: id(),
      userId: educatorId,
      content:
        'Risk tip: size positions so a 1–2% account risk stop is respected. Paper trade the plan before using real capital.',
      isEditorsPick: true,
      likeCount: 28,
      commentCount: 1,
    },
    {
      id: id(),
      userId,
      content: 'Added BTCUSDT and ETHUSDT to my watchlist. Comparing their price trends this week.',
      symbol: 'ETHUSDT',
      exchange: 'BINANCE',
      likeCount: 5,
      commentCount: 0,
    },
  ]);

  console.log('Seeded demo users: demo / password123 and marketdesk / password123');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
