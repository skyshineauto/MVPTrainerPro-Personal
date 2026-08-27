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

      <style>{`
        .mvpPremiumSelect{position:relative;min-width:0;display:grid;gap:7px;z-index:22}
        .mvpPremiumSelect.is-open{z-index:10020}
        .mvpPremiumSelectLabel{font-size:7px;font-weight:1000;letter-spacing:.13em;color:#91a9b3}
        .mvpPremiumSelectTrigger{width:100%;min-height:44px;padding:0 13px;display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid rgba(86,185,216,.22);border-radius:10px;background:#050f14;color:#eefbff;box-shadow:inset 0 1px rgba(255,255,255,.035),0 8px 18px rgba(0,0,0,.13);cursor:pointer;text-align:left;transition:filter .16s ease,border-color .16s ease,box-shadow .16s ease,transform .16s ease}
        .mvpPremiumSelectTrigger:hover,.mvpPremiumSelect.is-open .mvpPremiumSelectTrigger{filter:brightness(1.17);border-color:rgba(84,218,255,.48);box-shadow:inset 0 1px rgba(255,255,255,.08),0 0 24px rgba(55,206,247,.09),0 10px 22px rgba(0,0,0,.16)}
        .mvpPremiumSelectTrigger:active{transform:translateY(1px)}
        .mvpPremiumSelectValue{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:900;letter-spacing:-.01em}
        .mvpPremiumSelectChevron{width:25px;height:25px;display:grid;place-items:center;flex:0 0 25px;border-radius:7px;border:1px solid rgba(91,193,224,.13);background:rgba(5,19,25,.88)}
        .mvpPremiumSelectChevron i{width:8px;height:8px;border-right:2px solid #8ee9ff;border-bottom:2px solid #8ee9ff;transform:translateY(-2px) rotate(45deg);transition:transform .16s ease}
        .mvpPremiumSelect.is-open .mvpPremiumSelectChevron i{transform:translateY(2px) rotate(225deg)}
        .mvpPremiumSelectMenu{position:absolute;left:0;right:0;top:calc(100% + 7px);max-height:min(310px,55vh);overflow:auto;padding:6px;border:1px solid rgba(82,199,235,.25);border-radius:12px;background:#030a0e;box-shadow:0 24px 65px rgba(0,0,0,.58),inset 0 1px rgba(255,255,255,.04);backdrop-filter:blur(24px);scrollbar-width:thin;scrollbar-color:#1f5364 #061219}
        .mvpPremiumSelectMenu>button{width:100%;min-height:43px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid transparent;border-radius:8px;background:transparent;color:#9db6bf;cursor:pointer;text-align:left;transition:background .14s ease,border-color .14s ease,color .14s ease,box-shadow .14s ease}
        .mvpPremiumSelectMenu>button>span{display:grid;gap:2px;min-width:0}
        .mvpPremiumSelectMenu strong{font-size:9px;color:inherit;font-weight:900}
        .mvpPremiumSelectMenu small{font-size:6px;color:#617b85}
        .mvpPremiumSelectMenu>button>i{width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:#38505a}
        .mvpPremiumSelectMenu>button:hover,.mvpPremiumSelectMenu>button:focus-visible{outline:0;color:#f2fcff;border-color:rgba(81,213,251,.26);background:#07171e;box-shadow:inset 2px 0 #42d8ff}
        .mvpPremiumSelectMenu>button.is-selected{color:#eaffff;border-color:rgba(76,219,255,.32);background:#081820;box-shadow:inset 2px 0 #48dcff,0 0 18px rgba(55,210,249,.06)}
        .mvpPremiumSelectMenu>button.is-selected>i{background:#63e6ff;box-shadow:0 0 10px rgba(80,222,255,.48)}
        .mvpPremiumSelect.is-disabled{opacity:.42}.mvpPremiumSelect.is-disabled .mvpPremiumSelectTrigger{cursor:default}
        @media(max-width:650px){.mvpPremiumSelect{width:100%}.mvpPremiumSelectTrigger{min-height:52px;padding:0 14px}.mvpPremiumSelectValue{font-size:11px}.mvpPremiumSelectMenu{max-height:48vh}.mvpPremiumSelectMenu>button{min-height:49px}.mvpPremiumSelectMenu strong{font-size:10px}}
        @media(hover:none){.mvpPremiumSelectTrigger:hover{filter:none}.mvpPremiumSelectTrigger:active{filter:brightness(1.14);transform:scale(.99)}.mvpPremiumSelectMenu>button:hover{background:transparent}}
      `}</style>
    </div>
  );
}
