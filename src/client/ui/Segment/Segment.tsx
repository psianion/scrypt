import "./Segment.css";

export interface SegmentItem<T extends string> {
  value: T;
  label: string;
}

export interface SegmentProps<T extends string> {
  items: readonly SegmentItem<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
  ariaLabel?: string;
}

export function Segment<T extends string>({
  items,
  value,
  onChange,
  className,
  ariaLabel,
}: SegmentProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={["segment-control", className].filter(Boolean).join(" ")}
    >
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          type="button"
          aria-selected={item.value === value}
          data-active={item.value === value ? "true" : undefined}
          className="segment-item"
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
