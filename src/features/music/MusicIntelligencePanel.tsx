import { useMemo, useState } from "react";
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

function reasonForCandidate(track: MusicTrack, current: MusicTrack, mode: ReturnType<typeof getActiveRadioMode>) {
  const dna = getSongDna(track);
  const currentDna = getSongDna(current);
  if (mode === "heavier") return `Heavier profile • ${dna.heavy} heavy • unplayed this cycle`;
  if (mode === "harder") return `Harder workout fit • ${dna.workoutFit} fit • unplayed this cycle`;
  if (mode === "faster") return `Higher drive • ${dna.drive} drive • unplayed this cycle`;
  if (mode === "melodic") return `More melodic • ${dna.melodic} melodic • unplayed this cycle`;
  if (mode === "darker") return `Darker profile • ${dna.dark} dark • unplayed this cycle`;
  if (mode === "surprise") return `Fresh contrast • ${dna.workoutFit} workout fit • unplayed this cycle`;
  const delta = Math.abs(dna.workoutFit - currentDna.workoutFit);
  return `Taste match • ${dna.workoutFit} workout fit • ${delta <= 12 ? "close energy" : "fresh variation"}`;
}

export function MusicIntelligencePanel({ tracks }: { tracks: MusicTrack[] }) {
  const player = useMusicPlayer();
  const [autoMix, setAutoMix] = useState(() => isAutoMixEnabled());
  const [message, setMessage] = useState("");
  const current = player.currentTrack;
  const mode = getActiveRadioMode();
  const stage = getWorkoutMusicStage();
  const cycle = useMemo(() => getPlaybackCycleStatus(tracks), [tracks, player.currentTrack?.id]);
  const candidates = useMemo(
    () => current ? getAdaptiveDecisionPreview(current, tracks, 3) : [],
    [current?.id, current?.updated_at, tracks, mode],
  );
  const liked = useMemo(() => tracks.filter((track) => track.favorite), [tracks]);
  const dna = current ? getSongDna(current) : null;
  const prSoundtracks = listPrSoundtracks();

  function toggleAutoMix() {
    const next = !autoMix;
    setAutoMix(next);
    setAutoMixEnabled(next);
    setMessage(next ? "AutoMix is active." : "AutoMix is paused.");
  }

  const why = current && dna ? [
    `${dna.workoutFit} workout-fit score`,
    stage === "off" ? "Library listening mode" : `${stage} workout stage`,
    current.favorite ? "Liked-song preference boost" : "Taste profile match",
    "Repeat protection confirmed",
  ] : [];

  return <section className="tr34-intel" aria-label="MVP Music Intelligence">
    <header className="tr34-intelHead">
      <div><span>MVP MUSIC INTELLIGENCE</span><h2>What MVP is doing right now</h2><p>See why the current song was chosen, what is influencing the next choice, and what remains before anything can repeat.</p></div>
      <button type="button" className={autoMix ? "is-active" : ""} onClick={toggleAutoMix} aria-pressed={autoMix}>
        <SparkPremiumIcon /><span>AutoMix</span><b>{autoMix ? "ACTIVE" : "OFF"}</b>
      </button>
    </header>

    {message ? <div className="tr34-intelMessage">{message}<button onClick={() => setMessage("")}>×</button></div> : null}

    <div className="tr34-intelNow">
      <article className="is-now">
        <span>NOW</span>
        <h3>{current?.title || "Nothing playing"}</h3>
        <p>{current?.artist || "Start a song to open the decision engine."}</p>
        <div className="tr34-intelTags"><b>{stage === "off" ? "READY" : stage.toUpperCase()}</b><b>{mode ? radioModeLabel(mode).toUpperCase() : "NO STEERING"}</b></div>
      </article>
      <article>
        <span>WHY</span>
        {why.length ? <ul>{why.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Playback data will explain the current decision here.</p>}
      </article>
      <article>
        <span>REPEAT PROTECTION</span>
        <strong>{cycle.remaining}</strong><h4>SONGS REMAINING</h4>
        <p>{cycle.played} played this cycle • {cycle.eligible} eligible</p>
        <small>Nothing repeats until the remaining eligible pool is exhausted.</small>
      </article>
    </div>

    <section className="tr34-intelNext">
      <header><div><span>NEXT DECISION</span><h3>Top candidates right now</h3></div><small>{mode ? `${radioModeLabel(mode)} steering active` : "Taste + workout fit"}</small></header>
      <div className="tr34-candidateGrid">
        {current && candidates.length ? candidates.map((entry, index) => <article key={entry.track.id}>
          <b>{String(index + 1).padStart(2, "0")}</b>
          <div><strong>{entry.track.title}</strong><span>{entry.track.artist || "Unknown Artist"}</span><small>{reasonForCandidate(entry.track, current, mode)}</small></div>
          <em>{Math.round(entry.score)}</em>
          <button type="button" onClick={() => void playMusicTrack(entry.track.id, 0)} aria-label={`Play ${entry.track.title}`}><PlayPremiumIcon /></button>
        </article>) : <div className="tr34-intelEmpty">Start an adaptive radio or Like Radio session to see live next-song candidates.</div>}
      </div>
    </section>

    <section className="tr34-intelInfluence">
      <article><span>ACTIVE STEERING</span><h3>{mode ? radioModeLabel(mode) : "None"}</h3><p>{mode ? "Steering ranks only songs that have not played in the current cycle." : "MVP is using workout fit, taste, variety and repeat protection."}</p></article>
      <article><span>WHAT MVP HAS LEARNED</span><h3>{liked.length} liked songs</h3><p>{liked.length ? "Liked tracks are a strong taste signal, but they cannot bypass repeat protection." : "Like songs to strengthen your permanent taste profile."}</p><button disabled={!liked.length} onClick={() => liked[0] && startMvpNeuralRadio(liked[0].id, "more_like_this")}><SparkPremiumIcon /><span>START LIKED RADIO</span></button></article>
      <article><span>PERFORMANCE MEMORY</span><h3>{prSoundtracks.length} PR moments</h3><p>{prSoundtracks.length ? "MVP can reconnect songs with your strongest training moments." : "PR soundtrack moments will appear automatically as you train."}</p>{prSoundtracks[0] ? <button onClick={() => void playMusicTrack(prSoundtracks[0].trackId, 0)}><PlayPremiumIcon /><span>PLAY LATEST PR</span></button> : null}</article>
    </section>

    {liked.length ? <button className="tr34-intelLiked" onClick={() => void playMusicAdHocQueue("Liked Songs", liked)}><PlayPremiumIcon /><span>PLAY LIKED SONGS</span></button> : null}
  </section>;
}
