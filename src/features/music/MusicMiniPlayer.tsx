import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
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
  loadMusicLibrary,
  MUSIC_EQ_FREQUENCIES,
  MUSIC_EQ_PRESETS,
  MUSIC_HEADPHONE_MODES,
  MUSIC_RTA_FREQUENCIES,
  getMusicRtaLevels,
  nextMusicTrack,
  pauseMusic,
  playMusic,
  playMusicPlaylist,
  previousMusicTrack,
  saveMusicEqCustomPreset,
  seekMusic,
  setMusicEqBand,
  setMusicEqEnabled,
  setMusicDspBypass,
  recoverMusicDsp,
  setPlayerMusicPreference,
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
  | "like"
  | "dislike"
  | "music";

type SavedDspProfile = {
  name: string;
  eqEnabled: boolean;
  eqGains: number[];
  preampDb: number;
  headphoneMode: MusicHeadphoneMode;
  headphoneWidth: number;
  headphoneDepth: number;
  headphoneCrossfeed: number;
  headphoneCenter: number;
  headphoneBassImpact: number;
  savedAt: number;
};

type SavedDspProfiles = Record<MusicCustomPresetSlot, SavedDspProfile | null>;

const DSP_PROFILE_STORAGE_KEY = "mvp_music_dsp_profiles_v1";
const DSP_SLOTS: MusicCustomPresetSlot[] = ["custom_1", "custom_2", "custom_3"];

function emptyDspProfiles(): SavedDspProfiles {
  return {
    custom_1: null,
    custom_2: null,
    custom_3: null,
  };
}

function isCustomSlot(value: MusicEqPreset): value is MusicCustomPresetSlot {
  return value === "custom_1" || value === "custom_2" || value === "custom_3";
}

function readSavedDspProfiles(): SavedDspProfiles {
  if (typeof window === "undefined") return emptyDspProfiles();

  try {
    const raw = window.localStorage.getItem(DSP_PROFILE_STORAGE_KEY);
    if (!raw) return emptyDspProfiles();

    const parsed = JSON.parse(raw) as Partial<SavedDspProfiles>;
    return {
      custom_1: parsed.custom_1 ?? null,
      custom_2: parsed.custom_2 ?? null,
      custom_3: parsed.custom_3 ?? null,
    };
  } catch {
    return emptyDspProfiles();
  }
}

function writeSavedDspProfiles(profiles: SavedDspProfiles) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DSP_PROFILE_STORAGE_KEY, JSON.stringify(profiles));
}

function slotFallbackLabel(slot: MusicCustomPresetSlot) {
  if (slot === "custom_1") return "Custom 1";
  if (slot === "custom_2") return "Custom 2";
  return "Custom 3";
}

function sameDspNumber(left: number, right: number) {
  return Math.abs(Number(left) - Number(right)) < 0.01;
}

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
  if (name === "like") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M9.2 21H5.5A2.5 2.5 0 0 1 3 18.5v-8A2.5 2.5 0 0 1 5.5 8H9l3.2-5.1A2 2 0 0 1 16 4v4h3.2a2.8 2.8 0 0 1 2.7 3.5l-1.8 7A3.4 3.4 0 0 1 16.8 21H9.2Zm-1.7-2V10H5.5a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h2Zm2 0h7.3a1.4 1.4 0 0 0 1.4-1.1l1.8-7a.8.8 0 0 0-.8-.9H14V4.8l-4.5 7.1V19Z" />
      </svg>
    );
  }
  if (name === "dislike") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M14.8 3h3.7A2.5 2.5 0 0 1 21 5.5v8a2.5 2.5 0 0 1-2.5 2.5H15l-3.2 5.1A2 2 0 0 1 8 20v-4H4.8a2.8 2.8 0 0 1-2.7-3.5l1.8-7A3.4 3.4 0 0 1 7.2 3h7.6Zm1.7 2v9h2a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5h-2Zm-2 0H7.2a1.4 1.4 0 0 0-1.4 1.1L4 13.1a.8.8 0 0 0 .8.9H10v5.2l4.5-7.1V5Z" />
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

function TenBandRta({ playing }: { playing: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(true);
  const [levels, setLevels] = useState<number[]>(() => Array(10).fill(0));
  const [peaks, setPeaks] = useState<number[]>(() => Array(10).fill(0));

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.05 }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !visible) {
      setLevels((current) => current.map((value) => value * 0.45));
      setPeaks((current) => current.map((value) => value * 0.82));
      return;
    }

    const timer = window.setInterval(() => {
      const next = getMusicRtaLevels();
      setLevels(next);
      setPeaks((current) => next.map((value, index) => Math.max(value, (current[index] || 0) * 0.93)));
    }, 110);

    return () => window.clearInterval(timer);
  }, [playing, visible]);

  return (
    <div ref={hostRef} className="tr-rta10" aria-label="10 band real-time audio analyzer">
      <div className="tr-rta10Head">
        <span><i />10-BAND RTA</span>
        <span>{playing ? "PROCESSED OUTPUT • LIVE" : "PROCESSED OUTPUT • READY"}</span>
      </div>
      <div className="tr-rta10Grid" aria-hidden>
        {MUSIC_RTA_FREQUENCIES.map((frequency, index) => {
          const value = Math.max(0.02, Math.min(1, levels[index] || 0));
          const peak = Math.max(value, Math.min(1, peaks[index] || 0));
          return (
            <div className="tr-rta10Band" key={frequency}>
              <div className="tr-rta10Meter">
                <span className="tr-rta10Fill" style={{ transform: `scaleY(${value})` }} />
                <span className="tr-rta10Peak" style={{ bottom: `${Math.max(4, peak * 94)}%` }} />
              </div>
              <strong>{frequency >= 1000 ? `${frequency / 1000}K` : frequency}</strong>
            </div>
          );
        })}
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
  const [dspProfiles, setDspProfiles] = useState<SavedDspProfiles>(() => readSavedDspProfiles());
  const [activeCustomSlot, setActiveCustomSlot] = useState<MusicCustomPresetSlot | null>(
    isCustomSlot(player.eqPreset) ? player.eqPreset : null
  );
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetSlot, setSavePresetSlot] = useState<MusicCustomPresetSlot>("custom_1");
  const [savePresetName, setSavePresetName] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const restoredProfileRef = useRef<string>("");

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
    if (!current?.artwork_path && !current?.external_artwork_url) return () => { cancelled = true; };

    void getMusicArtworkSignedUrl(current)
      .then((url) => {
        if (!cancelled) setArtworkUrl(url);
      })
      .catch(() => {
        if (!cancelled) setArtworkUrl(null);
      });

    return () => { cancelled = true; };
  }, [player.currentTrack?.id, player.currentTrack?.artwork_path, player.currentTrack?.external_artwork_url]);

  const run = (action: () => void | Promise<void>) => {
    try {
      const result = action();
      if (result instanceof Promise) void result.catch(() => undefined);
    } catch {
      // The player state surfaces useful errors.
    }
  };


  useEffect(() => {
    if (!isCustomSlot(player.eqPreset)) return;

    setActiveCustomSlot(player.eqPreset);
    const profile = dspProfiles[player.eqPreset];
    if (!profile) return;

    const restorationKey = `${player.eqPreset}:${profile.savedAt}`;
    if (restoredProfileRef.current === restorationKey) return;
    restoredProfileRef.current = restorationKey;

    setMusicEqEnabled(profile.eqEnabled);
    setMusicHeadphoneMode(profile.headphoneMode);
    setMusicHeadphoneWidth(profile.headphoneWidth);
    setMusicHeadphoneDepth(profile.headphoneDepth);
    setMusicHeadphoneCrossfeed(profile.headphoneCrossfeed);
    setMusicHeadphoneCenter(profile.headphoneCenter);
    setMusicHeadphoneBassImpact(profile.headphoneBassImpact);
  }, [player.eqPreset, dspProfiles]);

  function currentDspSnapshot(name: string): SavedDspProfile {
    return {
      name: name.trim() || "Custom DSP",
      eqEnabled: player.eqEnabled,
      eqGains: [...player.eqGains],
      preampDb: player.preampDb,
      headphoneMode: player.headphoneMode,
      headphoneWidth: player.headphoneWidth,
      headphoneDepth: player.headphoneDepth,
      headphoneCrossfeed: player.headphoneCrossfeed,
      headphoneCenter: player.headphoneCenter,
      headphoneBassImpact: player.headphoneBassImpact,
      savedAt: Date.now(),
    };
  }

  function profileMatchesCurrent(profile: SavedDspProfile | null) {
    if (!profile) return false;
    if (profile.eqEnabled !== player.eqEnabled) return false;
    if (profile.headphoneMode !== player.headphoneMode) return false;
    if (!sameDspNumber(profile.preampDb, player.preampDb)) return false;
    if (!sameDspNumber(profile.headphoneWidth, player.headphoneWidth)) return false;
    if (!sameDspNumber(profile.headphoneDepth, player.headphoneDepth)) return false;
    if (!sameDspNumber(profile.headphoneCrossfeed, player.headphoneCrossfeed)) return false;
    if (!sameDspNumber(profile.headphoneCenter, player.headphoneCenter)) return false;
    if (!sameDspNumber(profile.headphoneBassImpact, player.headphoneBassImpact)) return false;
    if (profile.eqGains.length !== player.eqGains.length) return false;

    return profile.eqGains.every((gain, index) =>
      sameDspNumber(gain, player.eqGains[index] ?? 0)
    );
  }

  function applySavedDspProfile(slot: MusicCustomPresetSlot) {
    const profile = dspProfiles[slot];

    applyMusicEqPreset(slot);
    setActiveCustomSlot(slot);

    if (!profile) {
      setProfileMessage(`${slotFallbackLabel(slot)} has no full DSP profile saved yet.`);
      return;
    }

    setMusicEqEnabled(profile.eqEnabled);
    setMusicHeadphoneMode(profile.headphoneMode);
    setMusicHeadphoneWidth(profile.headphoneWidth);
    setMusicHeadphoneDepth(profile.headphoneDepth);
    setMusicHeadphoneCrossfeed(profile.headphoneCrossfeed);
    setMusicHeadphoneCenter(profile.headphoneCenter);
    setMusicHeadphoneBassImpact(profile.headphoneBassImpact);
    restoredProfileRef.current = `${slot}:${profile.savedAt}`;
    setProfileMessage(`${profile.name} loaded.`);
  }

  function handlePresetSelection(value: MusicEqPreset) {
    if (isCustomSlot(value)) {
      applySavedDspProfile(value);
      return;
    }

    setActiveCustomSlot(null);
    applyMusicEqPreset(value);
    setProfileMessage("");
  }

  function saveCurrentDspProfile(slot: MusicCustomPresetSlot, name: string) {
    const profile = currentDspSnapshot(name || slotFallbackLabel(slot));
    const nextProfiles: SavedDspProfiles = {
      ...dspProfiles,
      [slot]: profile,
    };

    saveMusicEqCustomPreset(slot);
    writeSavedDspProfiles(nextProfiles);
    setDspProfiles(nextProfiles);
    setActiveCustomSlot(slot);
    restoredProfileRef.current = `${slot}:${profile.savedAt}`;
    setProfileMessage(`${profile.name} saved.`);
    setSavePresetOpen(false);
  }

  function openSavePresetDialog(preferredSlot?: MusicCustomPresetSlot) {
    const firstEmpty = DSP_SLOTS.find((slot) => !dspProfiles[slot]);
    const slot = preferredSlot ?? firstEmpty ?? activeCustomSlot ?? "custom_1";
    const existing = dspProfiles[slot];

    setSavePresetSlot(slot);
    setSavePresetName(existing?.name ?? "");
    setSavePresetOpen(true);
  }

  function chooseSaveSlot(slot: MusicCustomPresetSlot) {
    setSavePresetSlot(slot);
    setSavePresetName(dspProfiles[slot]?.name ?? "");
  }

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

  const activeSavedProfile = activeCustomSlot ? dspProfiles[activeCustomSlot] : null;
  const activeProfileDirty = activeSavedProfile
    ? !profileMatchesCurrent(activeSavedProfile)
    : false;
  const presetSelectValue: MusicEqPreset =
    activeCustomSlot && activeProfileDirty ? "custom" : player.eqPreset;
  const presetStatusLabel = activeSavedProfile
    ? `${activeSavedProfile.name}${activeProfileDirty ? " • Modified" : " • Saved"}`
    : player.eqPreset === "custom"
      ? "Unsaved custom DSP"
      : "Built-in preset";

  return (
    <section
      className={`tr-audioDeck tr-audioDeck--v4 tr-audioDeck--pro7 ${player.playing ? "is-playing" : ""} ${
        player.loading || queueBusy ? "is-busy" : ""
      }`}
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
          <i /> {player.playing ? "RTA ACTIVE" : "RTA READY"}
        </span>
        <span>EQ {player.dspBypass ? "BYPASS" : player.eqEnabled ? "ACTIVE" : "FLAT"}</span>
        <span>DSP {player.dspStatus.toUpperCase()}</span>
        <button
          type="button"
          className={`tr-dspHealth is-${player.dspStatus}`}
          onClick={() => void recoverMusicDsp()}
        >
          {player.dspStatus === "active" ? "PROCESSING LOCKED" : player.dspStatus === "bypassed" ? "A/B BYPASS" : "RECOVER DSP"}
        </button>
      </div>

      <TenBandRta playing={player.playing} />

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

      <div className="tr-mainAudioTuning">
        <label className="tr-mainPreamp">
          <span>PREAMP</span>
          <input
            type="range"
            min="-12"
            max="12"
            step="0.5"
            value={player.preampDb}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setMusicPreamp(Number(event.target.value))
            }
            aria-label="Music preamp"
          />
          <strong>{player.preampDb > 0 ? "+" : ""}{player.preampDb.toFixed(1)} dB</strong>
        </label>

        <div className="tr-trackPreference" aria-label="Track preference">
          <button
            type="button"
            className={track?.play_less ? "is-disliked" : ""}
            disabled={!track}
            onClick={() => {
              if (!track) return;
              const next = track.play_less ? "neutral" : "play_less";
              void setPlayerMusicPreference(track.id, next).then(() => {
                if (next === "play_less") void nextMusicTrack();
              });
            }}
            aria-label="Play this song less"
          >
            <PlayerIcon name="dislike" />
            <span>PLAY LESS</span>
          </button>
          <button
            type="button"
            className={track?.favorite ? "is-liked" : ""}
            disabled={!track}
            onClick={() => {
              if (!track) return;
              void setPlayerMusicPreference(track.id, track.favorite ? "neutral" : "like");
            }}
            aria-label="Like this song"
          >
            <PlayerIcon name="like" />
            <span>{track?.favorite ? "LIKED" : "LIKE"}</span>
          </button>
        </div>
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
            <div className="tr-dspAbControls">
              <label className="tr-audioEqSwitch">
                <input
                  type="checkbox"
                  checked={player.eqEnabled}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setMusicEqEnabled(event.target.checked)
                  }
                />
                <span>EQ {player.eqEnabled ? "ON" : "FLAT"}</span>
              </label>
              <button
                type="button"
                className={`tr-dspBypassButton ${player.dspBypass ? "is-active" : ""}`}
                onClick={() => setMusicDspBypass(!player.dspBypass)}
              >
                A/B {player.dspBypass ? "BYPASSED" : "PROCESSED"}
              </button>
            </div>
            <label className="tr-audioEqPreset">
              <span>EQ PRESET</span>
              <select
                value={presetSelectValue}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  handlePresetSelection(event.target.value as MusicEqPreset)
                }
              >
                {Object.entries(MUSIC_EQ_PRESETS).map(([value, preset]) => (
                  <option key={value} value={value}>
                    {preset.label}
                  </option>
                ))}
                {DSP_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {dspProfiles[slot]?.name ?? slotFallbackLabel(slot)}
                  </option>
                ))}
                <option value="custom">
                  {activeSavedProfile && activeProfileDirty
                    ? `${activeSavedProfile.name} • Modified`
                    : "Unsaved Custom"}
                </option>
              </select>
            </label>
          </div>

          <div className="tr-audioDspSignalPath" aria-label="Audio processing path">
            <span>INPUT</span><i />
            <span>PREAMP</span><i />
            <span>31-BAND EQ</span><i />
            <span>HEADPHONE</span><i />
            <span>LIMITER / OUTPUT</span><i />
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
                max="12"
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

          <div className="tr-dspProfileSave" aria-label="Save DSP profile">
            <div className="tr-dspProfileSaveStatus">
              <span>DSP PROFILE</span>
              <strong>{presetStatusLabel}</strong>
              {profileMessage ? <small aria-live="polite">{profileMessage}</small> : null}
            </div>

            <div className="tr-dspProfileSaveActions">
              {activeCustomSlot && activeSavedProfile ? (
                <button
                  type="button"
                  onClick={() =>
                    saveCurrentDspProfile(activeCustomSlot, activeSavedProfile.name)
                  }
                >
                  UPDATE PRESET
                </button>
              ) : null}

              <button
                type="button"
                className="is-primary"
                onClick={() => openSavePresetDialog()}
              >
                {activeCustomSlot ? "SAVE AS NEW" : "SAVE CUSTOM PRESET"}
              </button>
            </div>
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


      {savePresetOpen ? (
        <div
          className="tr-dspSaveOverlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSavePresetOpen(false);
          }}
        >
          <section
            className="tr-dspSaveDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tr-dsp-save-title"
          >
            <header>
              <div>
                <span className="tr-audioEyebrow">CUSTOM DSP PROFILE</span>
                <h3 id="tr-dsp-save-title">Save your sound profile</h3>
              </div>
              <button
                type="button"
                className="tr-dspSaveClose"
                onClick={() => setSavePresetOpen(false)}
                aria-label="Close save preset dialog"
              >
                ×
              </button>
            </header>

            <label className="tr-dspSaveName">
              <span>PRESET NAME</span>
              <input
                type="text"
                maxLength={32}
                value={savePresetName}
                placeholder="My Workout EQ"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setSavePresetName(event.target.value)
                }
                autoFocus
              />
            </label>

            <div className="tr-dspSaveSlots">
              <span>SAVE TO</span>
              <div>
                {DSP_SLOTS.map((slot, index) => (
                  <button
                    key={slot}
                    type="button"
                    className={savePresetSlot === slot ? "is-active" : ""}
                    onClick={() => chooseSaveSlot(slot)}
                  >
                    <b>CUSTOM {index + 1}</b>
                    <small>{dspProfiles[slot]?.name ?? "Empty slot"}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="tr-dspSaveIncludes">
              <span>SAVES</span>
              <p>
                31-band EQ • Preamp • DSP active state • Headphone mode • Width •
                Depth • Crossfeed • Center focus • Bass impact
              </p>
            </div>

            <footer>
              <button type="button" onClick={() => setSavePresetOpen(false)}>
                CANCEL
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={() =>
                  saveCurrentDspProfile(
                    savePresetSlot,
                    savePresetName.trim() || slotFallbackLabel(savePresetSlot)
                  )
                }
              >
                SAVE PRESET
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {player.error ? <div className="tr-audioError">{player.error}</div> : null}

      <style>{`
        .tr-audioDeck--pro7 .tr-rta10{
          margin:8px 0 5px;border:1px solid rgba(91,187,222,.16);border-top-color:rgba(167,226,247,.28);
          border-radius:10px;overflow:hidden;background:linear-gradient(180deg,rgba(4,17,25,.98),rgba(2,9,14,.99));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 8px 22px rgba(0,0,0,.22)
        }
        .tr-audioDeck--pro7 .tr-rta10Head{height:27px;padding:0 10px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid rgba(80,177,214,.09);font-size:7px;font-weight:950;letter-spacing:.1em;color:rgba(181,212,224,.55)}
        .tr-audioDeck--pro7 .tr-rta10Head span:first-child{display:inline-flex;align-items:center;gap:7px;color:#d8f5ff}.tr-audioDeck--pro7 .tr-rta10Head i{width:6px;height:6px;border-radius:50%;background:#52d7ff;box-shadow:0 0 10px rgba(82,215,255,.38)}
        .tr-audioDeck--pro7 .tr-rta10Grid{height:112px;padding:12px 14px 9px;display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:8px;background:repeating-linear-gradient(0deg,transparent 0,transparent 22px,rgba(98,180,208,.045) 23px)}
        .tr-audioDeck--pro7 .tr-rta10Band{min-width:0;display:grid;grid-template-rows:1fr 13px;gap:5px;align-items:end;text-align:center}
        .tr-audioDeck--pro7 .tr-rta10Meter{height:78px;position:relative;overflow:hidden;border-radius:5px;background:linear-gradient(180deg,rgba(62,102,118,.12),rgba(20,43,52,.18));box-shadow:inset 0 0 0 1px rgba(94,173,201,.07)}
        .tr-audioDeck--pro7 .tr-rta10Fill{position:absolute;inset:0;transform-origin:bottom;background:linear-gradient(180deg,#77e2ff 0%,#37bfe9 58%,#ffae3d 100%);border-radius:4px;box-shadow:0 0 9px rgba(72,200,242,.18);transition:transform .10s linear}
        .tr-audioDeck--pro7 .tr-rta10Peak{position:absolute;left:14%;right:14%;height:2px;background:#edfaff;box-shadow:0 0 5px rgba(214,248,255,.5);transition:bottom .12s linear}
        .tr-audioDeck--pro7 .tr-rta10Band strong{font-size:7px;letter-spacing:.04em;color:rgba(178,211,223,.62)}
        .tr-audioDeck--pro7 .tr-mainAudioTuning{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;margin:3px 0 10px}
        .tr-audioDeck--pro7 .tr-mainPreamp{min-width:0;display:grid;grid-template-columns:54px minmax(100px,1fr) 62px;gap:8px;align-items:center;padding:8px 11px;border:1px solid rgba(80,172,207,.12);border-radius:9px;background:rgba(5,16,23,.64)}
        .tr-audioDeck--pro7 .tr-mainPreamp span{font-size:7px;font-weight:950;letter-spacing:.09em;color:#8da8b3}.tr-audioDeck--pro7 .tr-mainPreamp strong{text-align:right;font-size:9px;color:#f3fbff}.tr-audioDeck--pro7 .tr-mainPreamp input{width:100%;accent-color:#ff9e2d}
        .tr-audioDeck--pro7 .tr-trackPreference{display:flex;gap:6px}.tr-audioDeck--pro7 .tr-trackPreference button{height:38px;min-width:74px;padding:0 10px;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(107,164,186,.16);border-radius:9px;background:linear-gradient(180deg,#0b1720,#071017);color:#b9cbd3;font-size:7px;font-weight:950;letter-spacing:.06em}.tr-audioDeck--pro7 .tr-trackPreference svg{width:14px;height:14px;fill:currentColor}.tr-audioDeck--pro7 .tr-trackPreference button.is-liked{color:#5ee3a7;border-color:rgba(69,219,153,.38);background:rgba(22,76,57,.22)}.tr-audioDeck--pro7 .tr-trackPreference button.is-disliked{color:#ff8585;border-color:rgba(255,105,105,.36);background:rgba(91,29,31,.20)}
        .tr-audioDeck--pro7 .tr-dspHealth{border:0;background:transparent;font:inherit;color:#8fa8b1;cursor:pointer}.tr-audioDeck--pro7 .tr-dspHealth.is-active{color:#58dca5}.tr-audioDeck--pro7 .tr-dspHealth.is-unavailable{color:#ff7777}.tr-audioDeck--pro7 .tr-dspHealth.is-recovering{color:#ffb34d}
        .tr-audioDeck--pro7 .tr-dspAbControls{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.tr-audioDeck--pro7 .tr-dspBypassButton{height:34px;padding:0 12px;border:1px solid rgba(95,190,224,.22);border-radius:8px;background:#07131a;color:#b8d5df;font-size:8px;font-weight:900;letter-spacing:.06em}.tr-audioDeck--pro7 .tr-dspBypassButton.is-active{border-color:rgba(255,176,73,.5);color:#ffb34d;background:rgba(91,54,12,.2)}
        @media(max-width:700px){.tr-audioDeck--pro7 .tr-rta10Grid{height:94px;padding:10px 8px 7px;gap:4px}.tr-audioDeck--pro7 .tr-rta10Meter{height:62px}.tr-audioDeck--pro7 .tr-rta10Band strong{font-size:6px}.tr-audioDeck--pro7 .tr-rta10Head span:last-child{display:none}.tr-audioDeck--pro7 .tr-mainAudioTuning{grid-template-columns:1fr}.tr-audioDeck--pro7 .tr-trackPreference{justify-content:stretch}.tr-audioDeck--pro7 .tr-trackPreference button{flex:1}.tr-audioDeck--pro7 .tr-mainPreamp{grid-template-columns:47px minmax(80px,1fr) 56px}}
        /* STEP 9 — LOW-POWER PLAYBACK SIGNAL
           Visual motion is CSS-only. No canvas, no spectrum analyser, no
           frequency polling. DSP/EQ/headphone processing remains untouched. */
        .tr-audioDeck--pro7 .tr-audioSignalPanel{
          position:relative;
          overflow:hidden;
          margin:8px 0 6px;
          border:1px solid rgba(111,194,224,.16);
          border-top-color:rgba(184,228,244,.24);
          border-radius:11px;
          background:
            linear-gradient(180deg,rgba(5,18,27,.96),rgba(2,8,13,.99)),
            radial-gradient(circle at 50% 0%,rgba(55,181,228,.08),transparent 54%);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.025),
            0 8px 22px rgba(0,0,0,.22);
        }

        .tr-audioDeck--pro7 .tr-audioSignalHead,
        .tr-audioDeck--pro7 .tr-audioSignalFooter{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          padding:7px 10px;
          color:rgba(187,215,227,.58);
          font-size:7px;
          line-height:1;
          font-weight:950;
          letter-spacing:.10em;
        }

        .tr-audioDeck--pro7 .tr-audioSignalHead{
          border-bottom:1px solid rgba(122,192,219,.08);
        }

        .tr-audioDeck--pro7 .tr-audioSignalHead>span:first-child{
          display:inline-flex;
          align-items:center;
          gap:7px;
          color:#d9f4fc;
        }

        .tr-audioDeck--pro7 .tr-audioSignalHead i{
          width:6px;
          height:6px;
          border-radius:50%;
          background:rgba(124,156,169,.55);
        }

        .tr-audioDeck--pro7 .tr-audioSignalPanel.is-live .tr-audioSignalHead i{
          background:#50d3fb;
          box-shadow:0 0 10px rgba(80,211,251,.44);
        }

        .tr-audioDeck--pro7 .tr-audioSignalField{
          position:relative;
          height:78px;
          display:flex;
          align-items:center;
          padding:8px 12px 9px;
          background:
            repeating-linear-gradient(
              90deg,
              transparent 0,
              transparent calc(8.333% - 1px),
              rgba(115,190,219,.035) calc(8.333% - 1px),
              rgba(115,190,219,.035) 8.333%
            );
        }

        .tr-audioDeck--pro7 .tr-audioSignalBaseline{
          position:absolute;
          left:12px;
          right:12px;
          top:50%;
          height:1px;
          background:linear-gradient(90deg,transparent,rgba(95,205,244,.22),transparent);
        }

        .tr-audioDeck--pro7 .tr-audioSignalBars{
          position:relative;
          z-index:2;
          width:100%;
          height:100%;
          display:grid;
          grid-template-columns:repeat(12,1fr);
          align-items:center;
          gap:5px;
        }

        .tr-audioDeck--pro7 .tr-audioSignalBars span{
          justify-self:center;
          width:min(7px,48%);
          height:70%;
          border-radius:4px;
          transform:scaleY(calc(.17 + var(--signal-height) * .30));
          transform-origin:center;
          background:
            linear-gradient(
              180deg,
              rgba(139,226,255,.96),
              rgba(57,184,230,.80) 46%,
              rgba(255,168,59,.64)
            );
          opacity:.46;
          will-change:auto;
        }

        .tr-audioDeck--pro7 .tr-audioSignalPanel.is-live .tr-audioSignalBars span{
          opacity:.90;
          animation:trPlaybackPulse calc(1.25s + (var(--signal-index) * .055s)) ease-in-out infinite alternate;
          animation-delay:calc(var(--signal-index) * -0.073s);
        }

        .tr-audioDeck--pro7 .tr-audioSignalProgress{
          position:absolute;
          z-index:3;
          left:12px;
          right:12px;
          bottom:6px;
          height:2px;
          border-radius:2px;
          transform-origin:left center;
          background:linear-gradient(90deg,#ff9e32,#5fd5fb 66%,#a8edff);
          box-shadow:0 0 8px rgba(70,198,240,.18);
          transition:transform .28s linear;
        }

        .tr-audioDeck--pro7 .tr-audioSignalFooter{
          border-top:1px solid rgba(122,192,219,.07);
          color:rgba(163,195,208,.47);
        }

        @keyframes trPlaybackPulse{
          0%{transform:scaleY(calc(.16 + var(--signal-height) * .22))}
          100%{transform:scaleY(calc(.38 + var(--signal-height) * .62))}
        }

        @media(max-width:700px){
          .tr-audioDeck--pro7 .tr-audioSignalField{height:62px}
          .tr-audioDeck--pro7 .tr-audioSignalBars{gap:3px}
          .tr-audioDeck--pro7 .tr-audioSignalBars span{width:min(6px,52%)}
          .tr-audioDeck--pro7 .tr-audioSignalFooter span:nth-child(2){display:none}
        }

        @media(prefers-reduced-motion:reduce){
          .tr-audioDeck--pro7 .tr-audioSignalPanel.is-live .tr-audioSignalBars span{
            animation:none!important;
            transform:scaleY(calc(.22 + var(--signal-height) * .34));
          }
        }

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
        .tr-dspProfileSave{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:9px;padding:10px 0 1px;border-top:1px solid rgba(118,204,236,.09);}
        .tr-dspProfileSaveStatus{display:grid;gap:3px;min-width:0}.tr-dspProfileSaveStatus>span{color:rgba(183,209,222,.50);font-size:7px;font-weight:1000;letter-spacing:.14em}.tr-dspProfileSaveStatus>strong{color:#eef7fb;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr-dspProfileSaveStatus>small{color:#7edfb2;font-size:8px}
        .tr-dspProfileSaveActions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end}
        .tr-dspProfileSaveActions button,.tr-headphoneModes button{min-height:32px;padding:0 11px;border:1px solid rgba(124,195,220,.14);border-radius:9px;color:rgba(232,244,250,.78);background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(0,0,0,.18));font-size:8px;font-weight:1000;letter-spacing:.07em;cursor:pointer;}
        .tr-dspProfileSaveActions button.is-primary{border-color:rgba(255,190,89,.42);color:#171006;background:linear-gradient(180deg,#ffc762,#f09a18);box-shadow:inset 0 1px 0 rgba(255,255,255,.40),0 5px 14px rgba(240,154,24,.14)}
        .tr-dspSaveOverlay{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px;background:rgba(2,7,11,.78);backdrop-filter:blur(7px)}
        .tr-dspSaveDialog{width:min(520px,100%);overflow:hidden;border:1px solid rgba(86,197,237,.28);border-radius:16px;background:linear-gradient(180deg,#101d27,#081118);box-shadow:0 28px 85px rgba(0,0,0,.58),inset 0 1px 0 rgba(255,255,255,.055)}
        .tr-dspSaveDialog header{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:16px 17px 14px;border-bottom:1px solid rgba(126,200,226,.10)}
        .tr-dspSaveDialog header>div{display:grid;gap:3px}.tr-dspSaveDialog h3{margin:0;color:#f4f9fc;font-size:19px}.tr-dspSaveClose{width:36px;height:36px;border:1px solid rgba(255,255,255,.08);border-radius:10px;color:#dcebf2;background:#0b141b;font-size:22px;cursor:pointer}
        .tr-dspSaveName{display:grid;gap:6px;padding:15px 17px 8px}.tr-dspSaveName>span,.tr-dspSaveSlots>span,.tr-dspSaveIncludes>span{color:rgba(180,205,217,.52);font-size:7px;font-weight:1000;letter-spacing:.14em}
        .tr-dspSaveName input{height:42px;border:1px solid rgba(116,198,228,.20);border-radius:10px;padding:0 12px;color:#f5f9fb;background:#060d12;outline:none;font:inherit;font-weight:850}.tr-dspSaveName input:focus{border-color:rgba(72,199,246,.55);box-shadow:0 0 0 3px rgba(39,176,229,.08)}
        .tr-dspSaveSlots{display:grid;gap:7px;padding:9px 17px}.tr-dspSaveSlots>div{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
        .tr-dspSaveSlots button{min-height:60px;display:grid;align-content:center;gap:4px;padding:8px;border:1px solid rgba(255,255,255,.07);border-radius:10px;color:#d8e7ee;background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(0,0,0,.15));cursor:pointer;text-align:left}.tr-dspSaveSlots button b{font-size:9px;letter-spacing:.07em}.tr-dspSaveSlots button small{color:rgba(184,205,216,.50);font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr-dspSaveSlots button.is-active{border-color:rgba(65,200,248,.52);background:rgba(0,158,223,.10);box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
        .tr-dspSaveIncludes{display:grid;gap:5px;margin:7px 17px 0;padding:11px;border:1px solid rgba(255,255,255,.055);border-radius:10px;background:rgba(0,0,0,.13)}.tr-dspSaveIncludes p{margin:0;color:rgba(212,227,235,.62);font-size:9px;line-height:1.45}
        .tr-dspSaveDialog footer{display:flex;justify-content:flex-end;gap:8px;padding:15px 17px 17px}.tr-dspSaveDialog footer button{min-height:38px;padding:0 16px;border:1px solid rgba(120,193,220,.14);border-radius:10px;color:#dceaf1;background:#0b151c;font-size:9px;font-weight:1000;letter-spacing:.06em;cursor:pointer}.tr-dspSaveDialog footer button.is-primary{border-color:rgba(255,190,89,.42);color:#171006;background:linear-gradient(180deg,#ffc762,#f09a18);box-shadow:inset 0 1px 0 rgba(255,255,255,.40)}
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
          .tr-dspProfileSave{align-items:flex-start;flex-direction:column}.tr-dspProfileSaveActions{width:100%;justify-content:flex-start}.tr-dspSaveSlots>div{grid-template-columns:1fr}.tr-dspSaveDialog{max-height:calc(100vh - 24px);overflow:auto;}
        }
      `}</style>
    </section>
  );
}
