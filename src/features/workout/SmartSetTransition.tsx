import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./SmartSetTransition.css";

function useOverlayFocus(open: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; priorFocus?.focus(); };
  }, [open]);
  return ref;
}

function cleanWeight(value: number) {
  return String(Math.max(0, Math.round((Number.isFinite(value) ? value : 0) * 100) / 100));
}

export function SmartWeightKeypad({
  open, initialWeight, onCancel, onApply,
}: {
  open: boolean;
  initialWeight: number;
  onCancel: () => void;
  onApply: (weight: number) => Promise<void> | void;
}) {
  const [entry, setEntry] = useState(() => cleanWeight(initialWeight));
  const [replacing, setReplacing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const focusRef = useOverlayFocus(open);
  useEffect(() => {
    if (!open) return;
    setEntry(cleanWeight(initialWeight));
    setReplacing(true);
    setError("");
    setBusy(false);
  }, [open, initialWeight]);

  const press = (key: string) => {
    if (busy) return;
    setError("");
    if (key === "C") { setEntry("0"); setReplacing(true); return; }
    if (key === "⌫") { setEntry((value) => value.length <= 1 ? "0" : value.slice(0, -1)); setReplacing(false); return; }
    if (key === ".") { setEntry((value) => replacing ? "0." : value.includes(".") ? value : `${value}.`); setReplacing(false); return; }
    setEntry((value) => {
      if (replacing) return key;
      if (value.includes(".") && value.split(".")[1]?.length >= 2) return value;
      if (value.replace(/\D/g, "").length >= 6) return value;
      return value === "0" ? key : `${value}${key}`;
    });
    setReplacing(false);
  };
  const adjust = (delta: number) => {
    if (busy) return;
    setError("");
    setEntry(cleanWeight(Math.max(0, Number(entry || "0") + delta)));
    setReplacing(true);
  };
  const apply = async () => {
    if (busy) return;
    const weight = Number(entry);
    if (!(weight > 0) || !Number.isFinite(weight)) { setError("ENTER A WEIGHT ABOVE ZERO."); return; }
    setBusy(true); setError("");
    try { await onApply(Math.round(weight * 100) / 100); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "COULD NOT SAVE THE WEIGHT."); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (/^[0-9]$/.test(event.key)) { event.preventDefault(); press(event.key); }
      else if (event.key === ".") { event.preventDefault(); press("."); }
      else if (event.key === "Backspace") { event.preventDefault(); press("⌫"); }
      else if (event.key === "Delete") { event.preventDefault(); press("C"); }
      else if (event.key === "Enter") { event.preventDefault(); void apply(); }
      else if (event.key === "Escape" && !busy) { event.preventDefault(); onCancel(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  if (!open || typeof document === "undefined") return null;
  return createPortal(<div className="mvp-setOverlay is-keypad" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div ref={focusRef} tabIndex={-1} className="mvp-setDialog mvp-weightDialog" role="dialog" aria-modal="true" aria-label="Weight entry">
      <header className="mvp-setDialogHead"><span>MVP TRAINER PRO <small>WEIGHT ENTRY</small></span><button type="button" aria-label="Cancel weight entry" disabled={busy} onClick={onCancel}>×</button></header>
      <div className="mvp-weightDisplay"><span>SELECTED WEIGHT</span><strong aria-live="polite">{entry || "0"} <small>LB</small></strong><small>First number replaces the current weight</small></div>
      <div className="mvp-weightAdjust">{[-10,-5,-2.5,2.5,5,10].map((value) => <button key={value} type="button" disabled={busy} onClick={() => adjust(value)}>{value > 0 ? "+" : "−"}{Math.abs(value)}</button>)}</div>
      <div className="mvp-weightDigits">{["1","2","3","4","5","6","7","8","9","C","0","⌫"].map((value) => <button key={value} type="button" disabled={busy} aria-label={value === "C" ? "Clear weight" : value === "⌫" ? "Backspace" : value} onClick={() => press(value)}>{value}</button>)}<button className="is-decimal" type="button" disabled={busy} onClick={() => press(".")}>. DECIMAL</button></div>
      {error && <p className="mvp-setError" role="alert">{error}</p>}
      <footer className="mvp-setDialogActions"><button type="button" disabled={busy} onClick={onCancel}>CANCEL</button><button type="button" className="is-primary" disabled={busy || !(Number(entry) > 0)} onClick={() => void apply()}>{busy ? "SAVING…" : "APPLY WEIGHT"}</button></footer>
    </div>
  </div>, document.body);
}

export function SmartNextSetDialog({
  open, setNumber, totalSets, previous, suggestedWeight, instruction, repMin, repMax, onAccept, onManual, onDismiss,
}: {
  open: boolean;
  setNumber: number;
  totalSets: number;
  previous: { weight: number; reps: number; effort: string };
  suggestedWeight: number | null;
  instruction: string;
  repMin: number;
  repMax: number;
  onAccept: () => Promise<void> | void;
  onManual: () => void;
  onDismiss: () => void;
}) {
  const ref = useOverlayFocus(open);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setBusy(false); setError(""); } }, [open, setNumber]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) { event.preventDefault(); onDismiss(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onDismiss]);
  const accept = async () => {
    if (!(suggestedWeight != null && suggestedWeight > 0)) return;
    setBusy(true); setError("");
    try { await onAccept(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "COULD NOT APPLY THE WEIGHT."); }
    finally { setBusy(false); }
  };
  if (!open || typeof document === "undefined") return null;
  return createPortal(<div className="mvp-setOverlay is-next" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onDismiss(); }}>
    <div ref={ref} tabIndex={-1} className="mvp-setDialog mvp-nextDialog" role="dialog" aria-modal="true" aria-label={`Set ${setNumber} ready`}>
      <header className="mvp-setDialogHead"><span>MVP TRAINER PRO <small>PROGRESSION COACH</small></span><button type="button" disabled={busy} aria-label="Dismiss recommendation" onClick={onDismiss}>×</button></header>
      <div className="mvp-readyTitle"><span className="mvp-readyCheck">✓</span><h2>SET {setNumber} READY</h2><small>REST COMPLETE · SET {setNumber} OF {totalSets}</small></div>
      <section className="mvp-readyPrevious"><span>PREVIOUS SET</span><div><strong>{previous.weight} <small>LB</small></strong><strong>{previous.reps} <small>REPS</small></strong><strong>{previous.effort}</strong></div></section>
      <section className="mvp-readyAdvice"><span>COACH RECOMMENDATION</span>{suggestedWeight != null && suggestedWeight > 0 ? <strong className="mvp-readyWeight">{suggestedWeight} <small>LB</small></strong> : <strong className="mvp-readyUncertain">CHOOSE YOUR WEIGHT</strong>}<b>TARGET {repMin}–{repMax} REPS</b><p>{instruction || "Choose a controlled working weight and maintain clean technique."}</p><small>Actual reps are entered after you perform the set.</small></section>
      {error && <p className="mvp-setError" role="alert">{error}</p>}
      <footer className="mvp-setDialogActions is-stacked">{suggestedWeight != null && suggestedWeight > 0 && <button type="button" className="is-primary" disabled={busy} onClick={() => void accept()}>{busy ? "APPLYING…" : "ACCEPT WEIGHT & START SET"}</button>}<button type="button" disabled={busy} onClick={onManual}>ENTER MY OWN WEIGHT</button><button type="button" className="is-tertiary" disabled={busy} onClick={onDismiss}>VIEW ACTIVE SET</button></footer>
    </div>
  </div>, document.body);
}
