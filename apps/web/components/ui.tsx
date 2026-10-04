import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Button({ variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60";
  const tone =
    variant === "primary"
      ? "bg-accent text-accent-ink hover:opacity-90"
      : "border border-line text-ink hover:bg-surface";
  return <button className={`${base} ${tone} ${className}`} {...rest} />;
}

export function Field({ label, id, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <input id={id} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" {...rest} />
    </div>
  );
}

export function Shell({ children, narrow = false, wide = false }: { children: ReactNode; narrow?: boolean; wide?: boolean }) {
  return <main id="main" tabIndex={-1} className={`mx-auto px-4 py-16 ${narrow ? "max-w-sm" : wide ? "max-w-5xl" : "max-w-3xl"}`}>{children}</main>;
}

export function Toggle({ label, hint, on, onChange, disabled }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <p className="text-sm">{label}</p>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${on ? "bg-accent" : "bg-line"}`}
      >
        <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-surface transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}
