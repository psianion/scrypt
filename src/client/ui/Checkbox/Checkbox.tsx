import type { HTMLAttributes } from "react";
import "./Checkbox.css";

export interface CheckboxProps extends Omit<HTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, disabled, className, ...rest }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      data-checked={checked ? "true" : undefined}
      className={["checkbox", className].filter(Boolean).join(" ")}
      onClick={() => { if (!disabled) onChange(!checked); }}
      {...rest}
    >
      {checked ? (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M2 5.5l2 2 4-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </button>
  );
}
