import { type ReactNode, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MorePremiumIcon } from "./MusicLibraryPremiumIcons";

export type MvpMusicTabValue = "songs" | "artists" | "albums" | "playlists" | "smart" | "intelligence" | "discover" | "audition";

export function MvpMusicTabs({ value, onChange }: { value: MvpMusicTabValue; onChange: (value: MvpMusicTabValue) => void }) {
  const tabs: Array<[MvpMusicTabValue, string]> = [
    ["songs", "SONGS"], ["artists", "ARTISTS"], ["albums", "ALBUMS"], ["playlists", "PLAYLISTS"],
    ["smart", "SMART MIX"], ["intelligence", "INTELLIGENCE"], ["discover", "DISCOVER"], ["audition", "AUDITION"],
  ];
  return <nav className="m36-tabs" aria-label="Music library sections">
    {tabs.map(([tab, label]) => <motion.button
      key={tab}
      type="button"
      data-music-tab={tab}
      className={value === tab ? "is-active" : ""}
      aria-current={value === tab ? "page" : undefined}
      onClick={() => onChange(tab)}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 560, damping: 40, mass: .35 }}
    ><span>{label}</span></motion.button>)}
  </nav>;
}

export type MvpDensity = "list" | "grid4" | "grid8" | "grid16";
export function MvpDensityPicker({ value, onChange, label }: { value: MvpDensity; onChange: (value: MvpDensity) => void; label: string }) {
  const items: Array<[MvpDensity, string]> = [["list", "LIST"], ["grid4", "4×4"], ["grid8", "8×8"], ["grid16", "16×16"]];
  return <div className="m36-density" role="group" aria-label={label}>
    {items.map(([mode, text]) => <motion.button
      type="button" key={mode} className={value === mode ? "is-active" : ""} aria-pressed={value === mode}
      onClick={() => onChange(mode)} whileTap={{ scale: .96 }}
    ><DensityGlyph mode={mode}/><span>{text}</span></motion.button>)}
  </div>;
}
function DensityGlyph({ mode }: { mode: MvpDensity }) {
  if (mode === "list") return <svg viewBox="0 0 20 20" aria-hidden><path d="M3 5h2M8 5h9M3 10h2M8 10h9M3 15h2M8 15h9"/></svg>;
  const count = mode === "grid4" ? 2 : mode === "grid8" ? 3 : 4;
  const cells = Array.from({ length: count * count });
  return <svg viewBox="0 0 20 20" aria-hidden>{cells.map((_, i) => { const x = 2 + (i % count) * (16 / count); const y = 2 + Math.floor(i / count) * (16 / count); const s = Math.max(2, 12 / count); return <rect key={i} x={x} y={y} width={s} height={s} rx=".6"/>; })}</svg>;
}

export function MvpAction({ icon, label, tone = "neutral", active = false, onClick, title, className = "" }: {
  icon: ReactNode; label: string; tone?: "neutral" | "green" | "red" | "blue" | "amber"; active?: boolean;
  onClick: () => void; title?: string; className?: string;
}) {
  return <motion.button type="button" className={`m36-action is-${tone} ${active ? "is-active" : ""} ${className}`.trim()}
    aria-pressed={active || undefined} onClick={onClick} title={title || label} whileTap={{ scale: .96 }}>
    <span className="m36-actionIcon">{icon}</span><span>{label}</span>
  </motion.button>;
}

export function MvpMoreMenu({ items, label = "MORE" }: { items: Array<{ label: string; icon: ReactNode; onClick: () => void; tone?: "neutral" | "green" | "red" | "blue" | "amber" }>; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key); };
  }, [open]);
  return <div className="m36-more" ref={ref}>
    <motion.button type="button" className={open ? "is-active" : ""} aria-expanded={open} onClick={() => setOpen(v => !v)} whileTap={{ scale: .96 }}>
      <MorePremiumIcon /><span>{label}</span>
    </motion.button>
    <AnimatePresence>{open ? <motion.div className="m36-moreMenu" initial={{opacity:0,y:-6,scale:.98}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:-4,scale:.985}} transition={{duration:.14}}>
      {items.map((item) => <button type="button" key={item.label} className={`is-${item.tone || "neutral"}`} onClick={() => { item.onClick(); setOpen(false); }}><span>{item.icon}</span><b>{item.label}</b></button>)}
    </motion.div> : null}</AnimatePresence>
  </div>;
}
