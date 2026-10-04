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

export function Shell({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <main id="main" tabIndex={-1} className={`mx-auto px-4 py-16 ${narrow ? "max-w-sm" : "max-w-3xl"}`}>{children}</main>;
}
