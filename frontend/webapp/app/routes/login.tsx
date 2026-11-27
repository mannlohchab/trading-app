import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router";
import type { Route } from "./+types/login";
import { AuthError, AuthField, AuthLoading, AuthShell, AuthSubmit } from "../components/AuthShell";
import { authRedirect, humanizeApiError, useAuth } from "../lib/auth";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Log In — ZRS Exchange" },
    { name: "description", content: "Log in to the ZRS paper trading terminal" },
  ];
}

export default function LoginPage() {
  const { user, ready, login, logout } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!ready) return <AuthLoading />;
  if (user && (user.status === "ACTIVE" || user.status === "PENDING_PHONE_VERIFICATION")) {
    return <Navigate to={authRedirect(user) ?? "/"} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const next = await login(email, password);
      if (next && next.status !== "ACTIVE" && next.status !== "PENDING_PHONE_VERIFICATION") {
        await logout();
        setError("This account is disabled.");
      }
    } catch (err) {
      setError(humanizeApiError(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell
      subtitle="Log in to the paper trading terminal"
      footer={
        <>
          No account?{" "}
          <Link to="/signup" className="font-medium text-ex-text underline">
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <AuthField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <AuthField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <AuthError message={error} />
        <AuthSubmit pending={pending} label="Log In" pendingLabel="Logging in…" />
      </form>
    </AuthShell>
  );
}
