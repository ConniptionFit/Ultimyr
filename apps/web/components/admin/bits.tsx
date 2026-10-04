import type { ReactNode } from "react";

export function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-md border border-line p-5">
      <div>
        <h2 className="text-xl">{title}</h2>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export const Stat = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="rounded-md border border-line p-4">
    <p className="text-2xl">{value}</p>
    <p className="text-xs text-muted">{label}</p>
  </div>
);

export const ErrorLine = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="text-sm text-danger">
      {error}
    </p>
  ) : null;

export const Badge = ({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "danger" }) => (
  <span className={`rounded border px-1.5 py-0.5 text-xs ${tone === "accent" ? "border-accent text-accent" : tone === "danger" ? "border-danger text-danger" : "border-line text-muted"}`}>{children}</span>
);

export const selectCls = "rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink";
