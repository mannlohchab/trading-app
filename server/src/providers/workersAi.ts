import { config, hasCloudflareAi } from '../lib/config';
import { AppError } from '../lib/errors';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const DISCLAIMER =
  '\n\n---\n*Educational only. Not investment advice. Paper trading / simulated analysis. Past performance does not guarantee future results. Markets involve risk of capital loss.*';

export function buildSystemPrompt(context?: string): string {
  return [
    'You are an AI financial research assistant for forex and crypto markets, with legacy Indian equity support.',
    'Focus on forex currency pairs and crypto spot markets.',
    'Never invent live prices. If market data is provided below, treat it as factual; clearly label your own interpretation as AI-generated analysis.',
    'Never claim that any analysis guarantees future returns.',
    'Be concise, professional, and educational. Preserve each instrument’s quote currency; USDT is not USD. INR portfolio accounting is separate.',
    context ? `Factual market/portfolio context:\n${context}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function streamWorkersAi(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (!hasCloudflareAi()) {
    throw new AppError(503, 'AI Insight is not configured. Add CF_ACCOUNT_ID and CF_API_TOKEN to the backend server/.env and restart the server.', 'AI_NOT_CONFIGURED');
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${config.cloudflare.accountId}/ai/run/${config.cloudflare.model}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cloudflare.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages, stream: true, max_tokens: 512 }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null) as { errors?: { code?: number }[] } | null;
    const code = body?.errors?.[0]?.code;
    if (code === 3036) {
      throw new AppError(429, 'Cloudflare Workers AI daily free allowance is exhausted. It resets at 00:00 UTC (05:30 IST). Please try after the reset.', 'AI_DAILY_LIMIT');
    }
    if (res.status === 429) {
      throw new AppError(429, 'Cloudflare Workers AI is busy or rate-limited. Please try again shortly.', 'AI_BUSY');
    }
    if (code === 5035) {
      throw new AppError(503, 'This model requires a paid Cloudflare plan. Set CF_AI_MODEL to @cf/meta/llama-3.2-3b-instruct for the free tier.', 'AI_MODEL_REQUIRES_PAID');
    }
    if (res.status === 401 || res.status === 403) {
      throw new AppError(503, 'Cloudflare rejected the AI credentials. Check the backend account ID and token with Workers AI Read and Edit permissions.', 'AI_AUTH_ERROR');
    }
    throw new AppError(502, 'Cloudflare Workers AI could not complete the request. Check the backend model configuration and try again.', 'AI_PROVIDER_ERROR');
  }

  if (!res.body) {
    throw new AppError(502, 'Workers AI returned empty body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  let completed = false;

  const dispatch = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') { completed = true; return; }
    let json: { response?: string; error?: unknown; errors?: unknown[]; success?: boolean };
    try {
      json = JSON.parse(payload);
    } catch {
      throw new AppError(502, 'Cloudflare returned an unreadable AI response. Please try again.');
    }
    if (!json || json.error || json.errors?.length || json.success === false) {
      throw new AppError(502, 'Cloudflare could not finish the AI response. Please try again.');
    }
    if (typeof json.response === 'string') {
      full += json.response;
      onChunk(json.response);
    }
  };

  try {
    while (!completed) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        dispatch(line);
        if (completed) break;
      }
      if (done) {
        if (buffer && !completed) dispatch(buffer);
        break;
      }
    }
    if (!completed || !full.trim()) {
      throw new AppError(502, 'Cloudflare returned an empty or interrupted AI response. Please try again.');
    }
  } finally {
    try { await reader.cancel(); } catch { /* The connection may already be closed. */ }
    reader.releaseLock();
  }

  full += DISCLAIMER;
  onChunk(DISCLAIMER);
  return full;
}

export async function completeWorkersAi(messages: ChatMessage[]): Promise<string> {
  let result = '';
  await streamWorkersAi(messages, (chunk) => {
    result += chunk;
  });
  return result;
}
