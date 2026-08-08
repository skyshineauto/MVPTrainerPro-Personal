import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { getMusicArtworkSignedUrl, type MusicTrack } from "../../lib/musicStorage";
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
  getMusicRtaLevels,
  loadMusicLibrary,
  MUSIC_EQ_FREQUENCIES,
  MUSIC_EQ_PRESETS,
  MUSIC_HEADPHONE_MODES,
  MUSIC_RTA_FREQUENCIES,
  nextMusicTrack,
  pauseMusic,
  playMusic,
  playMusicPlaylist,
  previousMusicTrack,
  recoverMusicDsp,
  saveMusicEqCustomPreset,
  seekMusic,
  setMusicDspBypass,
  setMusicEqBand,
  setMusicEqEnabled,
  setMusicHeadphoneBassImpact,
  setMusicHeadphoneCenter,
  setMusicHeadphoneCrossfeed,
  setMusicHeadphoneDepth,
  setMusicHeadphoneMode,
  setMusicHeadphoneWidth,
  setMusicPreamp,
  setPlayerMusicPreference,
  stopMusic,
  toggleMusicShuffle,
  useMusicPlayer,
  type MusicCustomPresetSlot,
  type MusicEqPreset,
  type MusicHeadphoneMode,
} from "../../lib/musicPlayer";

const PLAYLISTS_CHANGED_EVENT = "mvp:music-playlists-changed";
const PROFILE_KEY = "mvp_music_dsp_profiles_v1";
const PROFILE_SLOTS: MusicCustomPresetSlot[] = [
  "custom_1",
  "custom_2",
  "custom_3",
];

type DspProfile = {
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

type DspProfiles = Record<MusicCustomPresetSlot, DspProfile | null>;

function blankProfiles(): DspProfiles {
  return { custom_1: null, custom_2: null, custom_3: null };
}

function readProfiles(): DspProfiles {
  if (typeof window === "undefined") return blankProfiles();
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(PROFILE_KEY) || "{}"
    ) as Partial<DspProfiles>;
    return {
      custom_1: parsed.custom_1 || null,
      custom_2: parsed.custom_2 || null,
      custom_3: parsed.custom_3 || null,
    };
  } catch {
    return blankProfiles();
  }
}

function writeProfiles(value: DspProfiles) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(value));
}

function hzLabel(frequency: number) {
  if (frequency >= 1000) {
    const value = frequency / 1000;
    return `${Number.isInteger(value) ? value : value.toFixed(1)}K`;
  }
  return String(frequency);
}

function dbFromLinear(value: number) {
  if (value <= 0.001) return -60;
  return Math.max(-60, Math.min(0, 20 * Math.log10(value)));
}

function buildSpectrum(levels: number[], count = 36) {
  if (!levels.length) return Array(count).fill(0);

  return Array.from({ length: count }, (_, index) => {
    const position =
      (index / Math.max(1, count - 1)) * (levels.length - 1);
    const left = Math.floor(position);
    const right = Math.min(levels.length - 1, left + 1);
    const ratio = position - left;
    const interpolated =
      (levels[left] || 0) * (1 - ratio) +
      (levels[right] || 0) * ratio;

    // Tiny deterministic contour prevents the display from looking like ten
    // duplicated rectangles while remaining driven by the real analyser.
    const contour =
      0.94 +
      Math.sin(index * 1.71) * 0.035 +
      Math.sin(index * 0.57) * 0.02;

    return Math.max(0, Math.min(1, interpolated * contour));
  });
}

function ProRta({
  playing,
  dspStatus,
}: {
  playing: boolean;
  dspStatus: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(true);
  const [levels, setLevels] = useState<number[]>(() =>
    Array(MUSIC_RTA_FREQUENCIES.length).fill(0)
  );
  const [peaks, setPeaks] = useState<number[]>(() => Array(36).fill(0));

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) =>
        setVisible(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.04 }
    );

    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;

    const timer = window.setInterval(() => {
      const raw = playing
        ? getMusicRtaLevels()
        : Array(MUSIC_RTA_FREQUENCIES.length).fill(0);

      setLevels((current) =>
        raw.map((targetValue, index) => {
          const target = Math.max(
            0,
            Math.min(1, Number(targetValue) || 0)
          );
          const previous = current[index] || 0;
          const coefficient = target > previous ? 0.62 : 0.19;
          const smoothed =
            previous + (target - previous) * coefficient;
          return smoothed < 0.004 ? 0 : smoothed;
        })
      );
    }, 52);

    return () => window.clearInterval(timer);
  }, [playing, visible]);

  const spectrum = useMemo(() => buildSpectrum(levels, 36), [levels]);

  useEffect(() => {
    setPeaks((current) =>
      spectrum.map((value, index) =>
        Math.max(value, (current[index] || 0) * 0.968)
      )
    );
  }, [spectrum]);

  const outputPeak = Math.max(0, ...spectrum);
  const bass = spectrum.slice(0, 10).reduce((sum, value) => sum + value, 0) / 10;
  const peakDb = dbFromLinear(outputPeak);

  return (
    <div ref={hostRef} className="tr12-rta" aria-label="Live DSP real-time analyzer">
      <div className="tr12-rtaTop">
        <div>
          <span className={`tr12-liveDot ${playing ? "is-live" : ""}`} />
          <strong>LIVE DSP ANALYZER</strong>
          <small>36 COLUMN • PEAK HOLD • LOG SCALE</small>
        </div>
        <div className="tr12-rtaReadouts">
          <span>
            <small>OUTPUT</small>
            <b>{playing ? `${peakDb.toFixed(1)} dB` : "READY"}</b>
          </span>
          <span>
            <small>BASS DRIVE</small>
            <b>{playing ? `${Math.round(bass * 100)}%` : "0%"}</b>
          </span>
          <span>
            <small>DSP</small>
            <b>{String(dspStatus || "ready").toUpperCase()}</b>
          </span>
        </div>
      </div>

      <div className="tr12-rtaBody" aria-hidden>
        <div className="tr12-dbScale">
          <span>0</span>
          <span>-12</span>
          <span>-24</span>
          <span>-36</span>
          <span>-48</span>
          <span>-60</span>
          <i>dB</i>
        </div>

        <div className="tr12-spectrumWrap">
          <div className="tr12-spectrum">
            {spectrum.map((value, index) => {
              const peak = peaks[index] || 0;
              return (
                <div className="tr12-spectrumColumn" key={index}>
                  <span
                    className="tr12-spectrumFill"
                    style={{
                      transform: `scaleY(${Math.max(0.008, value)})`,
                    }}
                  />
                  <i
                    className="tr12-spectrumPeak"
                    style={{
                      bottom: `${Math.max(1.5, peak * 97)}%`,
                    }}
                  />
                </div>
              );
            })}
          </div>

          <div className="tr12-rtaLabels">
            {MUSIC_RTA_FREQUENCIES.map((frequency) => (
              <span key={frequency}>{hzLabel(frequency)}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TransportIcon({
  type,
}: {
  type:
    | "prev"
    | "play"
    | "pause"
    | "stop"
    | "next"
    | "shuffle"
    | "repeat"
    | "eq";
}) {
  if (type === "prev") {
    return <span aria-hidden>◀◀</span>;
  }
  if (type === "next") {
    return <span aria-hidden>▶▶</span>;
  }
  if (type === "play") {
    return <span aria-hidden>▶</span>;
  }
  if (type === "pause") {
    return <span aria-hidden>Ⅱ</span>;
  }
  if (type === "stop") {
    return <span aria-hidden>■</span>;
  }
  if (type === "shuffle") {
    return <span aria-hidden>⇄</span>;
  }
  if (type === "repeat") {
    return <span aria-hidden>↻</span>;
  }
  return <span aria-hidden>EQ</span>;
}

export function MusicMiniPlayer({
  navigate,
}: {
  navigate: (to: string) => void;
}) {
  const player = useMusicPlayer();
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [eqOpen, setEqOpen] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [profiles, setProfiles] = useState<DspProfiles>(() => readProfiles());
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveSlot, setSaveSlot] =
    useState<MusicCustomPresetSlot>("custom_1");
  const [saveName, setSaveName] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const refresh = () => {
      void listMusicPlaylists()
        .then(setPlaylists)
        .catch(() => setPlaylists([]));
    };

    void loadMusicLibrary();
    refresh();
    window.addEventListener(PLAYLISTS_CHANGED_EVENT, refresh);
    return () =>
      window.removeEventListener(PLAYLISTS_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setArtworkUrl(null);

    const track = player.currentTrack;
    if (!track) return () => { cancelled = true; };

    void getMusicArtworkSignedUrl(track)
      .then((url) => {
        if (!cancelled) setArtworkUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setArtworkUrl(track.external_artwork_url || null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    player.currentTrack?.id,
    player.currentTrack?.artwork_path,
    player.currentTrack?.external_artwork_url,
  ]);

  const run = (action: () => void | Promise<void>) => {
    try {
      const result = action();
      if (result instanceof Promise) {
        void result.catch(() => undefined);
      }
    } catch {
      // musicPlayer exposes transport errors in player.error.
    }
  };

  async function selectQueue(value: string) {
    setQueueBusy(true);
    try {
      if (value === "all") {
        const keepPlaying = player.playing;
        activateAllMusicTracks();
        if (keepPlaying) await playMusic();
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
        .filter((track): track is MusicTrack => Boolean(track));

      if (player.playing) {
        await playMusicPlaylist(playlist, tracks);
      } else {
        activateMusicPlaylistQueue(playlist, tracks);
      }
    } finally {
      setQueueBusy(false);
    }
  }

  function changeSeek(event: ChangeEvent<HTMLInputElement>) {
    seekMusic(Number(event.target.value));
  }

  async function changePreference(
    preference: "like" | "play_less" | "neutral"
  ) {
    const track = player.currentTrack;
    if (!track) return;
    try {
      await setPlayerMusicPreference(track.id, preference);
    } catch {
      // player state will reflect errors from the data layer.
    }
  }

  function loadProfile(slot: MusicCustomPresetSlot) {
    const profile = profiles[slot];
    if (!profile) {
      applyMusicEqPreset(slot);
      return;
    }

    profile.eqGains.forEach((gain, index) =>
      setMusicEqBand(index, gain)
    );
    setMusicPreamp(profile.preampDb);
    setMusicEqEnabled(profile.eqEnabled);
    setMusicHeadphoneMode(profile.headphoneMode);
    setMusicHeadphoneWidth(profile.headphoneWidth);
    setMusicHeadphoneDepth(profile.headphoneDepth);
    setMusicHeadphoneCrossfeed(profile.headphoneCrossfeed);
    setMusicHeadphoneCenter(profile.headphoneCenter);
    setMusicHeadphoneBassImpact(profile.headphoneBassImpact);
    setNotice(`${profile.name} loaded.`);
    window.setTimeout(() => setNotice(""), 1400);
  }

  function saveProfile() {
    const slot = saveSlot;
    const profile: DspProfile = {
      name:
        saveName.trim() ||
        `Custom ${PROFILE_SLOTS.indexOf(slot) + 1}`,
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

    const next = { ...profiles, [slot]: profile };
    setProfiles(next);
    writeProfiles(next);
    saveMusicEqCustomPreset(slot);
    setSaveOpen(false);
    setSaveName("");
    setNotice(`${profile.name} saved.`);
    window.setTimeout(() => setNotice(""), 1600);
  }

  const track = player.currentTrack;
  const duration =
    player.duration || track?.duration_seconds || 0;
  const progressMax = Math.max(1, duration);
  const presetEntries = Object.entries(MUSIC_EQ_PRESETS) as Array<
    [MusicEqPreset, { label: string; gains: number[]; preamp: number }]
  >;

  return (
    <section className="tr12-player" aria-label="MVP Trainer music player">
      <div className="tr12-playerTop">
        <div className="tr12-trackIdentity">
          <div className="tr12-artwork">
            {artworkUrl ? (
              <img src={artworkUrl} alt="" />
            ) : (
              <span>♫</span>
            )}
          </div>
          <div className="tr12-trackText">
            <small>NOW PLAYING</small>
            <strong>{track?.title || "Your workout music"}</strong>
            <span>
              {track?.artist?.trim() || "Select a song to begin"}
            </span>
          </div>
        </div>

        <div className="tr12-playerTopActions">
          <label className="tr12-queue">
            <span>QUEUE</span>
            <select
              disabled={queueBusy}
              value={player.activePlaylistId || "all"}
              onChange={(event) =>
                void selectQueue(event.target.value)
              }
            >
              <option value="all">All Songs</option>
              {playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>
                  {playlist.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className={`tr12-dspButton ${eqOpen ? "is-active" : ""}`}
            onClick={() => setEqOpen((value) => !value)}
          >
            <TransportIcon type="eq" />
            <span>DSP / EQ</span>
          </button>

          <button
            type="button"
            className="tr12-libraryButton"
            onClick={() => navigate("/music")}
          >
            MY MUSIC
          </button>
        </div>
      </div>

      <ProRta
        playing={player.playing}
        dspStatus={player.dspStatus}
      />

      <div className="tr12-timeline">
        <span>{formatMusicTime(player.currentTime)}</span>
        <input
          type="range"
          min={0}
          max={progressMax}
          step={0.1}
          value={Math.min(player.currentTime, progressMax)}
          onChange={changeSeek}
          aria-label="Song position"
        />
        <span>{formatMusicTime(duration)}</span>
      </div>

      <div className="tr12-controlDeck">
        <div className="tr12-sideControl">
          <span>PREAMP</span>
          <b>
            {player.preampDb > 0 ? "+" : ""}
            {player.preampDb.toFixed(1)} dB
          </b>
        </div>

        <div className="tr12-transport">
          <button
            type="button"
            className={player.shuffle ? "is-active" : ""}
            onClick={toggleMusicShuffle}
            title="Shuffle"
          >
            <TransportIcon type="shuffle" />
          </button>
          <button
            type="button"
            onClick={() => run(previousMusicTrack)}
            disabled={!player.tracks.length}
            title="Previous"
          >
            <TransportIcon type="prev" />
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={() =>
              run(player.playing ? pauseMusic : playMusic)
            }
            title={player.playing ? "Pause" : "Play"}
          >
            <TransportIcon
              type={player.playing ? "pause" : "play"}
            />
          </button>
          <button
            type="button"
            onClick={stopMusic}
            disabled={!track}
            title="Stop"
          >
            <TransportIcon type="stop" />
          </button>
          <button
            type="button"
            onClick={() => run(() => nextMusicTrack())}
            disabled={!player.tracks.length}
            title="Next"
          >
            <TransportIcon type="next" />
          </button>
          <button
            type="button"
            className={player.repeat !== "off" ? "is-active" : ""}
            onClick={cycleMusicRepeat}
            title={`Repeat ${player.repeat}`}
          >
            <TransportIcon type="repeat" />
            {player.repeat === "one" ? <small>1</small> : null}
          </button>
        </div>

        <div className="tr12-preference">
          <button
            type="button"
            className={track?.play_less ? "is-down" : ""}
            disabled={!track}
            onClick={() =>
              void changePreference(
                track?.play_less ? "neutral" : "play_less"
              )
            }
            title="Play less"
          >
            ↓
          </button>
          <button
            type="button"
            className={track?.favorite ? "is-liked" : ""}
            disabled={!track}
            onClick={() =>
              void changePreference(
                track?.favorite ? "neutral" : "like"
              )
            }
            title="Like"
          >
            ♥
          </button>
        </div>
      </div>

      {notice ? <div className="tr12-notice">{notice}</div> : null}
      {player.error ? (
        <div className="tr12-error">{player.error}</div>
      ) : null}

      {eqOpen ? (
        <section className="tr12-dspPanel">
          <header className="tr12-dspHeader">
            <div>
              <small>PRO AUDIO PROCESSING</small>
              <h3>31-Band Equalizer + Headphone DSP</h3>
              <p>
                RTA shows the processed output after your active DSP.
              </p>
            </div>
            <div className="tr12-dspStatus">
              <span
                className={`is-${player.dspStatus}`}
              >
                {player.dspStatus.toUpperCase()}
              </span>
              <button
                type="button"
                onClick={() =>
                  setMusicDspBypass(!player.dspBypass)
                }
              >
                {player.dspBypass ? "RESTORE DSP" : "BYPASS DSP"}
              </button>
              {player.dspStatus === "unavailable" ? (
                <button
                  type="button"
                  onClick={() => void recoverMusicDsp()}
                >
                  REBUILD AUDIO
                </button>
              ) : null}
            </div>
          </header>

          <div className="tr12-presetRail">
            <label>
              <span>EQ</span>
              <button
                type="button"
                className={player.eqEnabled ? "is-on" : ""}
                onClick={() =>
                  setMusicEqEnabled(!player.eqEnabled)
                }
              >
                {player.eqEnabled ? "ACTIVE" : "OFF"}
              </button>
            </label>

            <label className="tr12-presetSelect">
              <span>FACTORY PRESET</span>
              <select
                value={
                  presetEntries.some(
                    ([value]) => value === player.eqPreset
                  )
                    ? player.eqPreset
                    : "flat"
                }
                onChange={(event) =>
                  applyMusicEqPreset(
                    event.target.value as MusicEqPreset
                  )
                }
              >
                {presetEntries.map(([value, definition]) => (
                  <option key={value} value={value}>
                    {definition.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="tr12-profileRail">
              <span>SAVED DSP</span>
              <div>
                {PROFILE_SLOTS.map((slot, index) => (
                  <button
                    type="button"
                    key={slot}
                    onClick={() => loadProfile(slot)}
                  >
                    <b>{index + 1}</b>
                    <span>
                      {profiles[slot]?.name || `Custom ${index + 1}`}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className="is-save"
                  onClick={() => setSaveOpen(true)}
                >
                  SAVE CURRENT
                </button>
              </div>
            </div>
          </div>

          <div className="tr12-preampRow">
            <div>
              <span>MASTER PREAMP</span>
              <strong>
                {player.preampDb > 0 ? "+" : ""}
                {player.preampDb.toFixed(1)} dB
              </strong>
            </div>
            <input
              type="range"
              min={-12}
              max={12}
              step={0.5}
              value={player.preampDb}
              onChange={(event) =>
                setMusicPreamp(Number(event.target.value))
              }
            />
          </div>

          <div className="tr12-eqWrap">
            <div className="tr12-eqScale" aria-hidden>
              <span>+12</span>
              <span>+6</span>
              <span>0</span>
              <span>-6</span>
              <span>-12</span>
            </div>
            <div className="tr12-eqBands">
              {MUSIC_EQ_FREQUENCIES.map((frequency, index) => (
                <label key={frequency}>
                  <b>
                    {(player.eqGains[index] || 0) > 0 ? "+" : ""}
                    {(player.eqGains[index] || 0).toFixed(1)}
                  </b>
                  <div>
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={0.5}
                      value={player.eqGains[index] || 0}
                      onChange={(event) =>
                        setMusicEqBand(
                          index,
                          Number(event.target.value)
                        )
                      }
                      aria-label={`${frequency} Hz equalizer`}
                    />
                  </div>
                  <span>{hzLabel(frequency)}</span>
                </label>
              ))}
            </div>
          </div>

          <section className="tr12-headphone">
            <header>
              <div>
                <small>HEADPHONE DSP</small>
                <h4>Stage & Spatial Control</h4>
              </div>
              <span>{MUSIC_HEADPHONE_MODES[player.headphoneMode].label}</span>
            </header>

            <div className="tr12-modeButtons">
              {(
                Object.keys(
                  MUSIC_HEADPHONE_MODES
                ) as MusicHeadphoneMode[]
              ).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={
                    player.headphoneMode === mode ? "is-active" : ""
                  }
                  onClick={() => setMusicHeadphoneMode(mode)}
                >
                  {MUSIC_HEADPHONE_MODES[mode].label}
                </button>
              ))}
            </div>

            <div className="tr12-dspSliders">
              {[
                {
                  label: "WIDTH",
                  value: player.headphoneWidth,
                  set: setMusicHeadphoneWidth,
                },
                {
                  label: "DEPTH",
                  value: player.headphoneDepth,
                  set: setMusicHeadphoneDepth,
                },
                {
                  label: "CROSSFEED",
                  value: player.headphoneCrossfeed,
                  set: setMusicHeadphoneCrossfeed,
                },
                {
                  label: "CENTER",
                  value: player.headphoneCenter,
                  set: setMusicHeadphoneCenter,
                },
                {
                  label: "BASS IMPACT",
                  value: player.headphoneBassImpact,
                  set: setMusicHeadphoneBassImpact,
                },
              ].map((control) => (
                <label key={control.label}>
                  <span>
                    {control.label}
                    <b>{Math.round(control.value)}%</b>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={control.value}
                    onChange={(event) =>
                      control.set(Number(event.target.value))
                    }
                  />
                </label>
              ))}
            </div>
          </section>
        </section>
      ) : null}

      {saveOpen ? (
        <div
          className="tr12-saveBack"
          onMouseDown={() => setSaveOpen(false)}
        >
          <section
            className="tr12-saveDialog"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>SAVE DSP PROFILE</small>
                <h3>Store this complete sound setup</h3>
              </div>
              <button type="button" onClick={() => setSaveOpen(false)}>
                ×
              </button>
            </header>

            <label className="tr12-saveName">
              <span>PROFILE NAME</span>
              <input
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                placeholder="Example: Gym Headphones"
                maxLength={32}
              />
            </label>

            <div className="tr12-saveSlots">
              {PROFILE_SLOTS.map((slot, index) => (
                <button
                  type="button"
                  key={slot}
                  className={saveSlot === slot ? "is-active" : ""}
                  onClick={() => setSaveSlot(slot)}
                >
                  <b>CUSTOM {index + 1}</b>
                  <small>
                    {profiles[slot]?.name || "Empty slot"}
                  </small>
                </button>
              ))}
            </div>

            <p className="tr12-saveIncludes">
              Saves the 31-band EQ, preamp, EQ active state, headphone
              mode, width, depth, crossfeed, center and bass impact.
            </p>

            <footer>
              <button type="button" onClick={() => setSaveOpen(false)}>
                CANCEL
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={saveProfile}
              >
                SAVE PRESET
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <style>{`
        .tr12-player{position:relative;width:100%;color:#e8f6fb;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        .tr12-player button,.tr12-player select,.tr12-player input{font:inherit}
        .tr12-playerTop{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 12px;border:1px solid rgba(86,167,198,.16);border-bottom:0;border-radius:14px 14px 0 0;background:linear-gradient(180deg,rgba(7,19,26,.98),rgba(3,10,15,.99))}
        .tr12-trackIdentity{min-width:0;display:flex;align-items:center;gap:10px}
        .tr12-artwork{width:50px;height:50px;flex:0 0 auto;display:grid;place-items:center;overflow:hidden;border:1px solid rgba(106,205,238,.22);border-radius:11px;background:radial-gradient(circle at 35% 25%,#153a4b,#06131b 70%);color:#7fe4ff;font-size:20px;box-shadow:inset 0 1px rgba(255,255,255,.04),0 8px 22px rgba(0,0,0,.22)}
        .tr12-artwork img{width:100%;height:100%;object-fit:cover}
        .tr12-trackText{min-width:0;display:grid;gap:2px}.tr12-trackText small{font-size:7px;font-weight:1000;letter-spacing:.16em;color:#57d5fa}.tr12-trackText strong{max-width:430px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px}.tr12-trackText span{color:#708b96;font-size:9px}
        .tr12-playerTopActions{display:flex;align-items:end;gap:7px}.tr12-queue{display:grid;gap:4px}.tr12-queue>span{font-size:6px;font-weight:1000;letter-spacing:.15em;color:#607c87}.tr12-queue select{height:34px;min-width:145px;padding:0 30px 0 10px;border:1px solid rgba(78,164,196,.18);border-radius:8px;background:#06131a;color:#cfe4ec;font-size:8px;font-weight:900}
        .tr12-dspButton,.tr12-libraryButton{height:34px;padding:0 11px;border:1px solid rgba(78,164,196,.18);border-radius:8px;background:#07141b;color:#c8dce4;font-size:8px;font-weight:1000;letter-spacing:.05em}.tr12-dspButton{display:flex;align-items:center;gap:6px}.tr12-dspButton.is-active{border-color:rgba(71,210,251,.55);background:linear-gradient(180deg,#0b394a,#082531);color:#dff9ff;box-shadow:0 0 20px rgba(40,187,231,.1)}
        .tr12-rta{overflow:hidden;border:1px solid rgba(89,190,226,.22);border-radius:0 0 14px 14px;background:linear-gradient(180deg,#04131b,#02080d);box-shadow:inset 0 1px rgba(255,255,255,.025),inset 0 -20px 45px rgba(0,0,0,.26),0 10px 30px rgba(0,0,0,.22)}
        .tr12-rtaTop{min-height:38px;padding:7px 11px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(81,171,204,.12);background:linear-gradient(180deg,rgba(11,35,45,.62),rgba(5,19,27,.22))}
        .tr12-rtaTop>div:first-child{display:grid;grid-template-columns:auto auto;align-items:center;column-gap:7px}.tr12-rtaTop strong{font-size:8px;letter-spacing:.13em}.tr12-rtaTop small{grid-column:2;color:#5f7882;font-size:6px;font-weight:900;letter-spacing:.1em}
        .tr12-liveDot{width:6px;height:6px;grid-row:1/3;border-radius:50%;background:#32444c;box-shadow:0 0 0 3px rgba(80,110,120,.06)}.tr12-liveDot.is-live{background:#5cf0b1;box-shadow:0 0 10px rgba(92,240,177,.75),0 0 0 3px rgba(92,240,177,.08)}
        .tr12-rtaReadouts{display:flex;gap:6px}.tr12-rtaReadouts>span{min-width:72px;padding:5px 8px;display:grid;gap:1px;border:1px solid rgba(85,155,180,.1);border-radius:6px;background:rgba(0,6,10,.36);text-align:right}.tr12-rtaReadouts small{grid-column:auto;color:#58727d;font-size:5.5px;letter-spacing:.12em}.tr12-rtaReadouts b{font-size:8px;color:#a9eaff;font-variant-numeric:tabular-nums}
        .tr12-rtaBody{display:grid;grid-template-columns:34px minmax(0,1fr);min-height:158px;background:radial-gradient(circle at 50% 110%,rgba(8,84,110,.13),transparent 58%),repeating-linear-gradient(0deg,transparent 0,transparent 23px,rgba(102,185,215,.052) 24px),linear-gradient(90deg,rgba(255,255,255,.01),transparent 12%,transparent 88%,rgba(255,255,255,.01))}
        .tr12-dbScale{padding:12px 4px 24px 0;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;border-right:1px solid rgba(79,151,178,.09);color:#506a75;font-size:6px;font-weight:900;font-variant-numeric:tabular-nums}.tr12-dbScale i{position:absolute;margin-top:124px;font-style:normal;color:#3e5964;font-size:5px}
        .tr12-spectrumWrap{min-width:0;padding:10px 12px 6px}.tr12-spectrum{height:112px;display:grid;grid-template-columns:repeat(36,minmax(2px,1fr));align-items:end;gap:3px}
        .tr12-spectrumColumn{position:relative;height:100%;overflow:hidden;border-left:1px solid rgba(87,177,209,.035);border-right:1px solid rgba(0,0,0,.16);border-radius:2px;background:linear-gradient(180deg,rgba(103,218,245,.045),rgba(35,104,128,.025))}
        .tr12-spectrumFill{position:absolute;inset:2px 1px 1px;transform-origin:bottom;will-change:transform;border-radius:1px;background:linear-gradient(to top,#24acd4 0%,#43dcf0 56%,#68e8ad 76%,#f1cd64 90%,#ff8b55 100%);box-shadow:0 0 8px rgba(55,203,239,.22);mask-image:repeating-linear-gradient(to top,#000 0,#000 4px,transparent 4px,transparent 6px);-webkit-mask-image:repeating-linear-gradient(to top,#000 0,#000 4px,transparent 4px,transparent 6px);transition:transform .045s linear}
        .tr12-spectrumPeak{position:absolute;left:1px;right:1px;height:2px;border-radius:2px;background:#e9fbff;box-shadow:0 0 6px rgba(188,242,255,.65);transition:bottom .05s linear}
        .tr12-rtaLabels{height:22px;display:grid;grid-template-columns:repeat(10,1fr);align-items:end;text-align:center;color:#55727e;font-size:6px;font-weight:1000;font-variant-numeric:tabular-nums}
        .tr12-timeline{display:grid;grid-template-columns:42px 1fr 42px;align-items:center;gap:8px;padding:8px 11px;color:#6f8a95;font-size:8px;font-weight:900;font-variant-numeric:tabular-nums}.tr12-timeline span:last-child{text-align:right}.tr12-timeline input{width:100%;accent-color:#50d6f8}
        .tr12-controlDeck{min-height:58px;padding:8px 10px;display:grid;grid-template-columns:110px 1fr 110px;align-items:center;gap:10px;border:1px solid rgba(83,158,186,.13);border-radius:12px;background:linear-gradient(180deg,#071219,#040b0f)}
        .tr12-sideControl{display:grid;gap:2px}.tr12-sideControl span{font-size:6px;font-weight:1000;letter-spacing:.13em;color:#607a85}.tr12-sideControl b{font-size:11px;color:#b9d5df;font-variant-numeric:tabular-nums}
        .tr12-transport{display:flex;justify-content:center;align-items:center;gap:6px}.tr12-transport button,.tr12-preference button{position:relative;width:38px;height:38px;border:1px solid rgba(91,165,192,.14);border-radius:9px;background:linear-gradient(180deg,#0b1d25,#061117);color:#9cb2bb;font-size:9px;font-weight:1000;box-shadow:inset 0 1px rgba(255,255,255,.025)}.tr12-transport button:hover,.tr12-preference button:hover{border-color:rgba(84,204,244,.34);color:#d8f6ff}.tr12-transport button.is-primary{width:48px;height:48px;border-color:rgba(81,213,252,.5);background:linear-gradient(180deg,#157593,#0b4258);color:white;font-size:15px;box-shadow:0 6px 20px rgba(22,154,196,.2),inset 0 1px rgba(255,255,255,.12)}.tr12-transport button.is-active{color:#65e3ff;border-color:rgba(70,210,249,.4);background:#0a2732}.tr12-transport small{position:absolute;right:5px;bottom:3px;font-size:6px}
        .tr12-preference{display:flex;justify-content:flex-end;gap:6px}.tr12-preference button.is-liked{color:#63e6ab;border-color:rgba(78,220,162,.35);background:rgba(15,66,49,.42)}.tr12-preference button.is-down{color:#ff8c91;border-color:rgba(255,100,108,.33);background:rgba(76,20,25,.42)}
        .tr12-notice,.tr12-error{margin-top:7px;padding:8px 10px;border-radius:8px;font-size:8px;font-weight:850}.tr12-notice{border:1px solid rgba(72,218,157,.22);background:rgba(18,70,51,.22);color:#88e6b8}.tr12-error{border:1px solid rgba(255,88,98,.3);background:rgba(89,20,25,.28);color:#ffacb0}
        .tr12-dspPanel{margin-top:8px;overflow:hidden;border:1px solid rgba(79,181,219,.2);border-radius:14px;background:linear-gradient(180deg,#07171f,#030a0e);box-shadow:0 16px 38px rgba(0,0,0,.24)}
        .tr12-dspHeader{padding:14px 16px;display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid rgba(79,158,187,.11);background:linear-gradient(180deg,rgba(11,37,49,.58),rgba(5,17,24,.18))}.tr12-dspHeader small,.tr12-headphone small,.tr12-saveDialog small{color:#54d1f5;font-size:7px;font-weight:1000;letter-spacing:.14em}.tr12-dspHeader h3{margin:4px 0 2px;font-size:17px}.tr12-dspHeader p{margin:0;color:#647f89;font-size:8px}
        .tr12-dspStatus{display:flex;align-items:center;gap:6px}.tr12-dspStatus>span{padding:6px 8px;border:1px solid rgba(90,178,208,.15);border-radius:6px;color:#76d9f2;font-size:6px;font-weight:1000;letter-spacing:.08em}.tr12-dspStatus>span.is-active{color:#67e5ad;border-color:rgba(71,214,157,.23)}.tr12-dspStatus button{height:30px;padding:0 9px;border:1px solid rgba(82,166,197,.17);border-radius:7px;background:#06141b;color:#aac5cf;font-size:7px;font-weight:950}
        .tr12-presetRail{padding:10px 14px;display:grid;grid-template-columns:auto minmax(180px,260px) 1fr;gap:12px;align-items:end;border-bottom:1px solid rgba(76,146,172,.09)}.tr12-presetRail label,.tr12-profileRail{display:grid;gap:5px}.tr12-presetRail label>span,.tr12-profileRail>span{color:#5d7781;font-size:6px;font-weight:1000;letter-spacing:.12em}.tr12-presetRail button,.tr12-presetRail select{height:34px;border:1px solid rgba(81,158,186,.16);border-radius:8px;background:#06131a;color:#b9d0d8;font-size:8px;font-weight:900}.tr12-presetRail label>button{padding:0 10px}.tr12-presetRail label>button.is-on{color:#6de9b1;border-color:rgba(76,218,160,.3);background:rgba(13,66,48,.3)}.tr12-presetSelect select{padding:0 10px}
        .tr12-profileRail>div{display:flex;gap:5px;flex-wrap:wrap}.tr12-profileRail button{padding:0 9px;display:flex;align-items:center;gap:6px}.tr12-profileRail button b{width:18px;height:18px;display:grid;place-items:center;border-radius:5px;background:rgba(76,181,217,.1);color:#71dcf5;font-size:7px}.tr12-profileRail button span{max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tr12-profileRail button.is-save{color:#efc66e;border-color:rgba(227,175,72,.25)}
        .tr12-preampRow{padding:10px 14px;display:grid;grid-template-columns:130px 1fr;gap:12px;align-items:center;border-bottom:1px solid rgba(75,145,170,.08)}.tr12-preampRow>div{display:flex;justify-content:space-between;gap:8px}.tr12-preampRow span{color:#617b86;font-size:7px;font-weight:1000;letter-spacing:.1em}.tr12-preampRow strong{font-size:9px;color:#a9dcea}.tr12-preampRow input{width:100%;accent-color:#52d6f7}
        .tr12-eqWrap{display:grid;grid-template-columns:30px minmax(0,1fr);padding:13px 12px 12px}.tr12-eqScale{height:178px;padding:3px 4px 23px 0;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;color:#4d6873;font-size:6px;font-weight:900}.tr12-eqBands{min-width:0;display:grid;grid-template-columns:repeat(31,minmax(13px,1fr));gap:2px}.tr12-eqBands label{min-width:0;display:grid;grid-template-rows:16px 142px 18px;justify-items:center;text-align:center}.tr12-eqBands label>b{font-size:5.5px;color:#6f8b96;font-variant-numeric:tabular-nums}.tr12-eqBands label>div{position:relative;width:14px;height:138px;display:grid;place-items:center;border-radius:7px;background:linear-gradient(90deg,transparent 46%,rgba(86,168,198,.15) 47%,rgba(86,168,198,.15) 53%,transparent 54%)}.tr12-eqBands input{width:128px;transform:rotate(-90deg);accent-color:#56d6f6}.tr12-eqBands span{font-size:5.5px;color:#52707b;writing-mode:vertical-rl;transform:rotate(180deg);font-weight:900}
        .tr12-headphone{margin:0 12px 12px;overflow:hidden;border:1px solid rgba(77,159,190,.13);border-radius:10px;background:#041016}.tr12-headphone>header{padding:10px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(73,149,176,.09)}.tr12-headphone h4{margin:3px 0 0;font-size:13px}.tr12-headphone>header>span{color:#80dff5;font-size:8px;font-weight:1000}
        .tr12-modeButtons{padding:9px 10px;display:flex;gap:5px;flex-wrap:wrap}.tr12-modeButtons button{height:31px;padding:0 10px;border:1px solid rgba(75,151,178,.13);border-radius:7px;background:#07151c;color:#819aa4;font-size:7px;font-weight:950}.tr12-modeButtons button.is-active{border-color:rgba(79,207,247,.45);background:#0a3342;color:#d9f8ff}
        .tr12-dspSliders{padding:5px 11px 12px;display:grid;grid-template-columns:repeat(5,1fr);gap:9px}.tr12-dspSliders label{display:grid;gap:5px}.tr12-dspSliders label>span{display:flex;justify-content:space-between;color:#617b85;font-size:6px;font-weight:1000}.tr12-dspSliders b{color:#a6dbe8;font-size:7px}.tr12-dspSliders input{width:100%;accent-color:#53d5f6}
        .tr12-saveBack{position:fixed;inset:0;z-index:5000;padding:20px;display:grid;place-items:center;background:rgba(0,4,7,.88);backdrop-filter:blur(10px)}.tr12-saveDialog{width:min(560px,100%);overflow:hidden;border:1px solid rgba(88,199,237,.3);border-radius:16px;background:linear-gradient(180deg,#0b202a,#050d12);box-shadow:0 30px 80px rgba(0,0,0,.65)}.tr12-saveDialog header{padding:16px 18px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(82,157,184,.12)}.tr12-saveDialog h3{margin:4px 0 0;font-size:18px}.tr12-saveDialog header>button{width:34px;height:34px;border:1px solid rgba(82,157,184,.16);border-radius:8px;background:#071219;color:#d7e9ef;font-size:19px}.tr12-saveName{padding:14px 18px;display:grid;gap:6px}.tr12-saveName span{font-size:7px;font-weight:1000;letter-spacing:.12em;color:#617b85}.tr12-saveName input{height:40px;padding:0 11px;border:1px solid rgba(76,164,195,.18);border-radius:8px;background:#06131a;color:#e9f7fb;outline:none}.tr12-saveName input:focus{border-color:rgba(73,210,251,.5)}
        .tr12-saveSlots{padding:0 18px;display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.tr12-saveSlots button{min-height:56px;padding:8px;display:grid;gap:3px;text-align:left;border:1px solid rgba(75,151,178,.14);border-radius:9px;background:#07151c;color:#bcd2da}.tr12-saveSlots button.is-active{border-color:rgba(74,211,251,.52);background:#0a3040}.tr12-saveSlots b{font-size:8px}.tr12-saveSlots small{color:#6f8993;font-size:7px}.tr12-saveIncludes{margin:13px 18px;padding:10px;border:1px solid rgba(76,151,178,.1);border-radius:8px;background:#061219;color:#718a94;font-size:8px;line-height:1.5}.tr12-saveDialog footer{padding:13px 18px;display:flex;justify-content:flex-end;gap:7px;border-top:1px solid rgba(79,151,178,.1)}.tr12-saveDialog footer button{height:36px;padding:0 12px;border:1px solid rgba(76,159,188,.17);border-radius:8px;background:#07141b;color:#c8dde5;font-size:8px;font-weight:1000}.tr12-saveDialog footer button.is-primary{border-color:rgba(74,207,248,.46);background:#0a3443;color:#dff9ff}
        @media(max-width:850px){.tr12-playerTop{align-items:flex-start}.tr12-playerTopActions{flex-wrap:wrap;justify-content:flex-end}.tr12-rtaReadouts span:nth-child(2){display:none}.tr12-controlDeck{grid-template-columns:70px 1fr 70px}.tr12-transport{gap:4px}.tr12-transport button,.tr12-preference button{width:34px;height:34px}.tr12-transport button.is-primary{width:44px;height:44px}.tr12-presetRail{grid-template-columns:auto 1fr}.tr12-profileRail{grid-column:1/-1}.tr12-eqBands{overflow-x:auto;grid-template-columns:repeat(31,18px);padding-bottom:4px}.tr12-dspSliders{grid-template-columns:1fr 1fr}}
        @media(max-width:600px){.tr12-playerTop{display:block}.tr12-playerTopActions{margin-top:9px;display:grid;grid-template-columns:1fr 1fr}.tr12-queue{grid-column:1/-1}.tr12-queue select{width:100%}.tr12-trackText strong{max-width:250px}.tr12-rtaTop{align-items:flex-start}.tr12-rtaReadouts span:nth-child(2),.tr12-rtaReadouts span:nth-child(3){display:none}.tr12-rtaBody{grid-template-columns:28px minmax(0,1fr);min-height:142px}.tr12-spectrumWrap{padding-left:7px;padding-right:7px}.tr12-spectrum{height:100px;gap:2px}.tr12-rtaLabels span:nth-child(even){display:none}.tr12-rtaLabels{grid-template-columns:repeat(5,1fr)}.tr12-controlDeck{grid-template-columns:1fr}.tr12-sideControl{display:none}.tr12-preference{justify-content:center}.tr12-transport{order:-1}.tr12-presetRail{grid-template-columns:1fr}.tr12-profileRail{grid-column:auto}.tr12-preampRow{grid-template-columns:1fr}.tr12-dspHeader{display:block}.tr12-dspStatus{margin-top:10px;flex-wrap:wrap}.tr12-modeButtons{display:grid;grid-template-columns:1fr 1fr 1fr}.tr12-saveSlots{grid-template-columns:1fr}}
      `}</style>
    </section>
  );
}
