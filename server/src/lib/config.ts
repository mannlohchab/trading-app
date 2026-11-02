import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? '*',
  jwtSecret: required('JWT_SECRET', 'dev-jwt-secret-change-me'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
  defaultPaperBalance: Number(process.env.DEFAULT_PAPER_BALANCE ?? 100_000),
  twelveData: {
    apiKey: process.env.TWELVE_DATA_API_KEY ?? '',
    minuteCredits: Math.max(1, Number(process.env.TWELVE_DATA_MINUTE_CREDITS) || 8),
    dayCredits: Math.max(1, Number(process.env.TWELVE_DATA_DAY_CREDITS) || 800),
    quoteTtlMs: Math.max(15000, Number(process.env.FOREX_POLL_MS) || 60000),
    historyTtlMs: Math.max(60000, Number(process.env.FOREX_HISTORY_CACHE_MS) || 300000),
  },
  cloudflare: {
    accountId: process.env.CF_ACCOUNT_ID?.trim() ?? '',
    apiToken: process.env.CF_API_TOKEN?.trim() ?? '',
    model: process.env.CF_AI_MODEL?.trim() || '@cf/meta/llama-3.2-3b-instruct',
  },
};

export function hasCloudflareAi(): boolean {
  return Boolean(config.cloudflare.accountId && config.cloudflare.apiToken);
}
