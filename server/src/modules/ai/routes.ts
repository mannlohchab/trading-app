import { Router } from 'express';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db';
import { aiConversations, aiMessages } from '../../db/schema';
import { AppError, assertFound } from '../../lib/errors';
import { id } from '../../lib/ids';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { getMarketDataProvider } from '../../providers/marketData';
import { buildSystemPrompt, streamWorkersAi, type ChatMessage } from '../../providers/workersAi';
import { portfolioSummary } from '../trading/engine';
import rateLimit from 'express-rate-limit';
import { param } from '../../lib/params';
import { hasCloudflareAi } from '../../lib/config';

export const aiRouter = Router();
aiRouter.use(requireAuth);

const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests. Please wait a moment.' },
});

aiRouter.use(aiLimiter);

aiRouter.get('/conversations', async (req, res, next) => {
  try {
    const rows = await db.query.aiConversations.findMany({
      where: eq(aiConversations.userId, req.user!.userId),
      orderBy: [desc(aiConversations.updatedAt)],
      limit: 50,
    });
    res.json({ conversations: rows });
  } catch (err) {
    next(err);
  }
});

aiRouter.get('/conversations/:id', async (req, res, next) => {
  try {
    const conv = assertFound(
      await db.query.aiConversations.findFirst({
        where: eq(aiConversations.id, param(req, 'id')),
      }),
    );
    if (conv.userId !== req.user!.userId) throw new AppError(403, 'Forbidden');
    const messages = await db.query.aiMessages.findMany({
      where: eq(aiMessages.conversationId, conv.id),
      orderBy: [asc(sql`rowid`)],
    });
    res.json({ conversation: conv, messages });
  } catch (err) {
    next(err);
  }
});

aiRouter.post(
  '/chat',
  validateBody(
    z.object({
      conversationId: z.string().optional(),
      message: z.string().min(1).max(4000),
      kind: z.enum(['chat', 'analysis', 'portfolio']).default('chat'),
      symbol: z.string().optional(),
      exchange: z.string().optional(),
    }),
  ),
  async (req, res, next) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.once('close', abort);
    try {
      if (!hasCloudflareAi()) {
        throw new AppError(503, 'AI Insight is not configured. Add CF_ACCOUNT_ID and CF_API_TOKEN to the backend server/.env and restart the server.', 'AI_NOT_CONFIGURED');
      }
      const body = req.body as {
        conversationId?: string;
        message: string;
        kind: 'chat' | 'analysis' | 'portfolio';
        symbol?: string;
        exchange?: string;
      };

      let conversationId = body.conversationId;
      if (conversationId) {
        const existing = assertFound(
          await db.query.aiConversations.findFirst({ where: eq(aiConversations.id, conversationId) }),
        );
        if (existing.userId !== req.user!.userId) throw new AppError(403, 'Forbidden');
      } else {
        conversationId = id();
        await db.insert(aiConversations).values({
          id: conversationId,
          userId: req.user!.userId,
          title: body.message.slice(0, 60),
          kind: body.kind,
        });
      }

      await db.insert(aiMessages).values({
        id: id(),
        conversationId,
        role: 'user',
        content: body.message,
      });

      let context = '';
      if (body.kind === 'analysis' || body.symbol) {
        const symbol = (body.symbol ?? 'BTCUSDT').toUpperCase();
        const exchange = body.exchange;
        const quote = await getMarketDataProvider().quote(symbol, exchange);
        const candles = await getMarketDataProvider().candles(symbol, '1d', exchange);
        const last = candles.slice(-5);
        context += `Observed quote for ${quote.name} (${quote.symbol}): LTP ${quote.ltp} ${quote.currency ?? 'INR'}, change ${quote.changePercent}%, high ${quote.high}, low ${quote.low}, volume ${quote.volume}.\n`;
        context += `Recent daily closes: ${last.map((c) => c.close).join(', ')}.\n`;
        context += `Data source: ${quote.source ?? 'unknown'}, observed at ${quote.asOf ?? 'unknown'} Unix seconds; stale: ${quote.stale ?? false}.\n`;
      }
      if (body.kind === 'portfolio') {
        const portfolio = await portfolioSummary(req.user!.userId);
        context += `Paper portfolio equity ₹${portfolio.equity.toFixed(2)}, cash ₹${portfolio.cashBalance.toFixed(2)}, unrealized P&L ₹${portfolio.unrealizedPnl.toFixed(2)}, realized P&L ₹${portfolio.realizedPnl.toFixed(2)}.\n`;
        context += `Positions: ${portfolio.positions.map((p) => `${p.symbol} x${p.quantity} @${p.avgPrice} LTP ${p.ltp} uPnL ${p.unrealizedPnl.toFixed(2)}`).join('; ') || 'none'}.\n`;
      }

      const history = await db.query.aiMessages.findMany({
        where: eq(aiMessages.conversationId, conversationId),
        // SQLite insertion order also resolves messages created within the same second.
        orderBy: [desc(sql`rowid`)],
        limit: 12,
      });

      const messages: ChatMessage[] = [
        { role: 'system', content: buildSystemPrompt(context) },
        ...history.reverse().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      res.write(`data: ${JSON.stringify({ type: 'meta', conversationId })}\n\n`);

      const full = await streamWorkersAi(messages, (chunk) => {
        res.write(`data: ${JSON.stringify({ type: 'token', content: chunk })}\n\n`);
      }, controller.signal);
      controller.signal.throwIfAborted();

      await db.insert(aiMessages).values({
        id: id(),
        conversationId,
        role: 'assistant',
        content: full,
      });
      await db
        .update(aiConversations)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(aiConversations.id, conversationId));

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (err) {
      if (controller.signal.aborted) return;
      if (res.headersSent) {
        if (!res.destroyed && !res.writableEnded) {
          const message = err instanceof AppError ? err.message : 'The AI response was interrupted. Please try again.';
          res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
          res.end();
        }
      } else {
        next(err);
      }
    } finally {
      res.off('close', abort);
    }
  },
);

aiRouter.get('/suggestions', async (_req, res) => {
  res.json({
    suggestions: [
      'Explain how Bitcoin 50 options weekly expiry works',
      'What is a good risk management framework for Indian equities?',
      'Compare RSI vs MACD for studying forex and crypto',
      'How should I interpret India VIX?',
      'Analyze my paper portfolio diversification',
    ],
  });
});
