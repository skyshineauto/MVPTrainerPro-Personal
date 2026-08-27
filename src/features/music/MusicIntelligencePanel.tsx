/* MVP_TRAINER_V5_R12_5E_22_HI_FIDELITY_INTELLIGENCE */
import { useMemo, useState, type CSSProperties } from "react";
import type { MusicTrack } from "../../lib/musicStorage";
import {
  playMusicAdHocQueue,
  playMusicTrack,
  startMvpNeuralRadio,
  useMusicPlayer,
} from "../../lib/musicPlayer";
import {
  buildTasteMap,
  getSongDna,
  getWorkoutMusicStage,
  isAutoMixEnabled,
  listPrSoundtracks,
  setAutoMixEnabled,
} from "../../lib/musicIntelligence";

const STEERING_BIASES = ["HARDER", "HEAVIER", "FASTER", "MORE LIKE THIS", "MELODIC", "DARKER", "SURPRISE"] as const;

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
  const currentTitle = player.currentTrack?.title || "No active track";
  const currentArtist = player.currentTrack?.artist || "Start playback to activate live analysis";
  const likedPercent = tracks.length ? Math.min(100, Math.round((likedTracks.length / tracks.length) * 100)) : 0;
  const workoutFit = dna?.workoutFit ?? 0;
  const drive = dna?.drive ?? 0;
  const melodic = dna?.melodic ?? 50;

  const toggleAutoMix = () => {
    const next = !autoMix;
    setAutoMix(next);
    setAutoMixEnabled(next);
    setMessage(next ? "AutoMix Flow enabled." : "AutoMix Flow disabled.");
  };

  return (
    <section className="mvp-v22-intel">
      <section className="mvp-v22-commandDeck">
        <div className="mvp-v22-commandCopy">
          <span className="mvp-v22-kicker">MVP MUSIC INTELLIGENCE</span>
          <h2>Neural Command</h2>
          <p>Taste memory, live song signal and workout context feed one decision engine.</p>
          <div className="mvp-v22-nowPlaying">
            <i className={player.playing ? "is-live" : ""}><b /></i>
            <div><small>LIVE INPUT</small><strong>{currentTitle}</strong><span>{currentArtist}</span></div>
          </div>
        </div>

        <div className="mvp-v22-enginePlate" aria-label="MVP decision engine status">
          <div className="mvp-v22-engineMark"><span>AI</span><i /></div>
          <div className="mvp-v22-engineText"><small>DECISION ENGINE</small><strong>{autoMix ? "ONLINE" : "MANUAL"}</strong><span>{player.playing ? "LIVE SIGNAL LOCKED" : "WAITING FOR PLAYBACK"}</span></div>
          <div className="mvp-v22-engineMeters"><i style={{ ["--m" as string]: `${Math.max(12, drive)}%` } as CSSProperties}><b /></i><i style={{ ["--m" as string]: `${Math.max(12, workoutFit)}%` } as CSSProperties}><b /></i><i style={{ ["--m" as string]: `${Math.max(12, melodic)}%` } as CSSProperties}><b /></i></div>
        </div>

        <div className="mvp-v22-telemetry">
          <div><span>WORKOUT STAGE</span><strong>{stage.toUpperCase()}</strong></div>
          <div><span>SIGNAL DRIVE</span><strong>{dna ? String(drive).padStart(2, "0") : "--"}</strong></div>
          <button type="button" className={autoMix ? "is-on" : ""} onClick={toggleAutoMix}><span><small>AUTOMIX</small><strong>{autoMix ? "ACTIVE" : "ENABLE"}</strong></span><i><b /></i></button>
        </div>
      </section>

      {message ? <div className="mvp-v22-message">{message}<button type="button" aria-label="Dismiss" onClick={() => setMessage("")}>×</button></div> : null}

      <section className="mvp-v22-decisionPath">
        <div className="mvp-v22-pathBlock is-memory"><span>TASTE MEMORY</span><strong>{likedTracks.length} LIKED</strong><small>{likedPercent}% library confidence</small></div>
        <div className="mvp-v22-pathLink"><i><b /></i><span>LEARNED SIGNAL</span></div>
        <div className="mvp-v22-pathBlock is-live"><span>LIVE SONG DNA</span><strong>{dna ? "SIGNAL LOCKED" : "WAITING"}</strong><small>{dna ? `${currentTitle} · ${currentArtist}` : "Play a song to analyze"}</small></div>
        <div className="mvp-v22-pathLink"><i><b /></i><span>DECISION VECTOR</span></div>
        <div className="mvp-v22-pathBlock is-target"><span>AUTOMIX TARGET</span><strong>{autoMix ? stage.toUpperCase() : "MANUAL"}</strong><small>{autoMix ? "Player-linked steering active" : "Enable AutoMix to steer"}</small></div>
      </section>

      <section className="mvp-v22-steering">
        <header><div><span>NEURAL STEERING</span><strong>PLAYER-LINKED VECTOR</strong></div><small><i />LINKED</small></header>
        <div className="mvp-v22-steeringRail"><i /><b style={{ left: `${dna ? Math.max(10, Math.min(90, (drive + melodic) / 2)) : 50}%` }} /></div>
        <div className="mvp-v22-steeringBiases">{STEERING_BIASES.map((bias, index) => <span key={bias} className={index === 3 ? "is-anchor" : ""}><i />{bias}</span>)}</div>
      </section>

      <section className="mvp-v22-signalBank">
        <header><div><span>LIVE SONG DNA</span><h3>Signal Bank</h3></div><small className={dna ? "is-live" : ""}><i />{dna ? "LIVE" : "IDLE"}</small></header>
        {dna ? <div className="mvp-v22-channels">{([
          ["ENERGY", dna.energy], ["HEAVY", dna.heavy], ["MELODIC", dna.melodic], ["DARK", dna.dark], ["DRIVE", dna.drive], ["WORKOUT FIT", dna.workoutFit],
        ] as Array<[string, number]>).map(([label, value]) => <div key={label} style={{ ["--value" as string]: `${value}%` } as CSSProperties}><span>{label}</span><strong>{String(value).padStart(2, "0")}</strong><i><b /></i></div>)}</div> : <div className="mvp-v22-idleSignal"><i /><span>PLAY A SONG TO OPEN THE LIVE SIGNAL BANK</span></div>}
      </section>

      <section className="mvp-v22-memoryDeck">
        <div className="mvp-v22-memoryCopy"><span>TASTE MEMORY</span><strong>{likedTracks.length}</strong><small>LIKED SONGS</small><p>Your permanent high-confidence taste signal. Manual playlists stay untouched.</p></div>
        <div className="mvp-v22-memoryMeter"><span>LIBRARY CONFIDENCE</span><i><b style={{ width: `${Math.max(3, likedPercent)}%` }} /></i><strong>{likedPercent}%</strong></div>
        <div className="mvp-v22-memoryActions"><button type="button" disabled={!likedTracks.length} onClick={() => void playMusicAdHocQueue("Liked Songs", likedTracks)}><i>▶</i><span><strong>PLAY LIKED</strong><small>Permanent collection</small></span></button><button type="button" disabled={!likedTracks.length} onClick={() => { const seed = likedTracks[0]; if (!seed) return; const queue = startMvpNeuralRadio(seed.id, "more_like_this"); setMessage(`Liked Radio • ${queue.length} library matches ready`); }}><i>∞</i><span><strong>LIKED RADIO</strong><small>Generate from taste</small></span></button></div>
      </section>

      <section className="mvp-v22-tasteField">
        <header><div><span>SONIC TERRITORY</span><h3>Taste Field</h3><p>Five learned regions from the way your private library actually behaves.</p></div><small>{tracks.length} TRACKS ANALYZED</small></header>
        <div className="mvp-v22-fieldPlane">
          <div className="mvp-v22-fieldSweep" aria-hidden />
          {tasteMap.map((cluster, index) => <button type="button" key={cluster.id} disabled={!cluster.tracks.length} className={index === 2 ? "is-current-zone" : ""} style={{ ["--score" as string]: `${Math.max(10, cluster.score)}%` } as CSSProperties} onClick={() => void playMusicAdHocQueue(`Taste Map • ${cluster.label}`, cluster.tracks)}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{cluster.label}</small><strong>{cluster.score}</strong><p>{cluster.subtitle}</p><i><b /></i></div></button>)}
        </div>
      </section>

      <section className={`mvp-v22-pr ${prSoundtracks.length ? "has-records" : "is-empty"}`}>
        <header><div><span>PERFORMANCE MEMORY</span><h3>PR Soundtrack</h3></div><b>{prSoundtracks.length}</b></header>
        {prSoundtracks.length ? <div className="mvp-v22-prRail">{prSoundtracks.slice(0, 12).map((record, index) => <article key={record.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{record.title}</strong><b>{record.artist}</b><small>{record.exerciseName} · SET {record.setNumber} · {record.records.join(" + ")}</small></div><button type="button" aria-label={`Play ${record.title}`} onClick={() => void playMusicTrack(record.trackId, 0)}>▶</button></article>)}</div> : <p>No PR soundtrack moments captured yet. This rail expands automatically when a PR lands while music is playing.</p>}
      </section>
    </section>
  );
}
