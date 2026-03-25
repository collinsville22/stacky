import { clsx } from "clsx";

export function GlassCard({
  children,
  className,
  glow,
  style,
  accent,
}: {
  children: React.ReactNode;
  className?: string;
  glow?: "orange" | "green" | "blue";
  style?: React.CSSProperties;
  accent?: "amber" | "green" | "red" | "blue";
}) {
  return (
    <div
      className={clsx(
        "border-t border-line pt-5 pb-6",
        className
      )}
      style={style}
    >
      {children}
    </div>
  );
}
