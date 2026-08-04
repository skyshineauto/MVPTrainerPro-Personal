import { useSyncExternalStore } from "react";
import {
  getMusicTrackSignedUrl,
  listMusicTracks,
  type MusicTrack,
} from "./musicStorage";

export type MusicRepeatMode = "off" | "all" | "one";

export type MusicPlayerState = {
  tracks: MusicTrack[];
  currentTrack: MusicTrack | null;
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
};

const listeners = new Set<() => void>();
let state: MusicPlayerState = {
  tracks: [],
  currentTrack: null,
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

function readBoolean(key: string) {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function readRepeatMode(): MusicRepeatMode {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.repeat);
    return value === "all" || value === "one" ? value : "off";
  } catch {
    return "off";
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
          album: "MVP Trainer",
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
  if (context?.state === "suspended") {
    await context.resume();
  }
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

    const currentSource = audio.dataset.trackId;
    if (currentSource !== track.id || audio.src !== url) {
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

export async function loadMusicLibrary(force = false) {
  if (state.loading) return state.tracks;
  if (state.libraryLoaded && !force) return state.tracks;

  emit({ loading: true, error: null });
  try {
    const tracks = await listMusicTracks();
    let currentTrack = state.currentTrack;

    if (currentTrack) {
      currentTrack = tracks.find((track) => track.id === currentTrack?.id) ?? null;
    }

    if (!currentTrack) {
      let savedId = "";
      try {
        savedId = localStorage.getItem(STORAGE_KEYS.currentTrackId) ?? "";
      } catch {
        savedId = "";
      }
      currentTrack = tracks.find((track) => track.id === savedId) ?? tracks[0] ?? null;
    }

    emit({
      tracks,
      currentTrack,
      loading: false,
      libraryLoaded: true,
      error: null,
    });
    configureMediaSession();
    return tracks;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load your music library.";
    emit({ loading: false, libraryLoaded: true, error: message });
    return [];
  }
}

export function replaceMusicLibrary(tracks: MusicTrack[]) {
  const currentTrack = state.currentTrack
    ? tracks.find((track) => track.id === state.currentTrack?.id) ?? null
    : tracks[0] ?? null;

  if (state.currentTrack && !currentTrack) stopMusic();
  emit({ tracks, currentTrack, libraryLoaded: true });
  configureMediaSession();
}

export async function playMusicTrack(trackId: string, startAt = 0) {
  if (!state.libraryLoaded) await loadMusicLibrary();
  const track = state.tracks.find((item) => item.id === trackId);
  if (!track) throw new Error("Song not found in your music library.");

  await unlockMusicAudio();
  await loadTrack(track, startAt);
  const audio = ensureAudioElement();
  await audio.play();
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
    let savedTime = 0;
    try {
      savedTime = Number(localStorage.getItem(STORAGE_KEYS.currentTime) ?? 0);
    } catch {
      savedTime = 0;
    }
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
    audio.currentTime = 0;
    emit({ currentTime: 0 });
    return;
  }

  if (!state.libraryLoaded) await loadMusicLibrary();
  const index = nextSequentialIndex(-1);
  if (index < 0) {
    audio.currentTime = 0;
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
