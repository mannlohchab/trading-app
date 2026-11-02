import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { config } from './lib/config';
import { errorHandler } from './middleware/error';
import { authRouter } from './modules/auth/routes';
import { marketRouter } from './modules/market/routes';
import { watchlistsRouter } from './modules/watchlists/routes';
import { tradingRouter } from './modules/trading/routes';
import { communityRouter } from './modules/community/routes';
import { aiRouter } from './modules/ai/routes';
import { usersRouter } from './modules/users/routes';
import { notificationsRouter } from './modules/notifications/routes';
import { getMarketDataProvider } from './providers/marketData';
import { attachMarketSocket } from './marketSocket';
import { processPendingOrders } from './modules/trading/engine';
import './db/migrate';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: config.clientOrigin === '*' ? true : config.clientOrigin },
});

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin: config.clientOrigin === '*' ? true : config.clientOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get('/health', (_req, res) => {
  const provider = getMarketDataProvider();
  res.json({
    ok: true,
    service: 'trading-server',
    marketProvider: provider.name,
    isDemo: provider.isDemo,
  });
});

app.use('/api/auth', authRouter);
app.use('/api/market', marketRouter);
app.use('/api/watchlists', watchlistsRouter);
app.use('/api/trading', tradingRouter);
app.use('/api/community', communityRouter);
app.use('/api/ai', aiRouter);
app.use('/api/users', usersRouter);
app.use('/api/notifications', notificationsRouter);

app.use(errorHandler);

const stopMarketSocket = attachMarketSocket(io, getMarketDataProvider());
const shutdown = () => { clearInterval(pendingOrdersTimer); stopMarketSocket(); io.close(); httpServer.close(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const pendingOrdersTimer = setInterval(() => {
  processPendingOrders().catch(console.warn);
}, 10_000);

httpServer.listen(config.port, () => {
  console.log(`Trading server listening on http://localhost:${config.port}`);
  getMarketDataProvider();
});
