import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import "./Input.css";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  icon?: ReactNode;
  error?: string;
  /** Input type. Defaults to "text". */
  type?: "text" | "search" | "email" | "url" | "number" | "password";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, error, className, type = "text", ...rest },
  ref,
) {
  const classes = ["input"];
  if (icon) classes.push("input-icon-wrap");
  if (error) classes.push("error");
  if (className) classes.push(className);
  return (
    <div className="input-wrap">
      {icon ? <span className="input-icon" aria-hidden>{icon}</span> : null}
      <input ref={ref} type={type} className={classes.join(" ")} {...rest} />
      {error ? <span className="input-error-msg">{error}</span> : null}
    </div>
  );
});
