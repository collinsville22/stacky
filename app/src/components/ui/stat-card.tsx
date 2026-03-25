import { AnimatedNumber } from "./animated-number";

export function StatCard({
  label,
  value,
  prefix = "",
  suffix = "",
  decimals = 2,
  highlight,
}: {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-mono text-fg-3 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className={`text-2xl font-serif font-black tracking-tight ${highlight ? "text-loss" : "text-fg"}`}>
        {prefix}
        <AnimatedNumber value={value} decimals={decimals} />
        {suffix}
      </p>
    </div>
  );
}
