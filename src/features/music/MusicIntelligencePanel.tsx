/* MVP_TRAINER_V5_R7_NEURAL_PLAYER_DISCOVERY */
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

export function MusicIntelligencePanel({
  tracks,
}: {
  tracks: MusicTrack[];
}) {
  const player = useMusicPlayer();
  const [autoMix, setAutoMix] = useState(() => isAutoMixEnabled());
  const [message, setMessage] = useState("");

  const likedTracks = useMemo(
    () =>
      tracks
        .filter((track) => track.favorite)
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() -
            new Date(a.updated_at).getTime(),
        ),
    [tracks],
  );

  const dna = useMemo(
    () => (player.currentTrack ? getSongDna(player.currentTrack) : null),
    [
      player.currentTrack?.id,
      player.currentTrack?.updated_at,
      player.currentTrack?.favorite,
      player.currentTrack?.play_less,
    ],
  );

  const tasteMap = useMemo(() => buildTasteMap(tracks), [tracks]);
  const prSoundtracks = listPrSoundtracks();
  const stage = getWorkoutMusicStage();
  const currentTitle = player.currentTrack?.title || "No active track";
  const currentArtist = player.currentTrack?.artist || "Start playback to activate live analysis";
  const likedPercent = tracks.length ? Math.min(100, Math.round((likedTracks.length / tracks.length) * 100)) : 0;

  const toggleAutoMix = () => {
    const next = !autoMix;
    setAutoMix(next);
    setAutoMixEnabled(next);
    setMessage(next ? "AutoMix Flow enabled." : "AutoMix Flow disabled.");
  };

  return (
    <section className="mvp-v5-intel mvp-v20-intel">
      <header className="mvp-v20-command">
        <div className="mvp-v20-commandCopy">
          <span className="mvp-v20-kicker">MVP MUSIC INTELLIGENCE</span>
          <h2>Intelligence Core</h2>
          <p>
            Adaptive taste memory, live Song DNA, workout context, PR soundtrack history,
            and AutoMix working as one system.
          </p>
          <div className="mvp-v20-liveTrack">
            <i aria-hidden />
            <div>
              <small>LIVE ANALYSIS</small>
              <strong>{currentTitle}</strong>
              <span>{currentArtist}</span>
            </div>
          </div>
        </div>

        <div className="mvp-v20-core" aria-label="Intelligence core status">
          <div className={`mvp-v20-coreOrb ${autoMix ? "is-on" : ""}`} aria-hidden>
            <span className="mvp-v20-orbit is-one" />
            <span className="mvp-v20-orbit is-two" />
            <span className="mvp-v20-corePulse" />
            <b>AI</b>
          </div>
          <div className="mvp-v20-coreData">
            <div><small>WORKOUT STAGE</small><strong>{stage.toUpperCase()}</strong></div>
            <div><small>FLOW ENGINE</small><strong>{autoMix ? "ACTIVE" : "MANUAL"}</strong></div>
          </div>
          <button type="button" className={autoMix ? "is-on" : ""} onClick={toggleAutoMix}>
            <span>{autoMix ? "AUTOMIX ACTIVE" : "ENABLE AUTOMIX"}</span>
            <i aria-hidden><b /></i>
          </button>
        </div>
      </header>

      {message ? <div className="mvp-v20-message">{message}</div> : null}

      <section className="mvp-v20-neural" aria-label="Neural steering location">
        <div className="mvp-v20-neuralIcon" aria-hidden>
          <i/><i/><i/><i/><i/>
        </div>
        <div className="mvp-v20-neuralCopy">
          <span>NEURAL STEERING</span>
          <strong>Player-linked steering is online</strong>
          <small>HARDER · HEAVIER · FASTER · MORE LIKE THIS · MELODIC · DARKER · SURPRISE ME</small>
        </div>
        <div className="mvp-v20-neuralState"><i /> LINKED</div>
      </section>

      <section className="mvp-v20-dual">
        <article className="mvp-v20-memory">
          <header>
            <div><span>TASTE MEMORY</span><h3>Liked Songs</h3><p>Your permanent signal. Manual playlists stay untouched.</p></div>
            <b>{likedTracks.length}</b>
          </header>
          <div className="mvp-v20-memoryGauge">
            <div><span style={{ width: `${Math.max(3, likedPercent)}%` }} /></div>
            <small>{likedPercent}% OF LIBRARY MARKED AS HIGH-CONFIDENCE TASTE</small>
          </div>
          <div className="mvp-v20-actions">
            <button type="button" disabled={!likedTracks.length} onClick={() => void playMusicAdHocQueue("Liked Songs", likedTracks)}>
              <i className="is-play" aria-hidden />
              <span><strong>PLAY LIKED</strong><small>Start permanent collection</small></span>
            </button>
            <button type="button" disabled={!likedTracks.length} onClick={() => {
              const seed = likedTracks[0];
              if (!seed) return;
              const queue = startMvpNeuralRadio(seed.id, "more_like_this");
              setMessage(`Liked Radio • ${queue.length} library matches ready`);
            }}>
              <i className="is-radio" aria-hidden />
              <span><strong>LIKED RADIO</strong><small>Generate from your taste</small></span>
            </button>
          </div>
        </article>

        <article className="mvp-v20-dnaPanel">
          <header>
            <div><span>LIVE SONG DNA</span><h3>{dna ? "Signal Profile" : "Waiting for Playback"}</h3><p>{dna ? `${currentTitle} · ${currentArtist}` : "Play a song to expose its intelligence signature."}</p></div>
            <div className={`mvp-v20-analysisDot ${dna ? "is-live" : ""}`}><i />{dna ? "LIVE" : "IDLE"}</div>
          </header>
          {dna ? (
            <div className="mvp-v20-dna">
              {([
                ["ENERGY", dna.energy],
                ["HEAVY", dna.heavy],
                ["MELODIC", dna.melodic],
                ["DARK", dna.dark],
                ["DRIVE", dna.drive],
                ["WORKOUT FIT", dna.workoutFit],
              ] as Array<[string, number]>).map(([label, value], index) => (
                <div key={label} style={{ ["--dna" as string]: `${value}%`, ["--dna-i" as string]: index } as CSSProperties}>
                  <span>{label}</span>
                  <strong>{String(value).padStart(2, "0")}</strong>
                  <i><b /></i>
                </div>
              ))}
            </div>
          ) : <div className="mvp-v20-empty">LIVE DNA WILL APPEAR HERE</div>}
        </article>
      </section>

      <section className="mvp-v20-territory">
        <header>
          <div><span>SONIC TERRITORY</span><h3>Taste Map</h3><p>Five character zones derived from the way your library actually behaves.</p></div>
          <small>{tracks.length} TRACKS ANALYZED</small>
        </header>
        <div className="mvp-v20-taste">
          {tasteMap.map((cluster, index) => (
            <button type="button" key={cluster.id} disabled={!cluster.tracks.length} style={{ ["--cluster" as string]: index } as CSSProperties} onClick={() => void playMusicAdHocQueue(`Taste Map • ${cluster.label}`, cluster.tracks)}>
              <span className="mvp-v20-clusterIndex">0{index + 1}</span>
              <div><span>{cluster.label}</span><strong>{cluster.score}</strong><small>{cluster.subtitle}</small></div>
              <i><b style={{ width: `${Math.min(100, Math.max(4, cluster.score))}%` }} /></i>
            </button>
          ))}
        </div>
      </section>

      <section className="mvp-v20-pr">
        <header>
          <div><span>PERFORMANCE MEMORY</span><h3>PR Soundtrack</h3><p>The songs tied to your strongest recorded moments.</p></div>
          <b>{prSoundtracks.length}</b>
        </header>
        {prSoundtracks.length ? (
          <div className="mvp-v20-prGrid">
            {prSoundtracks.slice(0, 12).map((record, index) => (
              <article key={record.id}>
                <span className="mvp-v20-prIndex">{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{record.title}</strong><span>{record.artist}</span><small>{record.exerciseName} · SET {record.setNumber} · {record.records.join(" + ")}</small></div>
                <button type="button" aria-label={`Play ${record.title}`} onClick={() => void playMusicTrack(record.trackId, 0)}><i aria-hidden /></button>
              </article>
            ))}
          </div>
        ) : (
          <div className="mvp-v20-empty">PR songs will populate automatically when a PR is detected while music is playing.</div>
        )}
      </section>

      <style>{`
        .mvp-v20-intel{--i-cyan:#4bdcff;--i-blue:#128fc8;--i-orange:#ff9f28;--i-green:#4ee6a0;--i-ink:#02080c;padding:16px!important;display:grid!important;gap:14px!important;background:radial-gradient(900px 430px at -5% 18%,rgba(27,184,225,.11),transparent 64%),radial-gradient(720px 420px at 106% 46%,rgba(255,135,27,.07),transparent 66%),linear-gradient(180deg,#02090d,#02070a)!important}
        .mvp-v20-intel button{font:inherit}
        .mvp-v20-command{position:relative;overflow:hidden;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(290px,.65fr);gap:28px;align-items:stretch;padding:28px 30px;border:1px solid rgba(83,197,231,.18);border-radius:20px;background:radial-gradient(650px 260px at 10% 0%,rgba(42,203,245,.12),transparent 64%),radial-gradient(430px 230px at 94% 110%,rgba(255,153,36,.10),transparent 72%),linear-gradient(135deg,rgba(7,27,36,.98),rgba(2,10,15,.99) 70%);box-shadow:0 28px 70px rgba(0,0,0,.28),inset 0 1px rgba(255,255,255,.03)}
        .mvp-v20-command:after{content:"";position:absolute;left:28px;right:28px;bottom:0;height:1px;background:linear-gradient(90deg,transparent,var(--i-cyan),rgba(255,255,255,.82),var(--i-orange),transparent);opacity:.72;box-shadow:0 0 18px rgba(71,219,255,.18)}
        .mvp-v20-commandCopy{min-width:0;align-self:center}.mvp-v20-kicker,.mvp-v20-intel header>div>span,.mvp-v20-neuralCopy>span{display:block;color:#62dcfb;font-size:7px;font-weight:1000;letter-spacing:.19em}
        .mvp-v20-command h2{margin:7px 0 9px;color:#f6fdff;font-size:clamp(36px,4.6vw,60px);line-height:.92;letter-spacing:-.065em;text-shadow:0 12px 36px rgba(0,0,0,.35)}
        .mvp-v20-commandCopy>p{max-width:720px;margin:0;color:#829ba5;font-size:10px;line-height:1.6;font-weight:750}
        .mvp-v20-liveTrack{margin-top:22px;display:flex;align-items:center;gap:12px;max-width:680px;padding:11px 14px;border-left:2px solid rgba(79,220,255,.74);background:linear-gradient(90deg,rgba(12,53,67,.36),transparent 78%)}
        .mvp-v20-liveTrack>i{width:33px;height:25px;display:flex;align-items:center;justify-content:center;gap:3px}.mvp-v20-liveTrack>i:before,.mvp-v20-liveTrack>i:after{content:"";width:3px;border-radius:99px;background:linear-gradient(180deg,#8cecff,#25bce9);box-shadow:0 0 10px rgba(67,214,251,.25);animation:mvpIntelPulse 1.1s ease-in-out infinite}.mvp-v20-liveTrack>i:before{height:12px}.mvp-v20-liveTrack>i:after{height:21px;animation-delay:-.45s}
        @keyframes mvpIntelPulse{0%,100%{transform:scaleY(.55);opacity:.55}50%{transform:scaleY(1.15);opacity:1}}
        .mvp-v20-liveTrack div{display:grid;gap:1px;min-width:0}.mvp-v20-liveTrack small{color:#62d9f8;font-size:6px;font-weight:1000;letter-spacing:.15em}.mvp-v20-liveTrack strong{color:#f2fbfe;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mvp-v20-liveTrack span{color:#78939d;font-size:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .mvp-v20-core{position:relative;display:grid;grid-template-columns:128px 1fr;grid-template-rows:1fr auto;gap:12px 16px;align-items:center;padding:16px 17px;border:1px solid rgba(103,188,213,.13);border-radius:17px;background:linear-gradient(180deg,rgba(7,22,28,.76),rgba(2,9,13,.88));box-shadow:inset 0 1px rgba(255,255,255,.024)}
        .mvp-v20-coreOrb{position:relative;grid-row:1/3;width:118px;height:118px;display:grid;place-items:center;border-radius:50%;background:radial-gradient(circle at 45% 40%,rgba(87,224,255,.24),rgba(4,24,33,.94) 48%,#02090d 70%);box-shadow:inset 0 0 0 1px rgba(93,220,250,.18),inset 0 0 32px rgba(46,196,233,.08),0 0 0 8px rgba(60,205,241,.018)}
        .mvp-v20-coreOrb:before{content:"";position:absolute;inset:12px;border-radius:50%;border:1px dashed rgba(93,219,249,.22);animation:mvpIntelSpin 14s linear infinite}.mvp-v20-coreOrb.is-on{box-shadow:inset 0 0 0 1px rgba(89,230,255,.28),inset 0 0 38px rgba(44,205,244,.16),0 0 34px rgba(43,197,236,.10),0 0 0 8px rgba(60,205,241,.02)}
        .mvp-v20-coreOrb b{font-size:28px;letter-spacing:-.06em;color:#e9fbff;text-shadow:0 0 22px rgba(70,221,255,.42)}.mvp-v20-orbit{position:absolute;border-radius:50%;border:1px solid rgba(75,209,246,.13)}.mvp-v20-orbit.is-one{inset:3px 21px;transform:rotate(62deg)}.mvp-v20-orbit.is-two{inset:21px 3px;transform:rotate(-42deg);border-color:rgba(255,161,48,.10)}.mvp-v20-corePulse{position:absolute;width:7px;height:7px;border-radius:50%;background:#6de5ff;box-shadow:0 0 14px #55d9ff;transform:translate(39px,-29px)}@keyframes mvpIntelSpin{to{transform:rotate(360deg)}}
        .mvp-v20-coreData{display:grid;gap:9px}.mvp-v20-coreData>div{padding-bottom:7px;border-bottom:1px solid rgba(105,168,188,.09);display:grid;gap:2px}.mvp-v20-coreData small{font-size:5.8px;color:#6e8791;font-weight:1000;letter-spacing:.13em}.mvp-v20-coreData strong{font-size:12px;color:#eefbff;letter-spacing:.025em}
        .mvp-v20-core>button{grid-column:2;min-height:42px;padding:0 11px;display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid rgba(88,195,225,.20);border-radius:10px;background:linear-gradient(180deg,#09212b,#05141a);color:#bcefff;font-size:7px;font-weight:1000;letter-spacing:.09em;cursor:pointer;box-shadow:inset 0 1px rgba(255,255,255,.03);transition:.18s ease}.mvp-v20-core>button>i{width:34px;height:17px;padding:2px;display:flex;align-items:center;border-radius:99px;background:#041015;border:1px solid rgba(99,166,187,.16)}.mvp-v20-core>button>i b{width:11px;height:11px;border-radius:50%;background:#66828d;transition:.18s ease}.mvp-v20-core>button.is-on{border-color:rgba(74,224,165,.32);color:#c7ffe3;background:linear-gradient(180deg,#0a3022,#061910);box-shadow:0 0 22px rgba(55,218,143,.06),inset 0 1px rgba(255,255,255,.04)}.mvp-v20-core>button.is-on>i{border-color:rgba(64,221,147,.25);background:#061c12}.mvp-v20-core>button.is-on>i b{transform:translateX(17px);background:#5aeca2;box-shadow:0 0 10px rgba(73,234,156,.35)}
        .mvp-v20-message{padding:9px 12px;border-left:2px solid var(--i-cyan);background:linear-gradient(90deg,rgba(9,44,57,.54),rgba(3,13,18,.35));color:#aeefff;font-size:8px;font-weight:850}
        .mvp-v20-neural{min-height:68px;padding:11px 15px;display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:13px;align-items:center;border:1px solid rgba(77,194,229,.14);border-radius:14px;background:linear-gradient(90deg,rgba(7,30,40,.84),rgba(3,12,17,.94) 65%);box-shadow:inset 0 1px rgba(255,255,255,.02)}
        .mvp-v20-neuralIcon{height:38px;display:flex;align-items:center;justify-content:center;gap:4px}.mvp-v20-neuralIcon i{width:3px;height:14px;border-radius:99px;background:linear-gradient(180deg,#87ecff,#28bce8);animation:mvpIntelPulse 1.2s ease-in-out infinite}.mvp-v20-neuralIcon i:nth-child(2){height:28px;animation-delay:-.2s}.mvp-v20-neuralIcon i:nth-child(3){height:20px;animation-delay:-.6s}.mvp-v20-neuralIcon i:nth-child(4){height:32px;animation-delay:-.38s}.mvp-v20-neuralIcon i:nth-child(5){height:17px;animation-delay:-.75s}
        .mvp-v20-neuralCopy{display:grid;gap:2px}.mvp-v20-neuralCopy strong{font-size:12px;color:#f3fbfe}.mvp-v20-neuralCopy small{font-size:6.4px;color:#66828d;font-weight:850;letter-spacing:.035em}.mvp-v20-neuralState{display:flex;align-items:center;gap:7px;color:#86f0b4;font-size:6.5px;font-weight:1000;letter-spacing:.12em}.mvp-v20-neuralState i{width:7px;height:7px;border-radius:50%;background:#52e79c;box-shadow:0 0 10px rgba(73,232,153,.35)}
        .mvp-v20-dual{display:grid;grid-template-columns:.82fr 1.18fr;gap:14px}.mvp-v20-memory,.mvp-v20-dnaPanel,.mvp-v20-territory,.mvp-v20-pr{border:1px solid rgba(92,171,197,.12);border-radius:16px;background:linear-gradient(180deg,rgba(5,17,23,.92),rgba(2,9,13,.97));box-shadow:inset 0 1px rgba(255,255,255,.018);overflow:hidden}
        .mvp-v20-memory>header,.mvp-v20-dnaPanel>header,.mvp-v20-territory>header,.mvp-v20-pr>header{min-height:78px;padding:15px 17px;display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:1px solid rgba(103,166,186,.08);background:linear-gradient(90deg,rgba(12,43,54,.24),transparent 72%)}
        .mvp-v20-intel header h3{margin:4px 0 3px;color:#f3fbfe;font-size:18px;letter-spacing:-.03em}.mvp-v20-intel header p{margin:0;color:#738d97;font-size:8px;line-height:1.45}.mvp-v20-memory>header>b,.mvp-v20-pr>header>b{font-size:31px;color:#63e5ff;letter-spacing:-.06em}
        .mvp-v20-memoryGauge{padding:17px 17px 6px;display:grid;gap:7px}.mvp-v20-memoryGauge>div{height:5px;border-radius:99px;background:#02080b;overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.55)}.mvp-v20-memoryGauge>div span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#35c9f1,#69e6ff 70%,#ff9f2b);box-shadow:0 0 13px rgba(61,211,246,.26)}.mvp-v20-memoryGauge small{font-size:5.8px;color:#5f7781;letter-spacing:.1em;font-weight:900}
        .mvp-v20-actions{padding:12px 17px 17px;display:grid;grid-template-columns:1fr 1fr;gap:8px}.mvp-v20-actions button{min-height:54px;padding:0 11px;display:flex;align-items:center;gap:9px;border:1px solid rgba(93,185,214,.16);border-radius:11px;background:linear-gradient(180deg,#081c24,#041117);color:#e8faff;cursor:pointer;box-shadow:inset 0 1px rgba(255,255,255,.025);transition:.16s ease}.mvp-v20-actions button>i{width:29px;height:29px;display:grid;place-items:center;border-radius:50%;background:#06151c;border:1px solid rgba(80,200,234,.20)}.mvp-v20-actions .is-play:before{content:"";display:block;margin-left:2px;border-left:8px solid #71e2ff;border-top:5px solid transparent;border-bottom:5px solid transparent}.mvp-v20-actions .is-radio:before{content:"∞";color:#ffb550;font-size:17px;font-weight:900}.mvp-v20-actions button>span{display:grid;gap:1px;text-align:left}.mvp-v20-actions strong{font-size:7.3px;letter-spacing:.09em}.mvp-v20-actions small{font-size:5.8px;color:#637d87}.mvp-v20-actions button:disabled{opacity:.32;cursor:default}
        .mvp-v20-analysisDot{display:flex;align-items:center;gap:6px;color:#718993;font-size:6px;font-weight:1000;letter-spacing:.1em}.mvp-v20-analysisDot i{width:7px;height:7px;border-radius:50%;background:#607580}.mvp-v20-analysisDot.is-live{color:#81edb1}.mvp-v20-analysisDot.is-live i{background:#50e59b;box-shadow:0 0 10px rgba(72,229,153,.34)}
        .mvp-v20-dna{padding:13px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.mvp-v20-dna>div{min-height:74px;padding:10px 11px;border:1px solid rgba(101,167,188,.10);border-radius:10px;background:linear-gradient(180deg,#06151b,#030c10);position:relative;overflow:hidden}.mvp-v20-dna>div:before{content:"";position:absolute;inset:auto 0 0;height:1px;background:linear-gradient(90deg,transparent,#42d7ff,transparent);opacity:calc(.20 + var(--dna-i) * .04)}.mvp-v20-dna span{display:block;color:#718b95;font-size:6px;font-weight:1000;letter-spacing:.1em}.mvp-v20-dna strong{display:block;margin:6px 0 8px;color:#f7fdff;font-size:22px;line-height:1;letter-spacing:-.04em}.mvp-v20-dna i{height:3px;display:block;border-radius:99px;background:#02070a;overflow:hidden}.mvp-v20-dna i b{display:block;width:var(--dna);height:100%;border-radius:inherit;background:linear-gradient(90deg,#24a8d2,#64e1ff 70%,#ff9d2c);box-shadow:0 0 9px rgba(66,211,246,.22)}
        .mvp-v20-territory>header>small{font-size:6px;color:#617984;font-weight:1000;letter-spacing:.11em}.mvp-v20-taste{padding:13px;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.mvp-v20-taste button{position:relative;min-height:128px;padding:12px 11px 11px;display:grid;grid-template-rows:auto 1fr auto;gap:9px;text-align:left;border:1px solid rgba(101,173,196,.10);border-radius:11px;background:radial-gradient(170px 90px at 20% 0%,rgba(51,197,236,.08),transparent 70%),linear-gradient(180deg,#06141a,#030b0f);color:#eefaff;cursor:pointer;overflow:hidden;transition:.16s ease}.mvp-v20-taste button:nth-child(2n){background:radial-gradient(170px 90px at 20% 0%,rgba(255,151,36,.06),transparent 70%),linear-gradient(180deg,#06141a,#030b0f)}.mvp-v20-clusterIndex{font-size:6px;color:#5c737d;font-weight:1000;letter-spacing:.11em}.mvp-v20-taste button>div{align-self:end;display:grid;gap:2px}.mvp-v20-taste button>div>span{font-size:7px;font-weight:1000;letter-spacing:.08em;color:#9fdff0}.mvp-v20-taste button strong{font-size:28px;line-height:1;color:#fff;letter-spacing:-.05em}.mvp-v20-taste button small{font-size:6px;color:#647d87;line-height:1.35}.mvp-v20-taste button>i{height:2px;border-radius:99px;background:#02080b;overflow:hidden}.mvp-v20-taste button>i b{height:100%;display:block;background:linear-gradient(90deg,#3ccff6,#70e6ff 72%,#ff9d2c)}
        .mvp-v20-prGrid{padding:10px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.mvp-v20-prGrid article{min-height:62px;padding:8px 9px;display:grid;grid-template-columns:28px minmax(0,1fr) 38px;gap:9px;align-items:center;border:1px solid rgba(101,165,185,.09);border-radius:10px;background:linear-gradient(180deg,#06141a,#030c10)}.mvp-v20-prIndex{font-size:8px;color:#58717b;font-weight:1000}.mvp-v20-prGrid article>div{min-width:0;display:grid;gap:1px}.mvp-v20-prGrid strong{font-size:10px;color:#f1fbfe;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mvp-v20-prGrid article>div>span{font-size:7px;color:#8fc0ce}.mvp-v20-prGrid small{font-size:5.8px;color:#5e7882;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mvp-v20-prGrid button{width:35px;height:35px;border:1px solid rgba(75,199,236,.20);border-radius:50%;background:#061820;display:grid;place-items:center;cursor:pointer}.mvp-v20-prGrid button i{margin-left:2px;border-left:7px solid #78e3ff;border-top:4px solid transparent;border-bottom:4px solid transparent}
        .mvp-v20-empty{min-height:120px;display:grid;place-items:center;padding:18px;color:#607984;font-size:7px;font-weight:900;letter-spacing:.10em;text-align:center}

        /* R20 luminous interaction rule: hover must add light, never subtract it. */
        .mvp-v20-intel button:not(:disabled):hover{transform:translateY(-1px);filter:brightness(1.16) saturate(1.06);border-color:rgba(105,226,255,.34)!important;box-shadow:inset 0 1px rgba(255,255,255,.07),0 10px 24px rgba(0,0,0,.18),0 0 23px rgba(58,207,245,.08)!important}
        .mvp-v20-actions button:not(:disabled):hover{background:linear-gradient(180deg,#0d3442,#071c24)!important}.mvp-v20-core>button:not(:disabled):hover{background:linear-gradient(180deg,#0d3441,#071b23)!important}.mvp-v20-core>button.is-on:not(:disabled):hover{background:linear-gradient(180deg,#10432e,#082219)!important}
        .mvp-v20-taste button:not(:disabled):hover{background:radial-gradient(190px 100px at 20% 0%,rgba(73,218,255,.16),transparent 70%),linear-gradient(180deg,#0a2530,#051218)!important}.mvp-v20-prGrid button:not(:disabled):hover{background:#0b2f3b!important}
        .mvp-v20-intel button:not(:disabled):active{transform:translateY(1px);filter:brightness(1.08)}

        @media(max-width:900px){.mvp-v20-command{grid-template-columns:1fr}.mvp-v20-core{grid-template-columns:112px 1fr}.mvp-v20-coreOrb{width:104px;height:104px}.mvp-v20-dual{grid-template-columns:1fr}.mvp-v20-taste{grid-template-columns:repeat(3,1fr)}.mvp-v20-taste button:nth-last-child(-n+2){min-height:105px}}
        @media(max-width:760px){.mvp-v20-intel{padding:9px!important;gap:10px!important}.mvp-v20-command{padding:18px 15px;gap:18px;border-radius:15px}.mvp-v20-command:after{left:15px;right:15px}.mvp-v20-command h2{font-size:36px}.mvp-v20-commandCopy>p{font-size:9px}.mvp-v20-core{grid-template-columns:92px 1fr;padding:12px;gap:10px}.mvp-v20-coreOrb{width:84px;height:84px}.mvp-v20-coreOrb b{font-size:22px}.mvp-v20-corePulse{transform:translate(28px,-22px)}.mvp-v20-core>button{min-height:40px}.mvp-v20-neural{grid-template-columns:42px 1fr;padding:10px}.mvp-v20-neuralState{grid-column:2}.mvp-v20-neuralCopy small{white-space:normal;line-height:1.5}.mvp-v20-dna{grid-template-columns:repeat(3,1fr);padding:9px}.mvp-v20-dna>div{min-height:68px;padding:8px}.mvp-v20-dna strong{font-size:19px}.mvp-v20-taste{grid-template-columns:repeat(2,1fr);padding:9px}.mvp-v20-taste button{min-height:108px}.mvp-v20-prGrid{grid-template-columns:1fr}.mvp-v20-actions{grid-template-columns:1fr 1fr;padding:10px 12px 13px}.mvp-v20-memory>header,.mvp-v20-dnaPanel>header,.mvp-v20-territory>header,.mvp-v20-pr>header{padding:13px}.mvp-v20-memoryGauge{padding:13px 13px 5px}}
        @media(max-width:430px){.mvp-v20-command h2{font-size:32px}.mvp-v20-liveTrack{padding-left:10px}.mvp-v20-core{grid-template-columns:78px 1fr}.mvp-v20-coreOrb{width:72px;height:72px}.mvp-v20-coreOrb:before{inset:8px}.mvp-v20-coreData strong{font-size:10px}.mvp-v20-core>button{grid-column:1/-1}.mvp-v20-actions{grid-template-columns:1fr}.mvp-v20-dna{grid-template-columns:repeat(2,1fr)}.mvp-v20-taste{grid-template-columns:1fr 1fr}.mvp-v20-taste button{min-height:100px}.mvp-v20-intel header h3{font-size:16px}}
        @media(hover:none){.mvp-v20-intel button:not(:disabled):hover{transform:none;filter:none}.mvp-v20-intel button:not(:disabled):active{transform:scale(.985);filter:brightness(1.12)}}
      `}</style>
    </section>
  );
}
