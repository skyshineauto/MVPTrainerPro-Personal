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
export type MusicDspEngineMode = "advanced_worklet" | "native_fallback" | "unavailable";
export type MusicImmersionStatus = "active" | "native_fallback" | "bypassed" | "unavailable";
export type MusicDspVerificationMode = "off" | "eq" | "spatial";
export type MusicEqTopology = "minimum_phase" | "linear_phase";
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

function userOffsetPreset(label: string): EqDefinition {
  return { label, preamp: 0, gains: MUSIC_EQ_FREQUENCIES.map(() => 0) };
}

export const MUSIC_EQ_PRESETS: Record<BuiltInMusicEqPreset, EqDefinition> = {
  flat: userOffsetPreset("Flat"),
  power: userOffsetPreset("Power Training"),
  rock: userOffsetPreset("Rock"),
  hard_rock: userOffsetPreset("Hard Rock"),
  metal: userOffsetPreset("Metal"),
  alternative: userOffsetPreset("Alternative"),
  pop: userOffsetPreset("Pop"),
  hip_hop: userOffsetPreset("Hip-Hop"),
  edm: userOffsetPreset("EDM"),
  bass_boost: userOffsetPreset("Bass Boost"),
  deep_bass: userOffsetPreset("Deep Bass"),
  punch: userOffsetPreset("Punch"),
  vocal: userOffsetPreset("Vocal Clarity"),
  acoustic: userOffsetPreset("Acoustic"),
  warm: userOffsetPreset("Warm"),
  bright: userOffsetPreset("Bright"),
  late_night: userOffsetPreset("Late Night"),
  headphones: userOffsetPreset("Headphones"),
};

type ProPeak = { frequency: number; gain: number; q: number };
type ProPresetDefinition = {
  highpassHz: number;
  lowShelfHz: number;
  lowShelfDb: number;
  peaks: ProPeak[];
  highShelfHz: number;
  highShelfDb: number;
  makeupDb: number;
  transientAmount: number;
};

type OutputTuningDefinition = {
  highpassHz: number;
  lowShelfHz: number;
  lowShelfDb: number;
  presenceHz: number;
  presenceDb: number;
  presenceQ: number;
  clarityHz: number;
  clarityDb: number;
  clarityQ: number;
  highShelfHz: number;
  highShelfDb: number;
  makeupDb: number;
};

const PRO_PRESET_DEFAULT: ProPresetDefinition = {
  highpassHz: 18,
  lowShelfHz: 90,
  lowShelfDb: 0,
  peaks: [],
  highShelfHz: 12000,
  highShelfDb: 0,
  makeupDb: 0,
  transientAmount: 0,
};

const DSP_EQ_PROOF_PRESET: ProPresetDefinition = {
  highpassHz: 28,
  lowShelfHz: 100,
  lowShelfDb: -5.5,
  peaks: [
    { frequency: 300, gain: -5.0, q: 0.9 },
    { frequency: 1000, gain: -10.0, q: 0.82 },
    { frequency: 3500, gain: 7.0, q: 0.95 },
    { frequency: 7600, gain: 5.0, q: 1.0 },
  ],
  highShelfHz: 11000,
  highShelfDb: 3.0,
  makeupDb: 0,
  transientAmount: 0,
};

// V13.8 tonal engine. These are intentionally moderate, mastering-style curves.
// The 120–350 Hz body region is preserved; output profiles no longer carry a second heavy EQ curve.
const MUSIC_PRO_PRESETS: Record<BuiltInMusicEqPreset, ProPresetDefinition> = {
  flat: { ...PRO_PRESET_DEFAULT },
  power: { highpassHz: 22, lowShelfHz: 90, lowShelfDb: 1.2, peaks: [{ frequency: 285, gain: -0.8, q: 0.9 }, { frequency: 1250, gain: 0.7, q: 0.85 }, { frequency: 2100, gain: 1.2, q: 0.95 }, { frequency: 3400, gain: 2.2, q: 1.05 }, { frequency: 6200, gain: 1.2, q: 1.0 }], highShelfHz: 12000, highShelfDb: 0.7, makeupDb: 0.15, transientAmount: 0.72 },
  rock: { highpassHz: 20, lowShelfHz: 88, lowShelfDb: 0.7, peaks: [{ frequency: 290, gain: -0.8, q: 0.86 }, { frequency: 1250, gain: 0.5, q: 0.82 }, { frequency: 1900, gain: 0.9, q: 0.9 }, { frequency: 3300, gain: 1.8, q: 1.0 }, { frequency: 6200, gain: 0.8, q: 0.95 }], highShelfHz: 12000, highShelfDb: 0.55, makeupDb: 0.10, transientAmount: 0.46 },
  hard_rock: { highpassHz: 20, lowShelfHz: 86, lowShelfDb: 1.0, peaks: [{ frequency: 285, gain: -1.0, q: 0.9 }, { frequency: 900, gain: 0.35, q: 0.8 }, { frequency: 1800, gain: 1.15, q: 0.9 }, { frequency: 3200, gain: 2.25, q: 1.03 }, { frequency: 5400, gain: 1.05, q: 1.0 }], highShelfHz: 12000, highShelfDb: 0.65, makeupDb: 0.10, transientAmount: 0.68 },
  metal: { highpassHz: 22, lowShelfHz: 82, lowShelfDb: 0.6, peaks: [{ frequency: 330, gain: -1.15, q: 0.9 }, { frequency: 650, gain: -0.45, q: 0.88 }, { frequency: 1500, gain: 0.65, q: 0.88 }, { frequency: 2450, gain: 1.45, q: 1.0 }, { frequency: 4200, gain: 2.25, q: 1.08 }], highShelfHz: 12000, highShelfDb: 0.45, makeupDb: 0.05, transientAmount: 0.76 },
  alternative: { highpassHz: 20, lowShelfHz: 90, lowShelfDb: 0.45, peaks: [{ frequency: 310, gain: -0.7, q: 0.85 }, { frequency: 1200, gain: 0.55, q: 0.82 }, { frequency: 2700, gain: 1.35, q: 0.96 }, { frequency: 5200, gain: 0.65, q: 0.95 }], highShelfHz: 12000, highShelfDb: 0.4, makeupDb: 0.10, transientAmount: 0.38 },
  pop: { highpassHz: 20, lowShelfHz: 90, lowShelfDb: 0.6, peaks: [{ frequency: 300, gain: -0.55, q: 0.85 }, { frequency: 1200, gain: 0.55, q: 0.82 }, { frequency: 3000, gain: 1.35, q: 0.96 }, { frequency: 7000, gain: 0.95, q: 0.95 }], highShelfHz: 12000, highShelfDb: 0.7, makeupDb: 0.10, transientAmount: 0.34 },
  hip_hop: { highpassHz: 18, lowShelfHz: 68, lowShelfDb: 2.0, peaks: [{ frequency: 120, gain: 0.65, q: 0.9 }, { frequency: 320, gain: -0.65, q: 0.82 }, { frequency: 2200, gain: 0.65, q: 0.86 }, { frequency: 6500, gain: 0.7, q: 0.9 }], highShelfHz: 12000, highShelfDb: 0.25, makeupDb: 0, transientAmount: 0.28 },
  edm: { highpassHz: 18, lowShelfHz: 62, lowShelfDb: 2.2, peaks: [{ frequency: 110, gain: 0.7, q: 0.92 }, { frequency: 300, gain: -0.65, q: 0.88 }, { frequency: 1800, gain: 0.6, q: 0.86 }, { frequency: 3600, gain: 1.15, q: 0.95 }, { frequency: 7600, gain: 1.15, q: 0.95 }], highShelfHz: 12000, highShelfDb: 0.65, makeupDb: 0, transientAmount: 0.50 },
  bass_boost: { highpassHz: 18, lowShelfHz: 72, lowShelfDb: 2.8, peaks: [{ frequency: 110, gain: 0.9, q: 0.86 }, { frequency: 250, gain: 0.15, q: 0.8 }], highShelfHz: 12000, highShelfDb: 0, makeupDb: -0.05, transientAmount: 0.16 },
  deep_bass: { highpassHz: 16, lowShelfHz: 48, lowShelfDb: 3.6, peaks: [{ frequency: 75, gain: 1.0, q: 0.86 }, { frequency: 145, gain: 0.25, q: 0.8 }], highShelfHz: 12000, highShelfDb: 0, makeupDb: -0.10, transientAmount: 0.12 },
  punch: { highpassHz: 20, lowShelfHz: 92, lowShelfDb: 1.35, peaks: [{ frequency: 115, gain: 1.2, q: 1.0 }, { frequency: 300, gain: -0.85, q: 0.9 }, { frequency: 2850, gain: 1.45, q: 0.98 }, { frequency: 6200, gain: 0.75, q: 0.95 }], highShelfHz: 12000, highShelfDb: 0.35, makeupDb: 0.05, transientAmount: 0.82 },
  vocal: { highpassHz: 24, lowShelfHz: 105, lowShelfDb: -0.6, peaks: [{ frequency: 300, gain: -0.7, q: 0.82 }, { frequency: 850, gain: 0.7, q: 0.82 }, { frequency: 1550, gain: 1.15, q: 0.88 }, { frequency: 2800, gain: 1.55, q: 0.96 }, { frequency: 4300, gain: 0.7, q: 0.95 }], highShelfHz: 12000, highShelfDb: 0.35, makeupDb: 0.05, transientAmount: 0.20 },
  acoustic: { highpassHz: 20, lowShelfHz: 100, lowShelfDb: 0.15, peaks: [{ frequency: 190, gain: 0.45, q: 0.8 }, { frequency: 750, gain: 0.3, q: 0.8 }, { frequency: 1400, gain: 0.55, q: 0.85 }, { frequency: 2800, gain: 1.0, q: 0.92 }, { frequency: 5500, gain: 0.55, q: 0.92 }], highShelfHz: 12000, highShelfDb: 0.55, makeupDb: 0.05, transientAmount: 0.24 },
  warm: { highpassHz: 18, lowShelfHz: 105, lowShelfDb: 1.0, peaks: [{ frequency: 280, gain: 0.45, q: 0.8 }, { frequency: 4200, gain: -0.65, q: 0.88 }], highShelfHz: 10500, highShelfDb: -0.9, makeupDb: 0.05, transientAmount: 0.08 },
  bright: { highpassHz: 20, lowShelfHz: 95, lowShelfDb: -0.15, peaks: [{ frequency: 2600, gain: 0.9, q: 0.88 }, { frequency: 6500, gain: 1.35, q: 0.95 }], highShelfHz: 12000, highShelfDb: 1.2, makeupDb: 0, transientAmount: 0.20 },
  late_night: { highpassHz: 18, lowShelfHz: 95, lowShelfDb: 0.3, peaks: [{ frequency: 2800, gain: -0.65, q: 0.86 }, { frequency: 5500, gain: -0.85, q: 0.9 }], highShelfHz: 10500, highShelfDb: -1.4, makeupDb: -0.15, transientAmount: 0.04 },
  headphones: { highpassHz: 18, lowShelfHz: 95, lowShelfDb: 0.25, peaks: [{ frequency: 300, gain: -0.45, q: 0.82 }, { frequency: 1700, gain: 0.65, q: 0.86 }, { frequency: 3900, gain: 1.0, q: 0.96 }, { frequency: 8200, gain: 0.45, q: 0.95 }], highShelfHz: 12000, highShelfDb: 0.45, makeupDb: 0.05, transientAmount: 0.20 },
};

// Output profiles are technical device paths, not a second musical EQ.
const MUSIC_OUTPUT_TUNINGS: Record<Exclude<MusicOutputProfile, "reference">, OutputTuningDefinition> = {
  car_hifi: { highpassHz: 18, lowShelfHz: 80, lowShelfDb: 0.15, presenceHz: 320, presenceDb: 0, presenceQ: 0.82, clarityHz: 3000, clarityDb: 0.15, clarityQ: 0.9, highShelfHz: 12000, highShelfDb: 0.10, makeupDb: 0 },
  headphones: { highpassHz: 18, lowShelfHz: 90, lowShelfDb: 0, presenceHz: 320, presenceDb: 0, presenceQ: 0.82, clarityHz: 3000, clarityDb: 0, clarityQ: 0.9, highShelfHz: 12000, highShelfDb: 0, makeupDb: 0 },
  speaker: { highpassHz: 28, lowShelfHz: 90, lowShelfDb: 0, presenceHz: 320, presenceDb: 0, presenceQ: 0.82, clarityHz: 3500, clarityDb: 0.20, clarityQ: 0.9, highShelfHz: 12000, highShelfDb: 0.30, makeupDb: 0 },
};

export const MUSIC_HEADPHONE_MODES: Record<
  MusicHeadphoneMode,
  { label: string; width: number; depth: number; crossfeed: number; center: number; bass: number }
> = {
  off: { label: "Off", width: 0, depth: 0, crossfeed: 0, center: 50, bass: 0 },
  wide: { label: "Wide", width: 88, depth: 18, crossfeed: 5, center: 50, bass: 0 },
  spatial: { label: "Spatial", width: 82, depth: 78, crossfeed: 22, center: 54, bass: 0 },
  stage: { label: "Stage", width: 66, depth: 72, crossfeed: 38, center: 68, bass: 0 },
  focus: { label: "Focus", width: 8, depth: 4, crossfeed: 18, center: 98, bass: 0 },
  bass_impact: { label: "Bass Impact", width: 42, depth: 16, crossfeed: 8, center: 60, bass: 64 },
};

export const MUSIC_OUTPUT_PROFILES: Record<
  MusicOutputProfile,
  { label: string; shortLabel: string; description: string }
> = {
  reference: {
    label: "Reference",
    shortLabel: "REF",
    description: "Direct reference path for level-matched A/B checks with processing removed.",
  },
  car_hifi: {
    label: "Car / Hi-Fi",
    shortLabel: "CAR / HI-FI",
    description: "Near-neutral full-range path with conservative gain and true-peak protection for a tuned vehicle or hi-fi system.",
  },
  headphones: {
    label: "Headphones",
    shortLabel: "HEADPHONES",
    description: "Near-neutral headphone path with optional binaural crossfeed, spatial processing and transparent true-peak protection.",
  },
  speaker: {
    label: "Bluetooth Speaker",
    shortLabel: "BLUETOOTH",
    description: "Near-neutral Bluetooth path with gentle codec-detail compensation and no heavy bass removal.",
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
  eqTopology: MusicEqTopology;
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
  dspEngineMode: MusicDspEngineMode;
  immersionStatus: MusicImmersionStatus;
  dspVerificationMode: MusicDspVerificationMode;
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
  eqTopology: "mvp_music_eq_topology_v13_8",
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

const AUDIO_ENGINE_VERSION = "v13-8-single-stage-hifi";
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
function readEqTopology(): MusicEqTopology {
  return readStored(STORAGE_KEYS.eqTopology) === "linear_phase" ? "linear_phase" : "minimum_phase";
}

function migrateAudioFidelitySettings() {
  if (readStored(STORAGE_KEYS.audioEngineVersion) === AUDIO_ENGINE_VERSION) return;
  const presetName = readEqPreset();
  const safePreset = isBuiltInPreset(presetName) ? presetName : "flat";
  savePlayerSetting(STORAGE_KEYS.eqPreset, safePreset);
  savePlayerSetting(STORAGE_KEYS.eqGains, JSON.stringify(MUSIC_EQ_FREQUENCIES.map(() => 0)));
  savePlayerSetting(STORAGE_KEYS.preampDb, "0");
  savePlayerSetting(STORAGE_KEYS.eqTopology, "minimum_phase");
  if (!readStored(STORAGE_KEYS.eqEnabled)) savePlayerSetting(STORAGE_KEYS.eqEnabled, "true");
  savePlayerSetting(STORAGE_KEYS.normalizationEnabled, "false");
  savePlayerSetting(STORAGE_KEYS.limiterEnabled, "true");
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
  eqTopology: readEqTopology(),
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
  dspEngineMode: "unavailable",
  immersionStatus: "bypassed",
  dspVerificationMode: "off",
};

let audioElement: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let mediaSource: MediaElementAudioSourceNode | null = null;
let masterVolumeGain: GainNode | null = null;
let referenceRouteGain: GainNode | null = null;
let preampGain: GainNode | null = null;
let transientProcessorNode: AudioWorkletNode | null = null;
let professionalHighpass: BiquadFilterNode | null = null;
let professionalLowShelf: BiquadFilterNode | null = null;
let professionalPeakFilters: BiquadFilterNode[] = [];
let professionalHighShelf: BiquadFilterNode | null = null;
let equalizerFilters: BiquadFilterNode[] = [];
let linearPhaseEqNode: AudioWorkletNode | null = null;
let outputHighpass: BiquadFilterNode | null = null;
let outputLowShelf: BiquadFilterNode | null = null;
let outputPresence: BiquadFilterNode | null = null;
let outputClarity: BiquadFilterNode | null = null;
let outputHighShelf: BiquadFilterNode | null = null;
let standardRouteGain: GainNode | null = null;
let headphoneProcessorNode: AudioWorkletNode | null = null;
let nativeHeadphoneBassShelf: BiquadFilterNode | null = null;
let nativeHeadphoneSplitter: ChannelSplitterNode | null = null;
let nativeHeadphoneMerger: ChannelMergerNode | null = null;
let nativeHeadphoneLeftDirect: GainNode | null = null;
let nativeHeadphoneRightDirect: GainNode | null = null;
let nativeHeadphoneLeftWidthCross: GainNode | null = null;
let nativeHeadphoneRightWidthCross: GainNode | null = null;
let nativeHeadphoneLeftCrossDelay: DelayNode | null = null;
let nativeHeadphoneRightCrossDelay: DelayNode | null = null;
let nativeHeadphoneLeftCrossLowpass: BiquadFilterNode | null = null;
let nativeHeadphoneRightCrossLowpass: BiquadFilterNode | null = null;
let nativeHeadphoneLeftCrossGain: GainNode | null = null;
let nativeHeadphoneRightCrossGain: GainNode | null = null;
let nativeHeadphoneLeftDepthDelay: DelayNode | null = null;
let nativeHeadphoneRightDepthDelay: DelayNode | null = null;
let nativeHeadphoneLeftDepthGain: GainNode | null = null;
let nativeHeadphoneRightDepthGain: GainNode | null = null;
let nativeHeadphoneCenterSum: GainNode | null = null;
let nativeHeadphoneCenterLeft: GainNode | null = null;
let nativeHeadphoneCenterRight: GainNode | null = null;
let headphoneRouteGain: GainNode | null = null;
let mixBus: GainNode | null = null;
let makeupGain: GainNode | null = null;
let limiterWorkletNode: AudioWorkletNode | null = null;
let limiterFallbackNode: DynamicsCompressorNode | null = null;
let analyserNode: AnalyserNode | null = null;
let referenceLevelAnalyser: AnalyserNode | null = null;
let processedLevelAnalyser: AnalyserNode | null = null;
let levelMeterSink: GainNode | null = null;
let musicGain: GainNode | null = null;
let analyserBuffer: Uint8Array<ArrayBuffer> | null = null;
let visualizerEnvelope = new Float32Array(64);
let mediaSourceConnected = false;
let graphBuildPromise: Promise<void> | null = null;
let loadingTrackId: string | null = null;
let timeSaveTimer = 0;
let recordedPlayToken = "";
let transportQueue: Promise<void> = Promise.resolve();
let playbackIntent = false;
let lastDspStatus: MusicDspStatus = "recovering";
let lastHeadroom = -1;
let lastEffectivePreamp = Number.NaN;
let processingSettleTimer = 0;
let levelMeterTimer = 0;
let lastReferenceRmsDb = Number.NaN;
let lastProcessedRmsDb = Number.NaN;
const signedUrlCache = new Map<string, { url: string; cachedAt: number }>();
const SIGNED_URL_TTL_MS = 8 * 60 * 1000;
const GRAPHIC_EQ_Q = 4.318;
const PRO_PEAK_COUNT = 6;

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
function gainToDb(gain: number) {
  return 20 * Math.log10(Math.max(0.000001, gain));
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
function eqProcessingRequested() {
  return state.outputProfile !== "reference" && state.eqEnabled;
}
function eqProofActive() {
  return state.dspVerificationMode === "eq" && state.outputProfile !== "reference" && !state.dspBypass;
}
function builtInPresetProcessingRequested() {
  return eqProcessingRequested() && isBuiltInPreset(state.eqPreset);
}
function userEqHasOffsets() {
  return state.eqGains.some((gain) => Math.abs(Number(gain) || 0) > 0.01);
}
function graphicEqProcessingRequested() {
  return eqProcessingRequested() && userEqHasOffsets() && !eqProofActive();
}
function professionalProcessingRequested() {
  return builtInPresetProcessingRequested() || eqProofActive();
}
function currentProPreset() {
  if (eqProofActive()) return DSP_EQ_PROOF_PRESET;
  return builtInPresetProcessingRequested() && isBuiltInPreset(state.eqPreset)
    ? MUSIC_PRO_PRESETS[state.eqPreset]
    : MUSIC_PRO_PRESETS.flat;
}
function currentOutputTuning() {
  return state.outputProfile === "reference" ? null : MUSIC_OUTPUT_TUNINGS[state.outputProfile];
}
function clampFilterFrequency(context: AudioContext, frequency: number) {
  return Math.max(10, Math.min(frequency, context.sampleRate * 0.46));
}
function configureProfessionalFilters(now: number) {
  if (!audioContext) return;
  const definition = currentProPreset();
  if (professionalHighpass) {
    setAudioParam(professionalHighpass.frequency, clampFilterFrequency(audioContext, definition.highpassHz), now, 0.035);
    setAudioParam(professionalHighpass.Q, 0.707, now, 0.035);
  }
  if (professionalLowShelf) {
    setAudioParam(professionalLowShelf.frequency, clampFilterFrequency(audioContext, definition.lowShelfHz), now, 0.035);
    setAudioParam(professionalLowShelf.gain, definition.lowShelfDb, now, 0.035);
  }
  professionalPeakFilters.forEach((filter, index) => {
    const peak = definition.peaks[index];
    setAudioParam(filter.frequency, clampFilterFrequency(audioContext!, peak?.frequency ?? 1000 + index * 500), now, 0.035);
    setAudioParam(filter.Q, peak?.q ?? 1, now, 0.035);
    setAudioParam(filter.gain, peak?.gain ?? 0, now, 0.035);
  });
  if (professionalHighShelf) {
    setAudioParam(professionalHighShelf.frequency, clampFilterFrequency(audioContext, definition.highShelfHz), now, 0.035);
    setAudioParam(professionalHighShelf.gain, definition.highShelfDb, now, 0.035);
  }
}
function buildLinearPhaseFir(gainsDb: number[], sampleRateValue: number) {
  const half = 128;
  const taps = half * 2 + 1;
  const bins = 128;
  const amplitudes = new Float64Array(bins + 1);
  const maxHz = sampleRateValue / 2;
  const minBand = MUSIC_EQ_FREQUENCIES[0];
  const maxBand = MUSIC_EQ_FREQUENCIES[MUSIC_EQ_FREQUENCIES.length - 1];
  const gainAt = (frequency: number) => {
    if (frequency <= minBand) return Number(gainsDb[0] || 0);
    if (frequency >= maxBand) return Number(gainsDb[gainsDb.length - 1] || 0);
    for (let index = 0; index < MUSIC_EQ_FREQUENCIES.length - 1; index += 1) {
      const leftHz = MUSIC_EQ_FREQUENCIES[index];
      const rightHz = MUSIC_EQ_FREQUENCIES[index + 1];
      if (frequency < leftHz || frequency > rightHz) continue;
      const amount = (Math.log(frequency) - Math.log(leftHz)) / Math.max(0.000001, Math.log(rightHz) - Math.log(leftHz));
      const leftDb = Number(gainsDb[index] || 0);
      const rightDb = Number(gainsDb[index + 1] || 0);
      return leftDb + (rightDb - leftDb) * amount;
    }
    return 0;
  };
  for (let bin = 0; bin <= bins; bin += 1) {
    const frequency = (bin / bins) * maxHz;
    amplitudes[bin] = dbToGain(gainAt(Math.max(10, frequency)));
  }
  const coefficients = new Float32Array(taps);
  for (let tap = 0; tap < taps; tap += 1) {
    const m = tap - half;
    let value = 0.5 * amplitudes[0] + 0.5 * amplitudes[bins] * Math.cos(Math.PI * m);
    for (let bin = 1; bin < bins; bin += 1) value += amplitudes[bin] * Math.cos(Math.PI * bin * m / bins);
    value /= bins;
    const window = 0.42 - 0.5 * Math.cos((2 * Math.PI * tap) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * tap) / (taps - 1));
    coefficients[tap] = value * window;
  }
  return coefficients;
}
function configureGraphicEq(now: number) {
  const enabled = graphicEqProcessingRequested();
  const minimumPhase = enabled && (state.eqTopology === "minimum_phase" || !linearPhaseEqNode);
  equalizerFilters.forEach((filter, index) => {
    const gain = minimumPhase ? Number(state.eqGains[index] || 0) : 0;
    setAudioParam(filter.gain, gain, now, 0.028);
  });
  if (linearPhaseEqNode) {
    const enabledParam = workletParam(linearPhaseEqNode, "enabled");
    if (enabledParam) setAudioParam(enabledParam, enabled && state.eqTopology === "linear_phase" ? 1 : 0, now, 0.02);
    if (enabled && state.eqTopology === "linear_phase" && audioContext) {
      linearPhaseEqNode.port.postMessage({ type: "coefficients", coefficients: Array.from(buildLinearPhaseFir(state.eqGains, audioContext.sampleRate)) });
    }
  }
}
function configureOutputFilters(now: number) {
  if (!audioContext) return;
  const tuning = currentOutputTuning();
  const highpass = tuning?.highpassHz ?? 10;
  const lowShelfHz = tuning?.lowShelfHz ?? 100;
  const lowShelfDb = tuning?.lowShelfDb ?? 0;
  const presenceHz = tuning?.presenceHz ?? 320;
  const presenceDb = tuning?.presenceDb ?? 0;
  const presenceQ = tuning?.presenceQ ?? 0.8;
  const clarityHz = tuning?.clarityHz ?? 2800;
  const clarityDb = tuning?.clarityDb ?? 0;
  const clarityQ = tuning?.clarityQ ?? 0.9;
  const highShelfHz = tuning?.highShelfHz ?? 10000;
  const highShelfDb = tuning?.highShelfDb ?? 0;
  if (outputHighpass) {
    setAudioParam(outputHighpass.frequency, clampFilterFrequency(audioContext, highpass), now, 0.035);
    setAudioParam(outputHighpass.Q, 0.707, now, 0.035);
  }
  if (outputLowShelf) {
    setAudioParam(outputLowShelf.frequency, clampFilterFrequency(audioContext, lowShelfHz), now, 0.035);
    setAudioParam(outputLowShelf.gain, lowShelfDb, now, 0.035);
  }
  if (outputPresence) {
    setAudioParam(outputPresence.frequency, clampFilterFrequency(audioContext, presenceHz), now, 0.035);
    setAudioParam(outputPresence.Q, presenceQ, now, 0.035);
    setAudioParam(outputPresence.gain, presenceDb, now, 0.035);
  }
  if (outputClarity) {
    setAudioParam(outputClarity.frequency, clampFilterFrequency(audioContext, clarityHz), now, 0.035);
    setAudioParam(outputClarity.Q, clarityQ, now, 0.035);
    setAudioParam(outputClarity.gain, clarityDb, now, 0.035);
  }
  if (outputHighShelf) {
    setAudioParam(outputHighShelf.frequency, clampFilterFrequency(audioContext, highShelfHz), now, 0.035);
    setAudioParam(outputHighShelf.gain, highShelfDb, now, 0.035);
  }
}
function activeResponseFilters() {
  const filters: BiquadFilterNode[] = [];
  if (state.outputProfile === "reference") return filters;
  if (professionalProcessingRequested()) {
    if (professionalHighpass) filters.push(professionalHighpass);
    if (professionalLowShelf) filters.push(professionalLowShelf);
    filters.push(...professionalPeakFilters);
    if (professionalHighShelf) filters.push(professionalHighShelf);
  }
  if (graphicEqProcessingRequested() && (state.eqTopology === "minimum_phase" || !linearPhaseEqNode)) filters.push(...equalizerFilters);
  if (outputHighpass) filters.push(outputHighpass);
  if (outputLowShelf) filters.push(outputLowShelf);
  if (outputPresence) filters.push(outputPresence);
  if (outputClarity) filters.push(outputClarity);
  if (outputHighShelf) filters.push(outputHighShelf);
  return filters;
}
function measureProcessingResponse() {
  if (!audioContext || state.outputProfile === "reference") return { peakDb: 0, averageDb: 0 };
  const filters = activeResponseFilters();
  if (!filters.length) return { peakDb: 0, averageDb: 0 };
  const count = 192;
  const frequencies = new Float32Array(count);
  const maxHz = Math.min(20000, audioContext.sampleRate * 0.45);
  const minHz = 20;
  const ratio = maxHz / minHz;
  for (let index = 0; index < count; index += 1) {
    frequencies[index] = minHz * Math.pow(ratio, index / (count - 1));
  }
  const combined = new Float32Array(count);
  combined.fill(1);
  const magnitude = new Float32Array(count);
  const phase = new Float32Array(count);
  filters.forEach((filter) => {
    filter.getFrequencyResponse(frequencies, magnitude, phase);
    for (let index = 0; index < count; index += 1) combined[index] *= Math.max(0.000001, magnitude[index]);
  });
  let peakDb = -120;
  let weightedTotal = 0;
  let weightTotal = 0;
  for (let index = 0; index < count; index += 1) {
    const db = gainToDb(combined[index]);
    peakDb = Math.max(peakDb, db);
    const frequency = frequencies[index];
    const weight = frequency >= 55 && frequency <= 12000 ? 1 : 0.25;
    weightedTotal += db * weight;
    weightTotal += weight;
  }
  return { peakDb: Math.max(0, peakDb), averageDb: weightTotal ? weightedTotal / weightTotal : 0 };
}
function headphonePeakSafetyDb() {
  const proof = state.dspVerificationMode === "spatial" && state.outputProfile === "headphones" && !state.dspBypass;
  if (state.outputProfile !== "headphones" || (state.headphoneMode === "off" && !proof)) return 0;
  const width = proof ? 1 : state.headphoneWidth / 100;
  const depth = proof ? 1 : state.headphoneDepth / 100;
  const bass = proof ? 0 : state.headphoneBassImpact / 100;
  return 0.25 + width * 0.35 + depth * 0.18 + bass * 0.28;
}
function calculateProcessingGain() {
  if (state.outputProfile === "reference") {
    return { effectivePreampDb: 0, autoHeadroomDb: 0, makeupDb: 0, referenceMatchDb: 0 };
  }
  const requested = eqProcessingRequested()
    ? Math.max(-12, Math.min(12, Number(state.preampDb) || 0))
    : 0;
  const response = measureProcessingResponse();
  const linearPhaseUserBoost = graphicEqProcessingRequested() && state.eqTopology === "linear_phase" && linearPhaseEqNode
    ? Math.max(0, ...state.eqGains.map((gain) => Number(gain) || 0))
    : 0;
  const estimatedPeakDb = response.peakDb + linearPhaseUserBoost;
  const safetyDb = 0.45 + headphonePeakSafetyDb() * 0.28;
  // Presets are deliberately modest. Keep only the static headroom actually needed and let
  // the 4x true-peak lookahead limiter catch short inter-sample events.
  const peakContribution = state.limiterEnabled ? estimatedPeakDb * 0.25 : estimatedPeakDb;
  const requiredReduction = Math.max(0, requested + peakContribution + safetyDb);
  const effectivePreampDb = requested - requiredReduction;
  const presetMakeup = builtInPresetProcessingRequested() ? currentProPreset().makeupDb : 0;
  const outputMakeup = currentOutputTuning()?.makeupDb ?? 0;
  const limiterRecovery = state.limiterEnabled ? Math.max(0, requiredReduction - 0.45) * 0.62 : 0;
  const makeupDb = Math.max(-0.5, Math.min(1.5, presetMakeup + outputMakeup + limiterRecovery));
  const measuredMatch = Number.isFinite(lastReferenceRmsDb) && Number.isFinite(lastProcessedRmsDb)
    ? Math.max(-6, Math.min(3, lastProcessedRmsDb - lastReferenceRmsDb))
    : Math.max(-6, Math.min(3, effectivePreampDb + response.averageDb + makeupDb));
  return {
    effectivePreampDb,
    autoHeadroomDb: requiredReduction,
    makeupDb,
    referenceMatchDb: measuredMatch,
  };
}
function scheduleProcessingSettle() {
  if (typeof window === "undefined") return;
  if (processingSettleTimer) window.clearTimeout(processingSettleTimer);
  processingSettleTimer = window.setTimeout(() => {
    processingSettleTimer = 0;
    applyProcessingSettings();
  }, 140);
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
function workletParam(node: AudioWorkletNode | null, name: string) {
  return node?.parameters.get(name) ?? null;
}
function headphoneModeCode(mode: MusicHeadphoneMode) {
  if (mode === "wide") return 1;
  if (mode === "spatial") return 2;
  if (mode === "stage") return 3;
  if (mode === "focus") return 4;
  if (mode === "bass_impact") return 5;
  return 0;
}
function nativeImmersionAvailable() {
  return Boolean(nativeHeadphoneSplitter && nativeHeadphoneMerger);
}
function applyNativeHeadphoneSettings(now: number, enabled: boolean) {
  const proof = state.dspVerificationMode === "spatial" && state.outputProfile === "headphones" && !state.dspBypass;
  const width = enabled ? (proof ? 1 : state.headphoneWidth / 100) : 0;
  const depth = enabled ? (proof ? 1 : state.headphoneDepth / 100) : 0;
  const crossfeed = enabled ? (proof ? 0.58 : state.headphoneCrossfeed / 100) : 0;
  const center = enabled ? (proof ? 0.5 : state.headphoneCenter / 100) : 0.5;
  const bass = enabled ? (proof ? 0 : state.headphoneBassImpact / 100) : 0;

  const widthScale = enabled ? (proof ? 2.65 : 1 + width * 1.35) : 1;
  const compensation = 1 / Math.max(1, 1 + Math.max(0, widthScale - 1) * 0.28 + depth * 0.16);
  const direct = ((1 + widthScale) / 2) * compensation;
  const widthCross = ((1 - widthScale) / 2) * compensation;
  const crossMix = enabled ? (proof ? 0.62 : crossfeed * 0.50) : 0;
  const crossDelay = enabled ? (proof ? 0.0014 : 0.00028 + crossfeed * 0.00095) : 0.00022;
  const depthMix = enabled ? (proof ? 0.58 : depth * 0.42) : 0;
  const depthDelay = enabled ? (proof ? 0.016 : 0.003 + depth * 0.0135) : 0.0018;
  const centerGain = enabled ? Math.max(-0.14, Math.min(0.52, (center - 0.5) * 0.96)) : 0;
  const bassDb = enabled ? bass * 4.5 : 0;

  if (nativeHeadphoneLeftDirect) setAudioParam(nativeHeadphoneLeftDirect.gain, direct, now);
  if (nativeHeadphoneRightDirect) setAudioParam(nativeHeadphoneRightDirect.gain, direct, now);
  if (nativeHeadphoneLeftWidthCross) setAudioParam(nativeHeadphoneLeftWidthCross.gain, widthCross, now);
  if (nativeHeadphoneRightWidthCross) setAudioParam(nativeHeadphoneRightWidthCross.gain, widthCross, now);
  if (nativeHeadphoneLeftCrossDelay) setAudioParam(nativeHeadphoneLeftCrossDelay.delayTime, crossDelay, now);
  if (nativeHeadphoneRightCrossDelay) setAudioParam(nativeHeadphoneRightCrossDelay.delayTime, crossDelay, now);
  if (nativeHeadphoneLeftCrossGain) setAudioParam(nativeHeadphoneLeftCrossGain.gain, crossMix, now);
  if (nativeHeadphoneRightCrossGain) setAudioParam(nativeHeadphoneRightCrossGain.gain, crossMix, now);
  if (nativeHeadphoneLeftDepthDelay) setAudioParam(nativeHeadphoneLeftDepthDelay.delayTime, depthDelay, now);
  if (nativeHeadphoneRightDepthDelay) setAudioParam(nativeHeadphoneRightDepthDelay.delayTime, depthDelay * 0.83, now);
  if (nativeHeadphoneLeftDepthGain) setAudioParam(nativeHeadphoneLeftDepthGain.gain, depthMix, now);
  if (nativeHeadphoneRightDepthGain) setAudioParam(nativeHeadphoneRightDepthGain.gain, depthMix, now);
  if (nativeHeadphoneCenterLeft) setAudioParam(nativeHeadphoneCenterLeft.gain, centerGain, now);
  if (nativeHeadphoneCenterRight) setAudioParam(nativeHeadphoneCenterRight.gain, centerGain, now);
  if (nativeHeadphoneBassShelf) setAudioParam(nativeHeadphoneBassShelf.gain, bassDb, now, 0.035);
}
function applyHeadphoneSettings(now: number) {
  const enabled =
    !state.dspBypass &&
    state.outputProfile === "headphones" &&
    (state.headphoneMode !== "off" || state.dspVerificationMode === "spatial");
  const proof = state.dspVerificationMode === "spatial" && state.outputProfile === "headphones" && !state.dspBypass;
  const values: Array<[string, number]> = [
    ["enabled", enabled ? 1 : 0],
    ["mode", enabled ? headphoneModeCode(state.headphoneMode) : 0],
    ["proof", proof ? 1 : 0],
    ["width", enabled ? (proof ? 1 : state.headphoneWidth / 100) : 0],
    ["depth", enabled ? (proof ? 1 : state.headphoneDepth / 100) : 0],
    ["crossfeed", enabled ? (proof ? 0.72 : state.headphoneCrossfeed / 100) : 0],
    ["center", enabled ? (proof ? 0.5 : state.headphoneCenter / 100) : 0.5],
    ["bassImpact", enabled ? (proof ? 0 : state.headphoneBassImpact / 100) : 0],
  ];
  values.forEach(([name, value]) => {
    const param = workletParam(headphoneProcessorNode, name);
    if (param) setAudioParam(param, value, now, 0.02);
  });
  if (!headphoneProcessorNode) applyNativeHeadphoneSettings(now, enabled);
}
function currentImmersionStatus(): MusicImmersionStatus {
  if (state.outputProfile !== "headphones" || state.dspBypass) return "bypassed";
  const requested = state.headphoneMode !== "off" || state.dspVerificationMode === "spatial";
  if (!requested) return "bypassed";
  if (headphoneProcessorNode) return "active";
  if (nativeImmersionAvailable()) return "native_fallback";
  return "unavailable";
}
function sourceTransientScale() {
  const track = state.currentTrack;
  if (!track) return 1;
  const mime = (track.mime_type || "").toLowerCase();
  const name = (track.original_name || "").toLowerCase();
  if (mime.includes("wav") || name.endsWith(".wav") || mime.includes("flac") || name.endsWith(".flac")) return 0.72;
  const bytes = Number(track.file_size_bytes || 0);
  const seconds = Number(track.duration_seconds || 0);
  if (bytes > 0 && seconds > 0) {
    const kbps = (bytes * 8) / seconds / 1000;
    if (kbps < 192) return 1.12;
    if (kbps < 256) return 1.0;
    return 0.88;
  }
  return 0.92;
}
function applyTransientSettings(now: number, active: boolean) {
  if (!transientProcessorNode) return;
  const enabled = workletParam(transientProcessorNode, "enabled");
  const amount = workletParam(transientProcessorNode, "amount");
  const presetAmount = professionalProcessingRequested() ? currentProPreset().transientAmount : 0;
  if (enabled) setAudioParam(enabled, active && presetAmount > 0.001 ? 1 : 0, now, 0.02);
  if (amount) setAudioParam(amount, Math.max(0, Math.min(1, presetAmount * sourceTransientScale())), now, 0.035);
}

function applyLimiterSettings(now: number, limiterActive: boolean) {
  if (limiterWorkletNode) {
    const enabled = workletParam(limiterWorkletNode, "enabled");
    const ceiling = workletParam(limiterWorkletNode, "ceilingDb");
    const release = workletParam(limiterWorkletNode, "releaseMs");
    if (enabled) setAudioParam(enabled, limiterActive ? 1 : 0, now, 0.01);
    if (ceiling) setAudioParam(ceiling, state.outputProfile === "car_hifi" ? -1.2 : state.outputProfile === "speaker" ? -1.15 : -1.0, now, 0.02);
    if (release) setAudioParam(release, state.outputProfile === "speaker" ? 125 : state.outputProfile === "car_hifi" ? 88 : 98, now, 0.03);
  }
  if (limiterFallbackNode) {
    if (limiterActive) {
      limiterFallbackNode.threshold.value = -0.9;
      limiterFallbackNode.knee.value = 0;
      limiterFallbackNode.ratio.value = 20;
      limiterFallbackNode.attack.value = 0.0015;
      limiterFallbackNode.release.value = 0.11;
    } else {
      setCompressorBypass(limiterFallbackNode);
    }
  }
}
function applyProcessingSettings() {
  if (!audioContext || !mediaSourceConnected) return;
  const now = audioContext.currentTime;
  configureProfessionalFilters(now);
  configureGraphicEq(now);
  configureOutputFilters(now);
  const { effectivePreampDb, autoHeadroomDb, makeupDb, referenceMatchDb } = calculateProcessingGain();
  const pureReference = state.outputProfile === "reference";
  const abBypass = !pureReference && state.dspBypass;
  const processed = !pureReference && !abBypass;
  const headphones = processed && state.outputProfile === "headphones" && Boolean(headphoneProcessorNode || nativeImmersionAvailable());
  const standard = processed && !headphones;

  if (masterVolumeGain) setAudioParam(masterVolumeGain.gain, volumeToGain(state.volume), now, 0.01);
  if (referenceRouteGain) {
    const referenceGain = pureReference ? 1 : abBypass ? dbToGain(referenceMatchDb) : 0;
    setAudioParam(referenceRouteGain.gain, referenceGain, now, 0.008);
  }
  if (standardRouteGain) setAudioParam(standardRouteGain.gain, standard ? 1 : 0, now, 0.008);
  if (headphoneRouteGain) setAudioParam(headphoneRouteGain.gain, headphones ? 1 : 0, now, 0.008);
  if (preampGain) setAudioParam(preampGain.gain, dbToGain(effectivePreampDb), now, 0.018);
  if (makeupGain) setAudioParam(makeupGain.gain, dbToGain(pureReference ? 0 : makeupDb), now, 0.025);

  applyTransientSettings(now, processed);
  applyHeadphoneSettings(now);
  applyLimiterSettings(now, !pureReference && state.limiterEnabled);

  const status: MusicDspStatus =
    audioContext.state === "running" ? (pureReference || abBypass ? "bypassed" : "active") : "recovering";
  setDspTelemetry(status, effectivePreampDb, autoHeadroomDb);
  const immersionStatus = currentImmersionStatus();
  if (state.immersionStatus !== immersionStatus) emit({ immersionStatus });
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
    transientProcessorNode,
    professionalHighpass,
    professionalLowShelf,
    professionalHighShelf,
    outputHighpass,
    outputLowShelf,
    outputPresence,
    outputClarity,
    outputHighShelf,
    standardRouteGain,
    headphoneProcessorNode,
    nativeHeadphoneBassShelf,
    nativeHeadphoneSplitter,
    nativeHeadphoneMerger,
    nativeHeadphoneLeftDirect,
    nativeHeadphoneRightDirect,
    nativeHeadphoneLeftWidthCross,
    nativeHeadphoneRightWidthCross,
    nativeHeadphoneLeftCrossDelay,
    nativeHeadphoneRightCrossDelay,
    nativeHeadphoneLeftCrossLowpass,
    nativeHeadphoneRightCrossLowpass,
    nativeHeadphoneLeftCrossGain,
    nativeHeadphoneRightCrossGain,
    nativeHeadphoneLeftDepthDelay,
    nativeHeadphoneRightDepthDelay,
    nativeHeadphoneLeftDepthGain,
    nativeHeadphoneRightDepthGain,
    nativeHeadphoneCenterSum,
    nativeHeadphoneCenterLeft,
    nativeHeadphoneCenterRight,
    headphoneRouteGain,
    mixBus,
    makeupGain,
    limiterWorkletNode,
    limiterFallbackNode,
    analyserNode,
    referenceLevelAnalyser,
    processedLevelAnalyser,
    levelMeterSink,
    musicGain,
  ].forEach(disconnectNode);
  professionalPeakFilters.forEach(disconnectNode);
  equalizerFilters.forEach(disconnectNode);
  mediaSource = null;
  masterVolumeGain = null;
  referenceRouteGain = null;
  preampGain = null;
  transientProcessorNode = null;
  professionalHighpass = null;
  professionalLowShelf = null;
  professionalPeakFilters = [];
  professionalHighShelf = null;
  equalizerFilters = [];
  linearPhaseEqNode = null;
  outputHighpass = null;
  outputLowShelf = null;
  outputPresence = null;
  outputClarity = null;
  outputHighShelf = null;
  standardRouteGain = null;
  headphoneProcessorNode = null;
  nativeHeadphoneBassShelf = null;
  nativeHeadphoneSplitter = null;
  nativeHeadphoneMerger = null;
  nativeHeadphoneLeftDirect = null;
  nativeHeadphoneRightDirect = null;
  nativeHeadphoneLeftWidthCross = null;
  nativeHeadphoneRightWidthCross = null;
  nativeHeadphoneLeftCrossDelay = null;
  nativeHeadphoneRightCrossDelay = null;
  nativeHeadphoneLeftCrossLowpass = null;
  nativeHeadphoneRightCrossLowpass = null;
  nativeHeadphoneLeftCrossGain = null;
  nativeHeadphoneRightCrossGain = null;
  nativeHeadphoneLeftDepthDelay = null;
  nativeHeadphoneRightDepthDelay = null;
  nativeHeadphoneLeftDepthGain = null;
  nativeHeadphoneRightDepthGain = null;
  nativeHeadphoneCenterSum = null;
  nativeHeadphoneCenterLeft = null;
  nativeHeadphoneCenterRight = null;
  headphoneRouteGain = null;
  mixBus = null;
  makeupGain = null;
  limiterWorkletNode = null;
  limiterFallbackNode = null;
  analyserNode = null;
  referenceLevelAnalyser = null;
  processedLevelAnalyser = null;
  levelMeterSink = null;
  musicGain = null;
  analyserBuffer = null;
  if (levelMeterTimer && typeof window !== "undefined") window.clearInterval(levelMeterTimer);
  levelMeterTimer = 0;
  lastReferenceRmsDb = Number.NaN;
  lastProcessedRmsDb = Number.NaN;
  mediaSourceConnected = false;
  graphBuildPromise = null;
  if (state.dspEngineMode !== "unavailable" || state.immersionStatus !== "bypassed") {
    emit({ dspEngineMode: "unavailable", immersionStatus: "bypassed" });
  }
}
async function loadAdvancedDspModule(context: AudioContext) {
  if (!context.audioWorklet) return false;
  try {
    const moduleUrl = new URL("./audio/mvpMusicDsp.worklet.js", import.meta.url).href;
    await context.audioWorklet.addModule(moduleUrl);
    return true;
  } catch (error) {
    console.warn("Advanced music DSP worklet unavailable; using native Web Audio fallback.", error);
    return false;
  }
}
function createProfessionalFilterBank(context: AudioContext) {
  professionalHighpass = context.createBiquadFilter();
  professionalHighpass.type = "highpass";
  professionalLowShelf = context.createBiquadFilter();
  professionalLowShelf.type = "lowshelf";
  professionalPeakFilters = Array.from({ length: PRO_PEAK_COUNT }, () => {
    const filter = context.createBiquadFilter();
    filter.type = "peaking";
    filter.Q.value = 1;
    filter.gain.value = 0;
    return filter;
  });
  professionalHighShelf = context.createBiquadFilter();
  professionalHighShelf.type = "highshelf";
}
function createGraphicEq(context: AudioContext) {
  equalizerFilters = MUSIC_EQ_FREQUENCIES.map((frequency) => {
    const filter = context.createBiquadFilter();
    filter.type = "peaking";
    filter.frequency.value = clampFilterFrequency(context, frequency);
    filter.Q.value = GRAPHIC_EQ_Q;
    filter.gain.value = 0;
    return filter;
  });
}
function createOutputFilterBank(context: AudioContext) {
  outputHighpass = context.createBiquadFilter();
  outputHighpass.type = "highpass";
  outputLowShelf = context.createBiquadFilter();
  outputLowShelf.type = "lowshelf";
  outputPresence = context.createBiquadFilter();
  outputPresence.type = "peaking";
  outputClarity = context.createBiquadFilter();
  outputClarity.type = "peaking";
  outputHighShelf = context.createBiquadFilter();
  outputHighShelf.type = "highshelf";
}
function createNativeHeadphoneFallback(context: AudioContext) {
  nativeHeadphoneBassShelf = context.createBiquadFilter();
  nativeHeadphoneBassShelf.type = "lowshelf";
  nativeHeadphoneBassShelf.frequency.value = 105;
  nativeHeadphoneSplitter = context.createChannelSplitter(2);
  nativeHeadphoneMerger = context.createChannelMerger(2);
  nativeHeadphoneLeftDirect = context.createGain();
  nativeHeadphoneRightDirect = context.createGain();
  nativeHeadphoneLeftDirect.gain.value = 1;
  nativeHeadphoneRightDirect.gain.value = 1;
  nativeHeadphoneLeftWidthCross = context.createGain();
  nativeHeadphoneRightWidthCross = context.createGain();
  nativeHeadphoneLeftWidthCross.gain.value = 0;
  nativeHeadphoneRightWidthCross.gain.value = 0;
  nativeHeadphoneLeftCrossDelay = context.createDelay(0.02);
  nativeHeadphoneRightCrossDelay = context.createDelay(0.02);
  nativeHeadphoneLeftCrossLowpass = context.createBiquadFilter();
  nativeHeadphoneRightCrossLowpass = context.createBiquadFilter();
  nativeHeadphoneLeftCrossLowpass.type = "lowpass";
  nativeHeadphoneRightCrossLowpass.type = "lowpass";
  nativeHeadphoneLeftCrossLowpass.frequency.value = 1250;
  nativeHeadphoneRightCrossLowpass.frequency.value = 1250;
  nativeHeadphoneLeftCrossGain = context.createGain();
  nativeHeadphoneRightCrossGain = context.createGain();
  nativeHeadphoneLeftCrossGain.gain.value = 0;
  nativeHeadphoneRightCrossGain.gain.value = 0;
  nativeHeadphoneLeftDepthDelay = context.createDelay(0.02);
  nativeHeadphoneRightDepthDelay = context.createDelay(0.02);
  nativeHeadphoneLeftDepthGain = context.createGain();
  nativeHeadphoneRightDepthGain = context.createGain();
  nativeHeadphoneLeftDepthGain.gain.value = 0;
  nativeHeadphoneRightDepthGain.gain.value = 0;
  nativeHeadphoneCenterSum = context.createGain();
  nativeHeadphoneCenterSum.gain.value = 0.5;
  nativeHeadphoneCenterLeft = context.createGain();
  nativeHeadphoneCenterRight = context.createGain();
  nativeHeadphoneCenterLeft.gain.value = 0;
  nativeHeadphoneCenterRight.gain.value = 0;
}
function connectNativeHeadphoneFallback(source: AudioNode) {
  if (
    !nativeHeadphoneBassShelf || !nativeHeadphoneSplitter || !nativeHeadphoneMerger ||
    !nativeHeadphoneLeftDirect || !nativeHeadphoneRightDirect ||
    !nativeHeadphoneLeftWidthCross || !nativeHeadphoneRightWidthCross ||
    !nativeHeadphoneLeftCrossDelay || !nativeHeadphoneRightCrossDelay ||
    !nativeHeadphoneLeftCrossLowpass || !nativeHeadphoneRightCrossLowpass ||
    !nativeHeadphoneLeftCrossGain || !nativeHeadphoneRightCrossGain ||
    !nativeHeadphoneLeftDepthDelay || !nativeHeadphoneRightDepthDelay ||
    !nativeHeadphoneLeftDepthGain || !nativeHeadphoneRightDepthGain ||
    !nativeHeadphoneCenterSum || !nativeHeadphoneCenterLeft || !nativeHeadphoneCenterRight ||
    !headphoneRouteGain
  ) return;

  source.connect(nativeHeadphoneBassShelf);
  nativeHeadphoneBassShelf.connect(nativeHeadphoneSplitter);

  nativeHeadphoneSplitter.connect(nativeHeadphoneLeftDirect, 0);
  nativeHeadphoneLeftDirect.connect(nativeHeadphoneMerger, 0, 0);
  nativeHeadphoneSplitter.connect(nativeHeadphoneRightDirect, 1);
  nativeHeadphoneRightDirect.connect(nativeHeadphoneMerger, 0, 1);

  nativeHeadphoneSplitter.connect(nativeHeadphoneLeftWidthCross, 0);
  nativeHeadphoneLeftWidthCross.connect(nativeHeadphoneMerger, 0, 1);
  nativeHeadphoneSplitter.connect(nativeHeadphoneRightWidthCross, 1);
  nativeHeadphoneRightWidthCross.connect(nativeHeadphoneMerger, 0, 0);

  nativeHeadphoneSplitter.connect(nativeHeadphoneLeftCrossDelay, 0);
  nativeHeadphoneLeftCrossDelay.connect(nativeHeadphoneLeftCrossLowpass);
  nativeHeadphoneLeftCrossLowpass.connect(nativeHeadphoneLeftCrossGain);
  nativeHeadphoneLeftCrossGain.connect(nativeHeadphoneMerger, 0, 1);
  nativeHeadphoneSplitter.connect(nativeHeadphoneRightCrossDelay, 1);
  nativeHeadphoneRightCrossDelay.connect(nativeHeadphoneRightCrossLowpass);
  nativeHeadphoneRightCrossLowpass.connect(nativeHeadphoneRightCrossGain);
  nativeHeadphoneRightCrossGain.connect(nativeHeadphoneMerger, 0, 0);

  nativeHeadphoneSplitter.connect(nativeHeadphoneLeftDepthDelay, 0);
  nativeHeadphoneLeftDepthDelay.connect(nativeHeadphoneLeftDepthGain);
  nativeHeadphoneLeftDepthGain.connect(nativeHeadphoneMerger, 0, 1);
  nativeHeadphoneSplitter.connect(nativeHeadphoneRightDepthDelay, 1);
  nativeHeadphoneRightDepthDelay.connect(nativeHeadphoneRightDepthGain);
  nativeHeadphoneRightDepthGain.connect(nativeHeadphoneMerger, 0, 0);

  nativeHeadphoneSplitter.connect(nativeHeadphoneCenterSum, 0);
  nativeHeadphoneSplitter.connect(nativeHeadphoneCenterSum, 1);
  nativeHeadphoneCenterSum.connect(nativeHeadphoneCenterLeft);
  nativeHeadphoneCenterSum.connect(nativeHeadphoneCenterRight);
  nativeHeadphoneCenterLeft.connect(nativeHeadphoneMerger, 0, 0);
  nativeHeadphoneCenterRight.connect(nativeHeadphoneMerger, 0, 1);

  nativeHeadphoneMerger.connect(headphoneRouteGain);
}
async function connectMusicGraph() {
  if (mediaSourceConnected) return;
  if (graphBuildPromise) return graphBuildPromise;
  graphBuildPromise = (async () => {
    const audio = ensureAudioElement();
    const context = getAudioContext();
    if (!context || mediaSourceConnected) return;
    try {
      const advancedDsp = await loadAdvancedDspModule(context);
      mediaSource = context.createMediaElementSource(audio);
      masterVolumeGain = context.createGain();
      referenceRouteGain = context.createGain();
      referenceRouteGain.gain.value = 0;
      preampGain = context.createGain();
      createProfessionalFilterBank(context);
      createGraphicEq(context);
      createOutputFilterBank(context);
      standardRouteGain = context.createGain();
      standardRouteGain.gain.value = 0;
      headphoneRouteGain = context.createGain();
      headphoneRouteGain.gain.value = 0;
      mixBus = context.createGain();
      makeupGain = context.createGain();
      analyserNode = context.createAnalyser();
      analyserNode.fftSize = 4096;
      analyserNode.smoothingTimeConstant = 0.38;
      analyserNode.minDecibels = -92;
      analyserNode.maxDecibels = -10;
      musicGain = context.createGain();
      musicGain.gain.value = 1;
      referenceLevelAnalyser = context.createAnalyser();
      processedLevelAnalyser = context.createAnalyser();
      referenceLevelAnalyser.fftSize = 2048;
      processedLevelAnalyser.fftSize = 2048;
      levelMeterSink = context.createGain();
      levelMeterSink.gain.value = 0;

      let engineMode: MusicDspEngineMode = "native_fallback";
      if (advancedDsp) {
        try {
          transientProcessorNode = new AudioWorkletNode(context, "mvp-transient-processor", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "max" });
          linearPhaseEqNode = new AudioWorkletNode(context, "mvp-linear-phase-eq", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "max" });
          headphoneProcessorNode = new AudioWorkletNode(context, "mvp-headphone-processor", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: "max",
          });
          limiterWorkletNode = new AudioWorkletNode(context, "mvp-lookahead-limiter", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: "max",
          });
          engineMode = "advanced_worklet";
        } catch (error) {
          console.warn("Advanced DSP nodes failed; using native fallback.", error);
          transientProcessorNode = null;
          linearPhaseEqNode = null;
          headphoneProcessorNode = null;
          limiterWorkletNode = null;
        }
      }
      if (engineMode === "native_fallback") {
        createNativeHeadphoneFallback(context);
        limiterFallbackNode = context.createDynamicsCompressor();
      }
      emit({ dspEngineMode: engineMode });

      mediaSource.connect(masterVolumeGain);
      masterVolumeGain.connect(referenceRouteGain);
      referenceRouteGain.connect(mixBus);

      masterVolumeGain.connect(preampGain);
      let processedTail: AudioNode = preampGain;
      if (transientProcessorNode) {
        processedTail.connect(transientProcessorNode);
        processedTail = transientProcessorNode;
      }
      const professionalNodes = [
        professionalHighpass,
        professionalLowShelf,
        ...professionalPeakFilters,
        professionalHighShelf,
      ].filter((node): node is BiquadFilterNode => Boolean(node));
      professionalNodes.forEach((node) => {
        processedTail.connect(node);
        processedTail = node;
      });
      equalizerFilters.forEach((filter) => {
        processedTail.connect(filter);
        processedTail = filter;
      });
      if (linearPhaseEqNode) {
        processedTail.connect(linearPhaseEqNode);
        processedTail = linearPhaseEqNode;
      }
      const outputNodes = [outputHighpass, outputLowShelf, outputPresence, outputClarity, outputHighShelf].filter(
        (node): node is BiquadFilterNode => Boolean(node),
      );
      outputNodes.forEach((node) => {
        processedTail.connect(node);
        processedTail = node;
      });

      processedTail.connect(standardRouteGain);
      standardRouteGain.connect(mixBus);
      if (headphoneProcessorNode) {
        processedTail.connect(headphoneProcessorNode);
        headphoneProcessorNode.connect(headphoneRouteGain);
      } else if (nativeImmersionAvailable()) {
        connectNativeHeadphoneFallback(processedTail);
      }
      headphoneRouteGain.connect(mixBus);

      mixBus.connect(makeupGain);
      let limiterTail: AudioNode = makeupGain;
      if (limiterWorkletNode) {
        limiterTail.connect(limiterWorkletNode);
        limiterTail = limiterWorkletNode;
      } else if (limiterFallbackNode) {
        limiterTail.connect(limiterFallbackNode);
        limiterTail = limiterFallbackNode;
      }
      limiterTail.connect(analyserNode);
      analyserNode.connect(musicGain);
      musicGain.connect(context.destination);
      if (referenceLevelAnalyser && processedLevelAnalyser && levelMeterSink) {
        masterVolumeGain.connect(referenceLevelAnalyser);
        referenceLevelAnalyser.connect(levelMeterSink);
        makeupGain.connect(processedLevelAnalyser);
        processedLevelAnalyser.connect(levelMeterSink);
        levelMeterSink.connect(context.destination);
      }

      mediaSourceConnected = true;
      audio.volume = 1;
      applyProcessingSettings();
    } catch (error) {
      console.warn("Music Pro DSP graph unavailable; browser will use direct audio output.", error);
      releaseGraph();
      emit({ dspStatus: "unavailable", dspEngineMode: "unavailable", immersionStatus: "unavailable" });
    }
  })();
  try {
    await graphBuildPromise;
  } finally {
    if (!mediaSourceConnected) graphBuildPromise = null;
  }
}
function rmsDbFromAnalyser(analyser: AnalyserNode) {
  const values = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(values);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) sum += values[index] * values[index];
  return gainToDb(Math.sqrt(sum / Math.max(1, values.length)));
}
function startLevelMeter() {
  if (typeof window === "undefined" || levelMeterTimer) return;
  levelMeterTimer = window.setInterval(() => {
    if (!state.playing || !referenceLevelAnalyser || !processedLevelAnalyser) return;
    const referenceDb = rmsDbFromAnalyser(referenceLevelAnalyser);
    if (Number.isFinite(referenceDb) && referenceDb > -80) {
      lastReferenceRmsDb = Number.isFinite(lastReferenceRmsDb) ? lastReferenceRmsDb * 0.86 + referenceDb * 0.14 : referenceDb;
    }
    if (state.outputProfile !== "reference" && !state.dspBypass) {
      const processedDb = rmsDbFromAnalyser(processedLevelAnalyser);
      if (Number.isFinite(processedDb) && processedDb > -80) {
        lastProcessedRmsDb = Number.isFinite(lastProcessedRmsDb) ? lastProcessedRmsDb * 0.86 + processedDb * 0.14 : processedDb;
      }
    }
  }, 350);
}

async function unlockMusicAudio() {
  await connectMusicGraph();
  const context = getAudioContext();
  if (context?.state === "suspended") await context.resume();
  if (mediaSourceConnected) {
    applyProcessingSettings();
    startLevelMeter();
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
  scheduleProcessingSettle();
}

export function applyMusicEqPreset(presetName: MusicEqPreset) {
  if (!isBuiltInPreset(presetName)) {
    if (presetName === "custom" || isCustomPresetSlot(presetName)) {
      savePlayerSetting(STORAGE_KEYS.eqPreset, presetName);
      emit({ eqPreset: presetName });
    }
    return;
  }
  const gains = MUSIC_EQ_FREQUENCIES.map(() => 0);
  savePlayerSetting(STORAGE_KEYS.eqPreset, presetName);
  savePlayerSetting(STORAGE_KEYS.eqGains, JSON.stringify(gains));
  savePlayerSetting(STORAGE_KEYS.preampDb, "0");
  emit({ eqPreset: presetName, eqGains: gains, preampDb: 0, dspVerificationMode: "off" });
  applyProcessingSettings();
  scheduleProcessingSettle();
}

export function saveMusicEqCustomPreset(slot: MusicCustomPresetSlot) {
  const definition: EqDefinition = {
    label: slot === "custom_1" ? "Custom 1" : slot === "custom_2" ? "Custom 2" : "Custom 3",
    gains: [...state.eqGains],
    preamp: state.preampDb,
  };
  savePlayerSetting(customPresetStorageKey(slot), JSON.stringify(definition));
}

export function setMusicEqBand(index: number, gainDb: number) {
  if (index < 0 || index >= MUSIC_EQ_FREQUENCIES.length) return;
  const gains = [...state.eqGains];
  gains[index] = Math.max(-12, Math.min(12, Number(gainDb) || 0));
  savePlayerSetting(STORAGE_KEYS.eqGains, JSON.stringify(gains));
  emit({ eqGains: gains });
  applyProcessingSettings();
}

export function setMusicPreamp(preampDb: number) {
  const next = Math.max(-12, Math.min(12, Number(preampDb) || 0));
  savePlayerSetting(STORAGE_KEYS.preampDb, String(next));
  emit({ preampDb: next });
  applyProcessingSettings();
  scheduleProcessingSettle();
}

export function setMusicEqTopology(topology: MusicEqTopology) {
  const next: MusicEqTopology = topology === "linear_phase" ? "linear_phase" : "minimum_phase";
  savePlayerSetting(STORAGE_KEYS.eqTopology, next);
  emit({ eqTopology: next });
  applyProcessingSettings();
  scheduleProcessingSettle();
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

export function setMusicDspVerificationMode(mode: MusicDspVerificationMode) {
  const next: MusicDspVerificationMode = mode === "eq" || mode === "spatial" ? mode : "off";
  emit({ dspVerificationMode: next });
  applyProcessingSettings();
  scheduleProcessingSettle();
}

export function setMusicOutputProfile(profile: MusicOutputProfile) {
  if (!Object.prototype.hasOwnProperty.call(MUSIC_OUTPUT_PROFILES, profile)) return;
  savePlayerSetting(STORAGE_KEYS.outputProfile, profile);
  savePlayerSetting(STORAGE_KEYS.dspBypass, "false");
  savePlayerSetting(STORAGE_KEYS.normalizationEnabled, "false");
  emit({
    outputProfile: profile,
    dspBypass: false,
    normalizationEnabled: false,
    dspVerificationMode: "off",
  });
  applyProcessingSettings();
}

export function setMusicDspBypass(bypassed: boolean) {
  savePlayerSetting(STORAGE_KEYS.dspBypass, String(bypassed));
  emit({ dspBypass: bypassed, dspVerificationMode: "off" });
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
