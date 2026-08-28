/* MVP_TRAINER_V5_R12_5E_25_INTELLIGENCE_COMMAND_SURFACE */
import { useMemo, useState, type CSSProperties } from "react";
import type { MusicTrack } from "../../lib/musicStorage";
import { playMusicAdHocQueue, playMusicTrack, startMvpNeuralRadio, useMusicPlayer } from "../../lib/musicPlayer";
import { buildTasteMap, getSongDna, getWorkoutMusicStage, isAutoMixEnabled, listPrSoundtracks, setAutoMixEnabled } from "../../lib/musicIntelligence";
import { PlayPremiumIcon, SparkPremiumIcon } from "./premium/MusicLibraryPremiumIcons";

const CHANNELS = ["ENERGY", "HEAVY", "MELODIC", "DARK", "DRIVE", "WORKOUT FIT"] as const;

function pad(value: number) {
  return String(Math.max(0, Math.round(value))).padStart(2, "0");
}

export function MusicIntelligencePanel({ tracks }: { tracks: MusicTrack[] }) {
  const player = useMusicPlayer();
  const [autoMix, setAutoMix] = useState(() => isAutoMixEnabled());
  const [message, setMessage] = useState("");

  const likedTracks = useMemo(
    () => tracks.filter((track) => track.favorite).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [tracks],
  );
  const dna = useMemo(
    () => (player.currentTrack ? getSongDna(player.currentTrack) : null),
    [player.currentTrack?.id, player.currentTrack?.updated_at, player.currentTrack?.favorite, player.currentTrack?.play_less],
  );
  const tasteMap = useMemo(() => buildTasteMap(tracks), [tracks]);
  const prSoundtracks = listPrSoundtracks();
  const stage = getWorkoutMusicStage();
  const likedPercent = tracks.length ? Math.min(100, Math.round((likedTracks.length / tracks.length) * 100)) : 0;
  const currentTitle = player.currentTrack?.title || "No active track";
  const currentArtist = player.currentTrack?.artist || "Start playback to activate live analysis";
  const currentValues = dna
    ? [dna.energy, dna.heavy, dna.melodic, dna.dark, dna.drive, dna.workoutFit]
    : [0, 0, 0, 0, 0, 0];

  function toggleAutoMix() {
    const next = !autoMix;
    setAutoMix(next);
    setAutoMixEnabled(next);
    setMessage(next ? "AutoMix is active." : "AutoMix is paused.");
  }

  return (
    <section className="mvp25-intel" aria-label="MVP Music Intelligence">
      <header className="mvp25-intelHero">
        <div className="mvp25-intelIdentity">
          <span className="mvp25-kicker">MVP MUSIC INTELLIGENCE</span>
          <h2>Decision Engine</h2>
          <p>Your permanent taste, the live song and workout stage converge into the next-song decision.</p>
        </div>
        <div className="mvp25-intelStatus">
          <div><span>WORKOUT STAGE</span><strong>{stage === "off" ? "READY" : stage.toUpperCase()}</strong></div>
          <button type="button" className={autoMix ? "is-on" : ""} onClick={toggleAutoMix} aria-pressed={autoMix}>
            <span>AUTOMIX</span><strong>{autoMix ? "ACTIVE" : "OFF"}</strong><i aria-hidden><b /></i>
          </button>
        </div>
      </header>

      {message ? <div className="mvp25-intelMessage" role="status">{message}<button type="button" onClick={() => setMessage("")} aria-label="Dismiss">×</button></div> : null}

      <section className="mvp25-intelFlow" aria-label="Taste to decision flow">
        <article>
          <span>01 · YOUR TASTE</span>
          <strong>{likedTracks.length}</strong>
          <b>LIKED SONGS</b>
          <small>{likedPercent}% high-confidence library signal</small>
        </article>
        <i aria-hidden>›</i>
        <article className="is-current">
          <span>02 · CURRENT SONG</span>
          <strong className="is-title">{currentTitle}</strong>
          <b>{currentArtist}</b>
          <small>{dna ? "LIVE SIGNAL LOCKED" : "WAITING FOR PLAYBACK"}</small>
        </article>
        <i aria-hidden>›</i>
        <article>
          <span>03 · NEXT DECISION</span>
          <strong className="is-title">{autoMix ? (stage === "off" ? "LIBRARY FIT" : stage.toUpperCase()) : "MANUAL"}</strong>
          <b>{autoMix ? "PLAYER-LINKED TARGET" : "AUTOMIX PAUSED"}</b>
          <small>{autoMix ? "Steering and anti-repeat memory active" : "Enable AutoMix to resume steering"}</small>
        </article>
      </section>

      <section className="mvp25-intelSignal">
        <header><div><span className="mvp25-kicker">LIVE SONG DNA</span><h3>Signal Channels</h3></div><small className={dna ? "is-live" : ""}><i />{dna ? "LIVE" : "IDLE"}</small></header>
        <div className="mvp25-intelChannels">
          {CHANNELS.map((label, index) => {
            const value = currentValues[index];
            return <div key={label} style={{ ["--mvp25-value" as string]: `${Math.max(2, value)}%` } as CSSProperties}>
              <span>{label}</span><strong>{dna ? pad(value) : "--"}</strong><i aria-hidden><b /></i>
            </div>;
          })}
        </div>
      </section>

      <section className="mvp25-intelControl">
        <div className="mvp25-intelMemory">
          <span className="mvp25-kicker">TASTE MEMORY</span>
          <h3>{likedTracks.length} Liked Songs</h3>
          <p>Permanent high-confidence taste. Manual playlists remain untouched.</p>
          <div className="mvp25-confidence"><span>LIBRARY CONFIDENCE</span><i><b style={{ width: `${Math.max(3, likedPercent)}%` }} /></i><strong>{likedPercent}%</strong></div>
          <div className="mvp25-intelActions">
            <button type="button" disabled={!likedTracks.length} onClick={() => void playMusicAdHocQueue("Liked Songs", likedTracks)}><PlayPremiumIcon /><span>PLAY LIKED</span></button>
            <button type="button" disabled={!likedTracks.length} onClick={() => {
              const seed = likedTracks[0];
              if (!seed) return;
              const queue = startMvpNeuralRadio(seed.id, "more_like_this");
              setMessage(`Liked Radio ready · ${queue.length} tracks`);
            }}><SparkPremiumIcon /><span>LIKED RADIO</span></button>
          </div>
        </div>
        <div className="mvp25-intelTarget">
          <span className="mvp25-kicker">AUTOMIX TARGET</span>
          <h3>{dna ? "Player-linked steering" : "Waiting for a song"}</h3>
          <p>{dna ? "The active track is being scored against workout stage, taste memory, steering bias and recent-play history." : "Start playback to open the decision engine."}</p>
          <div className="mvp25-targetRail" aria-hidden><i /><b style={{ left: `${dna ? Math.max(7, Math.min(93, (dna.drive + dna.workoutFit) / 2)) : 50}%` }} /></div>
          <div className="mvp25-targetLabels"><span>HEAVIER</span><span>LIKE THIS</span><span>FASTER</span></div>
        </div>
      </section>

      <section className="mvp25-tasteField">
        <header><div><span className="mvp25-kicker">LIBRARY PROFILE</span><h3>Taste Field</h3><p>Five learned regions from the way your private library actually behaves.</p></div><small>{tracks.length} TRACKS ANALYZED</small></header>
        <div className="mvp25-tasteRows">
          {tasteMap.map((cluster, index) => (
            <button type="button" key={cluster.id} disabled={!cluster.tracks.length} onClick={() => void playMusicAdHocQueue(`Taste Field · ${cluster.label}`, cluster.tracks)} style={{ ["--mvp25-score" as string]: `${Math.max(5, cluster.score)}%` } as CSSProperties}>
              <span>{String(index + 1).padStart(2, "0")}</span><div><strong>{cluster.label}</strong><small>{cluster.subtitle}</small></div><b>{cluster.score}</b><i aria-hidden><em /></i>
            </button>
          ))}
        </div>
      </section>

      <section className={`mvp25-pr ${prSoundtracks.length ? "has-records" : "is-empty"}`}>
        <header><div><span className="mvp25-kicker">PERFORMANCE MEMORY</span><h3>PR Soundtrack</h3></div><b>{prSoundtracks.length}</b></header>
        {prSoundtracks.length ? <div>{prSoundtracks.slice(0, 12).map((record) => <article key={record.id}><div><strong>{record.title}</strong><span>{record.artist}</span><small>{record.exerciseName} · SET {record.setNumber} · {record.records.join(" + ")}</small></div><button type="button" onClick={() => void playMusicTrack(record.trackId, 0)} aria-label={`Play ${record.title}`}><PlayPremiumIcon /></button></article>)}</div> : <p>No PR soundtrack moments captured yet. This section will expand automatically when PR music history exists.</p>}
      </section>
    </section>
  );
}
