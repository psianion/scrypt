import type { HTMLAttributes, ReactNode } from "react";
import "./Warning.css";

export interface WarningProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
}

export function Warning({ icon = "⚠", className, children, ...rest }: WarningProps) {
  return (
    <div className={["warning-block", className].filter(Boolean).join(" ")} {...rest}>
      <span className="warning-block-icon" aria-hidden>{icon}</span>
      <span>{children}</span>
    </div>
  );
}
