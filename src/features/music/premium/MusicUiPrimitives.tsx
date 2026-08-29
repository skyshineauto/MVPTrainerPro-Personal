import { type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

export type MvpMusicTabValue = "songs" | "artists" | "albums" | "playlists" | "smart" | "intelligence" | "discover" | "audition";

type TabSpec = {
  value: MvpMusicTabValue;
  label: string;
  accent: string;
  accentSoft: string;
};

const MUSIC_TABS: TabSpec[] = [
  { value: "songs", label: "SONGS", accent: "84 220 255", accentSoft: "25 117 196" },
  { value: "artists", label: "ARTISTS", accent: "130 154 255", accentSoft: "77 82 214" },
  { value: "albums", label: "ALBUMS", accent: "193 123 255", accentSoft: "122 64 196" },
  { value: "playlists", label: "PLAYLISTS", accent: "49 218 188", accentSoft: "16 119 123" },
  { value: "smart", label: "SMART MIX", accent: "255 173 61", accentSoft: "183 99 19" },
  { value: "intelligence", label: "INTELLIGENCE", accent: "79 221 255", accentSoft: "23 112 175" },
  { value: "discover", label: "DISCOVER", accent: "255 123 105", accentSoft: "168 57 59" },
  { value: "audition", label: "AUDITION", accent: "255 193 79", accentSoft: "178 105 16" },
];

function TabGlyph({ value }: { value: MvpMusicTabValue }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (value === "songs") return <svg viewBox="0 0 24 24" aria-hidden><path {...common} d="M9 18V6l10-2v12"/><circle {...common} cx="6.5" cy="18" r="2.5"/><circle {...common} cx="16.5" cy="16" r="2.5"/></svg>;
  if (value === "artists") return <svg viewBox="0 0 24 24" aria-hidden><circle {...common} cx="12" cy="8" r="3.2"/><path {...common} d="M5.5 19c.7-4 3-6 6.5-6s5.8 2 6.5 6"/></svg>;
  if (value === "albums") return <svg viewBox="0 0 24 24" aria-hidden><circle {...common} cx="12" cy="12" r="7.5"/><circle {...common} cx="12" cy="12" r="2"/><path {...common} d="M12 4.5v2M19.5 12h-2"/></svg>;
  if (value === "playlists") return <svg viewBox="0 0 24 24" aria-hidden><path {...common} d="M4 6h10M4 11h10M4 16h7M18 9v8"/><circle {...common} cx="15.7" cy="18" r="2.2"/></svg>;
  if (value === "smart") return <svg viewBox="0 0 24 24" aria-hidden><path {...common} d="m12 3 1.5 4.2L18 8.7l-4.5 1.6L12 15l-1.5-4.7L6 8.7l4.5-1.5L12 3Z"/><path {...common} d="m18.5 14 .8 2.1 2.2.8-2.2.8-.8 2.3-.8-2.3-2.2-.8 2.2-.8.8-2.1Z"/></svg>;
  if (value === "intelligence") return <svg viewBox="0 0 24 24" aria-hidden><path {...common} d="M8 5.5a4.3 4.3 0 0 1 8 2.1c2.3.5 3.4 3.3 2 5.1.7 2.2-1.1 4.5-3.3 4.5-.8 2.2-4 2.4-5.1.4-2.3.4-4.1-1.9-3.4-4.1-2-1.2-1.8-4.2.3-5.1A4.3 4.3 0 0 1 8 5.5Z"/><path {...common} d="M9 10.2h6M12 7.5v7.3"/></svg>;
  if (value === "discover") return <svg viewBox="0 0 24 24" aria-hidden><circle {...common} cx="12" cy="12" r="8"/><path {...common} d="m15.8 8.2-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1Z"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden><path {...common} d="M5 16.5V7.5M9 19V5M13 16V8M17 19V5M21 15V9"/></svg>;
}

export function MvpMusicTabs({ value, onChange }: { value: MvpMusicTabValue; onChange: (value: MvpMusicTabValue) => void }) {
  return <motion.nav className="m38-tabs" aria-label="Music library sections" layout>
    {MUSIC_TABS.map((item) => {
      const active = value === item.value;
      const style = {
        "--m38-tab-rgb": item.accent,
        "--m38-tab-deep-rgb": item.accentSoft,
      } as CSSProperties;
      return <motion.button
        key={item.value}
        type="button"
        data-music-tab={item.value}
        className={active ? "is-active" : ""}
        aria-current={active ? "page" : undefined}
        aria-label={item.label}
        onClick={() => onChange(item.value)}
        style={style}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.974, y: 1 }}
        transition={{ type: "spring", stiffness: 560, damping: 36, mass: .32 }}
      >
        <span className="m38-tabIcon"><TabGlyph value={item.value}/></span>
        <span className="m38-tabLabel">{item.label}</span>
        <span className="m38-tabSignal" aria-hidden><i/><i/><i/></span>
        <AnimatePresence initial={false}>
          {active ? <motion.span
            className="m38-tabActive"
            layoutId="m38-tab-active"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 44 }}
            aria-hidden
          /> : null}
        </AnimatePresence>
      </motion.button>;
    })}
  </motion.nav>;
}

export type MvpDensity = "list" | "grid4" | "grid8" | "grid16";
export function MvpDensityPicker({ value, onChange, label }: { value: MvpDensity; onChange: (value: MvpDensity) => void; label: string }) {
  const items: Array<[MvpDensity, string]> = [["list", "LIST"], ["grid4", "4×4"], ["grid8", "8×8"], ["grid16", "16×16"]];
  return <div className="m38-density" role="group" aria-label={label}>
    {items.map(([mode, text]) => {
      const active = value === mode;
      return <motion.button
        type="button"
        key={mode}
        className={active ? "is-active" : ""}
        aria-pressed={active}
        onClick={() => onChange(mode)}
        whileHover={{ y: -1 }}
        whileTap={{ scale: .965 }}
      >
        <DensityGlyph mode={mode}/><span>{text}</span>{active ? <motion.i layoutId="m38-density-active"/> : null}
      </motion.button>;
    })}
  </div>;
}

function DensityGlyph({ mode }: { mode: MvpDensity }) {
  if (mode === "list") return <svg viewBox="0 0 20 20" aria-hidden><path d="M3 5h2M8 5h9M3 10h2M8 10h9M3 15h2M8 15h9"/></svg>;
  const count = mode === "grid4" ? 2 : mode === "grid8" ? 3 : 4;
  const cells = Array.from({ length: count * count });
  return <svg viewBox="0 0 20 20" aria-hidden>{cells.map((_, i) => {
    const gap = 1.5;
    const usable = 16 - gap * (count - 1);
    const size = usable / count;
    const x = 2 + (i % count) * (size + gap);
    const y = 2 + Math.floor(i / count) * (size + gap);
    return <rect key={i} x={x} y={y} width={size} height={size} rx=".7"/>;
  })}</svg>;
}

export function MvpAction({ icon, label, tone = "neutral", active = false, onClick, title, className = "" }: {
  icon: ReactNode;
  label: string;
  tone?: "neutral" | "green" | "red" | "blue" | "amber";
  active?: boolean;
  onClick: () => void;
  title?: string;
  className?: string;
}) {
  return <motion.button
    type="button"
    className={`m38-action is-${tone} ${active ? "is-active" : ""} ${className}`.trim()}
    aria-pressed={active || undefined}
    onClick={onClick}
    title={title || label}
    whileHover={{ y: -1 }}
    whileTap={{ scale: .965, y: 1 }}
    transition={{ type: "spring", stiffness: 620, damping: 38, mass: .28 }}
  >
    <span className="m38-actionGlow" aria-hidden/>
    <span className="m38-actionIcon">{icon}</span>
    <span className="m38-actionLabel">{label}</span>
  </motion.button>;
}

export function MvpPrimaryAction({ icon, children, onClick, disabled = false, className = "" }: {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return <motion.button
    type="button"
    className={`m38-primaryAction ${className}`.trim()}
    disabled={disabled}
    onClick={onClick}
    whileHover={disabled ? undefined : { y: -1 }}
    whileTap={disabled ? undefined : { scale: .975, y: 1 }}
    transition={{ type: "spring", stiffness: 600, damping: 39, mass: .3 }}
  ><span className="m38-primarySheen" aria-hidden/>{icon ? <span className="m38-primaryIcon">{icon}</span> : null}<b>{children}</b><span className="m38-primaryArrow" aria-hidden>›</span></motion.button>;
}
