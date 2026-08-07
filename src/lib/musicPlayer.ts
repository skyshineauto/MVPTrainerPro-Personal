import { useSyncExternalStore } from "react";
import {
  clearMusicUrlCache,
  getMusicArtworkSignedUrl,
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

export type MusicRepeatMode = "off" | "one" | "all";
export type MusicCustomPresetSlot = "custom_1" | "custom_2" | "custom_3";
export type MusicEqPreset =
  | "flat"
  | "power"
  | "rock"
  | "hard_rock"
  | "metal"
  | "alternative"
  | "pop"
  | "hip_hop"
  | "edm"
  | "bass_boost"
  | "deep_bass"
  | "punch"
  | "vocal"
  | "acoustic"
  | "warm"
  | "bright"
  | "late_night"
  | "headphones"
  | MusicCustomPresetSlot
  | "custom";
export type MusicDuckingStrength = "off" | "light" | "standard" | "strong";
export type MusicHeadphoneMode =
  | "off"
  | "wide"
  | "spatial"
  | "stage"
  | "focus"
  | "bass_impact";

export const MUSIC_EQ_FREQUENCIES = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500,
  630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000,
  10000, 12500, 16000, 20000,
] as const;

const LEGACY_EQ_FREQUENCIES = [
  60, 120, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000,
] as const;

type BuiltInMusicEqPreset = Exclude<
  MusicEqPreset,
  "custom" | MusicCustomPresetSlot
>;

type EqDefinition = { label: string; gains: number[]; preamp: number };

function interpolateEqCurve(points: Array<[number, number]>) {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  return MUSIC_EQ_FREQUENCIES.map((frequency) => {
    if (frequency <= sorted[0][0]) return sorted[0][1];
    if (frequency >= sorted[sorted.length - 1][0]) return sorted[sorted.length - 1][1];

    for (let index = 0; index < sorted.length - 1; index += 1) {
      const [leftHz, leftGain] = sorted[index];
      const [rightHz, rightGain] = sorted[index + 1];
      if (frequency < leftHz || frequency > rightHz) continue;

      const left = Math.log(leftHz);
      const right = Math.log(rightHz);
      const current = Math.log(frequency);
      const ratio = (current - left) / Math.max(0.0001, right - left);
      return Math.round((leftGain + (rightGain - leftGain) * ratio) * 10) / 10;
    }

    return 0;
  });
}

function preset(label: string, preamp: number, points: Array<[number, number]>): EqDefinition {
  return { label, preamp, gains: interpolateEqCurve(points) };
}

export const MUSIC_EQ_PRESETS: Record<BuiltInMusicEqPreset, EqDefinition> = {
  flat: preset("Flat", 0, [[20, 0], [20000, 0]]),
  power: preset("Power Training", -2.5, [[20, 3], [50, 5], [100, 4], [250, 1], [500, -1], [1000, 0], [2500, 2], [5000, 4], [10000, 3], [20000, 1]]),
  rock: preset("Rock", -2.5, [[20, 2], [63, 4], [160, 3], [500, -1], [1000, 0], [2500, 2], [5000, 4.5], [10000, 4], [20000, 2]]),
  hard_rock: preset("Hard Rock", -3, [[20, 2], [63, 4.5], [125, 3.5], [400, -1.5], [1000, 0], [2500, 3], [5000, 5], [10000, 4], [20000, 1.5]]),
  metal: preset("Metal", -3.5, [[20, 2.5], [63, 4], [160, 2.5], [400, -2], [800, -1], [2000, 2.5], [4000, 5], [8000, 5.5], [16000, 3], [20000, 1]]),
  alternative: preset("Alternative", -2, [[20, 1], [80, 3], [200, 2], [500, -1], [1250, 0.5], [3150, 3], [6300, 3.5], [12500, 2], [20000, 0]]),
  pop: preset("Pop", -2, [[20, 1], [80, 2.5], [250, 0.5], [630, -0.5], [1600, 1.5], [4000, 3], [8000, 3], [16000, 1.5], [20000, 0]]),
  hip_hop: preset("Hip-Hop", -3.5, [[20, 4], [40, 6], [80, 5], [160, 3], [400, -1], [1000, 0], [2500, 1], [6300, 2], [12500, 1], [20000, 0]]),
  edm: preset("EDM", -4, [[20, 5], [40, 7], [80, 5], [200, 1], [500, -1], [1250, 0], [3150, 2], [6300, 4], [10000, 5], [16000, 3], [20000, 1]]),
  bass_boost: preset("Bass Boost", -3.5, [[20, 5], [40, 6], [63, 6], [100, 5], [160, 3], [250, 1], [500, 0], [20000, 0]]),
  deep_bass: preset("Deep Bass", -4.5, [[20, 7], [31.5, 8], [50, 7], [80, 5], [125, 3], [250, 1], [500, 0], [20000, 0]]),
  punch: preset("Punch", -3, [[20, 1], [50, 3], [80, 5], [125, 4], [200, 2], [500, -1], [1000, 0], [3150, 2.5], [6300, 2], [20000, 0]]),
  vocal: preset("Vocal Clarity", -1.5, [[20, -3], [100, -2], [250, -0.5], [630, 1], [1250, 2.5], [2500, 4.5], [4000, 4], [8000, 1.5], [16000, 0], [20000, -1]]),
  acoustic: preset("Acoustic", -1.5, [[20, -2], [80, 0], [200, 1], [500, 0.5], [1000, 1], [2500, 2.5], [5000, 3], [10000, 2], [20000, 0]]),
  warm: preset("Warm", -1.5, [[20, 1], [80, 2.5], [250, 2], [630, 1], [1600, 0], [4000, -1], [10000, -2], [20000, -2.5]]),
  bright: preset("Bright", -2.5, [[20, -1], [100, 0], [500, 0], [1250, 1], [3150, 2.5], [6300, 4], [12500, 4], [20000, 2.5]]),
  late_night: preset("Late Night", -4, [[20, 1], [63, 2], [160, 1], [630, 0], [2500, -1], [5000, -2], [10000, -4], [20000, -6]]),
  headphones: preset("Headphones", -2, [[20, 1], [63, 2], [200, 0.5], [630, -0.5], [1600, 1], [4000, 2], [8000, 1.5], [16000, 0], [20000, -1]]),
};

export const MUSIC_HEADPHONE_MODES: Record<
  MusicHeadphoneMode,
  { label: string; width: number; depth: number; crossfeed: number; center: number; bass: number }
> = {
  off: { label: "Off", width: 0, depth: 0, crossfeed: 0, center: 50, bass: 0 },
  wide: { label: "Wide", width: 68, depth: 20, crossfeed: 8, center: 42, bass: 8 },
  spatial: { label: "Spatial", width: 76, depth: 48, crossfeed: 15, center: 55, bass: 12 },
  stage: { label: "Stage", width: 55, depth: 32, crossfeed: 24, center: 68, bass: 8 },
  focus: { label: "Focus", width: 34, depth: 18, crossfeed: 18, center: 86, bass: 5 },
  bass_impact: { label: "Bass Impact", width: 48, depth: 22, crossfeed: 10, center: 62, bass: 42 },
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
  crossfadeSeconds: number;
  normalizationEnabled: boolean;
  limiterEnabled: boolean;
  duckingStrength: MusicDuckingStrength;
  headphoneMode: MusicHeadphoneMode;
  headphoneWidth: number;
  headphoneDepth: number;
  headphoneCrossfeed: number;
  headphoneCenter: number;
  headphoneBassImpact: number;
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
  crossfadeSeconds: "mvp_music_crossfade_seconds",
  normalizationEnabled: "mvp_music_normalization_enabled",
  limiterEnabled: "mvp_music_limiter_enabled",
  duckingStrength: "mvp_music_ducking_strength",
  headphoneMode: "mvp_music_headphone_mode",
  headphoneWidth: "mvp_music_headphone_width",
  headphoneDepth: "mvp_music_headphone_depth",
  headphoneCrossfeed: "mvp_music_headphone_crossfeed",
  headphoneCenter: "mvp_music_headphone_center",
  headphoneBassImpact: "mvp_music_headphone_bass_impact",
  custom1: "mvp_music_eq_custom_1",
  custom2: "mvp_music_eq_custom_2",
  custom3: "mvp_music_eq_custom_3",
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

function readNumber(key: string, fallback: number, min: number, max: number) {
  const value = Number(readStored(key));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function readRepeatMode(): MusicRepeatMode {
  const value = readStored(STORAGE_KEYS.repeat);
  return value === "one" ? "one" : "off";
}

function readDuckingStrength(): MusicDuckingStrength {
  const value = readStored(STORAGE_KEYS.duckingStrength);
  return value === "off" ||
    value === "light" ||
    value === "standard" ||
    value === "strong"
    ? value
    : "standard";
}

function isCustomPresetSlot(value: MusicEqPreset): value is MusicCustomPresetSlot {
  return value === "custom_1" || value === "custom_2" || value === "custom_3";
}

function isBuiltInPreset(value: MusicEqPreset): value is BuiltInMusicEqPreset {
  return Object.prototype.hasOwnProperty.call(MUSIC_EQ_PRESETS, value);
}

function customPresetStorageKey(slot: MusicCustomPresetSlot) {
  if (slot === "custom_1") return STORAGE_KEYS.custom1;
  if (slot === "custom_2") return STORAGE_KEYS.custom2;
  return STORAGE_KEYS.custom3;
}

function readCustomPreset(slot: MusicCustomPresetSlot): EqDefinition | null {
  try {
    const parsed = JSON.parse(readStored(customPresetStorageKey(slot)));
    if (
      parsed &&
      Array.isArray(parsed.gains) &&
      parsed.gains.length === MUSIC_EQ_FREQUENCIES.length &&
      parsed.gains.every((value: unknown) => Number.isFinite(Number(value))) &&
      Number.isFinite(Number(parsed.preamp))
    ) {
      return {
        label: slot === "custom_1" ? "Custom 1" : slot === "custom_2" ? "Custom 2" : "Custom 3",
        gains: parsed.gains.map((value: unknown) => Math.max(-12, Math.min(12, Number(value)))),
        preamp: Math.max(-12, Math.min(6, Number(parsed.preamp))),
      };
    }
  } catch {
    // Empty or legacy custom slot.
  }
  return null;
}

function readEqPreset(): MusicEqPreset {
  const value = readStored(STORAGE_KEYS.eqPreset) as MusicEqPreset;
  if (
    value === "custom" ||
    isCustomPresetSlot(value) ||
    Object.prototype.hasOwnProperty.call(MUSIC_EQ_PRESETS, value)
  ) {
    return value;
  }
  return "power";
}

function interpolateLegacyEqGains(values: number[]) {
  const points = LEGACY_EQ_FREQUENCIES.map((frequency, index) => [
    frequency,
    Math.max(-12, Math.min(12, Number(values[index] || 0))),
  ] as [number, number]);
  return interpolateEqCurve(points);
}

function readEqGains(presetName: MusicEqPreset) {
  try {
    const parsed = JSON.parse(readStored(STORAGE_KEYS.eqGains));
    if (Array.isArray(parsed) && parsed.every((value) => Number.isFinite(Number(value)))) {
      if (parsed.length === MUSIC_EQ_FREQUENCIES.length) {
        return parsed.map((value) => Math.max(-12, Math.min(12, Number(value))));
      }
      if (parsed.length === LEGACY_EQ_FREQUENCIES.length) {
        return interpolateLegacyEqGains(parsed.map(Number));
      }
    }
  } catch {
    // Use the selected preset below.
  }

  if (isCustomPresetSlot(presetName)) {
    return [...(readCustomPreset(presetName)?.gains ?? MUSIC_EQ_PRESETS.flat.gains)];
  }
  if (isBuiltInPreset(presetName)) return [...MUSIC_EQ_PRESETS[presetName].gains];
  return [...MUSIC_EQ_PRESETS.flat.gains];
}

function readPreamp(presetName: MusicEqPreset) {
  const value = Number(readStored(STORAGE_KEYS.preampDb));
  if (Number.isFinite(value)) return Math.max(-12, Math.min(6, value));
  if (isCustomPresetSlot(presetName)) return readCustomPreset(presetName)?.preamp ?? 0;
  return isBuiltInPreset(presetName) ? MUSIC_EQ_PRESETS[presetName].preamp : 0;
}

function readHeadphoneMode(): MusicHeadphoneMode {
  const value = readStored(STORAGE_KEYS.headphoneMode) as MusicHeadphoneMode;
  return Object.prototype.hasOwnProperty.call(MUSIC_HEADPHONE_MODES, value) ? value : "off";
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
  crossfadeSeconds: readNumber(
    STORAGE_KEYS.crossfadeSeconds,
    2,
    0,
    8
  ),
  normalizationEnabled: readBoolean(
    STORAGE_KEYS.normalizationEnabled,
    true
  ),
  limiterEnabled: readBoolean(STORAGE_KEYS.limiterEnabled, true),
  duckingStrength: readDuckingStrength(),
  headphoneMode: readHeadphoneMode(),
  headphoneWidth: readNumber(STORAGE_KEYS.headphoneWidth, 76, 0, 100),
  headphoneDepth: readNumber(STORAGE_KEYS.headphoneDepth, 48, 0, 100),
  headphoneCrossfeed: readNumber(STORAGE_KEYS.headphoneCrossfeed, 15, 0, 100),
  headphoneCenter: readNumber(STORAGE_KEYS.headphoneCenter, 55, 0, 100),
  headphoneBassImpact: readNumber(STORAGE_KEYS.headphoneBassImpact, 12, 0, 100),
};

let audioElement: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let mediaSource: MediaElementAudioSourceNode | null = null;
let preampGain: GainNode | null = null;
let equalizerFilters: BiquadFilterNode[] = [];
let normalizerNode: DynamicsCompressorNode | null = null;
let limiterNode: DynamicsCompressorNode | null = null;
let analyserNode: AnalyserNode | null = null;
let musicGain: GainNode | null = null;
let headphoneBassShelf: BiquadFilterNode | null = null;
let headphoneSplitter: ChannelSplitterNode | null = null;
let headphoneMerger: ChannelMergerNode | null = null;
let headphoneLeftDirect: GainNode | null = null;
let headphoneRightDirect: GainNode | null = null;
let headphoneLeftWidthCross: GainNode | null = null;
let headphoneRightWidthCross: GainNode | null = null;
let headphoneLeftCrossfeed: GainNode | null = null;
let headphoneRightCrossfeed: GainNode | null = null;
let headphoneLeftCrossDelay: DelayNode | null = null;
let headphoneRightCrossDelay: DelayNode | null = null;
let headphoneLeftCrossLowpass: BiquadFilterNode | null = null;
let headphoneRightCrossLowpass: BiquadFilterNode | null = null;
let mediaSourceConnected = false;
let loadingTrackId: string | null = null;
let timeSaveTimer = 0;
let recordedPlayToken = "";
let transportQueue: Promise<void> = Promise.resolve();
let outputGainBeforeDuck = 1;
let playbackIntent = false;
let recoveryAttempt = 0;
let stallTimer = 0;
let watchdogTimer = 0;
let lastWatchdogTime = 0;
let lastWatchdogPosition = 0;
let preloadedAudio: HTMLAudioElement | null = null;
let preloadedTrackId: string | null = null;
let preloadedTrackUrl: string | null = null;
let autoSkipDepth = 0;
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

function resetPreloadedAudio() {
  if (preloadedAudio) {
    preloadedAudio.removeAttribute("src");
    try {
      preloadedAudio.load();
    } catch {
      // Preloading is opportunistic.
    }
  }
  preloadedAudio = null;
  preloadedTrackId = null;
  preloadedTrackUrl = null;
}

function preloadUpcomingTrack() {
  const currentIndex = getCurrentIndex();
  if (currentIndex < 0 || state.tracks.length < 2) return;

  const nextTrack = state.shuffle
    ? null
    : state.tracks[(currentIndex + 1) % state.tracks.length];

  if (!nextTrack || nextTrack.id === state.currentTrack?.id) return;
  if (preloadedTrackId === nextTrack.id && preloadedAudio) return;

  void resolveTrackUrl(nextTrack)
    .then((url) => {
      if (state.currentTrack?.id === nextTrack.id) return;
      resetPreloadedAudio();
      const preload = new Audio();
      preload.preload = "auto";
      preload.crossOrigin = "anonymous";
      preload.muted = true;
      preload.src = url;
      preload.load();
      preloadedAudio = preload;
      preloadedTrackId = nextTrack.id;
      preloadedTrackUrl = url;
    })
    .catch(() => undefined);
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
    (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;

  if (!Context) return null;
  if (!audioContext) audioContext = new Context();
  return audioContext;
}

function dbToGain(db: number) {
  return Math.pow(10, db / 20);
}

function setCompressorBypass(node: DynamicsCompressorNode) {
  node.threshold.value = 0;
  node.knee.value = 0;
  node.ratio.value = 1;
  node.attack.value = 0.003;
  node.release.value = 0.12;
}

function setAudioParam(param: AudioParam, value: number, now: number, timeConstant = 0.025) {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, timeConstant);
}

function applyHeadphoneSettings(now: number) {
  if (!audioContext) return;

  const enabled = state.headphoneMode !== "off";
  const widthInput = enabled ? state.headphoneWidth : 0;
  const depthInput = enabled ? state.headphoneDepth : 0;
  const crossfeedInput = enabled ? state.headphoneCrossfeed : 0;
  const centerInput = enabled ? state.headphoneCenter : 50;
  const bassInput = enabled ? state.headphoneBassImpact : 0;

  const rawWidth = 1 + (widthInput / 100) * 0.58;
  const centerRetention = 1 - (centerInput / 100) * 0.34;
  const stereoWidth = enabled ? 1 + (rawWidth - 1) * centerRetention : 1;
  const directGain = (1 + stereoWidth) / 2;
  const widthCrossGain = (1 - stereoWidth) / 2;
  const crossfeedGain = enabled ? (crossfeedInput / 100) * 0.20 : 0;
  const crossfeedDelay = enabled ? 0.0003 + (depthInput / 100) * 0.0095 : 0;
  const bassDb = enabled ? (bassInput / 100) * 6.5 : 0;

  if (headphoneLeftDirect) setAudioParam(headphoneLeftDirect.gain, directGain, now);
  if (headphoneRightDirect) setAudioParam(headphoneRightDirect.gain, directGain, now);
  if (headphoneLeftWidthCross) setAudioParam(headphoneLeftWidthCross.gain, widthCrossGain, now);
  if (headphoneRightWidthCross) setAudioParam(headphoneRightWidthCross.gain, widthCrossGain, now);
  if (headphoneLeftCrossfeed) setAudioParam(headphoneLeftCrossfeed.gain, crossfeedGain, now);
  if (headphoneRightCrossfeed) setAudioParam(headphoneRightCrossfeed.gain, crossfeedGain, now);
  if (headphoneLeftCrossDelay) setAudioParam(headphoneLeftCrossDelay.delayTime, crossfeedDelay, now);
  if (headphoneRightCrossDelay) setAudioParam(headphoneRightCrossDelay.delayTime, crossfeedDelay, now);
  if (headphoneBassShelf) setAudioParam(headphoneBassShelf.gain, bassDb, now);
}

function applyProcessingSettings() {
  if (!audioContext || !mediaSourceConnected) return;
  const now = audioContext.currentTime;

  if (preampGain) {
    const target = state.eqEnabled ? dbToGain(state.preampDb) : 1;
    setAudioParam(preampGain.gain, target, now, 0.02);
  }

  equalizerFilters.forEach((filter, index) => {
    const gain = state.eqEnabled ? Number(state.eqGains[index] || 0) : 0;
    setAudioParam(filter.gain, gain, now, 0.02);
  });

  if (normalizerNode) {
    if (state.normalizationEnabled) {
      normalizerNode.threshold.value = -18;
      normalizerNode.knee.value = 18;
      normalizerNode.ratio.value = 3;
      normalizerNode.attack.value = 0.012;
      normalizerNode.release.value = 0.24;
    } else {
      setCompressorBypass(normalizerNode);
    }
  }

  applyHeadphoneSettings(now);

  if (limiterNode) {
    if (state.limiterEnabled) {
      limiterNode.threshold.value = -2;
      limiterNode.knee.value = 0;
      limiterNode.ratio.value = 20;
      limiterNode.attack.value = 0.002;
      limiterNode.release.value = 0.09;
    } else {
      setCompressorBypass(limiterNode);
    }
  }
}

function configureMediaSession() {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;

  const session = navigator.mediaSession;
  const current = state.currentTrack;

  const setMetadata = (artworkUrl?: string | null) => {
    if (state.currentTrack?.id !== current?.id) return;
    try {
      session.metadata = current
        ? new MediaMetadata({
            title: current.title,
            artist: current.artist || "MVP Trainer Music",
            album: current.album || state.activePlaylistName || "MVP Trainer",
            artwork: artworkUrl
              ? [
                  { src: artworkUrl, sizes: "512x512" },
                  { src: artworkUrl, sizes: "256x256" },
                ]
              : undefined,
          })
        : null;
    } catch {
      // Metadata is optional.
    }
  };

  setMetadata();
  if (current?.artwork_path) {
    void getMusicArtworkSignedUrl(current)
      .then((url) => setMetadata(url))
      .catch(() => undefined);
  }

  const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
    ["play", () => void playMusic()],
    ["pause", pauseMusic],
    ["previoustrack", () => void previousMusicTrack()],
    ["nexttrack", () => void nextMusicTrack()],
    ["stop", stopMusic],
    [
      "seekto",
      (details) => {
        if (typeof details.seekTime === "number") seekMusic(details.seekTime);
      },
    ],
  ];

  for (const [action, handler] of handlers) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Some browsers expose only part of Media Session.
    }
  }
}

function clearStallTimer() {
  if (stallTimer) {
    window.clearTimeout(stallTimer);
    stallTimer = 0;
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function safeAudioPlay(audio: HTMLAudioElement, attempts = 3) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await audio.play();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await wait(280 + attempt * 420);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Playback could not start.");
}

async function skipUnplayableCurrent(reason: string) {
  if (!playbackIntent || !state.tracks.length) return;

  autoSkipDepth += 1;
  if (autoSkipDepth > state.tracks.length) {
    playbackIntent = false;
    autoSkipDepth = 0;
    emit({
      playing: false,
      loading: false,
      error: "Playback stopped because the current queue could not be loaded.",
    });
    return;
  }

  const index = state.shuffle
    ? nextShuffleIndex()
    : (Math.max(0, getCurrentIndex()) + 1) % state.tracks.length;
  const nextTrack = state.tracks[index];
  if (!nextTrack) return;

  console.warn(`Skipping an unavailable music track after ${reason}:`, state.currentTrack?.title);
  try {
    await performPlayMusicTrack(nextTrack.id, 0);
  } catch {
    await skipUnplayableCurrent("automatic recovery failed");
  }
}

async function recoverCurrentPlayback(reason: string) {
  if (!playbackIntent || !state.currentTrack) return;
  if (recoveryAttempt >= 2) {
    recoveryAttempt = 0;
    await skipUnplayableCurrent(reason);
    return;
  }

  recoveryAttempt += 1;
  const track = state.currentTrack;
  const audio = ensureAudioElement();
  const resumeAt = Math.max(0, Number(audio.currentTime || state.currentTime || 0));

  try {
    signedUrlCache.delete(track.id);
    clearMusicUrlCache(track.id);
    const url = await resolveTrackUrl(track);
    if (!playbackIntent || state.currentTrack?.id !== track.id) return;

    audio.pause();
    recordedPlayToken = "";
    audio.src = url;
    audio.dataset.trackId = track.id;
    audio.load();

    await new Promise<void>((resolve) => {
      if (audio.readyState >= 2) {
        resolve();
        return;
      }
      const timeout = window.setTimeout(resolve, 2200);
      audio.addEventListener(
        "canplay",
        () => {
          window.clearTimeout(timeout);
          resolve();
        },
        { once: true }
      );
    });

    if (resumeAt > 0 && Number.isFinite(audio.duration)) {
      try {
        audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.2));
      } catch {
        // Resume from the browser's available position.
      }
    }

    await safeAudioPlay(audio, 2);
    recoveryAttempt = 0;
    autoSkipDepth = 0;
    preloadUpcomingTrack();
  } catch (error) {
    console.warn(`Music recovery attempt failed after ${reason}:`, error);
    if (recoveryAttempt >= 2) {
      recoveryAttempt = 0;
      await skipUnplayableCurrent(reason);
    } else {
      window.setTimeout(() => void recoverCurrentPlayback(reason), 650);
    }
  }
}

function schedulePlaybackRecovery(reason: string, delay = 4200) {
  if (!playbackIntent) return;
  clearStallTimer();
  stallTimer = window.setTimeout(() => {
    stallTimer = 0;
    void recoverCurrentPlayback(reason);
  }, delay);
}

function ensurePlaybackWatchdog(audio: HTMLAudioElement) {
  if (watchdogTimer) return;
  lastWatchdogTime = Date.now();
  lastWatchdogPosition = audio.currentTime || 0;

  watchdogTimer = window.setInterval(() => {
    if (!playbackIntent || audio.paused || audio.ended || !audio.src) {
      lastWatchdogTime = Date.now();
      lastWatchdogPosition = audio.currentTime || 0;
      return;
    }

    const position = audio.currentTime || 0;
    if (position > lastWatchdogPosition + 0.08) {
      lastWatchdogTime = Date.now();
      lastWatchdogPosition = position;
      return;
    }

    if (Date.now() - lastWatchdogTime > 6500) {
      lastWatchdogTime = Date.now();
      schedulePlaybackRecovery("playback watchdog detected a stall", 50);
    }
  }, 1800);
}

function ensureAudioElement() {
  if (audioElement) return audioElement;

  const audio = new Audio();
  audio.preload = "auto";
  audio.crossOrigin = "anonymous";

  audio.addEventListener("play", () => {
    clearStallTimer();
    recoveryAttempt = 0;
    autoSkipDepth = 0;
    lastWatchdogTime = Date.now();
    lastWatchdogPosition = audio.currentTime || 0;
    emit({ playing: true, loading: false, error: null });
    configureMediaSession();
    ensurePlaybackWatchdog(audio);

    const trackId = audio.dataset.trackId;
    const token = trackId ? `${trackId}:${audio.src}` : "";
    if (trackId && token !== recordedPlayToken) {
      recordedPlayToken = token;
      void recordMusicTrackPlayed(trackId).catch(() => undefined);
    }
  });

  audio.addEventListener("playing", () => {
    clearStallTimer();
    emit({ playing: true, loading: false, error: null });
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
    const position = audio.currentTime || 0;
    lastWatchdogTime = Date.now();
    lastWatchdogPosition = position;
    emit({ currentTime: position });
    savePlaybackPosition();
  });

  audio.addEventListener("canplay", clearStallTimer);
  audio.addEventListener("waiting", () => schedulePlaybackRecovery("audio buffering"));
  audio.addEventListener("stalled", () => schedulePlaybackRecovery("network stall"));
  audio.addEventListener("suspend", () => {
    if (playbackIntent && audio.readyState < 3) schedulePlaybackRecovery("browser suspended loading", 5200);
  });

  audio.addEventListener("ended", () => {
    clearStallTimer();
    recordedPlayToken = "";
    emit({ playing: false, currentTime: 0 });
    if (playbackIntent) void handleTrackEnded();
  });

  audio.addEventListener("error", () => {
    emit({ playing: false, loading: false, error: "Recovering music playback…" });
    if (playbackIntent) schedulePlaybackRecovery("audio element error", 250);
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
      filter.Q.value = 4.32;
      filter.gain.value = 0;
      return filter;
    });

    normalizerNode = context.createDynamicsCompressor();
    headphoneBassShelf = context.createBiquadFilter();
    headphoneBassShelf.type = "lowshelf";
    headphoneBassShelf.frequency.value = 95;
    headphoneSplitter = context.createChannelSplitter(2);
    headphoneMerger = context.createChannelMerger(2);
    headphoneLeftDirect = context.createGain();
    headphoneRightDirect = context.createGain();
    headphoneLeftWidthCross = context.createGain();
    headphoneRightWidthCross = context.createGain();
    headphoneLeftCrossfeed = context.createGain();
    headphoneRightCrossfeed = context.createGain();
    headphoneLeftCrossDelay = context.createDelay(0.03);
    headphoneRightCrossDelay = context.createDelay(0.03);
    headphoneLeftCrossLowpass = context.createBiquadFilter();
    headphoneRightCrossLowpass = context.createBiquadFilter();
    headphoneLeftCrossLowpass.type = "lowpass";
    headphoneRightCrossLowpass.type = "lowpass";
    headphoneLeftCrossLowpass.frequency.value = 700;
    headphoneRightCrossLowpass.frequency.value = 700;
    headphoneLeftCrossLowpass.Q.value = 0.7;
    headphoneRightCrossLowpass.Q.value = 0.7;

    limiterNode = context.createDynamicsCompressor();
    analyserNode = context.createAnalyser();
    analyserNode.fftSize = 2048;
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

    node.connect(normalizerNode);
    normalizerNode.connect(headphoneBassShelf);
    headphoneBassShelf.connect(headphoneSplitter);

    headphoneSplitter.connect(headphoneLeftDirect, 0);
    headphoneLeftDirect.connect(headphoneMerger, 0, 0);
    headphoneSplitter.connect(headphoneRightDirect, 1);
    headphoneRightDirect.connect(headphoneMerger, 0, 1);

    headphoneSplitter.connect(headphoneLeftWidthCross, 0);
    headphoneLeftWidthCross.connect(headphoneMerger, 0, 1);
    headphoneSplitter.connect(headphoneRightWidthCross, 1);
    headphoneRightWidthCross.connect(headphoneMerger, 0, 0);

    headphoneSplitter.connect(headphoneLeftCrossLowpass, 0);
    headphoneLeftCrossLowpass.connect(headphoneLeftCrossDelay);
    headphoneLeftCrossDelay.connect(headphoneLeftCrossfeed);
    headphoneLeftCrossfeed.connect(headphoneMerger, 0, 1);

    headphoneSplitter.connect(headphoneRightCrossLowpass, 1);
    headphoneRightCrossLowpass.connect(headphoneRightCrossDelay);
    headphoneRightCrossDelay.connect(headphoneRightCrossfeed);
    headphoneRightCrossfeed.connect(headphoneMerger, 0, 0);

    headphoneMerger.connect(limiterNode);
    limiterNode.connect(analyserNode);
    analyserNode.connect(musicGain);
    musicGain.connect(context.destination);

    mediaSourceConnected = true;
    applyProcessingSettings();
  } catch (error) {
    console.warn("Music processing connection unavailable; using direct audio output.", error);
  }
}

async function unlockMusicAudio() {
  connectMusicGraph();
  const context = getAudioContext();

  if (context?.state === "suspended") {
    await context.resume();
  }
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

  return (currentIndex + direction + count) % count;
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

  emit({
    loading: true,
    error: null,
    currentTrack: track,
  });

  savePlayerSetting(STORAGE_KEYS.currentTrackId, track.id);
  configureMediaSession();

  try {
    const url =
      preloadedTrackId === track.id && preloadedTrackUrl
        ? preloadedTrackUrl
        : await resolveTrackUrl(track);
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

    if (audio.readyState >= 1) {
      seekWhenReady();
    } else {
      audio.addEventListener("loadedmetadata", seekWhenReady, {
        once: true,
      });
    }

    if (preloadedTrackId === track.id) resetPreloadedAudio();
    emit({ loading: false, currentTime: startAt });
    preloadUpcomingTrack();
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load this song.";

    emit({
      loading: false,
      playing: false,
      error: message,
    });

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

    const byId = new Map(
      libraryTracks.map((track) => [track.id, track])
    );

    const tracks = links
      .map((link) => byId.get(link.track_id))
      .filter((track): track is MusicTrack => Boolean(track));

    if (!tracks.length) throw new Error("Playlist is empty.");

    return {
      tracks,
      playlistId: playlist.id,
      playlistName: playlist.name,
    };
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
      queue.tracks.find(
        (track) => track.id === state.currentTrack?.id
      ) ??
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

    emit({
      loading: false,
      libraryLoaded: true,
      error: message,
    });

    return [];
  }
}

export function replaceMusicLibrary(libraryTracks: MusicTrack[]) {
  const activeIds = new Set(
    state.tracks.map((track) => track.id)
  );

  const tracks = state.activePlaylistId
    ? libraryTracks.filter((track) => activeIds.has(track.id))
    : libraryTracks;

  const currentTrack = state.currentTrack
    ? tracks.find(
        (track) => track.id === state.currentTrack?.id
      ) ??
      tracks[0] ??
      null
    : tracks[0] ?? null;

  if (state.currentTrack && !currentTrack) stopMusic();

  emit({
    libraryTracks,
    tracks,
    currentTrack,
    libraryLoaded: true,
  });

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
    tracks.find(
      (track) => track.id === state.currentTrack?.id
    ) ??
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
    tracks.find((track) => track.id === startTrackId) ??
    tracks[0];

  if (!startTrack) {
    throw new Error(
      "Add songs to this playlist before playing it."
    );
  }

  await playMusicTrack(startTrack.id, 0);
}

function fadeGainTo(target: number, milliseconds: number) {
  if (!musicGain || !audioContext) return Promise.resolve();

  const now = audioContext.currentTime;
  const durationSeconds = Math.max(0.03, milliseconds / 1000);
  const safeTarget = Math.max(0.0001, target);

  musicGain.gain.cancelScheduledValues(now);
  musicGain.gain.setValueAtTime(
    Math.max(0.0001, musicGain.gain.value),
    now
  );
  musicGain.gain.linearRampToValueAtTime(
    safeTarget,
    now + durationSeconds
  );

  return new Promise<void>((resolve) =>
    window.setTimeout(resolve, milliseconds + 20)
  );
}

async function performPlayMusicTrack(
  trackId: string,
  startAt = 0
) {
  playbackIntent = true;
  if (!state.libraryLoaded) await loadMusicLibrary();

  const track =
    state.tracks.find((item) => item.id === trackId) ??
    state.libraryTracks.find((item) => item.id === trackId);

  if (!track) {
    throw new Error("Song not found in your music library.");
  }

  if (!state.tracks.some((item) => item.id === trackId)) {
    activateAllMusicTracks();
  }

  await unlockMusicAudio();

  const audio = ensureAudioElement();
  const changingTrack =
    Boolean(state.currentTrack) &&
    state.currentTrack?.id !== trackId &&
    !audio.paused;
  const fadeMilliseconds = Math.round(
    Math.max(0, state.crossfadeSeconds) * 1000
  );

  if (changingTrack && fadeMilliseconds > 0 && musicGain) {
    const half = Math.max(90, Math.round(fadeMilliseconds / 2));
    await fadeGainTo(0.0001, half);
    await loadTrack(track, startAt);
    await safeAudioPlay(audio);
    await fadeGainTo(1, half);
    return;
  }

  await loadTrack(track, startAt);
  await safeAudioPlay(audio);
}

export function playMusicTrack(
  trackId: string,
  startAt = 0
) {
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

  const audio = ensureAudioElement();
  const track = state.currentTrack ?? state.tracks[0] ?? null;

  if (!track) {
    emit({ error: "Upload music before pressing Play." });
    return;
  }

  if (audio.dataset.trackId !== track.id || !audio.src) {
    const savedTime = Number(
      readStored(STORAGE_KEYS.currentTime) || 0
    );

    await loadTrack(
      track,
      Number.isFinite(savedTime) ? savedTime : 0
    );
  }

  if (musicGain && musicGain.gain.value < 0.99) {
    await fadeGainTo(1, 180);
  }

  await safeAudioPlay(audio);
}

export function pauseMusic() {
  playbackIntent = false;
  clearStallTimer();
  ensureAudioElement().pause();
}

export function stopMusic() {
  playbackIntent = false;
  clearStallTimer();
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
    Math.min(
      Number(seconds) || 0,
      Math.max(0, duration || 0)
    )
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

  return Boolean(
    state.currentTrack && audio.currentTime < threshold
  );
}

export async function nextMusicTrack(fromEnded = false) {
  if (!state.libraryLoaded) await loadMusicLibrary();

  if (
    !fromEnded &&
    shouldRecordSkip() &&
    state.currentTrack
  ) {
    void recordMusicTrackSkipped(
      state.currentTrack.id
    ).catch(() => undefined);
  }

  const index = state.shuffle
    ? nextShuffleIndex()
    : nextSequentialIndex(1);

  if (index < 0) return;

  const track = state.tracks[index];
  if (!track) return;

  try {
    await playMusicTrack(track.id, 0);
  } catch (error) {
    if (playbackIntent || fromEnded) {
      console.warn("Automatic next-track playback failed; recovering.", error);
      await skipUnplayableCurrent("next-track transition");
    } else {
      throw error;
    }
  }
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
  const repeat: MusicRepeatMode = state.repeat === "one" ? "off" : "one";
  savePlayerSetting(STORAGE_KEYS.repeat, repeat);
  emit({ repeat });
}

export function setMusicEqEnabled(enabled: boolean) {
  savePlayerSetting(STORAGE_KEYS.eqEnabled, String(enabled));
  emit({ eqEnabled: enabled });
  applyProcessingSettings();
}

export function applyMusicEqPreset(presetName: MusicEqPreset) {
  if (presetName === "custom") {
    savePlayerSetting(STORAGE_KEYS.eqPreset, presetName);
    emit({ eqPreset: presetName });
    return;
  }

  const definition = isCustomPresetSlot(presetName)
    ? readCustomPreset(presetName)
    : isBuiltInPreset(presetName)
      ? MUSIC_EQ_PRESETS[presetName]
      : null;

  if (!definition) {
    emit({ error: "Save this custom EQ slot before loading it." });
    return;
  }

  const gains = [...definition.gains];
  savePlayerSetting(STORAGE_KEYS.eqPreset, presetName);
  savePlayerSetting(STORAGE_KEYS.eqGains, JSON.stringify(gains));
  savePlayerSetting(STORAGE_KEYS.preampDb, String(definition.preamp));

  emit({
    eqPreset: presetName,
    eqGains: gains,
    preampDb: definition.preamp,
    error: null,
  });
  applyProcessingSettings();
}

export function saveMusicEqCustomPreset(slot: MusicCustomPresetSlot) {
  const definition = {
    gains: [...state.eqGains],
    preamp: state.preampDb,
  };
  savePlayerSetting(customPresetStorageKey(slot), JSON.stringify(definition));
  savePlayerSetting(STORAGE_KEYS.eqPreset, slot);
  emit({ eqPreset: slot, error: null });
}

export function setMusicEqBand(index: number, gainDb: number) {
  if (
    index < 0 ||
    index >= MUSIC_EQ_FREQUENCIES.length
  ) {
    return;
  }

  const gains = [...state.eqGains];
  gains[index] = Math.max(
    -12,
    Math.min(12, Number(gainDb) || 0)
  );

  savePlayerSetting(STORAGE_KEYS.eqPreset, "custom");
  savePlayerSetting(
    STORAGE_KEYS.eqGains,
    JSON.stringify(gains)
  );

  emit({
    eqPreset: "custom",
    eqGains: gains,
  });

  applyProcessingSettings();
}

export function setMusicPreamp(preampDb: number) {
  const next = Math.max(
    -12,
    Math.min(6, Number(preampDb) || 0)
  );

  savePlayerSetting(STORAGE_KEYS.eqPreset, "custom");
  savePlayerSetting(STORAGE_KEYS.preampDb, String(next));

  emit({
    eqPreset: "custom",
    preampDb: next,
  });

  applyProcessingSettings();
}

export function setMusicCrossfadeSeconds(seconds: number) {
  const next = Math.max(
    0,
    Math.min(8, Number(seconds) || 0)
  );

  savePlayerSetting(
    STORAGE_KEYS.crossfadeSeconds,
    String(next)
  );

  emit({ crossfadeSeconds: next });
}

export function setMusicNormalizationEnabled(enabled: boolean) {
  savePlayerSetting(
    STORAGE_KEYS.normalizationEnabled,
    String(enabled)
  );

  emit({ normalizationEnabled: enabled });
  applyProcessingSettings();
}

export function setMusicLimiterEnabled(enabled: boolean) {
  savePlayerSetting(
    STORAGE_KEYS.limiterEnabled,
    String(enabled)
  );

  emit({ limiterEnabled: enabled });
  applyProcessingSettings();
}

export function setMusicDuckingStrength(
  strength: MusicDuckingStrength
) {
  savePlayerSetting(
    STORAGE_KEYS.duckingStrength,
    strength
  );

  emit({ duckingStrength: strength });
}

export function setMusicHeadphoneMode(mode: MusicHeadphoneMode) {
  const definition = MUSIC_HEADPHONE_MODES[mode] ?? MUSIC_HEADPHONE_MODES.off;
  savePlayerSetting(STORAGE_KEYS.headphoneMode, mode);
  savePlayerSetting(STORAGE_KEYS.headphoneWidth, String(definition.width));
  savePlayerSetting(STORAGE_KEYS.headphoneDepth, String(definition.depth));
  savePlayerSetting(STORAGE_KEYS.headphoneCrossfeed, String(definition.crossfeed));
  savePlayerSetting(STORAGE_KEYS.headphoneCenter, String(definition.center));
  savePlayerSetting(STORAGE_KEYS.headphoneBassImpact, String(definition.bass));
  emit({
    headphoneMode: mode,
    headphoneWidth: definition.width,
    headphoneDepth: definition.depth,
    headphoneCrossfeed: definition.crossfeed,
    headphoneCenter: definition.center,
    headphoneBassImpact: definition.bass,
  });
  applyProcessingSettings();
}

export function setMusicHeadphoneWidth(value: number) {
  const next = Math.max(0, Math.min(100, Number(value) || 0));
  savePlayerSetting(STORAGE_KEYS.headphoneWidth, String(next));
  emit({ headphoneWidth: next });
  applyProcessingSettings();
}

export function setMusicHeadphoneDepth(value: number) {
  const next = Math.max(0, Math.min(100, Number(value) || 0));
  savePlayerSetting(STORAGE_KEYS.headphoneDepth, String(next));
  emit({ headphoneDepth: next });
  applyProcessingSettings();
}

export function setMusicHeadphoneCrossfeed(value: number) {
  const next = Math.max(0, Math.min(100, Number(value) || 0));
  savePlayerSetting(STORAGE_KEYS.headphoneCrossfeed, String(next));
  emit({ headphoneCrossfeed: next });
  applyProcessingSettings();
}

export function setMusicHeadphoneCenter(value: number) {
  const next = Math.max(0, Math.min(100, Number(value) || 0));
  savePlayerSetting(STORAGE_KEYS.headphoneCenter, String(next));
  emit({ headphoneCenter: next });
  applyProcessingSettings();
}

export function setMusicHeadphoneBassImpact(value: number) {
  const next = Math.max(0, Math.min(100, Number(value) || 0));
  savePlayerSetting(STORAGE_KEYS.headphoneBassImpact, String(next));
  emit({ headphoneBassImpact: next });
  applyProcessingSettings();
}

export function getNextMusicTrackPreview() {
  if (!state.tracks.length) return null;

  if (state.shuffle) {
    return {
      track: null as MusicTrack | null,
      label: "Shuffle selection",
    };
  }

  const index = nextSequentialIndex(1);

  return {
    track: index >= 0 ? state.tracks[index] ?? null : null,
    label: index >= 0 ? state.tracks[index]?.title ?? "Next track" : "Next track",
  };
}

let visualizerEnvelope: number[] = [];

export function getMusicVisualizerLevels(barCount = 32) {
  const count = Math.max(
    8,
    Math.min(64, Math.floor(barCount))
  );

  if (visualizerEnvelope.length !== count) {
    visualizerEnvelope = Array(count).fill(0);
  }

  if (!analyserNode || !audioContext) {
    return visualizerEnvelope.map((value, index) => {
      const next = Math.max(
        0,
        value * 0.82 - index * 0.00015
      );

      visualizerEnvelope[index] = next;
      return next;
    });
  }

  const data = new Uint8Array(
    analyserNode.frequencyBinCount
  );

  analyserNode.getByteFrequencyData(data);

  const nyquist = audioContext.sampleRate / 2;
  const minHz = 35;
  const maxHz = Math.min(18000, nyquist * 0.92);
  const ratio = maxHz / minHz;
  const levels: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const lowHz =
      minHz * Math.pow(ratio, index / count);
    const highHz =
      minHz * Math.pow(ratio, (index + 1) / count);

    const lowBin = Math.max(
      0,
      Math.floor((lowHz / nyquist) * data.length)
    );

    const highBin = Math.max(
      lowBin + 1,
      Math.ceil((highHz / nyquist) * data.length)
    );

    let weightedTotal = 0;
    let weightTotal = 0;

    for (
      let bin = lowBin;
      bin < Math.min(highBin, data.length);
      bin += 1
    ) {
      const center = (lowBin + highBin - 1) / 2;
      const distance =
        Math.abs(bin - center) /
        Math.max(1, (highBin - lowBin) / 2);

      const weight =
        1 - Math.min(0.72, distance * 0.72);

      weightedTotal += data[bin] * weight;
      weightTotal += weight;
    }

    const raw = weightTotal
      ? weightedTotal / weightTotal / 255
      : 0;

    const lowFrequencyLift =
      index < count * 0.22 ? 1.13 : 1;

    const highFrequencyLift =
      index > count * 0.68 ? 1.18 : 1;

    const shaped = Math.min(
      1,
      Math.pow(
        raw * lowFrequencyLift * highFrequencyLift,
        0.82
      )
    );

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

function duckTargetForStrength(
  strength: MusicDuckingStrength
) {
  if (strength === "off") return 1;
  if (strength === "light") return 0.42;
  if (strength === "strong") return 0.07;
  return 0.16;
}

export async function playWithMusicDucked(
  playAlert: () => Promise<void>
) {
  const audio = ensureAudioElement();
  const wasPlaying =
    !audio.paused &&
    !audio.ended &&
    Boolean(audio.src);

  if (!wasPlaying || state.duckingStrength === "off") {
    await playAlert();
    return;
  }

  connectMusicGraph();

  if (musicGain && audioContext) {
    outputGainBeforeDuck = Math.max(
      0.0001,
      musicGain.gain.value || 1
    );

    try {
      await fadeGainTo(
        duckTargetForStrength(state.duckingStrength),
        220
      );

      await playAlert();
    } finally {
      await fadeGainTo(outputGainBeforeDuck || 1, 420);
    }

    return;
  }

  const originalVolume = audio.volume;

  try {
    audio.volume = Math.min(
      originalVolume,
      duckTargetForStrength(state.duckingStrength)
    );

    await playAlert();
  } finally {
    audio.volume = originalVolume;
  }
}

export function formatMusicTime(value: number) {
  const total = Math.max(
    0,
    Math.floor(Number(value) || 0)
  );

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
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot
  );
}
