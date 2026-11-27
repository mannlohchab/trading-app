// What the TradingGurukul app can do and where, for the assistant to guide users accurately.
// Labels are quoted exactly as the app shows them. Keep this in sync with the app (app/src/app,
// app/src/components): a wrong button name here becomes a wrong instruction to a user.

export type GuideTopic = {
  title: string;
  /** How to get there, with exact labels. */
  where: string[];
  /** What the user can do there. */
  actions: string[];
  /** Limits, empty states and common confusions. */
  notes?: string[];
};

export const APP_GUIDE = {
  navigation: {
    title: 'Getting around',
    where: [
      'Bottom tabs, left to right: "Home", "Market", "Insights" (this AI assistant), "Calendar", "Community". The tab bar is hidden inside Insights; tap the home icon ("Back to Home") to leave.',
      'Top bar on Home, Market and Community: "Gurukul" goes Home, the bell opens Profile → Settings, the "Portfolio" pill opens Profile on its "Portfolio" tab.',
    ],
    actions: ['Home has shortcuts: "Markets", "Calendar", "Community", "Portfolio", "AI Insight".'],
    notes: ['The bell is not a notification feed; it opens Settings.'],
  },
  home: {
    title: 'Home',
    where: ['Bottom tab "Home".'],
    actions: [
      'See whether crypto is up or down today, with 3 coin shortcuts and "Explore markets".',
      'Play the Morning Decode audio briefing.',
      '"Search" crypto pairs; "Discover markets" cards; "See all" opens "Most active" / "Gainers" / "Losers" lists.',
      '"Latest news" → "See all" opens Crypto news.',
    ],
  },
  markets: {
    title: 'Market list',
    where: ['Bottom tab "Market", or Home → "Explore markets" / "Markets".'],
    actions: ['Browse "Most active", "Gainers" or "Losers" (50 Binance USDT pairs each), or use "Search pairs". Tap a row to open its chart.'],
    notes: ['Crypto (Binance USDT pairs) only.'],
  },
  pair_chart: {
    title: 'Pair page and full chart',
    where: [
      'Quick preview ("Instrument Detail"): tap a coin on Home or a search result. "Open chart" opens the full chart.',
      'Full chart: tap a row in the Market tab, a chart/ticker card in this chat ("Open full chart ›"), or a symbol chip on a community post.',
    ],
    actions: [
      'Switch pair (tap the symbol), change timeframe (1m to 1M), add "Indicators" (Volume, MACD, Moving average, RSI, EMA, ATR, Supertrend, Bollinger Bands, Trading session), draw with the pencil, change chart type or go "Full screen" under "More chart options".',
      'Paper trade with "Buy" / "Sell" (see paper_trading).',
    ],
  },
  paper_trading: {
    title: 'Paper trading (virtual money)',
    where: ['Full chart of a USDT pair → "Buy" or "Sell".'],
    actions: [
      'Choose Market or Limit, enter Quantity (or "Use all available quantity"), then "Place buy order" / "Place sell order".',
      'Every account starts with 100,000 virtual USDT. Open orders can be cancelled in Profile → Portfolio → "Paper orders" → "Cancel".',
    ],
    notes: [
      'No leverage or short selling. Market orders fill at bid/ask with 0.1% commission; limit orders fill when the live price reaches them.',
      'Pairs not quoted in USDT/USD are view-only.',
    ],
  },
  paper_portfolio: {
    title: 'Paper trading portfolio',
    where: ['"Portfolio" pill in the top bar, or Home → "Portfolio". Both open Profile on its "Portfolio" tab.'],
    actions: ['See paper equity, P/L, "Positions" (tap one to open its chart), "Paper orders" (cancel open ones) and "Recent activity".'],
    notes: [
      'This is NOT the holdings table this assistant reviews. Paper positions come from Buy/Sell on charts; holdings are typed in by the user (see holdings).',
      'Empty state: "No positions yet", with "Browse markets".',
    ],
  },
  holdings: {
    title: 'Your real holdings table (for AI review)',
    where: ['Insights → mode menu (round "+" left of the message box) → "Portfolio" → "Add" / "Edit" on the holdings card, or "Edit holdings" in the mode menu. The screen is "My holdings".'],
    actions: [
      'One row per purchase: Asset, Quantity, Bought on (DD/MM/YYYY), Buy price (optional). "+ Add row", "Paste from Excel" (columns or a header row in any order), "×" to delete a row, then "Save".',
      '"Analyse with AI" (enabled after saving) opens a portfolio review here.',
    ],
    notes: ['Up to 100 rows. Prices are in USDT. Leave buy price empty to use that day\'s Binance close (an estimate).'],
  },
  ai_assistant: {
    title: 'Insights (this AI assistant)',
    where: ['Bottom tab "Insights", or Home → "AI Insight".'],
    actions: [
      'Modes, from the round "+" next to the message box: "Chat" (anything about markets), "Market" (type a pair such as BTCUSDT, then "Analyze"), "Portfolio" (reviews the holdings table). The "×" on the mode tag returns to Chat.',
      'History icon: past conversations, search, long-press to delete. "+" in the header starts a new chat.',
      'From chat the assistant can: check prices and movers, analyse a pair, draw charts, draft a strategy (save it from its card), run backtests, start or control live forward tests, review holdings, and research news on the web.',
    ],
    notes: ['After an error or a stopped reply, tap "Start a new chat to continue".', 'There is no model picker.'],
  },
  strategies: {
    title: 'Strategies',
    where: ['Strategies are created only here in the AI chat: ask for one, then save it from the strategy card ("Ready to save" → "Saved").'],
    actions: ['Saved strategies appear in Backtesting → "New backtest" → "1. Choose a saved strategy", and can be used for live forward tests.'],
    notes: ['There is no manual strategy editor screen; changes are made by asking the assistant for a new version.'],
  },
  backtests: {
    title: 'Backtesting workspace',
    where: ['Profile → Settings → "Strategy backtesting" → "Open backtesting", or a backtest card in this chat ("Configure runs and compare results →").'],
    actions: [
      '"New backtest": 1. choose a saved strategy, 2. "Historical period" (start/end dates in UTC and timeframe; leave blank for the latest 1,000 closed candles), 3. "Capital and execution" (capital, commission, slippage, spread, sizing), then "Run backtest".',
      '"Run history": open past runs; select up to three completed runs with "Compare this run"; "Load older runs".',
      '"Research datasets and walk-forward tests" opens the Research workspace.',
    ],
    notes: ['Empty state without strategies: "Save a strategy from an AI conversation…" with "Open AI assistant".'],
  },
  backtest_results: {
    title: 'Backtest results',
    where: ['Tap a run in "Run history", or "Open results" on a run card in this chat.'],
    actions: [
      'Queued/running runs update automatically ("Cancel backtest" is available).',
      'See "Performance" (total return, realized P/L, drawdown, win rate, profit factor, trades, fees, buy-and-hold return, exposure, equity chart), "Run warnings", "Execution settings", "Data provenance" ("Replay archived run", "Inspect archived data") and "Trades" (30 per page).',
    ],
  },
  research: {
    title: 'Research workspace',
    where: ['Backtesting → "Research datasets and walk-forward tests", or "Open results" on an experiment card in this chat.'],
    actions: [
      '"Historical datasets": "Import dataset JSON" → "Validate and import" (up to 2 MB).',
      '"New experiment": "Single run", "Walk-forward" (training, unseen test and embargo candles; up to 8 strategy candidates) or "Quote portfolio", then "Run experiment".',
      '"Experiment history" → results, "Cancel experiment".',
    ],
    notes: ['Needs saved strategies first: "Save strategy variants in the AI assistant before creating a research experiment."'],
  },
  live_tests: {
    title: 'Live forward tests (paper)',
    where: ['Started by asking this assistant. Open one with "Open live test and controls" on its card in this chat (screen "Live paper test").'],
    actions: [
      '"Pause strategy", "Resume strategy", "Stop strategy · keep position", "Stop strategy and close position", "Close virtual … position", "Refresh live test".',
      'See "Paper account performance", the open position and "Recent evaluated signals".',
    ],
    notes: [
      'There is no list screen for live tests; ask the assistant to list them, or reopen the chat that started one.',
      'Account performance covers the whole virtual account, not one strategy. Only newly closed candles are traded.',
    ],
  },
  community: {
    title: 'Community',
    where: ['Bottom tab "Community".'],
    actions: [
      'Feeds: "For You", "Editors\' Picks", "Following", "Saved". Follow traders, like, comment, "☆ Save", "Share", "Report".',
      '"Post" → write up to 5,000 characters, attach a symbol and an image (under 1.3 MB), then "Publish".',
      'Tap a symbol chip to open its chart.',
    ],
  },
  news: {
    title: 'Crypto news',
    where: ['Home → "Latest news" → "See all".'],
    actions: ['Tap a story to read it in the in-app browser.'],
    notes: ['No search or filters.'],
  },
  calendar: {
    title: 'Economic calendar',
    where: ['Bottom tab "Calendar".'],
    actions: ['Week or month view, "Back to today", search events or currencies, filter by impact ("High" / "Medium" / "Low"). Events show Actual / Forecast / Previous and a "Source" link.'],
    notes: ['Only the published weekly schedule is available.'],
  },
  morning_decode: {
    title: 'Morning Decode',
    where: ['The audio card on Home.'],
    actions: ['Play/Pause, rewind or skip 15 seconds; "×" hides it for this session.'],
    notes: ['Audio only, no transcript. One shared briefing per day.'],
  },
  profile_settings: {
    title: 'Profile and settings',
    where: ['Bell icon or "Edit" next to your name → Profile → "Settings".'],
    actions: [
      'Edit display name and username ("Save profile"), toggle "Notifications", "Change password", "Log out".',
      '"Strategy backtesting" → "Open backtesting".',
      '"What Insights remembers": the facts this assistant saved about them; "Forget" removes one, "Forget everything" removes all.',
    ],
    notes: ['Email and phone are read-only.'],
  },
  not_available: {
    title: 'Not in the app yet',
    where: [],
    actions: [],
    notes: [
      'No watchlist or favourites, and no price alerts or notification feed.',
      'No in-app setting for AI response style, explanation level, language or timezone.',
      'No manual strategy editor; strategies are drafted in this chat.',
      'No live-test list screen.',
      'No real-money trading: all trading is virtual.',
    ],
  },
} satisfies Record<string, GuideTopic>;

export type GuideTopicId = keyof typeof APP_GUIDE;
export const GUIDE_TOPICS = Object.keys(APP_GUIDE) as [GuideTopicId, ...GuideTopicId[]];

/** One line per topic, for choosing what to read. */
export const guideIndex = () => GUIDE_TOPICS.map(id => ({ topic: id, title: APP_GUIDE[id].title }));
