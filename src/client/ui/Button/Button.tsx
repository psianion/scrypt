import { forwardRef, type ButtonHTMLAttributes } from "react";
import "./Button.css";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "destructive"
  | "ai";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", loading = false, className, disabled, children, onClick, ...rest },
  ref,
) {
  const classes = ["btn", `btn-${variant}`];
  if (loading) classes.push("loading");
  if (className) classes.push(className);
  return (
    <button
      ref={ref}
      className={classes.join(" ")}
      disabled={disabled || loading}
      onClick={loading || disabled ? undefined : onClick}
      {...rest}
    >
      {children}
    </button>
  );
});
