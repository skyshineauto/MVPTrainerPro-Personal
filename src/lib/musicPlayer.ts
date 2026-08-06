import { useSyncExternalStore } from "react";
import {
  getMusicTrackSignedUrl,
  listMusicTracks,
  recordMusicTrackPlayed,
  recordMusicTrackSkipped,
  type MusicTrack,
} from "./musicStorage";
import {
  getMusicPlaylist,
  listMusicPlaylistTrackLinks,
  type MusicPlaylist,
} from "./playlistStorage";

export type MusicRepeatMode = "off" | "all" | "one";
export type MusicEqPreset =
  | "flat"
  | "power"
  | "deep_bass"
  | "rock"
  | "metal"
  | "vocal"
  | "reduced_treble"
  | "custom";

export const MUSIC_EQ_FREQUENCIES = [
  60, 120, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000,
] as const;

export const MUSIC_EQ_PRESETS: Record<
  Exclude<MusicEqPreset, "custom">,
  { label: string; gains: number[]; preamp: number }
> = {
  flat: {
    label: "Flat",
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    preamp: 0,
  },
  power: {
    label: "Power Training",
    gains: [5, 4, 2, 0, 1, 2, 3, 4, 3, 2],
    preamp: -2,
  },
  deep_bass: {
    label: "Deep Bass",
    gains: [7, 6, 4, 1, 0, 0, 0, 1, 1, 0],
    preamp: -3,
  },
  rock: {
    label: "Rock",
    gains: [4, 3, 1, -1, 0, 2, 4, 5, 4, 3],
    preamp: -2,
  },
  metal: {
    label: "Metal",
    gains: [4, 3, 0, -2, 0, 3, 5, 6, 5, 3],
    preamp: -3,
  },
  vocal: {
    label: "Vocal Clarity",
    gains: [-2, -1, 0, 1, 3, 5, 4, 2, 0, -1],
    preamp: -1,
  },
  reduced_treble: {
    label: "Reduced Treble",
    gains: [2, 2, 1, 0, 0, 0, -1, -3, -5, -6],
    preamp: 0,
  },
};

export type MusicPlayerState = {
  libraryTracks: MusicTrack[];
  tracks: MusicTrack[];
  currentTrack: MusicTrack | null;
  activePlaylistId: string | null;
  activePlaylistName: string | null;
  loading: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  shuffle: boolean;
  repeat: MusicRepeatMode;
  error: string | null;
  libraryLoaded: boolean;
  eqEnabled: boolean;
  eqPreset: MusicEqPreset;
  eqGains: number[];
  preampDb: number;
};

const STORAGE_KEYS = {
  currentTrackId: "mvp_music_current_track_id",
  currentTime: "mvp_music_current_time",
  shuffle: "mvp_music_shuffle",
  repeat: "mvp_music_repeat",
  activePlaylistId: "mvp_music_active_playlist_id",
  activePlaylistName: "mvp_music_active_playlist_name",
  eqEnabled: "mvp_music_eq_enabled",
  eqPreset: "mvp_music_eq_preset",
  eqGains: "mvp_music_eq_gains",
  preampDb: "mvp_music_eq_preamp_db",
};

const listeners = new Set<() => void>();

function readStored(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function readBoolean(key: string, fallback = false) {
  const value = readStored(key);
  if (!value) return fallback;
  return value === "true";
}

function readRepeatMode(): MusicRepeatMode {
  const value = readStored(STORAGE_KEYS.repeat);
  return value === "all" || value === "one" ? value : "off";
}

function readEqPreset(): MusicEqPreset {
  const value = readStored(STORAGE_KEYS.eqPreset) as MusicEqPreset;
  if (value === "custom" || Object.prototype.hasOwnProperty.call(MUSIC_EQ_PRESETS, value)) {
    return value;
  }
  return "power";
}

function readEqGains(preset: MusicEqPreset) {
  try {
    const parsed = JSON.parse(readStored(STORAGE_KEYS.eqGains));
    if (
      Array.isArray(parsed) &&
      parsed.length === MUSIC_EQ_FREQUENCIES.length &&
      parsed.every((value) => Number.isFinite(Number(value)))
    ) {
      return parsed.map((value) => Math.max(-12, Math.min(12, Number(value))));
    }
  } catch {
    // Use the preset below.
  }

  if (preset !== "custom") return [...MUSIC_EQ_PRESETS[preset].gains];
  return [...MUSIC_EQ_PRESETS.flat.gains];
}

function readPreamp(preset: MusicEqPreset) {
  const value = Number(readStored(STORAGE_KEYS.preampDb));
  if (Number.isFinite(value)) return Math.max(-12, Math.min(6, value));
  return preset !== "custom" ? MUSIC_EQ_PRESETS[preset].preamp : 0;
}

const initialPreset = readEqPreset();

let state: MusicPlayerState = {
  libraryTracks: [],
  tracks: [],
  currentTrack: null,
  activePlaylistId: readStored(STORAGE_KEYS.activePlaylistId) || null,
  activePlaylistName: readStored(STORAGE_KEYS.activePlaylistName) || null,
  loading: false,
  playing: false,
  currentTime: 0,
  duration: 0,
  shuffle: readBoolean(STORAGE_KEYS.shuffle),
  repeat: readRepeatMode(),
  error: null,
  libraryLoaded: false,
  eqEnabled: readBoolean(STORAGE_KEYS.eqEnabled, true),
  eqPreset: initialPreset,
  eqGains: readEqGains(initialPreset),
  preampDb: readPreamp(initialPreset),
};

let audioElement: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let mediaSource: MediaElementAudioSourceNode | null = null;
let preampGain: GainNode | null = null;
let equalizerFilters: BiquadFilterNode[] = [];
let analyserNode: AnalyserNode | null = null;
let musicGain: GainNode | null = null;
let mediaSourceConnected = false;
let loadingTrackId: string | null = null;
let timeSaveTimer = 0;
let recordedPlayToken = "";
let transportQueue: Promise<void> = Promise.resolve();
const signedUrlCache = new Map<string, { url: string; cachedAt: number }>();

async function resolveTrackUrl(track: MusicTrack) {
  const cached = signedUrlCache.get(track.id);
  if (cached && Date.now() - cached.cachedAt < 10 * 60 * 1000) {
    return cached.url;
  }

  const url = await getMusicTrackSignedUrl(track);
  signedUrlCache.set(track.id, { url, cachedAt: Date.now() });
  return url;
}

function preloadUpcomingTrack() {
  const currentIndex = getCurrentIndex();
  if (currentIndex < 0 || state.tracks.length < 2) return;
  const nextIndex = currentIndex + 1 < state.tracks.length ? currentIndex + 1 : 0;
  const nextTrack = state.tracks[nextIndex];
  if (nextTrack && nextTrack.id !== state.currentTrack?.id) {
    void resolveTrackUrl(nextTrack).catch(() => undefined);
  }
}

function emit(patch: Partial<MusicPlayerState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function savePlayerSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage is optional.
  }
}

function removePlayerSetting(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage is optional.
  }
}

function savePlaybackPosition() {
  if (!audioElement || !state.currentTrack) return;
  const now = Date.now();
  if (now - timeSaveTimer < 1500) return;
  timeSaveTimer = now;
  savePlayerSetting(
    STORAGE_KEYS.currentTime,
    String(audioElement.currentTime || 0)
  );
}

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const Context =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!Context) return null;
  if (!audioContext) audioContext = new Context();
  return audioContext;
}

function dbToGain(db: number) {
  return Math.pow(10, db / 20);
}

function applyEqGraphSettings() {
  if (!audioContext || !mediaSourceConnected) return;
  const now = audioContext.currentTime;
  const enabled = state.eqEnabled;

  if (preampGain) {
    const target = enabled ? dbToGain(state.preampDb) : 1;
    preampGain.gain.cancelScheduledValues(now);
    preampGain.gain.setTargetAtTime(target, now, 0.02);
  }

  equalizerFilters.forEach((filter, index) => {
    const gain = enabled ? Number(state.eqGains[index] || 0) : 0;
    filter.gain.cancelScheduledValues(now);
    filter.gain.setTargetAtTime(gain, now, 0.02);
  });
}

function configureMediaSession() {
  if (!("mediaSession" in navigator)) return;

  const session = navigator.mediaSession;
  const current = state.currentTrack;

  try {
    session.metadata = current
      ? new MediaMetadata({
          title: current.title,
          artist: current.artist || "MVP Trainer Music",
          album: state.activePlaylistName || "MVP Trainer",
        })
      : null;
  } catch {
    // Metadata is optional.
  }

  const handlers: Array<
    [MediaSessionAction, MediaSessionActionHandler | null]
  > = [
    ["play", () => void playMusic()],
    ["pause", pauseMusic],
    ["previoustrack", () => void previousMusicTrack()],
    ["nexttrack", () => void nextMusicTrack()],
    ["stop", stopMusic],
    ["seekto", (details) => {
      if (typeof details.seekTime === "number") seekMusic(details.seekTime);
    }],
  ];

  for (const [action, handler] of handlers) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Some browsers expose only part of Media Session.
    }
  }
}

function ensureAudioElement() {
  if (audioElement) return audioElement;

  const audio = new Audio();
  audio.preload = "auto";
  audio.crossOrigin = "anonymous";

  audio.addEventListener("play", () => {
    emit({ playing: true, error: null });
    configureMediaSession();

    const trackId = audio.dataset.trackId;
    const token = trackId ? `${trackId}:${audio.src}` : "";
    if (trackId && token !== recordedPlayToken) {
      recordedPlayToken = token;
      void recordMusicTrackPlayed(trackId).catch(() => undefined);
    }
  });
  audio.addEventListener("pause", () => emit({ playing: false }));
  audio.addEventListener("loadedmetadata", () => {
    const duration = Number(audio.duration);
    emit({ duration: Number.isFinite(duration) ? duration : 0 });
  });
  audio.addEventListener("durationchange", () => {
    const duration = Number(audio.duration);
    emit({ duration: Number.isFinite(duration) ? duration : 0 });
  });
  audio.addEventListener("timeupdate", () => {
    emit({ currentTime: audio.currentTime || 0 });
    savePlaybackPosition();
  });
  audio.addEventListener("ended", () => {
    recordedPlayToken = "";
    emit({ playing: false, currentTime: 0 });
    void handleTrackEnded();
  });
  audio.addEventListener("error", () => {
    emit({
      playing: false,
      loading: false,
      error: "This music file could not be played.",
    });
  });

  audioElement = audio;
  return audio;
}

function connectMusicGraph() {
  const audio = ensureAudioElement();
  const context = getAudioContext();
  if (!context || mediaSourceConnected) return;

  try {
    mediaSource = context.createMediaElementSource(audio);
    preampGain = context.createGain();
    equalizerFilters = MUSIC_EQ_FREQUENCIES.map((frequency) => {
      const filter = context.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = Math.min(
        frequency,
        Math.max(20, context.sampleRate / 2 - 20)
      );
      filter.Q.value = 1.05;
      filter.gain.value = 0;
      return filter;
    });
    analyserNode = context.createAnalyser();
    analyserNode.fftSize = 1024;
    analyserNode.smoothingTimeConstant = 0.72;
    musicGain = context.createGain();
    musicGain.gain.value = 1;

    let node: AudioNode = mediaSource;
    node.connect(preampGain);
    node = preampGain;

    for (const filter of equalizerFilters) {
      node.connect(filter);
      node = filter;
    }

    node.connect(analyserNode);
    analyserNode.connect(musicGain);
    musicGain.connect(context.destination);
    mediaSourceConnected = true;
    applyEqGraphSettings();
  } catch (error) {
    console.warn(
      "Music equalizer connection unavailable; using direct audio output.",
      error
    );
  }
}

async function unlockMusicAudio() {
  connectMusicGraph();
  const context = getAudioContext();
  if (context?.state === "suspended") await context.resume();
}

function getCurrentIndex() {
  if (!state.currentTrack) return -1;
  return state.tracks.findIndex(
    (track) => track.id === state.currentTrack?.id
  );
}

function nextSequentialIndex(direction: 1 | -1) {
  const count = state.tracks.length;
  if (!count) return -1;
  const currentIndex = getCurrentIndex();

  if (currentIndex < 0) return direction === 1 ? 0 : count - 1;
  const next = currentIndex + direction;
  if (next >= 0 && next < count) return next;
  return state.repeat === "all" ? (direction === 1 ? 0 : count - 1) : -1;
}

function nextShuffleIndex() {
  const count = state.tracks.length;
  if (count <= 1) return count ? 0 : -1;
  const currentIndex = getCurrentIndex();
  let nextIndex = currentIndex;

  while (nextIndex === currentIndex) {
    nextIndex = Math.floor(Math.random() * count);
  }
  return nextIndex;
}

async function handleTrackEnded() {
  if (state.repeat === "one" && state.currentTrack) {
    await playMusicTrack(state.currentTrack.id, 0);
    return;
  }
  await nextMusicTrack(true);
}

async function loadTrack(track: MusicTrack, startAt = 0) {
  const audio = ensureAudioElement();
  loadingTrackId = track.id;
  emit({ loading: true, error: null, currentTrack: track });
  savePlayerSetting(STORAGE_KEYS.currentTrackId, track.id);
  configureMediaSession();

  try {
    const url = await resolveTrackUrl(track);
    if (loadingTrackId !== track.id) return;

    if (audio.dataset.trackId !== track.id || audio.src !== url) {
      audio.pause();
      recordedPlayToken = "";
      audio.src = url;
      audio.dataset.trackId = track.id;
      audio.load();
    }

    const seekWhenReady = () => {
      const target = Math.max(0, Number(startAt) || 0);
      if (target > 0 && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(
          target,
          Math.max(0, audio.duration - 0.25)
        );
      } else {
        audio.currentTime = target;
      }
    };

    if (audio.readyState >= 1) seekWhenReady();
    else audio.addEventListener("loadedmetadata", seekWhenReady, { once: true });

    emit({ loading: false, currentTime: startAt });
    preloadUpcomingTrack();
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Could not load this song.";
    emit({ loading: false, playing: false, error: message });
    throw error;
  } finally {
    if (loadingTrackId === track.id) loadingTrackId = null;
  }
}

async function resolveSavedQueue(libraryTracks: MusicTrack[]) {
  const savedPlaylistId = readStored(STORAGE_KEYS.activePlaylistId);
  if (!savedPlaylistId) {
    return {
      tracks: libraryTracks,
      playlistId: null as string | null,
      playlistName: null as string | null,
    };
  }

  try {
    const [playlist, links] = await Promise.all([
      getMusicPlaylist(savedPlaylistId),
      listMusicPlaylistTrackLinks(savedPlaylistId),
    ]);
    if (!playlist) throw new Error("Playlist no longer exists.");

    const byId = new Map(libraryTracks.map((track) => [track.id, track]));
    const tracks = links
      .map((link) => byId.get(link.track_id))
      .filter((track): track is MusicTrack => Boolean(track));

    if (!tracks.length) throw new Error("Playlist is empty.");
    return { tracks, playlistId: playlist.id, playlistName: playlist.name };
  } catch {
    removePlayerSetting(STORAGE_KEYS.activePlaylistId);
    removePlayerSetting(STORAGE_KEYS.activePlaylistName);
    return {
      tracks: libraryTracks,
      playlistId: null as string | null,
      playlistName: null as string | null,
    };
  }
}

export async function loadMusicLibrary(force = false) {
  if (state.loading) return state.libraryTracks;
  if (state.libraryLoaded && !force) return state.libraryTracks;

  emit({ loading: true, error: null });
  try {
    const libraryTracks = await listMusicTracks();
    const queue = await resolveSavedQueue(libraryTracks);
    const savedTrackId = readStored(STORAGE_KEYS.currentTrackId);
    const currentTrack =
      queue.tracks.find((track) => track.id === state.currentTrack?.id) ??
      queue.tracks.find((track) => track.id === savedTrackId) ??
      queue.tracks[0] ??
      null;

    emit({
      libraryTracks,
      tracks: queue.tracks,
      activePlaylistId: queue.playlistId,
      activePlaylistName: queue.playlistName,
      currentTrack,
      loading: false,
      libraryLoaded: true,
      error: null,
    });
    configureMediaSession();
    return libraryTracks;
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load your music library.";
    emit({ loading: false, libraryLoaded: true, error: message });
    return [];
  }
}

export function replaceMusicLibrary(libraryTracks: MusicTrack[]) {
  const activeIds = new Set(state.tracks.map((track) => track.id));
  const tracks = state.activePlaylistId
    ? libraryTracks.filter((track) => activeIds.has(track.id))
    : libraryTracks;
  const currentTrack = state.currentTrack
    ? tracks.find((track) => track.id === state.currentTrack?.id) ??
      tracks[0] ??
      null
    : tracks[0] ?? null;

  if (state.currentTrack && !currentTrack) stopMusic();
  emit({ libraryTracks, tracks, currentTrack, libraryLoaded: true });
  configureMediaSession();
}

export function activateAllMusicTracks() {
  removePlayerSetting(STORAGE_KEYS.activePlaylistId);
  removePlayerSetting(STORAGE_KEYS.activePlaylistName);
  const currentTrack =
    state.libraryTracks.find(
      (track) => track.id === state.currentTrack?.id
    ) ??
    state.libraryTracks[0] ??
    null;
  emit({
    tracks: state.libraryTracks,
    currentTrack,
    activePlaylistId: null,
    activePlaylistName: null,
  });
  configureMediaSession();
}

export function activateMusicPlaylistQueue(
  playlist: Pick<MusicPlaylist, "id" | "name">,
  tracks: MusicTrack[]
) {
  savePlayerSetting(STORAGE_KEYS.activePlaylistId, playlist.id);
  savePlayerSetting(STORAGE_KEYS.activePlaylistName, playlist.name);
  const currentTrack =
    tracks.find((track) => track.id === state.currentTrack?.id) ??
    tracks[0] ??
    null;
  emit({
    tracks,
    currentTrack,
    activePlaylistId: playlist.id,
    activePlaylistName: playlist.name,
    error: tracks.length ? null : "This playlist has no songs.",
  });
  configureMediaSession();
}

export async function playMusicPlaylist(
  playlist: Pick<MusicPlaylist, "id" | "name">,
  tracks: MusicTrack[],
  startTrackId?: string
) {
  activateMusicPlaylistQueue(playlist, tracks);
  const startTrack =
    tracks.find((track) => track.id === startTrackId) ?? tracks[0];
  if (!startTrack)
    throw new Error("Add songs to this playlist before playing it.");
  await playMusicTrack(startTrack.id, 0);
}

async function performPlayMusicTrack(trackId: string, startAt = 0) {
  if (!state.libraryLoaded) await loadMusicLibrary();
  const track =
    state.tracks.find((item) => item.id === trackId) ??
    state.libraryTracks.find((item) => item.id === trackId);
  if (!track) throw new Error("Song not found in your music library.");

  if (!state.tracks.some((item) => item.id === trackId)) {
    activateAllMusicTracks();
  }

  await unlockMusicAudio();
  await loadTrack(track, startAt);
  await ensureAudioElement().play();
}

export function playMusicTrack(trackId: string, startAt = 0) {
  const operation = transportQueue
    .catch(() => undefined)
    .then(() => performPlayMusicTrack(trackId, startAt));
  transportQueue = operation.catch(() => undefined);
  return operation;
}

export async function playMusic() {
  await unlockMusicAudio();
  if (!state.libraryLoaded) await loadMusicLibrary();

  const audio = ensureAudioElement();
  const track = state.currentTrack ?? state.tracks[0] ?? null;
  if (!track) {
    emit({ error: "Upload music before pressing Play." });
    return;
  }

  if (audio.dataset.trackId !== track.id || !audio.src) {
    const savedTime = Number(readStored(STORAGE_KEYS.currentTime) || 0);
    await loadTrack(track, Number.isFinite(savedTime) ? savedTime : 0);
  }

  await audio.play();
}

export function pauseMusic() {
  ensureAudioElement().pause();
}

export function stopMusic() {
  const audio = ensureAudioElement();
  audio.pause();
  try {
    audio.currentTime = 0;
  } catch {
    // Some mobile browsers reject seeking before metadata is ready.
  }
  savePlayerSetting(STORAGE_KEYS.currentTime, "0");
  emit({ playing: false, currentTime: 0 });
}

export function seekMusic(seconds: number) {
  const audio = ensureAudioElement();
  const duration = Number.isFinite(audio.duration)
    ? audio.duration
    : state.duration;
  const next = Math.max(
    0,
    Math.min(Number(seconds) || 0, Math.max(0, duration || 0))
  );
  try {
    audio.currentTime = next;
    emit({ currentTime: next });
    savePlayerSetting(STORAGE_KEYS.currentTime, String(next));
  } catch {
    // Ignore unavailable seeking until metadata exists.
  }
}

function shouldRecordSkip() {
  const audio = ensureAudioElement();
  const duration = Number.isFinite(audio.duration)
    ? audio.duration
    : state.duration;
  const threshold = Math.max(30, (duration || 0) * 0.35);
  return Boolean(state.currentTrack && audio.currentTime < threshold);
}

export async function nextMusicTrack(fromEnded = false) {
  if (!state.libraryLoaded) await loadMusicLibrary();

  if (!fromEnded && shouldRecordSkip() && state.currentTrack) {
    void recordMusicTrackSkipped(state.currentTrack.id).catch(() => undefined);
  }

  const index = state.shuffle
    ? nextShuffleIndex()
    : nextSequentialIndex(1);

  if (index < 0) {
    if (fromEnded) stopMusic();
    return;
  }

  const track = state.tracks[index];
  if (track) await playMusicTrack(track.id, 0);
}

export async function previousMusicTrack() {
  const audio = ensureAudioElement();
  if (audio.currentTime > 5) {
    seekMusic(0);
    return;
  }

  if (!state.libraryLoaded) await loadMusicLibrary();
  const index = nextSequentialIndex(-1);
  if (index < 0) {
    seekMusic(0);
    return;
  }

  const track = state.tracks[index];
  if (track) await playMusicTrack(track.id, 0);
}

export function toggleMusicShuffle() {
  const shuffle = !state.shuffle;
  savePlayerSetting(STORAGE_KEYS.shuffle, String(shuffle));
  emit({ shuffle });
}

export function cycleMusicRepeat() {
  const repeat: MusicRepeatMode =
    state.repeat === "off"
      ? "all"
      : state.repeat === "all"
        ? "one"
        : "off";
  savePlayerSetting(STORAGE_KEYS.repeat, repeat);
  emit({ repeat });
}

export function setMusicEqEnabled(enabled: boolean) {
  savePlayerSetting(STORAGE_KEYS.eqEnabled, String(enabled));
  emit({ eqEnabled: enabled });
  applyEqGraphSettings();
}

export function applyMusicEqPreset(preset: MusicEqPreset) {
  if (preset === "custom") {
    savePlayerSetting(STORAGE_KEYS.eqPreset, preset);
    emit({ eqPreset: preset });
    return;
  }

  const definition = MUSIC_EQ_PRESETS[preset];
  const gains = [...definition.gains];
  savePlayerSetting(STORAGE_KEYS.eqPreset, preset);
  savePlayerSetting(STORAGE_KEYS.eqGains, JSON.stringify(gains));
  savePlayerSetting(STORAGE_KEYS.preampDb, String(definition.preamp));
  emit({
    eqPreset: preset,
    eqGains: gains,
    preampDb: definition.preamp,
  });
  applyEqGraphSettings();
}

export function setMusicEqBand(index: number, gainDb: number) {
  if (index < 0 || index >= MUSIC_EQ_FREQUENCIES.length) return;
  const gains = [...state.eqGains];
  gains[index] = Math.max(-12, Math.min(12, Number(gainDb) || 0));
  savePlayerSetting(STORAGE_KEYS.eqPreset, "custom");
  savePlayerSetting(STORAGE_KEYS.eqGains, JSON.stringify(gains));
  emit({ eqPreset: "custom", eqGains: gains });
  applyEqGraphSettings();
}

export function setMusicPreamp(preampDb: number) {
  const next = Math.max(-12, Math.min(6, Number(preampDb) || 0));
  savePlayerSetting(STORAGE_KEYS.eqPreset, "custom");
  savePlayerSetting(STORAGE_KEYS.preampDb, String(next));
  emit({ eqPreset: "custom", preampDb: next });
  applyEqGraphSettings();
}

let visualizerEnvelope: number[] = [];

export function getMusicVisualizerLevels(barCount = 32) {
  const count = Math.max(8, Math.min(64, Math.floor(barCount)));

  if (visualizerEnvelope.length !== count) {
    visualizerEnvelope = Array(count).fill(0);
  }

  if (!analyserNode || !audioContext) {
    return visualizerEnvelope.map((value, index) => {
      const next = Math.max(0, value * 0.82 - index * 0.00015);
      visualizerEnvelope[index] = next;
      return next;
    });
  }

  const data = new Uint8Array(analyserNode.frequencyBinCount);
  analyserNode.getByteFrequencyData(data);

  const nyquist = audioContext.sampleRate / 2;
  const minHz = 35;
  const maxHz = Math.min(18000, nyquist * 0.92);
  const ratio = maxHz / minHz;
  const levels: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const lowHz = minHz * Math.pow(ratio, index / count);
    const highHz = minHz * Math.pow(ratio, (index + 1) / count);
    const lowBin = Math.max(0, Math.floor((lowHz / nyquist) * data.length));
    const highBin = Math.max(lowBin + 1, Math.ceil((highHz / nyquist) * data.length));

    let weightedTotal = 0;
    let weightTotal = 0;
    for (let bin = lowBin; bin < Math.min(highBin, data.length); bin += 1) {
      const center = (lowBin + highBin - 1) / 2;
      const distance = Math.abs(bin - center) / Math.max(1, (highBin - lowBin) / 2);
      const weight = 1 - Math.min(0.72, distance * 0.72);
      weightedTotal += data[bin] * weight;
      weightTotal += weight;
    }

    const raw = weightTotal ? weightedTotal / weightTotal / 255 : 0;
    const lowFrequencyLift = index < count * 0.22 ? 1.13 : 1;
    const highFrequencyLift = index > count * 0.68 ? 1.18 : 1;
    const shaped = Math.min(1, Math.pow(raw * lowFrequencyLift * highFrequencyLift, 0.82));
    const previous = visualizerEnvelope[index] || 0;
    const attack = shaped > previous ? 0.58 : 0.18;
    const next = state.playing
      ? previous + (shaped - previous) * attack
      : Math.max(0, previous * 0.84 - 0.006);

    visualizerEnvelope[index] = next;
    levels.push(next);
  }

  return levels;
}

function fadeGainTo(target: number, milliseconds: number) {
  if (!musicGain || !audioContext) return Promise.resolve();
  const now = audioContext.currentTime;
  const seconds = Math.max(0.03, milliseconds / 1000);
  musicGain.gain.cancelScheduledValues(now);
  musicGain.gain.setValueAtTime(musicGain.gain.value, now);
  musicGain.gain.linearRampToValueAtTime(target, now + seconds);
  return new Promise<void>((resolve) =>
    window.setTimeout(resolve, milliseconds + 20)
  );
}

export async function playWithMusicDucked(
  playAlert: () => Promise<void>
) {
  const audio = ensureAudioElement();
  const wasPlaying = !audio.paused && !audio.ended && Boolean(audio.src);

  if (!wasPlaying) {
    await playAlert();
    return;
  }

  connectMusicGraph();

  if (musicGain && audioContext) {
    const originalGain = musicGain.gain.value;
    try {
      await fadeGainTo(0.12, 220);
      await playAlert();
    } finally {
      await fadeGainTo(originalGain || 1, 420);
    }
    return;
  }

  const originalVolume = audio.volume;
  try {
    audio.volume = Math.min(originalVolume, 0.12);
    await playAlert();
  } finally {
    audio.volume = originalVolume;
  }
}

export function formatMusicTime(value: number) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

export function useMusicPlayer() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
