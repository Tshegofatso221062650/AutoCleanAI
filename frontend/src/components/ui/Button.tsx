"use client";

import type { ButtonHTMLAttributes } from "react";

import { cx } from "@/lib/cx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export function Button({
  className,
  variant = "secondary",
  size = "md",
  disabled,
  type,
  ...props
}: ButtonProps) {
  const isDisabled = Boolean(disabled);

  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium text-sm transition-all duration-200 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent select-none";

  const sizeClass = size === "sm" ? "px-3 py-1.5 text-[13px]" : "px-4 py-2";

  const variants: Record<Variant, string> = {
    primary:
      "bg-accent text-void border-transparent hover:bg-accent/90 shadow-sm hover:shadow-glow-accent active:scale-[0.98] font-semibold",
    secondary:
      "bg-panel/60 text-app-text border-edge/60 hover:bg-edge/50 hover:border-edge shine-top",
    ghost:
      "bg-transparent text-app-muted border-transparent hover:bg-[var(--app-hover-bg)] hover:text-app-text",
    danger:
      "bg-danger/10 text-danger border-danger/25 hover:bg-danger/20 hover:border-danger/40",
  };

  const disabledClass =
    "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none";

  return (
    <button
      type={type || "button"}
      disabled={isDisabled}
      className={cx(base, sizeClass, variants[variant], disabledClass, className)}
      {...props}
    />
  );
}
