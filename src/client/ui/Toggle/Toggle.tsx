import type { HTMLAttributes } from "react";
import "./Toggle.css";

export interface ToggleProps extends Omit<HTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, disabled, className, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-checked={checked ? "true" : undefined}
      className={["toggle", className].filter(Boolean).join(" ")}
      onClick={() => { if (!disabled) onChange(!checked); }}
      {...rest}
    >
      <span className="toggle-track" />
      <span className="toggle-thumb" />
    </button>
  );
}
