import { useSyncExternalStore } from "react";
import {
  clearMusicUrlCache,
  getMusicArtworkSignedUrl,
  getMusicTrackSignedUrl,
  listMusicTracks,
  recordMusicTrackCompleted,
  recordMusicTrackPlayed,
  recordMusicTrackSkipped,
  setMusicTrackPreference,
  type MusicTrack,
} from "./musicStorage";
import {
  getMusicPlaylist,
  listMusicPlaylistTrackLinks,
  type MusicPlaylist,
} from "./playlistStorage";
import {
  adaptiveRadioQueueName,
  chooseAdaptiveNextTrack,
  chooseCycleSafeTrack,
  isAdaptiveRadioName,
  rememberPlaybackCycleTrack,
  startRadioSession,
  syncLikedSongsPlaylist,
  type MusicRadioMode,
} from "./musicIntelligence";

export type MusicRepeatMode = "off" | "one" | "all";
export type MusicExperienceMode = "pure" | "adaptive" | "power";

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
  volume: number;
  experienceMode: MusicExperienceMode;
};

const STORAGE_KEYS = {
  currentTrackId: "mvp_music_current_track_id",
  currentTime: "mvp_music_current_time",
  shuffle: "mvp_music_shuffle",
  repeat: "mvp_music_repeat",
  activePlaylistId: "mvp_music_active_playlist_id",
  activePlaylistName: "mvp_music_active_playlist_name",
  activeQueueTrackIds: "mvp_music_active_queue_track_ids_v1",
  volume: "mvp_music_volume_v2",
  experienceMode: "mvp_music_experience_mode_foundation_v1",
} as const;

const LEGACY_SOUND_KEYS = [
  "mvp_music_eq_enabled",
  "mvp_music_eq_preset",
  "mvp_music_eq_gains",
  "mvp_music_eq_topology_v13_8",
  "mvp_music_eq_preamp_db",
  "mvp_music_extreme_preamp_enabled_r79a",
  "mvp_music_extreme_preamp_db_r79a",
  "mvp_music_output_reserve_db_v10",
  "mvp_music_auto_makeup_v10",
  "mvp_music_parametric_enabled_v10",
  "mvp_music_parametric_bands_v10",
  "mvp_music_bass_engine_v10",
  "mvp_music_bass_sub_v10",
  "mvp_music_bass_punch_v10",
  "mvp_music_bass_body_v10",
  "mvp_music_bass_tightness_v10",
  "mvp_music_tone_engine_v10",
  "mvp_music_presence_v10",
  "mvp_music_clarity_v10",
  "mvp_music_air_v10",
  "mvp_music_deharsh_v10",
  "mvp_music_exciter_enabled_v10",
  "mvp_music_exciter_amount_v10",
  "mvp_music_sat_low_v10",
  "mvp_music_sat_mid_v10",
  "mvp_music_sat_high_v10",
  "mvp_music_stereo_field_v10",
  "mvp_music_stereo_width_v10",
  "mvp_music_center_focus_v10",
  "mvp_music_bass_mono_hz_v10",
  "mvp_music_dynamics_restore_v10",
  "mvp_music_dynamics_restore_amount_v10",
  "mvp_music_smart_dsp_v10",
  "mvp_music_smart_dsp_amount_v10",
  "mvp_music_hd_xpander_level_v1",
  "mvp_music_headphone_advanced_v10",
  "mvp_music_headphone_angle_v10",
  "mvp_music_headphone_distance_v10",
  "mvp_music_headphone_reflections_v10",
  "mvp_music_headphone_wet_v10",
  "mvp_music_sound_dna_enabled_v10",
  "mvp_music_sound_dna_profile_v10",
  "mvp_music_song_memory_enabled_v10",
  "mvp_music_song_memory_profiles_v10",
  "mvp_music_song_memory_baseline_v10",
  "mvp_music_crossfade_seconds",
  "mvp_music_transition_mode_v1",
  "mvp_music_volume_match_enabled_v1",
  "mvp_music_multiband_enabled_v13_9",
  "mvp_music_dynamic_eq_enabled_v1",
  "mvp_music_limiter_enabled",
  "mvp_music_headphone_mode",
  "mvp_music_headphone_width",
  "mvp_music_headphone_depth",
  "mvp_music_headphone_crossfeed",
  "mvp_music_headphone_center",
  "mvp_music_headphone_bass_impact",
  "mvp_music_output_profile_v12",
  "mvp_music_playback_mode_r82",
  "mvp_music_hd_loudness_mode_r82",
  "mvp_music_dsp_bypass",
  "mvp_music_audio_engine_version",
  "mvp_music_eq_custom_1",
  "mvp_music_eq_custom_2",
  "mvp_music_eq_custom_3",
  "mvp_music_dsp_profiles_v1",
] as const;

const LEGACY_SOUND_PREFIXES = [
  "mvp_music_broadcast_profile_v",
  "mvp_music_output_profile_state",
] as const;

const listeners = new Set<() => void>();
let audioElement: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let mediaSourceNode: MediaElementAudioSourceNode | null = null;
let modeWorkletNode: AudioWorkletNode | null = null;
let analyserNode: AnalyserNode | null = null;
let userVolumeNode: GainNode | null = null;
let graphPromise: Promise<void> | null = null;
let playbackIntent = false;
let loadingTrackId: string | null = null;
let recordedPlayToken = "";
let timeSaveAt = 0;
let mediaRecoveryInFlight = false;
let rtaBuffer: Uint8Array<ArrayBuffer> | null = null;

function readStored(key: string) {
  try {
    return typeof localStorage === "undefined" ? "" : localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function saveStored(key: string, value: string) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    // Optional local persistence only.
  }
}

function removeStored(key: string) {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch {
    // Optional local persistence only.
  }
}

function purgeLegacySoundState() {
  if (typeof localStorage === "undefined") return;
  try {
    LEGACY_SOUND_KEYS.forEach((key) => localStorage.removeItem(key));
    const remove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && LEGACY_SOUND_PREFIXES.some((prefix) => key.startsWith(prefix))) remove.push(key);
    }
    remove.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Old sound state is nonessential.
  }
}

function readRepeat(): MusicRepeatMode {
  const value = readStored(STORAGE_KEYS.repeat);
  return value === "one" || value === "all" ? value : "off";
}

function readExperienceMode(): MusicExperienceMode {
  const value = readStored(STORAGE_KEYS.experienceMode);
  return value === "adaptive" || value === "power" || value === "pure" ? value : "pure";
}

function readVolume() {
  const value = Number(readStored(STORAGE_KEYS.volume));
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.8;
}

purgeLegacySoundState();

let state: MusicPlayerState = {
  libraryTracks: [],
  tracks: [],
  currentTrack: null,
  activePlaylistId: null,
  activePlaylistName: null,
  loading: false,
  playing: false,
  currentTime: 0,
  duration: 0,
  shuffle: readStored(STORAGE_KEYS.shuffle) === "true",
  repeat: readRepeat(),
  error: null,
  libraryLoaded: false,
  volume: readVolume(),
  experienceMode: readExperienceMode(),
};

function emit(patch: Partial<MusicPlayerState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function ensureAudioElement() {
  if (audioElement) return audioElement;
  const audio = new Audio();
  audio.preload = "auto";
  audio.crossOrigin = "anonymous";
  audio.volume = 1;

  audio.addEventListener("play", () => {
    if (audio !== audioElement) return;
    playbackIntent = true;
    emit({ playing: true, error: null });
    configureMediaSession();
    const trackId = audio.dataset.trackId;
    const token = trackId ? `${trackId}:${audio.currentSrc || audio.src}` : "";
    if (trackId && token !== recordedPlayToken) {
      recordedPlayToken = token;
      rememberPlaybackCycleTrack(trackId);
      void recordMusicTrackPlayed(trackId).catch(() => undefined);
    }
  });

  audio.addEventListener("pause", () => {
    if (audio !== audioElement) return;
    emit({ playing: false });
  });

  audio.addEventListener("loadedmetadata", () => {
    if (audio !== audioElement) return;
    const duration = Number(audio.duration);
    emit({ duration: Number.isFinite(duration) ? duration : 0 });
  });

  audio.addEventListener("durationchange", () => {
    if (audio !== audioElement) return;
    const duration = Number(audio.duration);
    emit({ duration: Number.isFinite(duration) ? duration : 0 });
  });

  audio.addEventListener("timeupdate", () => {
    if (audio !== audioElement) return;
    const currentTime = Number(audio.currentTime || 0);
    emit({ currentTime });
    if (Date.now() - timeSaveAt >= 1500) {
      timeSaveAt = Date.now();
      saveStored(STORAGE_KEYS.currentTime, String(currentTime));
    }
  });

  audio.addEventListener("ended", () => {
    if (audio !== audioElement) return;
    const finishedId = state.currentTrack?.id;
    emit({ playing: false, currentTime: 0 });
    if (finishedId) void recordMusicTrackCompleted(finishedId).catch(() => undefined);
    void handleTrackEnded();
  });

  audio.addEventListener("error", () => {
    if (audio !== audioElement || mediaRecoveryInFlight || state.loading || !playbackIntent) return;
    const track = state.currentTrack;
    if (!track) return;
    const resumeAt = Math.max(0, Number(audio.currentTime || state.currentTime || 0));
    mediaRecoveryInFlight = true;
    void (async () => {
      try {
        await loadTrack(track, resumeAt, true);
        if (!playbackIntent || state.currentTrack?.id !== track.id) return;
        await ensureAudioElement().play();
      } catch {
        emit({ playing: false, loading: false, error: "COULDN'T PLAY THIS TRACK • RETRY" });
      } finally {
        mediaRecoveryInFlight = false;
      }
    })();
  });

  audioElement = audio;
  return audio;
}

function getAudioContext() {
  if (audioContext) return audioContext;
  const AudioContextCtor = window.AudioContext;
  audioContext = new AudioContextCtor({ latencyHint: "interactive" });
  return audioContext;
}

async function connectMusicGraph() {
  if (modeWorkletNode && analyserNode && userVolumeNode && mediaSourceNode) return;
  if (graphPromise) return graphPromise;

  graphPromise = (async () => {
    const context = getAudioContext();
    const audio = ensureAudioElement();

    await context.audioWorklet.addModule("/audio/mvpSoundModes.worklet.js?v=foundation-r1");

    const worklet = new AudioWorkletNode(context, "mvp-sound-modes", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.68;
    const volume = context.createGain();
    volume.gain.value = state.volume;
    const source = context.createMediaElementSource(audio);

    source.connect(worklet);
    worklet.connect(analyser);
    analyser.connect(volume);
    volume.connect(context.destination);

    mediaSourceNode = source;
    modeWorkletNode = worklet;
    analyserNode = analyser;
    userVolumeNode = volume;
    audio.volume = 1;
    worklet.port.postMessage({ type: "mode", mode: state.experienceMode });
  })();

  try {
    await graphPromise;
  } catch (error) {
    graphPromise = null;
    const message = error instanceof Error ? error.message : "AudioWorklet unavailable.";
    emit({ error: `MVP SOUND COULDN'T START • ${message}` });
    throw error;
  }
}

async function unlockMusicAudio() {
  await connectMusicGraph();
  const context = getAudioContext();
  if (context.state === "suspended") await context.resume();
}

async function resolveTrackUrl(track: MusicTrack, force = false) {
  if (force) clearMusicUrlCache(track.id);
  return getMusicTrackSignedUrl(track);
}

async function loadTrack(track: MusicTrack, startAt = 0, force = false) {
  loadingTrackId = track.id;
  emit({ loading: true, error: null, currentTrack: track });
  saveStored(STORAGE_KEYS.currentTrackId, track.id);
  configureMediaSession();

  try {
    const audio = ensureAudioElement();
    const url = await resolveTrackUrl(track, force);
    if (loadingTrackId !== track.id) return;

    if (audio.dataset.trackId !== track.id || audio.src !== url) {
      audio.pause();
      recordedPlayToken = "";
      audio.src = url;
      audio.dataset.trackId = track.id;
      audio.load();
      modeWorkletNode?.port.postMessage({ type: "reset" });
    }

    const seekWhenReady = () => {
      const target = Math.max(0, Number(startAt) || 0);
      try {
        audio.currentTime = Number.isFinite(audio.duration)
          ? Math.min(target, Math.max(0, audio.duration - 0.25))
          : target;
      } catch {
        // Metadata may still be settling.
      }
    };

    if (audio.readyState >= 1) seekWhenReady();
    else audio.addEventListener("loadedmetadata", seekWhenReady, { once: true });

    emit({ loading: false, currentTime: Math.max(0, Number(startAt) || 0), error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load this song.";
    emit({ loading: false, playing: false, error: `COULDN'T PLAY THIS TRACK • ${message}` });
    throw error;
  } finally {
    if (loadingTrackId === track.id) loadingTrackId = null;
  }
}

function getCurrentIndex() {
  return state.currentTrack ? state.tracks.findIndex((track) => track.id === state.currentTrack?.id) : -1;
}

function nextSequentialIndex(direction: 1 | -1) {
  const count = state.tracks.length;
  if (!count) return -1;
  const current = getCurrentIndex();
  if (current < 0) return direction === 1 ? 0 : count - 1;
  const next = current + direction;
  if (next >= 0 && next < count) return next;
  return state.repeat === "all" ? (direction === 1 ? 0 : count - 1) : -1;
}

function nextShuffleIndex() {
  if (!state.tracks.length) return -1;
  const next = chooseCycleSafeTrack(state.tracks, state.currentTrack?.id ?? null, false);
  return next ? state.tracks.findIndex((track) => track.id === next.id) : -1;
}

function shouldRecordSkip() {
  const audio = ensureAudioElement();
  const duration = Number.isFinite(audio.duration) ? audio.duration : state.duration;
  return Boolean(state.currentTrack && audio.currentTime < Math.max(30, (duration || 0) * 0.35));
}

async function handleTrackEnded() {
  if (state.repeat === "one" && state.currentTrack) {
    await playMusicTrack(state.currentTrack.id, 0);
    return;
  }
  await nextMusicTrack(true);
}

async function resolveSavedQueue(libraryTracks: MusicTrack[]) {
  const savedPlaylistId = readStored(STORAGE_KEYS.activePlaylistId);
  if (!savedPlaylistId) {
    const savedQueueName = readStored(STORAGE_KEYS.activePlaylistName);
    const savedQueueIdsRaw = readStored(STORAGE_KEYS.activeQueueTrackIds);
    if (savedQueueName && savedQueueIdsRaw) {
      try {
        const ids = JSON.parse(savedQueueIdsRaw);
        if (Array.isArray(ids) && ids.length) {
          const byId = new Map(libraryTracks.map((track) => [track.id, track]));
          const tracks = ids
            .map((id) => byId.get(String(id)))
            .filter((track): track is MusicTrack => Boolean(track));
          if (tracks.length) return { tracks, playlistId: null as string | null, playlistName: savedQueueName };
        }
      } catch {
        // Fall through to the whole library.
      }
    }
    removeStored(STORAGE_KEYS.activePlaylistName);
    removeStored(STORAGE_KEYS.activeQueueTrackIds);
    return { tracks: libraryTracks, playlistId: null as string | null, playlistName: null as string | null };
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
    removeStored(STORAGE_KEYS.activePlaylistId);
    removeStored(STORAGE_KEYS.activePlaylistName);
    removeStored(STORAGE_KEYS.activeQueueTrackIds);
    return { tracks: libraryTracks, playlistId: null as string | null, playlistName: null as string | null };
  }
}

export async function loadMusicLibrary(force = false) {
  if (state.loading) return state.libraryTracks;
  if (state.libraryLoaded && !force) return state.libraryTracks;
  emit({ loading: true, error: null });

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
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
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error || "");
      const transient = /lock broken|steal|navigator\.locks|aborterror|failed to fetch|networkerror/i.test(message);
      if (!transient || attempt === 5) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1500, 180 * 2 ** attempt)));
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Could not load your music library.";
  const hasCachedLibrary = Boolean(state.libraryTracks.length);
  emit({ loading: false, libraryLoaded: state.libraryLoaded || hasCachedLibrary, error: hasCachedLibrary ? null : message });
  return state.libraryTracks;
}

export function replaceMusicLibrary(libraryTracks: MusicTrack[]) {
  const byId = new Map(libraryTracks.map((track) => [track.id, track]));
  const hasScopedQueue = Boolean(state.activePlaylistId || state.activePlaylistName);
  const tracks = hasScopedQueue
    ? state.tracks.map((track) => byId.get(track.id) ?? track)
    : libraryTracks;
  const currentTrack = state.currentTrack
    ? tracks.find((track) => track.id === state.currentTrack?.id) ?? byId.get(state.currentTrack.id) ?? state.currentTrack
    : tracks[0] ?? null;
  emit({ libraryTracks, tracks, currentTrack, libraryLoaded: true });
  configureMediaSession();
}

export function activateAllMusicTracks() {
  removeStored(STORAGE_KEYS.activePlaylistId);
  removeStored(STORAGE_KEYS.activePlaylistName);
  removeStored(STORAGE_KEYS.activeQueueTrackIds);
  const currentTrack =
    state.libraryTracks.find((track) => track.id === state.currentTrack?.id) ??
    state.libraryTracks[0] ??
    null;
  emit({
    tracks: [...state.libraryTracks],
    currentTrack,
    activePlaylistId: null,
    activePlaylistName: null,
    error: null,
  });
  configureMediaSession();
}

export function activateMusicAdHocQueue(name: string, tracks: MusicTrack[]) {
  removeStored(STORAGE_KEYS.activePlaylistId);
  saveStored(STORAGE_KEYS.activePlaylistName, name);
  saveStored(STORAGE_KEYS.activeQueueTrackIds, JSON.stringify(tracks.map((track) => track.id)));
  const currentTrack = tracks.find((track) => track.id === state.currentTrack?.id) ?? tracks[0] ?? null;
  emit({
    tracks: [...tracks],
    currentTrack,
    activePlaylistId: null,
    activePlaylistName: name,
    error: tracks.length ? null : "This collection has no songs.",
  });
  configureMediaSession();
}

export async function playMusicAdHocQueue(name: string, tracks: MusicTrack[], startTrackId?: string) {
  activateMusicAdHocQueue(name, tracks);
  const start = tracks.find((track) => track.id === startTrackId) ?? tracks[0];
  if (start) await playMusicTrack(start.id, 0);
}

export function activateMusicPlaylistQueue(
  playlist: Pick<MusicPlaylist, "id" | "name">,
  tracks: MusicTrack[],
) {
  saveStored(STORAGE_KEYS.activePlaylistId, playlist.id);
  saveStored(STORAGE_KEYS.activePlaylistName, playlist.name);
  removeStored(STORAGE_KEYS.activeQueueTrackIds);
  const currentTrack = tracks.find((track) => track.id === state.currentTrack?.id) ?? tracks[0] ?? null;
  emit({
    tracks: [...tracks],
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
  startTrackId?: string,
) {
  activateMusicPlaylistQueue(playlist, tracks);
  const start = tracks.find((track) => track.id === startTrackId) ?? tracks[0];
  if (!start) throw new Error("Add songs to this playlist before playing it.");
  await playMusicTrack(start.id, 0);
}

async function performPlayMusicTrack(trackId: string, startAt = 0) {
  playbackIntent = true;
  if (!state.libraryLoaded) await loadMusicLibrary();
  const track =
    state.tracks.find((item) => item.id === trackId) ??
    state.libraryTracks.find((item) => item.id === trackId);
  if (!track) throw new Error("Song not found in your music library.");
  if (!state.tracks.some((item) => item.id === trackId)) activateAllMusicTracks();

  await unlockMusicAudio();
  await loadTrack(track, startAt);
  await ensureAudioElement().play();
}

let transportQueue: Promise<unknown> = Promise.resolve();

export function playMusicTrack(trackId: string, startAt = 0) {
  const operation = transportQueue
    .catch(() => undefined)
    .then(() => performPlayMusicTrack(trackId, startAt));
  transportQueue = operation.catch(() => undefined);
  return operation;
}

export async function playMusic() {
  playbackIntent = true;
  await unlockMusicAudio();
  if (!state.libraryLoaded) await loadMusicLibrary();

  const track = state.currentTrack ?? state.tracks[0] ?? null;
  if (!track) {
    emit({ error: "Upload music before pressing Play." });
    return;
  }

  const audio = ensureAudioElement();
  if (audio.dataset.trackId !== track.id || !audio.src) {
    const saved = Number(readStored(STORAGE_KEYS.currentTime) || 0);
    await loadTrack(track, Number.isFinite(saved) ? saved : 0);
  }
  await audio.play();
}

export function isMusicPlaying() {
  const audio = audioElement;
  return Boolean(audio && !audio.paused && !audio.ended && Boolean(audio.src));
}

export function pauseMusic() {
  playbackIntent = false;
  ensureAudioElement().pause();
}

export function stopMusic() {
  playbackIntent = false;
  const audio = ensureAudioElement();
  audio.pause();
  try {
    audio.currentTime = 0;
  } catch {
    // Mobile browser may not have metadata yet.
  }
  saveStored(STORAGE_KEYS.currentTime, "0");
  emit({ playing: false, currentTime: 0 });
}

export function seekMusic(seconds: number) {
  const audio = ensureAudioElement();
  const duration = Number.isFinite(audio.duration) ? audio.duration : state.duration;
  const next = Math.max(0, Math.min(Number(seconds) || 0, Math.max(0, duration || 0)));
  try {
    audio.currentTime = next;
    saveStored(STORAGE_KEYS.currentTime, String(next));
    emit({ currentTime: next });
  } catch {
    // Metadata not ready.
  }
}

export async function nextMusicTrack(fromEnded = false) {
  if (!state.libraryLoaded) await loadMusicLibrary();

  if (!fromEnded && shouldRecordSkip() && state.currentTrack) {
    void recordMusicTrackSkipped(state.currentTrack.id).catch(() => undefined);
  }

  if (state.currentTrack && isAdaptiveRadioName(state.activePlaylistName)) {
    const adaptive = chooseAdaptiveNextTrack(state.currentTrack, state.libraryTracks, { remember: false });
    if (adaptive) {
      await playMusicTrack(adaptive.id, 0);
      return;
    }
  }

  const index = state.shuffle ? nextShuffleIndex() : nextSequentialIndex(1);
  if (index < 0) {
    if (fromEnded) stopMusic();
    return;
  }

  const track = state.tracks[index];
  if (track) await playMusicTrack(track.id, 0);
}

export async function previousMusicTrack() {
  if (!state.libraryLoaded) await loadMusicLibrary();
  const audio = ensureAudioElement();
  if (audio.currentTime > 5 && state.currentTrack) {
    seekMusic(0);
    return;
  }
  const index = nextSequentialIndex(-1);
  if (index < 0) return;
  const track = state.tracks[index];
  if (track) await playMusicTrack(track.id, 0);
}

export function toggleMusicShuffle() {
  const shuffle = !state.shuffle;
  saveStored(STORAGE_KEYS.shuffle, String(shuffle));
  emit({ shuffle });
}

export function cycleMusicRepeat() {
  const repeat: MusicRepeatMode =
    state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
  saveStored(STORAGE_KEYS.repeat, repeat);
  emit({ repeat });
}

export function addMusicToQueue(trackId: string) {
  const track = state.libraryTracks.find((item) => item.id === trackId);
  if (!track || state.tracks.some((item) => item.id === trackId)) return;
  emit({ tracks: [...state.tracks, track] });
}

export function playMusicNext(trackId: string) {
  const track = state.libraryTracks.find((item) => item.id === trackId);
  if (!track) return;
  const without = state.tracks.filter((item) => item.id !== trackId);
  const currentIndex = state.currentTrack
    ? without.findIndex((item) => item.id === state.currentTrack?.id)
    : -1;
  without.splice(Math.max(0, currentIndex + 1), 0, track);
  emit({ tracks: without });
}

export function getNextMusicTrackPreview() {
  if (!state.tracks.length) return null;
  if (state.shuffle) return { track: null as MusicTrack | null, label: "Shuffle selection" };
  const index = nextSequentialIndex(1);
  return {
    track: index >= 0 ? state.tracks[index] ?? null : null,
    label: index >= 0 ? state.tracks[index]?.title ?? "Next track" : "End of queue",
  };
}

export async function setPlayerMusicPreference(
  trackId: string,
  preference: "neutral" | "like" | "play_less",
) {
  const wasCurrent = state.currentTrack?.id === trackId;
  const original =
    state.libraryTracks.find((track) => track.id === trackId) ??
    state.tracks.find((track) => track.id === trackId) ??
    (wasCurrent ? state.currentTrack : null);

  if (!original) throw new Error("Song not found in your music library.");

  const optimistic: MusicTrack = {
    ...original,
    favorite: preference === "like",
    play_less: preference === "play_less",
  };
  const optimisticPatch = (track: MusicTrack) => track.id === trackId ? optimistic : track;
  emit({
    libraryTracks: state.libraryTracks.map(optimisticPatch),
    tracks: state.tracks.map(optimisticPatch),
    currentTrack: wasCurrent ? optimistic : state.currentTrack,
  });

  try {
    const updated = await setMusicTrackPreference(trackId, preference);
    const patch = (track: MusicTrack) => track.id === trackId ? updated : track;
    const nextLibrary = state.libraryTracks.map(patch);
    emit({
      libraryTracks: nextLibrary,
      tracks: state.tracks.map(patch),
      currentTrack: wasCurrent ? updated : state.currentTrack,
    });

    void syncLikedSongsPlaylist(nextLibrary).catch(() => undefined);

    if (preference === "like" && wasCurrent) {
      const radio = startRadioSession(updated, nextLibrary, "more_like_this");
      activateMusicAdHocQueue(`Like Radio • ${updated.title}`, radio);
    }
    return updated;
  } catch (error) {
    const restore = (track: MusicTrack) => track.id === trackId ? original : track;
    emit({
      libraryTracks: state.libraryTracks.map(restore),
      tracks: state.tracks.map(restore),
      currentTrack: wasCurrent ? original : state.currentTrack,
    });
    throw error;
  }
}

export function startMvpNeuralRadio(
  seedTrackId: string,
  mode: MusicRadioMode = "more_like_this",
) {
  const seed = state.libraryTracks.find((track) => track.id === seedTrackId);
  if (!seed) throw new Error("Song not found in your music library.");
  const queue = startRadioSession(seed, state.libraryTracks, mode);
  activateMusicAdHocQueue(adaptiveRadioQueueName(seed, mode), queue);
  return queue;
}

export function getMusicPlayerSnapshot() {
  return state;
}

export function setMusicVolume(value: number) {
  const volume = Math.max(0, Math.min(1, Number(value) || 0));
  saveStored(STORAGE_KEYS.volume, String(volume));
  emit({ volume });

  if (userVolumeNode && audioContext) {
    const now = audioContext.currentTime;
    userVolumeNode.gain.cancelScheduledValues(now);
    userVolumeNode.gain.setTargetAtTime(volume, now, 0.01);
  }
}

export function setMusicExperienceMode(mode: MusicExperienceMode) {
  if (mode !== "pure" && mode !== "adaptive" && mode !== "power") return;
  saveStored(STORAGE_KEYS.experienceMode, mode);
  emit({ experienceMode: mode });
  modeWorkletNode?.port.postMessage({ type: "mode", mode });
}

export function getMusicRtaLevels() {
  const analyser = analyserNode;
  if (!analyser) return Array(10).fill(0);

  const count = analyser.frequencyBinCount;
  if (!rtaBuffer || rtaBuffer.length !== count) rtaBuffer = new Uint8Array(count);
  const buffer = rtaBuffer;
  analyser.getByteFrequencyData(buffer);

  const nyquist = (audioContext?.sampleRate ?? 48000) / 2;
  const centers = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  return centers.map((center, index) => {
    const previous = index === 0 ? 20 : Math.sqrt(centers[index - 1] * center);
    const next = index === centers.length - 1 ? Math.min(20000, nyquist) : Math.sqrt(center * centers[index + 1]);
    const start = Math.max(0, Math.floor(previous / nyquist * count));
    const end = Math.min(count - 1, Math.ceil(next / nyquist * count));
    let sum = 0;
    let bins = 0;
    for (let bin = start; bin <= end; bin += 1) {
      const normalized = (buffer[bin] ?? 0) / 255;
      sum += normalized * normalized;
      bins += 1;
    }
    return bins ? Math.sqrt(sum / bins) : 0;
  });
}

async function fadeUserVolume(target: number, milliseconds: number) {
  if (!userVolumeNode || !audioContext) return;
  const now = audioContext.currentTime;
  const seconds = Math.max(0, milliseconds) / 1000;
  const safeTarget = Math.max(0.0001, Math.min(1, target));
  userVolumeNode.gain.cancelScheduledValues(now);
  userVolumeNode.gain.setValueAtTime(Math.max(0.0001, userVolumeNode.gain.value), now);
  userVolumeNode.gain.linearRampToValueAtTime(safeTarget, now + seconds);
  await new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds + 20));
}

export async function playWithMusicDucked(playAlert: () => Promise<void>) {
  const audio = ensureAudioElement();
  const wasPlaying = !audio.paused && !audio.ended && Boolean(audio.src);
  if (!wasPlaying) {
    await playAlert();
    return;
  }

  await unlockMusicAudio();
  try {
    await fadeUserVolume(state.volume * 0.24, 160);
    await playAlert();
  } finally {
    await fadeUserVolume(state.volume, 320);
  }
}

function configureMediaSession() {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  const current = state.currentTrack;
  try {
    navigator.mediaSession.metadata = current
      ? new MediaMetadata({
          title: current.title,
          artist: current.artist || "MVP Trainer Music",
          album: current.album || state.activePlaylistName || "MVP Trainer",
        })
      : null;
  } catch {
    // Media Session is optional.
  }

  if (current?.artwork_path || current?.external_artwork_url) {
    void getMusicArtworkSignedUrl(current)
      .then((url) => {
        if (!url || state.currentTrack?.id !== current.id) return;
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: current.title,
            artist: current.artist || "MVP Trainer Music",
            album: current.album || state.activePlaylistName || "MVP Trainer",
            artwork: [{ src: url, sizes: "512x512" }],
          });
        } catch {
          // Optional browser integration.
        }
      })
      .catch(() => undefined);
  }

  const actions: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
    ["play", () => void playMusic()],
    ["pause", pauseMusic],
    ["previoustrack", () => void previousMusicTrack()],
    ["nexttrack", () => void nextMusicTrack()],
    ["stop", stopMusic],
    ["seekto", (details) => {
      if (typeof details.seekTime === "number") seekMusic(details.seekTime);
    }],
  ];

  actions.forEach(([action, handler]) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Partial browser support.
    }
  });
}

export function formatMusicTime(value: number) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
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
