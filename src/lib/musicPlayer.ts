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
export type MusicDspStatus = "active" | "bypassed" | "recovering" | "unavailable";
export type MusicHeadphoneMode = "off" | "wide" | "spatial" | "stage" | "focus" | "bass_impact";
export type MusicOutputProfile = "reference" | "car_hifi" | "headphones" | "speaker";

export const MUSIC_EQ_FREQUENCIES = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500,
  630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000,
  10000, 12500, 16000, 20000,
] as const;

const LEGACY_EQ_FREQUENCIES = [
  60, 120, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000,
] as const;

type BuiltInMusicEqPreset = Exclude<MusicEqPreset, "custom" | MusicCustomPresetSlot>;
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
      const ratio =
        (Math.log(frequency) - Math.log(leftHz)) /
        Math.max(0.0001, Math.log(rightHz) - Math.log(leftHz));
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
  wide: { label: "Wide", width: 62, depth: 14, crossfeed: 7, center: 42, bass: 6 },
  spatial: { label: "Spatial", width: 74, depth: 40, crossfeed: 15, center: 50, bass: 10 },
  stage: { label: "Stage", width: 56, depth: 34, crossfeed: 22, center: 62, bass: 8 },
  focus: { label: "Focus", width: 22, depth: 10, crossfeed: 16, center: 78, bass: 4 },
  bass_impact: { label: "Bass Impact", width: 44, depth: 22, crossfeed: 10, center: 58, bass: 42 },
};

export const MUSIC_OUTPUT_PROFILES: Record<
  MusicOutputProfile,
  { label: string; shortLabel: string; description: string }
> = {
  reference: {
    label: "Reference",
    shortLabel: "REF",
    description: "Minimal stereo path. EQ, spatial processing and limiter are bypassed.",
  },
  car_hifi: {
    label: "Car Hi-Fi / USB",
    shortLabel: "CAR HI-FI",
    description: "Clean stereo for a tuned car system. No crossfeed, widening, center-sum or compressor normalization.",
  },
  headphones: {
    label: "Headphones",
    shortLabel: "HEADPHONES",
    description: "31-band EQ plus optional headphone-only immersion processing.",
  },
  speaker: {
    label: "Bluetooth / Speaker",
    shortLabel: "SPEAKER",
    description: "Stereo EQ path without the headphone channel-matrix processing.",
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
  volume: number;
  eqEnabled: boolean;
  eqPreset: MusicEqPreset;
  eqGains: number[];
  preampDb: number;
  effectivePreampDb: number;
  autoHeadroomDb: number;
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
  outputProfile: MusicOutputProfile;
  dspBypass: boolean;
  dspStatus: MusicDspStatus;
};

const STORAGE_KEYS = {
  currentTrackId: "mvp_music_current_track_id",
  currentTime: "mvp_music_current_time",
  shuffle: "mvp_music_shuffle",
  repeat: "mvp_music_repeat",
  activePlaylistId: "mvp_music_active_playlist_id",
  activePlaylistName: "mvp_music_active_playlist_name",
  volume: "mvp_music_volume_v2",
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
  outputProfile: "mvp_music_output_profile_v12",
  dspBypass: "mvp_music_dsp_bypass",
  audioEngineVersion: "mvp_music_audio_engine_version",
  custom1: "mvp_music_eq_custom_1",
  custom2: "mvp_music_eq_custom_2",
  custom3: "mvp_music_eq_custom_3",
} as const;

const AUDIO_ENGINE_VERSION = "v12-fidelity-1";
const listeners = new Set<() => void>();

function readStored(key: string) {
  try {
    return typeof localStorage === "undefined" ? "" : localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function savePlayerSetting(key: string, value: string) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    /* optional */
  }
}
function removePlayerSetting(key: string) {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch {
    /* optional */
  }
}
function readBoolean(key: string, fallback = false) {
  const value = readStored(key);
  return value ? value === "true" : fallback;
}
function readNumber(key: string, fallback: number, min: number, max: number) {
  const raw = readStored(key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function readRepeatMode(): MusicRepeatMode {
  const value = readStored(STORAGE_KEYS.repeat);
  return value === "one" || value === "all" ? value : "off";
}
function readDuckingStrength(): MusicDuckingStrength {
  const value = readStored(STORAGE_KEYS.duckingStrength);
  return value === "off" || value === "light" || value === "standard" || value === "strong"
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
  return slot === "custom_1"
    ? STORAGE_KEYS.custom1
    : slot === "custom_2"
      ? STORAGE_KEYS.custom2
      : STORAGE_KEYS.custom3;
}
function readCustomPreset(slot: MusicCustomPresetSlot): EqDefinition | null {
  try {
    const raw = readStored(customPresetStorageKey(slot));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { gains?: unknown[]; preamp?: unknown };
    if (
      Array.isArray(parsed.gains) &&
      parsed.gains.length === MUSIC_EQ_FREQUENCIES.length &&
      parsed.gains.every((value) => Number.isFinite(Number(value))) &&
      Number.isFinite(Number(parsed.preamp))
    ) {
      return {
        label: slot === "custom_1" ? "Custom 1" : slot === "custom_2" ? "Custom 2" : "Custom 3",
        gains: parsed.gains.map((value) => Math.max(-12, Math.min(12, Number(value)))),
        preamp: Math.max(-12, Math.min(12, Number(parsed.preamp))),
      };
    }
  } catch {
    /* empty */
  }
  return null;
}
function readEqPreset(): MusicEqPreset {
  const value = readStored(STORAGE_KEYS.eqPreset) as MusicEqPreset;
  return value === "custom" || isCustomPresetSlot(value) || isBuiltInPreset(value) ? value : "flat";
}
function interpolateLegacyEqGains(values: number[]) {
  return interpolateEqCurve(
    LEGACY_EQ_FREQUENCIES.map(
      (frequency, index) =>
        [frequency, Math.max(-12, Math.min(12, Number(values[index] || 0)))] as [number, number],
    ),
  );
}
function readEqGains(presetName: MusicEqPreset) {
  try {
    const raw = readStored(STORAGE_KEYS.eqGains);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.every((value) => Number.isFinite(Number(value)))) {
      if (parsed.length === MUSIC_EQ_FREQUENCIES.length) {
        return parsed.map((value) => Math.max(-12, Math.min(12, Number(value))));
      }
      if (parsed.length === LEGACY_EQ_FREQUENCIES.length) return interpolateLegacyEqGains(parsed.map(Number));
    }
  } catch {
    /* preset below */
  }
  if (isCustomPresetSlot(presetName)) {
    return [...(readCustomPreset(presetName)?.gains ?? MUSIC_EQ_PRESETS.flat.gains)];
  }
  if (isBuiltInPreset(presetName)) return [...MUSIC_EQ_PRESETS[presetName].gains];
  return [...MUSIC_EQ_PRESETS.flat.gains];
}
function readPreamp(presetName: MusicEqPreset) {
  const raw = readStored(STORAGE_KEYS.preampDb);
  if (raw) {
    const value = Number(raw);
    if (Number.isFinite(value)) return Math.max(-12, Math.min(12, value));
  }
  if (isCustomPresetSlot(presetName)) return readCustomPreset(presetName)?.preamp ?? 0;
  return isBuiltInPreset(presetName) ? MUSIC_EQ_PRESETS[presetName].preamp : 0;
}
function readHeadphoneMode(): MusicHeadphoneMode {
  const value = readStored(STORAGE_KEYS.headphoneMode) as MusicHeadphoneMode;
  return Object.prototype.hasOwnProperty.call(MUSIC_HEADPHONE_MODES, value) ? value : "off";
}
function readOutputProfile(): MusicOutputProfile {
  const value = readStored(STORAGE_KEYS.outputProfile) as MusicOutputProfile;
  return value === "reference" || value === "car_hifi" || value === "headphones" || value === "speaker"
    ? value
    : "car_hifi";
}

function migrateAudioFidelitySettings() {
  if (readStored(STORAGE_KEYS.audioEngineVersion) === AUDIO_ENGINE_VERSION) return;
  const flat = MUSIC_EQ_PRESETS.flat;
  savePlayerSetting(STORAGE_KEYS.outputProfile, "car_hifi");
  savePlayerSetting(STORAGE_KEYS.eqEnabled, "true");
  savePlayerSetting(STORAGE_KEYS.eqPreset, "flat");
  savePlayerSetting(STORAGE_KEYS.eqGains, JSON.stringify(flat.gains));
  savePlayerSetting(STORAGE_KEYS.preampDb, "0");
  savePlayerSetting(STORAGE_KEYS.normalizationEnabled, "false");
  savePlayerSetting(STORAGE_KEYS.limiterEnabled, "true");
  savePlayerSetting(STORAGE_KEYS.headphoneMode, "off");
  savePlayerSetting(STORAGE_KEYS.headphoneWidth, "0");
  savePlayerSetting(STORAGE_KEYS.headphoneDepth, "0");
  savePlayerSetting(STORAGE_KEYS.headphoneCrossfeed, "0");
  savePlayerSetting(STORAGE_KEYS.headphoneCenter, "50");
  savePlayerSetting(STORAGE_KEYS.headphoneBassImpact, "0");
  savePlayerSetting(STORAGE_KEYS.dspBypass, "false");
  savePlayerSetting(STORAGE_KEYS.audioEngineVersion, AUDIO_ENGINE_VERSION);
}

migrateAudioFidelitySettings();
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
  volume: readNumber(STORAGE_KEYS.volume, 0.72, 0, 1),
  eqEnabled: readBoolean(STORAGE_KEYS.eqEnabled, true),
  eqPreset: initialPreset,
  eqGains: readEqGains(initialPreset),
  preampDb: readPreamp(initialPreset),
  effectivePreampDb: 0,
  autoHeadroomDb: 0,
  crossfadeSeconds: readNumber(STORAGE_KEYS.crossfadeSeconds, 0, 0, 8),
  normalizationEnabled: false,
  limiterEnabled: readBoolean(STORAGE_KEYS.limiterEnabled, true),
  duckingStrength: readDuckingStrength(),
  headphoneMode: readHeadphoneMode(),
  headphoneWidth: readNumber(STORAGE_KEYS.headphoneWidth, 0, 0, 100),
  headphoneDepth: readNumber(STORAGE_KEYS.headphoneDepth, 0, 0, 100),
  headphoneCrossfeed: readNumber(STORAGE_KEYS.headphoneCrossfeed, 0, 0, 100),
  headphoneCenter: readNumber(STORAGE_KEYS.headphoneCenter, 50, 0, 100),
  headphoneBassImpact: readNumber(STORAGE_KEYS.headphoneBassImpact, 0, 0, 100),
  outputProfile: readOutputProfile(),
  dspBypass: readBoolean(STORAGE_KEYS.dspBypass, false),
  dspStatus: "recovering",
};

let audioElement: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let mediaSource: MediaElementAudioSourceNode | null = null;
let masterVolumeGain: GainNode | null = null;
let referenceRouteGain: GainNode | null = null;
let preampGain: GainNode | null = null;
let equalizerFilters: BiquadFilterNode[] = [];
let eqRouteGain: GainNode | null = null;
let headphoneBassShelf: BiquadFilterNode | null = null;
let headphoneSplitter: ChannelSplitterNode | null = null;
let headphoneMerger: ChannelMergerNode | null = null;
let headphoneRouteGain: GainNode | null = null;
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
let headphoneCenterSum: GainNode | null = null;
let headphoneCenterLeft: GainNode | null = null;
let headphoneCenterRight: GainNode | null = null;
let mixBus: GainNode | null = null;
let limiterNode: DynamicsCompressorNode | null = null;
let analyserNode: AnalyserNode | null = null;
let musicGain: GainNode | null = null;
let analyserBuffer: Uint8Array<ArrayBuffer> | null = null;
let visualizerEnvelope = new Float32Array(64);
let mediaSourceConnected = false;
let loadingTrackId: string | null = null;
let timeSaveTimer = 0;
let recordedPlayToken = "";
let transportQueue: Promise<void> = Promise.resolve();
let playbackIntent = false;
let lastDspStatus: MusicDspStatus = "recovering";
let lastHeadroom = -1;
let lastEffectivePreamp = Number.NaN;
const signedUrlCache = new Map<string, { url: string; cachedAt: number }>();
const SIGNED_URL_TTL_MS = 8 * 60 * 1000;

function emit(patch: Partial<MusicPlayerState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
function getAudioContext() {
  if (typeof window === "undefined") return null;
  const Context =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  if (audioContext?.state === "closed") audioContext = null;
  if (!audioContext) audioContext = new Context();
  return audioContext;
}
function dbToGain(db: number) {
  return Math.pow(10, db / 20);
}
function volumeToGain(volume: number) {
  return Math.max(0, Math.min(1, Number(volume) || 0));
}
function setAudioParam(param: AudioParam, value: number, now: number, timeConstant = 0.018) {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, timeConstant);
}
function setCompressorBypass(node: DynamicsCompressorNode) {
  node.threshold.value = 0;
  node.knee.value = 0;
  node.ratio.value = 1;
  node.attack.value = 0.003;
  node.release.value = 0.12;
}
function effectiveEqEnabled() {
  return !state.dspBypass && state.outputProfile !== "reference" && state.eqEnabled;
}
function calculateHeadroom() {
  if (!effectiveEqEnabled()) return { effectivePreampDb: 0, autoHeadroomDb: 0 };
  const maxBoost = Math.max(0, ...state.eqGains.map((value) => Number(value) || 0));
  const requested = Math.max(-12, Math.min(12, Number(state.preampDb) || 0));
  const ceiling = maxBoost > 0.05 ? -(maxBoost + 1.0) : 0;
  const effectivePreampDb = Math.min(requested, ceiling);
  return {
    effectivePreampDb,
    autoHeadroomDb: Math.max(0, Math.round((requested - effectivePreampDb) * 10) / 10),
  };
}
function setDspTelemetry(status: MusicDspStatus, effectivePreampDb: number, autoHeadroomDb: number) {
  const roundedPreamp = Math.round(effectivePreampDb * 10) / 10;
  const roundedHeadroom = Math.round(autoHeadroomDb * 10) / 10;
  if (
    status === lastDspStatus &&
    roundedHeadroom === lastHeadroom &&
    roundedPreamp === lastEffectivePreamp
  ) {
    return;
  }
  lastDspStatus = status;
  lastHeadroom = roundedHeadroom;
  lastEffectivePreamp = roundedPreamp;
  emit({ dspStatus: status, effectivePreampDb: roundedPreamp, autoHeadroomDb: roundedHeadroom });
}

function applyHeadphoneSettings(now: number) {
  const enabled =
    !state.dspBypass && state.outputProfile === "headphones" && state.headphoneMode !== "off";
  const width = enabled ? state.headphoneWidth / 100 : 0;
  const depth = enabled ? state.headphoneDepth / 100 : 0;
  const crossfeed = enabled ? state.headphoneCrossfeed / 100 : 0;
  const center = enabled ? state.headphoneCenter / 100 : 0.5;
  const bass = enabled ? state.headphoneBassImpact / 100 : 0;

  // Conservative values preserve phase and transient clarity. Headphone-only path.
  const stereoWidth = enabled ? 1 + width * 0.55 : 1;
  const direct = (1 + stereoWidth) / 2;
  const widthCross = (1 - stereoWidth) / 2;
  const crossfeedGain = enabled ? crossfeed * 0.22 : 0;
  const crossDelay = enabled ? 0.00015 + depth * 0.006 : 0;
  const lowpassHz = enabled ? 1250 + (1 - depth) * 2450 : 3500;
  const centerGain = enabled ? Math.max(0, (center - 0.5) * 0.42) : 0;
  const centerAttenuation = enabled ? 1 - Math.max(0, center - 0.5) * 0.10 : 1;
  const bassDb = enabled ? bass * 5.5 : 0;

  if (headphoneLeftDirect) setAudioParam(headphoneLeftDirect.gain, direct * centerAttenuation, now);
  if (headphoneRightDirect) setAudioParam(headphoneRightDirect.gain, direct * centerAttenuation, now);
  if (headphoneLeftWidthCross) setAudioParam(headphoneLeftWidthCross.gain, widthCross, now);
  if (headphoneRightWidthCross) setAudioParam(headphoneRightWidthCross.gain, widthCross, now);
  if (headphoneLeftCrossfeed) setAudioParam(headphoneLeftCrossfeed.gain, crossfeedGain, now);
  if (headphoneRightCrossfeed) setAudioParam(headphoneRightCrossfeed.gain, crossfeedGain, now);
  if (headphoneLeftCrossDelay) setAudioParam(headphoneLeftCrossDelay.delayTime, crossDelay, now);
  if (headphoneRightCrossDelay) setAudioParam(headphoneRightCrossDelay.delayTime, crossDelay, now);
  if (headphoneLeftCrossLowpass) setAudioParam(headphoneLeftCrossLowpass.frequency, lowpassHz, now, 0.03);
  if (headphoneRightCrossLowpass) setAudioParam(headphoneRightCrossLowpass.frequency, lowpassHz, now, 0.03);
  if (headphoneCenterLeft) setAudioParam(headphoneCenterLeft.gain, centerGain, now);
  if (headphoneCenterRight) setAudioParam(headphoneCenterRight.gain, centerGain, now);
  if (headphoneBassShelf) setAudioParam(headphoneBassShelf.gain, bassDb, now);
}

function applyProcessingSettings() {
  if (!audioContext || !mediaSourceConnected) return;
  const now = audioContext.currentTime;
  const { effectivePreampDb, autoHeadroomDb } = calculateHeadroom();
  const reference = state.dspBypass || state.outputProfile === "reference";
  const headphones = !reference && state.outputProfile === "headphones";
  const eqOnly = !reference && !headphones;

  if (masterVolumeGain) setAudioParam(masterVolumeGain.gain, volumeToGain(state.volume), now, 0.01);
  if (referenceRouteGain) setAudioParam(referenceRouteGain.gain, reference ? 1 : 0, now, 0.008);
  if (eqRouteGain) setAudioParam(eqRouteGain.gain, eqOnly ? 1 : 0, now, 0.008);
  if (headphoneRouteGain) setAudioParam(headphoneRouteGain.gain, headphones ? 1 : 0, now, 0.008);

  if (preampGain) setAudioParam(preampGain.gain, dbToGain(effectivePreampDb), now, 0.016);
  equalizerFilters.forEach((filter, index) => {
    const gain = effectiveEqEnabled() ? Number(state.eqGains[index] || 0) : 0;
    setAudioParam(filter.gain, gain, now, 0.022);
  });
  applyHeadphoneSettings(now);

  if (limiterNode) {
    const limiterActive = !reference && state.limiterEnabled;
    if (limiterActive) {
      limiterNode.threshold.value = -0.8;
      limiterNode.knee.value = 0;
      limiterNode.ratio.value = 20;
      limiterNode.attack.value = 0.0015;
      limiterNode.release.value = 0.11;
    } else {
      setCompressorBypass(limiterNode);
    }
  }

  const status: MusicDspStatus =
    audioContext.state === "running" ? (reference ? "bypassed" : "active") : "recovering";
  setDspTelemetry(status, effectivePreampDb, autoHeadroomDb);
}

function disconnectNode(node: AudioNode | null) {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    /* already disconnected */
  }
}
function releaseGraph() {
  [
    mediaSource,
    masterVolumeGain,
    referenceRouteGain,
    preampGain,
    eqRouteGain,
    headphoneBassShelf,
    headphoneSplitter,
    headphoneMerger,
    headphoneRouteGain,
    headphoneLeftDirect,
    headphoneRightDirect,
    headphoneLeftWidthCross,
    headphoneRightWidthCross,
    headphoneLeftCrossfeed,
    headphoneRightCrossfeed,
    headphoneLeftCrossDelay,
    headphoneRightCrossDelay,
    headphoneLeftCrossLowpass,
    headphoneRightCrossLowpass,
    headphoneCenterSum,
    headphoneCenterLeft,
    headphoneCenterRight,
    mixBus,
    limiterNode,
    analyserNode,
    musicGain,
  ].forEach(disconnectNode);
  equalizerFilters.forEach(disconnectNode);
  mediaSource = null;
  masterVolumeGain = null;
  referenceRouteGain = null;
  preampGain = null;
  equalizerFilters = [];
  eqRouteGain = null;
  headphoneBassShelf = null;
  headphoneSplitter = null;
  headphoneMerger = null;
  headphoneRouteGain = null;
  headphoneLeftDirect = null;
  headphoneRightDirect = null;
  headphoneLeftWidthCross = null;
  headphoneRightWidthCross = null;
  headphoneLeftCrossfeed = null;
  headphoneRightCrossfeed = null;
  headphoneLeftCrossDelay = null;
  headphoneRightCrossDelay = null;
  headphoneLeftCrossLowpass = null;
  headphoneRightCrossLowpass = null;
  headphoneCenterSum = null;
  headphoneCenterLeft = null;
  headphoneCenterRight = null;
  mixBus = null;
  limiterNode = null;
  analyserNode = null;
  musicGain = null;
  analyserBuffer = null;
  mediaSourceConnected = false;
}

function connectMusicGraph() {
  const audio = ensureAudioElement();
  const context = getAudioContext();
  if (!context || mediaSourceConnected) return;
  try {
    mediaSource = context.createMediaElementSource(audio);
    masterVolumeGain = context.createGain();
    referenceRouteGain = context.createGain();
    preampGain = context.createGain();
    equalizerFilters = MUSIC_EQ_FREQUENCIES.map((frequency) => {
      const filter = context.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = Math.min(frequency, Math.max(20, context.sampleRate / 2 - 20));
      filter.Q.value = 1.05;
      filter.gain.value = 0;
      return filter;
    });
    eqRouteGain = context.createGain();
    headphoneBassShelf = context.createBiquadFilter();
    headphoneBassShelf.type = "lowshelf";
    headphoneBassShelf.frequency.value = 110;
    headphoneBassShelf.gain.value = 0;
    headphoneSplitter = context.createChannelSplitter(2);
    headphoneMerger = context.createChannelMerger(2);
    headphoneRouteGain = context.createGain();
    headphoneLeftDirect = context.createGain();
    headphoneRightDirect = context.createGain();
    headphoneLeftWidthCross = context.createGain();
    headphoneRightWidthCross = context.createGain();
    headphoneLeftCrossfeed = context.createGain();
    headphoneRightCrossfeed = context.createGain();
    headphoneLeftCrossDelay = context.createDelay(0.02);
    headphoneRightCrossDelay = context.createDelay(0.02);
    headphoneLeftCrossLowpass = context.createBiquadFilter();
    headphoneRightCrossLowpass = context.createBiquadFilter();
    headphoneLeftCrossLowpass.type = "lowpass";
    headphoneRightCrossLowpass.type = "lowpass";
    headphoneCenterSum = context.createGain();
    headphoneCenterSum.gain.value = 0.5;
    headphoneCenterLeft = context.createGain();
    headphoneCenterRight = context.createGain();
    mixBus = context.createGain();
    mixBus.gain.value = 1;
    limiterNode = context.createDynamicsCompressor();
    analyserNode = context.createAnalyser();
    analyserNode.fftSize = 4096;
    analyserNode.smoothingTimeConstant = 0.38;
    analyserNode.minDecibels = -92;
    analyserNode.maxDecibels = -10;
    musicGain = context.createGain();
    musicGain.gain.value = 1;

    // One deterministic source connection. Three mutually-exclusive routes are selected by gains.
    mediaSource.connect(masterVolumeGain);
    masterVolumeGain.connect(referenceRouteGain);
    referenceRouteGain.connect(mixBus);

    masterVolumeGain.connect(preampGain);
    let eqTail: AudioNode = preampGain;
    equalizerFilters.forEach((filter) => {
      eqTail.connect(filter);
      eqTail = filter;
    });
    eqTail.connect(eqRouteGain);
    eqRouteGain.connect(mixBus);

    eqTail.connect(headphoneBassShelf);
    headphoneBassShelf.connect(headphoneSplitter);
    headphoneSplitter.connect(headphoneLeftDirect, 0);
    headphoneLeftDirect.connect(headphoneMerger, 0, 0);
    headphoneSplitter.connect(headphoneRightDirect, 1);
    headphoneRightDirect.connect(headphoneMerger, 0, 1);
    headphoneSplitter.connect(headphoneLeftWidthCross, 0);
    headphoneLeftWidthCross.connect(headphoneMerger, 0, 1);
    headphoneSplitter.connect(headphoneRightWidthCross, 1);
    headphoneRightWidthCross.connect(headphoneMerger, 0, 0);
    headphoneSplitter.connect(headphoneLeftCrossDelay, 0);
    headphoneLeftCrossDelay.connect(headphoneLeftCrossLowpass);
    headphoneLeftCrossLowpass.connect(headphoneLeftCrossfeed);
    headphoneLeftCrossfeed.connect(headphoneMerger, 0, 1);
    headphoneSplitter.connect(headphoneRightCrossDelay, 1);
    headphoneRightCrossDelay.connect(headphoneRightCrossLowpass);
    headphoneRightCrossLowpass.connect(headphoneRightCrossfeed);
    headphoneRightCrossfeed.connect(headphoneMerger, 0, 0);
    headphoneSplitter.connect(headphoneCenterSum, 0);
    headphoneSplitter.connect(headphoneCenterSum, 1);
    headphoneCenterSum.connect(headphoneCenterLeft);
    headphoneCenterSum.connect(headphoneCenterRight);
    headphoneCenterLeft.connect(headphoneMerger, 0, 0);
    headphoneCenterRight.connect(headphoneMerger, 0, 1);
    headphoneMerger.connect(headphoneRouteGain);
    headphoneRouteGain.connect(mixBus);

    mixBus.connect(limiterNode);
    limiterNode.connect(analyserNode);
    analyserNode.connect(musicGain);
    musicGain.connect(context.destination);

    mediaSourceConnected = true;
    audio.volume = 1;
    applyProcessingSettings();
  } catch (error) {
    console.warn("Music Hi-Fi graph unavailable; browser will use direct audio output.", error);
    emit({ dspStatus: "unavailable" });
  }
}

async function unlockMusicAudio() {
  connectMusicGraph();
  const context = getAudioContext();
  if (context?.state === "suspended") await context.resume();
  if (mediaSourceConnected) applyProcessingSettings();
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
    /* optional */
  }
  if (current?.artwork_path || current?.external_artwork_url) {
    void getMusicArtworkSignedUrl(current)
      .then((url: string | null) => {
        if (!url || state.currentTrack?.id !== current.id) return;
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: current.title,
            artist: current.artist || "MVP Trainer Music",
            album: current.album || state.activePlaylistName || "MVP Trainer",
            artwork: [{ src: url, sizes: "512x512" }],
          });
        } catch {
          /* optional */
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
      /* partial support */
    }
  });
}

function savePlaybackPosition() {
  if (!audioElement || !state.currentTrack) return;
  const now = Date.now();
  if (now - timeSaveTimer < 1500) return;
  timeSaveTimer = now;
  savePlayerSetting(STORAGE_KEYS.currentTime, String(audioElement.currentTime || 0));
}

function ensureAudioElement() {
  if (audioElement) return audioElement;
  const audio = new Audio();
  audio.preload = "metadata";
  audio.crossOrigin = "anonymous";
  audio.volume = 1;
  audio.addEventListener("play", () => {
    playbackIntent = true;
    emit({ playing: true, error: null });
    configureMediaSession();
    const trackId = audio.dataset.trackId;
    const token = trackId ? `${trackId}:${audio.currentSrc || audio.src}` : "";
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
    const finishedId = state.currentTrack?.id;
    recordedPlayToken = "";
    emit({ playing: false, currentTime: 0 });
    if (finishedId) void recordMusicTrackCompleted(finishedId).catch(() => undefined);
    void handleTrackEnded();
  });
  audio.addEventListener("error", () => {
    if (!state.loading) emit({ playing: false, error: "COULDN'T PLAY THIS TRACK • RETRY" });
  });
  audioElement = audio;
  return audio;
}

async function resolveTrackUrl(track: MusicTrack, force = false) {
  const cached = signedUrlCache.get(track.id);
  if (!force && cached && Date.now() - cached.cachedAt < SIGNED_URL_TTL_MS) return cached.url;
  if (force) {
    signedUrlCache.delete(track.id);
    clearMusicUrlCache(track.id);
  }
  const url = await getMusicTrackSignedUrl(track);
  signedUrlCache.set(track.id, { url, cachedAt: Date.now() });
  return url;
}

async function assignTrackSource(track: MusicTrack, startAt: number, force: boolean) {
  const audio = ensureAudioElement();
  const url = await resolveTrackUrl(track, force);
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
    try {
      audio.currentTime =
        target > 0 && Number.isFinite(audio.duration)
          ? Math.min(target, Math.max(0, audio.duration - 0.25))
          : target;
    } catch {
      /* metadata may still settle */
    }
  };
  if (audio.readyState >= 1) seekWhenReady();
  else audio.addEventListener("loadedmetadata", seekWhenReady, { once: true });
}

async function loadTrack(track: MusicTrack, startAt = 0) {
  loadingTrackId = track.id;
  emit({ loading: true, error: null, currentTrack: track });
  savePlayerSetting(STORAGE_KEYS.currentTrackId, track.id);
  configureMediaSession();
  try {
    try {
      await assignTrackSource(track, startAt, false);
    } catch {
      await assignTrackSource(track, startAt, true);
    }
    if (loadingTrackId !== track.id) return;
    emit({ loading: false, currentTime: startAt, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load this song.";
    emit({ loading: false, playing: false, error: `COULDN'T PLAY THIS TRACK • ${message}` });
    throw error;
  } finally {
    if (loadingTrackId === track.id) loadingTrackId = null;
  }
}

function getCurrentIndex() {
  return state.currentTrack
    ? state.tracks.findIndex((track) => track.id === state.currentTrack?.id)
    : -1;
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
  const count = state.tracks.length;
  if (count <= 1) return count ? 0 : -1;
  const current = getCurrentIndex();
  let next = current;
  while (next === current) next = Math.floor(Math.random() * count);
  return next;
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
  } catch (error) {
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
  removePlayerSetting(STORAGE_KEYS.activePlaylistId);
  removePlayerSetting(STORAGE_KEYS.activePlaylistName);
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
  removePlayerSetting(STORAGE_KEYS.activePlaylistId);
  savePlayerSetting(STORAGE_KEYS.activePlaylistName, name);
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
  savePlayerSetting(STORAGE_KEYS.activePlaylistId, playlist.id);
  savePlayerSetting(STORAGE_KEYS.activePlaylistName, playlist.name);
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
  const audio = ensureAudioElement();
  const track = state.currentTrack ?? state.tracks[0] ?? null;
  if (!track) {
    emit({ error: "Upload music before pressing Play." });
    return;
  }
  if (audio.dataset.trackId !== track.id || !audio.src) {
    const saved = Number(readStored(STORAGE_KEYS.currentTime) || 0);
    await loadTrack(track, Number.isFinite(saved) ? saved : 0);
  }
  await audio.play();
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
    /* mobile */
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
    /* not ready */
  }
}

function shouldRecordSkip() {
  const audio = ensureAudioElement();
  const duration = Number.isFinite(audio.duration) ? audio.duration : state.duration;
  return Boolean(state.currentTrack && audio.currentTime < Math.max(30, (duration || 0) * 0.35));
}

export async function nextMusicTrack(fromEnded = false) {
  if (!state.libraryLoaded) await loadMusicLibrary();
  if (!fromEnded && shouldRecordSkip() && state.currentTrack) {
    void recordMusicTrackSkipped(state.currentTrack.id).catch(() => undefined);
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
  savePlayerSetting(STORAGE_KEYS.shuffle, String(shuffle));
  emit({ shuffle });
}

export function cycleMusicRepeat() {
  const repeat: MusicRepeatMode =
    state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
  savePlayerSetting(STORAGE_KEYS.repeat, repeat);
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
  const insertAt = Math.max(0, currentIndex + 1);
  without.splice(insertAt, 0, track);
  emit({ tracks: without });
}

export async function setPlayerMusicPreference(
  trackId: string,
  preference: "neutral" | "like" | "play_less",
) {
  const updated = await setMusicTrackPreference(trackId, preference);
  const patchTrack = (track: MusicTrack) => (track.id === trackId ? updated : track);
  emit({
    libraryTracks: state.libraryTracks.map(patchTrack),
    tracks: state.tracks.map(patchTrack),
    currentTrack: state.currentTrack?.id === trackId ? updated : state.currentTrack,
  });
  return updated;
}

export function setMusicVolume(value: number) {
  const next = Math.max(0, Math.min(1, Number(value) || 0));
  savePlayerSetting(STORAGE_KEYS.volume, String(next));
  emit({ volume: next });
  if (audioContext && mediaSourceConnected && masterVolumeGain) {
    setAudioParam(masterVolumeGain.gain, volumeToGain(next), audioContext.currentTime, 0.01);
  } else if (audioElement) {
    audioElement.volume = next;
  }
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
    savePlayerSetting(STORAGE_KEYS.eqPreset, presetName);
    emit({ eqPreset: presetName });
    return;
  }
  const gains = [...definition.gains];
  savePlayerSetting(STORAGE_KEYS.eqPreset, presetName);
  savePlayerSetting(STORAGE_KEYS.eqGains, JSON.stringify(gains));
  savePlayerSetting(STORAGE_KEYS.preampDb, String(definition.preamp));
  emit({ eqPreset: presetName, eqGains: gains, preampDb: definition.preamp });
  applyProcessingSettings();
}

export function saveMusicEqCustomPreset(slot: MusicCustomPresetSlot) {
  const definition: EqDefinition = {
    label: slot === "custom_1" ? "Custom 1" : slot === "custom_2" ? "Custom 2" : "Custom 3",
    gains: [...state.eqGains],
    preamp: state.preampDb,
  };
  savePlayerSetting(customPresetStorageKey(slot), JSON.stringify(definition));
  savePlayerSetting(STORAGE_KEYS.eqPreset, slot);
  emit({ eqPreset: slot });
}

export function setMusicEqBand(index: number, gainDb: number) {
  if (index < 0 || index >= MUSIC_EQ_FREQUENCIES.length) return;
  const gains = [...state.eqGains];
  gains[index] = Math.max(-12, Math.min(12, Number(gainDb) || 0));
  savePlayerSetting(STORAGE_KEYS.eqPreset, "custom");
  savePlayerSetting(STORAGE_KEYS.eqGains, JSON.stringify(gains));
  emit({ eqPreset: "custom", eqGains: gains });
  applyProcessingSettings();
}

export function setMusicPreamp(preampDb: number) {
  const next = Math.max(-12, Math.min(12, Number(preampDb) || 0));
  savePlayerSetting(STORAGE_KEYS.eqPreset, "custom");
  savePlayerSetting(STORAGE_KEYS.preampDb, String(next));
  emit({ eqPreset: "custom", preampDb: next });
  applyProcessingSettings();
}

export function setMusicCrossfadeSeconds(seconds: number) {
  const next = Math.max(0, Math.min(8, Number(seconds) || 0));
  savePlayerSetting(STORAGE_KEYS.crossfadeSeconds, String(next));
  emit({ crossfadeSeconds: next });
}

// Retained for API compatibility. Compressor-style normalization is intentionally disabled in V12.
export function setMusicNormalizationEnabled(_enabled: boolean) {
  savePlayerSetting(STORAGE_KEYS.normalizationEnabled, "false");
  emit({ normalizationEnabled: false });
}

export function setMusicLimiterEnabled(enabled: boolean) {
  savePlayerSetting(STORAGE_KEYS.limiterEnabled, String(enabled));
  emit({ limiterEnabled: enabled });
  applyProcessingSettings();
}

export function setMusicDuckingStrength(value: MusicDuckingStrength) {
  savePlayerSetting(STORAGE_KEYS.duckingStrength, value);
  emit({ duckingStrength: value });
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

function applyHeadphoneModeValues(mode: MusicHeadphoneMode) {
  const values = MUSIC_HEADPHONE_MODES[mode];
  savePlayerSetting(STORAGE_KEYS.headphoneMode, mode);
  savePlayerSetting(STORAGE_KEYS.headphoneWidth, String(values.width));
  savePlayerSetting(STORAGE_KEYS.headphoneDepth, String(values.depth));
  savePlayerSetting(STORAGE_KEYS.headphoneCrossfeed, String(values.crossfeed));
  savePlayerSetting(STORAGE_KEYS.headphoneCenter, String(values.center));
  savePlayerSetting(STORAGE_KEYS.headphoneBassImpact, String(values.bass));
  emit({
    headphoneMode: mode,
    headphoneWidth: values.width,
    headphoneDepth: values.depth,
    headphoneCrossfeed: values.crossfeed,
    headphoneCenter: values.center,
    headphoneBassImpact: values.bass,
  });
  applyProcessingSettings();
}
export function setMusicHeadphoneMode(mode: MusicHeadphoneMode) {
  applyHeadphoneModeValues(mode);
}
function setHeadphoneValue(
  key: keyof Pick<
    MusicPlayerState,
    | "headphoneWidth"
    | "headphoneDepth"
    | "headphoneCrossfeed"
    | "headphoneCenter"
    | "headphoneBassImpact"
  >,
  storageKey: string,
  value: number,
) {
  const next = Math.max(0, Math.min(100, Number(value) || 0));
  savePlayerSetting(storageKey, String(next));
  emit({ [key]: next } as Pick<MusicPlayerState, typeof key>);
  applyProcessingSettings();
}
export function setMusicHeadphoneWidth(value: number) {
  setHeadphoneValue("headphoneWidth", STORAGE_KEYS.headphoneWidth, value);
}
export function setMusicHeadphoneDepth(value: number) {
  setHeadphoneValue("headphoneDepth", STORAGE_KEYS.headphoneDepth, value);
}
export function setMusicHeadphoneCrossfeed(value: number) {
  setHeadphoneValue("headphoneCrossfeed", STORAGE_KEYS.headphoneCrossfeed, value);
}
export function setMusicHeadphoneCenter(value: number) {
  setHeadphoneValue("headphoneCenter", STORAGE_KEYS.headphoneCenter, value);
}
export function setMusicHeadphoneBassImpact(value: number) {
  setHeadphoneValue("headphoneBassImpact", STORAGE_KEYS.headphoneBassImpact, value);
}

export function setMusicOutputProfile(profile: MusicOutputProfile) {
  if (!Object.prototype.hasOwnProperty.call(MUSIC_OUTPUT_PROFILES, profile)) return;
  savePlayerSetting(STORAGE_KEYS.outputProfile, profile);
  savePlayerSetting(STORAGE_KEYS.dspBypass, "false");
  savePlayerSetting(STORAGE_KEYS.normalizationEnabled, "false");

  const patch: Partial<MusicPlayerState> = {
    outputProfile: profile,
    dspBypass: false,
    normalizationEnabled: false,
  };
  if (profile === "reference" || profile === "car_hifi" || profile === "speaker") {
    savePlayerSetting(STORAGE_KEYS.headphoneMode, "off");
    patch.headphoneMode = "off";
  }
  if (profile === "car_hifi") {
    // Car mode starts clean. The user can deliberately choose an EQ preset afterward.
    const flat = MUSIC_EQ_PRESETS.flat;
    savePlayerSetting(STORAGE_KEYS.eqEnabled, "true");
    savePlayerSetting(STORAGE_KEYS.eqPreset, "flat");
    savePlayerSetting(STORAGE_KEYS.eqGains, JSON.stringify(flat.gains));
    savePlayerSetting(STORAGE_KEYS.preampDb, "0");
    patch.eqEnabled = true;
    patch.eqPreset = "flat";
    patch.eqGains = [...flat.gains];
    patch.preampDb = 0;
  }
  emit(patch);
  applyProcessingSettings();
}

export function setMusicDspBypass(bypassed: boolean) {
  savePlayerSetting(STORAGE_KEYS.dspBypass, String(bypassed));
  emit({ dspBypass: bypassed });
  applyProcessingSettings();
}

export async function recoverMusicDsp() {
  try {
    await unlockMusicAudio();
    applyProcessingSettings();
  } catch {
    emit({ dspStatus: "unavailable" });
  }
}

export async function rebuildMusicAudioEngine() {
  const track = state.currentTrack;
  const wasPlaying = state.playing || playbackIntent;
  const position = state.currentTime;
  if (audioElement) {
    try {
      audioElement.pause();
      audioElement.removeAttribute("src");
      audioElement.load();
    } catch {
      /* ignore */
    }
  }
  releaseGraph();
  if (audioContext && audioContext.state !== "closed") {
    try {
      await audioContext.close();
    } catch {
      /* ignore */
    }
  }
  audioContext = null;
  audioElement = null;
  if (!track) return;
  await unlockMusicAudio();
  await loadTrack(track, position);
  if (wasPlaying) await ensureAudioElement().play();
}

export function getMusicVisualizerLevels(barCount = 10) {
  const count = Math.max(4, Math.min(64, Math.floor(barCount)));
  if (visualizerEnvelope.length !== count) visualizerEnvelope = new Float32Array(count);
  if (!analyserNode || !audioContext) {
    for (let index = 0; index < count; index += 1) {
      visualizerEnvelope[index] = Math.max(0, visualizerEnvelope[index] * 0.82 - index * 0.00015);
    }
    return Array.from(visualizerEnvelope);
  }
  if (!analyserBuffer || analyserBuffer.length !== analyserNode.frequencyBinCount) {
    const buffer = new ArrayBuffer(analyserNode.frequencyBinCount);
    analyserBuffer = new Uint8Array(buffer);
  }
  analyserNode.getByteFrequencyData(analyserBuffer);
  const data = analyserBuffer;
  const nyquist = audioContext.sampleRate / 2;
  const minHz = 35;
  const maxHz = Math.min(18000, nyquist * 0.92);
  const ratio = maxHz / minHz;
  for (let index = 0; index < count; index += 1) {
    const lowHz = minHz * Math.pow(ratio, index / count);
    const highHz = minHz * Math.pow(ratio, (index + 1) / count);
    const lowBin = Math.max(0, Math.floor((lowHz / nyquist) * data.length));
    const highBin = Math.max(lowBin + 1, Math.ceil((highHz / nyquist) * data.length));
    let total = 0;
    let peak = 0;
    let samples = 0;
    for (let bin = lowBin; bin < Math.min(highBin, data.length); bin += 1) {
      const value = data[bin];
      total += value;
      peak = Math.max(peak, value);
      samples += 1;
    }
    const average = samples ? total / samples : 0;
    const raw = Math.min(1, (average * 0.72 + peak * 0.28) / 210);
    const shaped = Math.pow(raw, 0.78);
    const previous = visualizerEnvelope[index] || 0;
    visualizerEnvelope[index] = state.playing
      ? shaped > previous
        ? previous + (shaped - previous) * 0.72
        : previous + (shaped - previous) * 0.24
      : Math.max(0, previous * 0.84 - 0.006);
  }
  return Array.from(visualizerEnvelope);
}

export function getMusicRtaLevels() {
  return getMusicVisualizerLevels(10);
}

function duckTargetForStrength(strength: MusicDuckingStrength) {
  return strength === "off" ? 1 : strength === "light" ? 0.5 : strength === "strong" ? 0.08 : 0.18;
}
function fadeOutputTo(target: number, milliseconds: number) {
  if (!musicGain || !audioContext) return Promise.resolve();
  const now = audioContext.currentTime;
  const seconds = Math.max(0.03, milliseconds / 1000);
  musicGain.gain.cancelScheduledValues(now);
  musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), now);
  musicGain.gain.linearRampToValueAtTime(Math.max(0.0001, target), now + seconds);
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds + 20));
}

export async function playWithMusicDucked(playAlert: () => Promise<void>) {
  const audio = ensureAudioElement();
  const wasPlaying = !audio.paused && !audio.ended && Boolean(audio.src);
  if (!wasPlaying || state.duckingStrength === "off") {
    await playAlert();
    return;
  }
  await unlockMusicAudio();
  if (musicGain && audioContext) {
    const original = Math.max(0.0001, musicGain.gain.value || 1);
    try {
      await fadeOutputTo(duckTargetForStrength(state.duckingStrength), 180);
      await playAlert();
    } finally {
      await fadeOutputTo(original, 360);
    }
    return;
  }
  const original = audio.volume;
  try {
    audio.volume = Math.min(original, duckTargetForStrength(state.duckingStrength));
    await playAlert();
  } finally {
    audio.volume = original;
  }
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
