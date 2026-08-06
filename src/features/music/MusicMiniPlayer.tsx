import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
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
  getNextMusicTrackPreview,
  loadMusicLibrary,
  MUSIC_EQ_FREQUENCIES,
  MUSIC_EQ_PRESETS,
  nextMusicTrack,
  pauseMusic,
  playMusic,
  playMusicPlaylist,
  previousMusicTrack,
  seekMusic,
  setMusicCrossfadeSeconds,
  setMusicDuckingStrength,
  setMusicEqBand,
  setMusicEqEnabled,
  setMusicLimiterEnabled,
  setMusicNormalizationEnabled,
  setMusicPreamp,
  stopMusic,
  toggleMusicShuffle,
  useMusicPlayer,
  type MusicDuckingStrength,
  type MusicEqPreset,
} from "../../lib/musicPlayer";

const PLAYLISTS_CHANGED_EVENT = "mvp:music-playlists-changed";
const PLAYER_EXPANDED_KEY = "mvp:performance-audio-expanded";

type IconName =
  | "back"
  | "next"
  | "play"
  | "pause"
  | "stop"
  | "shuffle"
  | "repeat"
  | "equalizer"
  | "music"
  | "expand"
  | "collapse"
  | "library"
  | "queue"
  | "settings"
  | "check";

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

  if (name === "expand") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M4 9V4h5v2H6v3H4Zm11-5h5v5h-2V6h-3V4ZM6 15v3h3v2H4v-5h2Zm12 0h2v5h-5v-2h3v-3Z" />
      </svg>
    );
  }

  if (name === "collapse") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M9 4v5H4V7h3V4h2Zm6 0h2v3h3v2h-5V4ZM4 15h5v5H7v-3H4v-2Zm11 0h5v2h-3v3h-2v-5Z" />
      </svg>
    );
  }

  if (name === "library") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M4 4h3v16H4V4Zm5 0h3v16H9V4Zm5.2 1.1 2.9-.8 4.2 14.9-2.9.8-4.2-14.9Z" />
      </svg>
    );
  }

  if (name === "queue") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M4 6h10v2H4V6Zm0 5h10v2H4v-2Zm0 5h7v2H4v-2Zm13-4.5 5 3.5-5 3.5v-7Z" />
      </svg>
    );
  }

  if (name === "settings") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M10.9 2h2.2l.6 2.1c.6.2 1.1.4 1.6.7l2-.9 1.6 1.6-.9 2c.3.5.5 1 .7 1.6l2.1.6v2.2l-2.1.6c-.2.6-.4 1.1-.7 1.6l.9 2-1.6 1.6-2-.9c-.5.3-1 .5-1.6.7l-.6 2.1h-2.2l-.6-2.1c-.6-.2-1.1-.4-1.6-.7l-2 .9-1.6-1.6.9-2c-.3-.5-.5-1-.7-1.6l-2.1-.6V9.7l2.1-.6c.2-.6.4-1.1.7-1.6l-.9-2 1.6-1.6 2 .9c.5-.3 1-.5 1.6-.7L10.9 2Zm1.1 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
      </svg>
    );
  }

  if (name === "check") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="m9.2 16.3-4.1-4.1 1.6-1.6 2.5 2.5 8-8 1.6 1.6-9.6 9.6Z" />
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
  expanded,
}: {
  playing: boolean;
  expanded: boolean;
}) {
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

      const levels = getMusicVisualizerLevels(expanded ? 48 : 28);
      if (peaksRef.current.length !== levels.length) {
        peaksRef.current = Array(levels.length).fill(0);
      }

      const horizontalPadding = 5 * ratio;
      const usableWidth = Math.max(1, width - horizontalPadding * 2);
      const gap = Math.max(1.4 * ratio, usableWidth * 0.003);
      const barWidth = Math.max(
        1.5 * ratio,
        (usableWidth - gap * (levels.length - 1)) / levels.length
      );

      context.save();
      context.strokeStyle = "rgba(139, 202, 232, .065)";
      context.lineWidth = Math.max(1, ratio * 0.5);

      for (let line = 1; line <= 3; line += 1) {
        const y = (height / 4) * line;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }

      context.restore();

      levels.forEach((level, index) => {
        const position = index / Math.max(1, levels.length - 1);
        const idle =
          playing
            ? 0
            : 0.018 +
              Math.sin(index * 0.7 + performance.now() / 700) * 0.006;
        const normalized = Math.max(idle, level);
        const barHeight = Math.max(
          2 * ratio,
          normalized * height * 0.86
        );
        const x = horizontalPadding + index * (barWidth + gap);
        const y = height - barHeight - 3 * ratio;

        const gradient = context.createLinearGradient(0, height, 0, y);
        gradient.addColorStop(0, "rgba(20, 113, 168, .72)");
        gradient.addColorStop(
          0.58,
          position < 0.34
            ? "rgba(247, 177, 79, .94)"
            : "rgba(57, 190, 239, .92)"
        );
        gradient.addColorStop(
          1,
          position < 0.34
            ? "rgba(255, 219, 151, 1)"
            : "rgba(166, 235, 255, 1)"
        );

        context.fillStyle = gradient;
        context.shadowColor =
          position < 0.34
            ? "rgba(244, 179, 86, .24)"
            : "rgba(72, 205, 255, .22)";
        context.shadowBlur = normalized > 0.25 ? 6 * ratio : 0;
        context.beginPath();
        context.roundRect(
          x,
          y,
          barWidth,
          barHeight,
          Math.max(1, barWidth * 0.34)
        );
        context.fill();

        const previousPeak = peaksRef.current[index] || 0;
        const nextPeak = Math.max(
          normalized,
          previousPeak - (playing ? 0.012 : 0.028)
        );
        peaksRef.current[index] = nextPeak;

        const peakY =
          height - nextPeak * height * 0.86 - 5 * ratio;

        context.shadowBlur = 0;
        context.fillStyle =
          position < 0.34
            ? "rgba(255, 220, 157, .88)"
            : "rgba(174, 236, 255, .88)";
        context.fillRect(
          x,
          Math.max(1, peakY),
          barWidth,
          Math.max(1, 1.1 * ratio)
        );
      });

      frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, playing]);

  return (
    <div
      className={`tr-performanceSpectrum ${
        expanded ? "is-expanded" : "is-compact"
      }`}
      aria-label="Live music spectrum"
    >
      <canvas ref={canvasRef} />
      {expanded ? (
        <div className="tr-performanceSpectrumScale" aria-hidden>
          <span>LOW</span>
          <span>LOW-MID</span>
          <span>MID</span>
          <span>HIGH-MID</span>
          <span>HIGH</span>
        </div>
      ) : null}
    </div>
  );
}

function readExpandedPreference() {
  if (typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem(PLAYER_EXPANDED_KEY) === "true";
  } catch {
    return false;
  }
}

function trackInitials(title: string | undefined) {
  const value = String(title ?? "").trim();
  if (!value) return "MVP";

  const parts = value
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);

  if (!parts.length) return "MVP";
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function TransportButton({
  icon,
  label,
  primary = false,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  primary?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`tr-performanceTransportButton ${
        primary ? "is-primary" : ""
      } ${active ? "is-active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <span>
        <PlayerIcon name={icon} />
      </span>
      <small>{label}</small>
    </button>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="tr-performanceSettingToggle">
      <span className="tr-performanceSettingCopy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>

      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />

      <span className="tr-performanceSwitch" aria-hidden>
        <i>
          <PlayerIcon name="check" />
        </i>
      </span>
    </label>
  );
}

export function MusicMiniPlayer({
  navigate,
}: {
  navigate: (to: string) => void;
}) {
  const player = useMusicPlayer();
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [expanded, setExpanded] = useState(readExpandedPreference);
  const [eqOpen, setEqOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);

  useEffect(() => {
    const refreshPlaylists = () => {
      void listMusicPlaylists()
        .then(setPlaylists)
        .catch(() => setPlaylists([]));
    };

    void loadMusicLibrary();
    refreshPlaylists();

    window.addEventListener(
      PLAYLISTS_CHANGED_EVENT,
      refreshPlaylists
    );

    return () =>
      window.removeEventListener(
        PLAYLISTS_CHANGED_EVENT,
        refreshPlaylists
      );
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PLAYER_EXPANDED_KEY,
        expanded ? "true" : "false"
      );
    } catch {
      // Local preference storage is optional.
    }

    if (!expanded) {
      setEqOpen(false);
      setSettingsOpen(false);
    }
  }, [expanded]);

  const run = (action: () => void | Promise<void>) => {
    try {
      const result = action();
      if (result instanceof Promise) {
        void result.catch(() => undefined);
      }
    } catch {
      // The music engine surfaces useful errors through player state.
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
      const byId = new Map(
        player.libraryTracks.map((track) => [track.id, track])
      );

      const tracks = links
        .map((link) => byId.get(link.track_id))
        .filter(
          (track): track is NonNullable<typeof track> =>
            Boolean(track)
        );

      if (player.playing) {
        await playMusicPlaylist(playlist, tracks);
      } else {
        activateMusicPlaylistQueue(playlist, tracks);
      }
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
  const queueLabel =
    player.activePlaylistName || "All Uploaded Songs";
  const nextPreviewResult = getNextMusicTrackPreview();
  const nextTrack = nextPreviewResult?.track ?? null;
  const nextTrackLabel =
    nextPreviewResult?.label ?? "End of queue";
  const currentIndex = track
    ? player.tracks.findIndex((item) => item.id === track.id)
    : -1;
  const queuePosition =
    currentIndex >= 0 ? currentIndex + 1 : player.tracks.length ? 1 : 0;
  const remainingTracks = Math.max(
    0,
    player.tracks.length - queuePosition
  );

  const systemStatus = player.loading || queueBusy
    ? "LOADING"
    : player.playing
      ? "LIVE"
      : track
        ? "READY"
        : "EMPTY";

  const repeatLabel =
    player.repeat === "one"
      ? "REPEAT 1"
      : player.repeat === "all"
        ? "REPEAT ALL"
        : "REPEAT";

  const activePresetLabel = useMemo(() => {
    if (player.eqPreset === "custom") return "Custom";
    return MUSIC_EQ_PRESETS[player.eqPreset]?.label ?? "Flat";
  }, [player.eqPreset]);

  return (
    <section
      className={`tr-performanceAudio ${
        expanded ? "is-expanded" : "is-compact"
      } ${player.playing ? "is-playing" : ""} ${
        player.loading || queueBusy ? "is-busy" : ""
      }`}
      aria-label="MVP Performance Audio"
    >
      <div className="tr-performanceAudioAmbient" aria-hidden />

      <header className="tr-performanceAudioHeader">
        <div className="tr-performanceAudioBrand">
          <span className="tr-performanceAudioBrandMark" aria-hidden>
            <PlayerIcon name="music" />
          </span>

          <span className="tr-performanceAudioBrandCopy">
            <span>MVP PERFORMANCE AUDIO</span>
            <strong>TRAINING SOUND SYSTEM</strong>
          </span>
        </div>

        <div className="tr-performanceAudioHeaderStatus">
          <span
            className={`tr-performanceAudioStatus is-${systemStatus.toLowerCase()}`}
          >
            <i aria-hidden />
            {systemStatus}
          </span>

          <span className="tr-performanceAudioBadge">
            {player.eqEnabled ? activePresetLabel : "DSP BYPASS"}
          </span>

          <button
            type="button"
            className="tr-performanceAudioExpand"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={
              expanded
                ? "Collapse performance audio"
                : "Expand performance audio"
            }
          >
            <PlayerIcon
              name={expanded ? "collapse" : "expand"}
            />
            <span>{expanded ? "COMPACT" : "EXPAND"}</span>
          </button>
        </div>
      </header>

      <div className="tr-performanceAudioMain">
        <button
          type="button"
          className="tr-performanceArtwork"
          onClick={() => navigate("/music")}
          aria-label="Open My Music"
        >
          <span className="tr-performanceArtworkInitials">
            {trackInitials(track?.title)}
          </span>
          <span className="tr-performanceArtworkIcon" aria-hidden>
            <PlayerIcon name="music" />
          </span>
          <span className="tr-performanceArtworkGlow" aria-hidden />
          <span className="tr-performanceArtworkRing" aria-hidden />
        </button>

        <button
          type="button"
          className="tr-performanceTrackIdentity"
          onClick={() => navigate("/music")}
        >
          <span className="tr-performanceTrackEyebrow">
            {player.playing
              ? "NOW PLAYING"
              : track
                ? "READY TO PLAY"
                : "PRIVATE MUSIC LIBRARY"}
          </span>

          <strong>
            {track?.title ||
              (player.loading
                ? "Loading your music…"
                : "Choose your workout soundtrack")}
          </strong>

          <small>
            {track
              ? track.artist || "MVP Trainer library"
              : "Upload songs and build your training queue"}
          </small>

          <span className="tr-performanceTrackSource">
            <PlayerIcon name="queue" />
            {queueLabel}
          </span>
        </button>

        <div className="tr-performanceAudioActions">
          <button
            type="button"
            className="tr-performanceAudioLibraryButton"
            onClick={() => navigate("/music")}
          >
            <PlayerIcon name="library" />
            <span>MY MUSIC</span>
          </button>

          <label className="tr-performanceQueueSelect">
            <span>PLAYING FROM</span>
            <select
              value={player.activePlaylistId || "all"}
              disabled={queueBusy}
              onChange={(
                event: ChangeEvent<HTMLSelectElement>
              ) => void selectQueue(event.target.value)}
              aria-label="Choose music playlist"
            >
              <option value="all">All Uploaded Songs</option>
              {playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>
                  {playlist.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="tr-performanceTimeline">
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

      <Spectrum playing={player.playing} expanded={expanded} />

      <div className="tr-performanceTransport">
        <TransportButton
          icon="shuffle"
          label="SHUFFLE"
          active={player.shuffle}
          disabled={!player.tracks.length}
          onClick={() => toggleMusicShuffle()}
        />

        <TransportButton
          icon="back"
          label="PREVIOUS"
          disabled={
            !player.tracks.length || player.loading || queueBusy
          }
          onClick={() => run(previousMusicTrack)}
        />

        <TransportButton
          icon={player.playing ? "pause" : "play"}
          label={player.playing ? "PAUSE" : "PLAY"}
          primary
          disabled={player.loading || queueBusy}
          onClick={() =>
            run(player.playing ? pauseMusic : playMusic)
          }
        />

        <TransportButton
          icon="stop"
          label="STOP"
          disabled={!track || player.loading || queueBusy}
          onClick={() => stopMusic()}
        />

        <TransportButton
          icon="next"
          label="NEXT"
          disabled={
            !player.tracks.length || player.loading || queueBusy
          }
          onClick={() => run(() => nextMusicTrack())}
        />

        <TransportButton
          icon="repeat"
          label={repeatLabel}
          active={player.repeat !== "off"}
          disabled={!player.tracks.length}
          onClick={() => cycleMusicRepeat()}
        />
      </div>

      <div className="tr-performanceAudioIntelligence">
        <div className="tr-performanceNextUp">
          <span className="tr-performanceAudioKicker">
            NEXT UP
          </span>

          <strong>
            {nextTrack?.title || nextTrackLabel}
          </strong>

          <small>
            {nextTrack
              ? nextTrack.artist ||
                "MVP Trainer library"
              : player.shuffle
                ? "Selected automatically from the active queue"
                : "Choose another playlist or continue from My Music"}
          </small>
        </div>

        <div className="tr-performanceQueueStatus">
          <span>
            QUEUE
            <strong>
              {queuePosition || 0}/{player.tracks.length}
            </strong>
          </span>

          <span>
            REMAINING
            <strong>{remainingTracks}</strong>
          </span>

          <span>
            CROSSFADER
            <strong>
              {player.crossfadeSeconds > 0
                ? `${player.crossfadeSeconds.toFixed(1)}S`
                : "OFF"}
            </strong>
          </span>

          <span>
            ALERT DUCKING
            <strong>
              {player.duckingStrength.toUpperCase()}
            </strong>
          </span>
        </div>
      </div>

      {expanded ? (
        <div className="tr-performanceStudio">
          <div className="tr-performanceStudioTabs">
            <button
              type="button"
              className={settingsOpen ? "is-active" : ""}
              onClick={() => {
                setSettingsOpen((value) => !value);
                setEqOpen(false);
              }}
              aria-expanded={settingsOpen}
            >
              <PlayerIcon name="settings" />
              AUDIO CONTROL
            </button>

            <button
              type="button"
              className={eqOpen ? "is-active" : ""}
              onClick={() => {
                setEqOpen((value) => !value);
                setSettingsOpen(false);
              }}
              aria-expanded={eqOpen}
            >
              <PlayerIcon name="equalizer" />
              EQUALIZER
            </button>
          </div>

          {settingsOpen ? (
            <div className="tr-performanceSettingsPanel">
              <div className="tr-performanceSettingsIntro">
                <span className="tr-performanceAudioKicker">
                  AUDIO CONTROL
                </span>
                <strong>Professional playback processing</strong>
                <p>
                  Smooth track changes, balance loudness, protect the
                  output, and control how strongly music lowers for
                  workout alerts.
                </p>
              </div>

              <label className="tr-performanceRangeSetting">
                <span className="tr-performanceSettingCopy">
                  <strong>TRACK TRANSITION</strong>
                  <small>
                    Smooth fade between songs and manual track changes.
                  </small>
                </span>

                <input
                  type="range"
                  min="0"
                  max="8"
                  step="0.5"
                  value={player.crossfadeSeconds}
                  onChange={(
                    event: ChangeEvent<HTMLInputElement>
                  ) =>
                    setMusicCrossfadeSeconds(
                      Number(event.target.value)
                    )
                  }
                />

                <output>
                  {player.crossfadeSeconds > 0
                    ? `${player.crossfadeSeconds.toFixed(1)} SEC`
                    : "OFF"}
                </output>
              </label>

              <SettingToggle
                label="LOUDNESS SMOOTHING"
                description="Reduces jarring volume differences between uploaded songs."
                checked={player.normalizationEnabled}
                onChange={setMusicNormalizationEnabled}
              />

              <SettingToggle
                label="OUTPUT LIMITER"
                description="Controls sharp peaks and helps prevent harsh clipping."
                checked={player.limiterEnabled}
                onChange={setMusicLimiterEnabled}
              />

              <label className="tr-performanceSelectSetting">
                <span className="tr-performanceSettingCopy">
                  <strong>ALERT DUCKING</strong>
                  <small>
                    Choose how far music lowers during workout sounds.
                  </small>
                </span>

                <select
                  value={player.duckingStrength}
                  onChange={(
                    event: ChangeEvent<HTMLSelectElement>
                  ) =>
                    setMusicDuckingStrength(
                      event.target.value as MusicDuckingStrength
                    )
                  }
                >
                  <option value="off">Off</option>
                  <option value="light">Light</option>
                  <option value="standard">Standard</option>
                  <option value="strong">Strong</option>
                </select>
              </label>
            </div>
          ) : null}

          {eqOpen ? (
            <div className="tr-performanceEqPanel">
              <div className="tr-performanceEqHead">
                <div>
                  <span className="tr-performanceAudioKicker">
                    10-BAND DSP
                  </span>
                  <strong>Shape your workout sound</strong>
                </div>

                <label className="tr-performanceEqPower">
                  <input
                    type="checkbox"
                    checked={player.eqEnabled}
                    onChange={(
                      event: ChangeEvent<HTMLInputElement>
                    ) =>
                      setMusicEqEnabled(event.target.checked)
                    }
                  />
                  <span>{player.eqEnabled ? "DSP ON" : "DSP OFF"}</span>
                </label>

                <label className="tr-performanceEqPreset">
                  <span>PRESET</span>
                  <select
                    value={player.eqPreset}
                    onChange={(
                      event: ChangeEvent<HTMLSelectElement>
                    ) =>
                      applyMusicEqPreset(
                        event.target.value as MusicEqPreset
                      )
                    }
                  >
                    {Object.entries(MUSIC_EQ_PRESETS).map(
                      ([value, preset]) => (
                        <option key={value} value={value}>
                          {preset.label}
                        </option>
                      )
                    )}
                    <option value="custom">Custom</option>
                  </select>
                </label>
              </div>

              <div className="tr-performanceEqBands">
                {MUSIC_EQ_FREQUENCIES.map(
                  (frequency, index) => (
                    <label
                      key={frequency}
                      className="tr-performanceEqBand"
                    >
                      <span className="tr-performanceEqGain">
                        {Number(player.eqGains[index] || 0) > 0
                          ? "+"
                          : ""}
                        {Number(
                          player.eqGains[index] || 0
                        ).toFixed(0)}
                      </span>

                      <span className="tr-performanceEqSlider">
                        <input
                          type="range"
                          min="-12"
                          max="12"
                          step="1"
                          value={player.eqGains[index] || 0}
                          onChange={(
                            event: ChangeEvent<HTMLInputElement>
                          ) =>
                            setMusicEqBand(
                              index,
                              Number(event.target.value)
                            )
                          }
                          aria-label={`${frequency} hertz equalizer gain`}
                        />
                      </span>

                      <span>
                        {frequency >= 1000
                          ? `${frequency / 1000}K`
                          : frequency}
                      </span>
                    </label>
                  )
                )}
              </div>

              <label className="tr-performancePreamp">
                <span>PREAMP</span>

                <input
                  type="range"
                  min="-12"
                  max="6"
                  step="1"
                  value={player.preampDb}
                  onChange={(
                    event: ChangeEvent<HTMLInputElement>
                  ) =>
                    setMusicPreamp(Number(event.target.value))
                  }
                />

                <strong>
                  {player.preampDb > 0 ? "+" : ""}
                  {player.preampDb.toFixed(0)} dB
                </strong>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {player.error ? (
        <div className="tr-performanceAudioError">
          {player.error}
        </div>
      ) : null}
    </section>
  );
}
