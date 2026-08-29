import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

type MenuPlacement = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  side: "top" | "bottom";
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
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex] || options[0];

  function measureMenu() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 10;
    const gap = 7;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const estimatedHeight = Math.min(360, Math.max(52, options.length * 46 + 12));
    const roomBelow = viewportHeight - rect.bottom - margin;
    const roomAbove = rect.top - margin;
    const side: MenuPlacement["side"] = roomBelow >= Math.min(estimatedHeight, 220) || roomBelow >= roomAbove ? "bottom" : "top";
    const maxHeight = Math.max(120, Math.min(360, side === "bottom" ? roomBelow - gap : roomAbove - gap));
    const width = Math.min(Math.max(rect.width, 190), viewportWidth - margin * 2);
    const left = Math.min(Math.max(margin, rect.left), Math.max(margin, viewportWidth - width - margin));
    const visibleHeight = Math.min(estimatedHeight, maxHeight);
    const top = side === "bottom"
      ? Math.min(viewportHeight - margin - visibleHeight, rect.bottom + gap)
      : Math.max(margin, rect.top - gap - visibleHeight);
    setPlacement({ left, top, width, maxHeight, side });
  }

  useLayoutEffect(() => {
    if (!open) return;
    measureMenu();
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onReposition = () => measureMenu();
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
  }, [open, selectedIndex]);

  function moveFocus(currentIndex: number, direction: 1 | -1) {
    if (!options.length) return;
    const next = (currentIndex + direction + options.length) % options.length;
    optionRefs.current[next]?.focus();
  }

  const menu = open && placement && typeof document !== "undefined" ? createPortal(
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        id={listId}
        role="listbox"
        className={`m37-selectMenu is-${placement.side}`}
        style={{
          position: "fixed",
          left: placement.left,
          top: placement.top,
          width: placement.width,
          maxHeight: placement.maxHeight,
          transformOrigin: placement.side === "bottom" ? "top center" : "bottom center",
        }}
        initial={{ opacity: 0, y: placement.side === "bottom" ? -6 : 6, scale: .985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: placement.side === "bottom" ? -4 : 4, scale: .99 }}
        transition={{ duration: .14, ease: [0.22, 1, 0.36, 1] }}
      >
        {options.map((option, index) => {
          const active = option.value === value;
          return <button
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
            <i aria-hidden>{active ? "✓" : ""}</i>
          </button>;
        })}
      </motion.div>
    </AnimatePresence>,
    document.body,
  ) : null;

  return <div ref={rootRef} className={`m37-select ${open ? "is-open" : ""} ${disabled ? "is-disabled" : ""} ${className}`.trim()}>
    {label ? <span className="m37-selectLabel">{label}</span> : null}
    <button
      ref={triggerRef}
      type="button"
      className="m37-selectTrigger"
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
      <span className="m37-selectValue">{selected?.label ?? String(value)}</span>
      <span className="m37-selectChevron" aria-hidden>⌄</span>
    </button>
    {menu}
  </div>;
}
