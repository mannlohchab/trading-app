const env = process.env;
const isProduction = env.NODE_ENV === 'production';

function required(name: string, devFallback: string): string {
  const value = env[name]?.trim();
  if (value) return value;
  if (isProduction) throw new Error(`${name} must be set in production`);
  return devFallback;
}
const list = (value: string | undefined) => (value ?? '').split(',').map(v => v.trim()).filter(Boolean);
const pair = <K extends string>(keys: Record<K, string | undefined>) =>
  Object.values(keys).every(Boolean) ? (keys as Record<K, string>) : undefined;

const port = Number(env.PORT ?? 4001);
const authSecret = required('BETTER_AUTH_SECRET', 'dev-only-better-auth-secret-change-me-0123456789');
if (isProduction && authSecret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');

const smsProvider = env.SMS_PROVIDER ?? 'console';
if (isProduction && smsProvider === 'console') {
  throw new Error('SMS_PROVIDER=console only prints OTPs to the log and is not allowed in production');
}

export const config = {
  isProduction,
  port,
  // Comma-separated list of allowed origins, or "*" for any.
  clientOrigin: ((env.CLIENT_ORIGIN ?? '*') === '*' ? '*' : list(env.CLIENT_ORIGIN)) as '*' | string[],
  database: {
    url: required('DATABASE_URL', 'postgres://trading:trading@localhost:5433/trading'),
    poolMax: Number(env.DATABASE_POOL_MAX ?? 10),
    // "require" for managed Postgres (Neon, RDS, Supabase…); "disable" for local.
    ssl: (env.DATABASE_SSL ?? (isProduction ? 'require' : 'disable')) as 'require' | 'disable',
  },
  auth: {
    secret: authSecret,
    /** Public URL of this API (used for OAuth callbacks and cookies). */
    baseUrl: required('BETTER_AUTH_URL', `http://localhost:${port}`),
    /** Origins allowed to call auth endpoints: web app origins and the mobile deep-link scheme. */
    // Outside production, Expo Go's exp:// origins are trusted too, so the app works before a dev build.
    trustedOrigins: [...list(env.AUTH_TRUSTED_ORIGINS ?? 'http://localhost:8081,tradinggurukul://'), ...(isProduction ? [] : ['exp://**'])],
    google: pair({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }),
    apple: pair({ clientId: env.APPLE_CLIENT_ID, clientSecret: env.APPLE_CLIENT_SECRET }),
    /** iOS bundle id, needed for native Sign in with Apple (ID-token flow). */
    appleBundleId: env.APPLE_APP_BUNDLE_IDENTIFIER,
  },
  sms: { provider: smsProvider },
  ai: {
    cloudflare: pair({ accountId: env.CF_ACCOUNT_ID?.trim(), apiToken: env.CF_API_TOKEN?.trim() }),
    defaultModel: env.AI_DEFAULT_MODEL?.trim() || 'llama-4-scout',
    fallbackModels: list(env.AI_FALLBACK_MODELS ?? 'mistral-small-3.1'),
    limits: {
      turnsPerDay: Number(env.AI_DAILY_TURN_LIMIT ?? 50),
      tokensPerDay: Number(env.AI_DAILY_TOKEN_LIMIT ?? 250_000),
    },
  },
  backtesting: (() => {
    const mode = (env.BACKTEST_SANDBOX ?? 'bwrap') as 'bwrap' | 'process';
    if (mode !== 'bwrap' && mode !== 'process') throw new Error('BACKTEST_SANDBOX must be "bwrap" or "process"');
    // "process" has resource limits but no namespace isolation: only safe inside a container that is
    // itself network- and secret-isolated, which the deployment must declare explicitly.
    if (isProduction && mode === 'process' && env.BACKTEST_SANDBOX_ISOLATED_CONTAINER !== 'true') {
      throw new Error('BACKTEST_SANDBOX=process in production requires BACKTEST_SANDBOX_ISOLATED_CONTAINER=true');
    }
    return {
      sandbox: { mode },
      /** Run the background job runner inside this process (set false when a separate jobs worker runs). */
      runJobs: (env.BACKGROUND_JOBS_ENABLED ?? 'true') === 'true',
      jobConcurrency: Number(env.BACKGROUND_JOBS_CONCURRENCY ?? 1),
    };
  })(),
  paperTrading: {
    /** Run the live paper engine (market subscriptions, fills, strategy scheduling) in this process. */
    engineEnabled: (env.PAPER_ENGINE_ENABLED ?? 'true') === 'true',
  },
  http: {
    /**
     * Header your reverse proxy sets to the real client IP (e.g. "x-forwarded-for", "cf-connecting-ip").
     * Leave unset when the server is exposed directly; clients could otherwise spoof their IP.
     */
    trustedProxyIpHeader: env.TRUSTED_PROXY_IP_HEADER?.trim() || undefined,
  },
};

export type AuthConfig = typeof config.auth;
