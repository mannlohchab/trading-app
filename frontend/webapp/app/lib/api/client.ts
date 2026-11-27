// JSON client for elysia-backend (`/api/v1/...`). Same-origin: the Vite dev proxy, or the nginx
// reverse proxy in production, forwards `/api` to the backend, so the Better Auth session cookie
// rides along with `credentials: "include"`. Error handling ported from app/src/lib/api.ts.

/** Error from the backend: `{ error, code?, fields? }`. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function humanizeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Please log in again.";
    if (err.status === 429) return err.message || "Too many requests. Wait a moment and try again.";
    return err.message || `Request failed (${err.status})`;
  }
  if (err instanceof TypeError) return "Can't reach the server. Check your connection.";
  if (err instanceof Error) return err.message;
  return "Request failed";
}

export type AuthProblem = "signed-out" | "phone-verification";

/** Called when the backend says the session is gone or the phone still needs verifying. */
let onAuthProblem: ((problem: AuthProblem) => void) | undefined;
export function setAuthProblemHandler(handler: typeof onAuthProblem) {
  onAuthProblem = handler;
}

async function errorFrom(res: Response): Promise<ApiError> {
  let message = res.statusText || "Request failed";
  let code: string | undefined;
  let fields: Record<string, string> | undefined;
  try {
    const json = (await res.json()) as {
      error?: string;
      message?: string;
      code?: string;
      fields?: Record<string, string>;
    };
    const fieldMessage = json.fields ? Object.values(json.fields)[0] : undefined;
    message = fieldMessage ?? json.error ?? json.message ?? message;
    code = json.code;
    fields = json.fields;
  } catch {
    // Not JSON.
  }
  if (res.status === 401) onAuthProblem?.("signed-out");
  if (res.status === 403 && code === "PHONE_VERIFICATION_REQUIRED") onAuthProblem?.("phone-verification");
  return new ApiError(res.status, message, code, fields);
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal, headers } = options;
  const res = await fetch(path, {
    method,
    signal,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await errorFrom(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
