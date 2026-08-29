import { type ReactNode } from "react";
import { motion } from "motion/react";

export type MvpMusicTabValue = "songs" | "artists" | "albums" | "playlists" | "smart" | "intelligence" | "discover" | "audition";

const MUSIC_TABS: Array<[MvpMusicTabValue, string]> = [
  ["songs", "SONGS"], ["artists", "ARTISTS"], ["albums", "ALBUMS"], ["playlists", "PLAYLISTS"],
  ["smart", "SMART MIX"], ["intelligence", "INTELLIGENCE"], ["discover", "DISCOVER"], ["audition", "AUDITION"],
];

export function MvpMusicTabs({ value, onChange }: { value: MvpMusicTabValue; onChange: (value: MvpMusicTabValue) => void }) {
  return <nav className="m37-tabs" aria-label="Music library sections">
    {MUSIC_TABS.map(([tab, label]) => {
      const active = value === tab;
      return <motion.button
        key={tab}
        type="button"
        data-music-tab={tab}
        className={active ? "is-active" : ""}
        aria-current={active ? "page" : undefined}
        onClick={() => onChange(tab)}
        whileTap={{ scale: 0.975 }}
        transition={{ type: "spring", stiffness: 620, damping: 42, mass: .32 }}
      >
        <span>{label}</span>
        {active ? <motion.i layoutId="m37-tab-active" aria-hidden transition={{ type: "spring", stiffness: 500, damping: 42 }} /> : null}
      </motion.button>;
    })}
  </nav>;
}

export type MvpDensity = "list" | "grid4" | "grid8" | "grid16";
export function MvpDensityPicker({ value, onChange, label }: { value: MvpDensity; onChange: (value: MvpDensity) => void; label: string }) {
  const items: Array<[MvpDensity, string]> = [["list", "LIST"], ["grid4", "4×4"], ["grid8", "8×8"], ["grid16", "16×16"]];
  return <div className="m37-density" role="group" aria-label={label}>
    {items.map(([mode, text]) => {
      const active = value === mode;
      return <motion.button
        type="button"
        key={mode}
        className={active ? "is-active" : ""}
        aria-pressed={active}
        onClick={() => onChange(mode)}
        whileTap={{ scale: .965 }}
      >
        <DensityGlyph mode={mode}/><span>{text}</span>
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
    className={`m37-action is-${tone} ${active ? "is-active" : ""} ${className}`.trim()}
    aria-pressed={active || undefined}
    onClick={onClick}
    title={title || label}
    whileTap={{ scale: .955 }}
    transition={{ type: "spring", stiffness: 650, damping: 38, mass: .28 }}
  >
    <span className="m37-actionIcon">{icon}</span><span className="m37-actionLabel">{label}</span>
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
    className={`m37-primaryAction ${className}`.trim()}
    disabled={disabled}
    onClick={onClick}
    whileTap={disabled ? undefined : { scale: .97 }}
    transition={{ type: "spring", stiffness: 620, damping: 40, mass: .3 }}
  >{icon ? <span>{icon}</span> : null}<b>{children}</b></motion.button>;
}
