import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  theme: text('theme').notNull().default('dark'),
  notifyPush: integer('notify_push', { mode: 'boolean' }).notNull().default(true),
  notifyEmail: integer('notify_email', { mode: 'boolean' }).notNull().default(false),
  privacyPublicProfile: integer('privacy_public_profile', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const refreshTokens = sqliteTable('refresh_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('refresh_tokens_user_idx').on(t.userId)]);

export const watchlists = sqliteTable('watchlists', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('watchlists_user_idx').on(t.userId)]);

export const watchlistItems = sqliteTable('watchlist_items', {
  id: text('id').primaryKey(),
  watchlistId: text('watchlist_id').notNull().references(() => watchlists.id, { onDelete: 'cascade' }),
  symbol: text('symbol').notNull(),
  exchange: text('exchange').notNull(),
  name: text('name').notNull(),
  token: text('token'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  uniqueIndex('watchlist_symbol_uidx').on(t.watchlistId, t.symbol, t.exchange),
  index('watchlist_items_wl_idx').on(t.watchlistId),
]);

export const paperAccounts = sqliteTable('paper_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  cashBalance: real('cash_balance').notNull(),
  startingBalance: real('starting_balance').notNull(),
  realizedPnl: real('realized_pnl').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => paperAccounts.id, { onDelete: 'cascade' }),
  symbol: text('symbol').notNull(),
  exchange: text('exchange').notNull(),
  name: text('name').notNull(),
  side: text('side').notNull(), // BUY | SELL
  orderType: text('order_type').notNull(), // MARKET | LIMIT
  quantity: real('quantity').notNull(),
  limitPrice: real('limit_price'),
  stopLoss: real('stop_loss'),
  takeProfit: real('take_profit'),
  status: text('status').notNull().default('PENDING'), // PENDING | FILLED | CANCELLED | REJECTED | PARTIAL
  filledQty: real('filled_qty').notNull().default(0),
  avgFillPrice: real('avg_fill_price'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('orders_user_idx').on(t.userId),
  index('orders_status_idx').on(t.status),
]);

export const positions = sqliteTable('positions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => paperAccounts.id, { onDelete: 'cascade' }),
  symbol: text('symbol').notNull(),
  exchange: text('exchange').notNull(),
  name: text('name').notNull(),
  quantity: real('quantity').notNull(),
  avgPrice: real('avg_price').notNull(),
  stopLoss: real('stop_loss'),
  takeProfit: real('take_profit'),
  openedAt: text('opened_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  uniqueIndex('positions_user_symbol_uidx').on(t.userId, t.symbol, t.exchange),
  index('positions_user_idx').on(t.userId),
]);

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => paperAccounts.id, { onDelete: 'cascade' }),
  orderId: text('order_id').references(() => orders.id),
  type: text('type').notNull(), // BUY | SELL | ADJUST
  symbol: text('symbol'),
  exchange: text('exchange'),
  quantity: real('quantity'),
  price: real('price'),
  amount: real('amount').notNull(),
  realizedPnl: real('realized_pnl').default(0),
  note: text('note'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('transactions_user_idx').on(t.userId)]);

export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  imageUrl: text('image_url'),
  symbol: text('symbol'),
  exchange: text('exchange'),
  isEditorsPick: integer('is_editors_pick', { mode: 'boolean' }).notNull().default(false),
  likeCount: integer('like_count').notNull().default(0),
  commentCount: integer('comment_count').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('posts_user_idx').on(t.userId),
  index('posts_created_idx').on(t.createdAt),
  index('posts_editors_idx').on(t.isEditorsPick),
]);

export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('comments_post_idx').on(t.postId),
  index('comments_parent_idx').on(t.parentId),
]);

export const reactions = sqliteTable('reactions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  type: text('type').notNull().default('like'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [uniqueIndex('reactions_user_post_uidx').on(t.userId, t.postId)]);

export const follows = sqliteTable('follows', {
  id: text('id').primaryKey(),
  followerId: text('follower_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  followingId: text('following_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [uniqueIndex('follows_uidx').on(t.followerId, t.followingId)]);

export const bookmarks = sqliteTable('bookmarks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [uniqueIndex('bookmarks_uidx').on(t.userId, t.postId)]);

export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  reporterId: text('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  postId: text('post_id').references(() => posts.id, { onDelete: 'cascade' }),
  commentId: text('comment_id').references(() => comments.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('OPEN'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const aiConversations = sqliteTable('ai_conversations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('New chat'),
  kind: text('kind').notNull().default('chat'), // chat | analysis | portfolio
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('ai_conv_user_idx').on(t.userId)]);

export const aiMessages = sqliteTable('ai_messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => aiConversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // user | assistant | system
  content: text('content').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('ai_msg_conv_idx').on(t.conversationId)]);

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  data: text('data'),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('notifications_user_idx').on(t.userId)]);
