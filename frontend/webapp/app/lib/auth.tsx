// Better Auth session state for the terminal. Account lifecycle on the backend:
// sign-up → phone OTP → ACTIVE (see elysia-backend identity module). Logic from app/src/store/auth.ts.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authClient } from "./api/authClient";
import { ApiError, setAuthProblemHandler } from "./api/client";
import { resetPaperAccount } from "./api/paper";
import { closeMarketSocket } from "./api/socket";

export { humanizeApiError } from "./api/client";

export type AccountStatus = "PENDING_PHONE_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "DELETED";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  status: AccountStatus;
  phoneNumber: string | null;
}

type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  status?: AccountStatus | null;
  phoneNumber?: string | null;
};

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<AuthUser | null>;
  signup: (name: string, email: string, password: string) => Promise<AuthUser | null>;
  sendOtp: (phoneNumber: string) => Promise<void>;
  verifyOtp: (phoneNumber: string, code: string) => Promise<AuthUser | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<AuthUser | null>;
}

const AuthContext = createContext<AuthState | null>(null);

function fromSession(u: SessionUser): AuthUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name?.trim() || null,
    status: u.status ?? "PENDING_PHONE_VERIFICATION",
    phoneNumber: u.phoneNumber ?? null,
  };
}

/** Better Auth client calls return `{ data, error }`; turn the error into an ApiError. */
function unwrap<T>(result: { data: T | null; error: { status: number; message?: string; code?: string } | null }): T {
  if (result.error) {
    throw new ApiError(result.error.status, result.error.message || "Request failed", result.error.code);
  }
  return result.data as T;
}

export function displayName(user: Pick<AuthUser, "name" | "email">) {
  return user.name || user.email.split("@")[0];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await authClient.getSession();
      const next = !error && data ? fromSession(data.user as unknown as SessionUser) : null;
      setUser(next);
      return next;
    } catch (err) {
      console.error("session refresh failed", err);
      setUser(null);
      return null;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // A 401 or PHONE_VERIFICATION_REQUIRED from any API call re-reads the session; the route
    // guards then send the user to /login or /verify-phone.
    setAuthProblemHandler(() => void refresh());
    return () => setAuthProblemHandler(undefined);
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      unwrap(await authClient.signIn.email({ email: email.trim(), password }));
      return refresh();
    },
    [refresh],
  );

  const signup = useCallback(
    async (name: string, email: string, password: string) => {
      unwrap(await authClient.signUp.email({ name: name.trim(), email: email.trim(), password }));
      return refresh();
    },
    [refresh],
  );

  const sendOtp = useCallback(async (phoneNumber: string) => {
    unwrap(await authClient.phoneNumber.sendOtp({ phoneNumber }));
  }, []);

  const verifyOtp = useCallback(
    async (phoneNumber: string, code: string) => {
      unwrap(await authClient.phoneNumber.verify({ phoneNumber, code }));
      return refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await authClient.signOut();
    } finally {
      closeMarketSocket();
      resetPaperAccount();
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, signup, sendOtp, verifyOtp, logout, refresh }),
    [user, ready, login, signup, sendOtp, verifyOtp, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Where a user in this state belongs, or null when they may use the terminal. */
export function authRedirect(user: AuthUser | null): string | null {
  if (!user) return "/login";
  if (user.status === "PENDING_PHONE_VERIFICATION") return "/verify-phone";
  return null;
}
