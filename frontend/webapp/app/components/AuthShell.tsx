import type { InputHTMLAttributes, ReactNode } from "react";

/** Centered card used by the login, sign-up and phone-verification pages. */
export function AuthShell({ subtitle, children, footer }: { subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ex-bg px-4">
      <div className="w-full max-w-sm border border-ex-border bg-ex-panel p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-[20px] font-bold tracking-tight text-ex-text">ZRS</div>
          <p className="mt-1 text-[13px] text-ex-muted">{subtitle}</p>
        </div>
        {children}
        {footer && <p className="mt-4 text-center text-[12px] text-ex-muted">{footer}</p>}
      </div>
    </div>
  );
}

export function AuthField({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-[12px] text-ex-muted">
      {label}
      <input
        {...input}
        className="rounded border border-ex-border bg-ex-bg px-3 py-2 text-[13px] text-ex-text outline-none focus:border-ex-border-strong"
      />
    </label>
  );
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-[12px] text-ex-down" role="alert">
      {message}
    </p>
  );
}

export function AuthSubmit({ pending, label, pendingLabel }: { pending: boolean; label: string; pendingLabel: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 rounded bg-ex-accent px-3 py-2 text-[13px] font-semibold text-black hover:brightness-110 disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export function AuthLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ex-bg text-[13px] text-ex-muted">
      Loading…
    </div>
  );
}
