import { useMemo, useState } from "react";
import type { MusicTrack } from "../../lib/musicStorage";
import {
  playMusicAdHocQueue,
  playMusicTrack,
  startMvpNeuralRadio,
  useMusicPlayer,
} from "../../lib/musicPlayer";
import {
  buildDiscoveryRadar,
  buildTasteMap,
  getSongDna,
  getWorkoutMusicStage,
  isAutoMixEnabled,
  listPrSoundtracks,
  radioModeLabel,
  setAutoMixEnabled,
  type MusicRadioMode,
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

  const radar = useMemo(() => buildDiscoveryRadar(tracks), [tracks]);
  const tasteMap = useMemo(() => buildTasteMap(tracks), [tracks]);
  const prSoundtracks = listPrSoundtracks();
  const stage = getWorkoutMusicStage();

  const startRadio = (mode: MusicRadioMode) => {
    if (!player.currentTrack) {
      setMessage("Play a song first, then choose a Neural direction.");
      return;
    }

    try {
      const queue = startMvpNeuralRadio(player.currentTrack.id, mode);
      setMessage(
        `${radioModeLabel(mode)} • ${queue.length} library matches ready`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not start Neural Radio.",
      );
    }
  };

  const toggleAutoMix = () => {
    const next = !autoMix;
    setAutoMix(next);
    setAutoMixEnabled(next);
    setMessage(next ? "AutoMix Flow enabled." : "AutoMix Flow disabled.");
  };

  return (
    <section className="mvp-v5-intel">
      <header className="mvp-v5-hero">
        <div>
          <span>MVP MUSIC INTELLIGENCE</span>
          <h2>Neural Radio</h2>
          <p>
            Your uploaded library reshaped around the current song,
            your listening history, and the stage of your workout.
          </p>
        </div>

        <div className="mvp-v5-live">
          <small>WORKOUT STAGE</small>
          <strong>{stage.toUpperCase()}</strong>
          <button
            type="button"
            className={autoMix ? "is-on" : ""}
            onClick={toggleAutoMix}
          >
            AUTOMIX {autoMix ? "ON" : "OFF"}
          </button>
        </div>
      </header>

      {message ? <div className="mvp-v5-message">{message}</div> : null}

      <div className="mvp-v5-modes">
        {(
          [
            "more_like_this",
            "harder",
            "heavier",
            "faster",
            "melodic",
          ] as MusicRadioMode[]
        ).map((mode) => (
          <button
            type="button"
            key={mode}
            disabled={!player.currentTrack}
            onClick={() => startRadio(mode)}
          >
            <small>MVP NEURAL</small>
            <strong>{radioModeLabel(mode).toUpperCase()}</strong>
          </button>
        ))}
      </div>

      <section className="mvp-v5-block">
        <header>
          <div>
            <span>PERMANENT COLLECTION</span>
            <h3>Liked Songs</h3>
            <p>
              Every Like is synchronized here. Your manual playlists
              are never edited.
            </p>
          </div>
          <b>{likedTracks.length}</b>
        </header>

        <div className="mvp-v5-actions">
          <button
            type="button"
            disabled={!likedTracks.length}
            onClick={() =>
              void playMusicAdHocQueue("Liked Songs", likedTracks)
            }
          >
            ▶ PLAY LIKED
          </button>

          <button
            type="button"
            disabled={!likedTracks.length}
            onClick={() => {
              const seed = likedTracks[0];
              if (!seed) return;
              const queue = startMvpNeuralRadio(
                seed.id,
                "more_like_this",
              );
              setMessage(
                `Liked Radio • ${queue.length} library matches ready`,
              );
            }}
          >
            ∞ LIKED RADIO
          </button>
        </div>
      </section>

      <section className="mvp-v5-block">
        <header>
          <div>
            <span>LIVE ANALYSIS</span>
            <h3>Song DNA</h3>
            <p>
              {player.currentTrack
                ? `${player.currentTrack.title} • ${
                    player.currentTrack.artist || "Unknown Artist"
                  }`
                : "Play a song to expose its intelligence profile."}
            </p>
          </div>
        </header>

        {dna ? (
          <div className="mvp-v5-dna">
            {(
              [
                ["ENERGY", dna.energy],
                ["HEAVY", dna.heavy],
                ["MELODIC", dna.melodic],
                ["DARK", dna.dark],
                ["DRIVE", dna.drive],
                ["WORKOUT FIT", dna.workoutFit],
              ] as Array<[string, number]>
            ).map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{String(value).padStart(2, "0")}</strong>
                <i>
                  <b style={{ width: `${value}%` }} />
                </i>
              </div>
            ))}
          </div>
        ) : (
          <div className="mvp-v5-empty">NO ACTIVE SONG</div>
        )}
      </section>

      <section className="mvp-v5-block">
        <header>
          <div>
            <span>DISCOVERY RADAR</span>
            <h3>Bring your library back to life</h3>
            <p>
              Forgotten favorites, deep cuts, rarely played tracks,
              and high-energy rediscovery.
            </p>
          </div>
        </header>

        <div className="mvp-v5-radar">
          {radar.map((lane) => (
            <article key={lane.id}>
              <small>{lane.tracks.length} TRACKS</small>
              <h4>{lane.title}</h4>
              <p>{lane.subtitle}</p>
              <button
                type="button"
                disabled={!lane.tracks.length}
                onClick={() =>
                  void playMusicAdHocQueue(
                    `Radar • ${lane.title}`,
                    lane.tracks,
                  )
                }
              >
                ▶ PLAY
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="mvp-v5-block">
        <header>
          <div>
            <span>SONIC TERRITORY</span>
            <h3>Taste Map</h3>
            <p>Explore your library by musical character.</p>
          </div>
        </header>

        <div className="mvp-v5-taste">
          {tasteMap.map((cluster) => (
            <button
              type="button"
              key={cluster.id}
              disabled={!cluster.tracks.length}
              onClick={() =>
                void playMusicAdHocQueue(
                  `Taste Map • ${cluster.label}`,
                  cluster.tracks,
                )
              }
            >
              <span>{cluster.label}</span>
              <strong>{cluster.score}</strong>
              <small>{cluster.subtitle}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="mvp-v5-block">
        <header>
          <div>
            <span>PERFORMANCE MEMORY</span>
            <h3>PR Soundtrack</h3>
            <p>Songs playing when you hit personal records.</p>
          </div>
          <b>{prSoundtracks.length}</b>
        </header>

        {prSoundtracks.length ? (
          <div className="mvp-v5-pr">
            {prSoundtracks.slice(0, 12).map((record) => (
              <article key={record.id}>
                <strong>{record.title}</strong>
                <span>{record.artist}</span>
                <small>
                  {record.exerciseName} • SET {record.setNumber} •{" "}
                  {record.records.join(" + ")}
                </small>
                <button
                  type="button"
                  onClick={() => void playMusicTrack(record.trackId, 0)}
                >
                  ▶
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="mvp-v5-empty">
            PR songs will appear automatically when a PR is detected
            while music is playing.
          </div>
        )}
      </section>

      <style>{`
        .mvp-v5-intel{padding:11px;display:grid;gap:10px;background:radial-gradient(circle at 15% 0%,rgba(28,116,145,.13),transparent 34%),#03090d}
        .mvp-v5-hero{padding:17px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;border:1px solid rgba(84,196,231,.22);border-radius:13px;background:linear-gradient(135deg,#081b24,#051016 58%,#071820)}
        .mvp-v5-hero span,.mvp-v5-block>header span{color:#5dd8fa;font-size:7px;font-weight:1000;letter-spacing:.15em}
        .mvp-v5-hero h2{margin:4px 0;font-size:27px;color:#f5fcff}.mvp-v5-hero p,.mvp-v5-block>header p{margin:0;color:#8aa4ae;font-size:9px}
        .mvp-v5-live{min-width:150px;padding:10px;border:1px solid rgba(105,184,210,.14);border-radius:10px;background:#061117;display:grid;gap:5px}
        .mvp-v5-live small{font-size:6px;color:#718993;font-weight:1000}.mvp-v5-live strong{font-size:14px}
        .mvp-v5-live button{height:31px;border:1px solid rgba(116,156,170,.18);border-radius:7px;background:#071219;color:#a7bac1;font-size:8px;font-weight:1000}.mvp-v5-live button.is-on{border-color:rgba(61,210,245,.46);color:#baf1ff;background:#0a2b36}
        .mvp-v5-message{padding:9px 11px;border:1px solid rgba(76,204,244,.18);border-radius:8px;background:#07151c;color:#9ee9fb;font-size:8px;font-weight:850}
        .mvp-v5-modes{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px}.mvp-v5-modes button{min-height:62px;padding:9px;border:1px solid rgba(80,179,214,.16);border-radius:10px;background:linear-gradient(180deg,#081820,#051016);color:#fff;text-align:left}.mvp-v5-modes button:hover:not(:disabled){border-color:rgba(72,212,250,.48);background:#092430}.mvp-v5-modes button:disabled{opacity:.32}.mvp-v5-modes small{display:block;color:#5b8594;font-size:6px;font-weight:1000}.mvp-v5-modes strong{display:block;margin-top:6px;font-size:8px;letter-spacing:.03em}
        .mvp-v5-block{border:1px solid rgba(94,165,190,.12);border-radius:12px;background:#050e13;overflow:hidden}.mvp-v5-block>header{padding:12px 13px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(91,160,185,.09)}.mvp-v5-block>header h3{margin:3px 0;font-size:16px;color:#f4fbfe}.mvp-v5-block>header>b{font-size:25px;color:#67daf9}
        .mvp-v5-actions{padding:10px;display:flex;gap:7px}.mvp-v5-actions button,.mvp-v5-radar button{height:35px;padding:0 12px;border:1px solid rgba(61,204,244,.28);border-radius:8px;background:#08242e;color:#eafaff;font-size:8px;font-weight:1000}.mvp-v5-actions button:disabled,.mvp-v5-radar button:disabled{opacity:.3}
        .mvp-v5-dna{padding:10px;display:grid;grid-template-columns:repeat(6,1fr);gap:6px}.mvp-v5-dna>div{padding:9px;border:1px solid rgba(102,163,184,.1);border-radius:9px;background:#071218}.mvp-v5-dna span{display:block;color:#79939d;font-size:6px;font-weight:1000}.mvp-v5-dna strong{display:block;margin:4px 0 6px;color:#fff;font-size:18px}.mvp-v5-dna i{height:3px;display:block;background:#02070a;border-radius:4px;overflow:hidden}.mvp-v5-dna i b{height:100%;display:block;background:linear-gradient(90deg,#2584a3,#61daf8)}
        .mvp-v5-radar{padding:10px;display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.mvp-v5-radar article{padding:10px;border:1px solid rgba(92,160,184,.1);border-radius:9px;background:#071219}.mvp-v5-radar small{color:#54c9ec;font-size:6px;font-weight:1000}.mvp-v5-radar h4{margin:5px 0 3px;color:#fff;font-size:11px}.mvp-v5-radar p{min-height:27px;margin:0 0 8px;color:#78919b;font-size:7px}
        .mvp-v5-taste{padding:14px;display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.mvp-v5-taste button{min-height:112px;padding:12px;border:1px solid rgba(85,177,209,.15);border-radius:50%;background:radial-gradient(circle,rgba(52,178,218,.17),#061219 68%);color:#fff}.mvp-v5-taste span,.mvp-v5-taste strong,.mvp-v5-taste small{display:block}.mvp-v5-taste span{font-size:7px;font-weight:1000}.mvp-v5-taste strong{margin:5px 0;font-size:21px}.mvp-v5-taste small{font-size:6px;color:#8ba4ad}
        .mvp-v5-pr{padding:9px;display:grid;gap:5px}.mvp-v5-pr article{display:grid;grid-template-columns:minmax(0,1fr) auto;padding:8px 9px;border:1px solid rgba(101,166,188,.09);border-radius:8px;background:#071218}.mvp-v5-pr span,.mvp-v5-pr small{grid-column:1;color:#8da4ad;font-size:7px}.mvp-v5-pr button{grid-column:2;grid-row:1/4;width:34px;height:34px;align-self:center;border:1px solid rgba(66,205,245,.27);border-radius:50%;background:#082630;color:#fff}
        .mvp-v5-empty{padding:18px;color:#8099a3;font-size:8px;text-align:center}
        @media(max-width:760px){.mvp-v5-intel{padding:7px}.mvp-v5-hero{grid-template-columns:1fr;padding:12px}.mvp-v5-hero h2{font-size:23px}.mvp-v5-modes{grid-template-columns:repeat(2,1fr)}.mvp-v5-modes button:first-child{grid-column:1/-1}.mvp-v5-dna{grid-template-columns:repeat(3,1fr)}.mvp-v5-radar{grid-template-columns:1fr 1fr}.mvp-v5-taste{grid-template-columns:repeat(2,1fr)}.mvp-v5-taste button:last-child{grid-column:1/-1;border-radius:12px;min-height:84px}}
      `}</style>
    </section>
  );
}
