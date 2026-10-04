import { AlertCircle, Check, Loader2, type LucideIcon, type LucideProps } from "lucide-react";
import type { CSSProperties } from "react";

/**
 * Icon utilities. All icons in Ultimyr come from Lucide; these wrappers add
 * consistent sizing, animation presets and combined (badged) icons.
 * Animation keyframes live in `animations.css` (imported once by the app).
 */
export type IconAnimation = "spin" | "pulse" | "draw" | "bounce" | "none";

export interface UIconProps extends Omit<LucideProps, "ref"> {
  icon: LucideIcon;
  animation?: IconAnimation;
}

const animationClass: Record<IconAnimation, string> = {
  spin: "ulti-icon-spin",
  pulse: "ulti-icon-pulse",
  draw: "ulti-icon-draw",
  bounce: "ulti-icon-bounce",
  none: "",
};

export function UIcon({ icon: Icon, animation = "none", className, size = 18, strokeWidth = 1.75, ...rest }: UIconProps) {
  return (
    <Icon
      aria-hidden={rest["aria-label"] ? undefined : true}
      size={size}
      strokeWidth={strokeWidth}
      className={[animationClass[animation], className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

export type Status = "idle" | "loading" | "success" | "error";

const statusIcon: Record<Exclude<Status, "idle">, { icon: LucideIcon; animation: IconAnimation; label: string }> = {
  loading: { icon: Loader2, animation: "spin", label: "Loading" },
  success: { icon: Check, animation: "draw", label: "Done" },
  error: { icon: AlertCircle, animation: "pulse", label: "Something went wrong" },
};

/** One consistent animated icon for every async state. Renders nothing when idle. */
export function StatusIcon({ status, size = 18, className }: { status: Status; size?: number; className?: string }) {
  if (status === "idle") return null;
  const { icon, animation, label } = statusIcon[status];
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <UIcon icon={icon} animation={animation} size={size} className={className} />
    </span>
  );
}

export interface ComposedIconProps {
  base: LucideIcon;
  badge: LucideIcon;
  size?: number;
  badgeAnimation?: IconAnimation;
  className?: string;
}

/** A base icon with a small badge icon pinned to its bottom-right corner. */
export function ComposedIcon({ base, badge, size = 24, badgeAnimation = "none", className }: ComposedIconProps) {
  const badgeSize = Math.round(size * 0.55);
  const style: CSSProperties = { width: size, height: size };
  return (
    <span className={["relative inline-flex", className].filter(Boolean).join(" ")} style={style}>
      <UIcon icon={base} size={size} />
      <span className="absolute -bottom-1 -right-1 rounded-full bg-[var(--bg)] p-px">
        <UIcon icon={badge} size={badgeSize} animation={badgeAnimation} />
      </span>
    </span>
  );
}

/** Custom Archive icons: an uploaded PNG when present, otherwise a Lucide icon by name. */
export function ArchiveIcon({
  pngUrl,
  fallback,
  size = 24,
  alt = "",
}: {
  pngUrl?: string | null;
  fallback: LucideIcon;
  size?: number;
  alt?: string;
}) {
  if (pngUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={pngUrl} alt={alt} width={size} height={size} className="object-contain" />;
  }
  return <UIcon icon={fallback} size={size} aria-label={alt || undefined} />;
}
