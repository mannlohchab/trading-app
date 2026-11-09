import { fetch as streamingFetch } from 'expo/fetch';
import { consumeAiStream, type AiEvent } from './aiChat';
import { authHeaders } from './authClient';
import { API_URL } from './config';
import { DEMO_MODE } from './demoMode';
import { demoApi } from './demoData';

/** Error from the backend: `{ error, code, fields? }`. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

/** Called when the backend says the session is gone or the phone still needs verifying. */
let onAuthProblem: ((problem: 'signed-out' | 'phone-verification') => void) | undefined;
export function setAuthProblemHandler(handler: typeof onAuthProblem) { onAuthProblem = handler; }

async function errorFrom(res: Response): Promise<ApiError> {
  let message = res.statusText || 'Request failed';
  let code: string | undefined;
  let details: unknown;
  try {
    const json = (await res.json()) as { error?: string; message?: string; code?: string; fields?: Record<string, string> };
    const fieldMessage = json.fields ? Object.values(json.fields)[0] : undefined;
    message = fieldMessage ?? json.error ?? json.message ?? message;
    code = json.code;
    details = json.fields;
  } catch {
    // Not JSON.
  }
  if (res.status === 401) onAuthProblem?.('signed-out');
  if (res.status === 403 && code === 'PHONE_VERIFICATION_REQUIRED') onAuthProblem?.('phone-verification');
  return new ApiError(res.status, message, code, details);
}

/** JSON request to the backend (`/api/v1/...`), authenticated with the Better Auth session. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (DEMO_MODE) return await demoApi.request(path, options) as T;
  const { method = 'GET', body, signal } = options;
  const auth = await authHeaders();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    signal,
    credentials: auth.credentials,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...auth.headers,
      ...options.headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await errorFrom(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Sends one message to an AI conversation and streams the reply (server-sent events:
 * `user_message`, `status`, `delta`, `block`, `assistant_message`, `done` or `error`).
 */
export async function streamAiMessage(
  conversationId: string,
  content: string,
  onEvent: (event: AiEvent) => void,
  signal?: AbortSignal,
) {
  const auth = await authHeaders();
  const res = await streamingFetch(`${API_URL}/api/v1/ai/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    signal,
    credentials: auth.credentials,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...auth.headers },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw await errorFrom(res as unknown as Response);
  if (!res.body) throw new Error('Streaming is unavailable. Please try again.');
  await consumeAiStream(res.body, onEvent);
}

/** Demo preview keeps its local, fictional assistant. */
export function streamDemoAiChat(
  body: { conversationId?: string; message: string; kind?: 'chat' | 'analysis' | 'portfolio'; symbol?: string; exchange?: string },
  onEvent: (event: AiEvent) => void,
  signal?: AbortSignal,
) {
  return demoApi.stream(body, onEvent, signal);
}
