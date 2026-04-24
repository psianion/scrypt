import type { HTMLAttributes, MouseEvent, ReactNode } from "react";
import "./Chip.css";

export type ChipVariant = "default" | "tag" | "status-done" | "status-review" | "status-blocked" | "status-ai";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant;
  onRemove?: () => void;
  removeLabel?: string;
}

export function Chip({
  variant = "default",
  onRemove,
  removeLabel = "Remove",
  className,
  children,
  ...rest
}: ChipProps) {
  const classes = ["chip"];
  if (variant !== "default") classes.push(`chip-${variant}`);
  if (className) classes.push(className);
  const onRemoveClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onRemove?.();
  };
  return (
    <span className={classes.join(" ")} {...rest}>
      {children}
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          className="chip-remove"
          onClick={onRemoveClick}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  children?: ReactNode;
}
export function Pill({ className, ...rest }: PillProps) {
  return <span className={["pill", className].filter(Boolean).join(" ")} {...rest} />;
}

export interface KbdProps extends HTMLAttributes<HTMLSpanElement> {}
export function Kbd({ className, ...rest }: KbdProps) {
  return <span className={["kbd", className].filter(Boolean).join(" ")} {...rest} />;
}

export type TierKind = "connected" | "mentions" | "semantic";
export interface TierChipProps extends HTMLAttributes<HTMLSpanElement> {
  tier: TierKind;
}
export function TierChip({ tier, className, ...rest }: TierChipProps) {
  return (
    <span
      className={["tier-chip", `tier-${tier}`, className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
