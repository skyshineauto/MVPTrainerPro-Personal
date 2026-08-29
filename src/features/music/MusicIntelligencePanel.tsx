import { useMemo, useState } from "react";
import { motion } from "motion/react";
import type { MusicTrack } from "../../lib/musicStorage";
import { playMusicTrack, useMusicPlayer } from "../../lib/musicPlayer";
import {
  getActiveRadioMode,
  getAdaptiveDecisionPreview,
  getPlaybackCycleStatus,
  getSongDna,
  getWorkoutMusicStage,
  isAutoMixEnabled,
  radioModeLabel,
  setAutoMixEnabled,
} from "../../lib/musicIntelligence";
import { PlayPremiumIcon, SparkPremiumIcon } from "./premium/MusicLibraryPremiumIcons";

function candidateReason(track: MusicTrack, current: MusicTrack, mode: ReturnType<typeof getActiveRadioMode>) {
  const dna = getSongDna(track);
  const base = getSongDna(current);
  if (mode === "heavier") return `Heavier • ${dna.heavy} heavy • unplayed`;
  if (mode === "harder") return `Harder • ${dna.workoutFit} workout fit • unplayed`;
  if (mode === "faster") return `Faster • ${dna.drive} drive • unplayed`;
  if (mode === "melodic") return `More melodic • ${dna.melodic} melodic • unplayed`;
  if (mode === "darker") return `Darker • ${dna.dark} dark • unplayed`;
  if (mode === "surprise") return `Fresh contrast • ${dna.workoutFit} workout fit • unplayed`;
  const delta = Math.abs(dna.workoutFit - base.workoutFit);
  return `${dna.workoutFit} workout fit • ${delta <= 12 ? "close energy" : "fresh variation"} • unplayed`;
}

export function MusicIntelligencePanel({ tracks }: { tracks: MusicTrack[] }) {
  const player = useMusicPlayer();
  const [autoMix, setAutoMix] = useState(() => isAutoMixEnabled());
  const current = player.currentTrack;
  const mode = getActiveRadioMode();
  const stage = getWorkoutMusicStage();
  const cycle = useMemo(() => getPlaybackCycleStatus(tracks), [tracks, player.currentTrack?.id]);
  const candidates = useMemo(() => current ? getAdaptiveDecisionPreview(current, tracks, 3) : [], [current?.id, current?.updated_at, tracks, mode]);
  const liked = useMemo(() => tracks.filter((track) => track.favorite), [tracks]);
  const dna = current ? getSongDna(current) : null;

  const why = current && dna ? [
    `${dna.workoutFit} workout fit`,
    stage === "off" ? "Library listening" : `${stage} stage`,
    current.favorite ? "Liked preference" : "Taste match",
    "Unplayed this cycle",
  ] : [];

  return <section className="m37-intel" aria-label="MVP Music Intelligence">
    <header className="m37-intelHead">
      <div><span>INTELLIGENCE</span><h2>Music Decision Engine</h2></div>
      <motion.button type="button" className={autoMix ? "is-active" : ""} aria-pressed={autoMix} onClick={() => { const next = !autoMix; setAutoMix(next); setAutoMixEnabled(next); }} whileTap={{scale:.97}}><SparkPremiumIcon/><b>AUTOMIX</b><span>{autoMix ? "ON" : "OFF"}</span></motion.button>
    </header>

    <section className="m37-intelFocus">
      <article className="m37-intelNow">
        <span>NOW</span>
        <h3>{current?.title || "Nothing playing"}</h3>
        <p>{current?.artist || "Start a song"}</p>
        <div>{stage !== "off" ? <b>{stage.toUpperCase()}</b> : null}<b>{mode ? radioModeLabel(mode).toUpperCase() : "NO STEERING"}</b></div>
      </article>
      <article className="m37-intelWhy">
        <span>WHY</span>
        {why.length ? <ul>{why.map(item => <li key={item}>{item}</li>)}</ul> : <p>Waiting for playback.</p>}
      </article>
    </section>

    <section className="m37-intelNext">
      <header><div><span>NEXT</span><h3>Top candidates</h3></div><b>{mode ? `${radioModeLabel(mode)} ACTIVE` : "TASTE + WORKOUT FIT"}</b></header>
      <div className="m37-intelCandidates">
        {current && candidates.length ? candidates.map((entry, index) => <motion.article key={entry.track.id} layout>
          <b className="m37-intelRank">{String(index+1).padStart(2,"0")}</b>
          <div className="m37-intelCandidateCopy"><strong>{entry.track.title}</strong><span>{entry.track.artist || "Unknown Artist"}</span><small>{candidateReason(entry.track,current,mode)}</small></div>
          <em>{Math.round(entry.score)}</em>
          <motion.button type="button" onClick={() => void playMusicTrack(entry.track.id,0)} aria-label={`Play ${entry.track.title}`} whileTap={{scale:.94}}><PlayPremiumIcon/></motion.button>
        </motion.article>) : <p className="m37-intelEmpty">No candidates yet.</p>}
      </div>
    </section>

    <section className="m37-intelStatus">
      <article><span>ACTIVE STEERING</span><strong>{mode ? radioModeLabel(mode) : "None"}</strong><small>{mode ? "Ranks remaining unplayed songs only" : "Taste, workout fit and variety"}</small></article>
      <article><span>REPEAT PROTECTION</span><strong>{cycle.remaining}</strong><small>{cycle.played} played • {cycle.eligible} eligible</small></article>
      <article><span>WHAT MVP LEARNED</span><strong>{liked.length} liked</strong><small>{liked.length ? "Likes shape taste without bypassing the cycle" : "Like songs to build your taste profile"}</small></article>
    </section>
  </section>;
}
