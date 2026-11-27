// Better Auth client for the backend's `/api/v1/auth` (email/password + phone OTP).
// Logic mirrors app/src/lib/authClient.ts, web-only: the browser keeps the session cookie.
import { phoneNumberClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// The SPA build evaluates modules once without a window; any absolute URL works there.
const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;

export const authClient = createAuthClient({
  baseURL: `${origin}/api/v1/auth`,
  fetchOptions: { credentials: "include" },
  plugins: [phoneNumberClient()],
});
