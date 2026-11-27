// Terminal state: the selected pair and timeframe, its live ticker (WebSocket, REST seed and
// fallback), the market list, and the user's paper account, orders and fills from elysia-backend.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError, humanizeApiError } from "./api/client";
import {
  DEFAULT_SYMBOL,
  EXCHANGE,
  emptyTicker,
  fetchInstrument,
  fetchMarkets,
  fetchTicker,
  type BackendInstrument,
  type ListedMarket,
} from "./api/market";
import {
  cancelOrder as cancelOrderRemote,
  closePosition as closePositionRemote,
  fetchAccount,
  fetchOrders,
  fillsFromOrders,
  placeOrder as placeOrderRemote,
} from "./api/paper";
import { subscribeQuotes } from "./api/socket";
import { useAuth } from "./auth";
import { stepDecimals } from "./pricePrecision";
import type { Account, Fill, Interval, Order, PlaceOrderInput, Position, Side, Ticker } from "./types";

type ActionResult = { ok: true; order?: Order } | { ok: false; error: string; code?: string };

interface TradingState {
  symbol: string;
  setSymbol: (symbol: string) => void;
  markets: ListedMarket[];
  interval: Interval;
  setInterval: (interval: Interval) => void;
  ticker: Ticker;
  /** True while the live stream is delivering quotes for this pair. */
  live: boolean;
  instrument: BackendInstrument | null;
  /** Decimals prices of this pair are shown with (from its tick size). */
  pricePrecision: number;
  /** Decimals a quantity of this pair may have (from its lot step). */
  quantityPrecision: number;
  account: Account | null;
  accountError: string | null;
  orders: Order[];
  fills: Fill[];
  positions: Position[];
  /** Open limit and market orders. */
  openOrders: Order[];
  /** Open stop orders. */
  stopOrders: Order[];
  orderHistory: Order[];
  orderSideFocus: Side;
  setOrderSideFocus: (side: Side) => void;
  placeOrder: (input: PlaceOrderInput) => Promise<ActionResult>;
  cancelOrder: (id: string) => Promise<ActionResult>;
  closePosition: (id: string) => Promise<ActionResult>;
}

const TradingContext = createContext<TradingState | null>(null);

const ACCOUNT_POLL_MS = 3000;
const MARKETS_POLL_MS = 30_000;
/** Without a streamed quote for this long, fall back to REST. */
const STALE_QUOTE_MS = 10_000;
const INTERVALS: Interval[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];

const stored = (key: string) => (typeof window === "undefined" ? null : window.localStorage.getItem(key));

function failure(err: unknown): ActionResult {
  return { ok: false, error: humanizeApiError(err), code: err instanceof ApiError ? err.code : undefined };
}

export function TradingStoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [symbol, setSymbolState] = useState(() => stored("terminal.symbol") || DEFAULT_SYMBOL);
  const [interval, setIntervalState] = useState<Interval>(() => {
    const saved = stored("terminal.interval") as Interval | null;
    return saved && INTERVALS.includes(saved) ? saved : "1h";
  });
  const [markets, setMarkets] = useState<ListedMarket[]>([]);
  const [ticker, setTicker] = useState<Ticker>(() => emptyTicker(symbol));
  const [live, setLive] = useState(false);
  const [instrument, setInstrument] = useState<BackendInstrument | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderSideFocus, setOrderSideFocus] = useState<Side>("buy");

  const setSymbol = useCallback((next: string) => {
    setSymbolState(next);
    window.localStorage.setItem("terminal.symbol", next);
  }, []);
  const setInterval = useCallback((next: Interval) => {
    setIntervalState(next);
    window.localStorage.setItem("terminal.interval", next);
  }, []);

  // Market list for the picker.
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      fetchMarkets(60, controller.signal)
        .then(setMarkets)
        .catch((e) => {
          if (!controller.signal.aborted) console.warn("markets list failed", e);
        });
    void load();
    const id = window.setInterval(load, MARKETS_POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, []);

  // Ticker: REST seed, then the WebSocket; REST again whenever the stream goes quiet.
  useEffect(() => {
    const controller = new AbortController();
    let lastStreamed = 0;
    setTicker(emptyTicker(symbol));
    setLive(false);

    const seed = () =>
      fetchTicker(symbol, controller.signal)
        .then((t) => {
          if (t && !controller.signal.aborted) setTicker(t);
        })
        .catch((e) => {
          if (!controller.signal.aborted) console.warn("ticker fetch failed", e);
        });
    void seed();

    const unsubscribe = subscribeQuotes([`${EXCHANGE}:${symbol}`], (quote) => {
      if (quote.symbol !== symbol) return;
      lastStreamed = Date.now();
      setLive(true);
      setTicker(quote.ticker);
    });
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastStreamed < STALE_QUOTE_MS) return;
      setLive(false);
      void seed();
    }, STALE_QUOTE_MS);

    return () => {
      controller.abort();
      unsubscribe();
      window.clearInterval(watchdog);
    };
  }, [symbol]);

  // Trading rules for the order form.
  useEffect(() => {
    const controller = new AbortController();
    setInstrument(null);
    fetchInstrument(symbol, controller.signal)
      .then((i) => {
        if (!controller.signal.aborted) setInstrument(i);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [symbol]);

  // Paper account and orders. There is no push channel for these, so poll while the tab is visible.
  const refreshSeq = useRef(0);
  const refreshTrading = useCallback(async () => {
    if (!userId) return;
    const seq = ++refreshSeq.current;
    try {
      const [nextAccount, nextOrders] = await Promise.all([fetchAccount(userId), fetchOrders(userId)]);
      if (seq !== refreshSeq.current) return; // A newer refresh started meanwhile.
      setAccount(nextAccount);
      setOrders(nextOrders);
      setAccountError(null);
    } catch (err) {
      if (seq === refreshSeq.current) setAccountError(humanizeApiError(err));
    }
  }, [userId]);

  useEffect(() => {
    setAccount(null);
    setOrders([]);
    if (!userId) return;
    void refreshTrading();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshTrading();
    }, ACCOUNT_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshTrading();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshTrading, userId]);

  const placeOrder = useCallback(
    async (input: PlaceOrderInput): Promise<ActionResult> => {
      if (!userId) return { ok: false, error: "Please log in." };
      try {
        const order = await placeOrderRemote(userId, symbol, input);
        setOrders((os) => [order, ...os.filter((o) => o.id !== order.id)]);
        void refreshTrading();
        if (order.status === "rejected") {
          return { ok: false, error: order.rejectReason || "The order was rejected." };
        }
        return { ok: true, order };
      } catch (err) {
        return failure(err);
      }
    },
    [refreshTrading, symbol, userId],
  );

  const cancelOrder = useCallback(
    async (id: string): Promise<ActionResult> => {
      try {
        await cancelOrderRemote(id);
        void refreshTrading();
        return { ok: true };
      } catch (err) {
        void refreshTrading();
        return failure(err);
      }
    },
    [refreshTrading],
  );

  const closePosition = useCallback(
    async (id: string): Promise<ActionResult> => {
      try {
        await closePositionRemote(id);
        void refreshTrading();
        return { ok: true };
      } catch (err) {
        void refreshTrading();
        return failure(err);
      }
    },
    [refreshTrading],
  );

  const current = instrument?.symbol === symbol ? instrument : null;
  const pricePrecision = current?.tickSize ? stepDecimals(current.tickSize, 2) : (current?.pricePrecision ?? 2);
  const quantityPrecision = current?.stepSize ? stepDecimals(current.stepSize) : (current?.quantityPrecision ?? 8);

  const derived = useMemo(() => {
    const open = orders.filter((o) => o.status === "open");
    return {
      openOrders: open.filter((o) => o.type !== "stop"),
      stopOrders: open.filter((o) => o.type === "stop"),
      orderHistory: orders.filter((o) => o.status !== "open"),
      fills: fillsFromOrders(orders),
    };
  }, [orders]);

  const value = useMemo<TradingState>(
    () => ({
      symbol,
      setSymbol,
      markets,
      interval,
      setInterval,
      ticker,
      live,
      instrument: current,
      pricePrecision,
      quantityPrecision,
      account,
      accountError,
      orders,
      positions: account?.positions ?? [],
      ...derived,
      orderSideFocus,
      setOrderSideFocus,
      placeOrder,
      cancelOrder,
      closePosition,
    }),
    [
      symbol, setSymbol, markets, interval, setInterval, ticker, live, current, pricePrecision,
      quantityPrecision, account,
      accountError, orders, derived, orderSideFocus, placeOrder, cancelOrder, closePosition,
    ],
  );

  return <TradingContext.Provider value={value}>{children}</TradingContext.Provider>;
}

export function useTradingStore() {
  const ctx = useContext(TradingContext);
  if (!ctx) throw new Error("useTradingStore must be used within TradingStoreProvider");
  return ctx;
}
