import { clsx } from "clsx";

export function GradientButton({
  children,
  onClick,
  disabled,
  className,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "px-5 py-2.5 text-sm transition-all cursor-pointer",
        variant === "primary" && !disabled &&
          "bg-copper text-base hover:brightness-110 active:scale-[0.98]",
        variant === "secondary" && !disabled &&
          "bg-transparent text-fg-2 border border-line hover:border-fg-4 hover:text-fg",
        disabled &&
          "bg-raised-2 text-fg-4 cursor-not-allowed",
        className
      )}
    >
      {children}
    </button>
  );
}
