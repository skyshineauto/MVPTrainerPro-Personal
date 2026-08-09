import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  getMusicArtworkSignedUrl,
  type MusicTrack,
} from "../../lib/musicStorage";
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
const DSP_PROFILE_STORAGE_KEY = "mvp_music_dsp_profiles_v1";
const DSP_SLOTS: MusicCustomPresetSlot[] = ["custom_1", "custom_2", "custom_3"];

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

function emptyDspProfiles(): SavedDspProfiles {
  return { custom_1: null, custom_2: null, custom_3: null };
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

function isCustomSlot(value: MusicEqPreset): value is MusicCustomPresetSlot {
  return value === "custom_1" || value === "custom_2" || value === "custom_3";
}

function slotFallbackLabel(slot: MusicCustomPresetSlot) {
  return slot === "custom_1" ? "Custom 1" : slot === "custom_2" ? "Custom 2" : "Custom 3";
}

function sameDspNumber(left: number, right: number) {
  return Math.abs(Number(left) - Number(right)) < 0.01;
}

function formatHz(frequency: number) {
  if (frequency >= 1000) {
    const value = frequency / 1000;
    return `${Number.isInteger(value) ? value : Number(value.toFixed(1))}K`;
  }
  return String(frequency);
}

function PlayerIcon({ name }: { name: IconName }) {
  if (name === "play") return <svg viewBox="0 0 24 24" aria-hidden><path d="M8 5.4v13.2L19 12 8 5.4Z" /></svg>;
  if (name === "pause") return <svg viewBox="0 0 24 24" aria-hidden><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" /></svg>;
  if (name === "stop") return <svg viewBox="0 0 24 24" aria-hidden><rect x="6" y="6" width="12" height="12" rx="1.6" /></svg>;
  if (name === "back") return <svg viewBox="0 0 24 24" aria-hidden><path d="M5 6h2.5v12H5V6Zm3.8 6 9.7-6v12l-9.7-6Z" /></svg>;
  if (name === "next") return <svg viewBox="0 0 24 24" aria-hidden><path d="M16.5 6H19v12h-2.5V6ZM5.5 6l9.7 6-9.7 6V6Z" /></svg>;
  if (name === "shuffle") return <svg viewBox="0 0 24 24" aria-hidden><path d="M16.8 4.5H20V7.7h-2V6.9l-3.7 3.7-1.4-1.4 3.6-3.6h-.7v-2Zm-12.8 2h3.2c1.6 0 2.7.5 3.7 1.5l6.8 6.8V14H20v5.5h-5.5v-2h1.8l-6.8-6.8c-.6-.6-1.2-.8-2.3-.8H4v-3.4Zm0 11h3.2c1.1 0 1.7-.2 2.3-.8l1.5-1.5 1.4 1.4-1.5 1.5c-1 1-2.1 1.4-3.7 1.4H4v-2Z" /></svg>;
  if (name === "repeat") return <svg viewBox="0 0 24 24" aria-hidden><path d="M7 5h9.3l-1.8-1.8L16 1.8 20.2 6 16 10.2l-1.5-1.4L16.3 7H7a3 3 0 0 0-3 3v1H2v-1a5 5 0 0 1 5-5Zm15 8v1a5 5 0 0 1-5 5H7.7l1.8 1.8L8 22.2 3.8 18 8 13.8l1.5 1.4L7.7 17H17a3 3 0 0 0 3-3v-1h2Z" /></svg>;
  if (name === "like") return <svg viewBox="0 0 24 24" aria-hidden><path d="M9.2 21H5.5A2.5 2.5 0 0 1 3 18.5v-8A2.5 2.5 0 0 1 5.5 8H9l3.2-5.1A2 2 0 0 1 16 4v4h3.2a2.8 2.8 0 0 1 2.7 3.5l-1.8 7A3.4 3.4 0 0 1 16.8 21H9.2Zm-1.7-2V10H5.5a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h2Zm2 0h7.3a1.4 1.4 0 0 0 1.4-1.1l1.8-7a.8.8 0 0 0-.8-.9H14V4.8l-4.5 7.1V19Z" /></svg>;
  if (name === "dislike") return <svg viewBox="0 0 24 24" aria-hidden><path d="M14.8 3h3.7A2.5 2.5 0 0 1 21 5.5v8a2.5 2.5 0 0 1-2.5 2.5H15l-3.2 5.1A2 2 0 0 1 8 20v-4H4.8a2.8 2.8 0 0 1-2.7-3.5l1.8-7A3.4 3.4 0 0 1 7.2 3h7.6Zm1.7 2v9h2a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5h-2Zm-2 0H7.2a1.4 1.4 0 0 0-1.4 1.1L4 13.1a.8.8 0 0 0 .8.9H10v5.2l4.5-7.1V5Z" /></svg>;
  if (name === "equalizer") return <svg viewBox="0 0 24 24" aria-hidden><path d="M5 3h2v18H5V3Zm6 4h2v14h-2V7Zm6-4h2v18h-2V3ZM3 8h6v3H3V8Zm6 5h6v3H9v-3Zm6-4h6v3h-6V9Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden><path d="M9 4v11.1A4.5 4.5 0 1 0 11 19V8.1l8-2V12a4.5 4.5 0 1 0 2 3.9V2L9 4Z" /></svg>;
}

function normalizeTenBands(values: number[]) {
  if (!values.length) return Array(10).fill(0);
  if (values.length === 10) return values.map((v) => Math.max(0, Math.min(1, Number(v) || 0)));
  return Array.from({ length: 10 }, (_, index) => {
    const position = (index / 9) * Math.max(0, values.length - 1);
    const left = Math.floor(position);
    const right = Math.min(values.length - 1, left + 1);
    const ratio = position - left;
    const value = (Number(values[left]) || 0) * (1 - ratio) + (Number(values[right]) || 0) * ratio;
    return Math.max(0, Math.min(1, value));
  });
}

function rtaRawToDb(rawValue: number) {
  const raw = Math.max(0, Math.min(1, Number(rawValue) || 0));
  if (raw <= 0.002) return -72;

  // The engine returns a normalized per-band amplitude. Shape each band
  // independently so normal music has real headroom instead of pinning all
  // ten columns near the ceiling. This does not normalize bands against one
  // another and never introduces synthetic/random movement.
  // Convert the real normalized analyser amplitude to a display dB value.
  // The extra display headroom keeps mastered music from pinning every band
  // near the ceiling while preserving the real relationship between bands.
  const db = 20 * Math.log10(Math.max(raw, 0.00025)) - 18;
  return Math.max(-72, Math.min(-4, db));
}

function rtaDbToMeter(db: number) {
  return Math.max(0, Math.min(1, (db + 72) / 72));
}

const RTA_SEGMENTS = 18;

function TenBandRta({ playing }: { playing: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(true);
  const [levels, setLevels] = useState<number[]>(() => Array(10).fill(0));
  const [peaks, setPeaks] = useState<number[]>(() => Array(10).fill(0));
  const peakHoldUntilRef = useRef<number[]>(Array(10).fill(0));

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
    const timer = window.setInterval(() => {
      const raw = playing && visible
        ? normalizeTenBands(getMusicRtaLevels())
        : Array(10).fill(0);
      const targets = raw.map((value) => rtaDbToMeter(rtaRawToDb(value)));

      setLevels((current) =>
        targets.map((target, index) => {
          const previous = current[index] || 0;
          const coefficient = target > previous ? 0.7 : playing ? 0.12 : 0.24;
          const next = previous + (target - previous) * coefficient;
          return next < 0.012 ? 0 : next;
        })
      );
    }, 64);
    return () => window.clearInterval(timer);
  }, [playing, visible]);

  useEffect(() => {
    const now = performance.now();
    setPeaks((current) =>
      levels.map((value, index) => {
        const previous = current[index] || 0;
        if (value >= previous) {
          peakHoldUntilRef.current[index] = now + 760;
          return value;
        }
        if (now < (peakHoldUntilRef.current[index] || 0)) return previous;
        return Math.max(value, Math.max(0, previous - (playing ? 0.018 : 0.07)));
      })
    );
  }, [levels, playing]);

  const labels = MUSIC_RTA_FREQUENCIES.length === 10
    ? MUSIC_RTA_FREQUENCIES.map(formatHz)
    : ["31", "63", "125", "250", "500", "1K", "2K", "4K", "8K", "16K"];

  return (
    <div ref={hostRef} className="tr-rta10 tr-rta10--restored tr-rta10--segmented" aria-label="10 band real-time audio analyzer">
      <div className="tr-rta10Body" aria-hidden>
        <div className="tr-rta10Scale">
          <span>0</span><span>-12</span><span>-24</span><span>-36</span><span>-48</span><span>-60</span><small>dB</small>
        </div>
        <div className="tr-rta10Grid">
          {levels.map((level, index) => {
            const value = Math.max(0, Math.min(1, level));
            const peak = Math.max(value, Math.min(1, peaks[index] || 0));
            const db = -72 + value * 72;
            return (
              <div className="tr-rta10Band" key={labels[index] || index}>
                <div className="tr-rta10Meter">
                  <div className="tr-rta10Segments">
                    {Array.from({ length: RTA_SEGMENTS }, (_, segmentIndex) => {
                      const threshold = (segmentIndex + 1) / RTA_SEGMENTS;
                      const zone = segmentIndex >= 16 ? "hot" : segmentIndex >= 13 ? "warm" : "normal";
                      return (
                        <i
                          key={segmentIndex}
                          className={`${value + 0.002 >= threshold ? "is-on" : ""} is-${zone}`}
                        />
                      );
                    })}
                  </div>
                  <span className="tr-rta10Peak" style={{ bottom: `${Math.max(1, peak * 100)}%` }} />
                </div>
                <strong>{labels[index] || index + 1}</strong>
                <small>{playing && value > 0.012 ? `${Math.max(-72, db).toFixed(0)} dB` : "—"}</small>
              </div>
            );
          })}
        </div>
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
  const [profileMessage, setProfileMessage] = useState("");
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetSlot, setSavePresetSlot] = useState<MusicCustomPresetSlot>("custom_1");
  const [savePresetName, setSavePresetName] = useState("");
  const restoredProfileRef = useRef<string>("");

  useEffect(() => {
    const refreshPlaylists = () => {
      void listMusicPlaylists().then(setPlaylists).catch(() => setPlaylists([]));
    };
    void loadMusicLibrary();
    refreshPlaylists();
    window.addEventListener(PLAYLISTS_CHANGED_EVENT, refreshPlaylists);
    return () => window.removeEventListener(PLAYLISTS_CHANGED_EVENT, refreshPlaylists);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const current = player.currentTrack;
    setArtworkUrl(current?.external_artwork_url || null);
    if (!current) return () => { cancelled = true; };
    void getMusicArtworkSignedUrl(current)
      .then((url) => { if (!cancelled) setArtworkUrl(url || current.external_artwork_url || null); })
      .catch(() => { if (!cancelled) setArtworkUrl(current.external_artwork_url || null); });
    return () => { cancelled = true; };
  }, [player.currentTrack?.id, player.currentTrack?.artwork_path, player.currentTrack?.external_artwork_url]);

  const run = (action: () => void | Promise<void>) => {
    try {
      const result = action();
      if (result instanceof Promise) void result.catch(() => undefined);
    } catch {
      // Player state surfaces the useful error.
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

    profile.eqGains.forEach((gain, index) => setMusicEqBand(index, gain));
    setMusicPreamp(profile.preampDb);
    setMusicEqEnabled(profile.eqEnabled);
    setMusicHeadphoneMode(profile.headphoneMode);
    setMusicHeadphoneWidth(profile.headphoneWidth);
    setMusicHeadphoneDepth(profile.headphoneDepth);
    setMusicHeadphoneCrossfeed(profile.headphoneCrossfeed);
    setMusicHeadphoneCenter(profile.headphoneCenter);
    setMusicHeadphoneBassImpact(profile.headphoneBassImpact);
  }, [player.eqPreset, dspProfiles]);

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
        .filter((track): track is MusicTrack => Boolean(track));
      if (player.playing) await playMusicPlaylist(playlist, tracks);
      else activateMusicPlaylistQueue(playlist, tracks);
    } finally {
      setQueueBusy(false);
    }
  }

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
    return profile.eqGains.every((gain, index) => sameDspNumber(gain, player.eqGains[index] ?? 0));
  }

  async function runDspMutation(action: () => void, ensureEq = false) {
    try {
      if (player.dspBypass) setMusicDspBypass(false);
      if (player.dspStatus !== "active") await recoverMusicDsp();
      if (ensureEq && !player.eqEnabled) setMusicEqEnabled(true);
      action();
      if (player.dspStatus !== "active") await recoverMusicDsp();
    } catch {
      // The player engine owns the useful error state.
    }
  }

  async function applySavedDspProfile(slot: MusicCustomPresetSlot) {
    const profile = dspProfiles[slot];
    setActiveCustomSlot(slot);
    if (!profile) {
      await runDspMutation(() => applyMusicEqPreset(slot), true);
      setProfileMessage(`${slotFallbackLabel(slot)} has no full DSP profile saved yet.`);
      return;
    }
    await runDspMutation(() => {
      applyMusicEqPreset(slot);
      profile.eqGains.forEach((gain, index) => setMusicEqBand(index, gain));
      setMusicPreamp(profile.preampDb);
      setMusicEqEnabled(profile.eqEnabled);
      setMusicHeadphoneMode(profile.headphoneMode);
      setMusicHeadphoneWidth(profile.headphoneWidth);
      setMusicHeadphoneDepth(profile.headphoneDepth);
      setMusicHeadphoneCrossfeed(profile.headphoneCrossfeed);
      setMusicHeadphoneCenter(profile.headphoneCenter);
      setMusicHeadphoneBassImpact(profile.headphoneBassImpact);
    }, profile.eqEnabled);
    restoredProfileRef.current = `${slot}:${profile.savedAt}`;
    setProfileMessage(`${profile.name} loaded • DSP active.`);
  }

  function handlePresetSelection(value: MusicEqPreset) {
    if (isCustomSlot(value)) {
      void applySavedDspProfile(value);
      return;
    }
    setActiveCustomSlot(null);
    void runDspMutation(() => applyMusicEqPreset(value), true);
    setProfileMessage("DSP preset applied.");
  }

  function saveCurrentDspProfile(slot: MusicCustomPresetSlot, name: string) {
    const profile = currentDspSnapshot(name || slotFallbackLabel(slot));
    const nextProfiles = { ...dspProfiles, [slot]: profile };
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
    setSavePresetSlot(slot);
    setSavePresetName(dspProfiles[slot]?.name ?? "");
    setSavePresetOpen(true);
  }

  const track = player.currentTrack;
  const duration = Math.max(0, player.duration || track?.duration_seconds || 0);
  const currentTime = Math.min(duration || Number.MAX_SAFE_INTEGER, Math.max(0, player.currentTime));
  const volumePercent = Math.max(0, Math.min(100, Math.round(((player.preampDb + 12) / 24) * 100)));
  const activeSavedProfile = activeCustomSlot ? dspProfiles[activeCustomSlot] : null;
  const activeProfileDirty = activeSavedProfile ? !profileMatchesCurrent(activeSavedProfile) : false;
  const presetSelectValue: MusicEqPreset = activeCustomSlot && activeProfileDirty ? "custom" : player.eqPreset;
  const presetStatusLabel = activeSavedProfile
    ? `${activeSavedProfile.name}${activeProfileDirty ? " • Modified" : " • Saved"}`
    : player.eqPreset === "custom" ? "Unsaved custom DSP" : "Built-in preset";

  return (
    <section
      className={`tr-audioDeck tr-audioDeck--v4 tr-audioDeck--pro7 ${player.playing ? "is-playing" : ""} ${player.loading || queueBusy ? "is-busy" : ""}`}
      aria-label="MVP Trainer music console"
    >
      <div className="tr-audioDeckTop">
        <button type="button" className="tr-audioArtwork" onClick={() => navigate("/music")} aria-label="Open My Music">
          {artworkUrl ? <img className="tr-audioArtworkImage" src={artworkUrl} alt="" /> : <span className="tr-audioArtworkFallback"><PlayerIcon name="music" /></span>}
        </button>

        <button type="button" className="tr-audioIdentity" onClick={() => navigate("/music")}> 
          <strong>{track?.title || (player.loading ? "Loading music…" : "Music")}</strong>
          {track ? <small>{[track.artist || "Unknown Artist", track.album].filter(Boolean).join(" • ")}</small> : null}
        </button>

        <div className="tr-audioQueueSelector">
          <span>PLAYING FROM</span>
          <select value={player.activePlaylistId || "all"} disabled={queueBusy} onChange={(event: ChangeEvent<HTMLSelectElement>) => void selectQueue(event.target.value)} aria-label="Choose music playlist">
            <option value="all">All Uploaded Songs</option>
            {playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
          </select>
        </div>

        <div className="tr-audioTopButtons">
          <button type="button" className={`tr-audioEqToggle ${eqOpen ? "is-active" : ""}`} onClick={() => setEqOpen((current) => !current)} aria-expanded={eqOpen}>
            <PlayerIcon name="equalizer" /><span>DSP / EQ</span>
          </button>
        </div>
      </div>

      <TenBandRta playing={player.playing} />

      <div className="tr-audioTimeline">
        <span>{formatMusicTime(currentTime)}</span>
        <input type="range" min="0" max={Math.max(1, duration)} step="1" value={Math.min(Math.max(1, duration), currentTime)} onChange={(event: ChangeEvent<HTMLInputElement>) => seekMusic(Number(event.target.value))} disabled={!track || !duration} aria-label="Music playback position" />
        <span>{formatMusicTime(duration)}</span>
      </div>

      <div className="tr-mainAudioTuning">
        <label className="tr-mainPreamp">
          <span>VOLUME</span>
          <input type="range" min="0" max="100" step="1" value={volumePercent} onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const percent = Number(event.target.value);
            const db = -12 + (Math.max(0, Math.min(100, percent)) / 100) * 24;
            void runDspMutation(() => setMusicPreamp(db), true);
          }} aria-label="Music volume" />
          <strong>{volumePercent}%</strong>
        </label>
        <div className="tr-trackPreference" aria-label="Track preference">
          <button type="button" className={track?.play_less ? "is-disliked" : ""} disabled={!track} onClick={() => {
            if (!track) return;
            const next = track.play_less ? "neutral" : "play_less";
            void setPlayerMusicPreference(track.id, next).then(() => { if (next === "play_less") void nextMusicTrack(); });
          }} aria-label="Play this song less"><PlayerIcon name="dislike" /><span>PLAY LESS</span></button>
          <button type="button" className={track?.favorite ? "is-liked" : ""} disabled={!track} onClick={() => {
            if (!track) return;
            void setPlayerMusicPreference(track.id, track.favorite ? "neutral" : "like");
          }} aria-label="Like this song"><PlayerIcon name="like" /><span>{track?.favorite ? "LIKED" : "LIKE"}</span></button>
        </div>
      </div>

      <div className="tr-audioControls">
        <button type="button" className={`tr-audioModeButton ${player.shuffle ? "is-active" : ""}`} onClick={() => toggleMusicShuffle()} aria-label={`Shuffle ${player.shuffle ? "on" : "off"}`}><PlayerIcon name="shuffle" /><span>SHUFFLE</span></button>
        <div className="tr-audioTransport" aria-label="Music transport controls">
          <div className="tr-audioTransportUnit"><button type="button" className="tr-audioTransportButton" onClick={() => run(previousMusicTrack)} disabled={!player.tracks.length || player.loading || queueBusy} aria-label="Previous song"><span className="tr-audioTransportFace"><PlayerIcon name="back" /></span></button><span>PREVIOUS</span></div>
          <div className="tr-audioTransportUnit is-primary"><button type="button" className="tr-audioTransportButton tr-audioTransportButton--primary" onClick={() => run(player.playing ? pauseMusic : playMusic)} disabled={player.loading || queueBusy} aria-label={player.playing ? "Pause music" : "Play music"}><span className="tr-audioTransportFace"><PlayerIcon name={player.playing ? "pause" : "play"} /></span></button><span>{player.playing ? "PAUSE" : "PLAY"}</span></div>
          <div className="tr-audioTransportUnit"><button type="button" className="tr-audioTransportButton" onClick={() => stopMusic()} disabled={!track || player.loading || queueBusy} aria-label="Stop music"><span className="tr-audioTransportFace"><PlayerIcon name="stop" /></span></button><span>STOP</span></div>
          <div className="tr-audioTransportUnit"><button type="button" className="tr-audioTransportButton" onClick={() => run(() => nextMusicTrack())} disabled={!player.tracks.length || player.loading || queueBusy} aria-label="Next song"><span className="tr-audioTransportFace"><PlayerIcon name="next" /></span></button><span>NEXT</span></div>
        </div>
        <button type="button" className={`tr-audioModeButton ${player.repeat !== "off" ? "is-active" : ""}`} onClick={() => cycleMusicRepeat()} aria-label={`Repeat ${player.repeat}`}><PlayerIcon name="repeat" /><span>{player.repeat === "one" ? "REPEAT 1" : "REPEAT"}</span></button>
      </div>

      {eqOpen ? (
        <section className="tr-audioEqPanel tr-audioEqPanel--pro7">
          <div className="tr-audioEqHead">
            <div><strong>31-Band EQ + Headphone DSP</strong></div>
            <div className="tr-dspAbControls">
              <label className="tr-audioEqSwitch"><input type="checkbox" checked={player.eqEnabled} onChange={(event: ChangeEvent<HTMLInputElement>) => setMusicEqEnabled(event.target.checked)} /><span>{player.eqEnabled ? "ON" : "FLAT"}</span></label>
              <button type="button" className={`tr-dspBypassButton ${player.dspBypass ? "is-active" : ""}`} onClick={() => setMusicDspBypass(!player.dspBypass)}>A/B {player.dspBypass ? "BYPASSED" : "PROCESSED"}</button>
            </div>
            <label className="tr-audioEqPreset"><span>EQ PRESET</span><select value={presetSelectValue} onChange={(event: ChangeEvent<HTMLSelectElement>) => handlePresetSelection(event.target.value as MusicEqPreset)}>
              {(Object.entries(MUSIC_EQ_PRESETS) as Array<[string, { label: string }]>).map(([value, preset]) => <option key={value} value={value}>{preset.label}</option>)}
              {DSP_SLOTS.map((slot) => <option key={slot} value={slot}>{dspProfiles[slot]?.name ?? slotFallbackLabel(slot)}</option>)}
              <option value="custom">{activeSavedProfile && activeProfileDirty ? `${activeSavedProfile.name} • Modified` : "Unsaved Custom"}</option>
            </select></label>
          </div>


          <div className="tr-audioEqScroll" aria-label="31 band equalizer">
            <div className="tr-audioEqBands tr-audioEqBands--31">
              {MUSIC_EQ_FREQUENCIES.map((frequency, index) => (
                <label key={frequency} className="tr-audioEqBand">
                  <span className="tr-audioEqGain">{Number(player.eqGains[index] || 0) > 0 ? "+" : ""}{Number(player.eqGains[index] || 0).toFixed(0)}</span>
                  <span className="tr-audioEqSliderShell"><input type="range" min="-12" max="12" step="0.5" value={player.eqGains[index] || 0} onChange={(event: ChangeEvent<HTMLInputElement>) => void runDspMutation(() => setMusicEqBand(index, Number(event.target.value)), true)} aria-label={`${frequency} hertz equalizer gain`} /></span>
                  <span>{formatHz(frequency)}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="tr-audioEqFooter tr-audioEqFooter--pro7">
            <label className="tr-audioPreamp"><span>VOLUME</span><input type="range" min="0" max="100" step="1" value={Math.round(((player.preampDb + 12) / 24) * 100)} onChange={(event: ChangeEvent<HTMLInputElement>) => void runDspMutation(() => setMusicPreamp((Number(event.target.value) / 100) * 24 - 12), true)} /><strong>{Math.round(((player.preampDb + 12) / 24) * 100)}%</strong></label>
            <div className="tr-audioEqQuickActions"><button type="button" onClick={() => void runDspMutation(() => applyMusicEqPreset("flat"), true)}>FLAT</button><button type="button" onClick={() => void runDspMutation(() => applyMusicEqPreset("power"), true)}>POWER TRAINING</button></div>
          </div>

          <div className="tr-dspProfileSave">
            <div className="tr-dspProfileSaveStatus"><span>DSP PROFILE</span><strong>{presetStatusLabel}</strong>{profileMessage ? <small aria-live="polite">{profileMessage}</small> : null}</div>
            <div className="tr-dspProfileSaveActions">
              {activeCustomSlot && activeSavedProfile ? <button type="button" onClick={() => saveCurrentDspProfile(activeCustomSlot, activeSavedProfile.name)}>UPDATE PRESET</button> : null}
              <button type="button" className="is-primary" onClick={() => openSavePresetDialog()}>{activeCustomSlot ? "SAVE AS NEW" : "SAVE CUSTOM PRESET"}</button>
            </div>
          </div>

          <section className="tr-headphoneProcessor">
            <header><div><strong>Headphone Immersion</strong></div><label><span>MODE</span><select value={player.headphoneMode} onChange={(event: ChangeEvent<HTMLSelectElement>) => void runDspMutation(() => setMusicHeadphoneMode(event.target.value as MusicHeadphoneMode))}>{(Object.entries(MUSIC_HEADPHONE_MODES) as Array<[MusicHeadphoneMode, (typeof MUSIC_HEADPHONE_MODES)[MusicHeadphoneMode]]>).map(([value, mode]) => <option key={value} value={value}>{mode.label}</option>)}</select></label></header>
            <div className="tr-headphoneModes">{(Object.entries(MUSIC_HEADPHONE_MODES) as Array<[MusicHeadphoneMode, (typeof MUSIC_HEADPHONE_MODES)[MusicHeadphoneMode]]>).map(([value, mode]) => <button key={value} type="button" className={player.headphoneMode === value ? "is-active" : ""} onClick={() => void runDspMutation(() => setMusicHeadphoneMode(value))}>{mode.label}</button>)}</div>
            <div className="tr-headphoneControls">
              <label><span>WIDTH <b>{player.headphoneWidth}%</b></span><input type="range" min="0" max="100" value={player.headphoneWidth} onChange={(event: ChangeEvent<HTMLInputElement>) => void runDspMutation(() => setMusicHeadphoneWidth(Number(event.target.value)))} /></label>
              <label><span>DEPTH <b>{player.headphoneDepth}%</b></span><input type="range" min="0" max="100" value={player.headphoneDepth} onChange={(event: ChangeEvent<HTMLInputElement>) => void runDspMutation(() => setMusicHeadphoneDepth(Number(event.target.value)))} /></label>
              <label><span>CROSSFEED <b>{player.headphoneCrossfeed}%</b></span><input type="range" min="0" max="100" value={player.headphoneCrossfeed} onChange={(event: ChangeEvent<HTMLInputElement>) => void runDspMutation(() => setMusicHeadphoneCrossfeed(Number(event.target.value)))} /></label>
              <label><span>CENTER <b>{player.headphoneCenter}%</b></span><input type="range" min="0" max="100" value={player.headphoneCenter} onChange={(event: ChangeEvent<HTMLInputElement>) => void runDspMutation(() => setMusicHeadphoneCenter(Number(event.target.value)))} /></label>
              <label><span>BASS IMPACT <b>{player.headphoneBassImpact}%</b></span><input type="range" min="0" max="100" value={player.headphoneBassImpact} onChange={(event: ChangeEvent<HTMLInputElement>) => void runDspMutation(() => setMusicHeadphoneBassImpact(Number(event.target.value)))} /></label>
            </div>
          </section>
        </section>
      ) : null}

      {savePresetOpen ? (
        <div className="tr-dspSaveBack" onMouseDown={() => setSavePresetOpen(false)}>
          <section className="tr-dspSaveDialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><small>SAVE DSP PROFILE</small><h3>Store this complete sound setup</h3></div><button type="button" onClick={() => setSavePresetOpen(false)}>×</button></header>
            <label className="tr-dspSaveName"><span>PROFILE NAME</span><input value={savePresetName} onChange={(event) => setSavePresetName(event.target.value)} placeholder="Example: Gym Headphones" maxLength={32} /></label>
            <div className="tr-dspSaveSlots"><span>SAVE TO</span><div>{DSP_SLOTS.map((slot, index) => <button key={slot} type="button" className={savePresetSlot === slot ? "is-active" : ""} onClick={() => { setSavePresetSlot(slot); setSavePresetName(dspProfiles[slot]?.name ?? ""); }}><b>CUSTOM {index + 1}</b><small>{dspProfiles[slot]?.name ?? "Empty slot"}</small></button>)}</div></div>
            <div className="tr-dspSaveIncludes"><span>SAVES</span><p>31-band EQ • Preamp • DSP active state • Headphone mode • Width • Depth • Crossfeed • Center focus • Bass impact</p></div>
            <footer><button type="button" onClick={() => setSavePresetOpen(false)}>CANCEL</button><button type="button" className="is-primary" onClick={() => saveCurrentDspProfile(savePresetSlot, savePresetName.trim() || slotFallbackLabel(savePresetSlot))}>SAVE PRESET</button></footer>
          </section>
        </div>
      ) : null}

      {player.error ? <div className="tr-audioError">{player.error}</div> : null}

      <style>{`
        .tr-audioDeck--pro7 .tr-audioDeckTop{display:grid!important;grid-template-columns:52px minmax(0,1fr) minmax(165px,190px) max-content!important;gap:10px!important;align-items:center!important;width:100%!important;min-width:0!important;box-sizing:border-box!important;overflow:visible!important}.tr-audioDeck--pro7 .tr-audioArtwork{min-width:0}.tr-audioDeck--pro7 .tr-audioIdentity{min-width:0!important;max-width:none!important;overflow:hidden}.tr-audioDeck--pro7 .tr-audioIdentity strong,.tr-audioDeck--pro7 .tr-audioIdentity small{display:block;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tr-audioDeck--pro7 .tr-audioQueueSelector{min-width:0!important;width:100%!important;max-width:190px!important}.tr-audioDeck--pro7 .tr-audioQueueSelector select{width:100%!important;min-width:0!important}.tr-audioDeck--pro7 .tr-audioTopButtons{display:flex;align-items:center;justify-content:flex-end;gap:7px;min-width:max-content;justify-self:end;overflow:visible}.tr-audioDeck--pro7 .tr-audioEqToggle{flex:0 0 auto;white-space:nowrap}.tr-audioDeck--pro7 .tr-audioLibraryButton{flex:0 0 auto;min-width:76px;min-height:38px;padding:0 12px;border:1px solid rgba(126,193,218,.16);border-radius:10px;background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(0,0,0,.2));color:#dcebf1;font-size:8px;font-weight:1000;letter-spacing:.065em;white-space:nowrap;cursor:pointer}.tr-audioDeck--pro7 .tr-audioLibraryButton:hover{border-color:rgba(75,203,248,.38);color:#9ee7ff}
        .tr-audioDeck--pro7 .tr-audioArtwork{overflow:hidden;background:linear-gradient(180deg,#111a21,#070b0f)!important;border-color:rgba(132,196,221,.20)!important;box-shadow:0 5px 14px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.055)!important}.tr-audioDeck--pro7 .tr-audioArtworkImage{width:100%;height:100%;object-fit:cover;display:block}.tr-audioDeck--pro7 .tr-audioArtworkFallback{width:100%;height:100%;display:grid;place-items:center;background:linear-gradient(145deg,#132332,#09131c);color:#ffc061}.tr-audioDeck--pro7 .tr-audioArtworkFallback svg{width:28px;height:28px;fill:currentColor}
        .tr-audioDeck--pro7 .tr-audioTelemetry{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:5px 0 0;padding:6px 10px;border:1px solid rgba(99,177,206,.09);border-radius:9px;background:rgba(4,15,22,.48);color:rgba(177,205,217,.54);font-size:7px;font-weight:950;letter-spacing:.085em}.tr-audioDeck--pro7 .tr-audioTelemetry>span:first-child{display:inline-flex;align-items:center;gap:6px;color:#a9c5cf}.tr-audioDeck--pro7 .tr-audioTelemetry i{width:5px;height:5px;border-radius:50%;background:#435961}.tr-audioDeck--pro7 .tr-audioTelemetry .is-live i,.tr-audioDeck--pro7 .tr-audioTelemetry span.is-live i{background:#59e7aa;box-shadow:0 0 8px rgba(89,231,170,.55)}.tr-audioDeck--pro7 .tr-dspHealth{margin-left:auto;border:0;background:transparent;color:#8fa8b1;font:inherit;cursor:pointer}.tr-audioDeck--pro7 .tr-dspHealth.is-active{color:#58dca5}.tr-audioDeck--pro7 .tr-dspHealth.is-unavailable{color:#ff7777}.tr-audioDeck--pro7 .tr-dspHealth.is-recovering{color:#ffb34d}
        .tr-audioDeck--pro7 .tr-rta10{margin:8px 0 6px;border:1px solid rgba(77,178,215,.18);border-top-color:rgba(169,226,246,.31);border-radius:10px;overflow:hidden;background:linear-gradient(180deg,rgba(4,16,24,.99),rgba(2,8,13,.995));box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 8px 22px rgba(0,0,0,.22)}
        .tr-audioDeck--pro7 .tr-rta10Head{height:29px;padding:0 11px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid rgba(80,177,214,.09);font-size:7px;font-weight:950;letter-spacing:.105em;color:rgba(172,204,217,.5)}.tr-audioDeck--pro7 .tr-rta10Head span:first-child{display:inline-flex;align-items:center;gap:7px;color:#d8f5ff}.tr-audioDeck--pro7 .tr-rta10Head i{width:5px;height:5px;border-radius:50%;background:#40545c;box-shadow:0 0 0 3px rgba(80,110,120,.05)}.tr-audioDeck--pro7 .tr-rta10Head i.is-live{background:#52d7ff;box-shadow:0 0 9px rgba(82,215,255,.44)}
        .tr-audioDeck--pro7 .tr-rta10Body{display:grid;grid-template-columns:34px minmax(0,1fr);min-height:132px;background:repeating-linear-gradient(0deg,transparent 0,transparent 20px,rgba(92,174,205,.045) 20px,rgba(92,174,205,.045) 21px)}.tr-audioDeck--pro7 .tr-rta10Scale{position:relative;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;padding:9px 6px 23px 0;border-right:1px solid rgba(79,157,187,.08);color:rgba(137,170,183,.46);font-size:6px;font-weight:850;font-variant-numeric:tabular-nums}.tr-audioDeck--pro7 .tr-rta10Scale small{position:absolute;bottom:5px;right:6px;font-size:5px;letter-spacing:.08em;color:rgba(122,153,165,.38)}
        .tr-audioDeck--pro7 .tr-rta10Grid{min-width:0;padding:9px 12px 7px;display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:7px}.tr-audioDeck--pro7 .tr-rta10Band{min-width:0;display:grid;grid-template-rows:96px 13px;gap:5px;text-align:center}.tr-audioDeck--pro7 .tr-rta10Meter{position:relative;min-width:0;overflow:hidden;border-radius:5px;background:linear-gradient(180deg,rgba(62,102,118,.10),rgba(20,43,52,.18));box-shadow:inset 0 0 0 1px rgba(94,173,201,.07)}
        .tr-audioDeck--pro7 .tr-rta10Inactive,.tr-audioDeck--pro7 .tr-rta10Fill{position:absolute;inset:3px 5px;transform-origin:bottom;-webkit-mask-image:repeating-linear-gradient(to top,#000 0,#000 3px,transparent 3px,transparent 5px);mask-image:repeating-linear-gradient(to top,#000 0,#000 3px,transparent 3px,transparent 5px)}.tr-audioDeck--pro7 .tr-rta10Inactive{background:rgba(80,124,141,.13)}.tr-audioDeck--pro7 .tr-rta10Fill{background:linear-gradient(to top,#42c8ed 0 70%,#72deb9 70% 88%,#e5b457 88% 96%,#ef765b 96% 100%);box-shadow:0 0 8px rgba(65,194,228,.15);transition:transform .08s linear}.tr-audioDeck--pro7 .tr-rta10Peak{position:absolute;left:18%;right:18%;height:1px;background:#eefbff;box-shadow:0 0 5px rgba(213,248,255,.44);transition:bottom .1s linear}.tr-audioDeck--pro7 .tr-rta10Band strong{align-self:end;color:rgba(181,211,222,.64);font-size:6px;font-weight:950;letter-spacing:.035em;font-variant-numeric:tabular-nums}
        .tr-audioDeck--pro7 .tr-mainAudioTuning{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;margin:3px 0 10px}.tr-audioDeck--pro7 .tr-mainPreamp{min-width:0;display:grid;grid-template-columns:54px minmax(100px,1fr) 62px;gap:8px;align-items:center;padding:8px 11px;border:1px solid rgba(80,172,207,.12);border-radius:9px;background:rgba(5,16,23,.64)}.tr-audioDeck--pro7 .tr-mainPreamp span{font-size:7px;font-weight:950;letter-spacing:.09em;color:#8da8b3}.tr-audioDeck--pro7 .tr-mainPreamp strong{text-align:right;font-size:9px;color:#f3fbff}.tr-audioDeck--pro7 .tr-mainPreamp input{width:100%;accent-color:#ff9e2d}.tr-audioDeck--pro7 .tr-trackPreference{display:flex;gap:6px}.tr-audioDeck--pro7 .tr-trackPreference button{height:38px;min-width:82px;padding:0 10px;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(107,164,186,.16);border-radius:9px;background:linear-gradient(180deg,#0b1720,#071017);color:#b9cbd3;font-size:7px;font-weight:950;letter-spacing:.06em}.tr-audioDeck--pro7 .tr-trackPreference svg{width:14px;height:14px;fill:currentColor}.tr-audioDeck--pro7 .tr-trackPreference button.is-liked{color:#5ee3a7;border-color:rgba(69,219,153,.38);background:rgba(22,76,57,.22)}.tr-audioDeck--pro7 .tr-trackPreference button.is-disliked{color:#ff8585;border-color:rgba(255,105,105,.36);background:rgba(91,29,31,.20)}
        .tr-audioDeck--pro7 .tr-audioTransportButton--primary::before{background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(95,30,0,.10))!important}.tr-audioDeck--pro7 .tr-audioTransportButton--primary::after,.tr-audioDeck--pro7 .tr-audioTransportFace::before,.tr-audioDeck--pro7 .tr-audioTransportFace::after{display:none!important;content:none!important}.tr-audioDeck--pro7 .tr-audioTransportButton--primary svg{filter:none!important}
        .tr-audioEqPanel--pro7{overflow:hidden}.tr-audioEqPanel--pro7 .tr-dspAbControls{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.tr-audioEqPanel--pro7 .tr-dspBypassButton{height:34px;padding:0 12px;border:1px solid rgba(95,190,224,.22);border-radius:8px;background:#07131a;color:#b8d5df;font-size:8px;font-weight:900;letter-spacing:.06em}.tr-audioEqPanel--pro7 .tr-dspBypassButton.is-active{border-color:rgba(255,176,73,.5);color:#ffb34d;background:rgba(91,54,12,.2)}
        .tr-audioEqPanel--pro7 .tr-audioDspSignalPath{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:3px 0 10px;padding:8px 10px;border:1px solid rgba(82,164,195,.09);border-radius:8px;background:rgba(4,13,19,.44);color:#75939f;font-size:6px;font-weight:950;letter-spacing:.08em}.tr-audioEqPanel--pro7 .tr-audioDspSignalPath i{width:16px;height:1px;background:rgba(86,194,231,.25)}
        .tr-audioEqScroll{width:100%;overflow-x:auto;overscroll-behavior-x:contain;padding:2px 0 8px;scrollbar-width:thin;scrollbar-color:rgba(83,199,240,.35) rgba(255,255,255,.04)}.tr-audioEqBands--31{display:grid!important;grid-template-columns:repeat(31,minmax(42px,1fr))!important;gap:6px!important;min-width:1380px!important}.tr-audioEqBands--31 .tr-audioEqBand{min-width:42px!important;padding:8px 4px!important}.tr-audioEqBands--31 .tr-audioEqBand>span:last-child{font-size:7px!important;white-space:nowrap}.tr-audioEqBands--31 .tr-audioEqGain{font-size:8px!important}.tr-audioEqFooter--pro7{margin-top:5px}.tr-audioEqQuickActions{display:flex;gap:6px;align-items:center}.tr-audioEqQuickActions button{min-height:32px;padding:0 10px;border:1px solid rgba(124,195,220,.14);border-radius:9px;color:rgba(232,244,250,.78);background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(0,0,0,.18));font-size:8px;font-weight:1000;cursor:pointer}
        .tr-dspProfileSave{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:9px;padding:10px 0 1px;border-top:1px solid rgba(118,204,236,.09)}.tr-dspProfileSaveStatus{display:grid;gap:3px;min-width:0}.tr-dspProfileSaveStatus>span{color:rgba(183,209,222,.50);font-size:7px;font-weight:1000;letter-spacing:.14em}.tr-dspProfileSaveStatus>strong{color:#eef7fb;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr-dspProfileSaveStatus>small{color:#7edfb2;font-size:8px}.tr-dspProfileSaveActions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end}.tr-dspProfileSaveActions button,.tr-headphoneModes button{min-height:32px;padding:0 11px;border:1px solid rgba(124,195,220,.14);border-radius:9px;color:rgba(232,244,250,.78);background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(0,0,0,.18));font-size:8px;font-weight:1000;letter-spacing:.07em;cursor:pointer}.tr-dspProfileSaveActions button.is-primary{border-color:rgba(255,190,89,.34);color:#171006;background:linear-gradient(180deg,#ffc762,#f09a18)}
        .tr-headphoneProcessor{margin-top:12px;padding:13px;border:1px solid rgba(71,186,229,.20);border-radius:14px;background:linear-gradient(180deg,rgba(11,27,38,.88),rgba(5,13,19,.92));box-shadow:inset 0 1px 0 rgba(255,255,255,.035)}.tr-headphoneProcessor header{display:grid;grid-template-columns:minmax(0,1fr) 190px;align-items:end;gap:12px}.tr-headphoneProcessor header>div{display:grid;gap:3px}.tr-headphoneProcessor header strong{color:#f4f9fc;font-size:12px}.tr-headphoneProcessor header label{display:grid;gap:4px}.tr-headphoneProcessor header label>span{color:rgba(180,204,217,.52);font-size:7px;font-weight:1000;letter-spacing:.14em}.tr-headphoneProcessor select{min-height:35px;border:1px solid rgba(125,198,224,.16);border-radius:9px;color:#f2f8fb;background:#081119;padding:0 10px;font-weight:900}.tr-headphoneModes{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}.tr-headphoneModes button.is-active{border-color:rgba(65,199,248,.52);color:#9de5ff;background:rgba(0,158,223,.11);box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}.tr-headphoneControls{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:11px}.tr-headphoneControls label{display:grid;gap:6px;padding:9px;border:1px solid rgba(255,255,255,.06);border-radius:10px;background:rgba(0,0,0,.15)}.tr-headphoneControls label>span{display:flex;justify-content:space-between;gap:6px;color:rgba(184,208,220,.55);font-size:7px;font-weight:1000;letter-spacing:.08em}.tr-headphoneControls b{color:#91defb}.tr-headphoneControls input{width:100%}
        .tr-dspSaveBack{position:fixed;inset:0;z-index:7000;display:grid;place-items:center;padding:16px;background:rgba(0,4,7,.86);backdrop-filter:blur(8px)}.tr-dspSaveDialog{width:min(560px,100%);overflow:hidden;border:1px solid rgba(78,196,236,.30);border-radius:16px;background:linear-gradient(180deg,#0b202a,#050d12);box-shadow:0 30px 80px rgba(0,0,0,.66)}.tr-dspSaveDialog header{padding:15px 17px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(91,170,199,.12)}.tr-dspSaveDialog header small,.tr-dspSaveName>span,.tr-dspSaveSlots>span,.tr-dspSaveIncludes>span{color:#5bd3f5;font-size:7px;font-weight:1000;letter-spacing:.12em}.tr-dspSaveDialog h3{margin:4px 0 0;font-size:18px}.tr-dspSaveDialog header>button{width:34px;height:34px;border:1px solid rgba(123,174,193,.16);border-radius:9px;background:#071219;color:#dce9ed;font-size:20px}.tr-dspSaveName{padding:13px 17px 7px;display:grid;gap:6px}.tr-dspSaveName input{height:42px;border:1px solid rgba(116,198,228,.20);border-radius:10px;padding:0 12px;color:#f5f9fb;background:#060d12;outline:none;font:inherit;font-weight:850}.tr-dspSaveSlots{display:grid;gap:7px;padding:9px 17px}.tr-dspSaveSlots>div{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.tr-dspSaveSlots button{min-height:60px;display:grid;align-content:center;gap:4px;padding:8px;border:1px solid rgba(255,255,255,.07);border-radius:10px;color:#d8e7ee;background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(0,0,0,.15));cursor:pointer;text-align:left}.tr-dspSaveSlots button b{font-size:9px}.tr-dspSaveSlots button small{color:rgba(184,205,216,.50);font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr-dspSaveSlots button.is-active{border-color:rgba(65,200,248,.52);background:rgba(0,158,223,.10)}.tr-dspSaveIncludes{display:grid;gap:5px;margin:7px 17px 0;padding:11px;border:1px solid rgba(255,255,255,.055);border-radius:10px;background:rgba(0,0,0,.13)}.tr-dspSaveIncludes p{margin:0;color:rgba(212,227,235,.62);font-size:9px;line-height:1.45}.tr-dspSaveDialog footer{display:flex;justify-content:flex-end;gap:8px;padding:15px 17px 17px}.tr-dspSaveDialog footer button{min-height:38px;padding:0 16px;border:1px solid rgba(120,193,220,.14);border-radius:10px;color:#dceaf1;background:#0b151c;font-size:9px;font-weight:1000;cursor:pointer}.tr-dspSaveDialog footer button.is-primary{border-color:rgba(255,190,89,.42);color:#171006;background:linear-gradient(180deg,#ffc762,#f09a18)}
        @media(max-width:900px){.tr-audioDeck--pro7 .tr-audioDeckTop{grid-template-columns:50px minmax(0,1fr) minmax(150px,175px) max-content!important;gap:8px!important}.tr-audioDeck--pro7 .tr-audioLibraryButton{min-width:70px;padding:0 9px}.tr-audioDeck--pro7 .tr-audioEqToggle{padding-left:8px!important;padding-right:8px!important}}
        @media(max-width:700px){.tr-audioDeck--pro7 .tr-audioDeckTop{grid-template-columns:48px minmax(0,1fr)!important;gap:8px!important}.tr-audioDeck--pro7 .tr-audioQueueSelector{grid-column:1/-1;max-width:none!important}.tr-audioDeck--pro7 .tr-audioTopButtons{grid-column:1/-1;width:100%;display:grid;grid-template-columns:1fr 1fr;min-width:0;justify-self:stretch}.tr-audioDeck--pro7 .tr-audioLibraryButton{min-height:42px;min-width:0}.tr-audioDeck--pro7 .tr-rta10Body{grid-template-columns:27px minmax(0,1fr);min-height:112px}.tr-audioDeck--pro7 .tr-rta10Grid{padding:8px 5px 6px;gap:3px}.tr-audioDeck--pro7 .tr-rta10Band{grid-template-rows:80px 12px;gap:4px}.tr-audioDeck--pro7 .tr-rta10Inactive,.tr-audioDeck--pro7 .tr-rta10Fill{inset:2px}.tr-audioDeck--pro7 .tr-rta10Band strong{font-size:5px}.tr-audioDeck--pro7 .tr-rta10Scale{padding-right:4px;font-size:5px}.tr-audioDeck--pro7 .tr-rta10Head span:last-child{display:none}.tr-audioDeck--pro7 .tr-mainAudioTuning{grid-template-columns:1fr}.tr-audioDeck--pro7 .tr-trackPreference button{flex:1}.tr-audioDeck--pro7 .tr-mainPreamp{grid-template-columns:47px minmax(80px,1fr) 56px}.tr-audioEqBands--31{grid-template-columns:repeat(31,44px)!important;min-width:1530px!important}.tr-headphoneProcessor header{grid-template-columns:1fr}.tr-headphoneControls{grid-template-columns:repeat(2,minmax(0,1fr))}.tr-dspProfileSave{align-items:flex-start;flex-direction:column}.tr-dspSaveSlots>div{grid-template-columns:1fr}}

        /* FINAL PRO RESPONSIVE PASS: presentation only, player behavior untouched */
        .tr-audioDeck--pro7 .tr-audioDeckTop{
          grid-template-columns:52px minmax(180px,1fr) minmax(170px,196px) auto!important;
          column-gap:9px!important;
          padding-right:12px!important;
          overflow:hidden!important;
        }
        .tr-audioDeck--pro7 .tr-audioTopButtons{
          min-width:0!important;
          max-width:192px;
          display:grid!important;
          grid-template-columns:82px 96px;
          gap:7px!important;
          justify-self:end!important;
        }
        .tr-audioDeck--pro7 .tr-audioEqToggle,
        .tr-audioDeck--pro7 .tr-audioLibraryButton{
          width:100%!important;
          min-width:0!important;
          height:40px!important;
          min-height:40px!important;
          box-sizing:border-box!important;
        }
        .tr-audioDeck--pro7 .tr-audioLibraryButton{
          position:relative;
          isolation:isolate;
          overflow:hidden;
          padding:0 10px!important;
          border:1px solid rgba(91,187,219,.28)!important;
          border-radius:8px!important;
          background:
            linear-gradient(180deg,rgba(18,39,49,.96),rgba(5,15,21,.98))!important;
          color:#e4f6fb!important;
          font-size:7px!important;
          font-weight:1000!important;
          letter-spacing:.12em!important;
          text-shadow:0 1px 0 rgba(0,0,0,.85);
          box-shadow:
            inset 0 1px rgba(255,255,255,.045),
            inset 0 -1px rgba(0,0,0,.65),
            0 3px 10px rgba(0,0,0,.18)!important;
        }
        .tr-audioDeck--pro7 .tr-audioLibraryButton:before{
          content:"";
          position:absolute;
          z-index:-1;
          left:12px;
          right:12px;
          top:0;
          height:1px;
          background:linear-gradient(90deg,transparent,rgba(92,216,249,.58),transparent);
        }
        .tr-audioDeck--pro7 .tr-audioLibraryButton:hover,
        .tr-audioDeck--pro7 .tr-audioLibraryButton:focus-visible{
          border-color:rgba(91,210,247,.56)!important;
          color:#fff!important;
          background:linear-gradient(180deg,rgba(16,53,67,.98),rgba(6,24,32,.98))!important;
        }

        @media(max-width:900px){
          .tr-audioDeck--pro7 .tr-audioDeckTop{
            grid-template-columns:50px minmax(150px,1fr) minmax(145px,176px) auto!important;
            gap:7px!important;
            padding-right:10px!important;
          }
          .tr-audioDeck--pro7 .tr-audioTopButtons{
            grid-template-columns:74px 86px;
            max-width:167px;
            gap:6px!important;
          }
          .tr-audioDeck--pro7 .tr-audioLibraryButton{font-size:6.5px!important;letter-spacing:.09em!important}
        }

        @media(max-width:700px){
          .tr-audioDeck--pro7{
            overflow:hidden!important;
          }
          .tr-audioDeck--pro7 .tr-audioDeckTop{
            grid-template-columns:48px minmax(0,1fr)!important;
            grid-auto-rows:auto;
            gap:8px!important;
            padding:10px!important;
            overflow:hidden!important;
          }
          .tr-audioDeck--pro7 .tr-audioArtwork{
            grid-column:1;
            grid-row:1;
            width:48px!important;
            height:48px!important;
          }
          .tr-audioDeck--pro7 .tr-audioIdentity{
            grid-column:2;
            grid-row:1;
            width:100%!important;
            min-width:0!important;
          }
          .tr-audioDeck--pro7 .tr-audioIdentity strong{
            font-size:14px!important;
            line-height:1.12!important;
          }
          .tr-audioDeck--pro7 .tr-audioIdentity small{
            font-size:8px!important;
          }
          .tr-audioDeck--pro7 .tr-audioQueueSelector{
            grid-column:1/-1!important;
            grid-row:2;
            max-width:none!important;
            width:100%!important;
            margin:0!important;
          }
          .tr-audioDeck--pro7 .tr-audioTopButtons{
            grid-column:1/-1!important;
            grid-row:3;
            width:100%!important;
            max-width:none!important;
            min-width:0!important;
            display:grid!important;
            grid-template-columns:1fr 1fr!important;
            gap:8px!important;
            justify-self:stretch!important;
            margin:0!important;
          }
          .tr-audioDeck--pro7 .tr-audioEqToggle,
          .tr-audioDeck--pro7 .tr-audioLibraryButton{
            width:100%!important;
            max-width:none!important;
            min-width:0!important;
            height:42px!important;
            min-height:42px!important;
            justify-content:center!important;
          }
          .tr-audioDeck--pro7 .tr-audioLibraryButton{
            font-size:7.5px!important;
            letter-spacing:.13em!important;
          }
          .tr-audioDeck--pro7 .tr-audioTelemetry{
            margin-top:0!important;
            display:grid!important;
            grid-template-columns:repeat(3,minmax(0,1fr));
            gap:5px!important;
          }
          .tr-audioDeck--pro7 .tr-dspHealth{
            grid-column:1/-1;
            justify-self:stretch!important;
            text-align:center!important;
            min-height:30px!important;
          }
          .tr-audioDeck--pro7 .tr-audioControls{
            grid-template-columns:1fr!important;
            gap:10px!important;
          }
          .tr-audioDeck--pro7 .tr-audioModeButton{
            width:100%!important;
            justify-content:center!important;
          }
          .tr-audioDeck--pro7 .tr-audioTransport{
            grid-row:1;
            width:100%;
            justify-content:space-between!important;
          }
        }

        @media(max-width:430px){
          .tr-audioDeck--pro7 .tr-audioDeckTop{padding:9px!important}
          .tr-audioDeck--pro7 .tr-audioIdentity strong{font-size:13px!important}
          .tr-audioDeck--pro7 .tr-rta10Head{padding-left:8px!important;padding-right:8px!important}
          .tr-audioDeck--pro7 .tr-rta10Head strong{font-size:6.5px!important}
          .tr-audioDeck--pro7 .tr-rta10Band{grid-template-rows:72px 12px!important}
          .tr-audioDeck--pro7 .tr-rta10Grid{gap:2px!important}
          .tr-audioDeck--pro7 .tr-mainAudioTuning{gap:8px!important}
          .tr-audioDeck--pro7 .tr-trackPreference{display:grid!important;grid-template-columns:1fr 1fr!important;gap:7px!important}
          .tr-audioDeck--pro7 .tr-trackPreference button{min-width:0!important;width:100%!important}
          .tr-audioDeck--pro7 .tr-audioTransportUnit>span{font-size:5.5px!important}
        }

        /* FINAL PRO AUDIO PASS: true rack-style RTA, audible DSP controls, high contrast */
        .tr-audioDeck--pro7 .tr-audioEqToggle{min-height:38px!important;padding:0 13px!important;border:1px solid rgba(78,209,249,.36)!important;border-radius:8px!important;background:linear-gradient(180deg,#0a2c3a,#06171f)!important;color:#f5fcff!important;font-size:8px!important;font-weight:1000!important;letter-spacing:.075em!important;box-shadow:inset 0 1px rgba(255,255,255,.04),0 5px 14px rgba(0,0,0,.24)!important}.tr-audioDeck--pro7 .tr-audioEqToggle.is-active{border-color:rgba(74,216,255,.70)!important;background:linear-gradient(180deg,#0b4053,#072631)!important;box-shadow:inset 0 -2px #46d7fb,0 0 18px rgba(58,200,242,.12)!important}.tr-audioDeck--pro7 .tr-audioLibraryButton{color:#f3fbfe!important}.tr-audioDeck--pro7 button{color:#f2faff}.tr-audioDeck--pro7 button:disabled{color:rgba(220,235,241,.40)!important}.tr-audioDeck--pro7 .tr-rta10{border-radius:8px!important;border-color:rgba(111,175,197,.20)!important;background:#02080c!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.015),inset 0 -32px 70px rgba(0,0,0,.32)!important}.tr-audioDeck--pro7 .tr-rta10Head{height:31px!important;background:linear-gradient(180deg,#07131a,#030a0e)!important;border-bottom-color:rgba(119,177,198,.13)!important;color:#91aab4!important}.tr-audioDeck--pro7 .tr-rta10Head span:first-child{color:#eefaff!important}.tr-audioDeck--pro7 .tr-rta10Body{grid-template-columns:38px minmax(0,1fr)!important;min-height:150px!important;background:linear-gradient(to top,rgba(112,174,196,.052) 1px,transparent 1px)!important;background-size:100% 20%!important}.tr-audioDeck--pro7 .tr-rta10Scale{padding:9px 7px 26px 0!important;border-right-color:rgba(112,176,199,.12)!important;color:#7e98a2!important;font-size:6px!important}.tr-audioDeck--pro7 .tr-rta10Grid{padding:10px 12px 7px!important;gap:8px!important}.tr-audioDeck--pro7 .tr-rta10Band{grid-template-rows:104px 12px 10px!important;gap:3px!important}.tr-audioDeck--pro7 .tr-rta10Meter{border-radius:3px!important;background:linear-gradient(180deg,rgba(45,69,78,.22),rgba(8,20,26,.44))!important;box-shadow:inset 0 0 0 1px rgba(122,183,204,.10),inset 0 0 18px rgba(0,0,0,.44)!important}.tr-audioDeck--pro7 .tr-rta10Inactive,.tr-audioDeck--pro7 .tr-rta10Fill{inset:3px 4px!important;-webkit-mask-image:none!important;mask-image:none!important;border-radius:1px!important}.tr-audioDeck--pro7 .tr-rta10Inactive{background:linear-gradient(to top,rgba(61,108,125,.10),rgba(102,147,163,.055))!important}.tr-audioDeck--pro7 .tr-rta10Fill{background:linear-gradient(to top,#1e9fc5 0%,#3bc8e8 70%,#d8b452 89%,#e75f51 100%)!important;box-shadow:0 0 5px rgba(49,189,225,.13)!important;transition:transform 48ms linear!important}.tr-audioDeck--pro7 .tr-rta10Peak{left:9%!important;right:9%!important;height:2px!important;background:#f5fdff!important;box-shadow:0 0 4px rgba(225,250,255,.54)!important}.tr-audioDeck--pro7 .tr-rta10Band strong{color:#dbeaf0!important;font-size:6.4px!important}.tr-audioDeck--pro7 .tr-rta10Band>small{color:#718891!important;font-size:5px!important;font-weight:800!important;font-variant-numeric:tabular-nums}.tr-audioDeck--pro7 .tr-dspStatus button,.tr-audioDeck--pro7 .tr-audioEqQuickActions button,.tr-audioDeck--pro7 .tr-dspProfileSaveActions button,.tr-audioDeck--pro7 .tr-headphoneModes button{color:#f6fcff!important;border-color:rgba(96,181,211,.22)!important}.tr-audioDeck--pro7 .tr-headphoneModes button.is-active{color:#fff!important;border-color:rgba(69,214,253,.55)!important;background:#0a3443!important}.tr-audioDeck--pro7 .tr-headphoneProcessor input[type=range],.tr-audioDeck--pro7 .tr-audioEqPanel input[type=range]{accent-color:#55d5f7}.tr-audioDeck--pro7 .tr-dspStatus span{color:#fff!important}
        /* Active-workout coach decision gets one dominant, unmistakable action. */
        .tr-previousPerformance .tr-progressionCell--action{grid-column:1/-1!important;padding:16px 18px!important;border:1px solid rgba(81,199,237,.28)!important;border-radius:10px!important;background:linear-gradient(180deg,rgba(10,42,54,.92),rgba(4,18,25,.98))!important;box-shadow:inset 4px 0 #46d1f5!important}.tr-previousPerformance .tr-progressionCell--action .tr-kicker{color:#8edff7!important;font-size:8px!important;font-weight:1000!important;letter-spacing:.14em!important}.tr-previousPerformance .tr-progressionAction{display:block!important;margin-top:5px!important;color:#fff!important;font-size:clamp(22px,3vw,34px)!important;line-height:1.04!important;font-weight:1000!important;letter-spacing:-.025em!important;text-shadow:0 2px 12px rgba(0,0,0,.55)!important}.tr-previousPerformance--increase .tr-progressionCell--action{border-color:rgba(75,224,155,.38)!important;box-shadow:inset 4px 0 #4bdf9b!important}.tr-previousPerformance--review .tr-progressionCell--action{border-color:rgba(255,174,76,.40)!important;box-shadow:inset 4px 0 #f1aa4e!important}.tr-previousPerformance--repeat .tr-progressionCell--action{border-color:rgba(80,200,239,.36)!important;box-shadow:inset 4px 0 #50c8ef!important}.tr-previousPerformance button,.tr-progressionActions button{color:#fff!important;font-weight:950!important}.tr-progressionGrid strong,.tr-progressionGrid p{color:#eef9fd!important}
        @media(max-width:700px){.tr-audioDeck--pro7 .tr-rta10Body{grid-template-columns:30px minmax(0,1fr)!important;min-height:124px!important}.tr-audioDeck--pro7 .tr-rta10Band{grid-template-rows:78px 11px 9px!important}.tr-audioDeck--pro7 .tr-rta10Grid{gap:3px!important;padding:8px 5px 5px!important}.tr-audioDeck--pro7 .tr-rta10Band strong{font-size:5.2px!important}.tr-audioDeck--pro7 .tr-rta10Band>small{font-size:4.5px!important}.tr-previousPerformance .tr-progressionCell--action{padding:13px!important}.tr-previousPerformance .tr-progressionAction{font-size:22px!important}.tr-audioDeck--pro7 .tr-audioEqToggle,.tr-audioDeck--pro7 .tr-audioLibraryButton{min-height:42px!important;color:#fff!important}}
        /* AUG 9 COMPACT PLAYER + TRUE SEGMENTED RTA */
        .tr-audioDeck--pro7{min-width:0!important;overflow:hidden!important}
        .tr-audioDeck--pro7 .tr-audioDeckTop{grid-template-columns:46px minmax(0,1fr) minmax(142px,168px) max-content!important;gap:8px!important;padding:8px 10px!important;overflow:hidden!important}
        .tr-audioDeck--pro7 .tr-audioArtwork{width:46px!important;height:46px!important;min-width:46px!important;min-height:46px!important;max-width:46px!important;max-height:46px!important;border-radius:8px!important;overflow:hidden!important;align-self:center!important}
        .tr-audioDeck--pro7 .tr-audioArtworkImage{width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;object-fit:cover!important;object-position:center!important}
        .tr-audioDeck--pro7 .tr-audioIdentity{padding:0!important;align-self:center!important;overflow:hidden!important}
        .tr-audioDeck--pro7 .tr-audioIdentity .tr-audioEyebrow{font-size:6.5px!important;line-height:1.1!important;letter-spacing:.12em!important}
        .tr-audioDeck--pro7 .tr-audioIdentity strong{margin-top:2px!important;color:#fff!important;font-size:13px!important;line-height:1.15!important;font-weight:950!important}
        .tr-audioDeck--pro7 .tr-audioIdentity small{margin-top:2px!important;color:#afc5ce!important;font-size:7.5px!important;line-height:1.2!important}
        .tr-audioDeck--pro7 .tr-audioQueueSelector{max-width:168px!important;gap:2px!important}
        .tr-audioDeck--pro7 .tr-audioQueueSelector>span{font-size:6px!important;color:#8aa7b2!important;letter-spacing:.1em!important}
        .tr-audioDeck--pro7 .tr-audioQueueSelector select{height:32px!important;min-height:32px!important;padding:0 28px 0 9px!important;color:#f8fdff!important;font-size:8px!important;font-weight:900!important;border-radius:7px!important}
        .tr-audioDeck--pro7 .tr-audioQueueSelector small{display:none!important}
        .tr-audioDeck--pro7 .tr-audioTopButtons{gap:6px!important}
        .tr-audioDeck--pro7 .tr-audioEqToggle,.tr-audioDeck--pro7 .tr-audioLibraryButton{height:34px!important;min-height:34px!important;border-radius:7px!important;padding:0 10px!important;font-size:7.5px!important;line-height:1!important;font-weight:1000!important;letter-spacing:.075em!important;color:#fff!important;background:linear-gradient(180deg,#0b2834,#06151d)!important;border:1px solid rgba(86,196,232,.34)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 4px 12px rgba(0,0,0,.25)!important}
        .tr-audioDeck--pro7 .tr-audioEqToggle svg{width:14px!important;height:14px!important}
        .tr-audioDeck--pro7 .tr-audioLibraryButton{min-width:78px!important;background:linear-gradient(180deg,#101d25,#071117)!important;border-color:rgba(170,213,228,.25)!important}
        .tr-audioDeck--pro7 .tr-audioEqToggle:hover,.tr-audioDeck--pro7 .tr-audioLibraryButton:hover{border-color:rgba(92,219,255,.64)!important;background:linear-gradient(180deg,#0d3a4a,#08222c)!important}
        .tr-audioDeck--pro7 .tr-audioEqToggle.is-active{background:linear-gradient(180deg,#0d465a,#082c39)!important;border-color:rgba(86,222,255,.75)!important;box-shadow:inset 0 -2px #50d9fb,0 0 14px rgba(66,204,241,.12)!important}
        .tr-audioDeck--pro7 .tr-audioTelemetry{margin:3px 10px 0!important;padding:5px 8px!important;min-height:27px!important;gap:9px!important;font-size:6.5px!important}
        .tr-audioDeck--pro7 .tr-dspHealth{min-height:24px!important;font-size:6.5px!important;color:#d7e9ef!important}
        .tr-audioDeck--pro7 .tr-rta10{margin:6px 10px 5px!important;border-radius:7px!important}
        .tr-audioDeck--pro7 .tr-rta10Head{height:26px!important;padding:0 9px!important;font-size:6.5px!important}
        .tr-audioDeck--pro7 .tr-rta10Body{grid-template-columns:35px minmax(0,1fr)!important;min-height:126px!important;background:linear-gradient(to top,rgba(116,178,199,.055) 1px,transparent 1px)!important;background-size:100% 20%!important}
        .tr-audioDeck--pro7 .tr-rta10Scale{padding:7px 6px 24px 0!important;font-size:5.7px!important;color:#849ba4!important}
        .tr-audioDeck--pro7 .tr-rta10Grid{padding:8px 9px 6px!important;gap:5px!important}
        .tr-audioDeck--pro7 .tr-rta10Band{grid-template-rows:82px 11px 9px!important;gap:2px!important}
        .tr-audioDeck--pro7 .tr-rta10Meter{position:relative!important;padding:4px!important;border-radius:3px!important;background:#03090d!important;border:1px solid rgba(116,175,196,.13)!important;box-shadow:inset 0 0 16px rgba(0,0,0,.68)!important;overflow:visible!important}
        .tr-audioDeck--pro7 .tr-rta10Inactive,.tr-audioDeck--pro7 .tr-rta10Fill{display:none!important}
        .tr-audioDeck--pro7 .tr-rta10Segments{height:100%!important;display:flex!important;flex-direction:column-reverse!important;justify-content:space-between!important;gap:2px!important}
        .tr-audioDeck--pro7 .tr-rta10Segments>i{display:block!important;flex:1 1 0!important;min-height:1px!important;border-radius:1px!important;background:#0a1820!important;border:1px solid rgba(105,162,182,.055)!important;box-shadow:none!important;transition:background 54ms linear,box-shadow 54ms linear,border-color 54ms linear!important}
        .tr-audioDeck--pro7 .tr-rta10Segments>i.is-on.is-normal{background:#25b9df!important;border-color:rgba(85,223,255,.38)!important;box-shadow:0 0 5px rgba(45,191,228,.18)!important}
        .tr-audioDeck--pro7 .tr-rta10Segments>i.is-on.is-warm{background:#dfa73e!important;border-color:rgba(255,207,105,.38)!important;box-shadow:0 0 5px rgba(223,167,62,.18)!important}
        .tr-audioDeck--pro7 .tr-rta10Segments>i.is-on.is-hot{background:#e86155!important;border-color:rgba(255,125,110,.44)!important;box-shadow:0 0 5px rgba(232,97,85,.22)!important}
        .tr-audioDeck--pro7 .tr-rta10Peak{left:8%!important;right:8%!important;height:1px!important;background:#f7fdff!important;opacity:.85!important;box-shadow:0 0 4px rgba(222,250,255,.45)!important;transition:bottom 64ms linear!important}
        .tr-audioDeck--pro7 .tr-rta10Band strong{color:#e3f0f4!important;font-size:6.1px!important;font-weight:950!important}
        .tr-audioDeck--pro7 .tr-rta10Band>small{color:#8298a1!important;font-size:5px!important;font-weight:850!important}
        .tr-audioDeck--pro7 .tr-audioTimeline{margin:3px 10px!important;min-height:25px!important}
        .tr-audioDeck--pro7 .tr-mainAudioTuning{margin:2px 10px!important;padding:6px 0!important}
        .tr-audioDeck--pro7 .tr-audioControls{margin:2px 10px 8px!important;gap:8px!important}
        .tr-audioDeck--pro7 .tr-audioTransportButton{transform:scale(.9)!important}

        @media(max-width:700px){
          .tr-audioDeck--pro7 .tr-audioDeckTop{grid-template-columns:44px minmax(0,1fr) 72px 82px!important;grid-template-rows:44px 34px!important;gap:6px!important;padding:7px!important}
          .tr-audioDeck--pro7 .tr-audioArtwork{grid-column:1!important;grid-row:1!important;width:44px!important;height:44px!important;min-width:44px!important;min-height:44px!important;max-width:44px!important;max-height:44px!important}
          .tr-audioDeck--pro7 .tr-audioIdentity{grid-column:2/5!important;grid-row:1!important;align-self:center!important}
          .tr-audioDeck--pro7 .tr-audioIdentity strong{font-size:12.5px!important}
          .tr-audioDeck--pro7 .tr-audioIdentity small{font-size:7.4px!important}
          .tr-audioDeck--pro7 .tr-audioQueueSelector{grid-column:1/3!important;grid-row:2!important;max-width:none!important;width:100%!important;align-self:center!important}
          .tr-audioDeck--pro7 .tr-audioQueueSelector>span{display:none!important}
          .tr-audioDeck--pro7 .tr-audioQueueSelector select{height:34px!important;min-height:34px!important;font-size:7.6px!important}
          .tr-audioDeck--pro7 .tr-audioTopButtons{grid-column:3/5!important;grid-row:2!important;width:100%!important;display:grid!important;grid-template-columns:1fr 1fr!important;gap:5px!important;min-width:0!important}
          .tr-audioDeck--pro7 .tr-audioEqToggle,.tr-audioDeck--pro7 .tr-audioLibraryButton{width:100%!important;min-width:0!important;height:34px!important;min-height:34px!important;padding:0 5px!important;font-size:6.5px!important;letter-spacing:.055em!important}
          .tr-audioDeck--pro7 .tr-audioEqToggle svg{width:12px!important;height:12px!important}
          .tr-audioDeck--pro7 .tr-audioTelemetry{margin:3px 7px 0!important;display:flex!important;flex-wrap:wrap!important;gap:5px 8px!important;padding:5px 7px!important;font-size:6px!important}
          .tr-audioDeck--pro7 .tr-dspHealth{margin-left:auto!important;min-height:20px!important;font-size:5.8px!important}
          .tr-audioDeck--pro7 .tr-rta10{margin:5px 7px 4px!important}
          .tr-audioDeck--pro7 .tr-rta10Head{height:24px!important;padding:0 7px!important;font-size:5.8px!important}
          .tr-audioDeck--pro7 .tr-rta10Head span:last-child{display:none!important}
          .tr-audioDeck--pro7 .tr-rta10Body{grid-template-columns:27px minmax(0,1fr)!important;min-height:98px!important}
          .tr-audioDeck--pro7 .tr-rta10Scale{padding:6px 4px 22px 0!important;font-size:4.8px!important}
          .tr-audioDeck--pro7 .tr-rta10Grid{padding:6px 4px 4px!important;gap:2px!important}
          .tr-audioDeck--pro7 .tr-rta10Band{grid-template-rows:62px 10px 8px!important;gap:2px!important}
          .tr-audioDeck--pro7 .tr-rta10Meter{padding:3px 2px!important}
          .tr-audioDeck--pro7 .tr-rta10Segments{gap:1px!important}
          .tr-audioDeck--pro7 .tr-rta10Band strong{font-size:5.1px!important}
          .tr-audioDeck--pro7 .tr-rta10Band>small{display:none!important}
          .tr-audioDeck--pro7 .tr-audioTimeline{margin:2px 7px!important;min-height:22px!important}
          .tr-audioDeck--pro7 .tr-mainAudioTuning{margin:1px 7px!important;padding:4px 0!important}
          .tr-audioDeck--pro7 .tr-audioControls{margin:1px 7px 6px!important;grid-template-columns:auto minmax(0,1fr) auto!important;gap:5px!important}
          .tr-audioDeck--pro7 .tr-audioModeButton{width:auto!important;min-width:54px!important;padding:0 7px!important;font-size:6px!important}
          .tr-audioDeck--pro7 .tr-audioTransport{grid-row:auto!important;gap:3px!important}
          .tr-audioDeck--pro7 .tr-audioTransportButton{transform:scale(.82)!important}
          .tr-audioDeck--pro7 .tr-audioTransportUnit>span{font-size:5px!important}
          .tr-audioDeck--pro7 .tr-trackPreference button{min-height:31px!important;font-size:6.2px!important}
        }
        @media(max-width:360px){
          .tr-audioDeck--pro7 .tr-audioDeckTop{grid-template-columns:42px minmax(0,1fr)!important;grid-template-rows:42px 34px 34px!important}
          .tr-audioDeck--pro7 .tr-audioArtwork{width:42px!important;height:42px!important;min-width:42px!important;min-height:42px!important;max-width:42px!important;max-height:42px!important}
          .tr-audioDeck--pro7 .tr-audioIdentity{grid-column:2!important}
          .tr-audioDeck--pro7 .tr-audioQueueSelector{grid-column:1/-1!important;grid-row:2!important}
          .tr-audioDeck--pro7 .tr-audioTopButtons{grid-column:1/-1!important;grid-row:3!important}
        }
        /* Global chrome cleanup: the mini player itself links to Music. */
        .tr-appHeaderButton.is-music{display:none!important}
        .tr-appHeaderButton{color:#fff!important;font-weight:900!important}

        /* AUG 9 FINAL COMPACT PLAYER + READABILITY */
        .tr-audioDeck--pro7{overflow:hidden!important}
        .tr-audioDeck--pro7 .tr-audioDeckTop{grid-template-columns:58px minmax(170px,1fr) minmax(160px,190px) 108px!important;grid-template-rows:58px!important;align-items:center!important;gap:10px!important;padding:9px 10px 7px!important}
        .tr-audioDeck--pro7 .tr-audioArtwork{width:58px!important;height:58px!important;min-width:58px!important;min-height:58px!important;max-width:58px!important;max-height:58px!important;border-radius:9px!important;overflow:hidden!important}
        .tr-audioDeck--pro7 .tr-audioArtworkImage{width:100%!important;height:100%!important;object-fit:cover!important;object-position:center!important}
        .tr-audioDeck--pro7 .tr-audioIdentity{min-width:0!important;overflow:hidden!important;padding:0 2px!important}
        .tr-audioDeck--pro7 .tr-audioIdentity strong{display:block!important;max-width:100%!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:16px!important;line-height:1.15!important;color:#fff!important}
        .tr-audioDeck--pro7 .tr-audioIdentity small{display:block!important;max-width:100%!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;margin-top:5px!important;font-size:11px!important;line-height:1.2!important;color:#c7d8df!important}
        .tr-audioDeck--pro7 .tr-audioEyebrow{margin-bottom:4px!important;font-size:9px!important;color:#79dfff!important}
        .tr-audioDeck--pro7 .tr-audioQueueSelector{width:100%!important;max-width:190px!important;gap:4px!important}
        .tr-audioDeck--pro7 .tr-audioQueueSelector>span{font-size:9px!important;color:#a9c4ce!important;letter-spacing:.08em!important}
        .tr-audioDeck--pro7 .tr-audioQueueSelector select{width:100%!important;height:38px!important;min-height:38px!important;padding:0 30px 0 10px!important;border-radius:9px!important;color:#fff!important;font-size:11px!important;font-weight:900!important}
        .tr-audioDeck--pro7 .tr-audioTopButtons{display:block!important;min-width:0!important}
        .tr-audioDeck--pro7 .tr-audioEqToggle{width:100%!important;min-width:0!important;height:40px!important;min-height:40px!important;padding:0 12px!important;border-radius:9px!important;font-size:11px!important;letter-spacing:.05em!important;color:#fff!important}
        .tr-audioDeck--pro7 .tr-audioEqToggle svg{width:16px!important;height:16px!important}
        .tr-audioDeck--pro7 .tr-rta10{margin:4px 10px 3px!important;border-radius:8px!important}
        .tr-audioDeck--pro7 .tr-rta10Head{display:none!important}
        .tr-audioDeck--pro7 .tr-rta10Body{grid-template-columns:32px minmax(0,1fr)!important;min-height:100px!important;background-size:100% 20%!important}
        .tr-audioDeck--pro7 .tr-rta10Scale{padding:6px 5px 18px 0!important;font-size:8px!important;color:#9db2bb!important}
        .tr-audioDeck--pro7 .tr-rta10Grid{padding:7px 8px 5px!important;gap:5px!important}
        .tr-audioDeck--pro7 .tr-rta10Band{grid-template-rows:67px 14px 10px!important;gap:2px!important}
        .tr-audioDeck--pro7 .tr-rta10Band strong{font-size:8px!important;color:#f2f8fa!important}
        .tr-audioDeck--pro7 .tr-rta10Band>small{font-size:7px!important;color:#9aadb5!important}
        .tr-audioDeck--pro7 .tr-audioTimeline{margin:2px 10px!important;min-height:28px!important;font-size:10px!important;color:#dce9ee!important}
        .tr-audioDeck--pro7 .tr-mainAudioTuning{margin:1px 10px!important;padding:4px 0 5px!important;gap:10px!important}
        .tr-audioDeck--pro7 .tr-mainPreamp>span{font-size:9px!important;color:#c5d8df!important}
        .tr-audioDeck--pro7 .tr-mainPreamp>strong{font-size:11px!important;color:#fff!important}
        .tr-audioDeck--pro7 .tr-trackPreference button{min-height:35px!important;font-size:10px!important;color:#fff!important}
        .tr-audioDeck--pro7 .tr-audioControls{margin:0 10px 7px!important;gap:7px!important}
        .tr-audioDeck--pro7 .tr-audioModeButton{min-height:36px!important;font-size:9px!important;color:#fff!important}
        .tr-audioDeck--pro7 .tr-audioTransportUnit>span{font-size:8px!important;color:#dce8ed!important}
        @media(max-width:700px){
          .tr-audioDeck--pro7 .tr-audioDeckTop{grid-template-columns:50px minmax(0,1fr) 96px!important;grid-template-rows:50px 38px!important;gap:7px!important;padding:7px!important}
          .tr-audioDeck--pro7 .tr-audioArtwork{grid-column:1!important;grid-row:1!important;width:50px!important;height:50px!important;min-width:50px!important;min-height:50px!important;max-width:50px!important;max-height:50px!important}
          .tr-audioDeck--pro7 .tr-audioIdentity{grid-column:2/4!important;grid-row:1!important}
          .tr-audioDeck--pro7 .tr-audioIdentity strong{font-size:14px!important}
          .tr-audioDeck--pro7 .tr-audioIdentity small{font-size:10px!important;margin-top:3px!important}
          .tr-audioDeck--pro7 .tr-audioEyebrow{font-size:8px!important;margin-bottom:2px!important}
          .tr-audioDeck--pro7 .tr-audioQueueSelector{grid-column:1/3!important;grid-row:2!important;max-width:none!important;display:grid!important;grid-template-columns:auto minmax(0,1fr)!important;align-items:center!important;gap:7px!important}
          .tr-audioDeck--pro7 .tr-audioQueueSelector>span{display:block!important;font-size:8px!important;white-space:nowrap!important}
          .tr-audioDeck--pro7 .tr-audioQueueSelector select{height:36px!important;min-height:36px!important;font-size:10px!important}
          .tr-audioDeck--pro7 .tr-audioTopButtons{grid-column:3!important;grid-row:2!important;width:100%!important}
          .tr-audioDeck--pro7 .tr-audioEqToggle{height:36px!important;min-height:36px!important;padding:0 7px!important;font-size:9px!important}
          .tr-audioDeck--pro7 .tr-rta10{margin:4px 7px 2px!important}
          .tr-audioDeck--pro7 .tr-rta10Body{grid-template-columns:24px minmax(0,1fr)!important;min-height:79px!important}
          .tr-audioDeck--pro7 .tr-rta10Scale{padding:4px 3px 17px 0!important;font-size:6px!important}
          .tr-audioDeck--pro7 .tr-rta10Grid{padding:5px 3px 3px!important;gap:2px!important}
          .tr-audioDeck--pro7 .tr-rta10Band{grid-template-rows:49px 12px!important;gap:2px!important}
          .tr-audioDeck--pro7 .tr-rta10Band strong{font-size:6.5px!important}
          .tr-audioDeck--pro7 .tr-rta10Band>small{display:none!important}
          .tr-audioDeck--pro7 .tr-audioTimeline{margin:1px 7px!important;min-height:25px!important;font-size:9px!important}
          .tr-audioDeck--pro7 .tr-mainAudioTuning{margin:0 7px!important;padding:3px 0!important;grid-template-columns:minmax(0,1fr) auto!important}
          .tr-audioDeck--pro7 .tr-mainPreamp>span{font-size:8px!important}.tr-audioDeck--pro7 .tr-mainPreamp>strong{font-size:10px!important}
          .tr-audioDeck--pro7 .tr-trackPreference button{min-height:32px!important;font-size:8px!important;padding:0 7px!important}
          .tr-audioDeck--pro7 .tr-audioControls{margin:0 7px 5px!important;gap:4px!important}
          .tr-audioDeck--pro7 .tr-audioModeButton{min-width:50px!important;min-height:33px!important;padding:0 5px!important;font-size:7.5px!important}
          .tr-audioDeck--pro7 .tr-audioTransportButton{transform:scale(.78)!important}
          .tr-audioDeck--pro7 .tr-audioTransportUnit>span{font-size:6.5px!important}
        }
        @media(max-width:390px){
          .tr-audioDeck--pro7 .tr-audioDeckTop{grid-template-columns:48px minmax(0,1fr) 88px!important;grid-template-rows:48px 36px!important}
          .tr-audioDeck--pro7 .tr-audioArtwork{width:48px!important;height:48px!important;min-width:48px!important;min-height:48px!important;max-width:48px!important;max-height:48px!important}
          .tr-audioDeck--pro7 .tr-audioEqToggle{font-size:8px!important}
          .tr-audioDeck--pro7 .tr-trackPreference button span{display:none!important}
        }
      `}</style>
    </section>
  );
}
