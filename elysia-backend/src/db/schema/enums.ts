import { pgEnum } from 'drizzle-orm/pg-core';

// Identity & verification
export const userStatus = pgEnum('user_status', ['PENDING_PHONE_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DELETED']);
// Values are Better Auth provider ids.
export const authProvider = pgEnum('auth_provider', ['credential', 'google', 'apple']);
export const phoneVerificationPurpose = pgEnum('phone_verification_purpose', [
  'REGISTRATION',
  'LOGIN',
  'PHONE_CHANGE',
  'ACCOUNT_RECOVERY',
]);

// Profiles
export const consentType = pgEnum('consent_type', [
  'TERMS_OF_SERVICE',
  'PRIVACY_POLICY',
  'MARKETING_COMMUNICATIONS',
  'AI_DATA_PROCESSING',
]);

// AI
export const conversationStatus = pgEnum('conversation_status', ['ACTIVE', 'ARCHIVED', 'DELETED']);
export const messageRole = pgEnum('message_role', ['USER', 'ASSISTANT', 'SYSTEM']);

// Market
export const exchangeType = pgEnum('exchange_type', ['CRYPTO', 'FOREX', 'STOCKS', 'OTHER']);
export const assetType = pgEnum('asset_type', ['SPOT', 'PERPETUAL', 'FUTURES', 'FOREX', 'OTHER']);

// Strategies & backtesting
export const strategySource = pgEnum('strategy_source', ['AI_GENERATED', 'USER_CREATED']);
export const strategyVisibility = pgEnum('strategy_visibility', ['PRIVATE', 'PUBLIC']);
export const strategyStatus = pgEnum('strategy_status', ['ACTIVE', 'ARCHIVED', 'DELETED']);
export const backtestStatus = pgEnum('backtest_status', ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']);

// Trading
export const tradeSide = pgEnum('trade_side', ['BUY', 'SELL', 'LONG', 'SHORT']);
export const paperOrderType = pgEnum('paper_order_type', ['MARKET', 'LIMIT', 'STOP_MARKET', 'STOP_LIMIT']);
export const paperOrderStatus = pgEnum('paper_order_status', [
  'PENDING',
  'OPEN',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
]);
export const paperPositionSide = pgEnum('paper_position_side', ['LONG', 'SHORT']);
export const paperTransactionType = pgEnum('paper_transaction_type', [
  'INITIAL_DEPOSIT',
  'ORDER_FILL',
  'TRADING_FEE',
  'FUNDING_FEE',
  'REALIZED_PNL',
  'ADJUSTMENT',
  // Reservations: change the reserved balance, never cash.
  'ORDER_RESERVE',
  'ORDER_RELEASE',
  'POSITION_MARGIN',
  'POSITION_MARGIN_RELEASE',
]);

// System
export const backgroundJobStatus = pgEnum('background_job_status', [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
