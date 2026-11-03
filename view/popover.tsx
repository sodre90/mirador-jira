import { useEffect, useRef, useState, type ReactNode } from "react";

/** A button that opens a panel under it, closed by a click outside it or Escape. */
export function Popover({
  label,
  name,
  className = "",
  hint,
  children,
  align = "left",
}: {
  label: ReactNode;
  /** The button's accessible name, for a label that is only a symbol. */
  name?: string;
  className?: string;
  hint?: string;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    addEventListener("pointerdown", outside);
    addEventListener("keydown", escape, true);
    return () => {
      removeEventListener("pointerdown", outside);
      removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return (
    <span className="popover-root" ref={root}>
      <button type="button" className={`${className} ${open ? "open" : ""}`} aria-label={name} aria-expanded={open} data-hint={open ? undefined : hint} onClick={() => setOpen((was) => !was)}>
        {label}
      </button>
      {open && <div className={`popover ${align}`}>{children(() => setOpen(false))}</div>}
    </span>
  );
}

/** A list in a popover to pick from, with a filter box once it is long. */
export function PickList<Value extends string>({
  options,
  chosen,
  multiple,
  onChange,
  filterLabel,
  render,
}: {
  options: { value: Value; text: string }[];
  chosen: Value[];
  multiple: boolean;
  onChange(chosen: Value[]): void;
  filterLabel?: string;
  render?: (value: Value) => ReactNode;
}) {
  const [filter, setFilter] = useState("");
  const shown = options.filter(({ text }) => text.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (value: Value) => {
    if (!multiple) return onChange(chosen.includes(value) ? [] : [value]);
    onChange(chosen.includes(value) ? chosen.filter((each) => each !== value) : [...chosen, value]);
  };
  return (
    <div className="pick-list" role="listbox" aria-multiselectable={multiple}>
      {options.length > 7 && <input className="pick-filter" autoFocus placeholder={filterLabel ?? "Filter"} aria-label={filterLabel ?? "Filter"} value={filter} onChange={(event) => setFilter(event.target.value)} />}
      {shown.map(({ value, text }) => (
        <button type="button" role="option" aria-selected={chosen.includes(value)} key={value} className={chosen.includes(value) ? "picked" : ""} onClick={() => toggle(value)}>
          <span className="pick-mark">{chosen.includes(value) ? "✓" : ""}</span>
          {render ? render(value) : text}
        </button>
      ))}
      {shown.length === 0 && <p className="muted pick-none">Nothing matches.</p>}
    </div>
  );
}
