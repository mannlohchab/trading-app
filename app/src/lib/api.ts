import { fetch as streamingFetch } from 'expo/fetch';
import { consumeAiStream, type AiEvent } from './aiChat';
import { API_URL } from './config';
import { DEMO_MODE } from './demoMode';
import { demoApi } from './demoData';
import { useAuth } from '@/store/auth';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
  auth?: boolean;
  signal?: AbortSignal;
};

async function refreshTokens(): Promise<string | null> {
  const { refreshToken, setSession, clearSession } = useAuth.getState();
  if (!refreshToken) return null;
  const res = await fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    await clearSession();
    return null;
  }
  const data = (await res.json()) as {
    user: Parameters<typeof setSession>[0]['user'];
    accessToken: string;
    refreshToken: string;
  };
  await setSession(data);
  return data.accessToken;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (DEMO_MODE) return await demoApi.request(path, options) as T;
  const { method = 'GET', body, auth = true, signal } = options;
  let token = options.token ?? useAuth.getState().accessToken;

  const doFetch = async (access?: string | null) =>
    fetch(`${API_URL}${path}`, {
      method,
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch(auth ? token : null);
  if (res.status === 401 && auth) {
    token = await refreshTokens();
    if (token) res = await doFetch(token);
  }

  if (!res.ok) {
    let message = res.statusText;
    let details: unknown;
    try {
      const json = (await res.json()) as { error?: string; details?: unknown };
      message = json.error ?? message;
      details = json.details;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message, details);
  }

  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    return res as unknown as T;
  }
  return (await res.json()) as T;
}

export async function streamAiChat(
  body: {
    conversationId?: string;
    message: string;
    kind?: 'chat' | 'analysis' | 'portfolio';
    symbol?: string;
    exchange?: string;
  },
  onEvent: (event: AiEvent) => void,
  signal?: AbortSignal,
) {
  if (DEMO_MODE) return demoApi.stream(body, onEvent, signal);
  let token = useAuth.getState().accessToken;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  let res = await streamingFetch(`${API_URL}/api/ai/chat`, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    token = await refreshTokens();
    if (token) {
      signal?.throwIfAborted();
      res = await streamingFetch(`${API_URL}/api/ai/chat`, {
        method: 'POST',
        signal,
        headers: { ...headers, Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(res.status, error?.error || 'AI request failed. Please try again.');
  }
  if (!res.body) throw new Error('Streaming is unavailable. Please try again.');
  await consumeAiStream(res.body, onEvent);
}
