// Daily AI allowance per user. Pure.

export type UsageLimits = { turnsPerDay: number; tokensPerDay: number };
export type UsageToday = { turns: number; inputTokens: number; outputTokens: number };
export type QuotaDecision = { allowed: true } | { allowed: false; reason: 'DAILY_TURN_LIMIT' | 'DAILY_TOKEN_LIMIT'; resetAt: Date };

/** Start of the current UTC day; the allowance resets at 00:00 UTC. */
export const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export function decideQuota(usage: UsageToday, limits: UsageLimits, now: Date): QuotaDecision {
  const resetAt = new Date(startOfUtcDay(now).getTime() + 86_400_000);
  if (usage.turns >= limits.turnsPerDay) return { allowed: false, reason: 'DAILY_TURN_LIMIT', resetAt };
  if (usage.inputTokens + usage.outputTokens >= limits.tokensPerDay) return { allowed: false, reason: 'DAILY_TOKEN_LIMIT', resetAt };
  return { allowed: true };
}
