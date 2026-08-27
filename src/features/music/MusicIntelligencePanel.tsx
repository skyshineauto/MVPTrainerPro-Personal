/* MVP_TRAINER_V5_R12_5E_21_NEURAL_COMMAND_SURFACE */
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
const NODE_POSITIONS = [
  [16, 35],
  [36, 18],
  [62, 24],
  [78, 55],
  [47, 70],
] as const;

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

  const toggleAutoMix = () => {
    const next = !autoMix;
    setAutoMix(next);
    setAutoMixEnabled(next);
    setMessage(next ? "AutoMix Flow enabled." : "AutoMix Flow disabled.");
  };

  return (
    <section className="mvp-v21-intel">
      <section className="mvp-v21-coreField">
        <div className="mvp-v21-coreCopy">
          <span className="mvp-v21-kicker">MVP MUSIC INTELLIGENCE</span>
          <h2>Neural Command</h2>
          <p>Your taste memory, live track signal, workout state and AutoMix steering converge here.</p>
          <div className="mvp-v21-nowSignal">
            <span className={player.playing ? "is-live" : ""}><i /></span>
            <div><small>LIVE INPUT</small><strong>{currentTitle}</strong><b>{currentArtist}</b></div>
          </div>
        </div>

        <div className={`mvp-v21-neuralCore ${autoMix ? "is-active" : ""}`} aria-label="MVP neural core">
          <span className="mvp-v21-coreHalo is-a" />
          <span className="mvp-v21-coreHalo is-b" />
          <span className="mvp-v21-coreHalo is-c" />
          <span className="mvp-v21-coreBeam is-one" />
          <span className="mvp-v21-coreBeam is-two" />
          <div><small>FLOW</small><b>{autoMix ? "AI" : "M"}</b><strong>{autoMix ? "ACTIVE" : "MANUAL"}</strong></div>
        </div>

        <div className="mvp-v21-coreTelemetry">
          <div><span>WORKOUT STAGE</span><strong>{stage.toUpperCase()}</strong><i style={{ ["--meter" as string]: `${Math.max(18, workoutFit)}%` } as CSSProperties}><b /></i></div>
          <div><span>SIGNAL DRIVE</span><strong>{dna ? String(drive).padStart(2, "0") : "--"}</strong><i style={{ ["--meter" as string]: `${Math.max(8, drive)}%` } as CSSProperties}><b /></i></div>
          <button type="button" className={autoMix ? "is-on" : ""} onClick={toggleAutoMix}><span><small>AUTOMIX</small><strong>{autoMix ? "ACTIVE" : "ENABLE"}</strong></span><i><b /></i></button>
        </div>
      </section>

      {message ? <div className="mvp-v21-message">{message}<button type="button" aria-label="Dismiss" onClick={() => setMessage("")}>×</button></div> : null}

      <section className="mvp-v21-steering">
        <div className="mvp-v21-steeringTitle"><span>NEURAL STEERING</span><strong>PLAYER-LINKED VECTOR</strong></div>
        <div className="mvp-v21-steeringLine"><i /><b /></div>
        <div className="mvp-v21-steeringBiases">{STEERING_BIASES.map((bias, index) => <span key={bias} className={index === 3 ? "is-anchor" : ""}><i />{bias}</span>)}</div>
        <div className="mvp-v21-linked"><i /> LINKED</div>
      </section>

      <section className="mvp-v21-signalBridge">
        <div className="mvp-v21-memoryNode">
          <span>TASTE MEMORY</span>
          <div className="mvp-v21-memoryCount"><strong>{likedTracks.length}</strong><small>LIKED SONGS</small></div>
          <p>Your permanent high-confidence taste signal. Manual playlists stay untouched.</p>
          <div className="mvp-v21-memoryRail"><i><b style={{ width: `${Math.max(3, likedPercent)}%` }} /></i><small>{likedPercent}% LIBRARY CONFIDENCE</small></div>
          <div className="mvp-v21-memoryActions">
            <button type="button" disabled={!likedTracks.length} onClick={() => void playMusicAdHocQueue("Liked Songs", likedTracks)}><i>▶</i><span><strong>PLAY LIKED</strong><small>Permanent collection</small></span></button>
            <button type="button" disabled={!likedTracks.length} onClick={() => { const seed = likedTracks[0]; if (!seed) return; const queue = startMvpNeuralRadio(seed.id, "more_like_this"); setMessage(`Liked Radio • ${queue.length} library matches ready`); }}><i>∞</i><span><strong>LIKED RADIO</strong><small>Generate from taste</small></span></button>
          </div>
        </div>

        <div className="mvp-v21-conduit" aria-hidden><span>TASTE</span><i><b /></i><span>LIVE SIGNAL</span></div>

        <div className="mvp-v21-dnaNode">
          <header><div><span>LIVE SONG DNA</span><strong>{dna ? "SIGNAL PROFILE" : "WAITING FOR PLAYBACK"}</strong></div><small className={dna ? "is-live" : ""}><i />{dna ? "LIVE" : "IDLE"}</small></header>
          {dna ? <div className="mvp-v21-channels">{([
            ["ENERGY", dna.energy], ["HEAVY", dna.heavy], ["MELODIC", dna.melodic], ["DARK", dna.dark], ["DRIVE", dna.drive], ["WORKOUT FIT", dna.workoutFit],
          ] as Array<[string, number]>).map(([label, value]) => <div key={label} style={{ ["--value" as string]: `${value}%` } as CSSProperties}><span>{label}</span><strong>{String(value).padStart(2, "0")}</strong><i><b /></i></div>)}</div> : <div className="mvp-v21-idleSignal"><i /><span>PLAY A SONG TO OPEN THE LIVE SIGNAL BANK</span></div>}
        </div>
      </section>

      <section className="mvp-v21-topology">
        <header><div><span>SONIC TERRITORY</span><h3>Taste Topology</h3><p>Library character rendered as connected signal zones, not isolated scores.</p></div><small>{tracks.length} TRACKS ANALYZED</small></header>
        <div className="mvp-v21-mapField">
          <svg viewBox="0 0 100 78" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id="mvpV21Link" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#40d9ff" stopOpacity=".16"/><stop offset=".5" stopColor="#8deeff" stopOpacity=".34"/><stop offset="1" stopColor="#ff9f2f" stopOpacity=".18"/></linearGradient></defs>
            <path d="M16 35 L36 18 L62 24 L78 55 L47 70 L16 35 M36 18 L47 70 M62 24 L47 70 M16 35 L62 24" stroke="url(#mvpV21Link)" strokeWidth=".35" fill="none" />
            <path d="M7 64 C26 50 35 55 47 70 C60 83 79 64 94 49" stroke="url(#mvpV21Link)" strokeWidth=".22" fill="none" strokeDasharray="1.4 1.7" />
          </svg>
          <div className="mvp-v21-mapPulse" aria-hidden />
          {tasteMap.map((cluster, index) => {
            const [left, top] = NODE_POSITIONS[index] || [50, 50];
            return <button type="button" key={cluster.id} disabled={!cluster.tracks.length} style={{ left: `${left}%`, top: `${top}%`, ["--score" as string]: `${Math.max(12, cluster.score)}%` } as CSSProperties} onClick={() => void playMusicAdHocQueue(`Taste Map • ${cluster.label}`, cluster.tracks)}><i /><span>{cluster.label}</span><strong>{cluster.score}</strong><small>{cluster.subtitle}</small></button>;
          })}
          <div className="mvp-v21-currentPoint" style={{ ["--x" as string]: `${30 + Math.min(45, (dna?.melodic || 40) * .42)}%`, ["--y" as string]: `${24 + Math.min(38, (dna?.dark || 35) * .35)}%` } as CSSProperties}><i />CURRENT SONG</div>
        </div>
      </section>

      <section className={`mvp-v21-pr ${prSoundtracks.length ? "has-records" : "is-empty"}`}>
        <header><div><span>PERFORMANCE MEMORY</span><h3>PR Soundtrack</h3></div><b>{prSoundtracks.length}</b></header>
        {prSoundtracks.length ? <div className="mvp-v21-prRail">{prSoundtracks.slice(0, 12).map((record, index) => <article key={record.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{record.title}</strong><b>{record.artist}</b><small>{record.exerciseName} · SET {record.setNumber} · {record.records.join(" + ")}</small></div><button type="button" aria-label={`Play ${record.title}`} onClick={() => void playMusicTrack(record.trackId, 0)}>▶</button></article>)}</div> : <p>No PR soundtrack moments captured yet. This rail expands automatically when a PR lands while music is playing.</p>}
      </section>

      <style>{`
        .mvp-v21-intel{--n-cyan:#48ddff;--n-orange:#ff9f2c;--n-green:#50e79d;display:grid;gap:11px;padding:13px;background:radial-gradient(850px 400px at -5% 25%,rgba(31,190,230,.10),transparent 66%),radial-gradient(700px 430px at 106% 45%,rgba(255,139,30,.065),transparent 68%),linear-gradient(180deg,#02090d,#02070a);color:#edfaff}
        .mvp-v21-intel button{font:inherit}
        .mvp-v21-coreField{position:relative;isolation:isolate;overflow:hidden;display:grid;grid-template-columns:minmax(0,1.2fr) 220px minmax(190px,.48fr);gap:24px;align-items:center;min-height:255px;padding:26px 28px;border:1px solid rgba(79,190,224,.14);border-radius:18px;background:radial-gradient(590px 260px at 0 0,rgba(45,204,244,.12),transparent 70%),radial-gradient(430px 240px at 100% 100%,rgba(255,148,34,.08),transparent 72%),linear-gradient(135deg,rgba(6,24,32,.97),rgba(2,9,13,.99));box-shadow:0 24px 60px rgba(0,0,0,.26),inset 0 1px rgba(255,255,255,.025)}
        .mvp-v21-coreField:before{content:"";position:absolute;z-index:-1;inset:0;background:linear-gradient(110deg,transparent 0 36%,rgba(87,224,255,.035) 49%,transparent 61%),repeating-linear-gradient(90deg,transparent 0 86px,rgba(72,194,228,.018) 87px,transparent 88px)}
        .mvp-v21-coreField:after{content:"";position:absolute;left:28px;right:28px;bottom:0;height:1px;background:linear-gradient(90deg,transparent,var(--n-cyan),rgba(255,255,255,.36),var(--n-orange),transparent);box-shadow:0 0 18px rgba(68,217,255,.16)}
        .mvp-v21-kicker{font-size:6.5px;font-weight:1000;letter-spacing:.19em;color:#63dcf9}.mvp-v21-coreCopy h2{margin:6px 0 7px;font-size:clamp(32px,4.1vw,52px);line-height:.92;letter-spacing:-.065em;color:#f8fdff}.mvp-v21-coreCopy>p{max-width:590px;margin:0;color:#7e98a2;font-size:8.5px;line-height:1.55}.mvp-v21-nowSignal{margin-top:22px;display:flex;align-items:center;gap:10px;padding-left:13px;border-left:2px solid rgba(69,214,252,.68)}.mvp-v21-nowSignal>span{width:27px;height:27px;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(83,197,231,.18);background:#06151b}.mvp-v21-nowSignal>span i{width:6px;height:6px;border-radius:50%;background:#617a84}.mvp-v21-nowSignal>span.is-live i{background:#53e6a0;box-shadow:0 0 11px rgba(73,229,153,.4)}.mvp-v21-nowSignal>div{display:grid;gap:1px;min-width:0}.mvp-v21-nowSignal small{font-size:5.8px;font-weight:1000;letter-spacing:.13em;color:#5fcde9}.mvp-v21-nowSignal strong{font-size:10px;color:#eaf9fd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mvp-v21-nowSignal b{font-size:7px;color:#7d9aa5;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .mvp-v21-neuralCore{position:relative;width:190px;height:190px;margin:auto;display:grid;place-items:center;border-radius:50%;background:radial-gradient(circle,#0b2834 0 24%,#04131a 25% 45%,transparent 46%);filter:drop-shadow(0 20px 45px rgba(0,0,0,.32))}.mvp-v21-neuralCore:after{content:"";position:absolute;inset:31%;border-radius:50%;border:1px solid rgba(111,234,255,.38);box-shadow:0 0 22px rgba(60,213,250,.12),inset 0 0 20px rgba(61,210,247,.08)}.mvp-v21-coreHalo{position:absolute;inset:10%;border:1px solid rgba(72,210,248,.14);border-radius:50%;animation:mvpV21Orbit 11s linear infinite}.mvp-v21-coreHalo.is-b{inset:2%;border-style:dashed;border-color:rgba(255,162,49,.12);animation-duration:18s;animation-direction:reverse}.mvp-v21-coreHalo.is-c{inset:22%;border-color:rgba(120,239,255,.20);animation-duration:7s}.mvp-v21-coreBeam{position:absolute;left:50%;top:50%;width:46%;height:1px;transform-origin:left;background:linear-gradient(90deg,rgba(82,221,255,.65),transparent)}.mvp-v21-coreBeam.is-one{transform:rotate(28deg)}.mvp-v21-coreBeam.is-two{transform:rotate(196deg);background:linear-gradient(90deg,rgba(255,161,49,.38),transparent)}.mvp-v21-neuralCore>div{z-index:2;display:grid;place-items:center;gap:1px}.mvp-v21-neuralCore small{font-size:5px;letter-spacing:.18em;color:#5d7a85}.mvp-v21-neuralCore b{font-size:31px;line-height:1;color:#eafcff;text-shadow:0 0 24px rgba(64,219,255,.22)}.mvp-v21-neuralCore strong{font-size:6px;letter-spacing:.13em;color:#74a0ae}.mvp-v21-neuralCore.is-active b{color:#bdf9ff}.mvp-v21-neuralCore.is-active:after{border-color:rgba(92,236,255,.68);box-shadow:0 0 30px rgba(57,218,255,.18),inset 0 0 24px rgba(68,219,255,.12)}@keyframes mvpV21Orbit{to{transform:rotate(360deg)}}
        .mvp-v21-coreTelemetry{display:grid;gap:12px}.mvp-v21-coreTelemetry>div{display:grid;grid-template-columns:1fr auto;gap:5px}.mvp-v21-coreTelemetry span{font-size:5.8px;font-weight:1000;letter-spacing:.12em;color:#627d88}.mvp-v21-coreTelemetry>div strong{font-size:10px;color:#e7f7fb}.mvp-v21-coreTelemetry>div>i{grid-column:1/-1;height:2px;background:#02070a;overflow:hidden}.mvp-v21-coreTelemetry>div>i b{display:block;width:var(--meter);height:100%;background:linear-gradient(90deg,#36c9f1,#77e9ff 72%,#ff9f2d)}.mvp-v21-coreTelemetry>button{min-height:52px;padding:0 11px;display:flex;align-items:center;justify-content:space-between;border:1px solid rgba(85,184,214,.18);border-radius:10px;background:linear-gradient(180deg,#071820,#041016);color:#a9c2cb;cursor:pointer}.mvp-v21-coreTelemetry>button>span{display:grid;gap:2px}.mvp-v21-coreTelemetry button small{font-size:5.8px}.mvp-v21-coreTelemetry button strong{font-size:9px;color:#edfaff}.mvp-v21-coreTelemetry>button>i{width:35px;height:18px;padding:2px;border-radius:99px;background:#06141a;border:1px solid rgba(91,174,203,.17)}.mvp-v21-coreTelemetry>button>i b{display:block;width:12px;height:12px;border-radius:50%;background:#647b85;transition:.18s ease}.mvp-v21-coreTelemetry>button.is-on{border-color:rgba(67,224,147,.30);background:linear-gradient(180deg,#0b2a1c,#06150f)}.mvp-v21-coreTelemetry>button.is-on strong{color:#92f5bd}.mvp-v21-coreTelemetry>button.is-on>i b{transform:translateX(15px);background:#59eca4;box-shadow:0 0 10px rgba(70,229,151,.4)}
        .mvp-v21-message{min-height:34px;padding:0 11px;display:flex;align-items:center;justify-content:space-between;border:1px solid rgba(76,193,229,.14);border-radius:8px;background:#06151b;color:#9fc1cc;font-size:7px}.mvp-v21-message button{border:0;background:transparent;color:#92b1bc;font-size:16px;cursor:pointer}
        .mvp-v21-steering{position:relative;display:grid;grid-template-columns:150px minmax(100px,.6fr) minmax(0,1.4fr) 70px;gap:12px;align-items:center;min-height:64px;padding:10px 14px;border-top:1px solid rgba(83,183,214,.10);border-bottom:1px solid rgba(83,183,214,.10);background:linear-gradient(90deg,rgba(8,31,40,.56),rgba(2,10,14,.48) 55%,rgba(31,20,8,.30))}.mvp-v21-steeringTitle{display:grid;gap:2px}.mvp-v21-steeringTitle span{font-size:5.8px;font-weight:1000;letter-spacing:.16em;color:#60d5f3}.mvp-v21-steeringTitle strong{font-size:8px;color:#d5e7ed}.mvp-v21-steeringLine{position:relative;height:1px;background:linear-gradient(90deg,rgba(70,211,248,.15),rgba(93,231,255,.55),rgba(255,162,46,.24))}.mvp-v21-steeringLine i{position:absolute;width:6px;height:6px;border-radius:50%;left:48%;top:-2.5px;background:#83edff;box-shadow:0 0 12px rgba(84,225,255,.55)}.mvp-v21-steeringLine b{position:absolute;left:0;top:-9px;width:1px;height:18px;background:rgba(81,205,241,.22)}.mvp-v21-steeringBiases{display:flex;align-items:center;justify-content:space-between;gap:7px}.mvp-v21-steeringBiases span{display:flex;align-items:center;gap:4px;font-size:5.3px;font-weight:1000;letter-spacing:.07em;color:#627c86;white-space:nowrap}.mvp-v21-steeringBiases span i{width:4px;height:4px;border-radius:50%;background:#415a64}.mvp-v21-steeringBiases span.is-anchor{color:#b7f4ff}.mvp-v21-steeringBiases span.is-anchor i{background:#59dcfb;box-shadow:0 0 8px rgba(74,218,251,.45)}.mvp-v21-linked{display:flex;justify-content:flex-end;align-items:center;gap:6px;font-size:5.8px;font-weight:1000;letter-spacing:.1em;color:#80eaae}.mvp-v21-linked i{width:6px;height:6px;border-radius:50%;background:#4ee09a;box-shadow:0 0 9px rgba(72,224,151,.35)}
        .mvp-v21-signalBridge{display:grid;grid-template-columns:minmax(260px,.72fr) 70px minmax(0,1.28fr);gap:0;align-items:stretch;border:1px solid rgba(86,170,198,.11);border-radius:15px;background:linear-gradient(180deg,rgba(4,15,20,.89),rgba(2,8,12,.96));overflow:hidden}.mvp-v21-memoryNode,.mvp-v21-dnaNode{padding:16px}.mvp-v21-memoryNode>span,.mvp-v21-dnaNode header span{font-size:5.8px;font-weight:1000;letter-spacing:.16em;color:#5fcfe9}.mvp-v21-memoryCount{display:flex;align-items:end;gap:8px;margin:7px 0 6px}.mvp-v21-memoryCount strong{font-size:35px;line-height:.9;color:#67e3ff;letter-spacing:-.06em}.mvp-v21-memoryCount small{font-size:6px;font-weight:1000;letter-spacing:.09em;color:#708992}.mvp-v21-memoryNode>p{margin:0;color:#708993;font-size:7px;line-height:1.5}.mvp-v21-memoryRail{display:grid;gap:5px;margin-top:13px}.mvp-v21-memoryRail>i{height:3px;border-radius:99px;background:#02070a;overflow:hidden}.mvp-v21-memoryRail>i b{display:block;height:100%;background:linear-gradient(90deg,#36cef4,#6ee6ff 70%,#ff9f2e)}.mvp-v21-memoryRail small{font-size:5.4px;color:#58717b;letter-spacing:.08em}.mvp-v21-memoryActions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px}.mvp-v21-memoryActions button{min-height:46px;padding:0 9px;display:flex;align-items:center;gap:8px;border:1px solid rgba(85,177,207,.13);border-radius:9px;background:#06141a;color:#9bc0cb;cursor:pointer}.mvp-v21-memoryActions button>i{width:24px;height:24px;display:grid;place-items:center;border-radius:50%;font-style:normal;color:#67dfff;border:1px solid rgba(73,197,237,.18)}.mvp-v21-memoryActions button>span{display:grid;gap:1px;text-align:left}.mvp-v21-memoryActions strong{font-size:6.4px;color:#eaf9fd;letter-spacing:.08em}.mvp-v21-memoryActions small{font-size:5.2px;color:#617984}.mvp-v21-memoryActions button:disabled{opacity:.3}
        .mvp-v21-conduit{display:grid;grid-template-rows:auto 1fr auto;place-items:center;padding:16px 0;border-left:1px solid rgba(82,170,199,.07);border-right:1px solid rgba(82,170,199,.07);background:linear-gradient(90deg,transparent,rgba(68,207,245,.025),transparent)}.mvp-v21-conduit span{font-size:4.8px;font-weight:1000;letter-spacing:.12em;color:#4e6872;writing-mode:vertical-rl}.mvp-v21-conduit>i{width:1px;height:100%;min-height:70px;background:linear-gradient(180deg,rgba(62,207,244,.12),rgba(83,226,255,.64),rgba(255,156,41,.18));position:relative}.mvp-v21-conduit>i b{position:absolute;width:7px;height:7px;border-radius:50%;left:-3px;top:34%;background:#76e9ff;box-shadow:0 0 12px rgba(72,220,255,.52);animation:mvpV21Signal 2.7s ease-in-out infinite}@keyframes mvpV21Signal{0%,100%{top:18%;opacity:.5}50%{top:72%;opacity:1}}
        .mvp-v21-dnaNode header{display:flex;align-items:center;justify-content:space-between;gap:10px}.mvp-v21-dnaNode header>div{display:grid;gap:3px}.mvp-v21-dnaNode header strong{font-size:9px;color:#e9f8fc;letter-spacing:.04em}.mvp-v21-dnaNode header>small{display:flex;align-items:center;gap:5px;font-size:5.4px;font-weight:1000;letter-spacing:.1em;color:#617984}.mvp-v21-dnaNode header>small i{width:6px;height:6px;border-radius:50%;background:#576f79}.mvp-v21-dnaNode header>small.is-live{color:#80ecaf}.mvp-v21-dnaNode header>small.is-live i{background:#50e59c;box-shadow:0 0 9px rgba(72,226,150,.36)}.mvp-v21-channels{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:18px}.mvp-v21-channels>div{min-width:0;display:grid;gap:7px;padding:2px 4px}.mvp-v21-channels span{font-size:5.2px;font-weight:1000;letter-spacing:.08em;color:#617d88;white-space:nowrap}.mvp-v21-channels strong{font-size:21px;line-height:1;color:#f3fbfe;letter-spacing:-.045em}.mvp-v21-channels>div>i{height:55px;width:5px;background:#02070a;display:flex;align-items:end;border-radius:99px;overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.6)}.mvp-v21-channels>div>i b{width:100%;height:var(--value);background:linear-gradient(180deg,#8ff0ff,#39c9f2 70%,#ff9e2c);box-shadow:0 0 10px rgba(62,211,246,.2)}.mvp-v21-idleSignal{min-height:100px;display:grid;place-content:center;justify-items:center;gap:8px;color:#5b747e;font-size:5.8px;font-weight:1000;letter-spacing:.1em}.mvp-v21-idleSignal i{width:80px;height:1px;background:linear-gradient(90deg,transparent,#47d9ff,transparent);animation:mvpV21Idle 1.8s ease-in-out infinite}@keyframes mvpV21Idle{50%{width:130px;filter:brightness(1.4)}}
        .mvp-v21-topology{border-top:1px solid rgba(82,178,209,.10);border-bottom:1px solid rgba(82,178,209,.10);background:linear-gradient(180deg,rgba(3,13,18,.76),rgba(2,8,11,.91));overflow:hidden}.mvp-v21-topology>header{display:flex;align-items:end;justify-content:space-between;gap:14px;padding:15px 17px 5px}.mvp-v21-topology header span{font-size:5.8px;font-weight:1000;letter-spacing:.16em;color:#5ecde8}.mvp-v21-topology h3{margin:3px 0 2px;font-size:18px;color:#effaff;letter-spacing:-.035em}.mvp-v21-topology p{margin:0;color:#6c858f;font-size:7px}.mvp-v21-topology header>small{font-size:5.5px;font-weight:1000;letter-spacing:.1em;color:#5d747e}.mvp-v21-mapField{position:relative;height:300px;margin:0 12px 12px;overflow:hidden;background:radial-gradient(circle at 48% 45%,rgba(47,192,231,.07),transparent 30%),radial-gradient(circle at 82% 65%,rgba(255,145,31,.04),transparent 28%)}.mvp-v21-mapField>svg{position:absolute;inset:0;width:100%;height:100%;filter:drop-shadow(0 0 8px rgba(66,208,245,.07))}.mvp-v21-mapPulse{position:absolute;left:49%;top:48%;width:130px;height:130px;border:1px solid rgba(70,209,248,.08);border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 28px rgba(56,204,243,.014),0 0 0 58px rgba(255,145,34,.008)}.mvp-v21-mapField>button{position:absolute;transform:translate(-50%,-50%);width:112px;height:112px;padding:10px;display:grid;place-content:center;justify-items:center;gap:2px;border:1px solid rgba(86,183,214,.15);border-radius:50%;background:radial-gradient(circle at 35% 28%,rgba(67,210,248,.11),transparent 45%),radial-gradient(circle,#071a22,#031016 72%);color:#dff8ff;cursor:pointer;box-shadow:0 14px 32px rgba(0,0,0,.20),inset 0 1px rgba(255,255,255,.025);transition:.16s ease}.mvp-v21-mapField>button:before{content:"";position:absolute;inset:6px;border:1px dashed rgba(78,200,237,.10);border-radius:50%}.mvp-v21-mapField>button>i{position:absolute;left:50%;bottom:9px;width:calc(var(--score) * .65);max-width:65px;height:2px;transform:translateX(-50%);background:linear-gradient(90deg,#42d7ff,#78eaff 70%,#ff9e2e);border-radius:99px}.mvp-v21-mapField button span{font-size:6px;font-weight:1000;letter-spacing:.09em;color:#85cfe0}.mvp-v21-mapField button strong{font-size:25px;line-height:1;color:#f8fdff}.mvp-v21-mapField button small{max-width:82px;font-size:5px;line-height:1.25;color:#637b84;text-align:center}.mvp-v21-mapField button:disabled{opacity:.28}.mvp-v21-currentPoint{position:absolute;left:var(--x);top:var(--y);transform:translate(-50%,-50%);display:flex;align-items:center;gap:5px;font-size:4.8px;font-weight:1000;letter-spacing:.09em;color:#ffca74;pointer-events:none}.mvp-v21-currentPoint i{width:7px;height:7px;border-radius:50%;background:#ffab3f;box-shadow:0 0 14px rgba(255,155,42,.48)}
        .mvp-v21-pr{min-height:55px;display:grid;grid-template-columns:auto 1fr;align-items:center;border:1px solid rgba(84,169,197,.10);border-radius:11px;background:#030d11}.mvp-v21-pr>header{display:flex;align-items:center;gap:13px;padding:10px 13px}.mvp-v21-pr header>div{display:grid;gap:2px}.mvp-v21-pr header span{font-size:5.5px;font-weight:1000;letter-spacing:.15em;color:#5dcce7}.mvp-v21-pr header h3{margin:0;font-size:12px;color:#dff1f6}.mvp-v21-pr header>b{font-size:19px;color:#58dfff}.mvp-v21-pr>p{margin:0;padding:0 14px;color:#607984;font-size:6.3px;text-align:right}.mvp-v21-pr.has-records{display:block;padding-bottom:8px}.mvp-v21-prRail{display:flex;gap:6px;overflow-x:auto;padding:0 9px 3px;scrollbar-width:none}.mvp-v21-prRail::-webkit-scrollbar{display:none}.mvp-v21-prRail article{flex:0 0 260px;min-height:56px;padding:7px 8px;display:grid;grid-template-columns:22px minmax(0,1fr) 32px;gap:7px;align-items:center;border:1px solid rgba(87,160,184,.09);border-radius:8px;background:#051319}.mvp-v21-prRail article>span{font-size:6px;color:#4f6872}.mvp-v21-prRail article>div{min-width:0;display:grid;gap:1px}.mvp-v21-prRail strong{font-size:8px;color:#e5f6fa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mvp-v21-prRail b{font-size:6.5px;color:#88b7c4}.mvp-v21-prRail small{font-size:5.2px;color:#5c747e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mvp-v21-prRail button{width:30px;height:30px;border-radius:50%;border:1px solid rgba(72,198,237,.18);background:#06171e;color:#70def8;cursor:pointer}
        @media(hover:hover){.mvp-v21-intel button:not(:disabled):hover{filter:brightness(1.17) saturate(1.05);transform:translateY(-1px)}.mvp-v21-mapField>button:not(:disabled):hover{border-color:rgba(88,226,255,.38);box-shadow:0 18px 38px rgba(0,0,0,.22),0 0 30px rgba(52,205,244,.09),inset 0 1px rgba(255,255,255,.05)}.mvp-v21-memoryActions button:not(:disabled):hover,.mvp-v21-coreTelemetry>button:hover{background:linear-gradient(180deg,#0b2d39,#061820);border-color:rgba(83,215,252,.32)}}
        @media(max-width:900px){.mvp-v21-coreField{grid-template-columns:minmax(0,1fr) 170px}.mvp-v21-neuralCore{width:150px;height:150px}.mvp-v21-coreTelemetry{grid-column:1/-1;grid-template-columns:1fr 1fr 180px}.mvp-v21-signalBridge{grid-template-columns:1fr}.mvp-v21-conduit{display:none}.mvp-v21-channels{grid-template-columns:repeat(6,1fr)}.mvp-v21-steering{grid-template-columns:135px 1fr 64px}.mvp-v21-steeringBiases{grid-column:1/-1;grid-row:2;justify-content:flex-start;flex-wrap:wrap}.mvp-v21-mapField{height:330px}.mvp-v21-mapField>button{width:102px;height:102px}}
        @media(max-width:650px){.mvp-v21-intel{padding:8px;gap:8px}.mvp-v21-coreField{grid-template-columns:1fr;gap:15px;min-height:0;padding:17px 14px}.mvp-v21-coreField:after{left:14px;right:14px}.mvp-v21-coreCopy h2{font-size:34px}.mvp-v21-coreCopy>p{font-size:8px}.mvp-v21-nowSignal{margin-top:14px}.mvp-v21-neuralCore{width:128px;height:128px}.mvp-v21-coreTelemetry{grid-column:auto;grid-template-columns:1fr 1fr}.mvp-v21-coreTelemetry>button{grid-column:1/-1}.mvp-v21-steering{grid-template-columns:1fr auto;gap:8px;padding:10px}.mvp-v21-steeringLine{display:none}.mvp-v21-steeringBiases{grid-column:1/-1;overflow-x:auto;flex-wrap:nowrap;justify-content:flex-start;padding-top:3px;scrollbar-width:none}.mvp-v21-steeringBiases::-webkit-scrollbar{display:none}.mvp-v21-steeringBiases span{flex:0 0 auto}.mvp-v21-memoryNode,.mvp-v21-dnaNode{padding:13px}.mvp-v21-channels{grid-template-columns:repeat(3,1fr);gap:10px}.mvp-v21-channels>div>i{height:38px}.mvp-v21-topology>header{padding:13px 12px 4px}.mvp-v21-topology header>small{display:none}.mvp-v21-mapField{height:360px;margin:0 4px 8px}.mvp-v21-mapField>button{width:92px;height:92px}.mvp-v21-mapField button strong{font-size:21px}.mvp-v21-pr{grid-template-columns:1fr}.mvp-v21-pr>p{text-align:left;padding:0 13px 11px;line-height:1.4}}
        @media(max-width:430px){.mvp-v21-coreCopy h2{font-size:31px}.mvp-v21-memoryActions{grid-template-columns:1fr}.mvp-v21-mapField{height:330px}.mvp-v21-mapField>button{width:82px;height:82px}.mvp-v21-mapField button small{display:none}.mvp-v21-mapField button strong{font-size:19px}.mvp-v21-channels{grid-template-columns:repeat(2,1fr)}}
        @media(hover:none){.mvp-v21-intel button:not(:disabled):hover{filter:none;transform:none}.mvp-v21-intel button:not(:disabled):active{filter:brightness(1.12);transform:scale(.985)}}
      `}</style>
    </section>
  );
}
