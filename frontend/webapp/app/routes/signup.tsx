import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router";
import type { Route } from "./+types/signup";
import { AuthError, AuthField, AuthLoading, AuthShell, AuthSubmit } from "../components/AuthShell";
import { authRedirect, humanizeApiError, useAuth } from "../lib/auth";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Sign Up — ZRS Exchange" },
    { name: "description", content: "Create a ZRS paper trading account" },
  ];
}

export default function SignupPage() {
  const { user, ready, signup } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!ready) return <AuthLoading />;
  // Sign-up signs the user in; new accounts go on to verify a phone number.
  if (user) return <Navigate to={authRedirect(user) ?? "/"} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setPending(true);
    try {
      await signup(name, email, password);
    } catch (err) {
      setError(humanizeApiError(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell
      subtitle="Create an account. You'll verify your phone number next."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-ex-text underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <AuthField label="Name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
        <AuthField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <AuthField
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        <AuthError message={error} />
        <AuthSubmit pending={pending} label="Sign Up" pendingLabel="Creating…" />
      </form>
    </AuthShell>
  );
}
