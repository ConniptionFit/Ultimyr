/** Small dependency-free SVG charts. Each has a text alternative so the numbers are never only in the picture. */
export function BarChart({ data, max, label, height = 96 }: { data: { label: string; value: number }[]; max?: number; label: string; height?: number }) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  const w = 100 / Math.max(1, data.length);
  return (
    <figure>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" role="img" aria-label={label} className="h-24 w-full">
        {data.map((d, i) => {
          const h = (d.value / top) * (height - 4);
          return <rect key={i} x={i * w + w * 0.15} y={height - h} width={w * 0.7} height={Math.max(h, d.value > 0 ? 1 : 0)} rx={1} fill="var(--accent)" opacity={0.85} />;
        })}
      </svg>
      <figcaption className="sr-only">{data.map((d) => `${d.label}: ${d.value}`).join(", ")}</figcaption>
    </figure>
  );
}

export function Meter({ value, label, tone = "accent" }: { value: number; label: string; tone?: "accent" | "danger" }) {
  const pct = Math.min(100, Math.max(0, value / 100));
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-2 w-full rounded bg-surface">
      <div className="h-2 rounded" style={{ width: `${pct}%`, background: tone === "danger" ? "var(--danger)" : "var(--accent)" }} />
    </div>
  );
}
