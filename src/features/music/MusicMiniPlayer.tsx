import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { getMusicArtworkSignedUrl } from "../../lib/musicStorage";
import {
  listMusicPlaylists,
  listMusicPlaylistTrackLinks,
  type MusicPlaylist,
} from "../../lib/playlistStorage";
import {
  activateAllMusicTracks,
  activateMusicPlaylistQueue,
  applyMusicEqPreset,
  cycleMusicRepeat,
  formatMusicTime,
  getMusicVisualizerLevels,
  loadMusicLibrary,
  MUSIC_EQ_FREQUENCIES,
  MUSIC_EQ_PRESETS,
  MUSIC_HEADPHONE_MODES,
  nextMusicTrack,
  pauseMusic,
  playMusic,
  playMusicPlaylist,
  previousMusicTrack,
  saveMusicEqCustomPreset,
  seekMusic,
  setMusicEqBand,
  setMusicEqEnabled,
  setMusicHeadphoneBassImpact,
  setMusicHeadphoneCenter,
  setMusicHeadphoneCrossfeed,
  setMusicHeadphoneDepth,
  setMusicHeadphoneMode,
  setMusicHeadphoneWidth,
  setMusicPreamp,
  stopMusic,
  toggleMusicShuffle,
  useMusicPlayer,
  type MusicCustomPresetSlot,
  type MusicEqPreset,
  type MusicHeadphoneMode,
} from "../../lib/musicPlayer";

const PLAYLISTS_CHANGED_EVENT = "mvp:music-playlists-changed";

type IconName =
  | "back"
  | "next"
  | "play"
  | "pause"
  | "stop"
  | "shuffle"
  | "repeat"
  | "equalizer"
  | "music";

type SpectrumTelemetry = {
  bass: number;
  peak: number;
};

function PlayerIcon({ name }: { name: IconName }) {
  if (name === "play") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M8 5.4v13.2L19 12 8 5.4Z" />
      </svg>
    );
  }
  if (name === "pause") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" />
      </svg>
    );
  }
  if (name === "stop") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="6" y="6" width="12" height="12" rx="1.6" />
      </svg>
    );
  }
  if (name === "back") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M5 6h2.5v12H5V6Zm3.8 6 9.7-6v12l-9.7-6Z" />
      </svg>
    );
  }
  if (name === "next") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M16.5 6H19v12h-2.5V6ZM5.5 6l9.7 6-9.7 6V6Z" />
      </svg>
    );
  }
  if (name === "shuffle") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M16.8 4.5H20V7.7h-2V6.9l-3.7 3.7-1.4-1.4 3.6-3.6h-.7v-2Zm-12.8 2h3.2c1.6 0 2.7.5 3.7 1.5l6.8 6.8V14H20v5.5h-5.5v-2h1.8l-6.8-6.8c-.6-.6-1.2-.8-2.3-.8H4v-3.4Zm0 11h3.2c1.1 0 1.7-.2 2.3-.8l1.5-1.5 1.4 1.4-1.5 1.5c-1 1-2.1 1.4-3.7 1.4H4v-2Z" />
      </svg>
    );
  }
  if (name === "repeat") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M7 5h9.3l-1.8-1.8L16 1.8 20.2 6 16 10.2l-1.5-1.4L16.3 7H7a3 3 0 0 0-3 3v1H2v-1a5 5 0 0 1 5-5Zm15 8v1a5 5 0 0 1-5 5H7.7l1.8 1.8L8 22.2 3.8 18 8 13.8l1.5 1.4L7.7 17H17a3 3 0 0 0 3-3v-1h2Z" />
      </svg>
    );
  }
  if (name === "equalizer") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M5 3h2v18H5V3Zm6 4h2v14h-2V7Zm6-4h2v18h-2V3ZM3 8h6v3H3V8Zm6 5h6v3H9v-3Zm6-4h6v3h-6V9Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M9 4v11.1A4.5 4.5 0 1 0 11 19V8.1l8-2V12a4.5 4.5 0 1 0 2 3.9V2L9 4Z" />
    </svg>
  );
}

function Spectrum({
  playing,
  onTelemetry,
}: {
  playing: boolean;
  onTelemetry: (telemetry: SpectrumTelemetry) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<number[]>([]);
  const peakHoldRef = useRef<number[]>([]);
  const lastTelemetryRef = useRef(0);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const context = canvas.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, width, height);
      const levels = getMusicVisualizerLevels(48);
      if (peaksRef.current.length !== levels.length) {
        peaksRef.current = Array(levels.length).fill(0);
        peakHoldRef.current = Array(levels.length).fill(0);
      }

      const horizontalPadding = 7 * ratio;
      const topPadding = 4 * ratio;
      const bottomPadding = 6 * ratio;
      const usableWidth = Math.max(1, width - horizontalPadding * 2);
      const usableHeight = Math.max(1, height - topPadding - bottomPadding);
      const gap = Math.max(1.35 * ratio, usableWidth * 0.0024);
      const barWidth = Math.max(
        1.5 * ratio,
        (usableWidth - gap * (levels.length - 1)) / levels.length
      );

      const panelGradient = context.createLinearGradient(0, 0, 0, height);
      panelGradient.addColorStop(0, "rgba(2, 17, 27, .34)");
      panelGradient.addColorStop(1, "rgba(0, 2, 5, .7)");
      context.fillStyle = panelGradient;
      context.fillRect(0, 0, width, height);

      context.save();
      context.strokeStyle = "rgba(126, 204, 239, .085)";
      context.lineWidth = Math.max(1, ratio * 0.55);
      context.setLineDash([3 * ratio, 5 * ratio]);
      for (let line = 1; line <= 4; line += 1) {
        const y = topPadding + (usableHeight / 5) * line;
        context.beginPath();
        context.moveTo(horizontalPadding, y);
        context.lineTo(width - horizontalPadding, y);
        context.stroke();
      }
      context.restore();

      const zoneStops = [0.18, 0.36, 0.57, 0.78];
      context.save();
      context.strokeStyle = "rgba(255,255,255,.055)";
      context.lineWidth = Math.max(1, ratio * 0.45);
      for (const stop of zoneStops) {
        const x = horizontalPadding + usableWidth * stop;
        context.beginPath();
        context.moveTo(x, topPadding);
        context.lineTo(x, height - bottomPadding);
        context.stroke();
      }
      context.restore();

      let outputPeak = 0;
      let bassTotal = 0;
      const bassBands = Math.max(1, Math.floor(levels.length * 0.2));

      levels.forEach((level, index) => {
        const frequencyPosition = index / Math.max(1, levels.length - 1);
        const idleWave = playing
          ? 0
          : 0.014 + Math.sin(index * 0.7 + performance.now() / 680) * 0.006;
        const normalized = Math.max(idleWave, level);
        outputPeak = Math.max(outputPeak, normalized);
        if (index < bassBands) bassTotal += normalized;

        const barHeight = Math.max(2 * ratio, normalized * usableHeight * 0.94);
        const x = horizontalPadding + index * (barWidth + gap);
        const y = height - bottomPadding - barHeight;

        const hue = 32 + frequencyPosition * 171;
        const saturation = 94 - frequencyPosition * 16;
        const lightness = 48 + normalized * 18;
        const barGradient = context.createLinearGradient(0, height, 0, y);
        barGradient.addColorStop(0, `hsla(${hue}, ${saturation}%, 30%, .76)`);
        barGradient.addColorStop(0.58, `hsla(${hue}, ${saturation}%, ${lightness}%, .97)`);
        barGradient.addColorStop(
          1,
          `hsla(${Math.min(207, hue + 9)}, 95%, 79%, 1)`
        );

        context.fillStyle = barGradient;
        context.shadowColor = `hsla(${hue}, 93%, 61%, ${0.14 + normalized * 0.32})`;
        context.shadowBlur = normalized > 0.16 ? 7 * ratio : 0;
        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, Math.max(1, barWidth * 0.34));
        context.fill();

        const previousPeak = peaksRef.current[index] || 0;
        const nextPeak = Math.max(normalized, previousPeak - (playing ? 0.014 : 0.03));
        peaksRef.current[index] = nextPeak;

        const previousHold = peakHoldRef.current[index] || 0;
        const held = normalized >= previousHold ? normalized : Math.max(0, previousHold - 0.0045);
        peakHoldRef.current[index] = held;

        const peakY = height - bottomPadding - nextPeak * usableHeight * 0.94 - ratio;
        const holdY = height - bottomPadding - held * usableHeight * 0.94 - 3 * ratio;
        context.shadowBlur = 0;
        context.fillStyle =
          frequencyPosition < 0.34
            ? "rgba(255, 207, 119, .96)"
            : "rgba(143, 226, 255, .96)";
        context.fillRect(x, Math.max(topPadding, peakY), barWidth, Math.max(1, ratio));
        context.fillStyle = "rgba(255,255,255,.78)";
        context.fillRect(
          x,
          Math.max(topPadding, holdY),
          barWidth,
          Math.max(1, 0.7 * ratio)
        );
      });

      const now = performance.now();
      if (now - lastTelemetryRef.current > 120) {
        lastTelemetryRef.current = now;
        onTelemetry({
          bass: bassTotal / bassBands,
          peak: outputPeak,
        });
      }

      frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [onTelemetry, playing]);

  return (
    <div className="tr-audioSpectrumPanel" aria-label="Live 48-band music spectrum">
      <div className="tr-audioRtaHead">
        <span>LIVE RTA • 48 BAND</span>
        <span>LOG FREQUENCY SCALE</span>
        <span>PEAK HOLD</span>
      </div>
      <canvas ref={canvasRef} className="tr-audioSpectrum" />
      <div className="tr-audioSpectrumScale" aria-hidden>
        <span>SUB / LOW</span>
        <span>LOW-MID</span>
        <span>MID</span>
        <span>HIGH-MID</span>
        <span>AIR / HIGH</span>
      </div>
    </div>
  );
}

export function MusicMiniPlayer({ navigate }: { navigate: (to: string) => void }) {
  const player = useMusicPlayer();
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [eqOpen, setEqOpen] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<SpectrumTelemetry>({ bass: 0, peak: 0 });

  useEffect(() => {
    const refreshPlaylists = () => {
      void listMusicPlaylists()
        .then(setPlaylists)
        .catch(() => setPlaylists([]));
    };

    void loadMusicLibrary();
    refreshPlaylists();
    window.addEventListener(PLAYLISTS_CHANGED_EVENT, refreshPlaylists);
    return () => window.removeEventListener(PLAYLISTS_CHANGED_EVENT, refreshPlaylists);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const current = player.currentTrack;
    setArtworkUrl(null);
    if (!current?.artwork_path) return () => { cancelled = true; };

    void getMusicArtworkSignedUrl(current)
      .then((url) => {
        if (!cancelled) setArtworkUrl(url);
      })
      .catch(() => {
        if (!cancelled) setArtworkUrl(null);
      });

    return () => { cancelled = true; };
  }, [player.currentTrack?.id, player.currentTrack?.artwork_path]);

  const run = (action: () => void | Promise<void>) => {
    try {
      const result = action();
      if (result instanceof Promise) void result.catch(() => undefined);
    } catch {
      // The player state surfaces useful errors.
    }
  };

  async function selectQueue(value: string) {
    setQueueBusy(true);
    try {
      if (value === "all") {
        const wasPlaying = player.playing;
        activateAllMusicTracks();
        if (wasPlaying) await playMusic();
        return;
      }

      const playlist = playlists.find((item) => item.id === value);
      if (!playlist) return;
      const links = await listMusicPlaylistTrackLinks(playlist.id);
      const byId = new Map(player.libraryTracks.map((track) => [track.id, track]));
      const tracks = links
        .map((link) => byId.get(link.track_id))
        .filter((track): track is NonNullable<typeof track> => Boolean(track));

      if (player.playing) await playMusicPlaylist(playlist, tracks);
      else activateMusicPlaylistQueue(playlist, tracks);
    } finally {
      setQueueBusy(false);
    }
  }

  const track = player.currentTrack;
  const duration = Math.max(0, player.duration || track?.duration_seconds || 0);
  const currentTime = Math.min(
    duration || Number.MAX_SAFE_INTEGER,
    Math.max(0, player.currentTime)
  );
  const queueLabel = player.activePlaylistName || "All Uploaded Songs";
  const outputState = telemetry.peak > 0.94 ? "PEAK" : telemetry.peak > 0.78 ? "HOT" : "SAFE";

  const deckStyle = {
    "--tr-bass-energy": String(Math.min(1, Math.max(0, telemetry.bass))),
    "--tr-output-peak": String(Math.min(1, Math.max(0, telemetry.peak))),
  } as CSSProperties;

  return (
    <section
      className={`tr-audioDeck tr-audioDeck--v4 tr-audioDeck--pro7 ${player.playing ? "is-playing" : ""} ${
        player.loading || queueBusy ? "is-busy" : ""
      }`}
      style={deckStyle}
      aria-label="MVP Trainer music console"
    >
      <div className="tr-audioDeckTop">
        <button
          type="button"
          className="tr-audioArtwork"
          onClick={() => navigate("/music")}
          aria-label="Open My Music"
        >
          {artworkUrl ? (
            <img className="tr-audioArtworkImage" src={artworkUrl} alt="" />
          ) : (
            <span className="tr-audioArtworkFallback">
              <PlayerIcon name="music" />
            </span>
          )}
        </button>

        <button type="button" className="tr-audioIdentity" onClick={() => navigate("/music")}>
          <span className="tr-audioEyebrow">
            {player.playing ? "NOW PLAYING" : "MVP PERFORMANCE AUDIO"}
          </span>
          <strong>
            {track?.title || (player.loading ? "Loading music…" : "Your workout soundtrack")}
          </strong>
          <small>
            {track
              ? [track.artist || "MVP Trainer library", track.album].filter(Boolean).join(" • ")
              : "Choose a playlist or upload your music"}
          </small>
        </button>

        <div className="tr-audioQueueSelector">
          <span>PLAYING FROM</span>
          <select
            value={player.activePlaylistId || "all"}
            disabled={queueBusy}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              void selectQueue(event.target.value)
            }
            aria-label="Choose music playlist"
          >
            <option value="all">All Uploaded Songs</option>
            {playlists.map((playlist) => (
              <option key={playlist.id} value={playlist.id}>
                {playlist.name}
              </option>
            ))}
          </select>
          <small>{queueLabel}</small>
        </div>

        <button
          type="button"
          className={`tr-audioEqToggle ${eqOpen ? "is-active" : ""}`}
          onClick={() => setEqOpen((current) => !current)}
          aria-expanded={eqOpen}
        >
          <PlayerIcon name="equalizer" />
          <span>DSP</span>
        </button>
      </div>

      <div className="tr-audioTelemetry">
        <span className={player.playing ? "is-live" : ""}>
          <i /> {player.playing ? "RTA LIVE" : "RTA READY"}
        </span>
        <span>EQ {player.eqEnabled ? "ACTIVE" : "BYPASSED"}</span>
        <span>PEAK HOLD</span>
        <span className={`tr-audioOutputState is-${outputState.toLowerCase()}`}>
          OUTPUT {outputState}
        </span>
      </div>

      <Spectrum playing={player.playing} onTelemetry={setTelemetry} />

      <div className="tr-audioTimeline">
        <span>{formatMusicTime(currentTime)}</span>
        <input
          type="range"
          min="0"
          max={Math.max(1, duration)}
          step="1"
          value={Math.min(Math.max(1, duration), currentTime)}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            seekMusic(Number(event.target.value))
          }
          disabled={!track || !duration}
          aria-label="Music playback position"
        />
        <span>{formatMusicTime(duration)}</span>
      </div>

      <div className="tr-audioControls">
        <button
          type="button"
          className={`tr-audioModeButton ${player.shuffle ? "is-active" : ""}`}
          onClick={() => toggleMusicShuffle()}
          aria-label={`Shuffle ${player.shuffle ? "on" : "off"}`}
        >
          <PlayerIcon name="shuffle" />
          <span>SHUFFLE</span>
        </button>

        <div className="tr-audioTransport" aria-label="Music transport controls">
          <div className="tr-audioTransportUnit">
            <button
              type="button"
              className="tr-audioTransportButton"
              onClick={() => run(previousMusicTrack)}
              disabled={!player.tracks.length || player.loading || queueBusy}
              aria-label="Previous song"
            >
              <span className="tr-audioTransportFace">
                <PlayerIcon name="back" />
              </span>
            </button>
            <span>PREVIOUS</span>
          </div>

          <div className="tr-audioTransportUnit is-primary">
            <button
              type="button"
              className="tr-audioTransportButton tr-audioTransportButton--primary"
              onClick={() => run(player.playing ? pauseMusic : playMusic)}
              disabled={player.loading || queueBusy}
              aria-label={player.playing ? "Pause music" : "Play music"}
            >
              <span className="tr-audioTransportFace">
                <PlayerIcon name={player.playing ? "pause" : "play"} />
              </span>
            </button>
            <span>{player.playing ? "PAUSE" : "PLAY"}</span>
          </div>

          <div className="tr-audioTransportUnit">
            <button
              type="button"
              className="tr-audioTransportButton"
              onClick={() => stopMusic()}
              disabled={!track || player.loading || queueBusy}
              aria-label="Stop music"
            >
              <span className="tr-audioTransportFace">
                <PlayerIcon name="stop" />
              </span>
            </button>
            <span>STOP</span>
          </div>

          <div className="tr-audioTransportUnit">
            <button
              type="button"
              className="tr-audioTransportButton"
              onClick={() => run(() => nextMusicTrack())}
              disabled={!player.tracks.length || player.loading || queueBusy}
              aria-label="Next song"
            >
              <span className="tr-audioTransportFace">
                <PlayerIcon name="next" />
              </span>
            </button>
            <span>NEXT</span>
          </div>
        </div>

        <button
          type="button"
          className={`tr-audioModeButton ${player.repeat !== "off" ? "is-active" : ""}`}
          onClick={() => cycleMusicRepeat()}
          aria-label={`Repeat ${player.repeat}`}
        >
          <PlayerIcon name="repeat" />
          <span>{player.repeat === "one" ? "REPEAT 1" : "REPEAT TRACK"}</span>
        </button>
      </div>

      {eqOpen ? (
        <div className="tr-audioEqPanel tr-audioEqPanel--v4 tr-audioEqPanel--pro7">
          <div className="tr-audioEqHead">
            <div>
              <span className="tr-audioEyebrow">PERFORMANCE DSP</span>
              <strong>31-band 1/3-octave EQ + headphone immersion</strong>
            </div>
            <label className="tr-audioEqSwitch">
              <input
                type="checkbox"
                checked={player.eqEnabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setMusicEqEnabled(event.target.checked)
                }
              />
              <span>{player.eqEnabled ? "ACTIVE" : "BYPASS"}</span>
            </label>
            <label className="tr-audioEqPreset">
              <span>EQ PRESET</span>
              <select
                value={player.eqPreset}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  applyMusicEqPreset(event.target.value as MusicEqPreset)
                }
              >
                {Object.entries(MUSIC_EQ_PRESETS).map(([value, preset]) => (
                  <option key={value} value={value}>
                    {preset.label}
                  </option>
                ))}
                <option value="custom_1">Custom 1</option>
                <option value="custom_2">Custom 2</option>
                <option value="custom_3">Custom 3</option>
                <option value="custom">Unsaved Custom</option>
              </select>
            </label>
          </div>

          <div className="tr-audioDspSignalPath" aria-label="Audio processing path">
            <span>INPUT</span><i />
            <span>PREAMP</span><i />
            <span>31-BAND EQ</span><i />
            <span>HEADPHONE</span><i />
            <span>LIMITER / RTA</span><i />
            <span>OUTPUT</span>
          </div>

          <div className="tr-audioEqScroll" aria-label="31 band equalizer">
            <div className="tr-audioEqBands tr-audioEqBands--31">
              {MUSIC_EQ_FREQUENCIES.map((frequency, index) => (
                <label key={frequency} className="tr-audioEqBand">
                  <span className="tr-audioEqGain">
                    {Number(player.eqGains[index] || 0) > 0 ? "+" : ""}
                    {Number(player.eqGains[index] || 0).toFixed(0)}
                  </span>
                  <span className="tr-audioEqSliderShell">
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="0.5"
                      value={player.eqGains[index] || 0}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setMusicEqBand(index, Number(event.target.value))
                      }
                      aria-label={`${frequency} hertz equalizer gain`}
                    />
                  </span>
                  <span>
                    {frequency >= 1000
                      ? `${Number((frequency / 1000).toFixed(frequency % 1000 ? 2 : 0))}K`
                      : frequency}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="tr-audioEqFooter tr-audioEqFooter--pro7">
            <label className="tr-audioPreamp">
              <span>PREAMP</span>
              <input
                type="range"
                min="-12"
                max="6"
                step="0.5"
                value={player.preampDb}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setMusicPreamp(Number(event.target.value))
                }
              />
              <strong>
                {player.preampDb > 0 ? "+" : ""}
                {player.preampDb.toFixed(1)} dB
              </strong>
            </label>
            <div className="tr-audioEqQuickActions">
              <button type="button" onClick={() => applyMusicEqPreset("flat")}>FLAT</button>
              <button type="button" onClick={() => applyMusicEqPreset("power")}>POWER TRAINING</button>
            </div>
          </div>

          <div className="tr-customPresetRail" aria-label="Save custom equalizer presets">
            <span>SAVE CURRENT EQ</span>
            {(["custom_1", "custom_2", "custom_3"] as MusicCustomPresetSlot[]).map((slot, index) => (
              <button key={slot} type="button" onClick={() => saveMusicEqCustomPreset(slot)}>
                CUSTOM {index + 1}
              </button>
            ))}
          </div>

          <section className="tr-headphoneProcessor">
            <header>
              <div>
                <span className="tr-audioEyebrow">HEADPHONE IMMERSION</span>
                <strong>Virtual soundstage and natural crossfeed</strong>
              </div>
              <label>
                <span>MODE</span>
                <select
                  value={player.headphoneMode}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    setMusicHeadphoneMode(event.target.value as MusicHeadphoneMode)
                  }
                >
                  {Object.entries(MUSIC_HEADPHONE_MODES).map(([value, mode]) => (
                    <option key={value} value={value}>{mode.label}</option>
                  ))}
                </select>
              </label>
            </header>

            <div className="tr-headphoneModes">
              {(Object.entries(MUSIC_HEADPHONE_MODES) as Array<
                [MusicHeadphoneMode, (typeof MUSIC_HEADPHONE_MODES)[MusicHeadphoneMode]]
              >).map(([value, mode]) => (
                <button
                  key={value}
                  type="button"
                  className={player.headphoneMode === value ? "is-active" : ""}
                  onClick={() => setMusicHeadphoneMode(value)}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <div className="tr-headphoneControls">
              <label>
                <span>WIDTH <b>{player.headphoneWidth}%</b></span>
                <input type="range" min="0" max="100" value={player.headphoneWidth}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setMusicHeadphoneWidth(Number(event.target.value))} />
              </label>
              <label>
                <span>DEPTH <b>{player.headphoneDepth}%</b></span>
                <input type="range" min="0" max="100" value={player.headphoneDepth}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setMusicHeadphoneDepth(Number(event.target.value))} />
              </label>
              <label>
                <span>CROSSFEED <b>{player.headphoneCrossfeed}%</b></span>
                <input type="range" min="0" max="100" value={player.headphoneCrossfeed}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setMusicHeadphoneCrossfeed(Number(event.target.value))} />
              </label>
              <label>
                <span>CENTER FOCUS <b>{player.headphoneCenter}%</b></span>
                <input type="range" min="0" max="100" value={player.headphoneCenter}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setMusicHeadphoneCenter(Number(event.target.value))} />
              </label>
              <label>
                <span>BASS IMPACT <b>{player.headphoneBassImpact}%</b></span>
                <input type="range" min="0" max="100" value={player.headphoneBassImpact}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setMusicHeadphoneBassImpact(Number(event.target.value))} />
              </label>
            </div>
          </section>
        </div>
      ) : null}

      {player.error ? <div className="tr-audioError">{player.error}</div> : null}

      <style>{`
        .tr-audioDeck--pro7 .tr-audioArtwork{
          background:linear-gradient(180deg,#111a21,#070b0f)!important;
          border-color:rgba(132,196,221,.20)!important;
          box-shadow:0 5px 14px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.055)!important;
        }
        .tr-audioDeck--pro7 .tr-audioArtworkImage{width:100%;height:100%;object-fit:cover;display:block;}
        .tr-audioDeck--pro7 .tr-audioArtworkFallback{width:100%;height:100%;display:grid;place-items:center;background:linear-gradient(145deg,#132332,#09131c);color:#ffc061;}
        .tr-audioDeck--pro7 .tr-audioArtworkFallback svg{width:28px;height:28px;fill:currentColor;}
        .tr-audioDeck--pro7 .tr-audioTransportButton--primary::before{
          background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(95,30,0,.10))!important;
        }
        .tr-audioDeck--pro7 .tr-audioTransportButton--primary::after,
        .tr-audioDeck--pro7 .tr-audioTransportFace::before,
        .tr-audioDeck--pro7 .tr-audioTransportFace::after{display:none!important;content:none!important;}
        .tr-audioDeck--pro7 .tr-audioTransportButton--primary svg{filter:none!important;}
        .tr-audioEqPanel--pro7{overflow:hidden;}
        .tr-audioEqScroll{width:100%;overflow-x:auto;overscroll-behavior-x:contain;padding:2px 0 8px;scrollbar-width:thin;scrollbar-color:rgba(83,199,240,.35) rgba(255,255,255,.04);}
        .tr-audioEqBands--31{display:grid!important;grid-template-columns:repeat(31,minmax(42px,1fr))!important;gap:6px!important;min-width:1380px!important;}
        .tr-audioEqBands--31 .tr-audioEqBand{min-width:42px!important;padding:8px 4px!important;}
        .tr-audioEqBands--31 .tr-audioEqBand>span:last-child{font-size:7px!important;white-space:nowrap;}
        .tr-audioEqBands--31 .tr-audioEqGain{font-size:8px!important;}
        .tr-audioEqFooter--pro7{margin-top:5px;}
        .tr-customPresetRail{display:flex;align-items:center;justify-content:flex-end;gap:7px;margin-top:9px;padding-top:9px;border-top:1px solid rgba(118,204,236,.09);}
        .tr-customPresetRail>span{margin-right:auto;color:rgba(183,209,222,.54);font-size:8px;font-weight:1000;letter-spacing:.14em;}
        .tr-customPresetRail button,.tr-headphoneModes button{min-height:32px;padding:0 11px;border:1px solid rgba(124,195,220,.14);border-radius:9px;color:rgba(232,244,250,.78);background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(0,0,0,.18));font-size:8px;font-weight:1000;letter-spacing:.07em;cursor:pointer;}
        .tr-headphoneProcessor{margin-top:12px;padding:13px;border:1px solid rgba(71,186,229,.20);border-radius:14px;background:linear-gradient(180deg,rgba(11,27,38,.88),rgba(5,13,19,.92));box-shadow:inset 0 1px 0 rgba(255,255,255,.035);}
        .tr-headphoneProcessor header{display:grid;grid-template-columns:minmax(0,1fr) 190px;align-items:end;gap:12px;}
        .tr-headphoneProcessor header>div{display:grid;gap:3px;}.tr-headphoneProcessor header strong{color:#f4f9fc;font-size:12px;}
        .tr-headphoneProcessor header label{display:grid;gap:4px;}.tr-headphoneProcessor header label>span{color:rgba(180,204,217,.52);font-size:7px;font-weight:1000;letter-spacing:.14em;}
        .tr-headphoneProcessor select{min-height:35px;border:1px solid rgba(125,198,224,.16);border-radius:9px;color:#f2f8fb;background:#081119;padding:0 10px;font-weight:900;}
        .tr-headphoneModes{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px;}
        .tr-headphoneModes button.is-active{border-color:rgba(65,199,248,.52);color:#9de5ff;background:rgba(0,158,223,.11);box-shadow:inset 0 1px 0 rgba(255,255,255,.05);}
        .tr-headphoneControls{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:11px;}
        .tr-headphoneControls label{display:grid;gap:6px;padding:9px;border:1px solid rgba(255,255,255,.06);border-radius:10px;background:rgba(0,0,0,.15);}
        .tr-headphoneControls label>span{display:flex;justify-content:space-between;gap:6px;color:rgba(184,208,220,.55);font-size:7px;font-weight:1000;letter-spacing:.08em;}.tr-headphoneControls b{color:#91defb;}
        .tr-headphoneControls input{width:100%;}
        @media(max-width:760px){
          .tr-audioEqBands--31{grid-template-columns:repeat(31,44px)!important;min-width:1530px!important;}
          .tr-headphoneProcessor header{grid-template-columns:1fr;}
          .tr-headphoneControls{grid-template-columns:repeat(2,minmax(0,1fr));}
          .tr-customPresetRail{flex-wrap:wrap;justify-content:flex-start}.tr-customPresetRail>span{width:100%;margin:0;}
        }
      `}</style>
    </section>
  );
}
