import { useEffect, useRef, useState, type ChangeEvent } from "react";
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
  nextMusicTrack,
  pauseMusic,
  playMusic,
  playMusicPlaylist,
  previousMusicTrack,
  seekMusic,
  setMusicEqBand,
  setMusicEqEnabled,
  setMusicPreamp,
  stopMusic,
  toggleMusicShuffle,
  useMusicPlayer,
  type MusicEqPreset,
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

function PlayerIcon({ name }: { name: IconName }) {
  if (name === "play") {
    return <svg viewBox="0 0 24 24" aria-hidden><path d="M8 5.4v13.2L19 12 8 5.4Z" /></svg>;
  }
  if (name === "pause") {
    return <svg viewBox="0 0 24 24" aria-hidden><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" /></svg>;
  }
  if (name === "stop") {
    return <svg viewBox="0 0 24 24" aria-hidden><rect x="6" y="6" width="12" height="12" rx="1.6" /></svg>;
  }
  if (name === "back") {
    return <svg viewBox="0 0 24 24" aria-hidden><path d="M5 6h2.5v12H5V6Zm3.8 6 9.7-6v12l-9.7-6Z" /></svg>;
  }
  if (name === "next") {
    return <svg viewBox="0 0 24 24" aria-hidden><path d="M16.5 6H19v12h-2.5V6ZM5.5 6l9.7 6-9.7 6V6Z" /></svg>;
  }
  if (name === "shuffle") {
    return <svg viewBox="0 0 24 24" aria-hidden><path d="M16.8 4.5H20V7.7h-2V6.9l-3.7 3.7-1.4-1.4 3.6-3.6h-.7v-2Zm-12.8 2h3.2c1.6 0 2.7.5 3.7 1.5l6.8 6.8V14H20v5.5h-5.5v-2h1.8l-6.8-6.8c-.6-.6-1.2-.8-2.3-.8H4v-3.4Zm0 11h3.2c1.1 0 1.7-.2 2.3-.8l1.5-1.5 1.4 1.4-1.5 1.5c-1 1-2.1 1.4-3.7 1.4H4v-2Z" /></svg>;
  }
  if (name === "repeat") {
    return <svg viewBox="0 0 24 24" aria-hidden><path d="M7 5h9.3l-1.8-1.8L16 1.8 20.2 6 16 10.2l-1.5-1.4L16.3 7H7a3 3 0 0 0-3 3v1H2v-1a5 5 0 0 1 5-5Zm15 8v1a5 5 0 0 1-5 5H7.7l1.8 1.8L8 22.2 3.8 18 8 13.8l1.5 1.4L7.7 17H17a3 3 0 0 0 3-3v-1h2Z" /></svg>;
  }
  if (name === "equalizer") {
    return <svg viewBox="0 0 24 24" aria-hidden><path d="M5 3h2v18H5V3Zm6 4h2v14h-2V7Zm6-4h2v18h-2V3ZM3 8h6v3H3V8Zm6 5h6v3H9v-3Zm6-4h6v3h-6V9Z" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden><path d="M9 4v11.1A4.5 4.5 0 1 0 11 19V8.1l8-2V12a4.5 4.5 0 1 0 2 3.9V2L9 4Z" /></svg>;
}

function Spectrum({ playing }: { playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<number[]>([]);

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
      const levels = getMusicVisualizerLevels(44);
      if (peaksRef.current.length !== levels.length) {
        peaksRef.current = Array(levels.length).fill(0);
      }

      const horizontalPadding = 5 * ratio;
      const usableWidth = Math.max(1, width - horizontalPadding * 2);
      const gap = Math.max(1.6 * ratio, usableWidth * 0.0032);
      const barWidth = Math.max(
        1.6 * ratio,
        (usableWidth - gap * (levels.length - 1)) / levels.length
      );

      context.save();
      context.strokeStyle = "rgba(140, 205, 235, .075)";
      context.lineWidth = Math.max(1, ratio * 0.55);
      for (let line = 1; line <= 3; line += 1) {
        const y = (height / 4) * line;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
      context.restore();

      levels.forEach((level, index) => {
        const frequencyPosition = index / Math.max(1, levels.length - 1);
        const idleWave = playing
          ? 0
          : 0.018 + Math.sin(index * 0.72 + performance.now() / 620) * 0.008;
        const normalized = Math.max(idleWave, level);
        const barHeight = Math.max(2 * ratio, normalized * height * 0.88);
        const x = horizontalPadding + index * (barWidth + gap);
        const y = height - barHeight - 3 * ratio;

        const hue = 32 + frequencyPosition * 166;
        const saturation = 92 - frequencyPosition * 18;
        const lightness = 56 + normalized * 12;
        const barGradient = context.createLinearGradient(0, height, 0, y);
        barGradient.addColorStop(0, `hsla(${hue}, ${saturation}%, 38%, .78)`);
        barGradient.addColorStop(0.62, `hsla(${hue}, ${saturation}%, ${lightness}%, .96)`);
        barGradient.addColorStop(1, `hsla(${Math.min(205, hue + 10)}, 92%, 78%, 1)`);

        context.fillStyle = barGradient;
        context.shadowColor = `hsla(${hue}, 90%, 58%, .28)`;
        context.shadowBlur = normalized > 0.22 ? 7 * ratio : 0;
        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, Math.max(1, barWidth * 0.34));
        context.fill();

        const previousPeak = peaksRef.current[index] || 0;
        const nextPeak = Math.max(normalized, previousPeak - (playing ? 0.012 : 0.028));
        peaksRef.current[index] = nextPeak;
        const peakY = height - nextPeak * height * 0.88 - 5 * ratio;
        context.shadowBlur = 0;
        context.fillStyle = frequencyPosition < 0.35
          ? "rgba(255, 211, 132, .92)"
          : "rgba(153, 230, 255, .92)";
        context.fillRect(x, Math.max(1, peakY), barWidth, Math.max(1, 1.2 * ratio));
      });

      frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [playing]);

  return (
    <div className="tr-audioSpectrumPanel" aria-label="Live music spectrum from low to high frequencies">
      <canvas ref={canvasRef} className="tr-audioSpectrum" />
      <div className="tr-audioSpectrumScale" aria-hidden>
        <span>LOW</span>
        <span>LOW-MID</span>
        <span>MID</span>
        <span>HIGH-MID</span>
        <span>HIGH</span>
      </div>
    </div>
  );
}

export function MusicMiniPlayer({
  navigate,
}: {
  navigate: (to: string) => void;
}) {
  const player = useMusicPlayer();
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [eqOpen, setEqOpen] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);

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
  const duration = Math.max(
    0,
    player.duration || track?.duration_seconds || 0
  );
  const currentTime = Math.min(
    duration || Number.MAX_SAFE_INTEGER,
    Math.max(0, player.currentTime)
  );
  const queueLabel = player.activePlaylistName || "All Uploaded Songs";

  return (
    <section
      className={`tr-audioDeck ${player.playing ? "is-playing" : ""}`}
      aria-label="MVP Trainer music console"
    >
      <div className="tr-audioDeckTop">
        <button
          type="button"
          className="tr-audioArtwork"
          onClick={() => navigate("/music")}
          aria-label="Open My Music"
        >
          <PlayerIcon name="music" />
          <span className="tr-audioArtworkGlow" />
        </button>

        <button
          type="button"
          className="tr-audioIdentity"
          onClick={() => navigate("/music")}
        >
          <span className="tr-audioEyebrow">
            {player.playing ? "NOW PLAYING" : "MVP AUDIO SYSTEM"}
          </span>
          <strong>
            {track?.title || (player.loading ? "Loading music…" : "Your workout soundtrack")}
          </strong>
          <small>
            {track
              ? track.artist || "MVP Trainer library"
              : "Choose a playlist or upload your music"}
          </small>
        </button>

        <div className="tr-audioQueueSelector">
          <span>PLAYING FROM</span>
          <select
            value={player.activePlaylistId || "all"}
            disabled={queueBusy}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => void selectQueue(event.target.value)}
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
          <span>EQ</span>
        </button>
      </div>

      <Spectrum playing={player.playing} />

      <div className="tr-audioTimeline">
        <span>{formatMusicTime(currentTime)}</span>
        <input
          type="range"
          min="0"
          max={Math.max(1, duration)}
          step="1"
          value={Math.min(Math.max(1, duration), currentTime)}
          onChange={(event: ChangeEvent<HTMLInputElement>) => seekMusic(Number(event.target.value))}
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
              disabled={!player.tracks.length}
              aria-label="Previous song"
            >
              <span className="tr-audioTransportFace"><PlayerIcon name="back" /></span>
            </button>
            <span>PREVIOUS</span>
          </div>

          <div className="tr-audioTransportUnit is-primary">
            <button
              type="button"
              className="tr-audioTransportButton tr-audioTransportButton--primary"
              onClick={() => run(player.playing ? pauseMusic : playMusic)}
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
              disabled={!track}
              aria-label="Stop music"
            >
              <span className="tr-audioTransportFace"><PlayerIcon name="stop" /></span>
            </button>
            <span>STOP</span>
          </div>

          <div className="tr-audioTransportUnit">
            <button
              type="button"
              className="tr-audioTransportButton"
              onClick={() => run(() => nextMusicTrack())}
              disabled={!player.tracks.length}
              aria-label="Next song"
            >
              <span className="tr-audioTransportFace"><PlayerIcon name="next" /></span>
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
          <span>{player.repeat === "one" ? "REPEAT 1" : "REPEAT"}</span>
        </button>
      </div>

      {eqOpen ? (
        <div className="tr-audioEqPanel">
          <div className="tr-audioEqHead">
            <div>
              <span className="tr-audioEyebrow">10-BAND EQUALIZER</span>
              <strong>Shape your workout sound</strong>
            </div>
            <label className="tr-audioEqSwitch">
              <input
                type="checkbox"
                checked={player.eqEnabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setMusicEqEnabled(event.target.checked)}
              />
              <span>{player.eqEnabled ? "ON" : "OFF"}</span>
            </label>
            <label className="tr-audioEqPreset">
              <span>PRESET</span>
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
                <option value="custom">Custom</option>
              </select>
            </label>
          </div>

          <div className="tr-audioEqBands">
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
                    step="1"
                    value={player.eqGains[index] || 0}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setMusicEqBand(index, Number(event.target.value))
                    }
                    aria-label={`${frequency} hertz equalizer gain`}
                  />
                </span>
                <span>{frequency >= 1000 ? `${frequency / 1000}K` : frequency}</span>
              </label>
            ))}
          </div>

          <label className="tr-audioPreamp">
            <span>PREAMP</span>
            <input
              type="range"
              min="-12"
              max="6"
              step="1"
              value={player.preampDb}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setMusicPreamp(Number(event.target.value))}
            />
            <strong>
              {player.preampDb > 0 ? "+" : ""}
              {player.preampDb.toFixed(0)} dB
            </strong>
          </label>
        </div>
      ) : null}

      {player.error ? <div className="tr-audioError">{player.error}</div> : null}
    </section>
  );
}
