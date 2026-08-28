import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

export type MusicPremiumSelectOption<T extends string | number> = {
  value: T;
  label: string;
  hint?: string;
};

type Props<T extends string | number> = {
  label?: string;
  value: T;
  options: Array<MusicPremiumSelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

export function MusicPremiumSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = "",
  ariaLabel,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex] || options[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
  }, [open, selectedIndex]);

  function moveFocus(currentIndex: number, direction: 1 | -1) {
    if (!options.length) return;
    const next = (currentIndex + direction + options.length) % options.length;
    optionRefs.current[next]?.focus();
  }

  return (
    <div ref={rootRef} className={`mvpPremiumSelect ${open ? "is-open" : ""} ${disabled ? "is-disabled" : ""} ${className}`.trim()}>
      {label ? <span className="mvpPremiumSelectLabel">{label}</span> : null}
      <button
        ref={triggerRef}
        type="button"
        className="mvpPremiumSelectTrigger"
        aria-label={ariaLabel || label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="mvpPremiumSelectValue">{selected?.label ?? String(value)}</span>
        <span className="mvpPremiumSelectChevron" aria-hidden><i /></span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id={listId}
            role="listbox"
            className="mvpPremiumSelectMenu"
            initial={{ opacity: 0, y: -5, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
          >
            {options.map((option, index) => {
              const active = option.value === value;
              return (
                <button
                  key={String(option.value)}
                  ref={(node) => { optionRefs.current[index] = node; }}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={active ? "is-selected" : ""}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    requestAnimationFrame(() => triggerRef.current?.focus());
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(index, 1); }
                    if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(index, -1); }
                    if (event.key === "Home") { event.preventDefault(); optionRefs.current[0]?.focus(); }
                    if (event.key === "End") { event.preventDefault(); optionRefs.current[options.length - 1]?.focus(); }
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onChange(option.value);
                      setOpen(false);
                      requestAnimationFrame(() => triggerRef.current?.focus());
                    }
                  }}
                >
                  <span><strong>{option.label}</strong>{option.hint ? <small>{option.hint}</small> : null}</span>
                  <i aria-hidden />
                </button>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
