import { useMemo, useState } from "react";
import { motion } from "motion/react";
import type { MusicTrack } from "../../lib/musicStorage";
import { playMusicAdHocQueue, playMusicTrack, startMvpNeuralRadio, useMusicPlayer } from "../../lib/musicPlayer";
import {
  getActiveRadioMode,
  getAdaptiveDecisionPreview,
  getPlaybackCycleStatus,
  getSongDna,
  getWorkoutMusicStage,
  isAutoMixEnabled,
  listPrSoundtracks,
  radioModeLabel,
  setAutoMixEnabled,
} from "../../lib/musicIntelligence";
import { PlayPremiumIcon, SparkPremiumIcon } from "./premium/MusicLibraryPremiumIcons";

function candidateReason(track: MusicTrack, current: MusicTrack, mode: ReturnType<typeof getActiveRadioMode>) {
  const dna = getSongDna(track);
  const base = getSongDna(current);
  if (mode === "heavier") return `Heavier profile • ${dna.heavy} heavy • not played this cycle`;
  if (mode === "harder") return `Hard workout fit • ${dna.workoutFit} fit • not played this cycle`;
  if (mode === "faster") return `Higher drive • ${dna.drive} drive • not played this cycle`;
  if (mode === "melodic") return `More melodic • ${dna.melodic} melodic • not played this cycle`;
  if (mode === "darker") return `Darker profile • ${dna.dark} dark • not played this cycle`;
  if (mode === "surprise") return `Fresh contrast • ${dna.workoutFit} workout fit • not played this cycle`;
  const delta = Math.abs(dna.workoutFit - base.workoutFit);
  return `${dna.workoutFit} workout fit • ${delta <= 12 ? "close energy" : "fresh variation"} • not played this cycle`;
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
  const pr = listPrSoundtracks();

  const why = current && dna ? [
    `${dna.workoutFit} workout-fit score`,
    stage === "off" ? "Library listening mode" : `${stage} workout stage`,
    current.favorite ? "Liked-song preference boost" : "Taste profile match",
    "Repeat protection confirmed",
  ] : [];

  return <section className="m36-intel" aria-label="MVP Music Intelligence">
    <header className="m36-intelHero">
      <div><span>MVP MUSIC INTELLIGENCE</span><h2>What MVP is doing right now</h2><p>See the current choice, why it was made, what is next, and when a song can repeat.</p></div>
      <motion.button type="button" className={autoMix ? "is-active" : ""} aria-pressed={autoMix} onClick={() => { const next = !autoMix; setAutoMix(next); setAutoMixEnabled(next); }} whileTap={{scale:.97}}><SparkPremiumIcon/><span>AutoMix</span><b>{autoMix ? "ACTIVE" : "OFF"}</b></motion.button>
    </header>

    <div className="m36-intelPrimary">
      <article className="m36-intelNow"><span>NOW</span><h3>{current?.title || "Nothing playing"}</h3><p>{current?.artist || "Start a song to open the decision engine."}</p><div>{stage !== "off" ? <b>{stage.toUpperCase()}</b> : null}<b>{mode ? radioModeLabel(mode).toUpperCase() : "NO STEERING"}</b></div></article>
      <article className="m36-intelWhy"><span>WHY</span>{why.length ? <ul>{why.map(item => <li key={item}>✓ {item}</li>)}</ul> : <p>Playback data will explain the decision here.</p>}</article>
      <article className="m36-intelCycle"><span>REPEAT PROTECTION</span><strong>{cycle.remaining}</strong><h4>SONGS REMAINING</h4><p>{cycle.played} played this cycle • {cycle.eligible} eligible</p><small>No song repeats until the eligible pool is exhausted.</small></article>
    </div>

    <section className="m36-intelNext">
      <header><div><span>NEXT DECISION</span><h3>Top candidates right now</h3></div><small>{mode ? `${radioModeLabel(mode)} steering active` : "Taste + workout fit"}</small></header>
      <div className="m36-intelCandidates">
        {current && candidates.length ? candidates.map((entry, index) => <article key={entry.track.id}>
          <b>{String(index+1).padStart(2,"0")}</b>
          <div><strong>{entry.track.title}</strong><span>{entry.track.artist || "Unknown Artist"}</span><small>{candidateReason(entry.track,current,mode)}</small></div>
          <em>{Math.round(entry.score)}</em>
          <motion.button type="button" onClick={() => void playMusicTrack(entry.track.id,0)} aria-label={`Play ${entry.track.title}`} whileTap={{scale:.94}}><PlayPremiumIcon/></motion.button>
        </article>) : <p className="m36-intelEmpty">Start an adaptive radio or Like Radio session to see live next-song candidates.</p>}
      </div>
    </section>

    <section className="m36-intelSupport">
      <article><span>ACTIVE STEERING</span><h3>{mode ? radioModeLabel(mode) : "None"}</h3><p>{mode ? "Steering ranks only unplayed tracks. Repeat protection cannot be bypassed." : "MVP is balancing workout fit, taste, variety and repeat protection."}</p></article>
      <article><span>WHAT MVP HAS LEARNED</span><h3>{liked.length} liked songs</h3><p>{liked.length ? "Liked tracks shape your taste profile while the cycle still protects variety." : "Like songs to strengthen your permanent taste profile."}</p>{liked[0] ? <button onClick={() => startMvpNeuralRadio(liked[0].id,"more_like_this")}><SparkPremiumIcon/><b>START LIKED RADIO</b></button> : null}</article>
      <article><span>PERFORMANCE MEMORY</span><h3>{pr.length} PR moments</h3><p>{pr.length ? "MVP can reconnect songs with your strongest training moments." : "PR soundtrack moments will appear automatically as you train."}</p>{pr[0] ? <button onClick={() => void playMusicTrack(pr[0].trackId,0)}><PlayPremiumIcon/><b>PLAY LATEST PR</b></button> : null}</article>
    </section>
    {liked.length ? <button className="m36-intelLiked" onClick={() => void playMusicAdHocQueue("Liked Songs", liked)}><PlayPremiumIcon/><span>PLAY LIKED SONGS</span></button> : null}
  </section>;
}
