/* MVP_TRAINER_V5_R12_5E_23_PRECISION_INTELLIGENCE */
import { useMemo, useState, type CSSProperties } from "react";
import type { MusicTrack } from "../../lib/musicStorage";
import { playMusicAdHocQueue, playMusicTrack, startMvpNeuralRadio, useMusicPlayer } from "../../lib/musicPlayer";
import { buildTasteMap, getSongDna, getWorkoutMusicStage, isAutoMixEnabled, listPrSoundtracks, setAutoMixEnabled } from "../../lib/musicIntelligence";

const STEERING_BIASES = ["HARDER", "HEAVIER", "FASTER", "MORE LIKE THIS", "MELODIC", "DARKER", "SURPRISE"] as const;

export function MusicIntelligencePanel({ tracks }: { tracks: MusicTrack[] }) {
  const player = useMusicPlayer();
  const [autoMix, setAutoMix] = useState(() => isAutoMixEnabled());
  const [message, setMessage] = useState("");
  const likedTracks = useMemo(() => tracks.filter((track) => track.favorite).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()), [tracks]);
  const dna = useMemo(() => player.currentTrack ? getSongDna(player.currentTrack) : null, [player.currentTrack?.id, player.currentTrack?.updated_at, player.currentTrack?.favorite, player.currentTrack?.play_less]);
  const tasteMap = useMemo(() => buildTasteMap(tracks), [tracks]);
  const prSoundtracks = listPrSoundtracks();
  const stage = getWorkoutMusicStage();
  const currentTitle = player.currentTrack?.title || "No active track";
  const currentArtist = player.currentTrack?.artist || "Start playback to activate live analysis";
  const likedPercent = tracks.length ? Math.min(100, Math.round((likedTracks.length / tracks.length) * 100)) : 0;
  const drive = dna?.drive ?? 0;
  const melodic = dna?.melodic ?? 50;
  const steeringPosition = dna ? Math.max(8, Math.min(92, (drive + melodic) / 2)) : 50;

  const toggleAutoMix = () => {
    const next = !autoMix;
    setAutoMix(next);
    setAutoMixEnabled(next);
    setMessage(next ? "AutoMix Flow enabled." : "AutoMix Flow disabled.");
  };

  return <section className="mvp-v23-intel">
    <section className="mvp-v23-command">
      <div className="mvp-v23-commandIdentity">
        <span>MVP MUSIC INTELLIGENCE</span>
        <h2>Neural Command</h2>
        <p>Your taste, the live track and workout state feed one decision path.</p>
        <div className="mvp-v23-liveTrack"><i className={player.playing ? "is-live" : ""}><b /></i><div><small>LIVE INPUT</small><strong>{currentTitle}</strong><span>{currentArtist}</span></div></div>
      </div>
      <div className="mvp-v23-commandSignal">
        <span>DECISION SIGNAL</span>
        <strong>{dna ? String(drive).padStart(2, "0") : "--"}</strong>
        <i style={{ ["--signal" as string]: `${Math.max(8, drive)}%` } as CSSProperties}><b /></i>
        <small>{dna ? "LIVE SONG DNA LOCKED" : "WAITING FOR PLAYBACK"}</small>
      </div>
      <div className="mvp-v23-commandState">
        <div><span>WORKOUT STAGE</span><strong>{stage.toUpperCase()}</strong></div>
        <button type="button" className={autoMix ? "is-on" : ""} onClick={toggleAutoMix}><span><small>AUTOMIX</small><strong>{autoMix ? "ACTIVE" : "ENABLE"}</strong></span><i><b /></i></button>
      </div>
    </section>

    {message ? <div className="mvp-v23-message">{message}<button type="button" onClick={() => setMessage("")} aria-label="Dismiss">×</button></div> : null}

    <section className="mvp-v23-path" aria-label="Music intelligence decision path">
      <div><span>01</span><small>YOUR TASTE</small><strong>{likedTracks.length} LIKED SONGS</strong><p>{likedPercent}% learned library confidence</p></div>
      <i><b /></i>
      <div><span>02</span><small>CURRENT SONG</small><strong>{dna ? "SIGNAL LOCKED" : "WAITING"}</strong><p>{dna ? currentTitle : "Play a song to analyze"}</p></div>
      <i><b /></i>
      <div><span>03</span><small>NEXT DECISION</small><strong>{autoMix ? stage.toUpperCase() : "MANUAL"}</strong><p>{autoMix ? "Player-linked steering active" : "Enable AutoMix to steer"}</p></div>
    </section>

    <section className="mvp-v23-signalBank">
      <header><div><span>LIVE ANALYSIS</span><h3>Signal Channels</h3></div><small className={dna ? "is-live" : ""}><i />{dna ? "LIVE" : "IDLE"}</small></header>
      {dna ? <div className="mvp-v23-channels">{([['ENERGY', dna.energy], ['HEAVY', dna.heavy], ['MELODIC', dna.melodic], ['DARK', dna.dark], ['DRIVE', dna.drive], ['WORKOUT FIT', dna.workoutFit]] as Array<[string, number]>).map(([label, value]) => <div key={label} style={{ ["--value" as string]: `${value}%` } as CSSProperties}><span>{label}</span><strong>{String(value).padStart(2, "0")}</strong><i><b /></i></div>)}</div> : <div className="mvp-v23-signalIdle">PLAY A SONG TO OPEN THE LIVE SIGNAL CHANNELS</div>}
    </section>

    <section className="mvp-v23-steeringDeck">
      <div className="mvp-v23-memory">
        <span>TASTE MEMORY</span><strong>{likedTracks.length}</strong><small>LIKED SONGS</small><p>Your permanent high-confidence taste signal. Manual playlists remain untouched.</p>
        <div className="mvp-v23-confidence"><span>LIBRARY CONFIDENCE</span><i><b style={{ width: `${Math.max(3, likedPercent)}%` }} /></i><strong>{likedPercent}%</strong></div>
        <div className="mvp-v23-memoryActions"><button type="button" disabled={!likedTracks.length} onClick={() => void playMusicAdHocQueue("Liked Songs", likedTracks)}><i>▶</i><span><strong>PLAY LIKED</strong><small>Permanent collection</small></span></button><button type="button" disabled={!likedTracks.length} onClick={() => { const seed = likedTracks[0]; if (!seed) return; const queue = startMvpNeuralRadio(seed.id, "more_like_this"); setMessage(`Liked Radio • ${queue.length} library matches ready`); }}><i>∞</i><span><strong>LIKED RADIO</strong><small>Generate from taste</small></span></button></div>
      </div>
      <div className="mvp-v23-steering">
        <header><div><span>NEURAL STEERING</span><strong>PLAYER-LINKED VECTOR</strong></div><small><i />LINKED</small></header>
        <div className="mvp-v23-steeringRail"><i /><b style={{ left: `${steeringPosition}%` }} /></div>
        <div className="mvp-v23-steeringBiases">{STEERING_BIASES.map((bias, index) => <span key={bias} className={index === 3 ? "is-anchor" : ""}><i />{bias}</span>)}</div>
      </div>
    </section>

    <section className="mvp-v23-tasteField">
      <header><div><span>SONIC TERRITORY</span><h3>Taste Field</h3><p>Five learned regions from the way your private library actually behaves.</p></div><small>{tracks.length} TRACKS ANALYZED</small></header>
      <div className="mvp-v23-fieldRows">{tasteMap.map((cluster, index) => <button type="button" key={cluster.id} disabled={!cluster.tracks.length} style={{ ["--score" as string]: `${Math.max(8, cluster.score)}%` } as CSSProperties} onClick={() => void playMusicAdHocQueue(`Taste Map • ${cluster.label}`, cluster.tracks)}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{cluster.label}</small><strong>{cluster.score}</strong><p>{cluster.subtitle}</p></div><i><b /></i></button>)}</div>
    </section>

    <section className={`mvp-v23-pr ${prSoundtracks.length ? "has-records" : "is-empty"}`}>
      <header><div><span>PERFORMANCE MEMORY</span><h3>PR Soundtrack</h3></div><b>{prSoundtracks.length}</b></header>
      {prSoundtracks.length ? <div className="mvp-v23-prRail">{prSoundtracks.slice(0, 12).map((record, index) => <article key={record.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{record.title}</strong><b>{record.artist}</b><small>{record.exerciseName} · SET {record.setNumber} · {record.records.join(" + ")}</small></div><button type="button" onClick={() => void playMusicTrack(record.trackId, 0)} aria-label={`Play ${record.title}`}>▶</button></article>)}</div> : <p>No PR soundtrack moments captured yet. This rail expands automatically when a PR lands while music is playing.</p>}
    </section>
  </section>;
}
