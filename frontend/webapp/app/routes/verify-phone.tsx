import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import type { Route } from "./+types/verify-phone";
import { AuthError, AuthField, AuthLoading, AuthShell, AuthSubmit } from "../components/AuthShell";
import { humanizeApiError, useAuth } from "../lib/auth";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Verify phone — ZRS Exchange" }];
}

/** E.164 without spaces, e.g. +919876543210. */
const normalizePhone = (value: string) => value.replace(/[\s()-]/g, "");

export default function VerifyPhonePage() {
  const { user, ready, sendOtp, verifyOtp, logout } = useAuth();
  const [phone, setPhone] = useState(user?.phoneNumber ?? "+91");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!ready) return <AuthLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.status !== "PENDING_PHONE_VERIFICATION") return <Navigate to="/" replace />;

  const onSend = async () => {
    const number = normalizePhone(phone);
    if (!/^\+[1-9]\d{6,14}$/.test(number)) {
      setError("Enter your number with the country code, e.g. +919876543210");
      return;
    }
    setPending(true);
    try {
      await sendOtp(number);
      setSentTo(number);
      setCode("");
    } catch (err) {
      setError(humanizeApiError(err));
    } finally {
      setPending(false);
    }
  };

  const onVerify = async () => {
    if (!sentTo) return;
    if (!/^\d{4,8}$/.test(code.trim())) {
      setError("Enter the code from the SMS");
      return;
    }
    setPending(true);
    try {
      await verifyOtp(sentTo, code.trim());
      // The refreshed session is ACTIVE; the guard above then redirects to the terminal.
    } catch (err) {
      setError(humanizeApiError(err));
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    void (sentTo ? onVerify() : onSend());
  };

  return (
    <AuthShell
      subtitle={sentTo ? `Enter the code we sent to ${sentTo}` : "Verify your phone number to start trading"}
      footer={
        <button type="button" onClick={() => void logout()} className="font-medium text-ex-text underline">
          Use a different account
        </button>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {sentTo ? (
          <AuthField
            label="Verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            required
          />
        ) : (
          <AuthField
            label="Phone number"
            type="tel"
            autoComplete="tel"
            placeholder="+919876543210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        )}
        <AuthError message={error} />
        <AuthSubmit
          pending={pending}
          label={sentTo ? "Verify" : "Send code"}
          pendingLabel={sentTo ? "Verifying…" : "Sending…"}
        />
        {sentTo && (
          <div className="flex justify-between text-[12px] text-ex-muted">
            <button type="button" className="hover:text-ex-text" onClick={() => { setSentTo(null); setError(null); }}>
              Change number
            </button>
            <button type="button" className="hover:text-ex-text" disabled={pending} onClick={() => { setError(null); void onSend(); }}>
              Resend code
            </button>
          </div>
        )}
      </form>
    </AuthShell>
  );
}
