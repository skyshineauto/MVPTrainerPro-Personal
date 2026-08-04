import { useSyncExternalStore } from "react";
import {
  getMusicTrackSignedUrl,
  listMusicTracks,
  type MusicTrack,
} from "./musicStorage";
import {
  getMusicPlaylist,
  listMusicPlaylistTrackLinks,
  type MusicPlaylist,
} from "./playlistStorage";

export type MusicRepeatMode = "off" | "all" | "one";

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
};

const STORAGE_KEYS = {
  currentTrackId: "mvp_music_current_track_id",
  currentTime: "mvp_music_current_time",
  shuffle: "mvp_music_shuffle",
  repeat: "mvp_music_repeat",
  activePlaylistId: "mvp_music_active_playlist_id",
  activePlaylistName: "mvp_music_active_playlist_name",
};

const listeners = new Set<() => void>();
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
};

let audioElement: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let musicGain: GainNode | null = null;
let mediaSourceConnected = false;
let loadingTrackId: string | null = null;
let timeSaveTimer = 0;

function readStored(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function readBoolean(key: string) {
  return readStored(key) === "true";
}

function readRepeatMode(): MusicRepeatMode {
  const value = readStored(STORAGE_KEYS.repeat);
  return value === "all" || value === "one" ? value : "off";
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
  savePlayerSetting(STORAGE_KEYS.currentTime, String(audioElement.currentTime || 0));
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

  const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
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

function connectMusicGain() {
  const audio = ensureAudioElement();
  const context = getAudioContext();
  if (!context || mediaSourceConnected) return;

  try {
    const source = context.createMediaElementSource(audio);
    musicGain = context.createGain();
    musicGain.gain.value = 1;
    source.connect(musicGain);
    musicGain.connect(context.destination);
    mediaSourceConnected = true;
  } catch (error) {
    console.warn("Music gain connection unavailable; using direct audio output.", error);
  }
}

async function unlockMusicAudio() {
  connectMusicGain();
  const context = getAudioContext();
  if (context?.state === "suspended") await context.resume();
}

function getCurrentIndex() {
  if (!state.currentTrack) return -1;
  return state.tracks.findIndex((track) => track.id === state.currentTrack?.id);
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
    const url = await getMusicTrackSignedUrl(track);
    if (loadingTrackId !== track.id) return;

    if (audio.dataset.trackId !== track.id || audio.src !== url) {
      audio.pause();
      audio.src = url;
      audio.dataset.trackId = track.id;
      audio.load();
    }

    const seekWhenReady = () => {
      const target = Math.max(0, Number(startAt) || 0);
      if (target > 0 && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(target, Math.max(0, audio.duration - 0.25));
      } else {
        audio.currentTime = target;
      }
    };

    if (audio.readyState >= 1) seekWhenReady();
    else audio.addEventListener("loadedmetadata", seekWhenReady, { once: true });

    emit({ loading: false, currentTime: startAt });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load this song.";
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
    const message = error instanceof Error ? error.message : "Could not load your music library.";
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
    ? tracks.find((track) => track.id === state.currentTrack?.id) ?? tracks[0] ?? null
    : tracks[0] ?? null;

  if (state.currentTrack && !currentTrack) stopMusic();
  emit({ libraryTracks, tracks, currentTrack, libraryLoaded: true });
  configureMediaSession();
}

export function activateAllMusicTracks() {
  savePlayerSetting(STORAGE_KEYS.activePlaylistId, "");
  savePlayerSetting(STORAGE_KEYS.activePlaylistName, "");
  removePlayerSetting(STORAGE_KEYS.activePlaylistId);
  removePlayerSetting(STORAGE_KEYS.activePlaylistName);
  const currentTrack =
    state.libraryTracks.find((track) => track.id === state.currentTrack?.id) ??
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
    tracks.find((track) => track.id === state.currentTrack?.id) ?? tracks[0] ?? null;
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
  const startTrack = tracks.find((track) => track.id === startTrackId) ?? tracks[0];
  if (!startTrack) throw new Error("Add songs to this playlist before playing it.");
  await playMusicTrack(startTrack.id, 0);
}

export async function playMusicTrack(trackId: string, startAt = 0) {
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
  const duration = Number.isFinite(audio.duration) ? audio.duration : state.duration;
  const next = Math.max(0, Math.min(Number(seconds) || 0, Math.max(0, duration || 0)));
  try {
    audio.currentTime = next;
    emit({ currentTime: next });
    savePlayerSetting(STORAGE_KEYS.currentTime, String(next));
  } catch {
    // Ignore unavailable seeking until metadata exists.
  }
}

export async function nextMusicTrack(fromEnded = false) {
  if (!state.libraryLoaded) await loadMusicLibrary();
  const index = state.shuffle ? nextShuffleIndex() : nextSequentialIndex(1);

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
    state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
  savePlayerSetting(STORAGE_KEYS.repeat, repeat);
  emit({ repeat });
}

function fadeGainTo(target: number, milliseconds: number) {
  if (!musicGain || !audioContext) return Promise.resolve();
  const now = audioContext.currentTime;
  const seconds = Math.max(0.03, milliseconds / 1000);
  musicGain.gain.cancelScheduledValues(now);
  musicGain.gain.setValueAtTime(musicGain.gain.value, now);
  musicGain.gain.linearRampToValueAtTime(target, now + seconds);
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds + 20));
}

export async function playWithMusicDucked(playAlert: () => Promise<void>) {
  const audio = ensureAudioElement();
  const wasPlaying = !audio.paused && !audio.ended && Boolean(audio.src);

  if (!wasPlaying) {
    await playAlert();
    return;
  }

  connectMusicGain();

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
