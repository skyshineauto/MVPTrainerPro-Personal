import { useSyncExternalStore } from "react";
import {
  createMvpStudioNode,
  getMvpStudioRuntimeInfo,
  getMvpStudioTelemetry,
  resetMvpStudioLoudness,
  setMvpStudioState,
} from "./audio/mvpStudioEngine";
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
  rememberPlaybackCycleTrack,
  isAdaptiveRadioName,
  isAutoMixEnabled,
  startRadioSession,
  syncLikedSongsPlaylist,
  type MusicRadioMode,
} from "./musicIntelligence";

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
export type MusicDspEngineMode = "studio_wasm" | "advanced_worklet" | "native_fallback" | "unavailable";
export type MusicImmersionStatus = "active" | "native_fallback" | "bypassed" | "unavailable";
export type MusicDspVerificationMode = "off" | "eq" | "spatial";
export type MusicEqTopology = "minimum_phase" | "linear_phase";
export type MusicHeadphoneMode = "off" | "wide" | "spatial" | "deep" | "stage" | "focus" | "bass_impact";
export type MusicOutputProfile = "reference" | "car_hifi" | "headphones" | "speaker";
export type MusicTransitionMode = "auto" | "gapless" | "smooth" | "off";
export type MusicParametricFilterType = "bell" | "low_shelf" | "high_shelf" | "high_pass" | "low_pass" | "notch";
export type MusicParametricBand = { enabled: boolean; frequency: number; gainDb: number; q: number; type: MusicParametricFilterType };


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
  power: preset("Power Training", -1.8, [[20, 1.5], [50, 3.3], [100, 2.8], [250, 0.8], [500, -0.5], [1000, 0], [2500, 1.5], [5000, 2.7], [10000, 2.1], [20000, 0.7]]),
  rock: preset("Rock", -1.6, [[20, 1.0], [63, 2.8], [160, 2.0], [500, -0.7], [1000, 0], [2500, 1.5], [5000, 2.5], [10000, 2.0], [20000, 0.7]]),
  hard_rock: preset("Hard Rock", -2.0, [[20, 1.2], [63, 3.2], [125, 2.5], [400, -1.0], [1000, 0], [2500, 2.0], [5000, 3.0], [10000, 2.3], [20000, 0.8]]),
  metal: preset("Metal", -2.1, [[20, 1.3], [63, 2.9], [160, 1.6], [400, -1.3], [800, -0.6], [2000, 1.8], [4000, 2.9], [8000, 2.8], [16000, 1.4], [20000, 0.5]]),
  alternative: preset("Alternative", -1.5, [[20, 0.6], [80, 2.2], [200, 1.4], [500, -0.7], [1250, 0.4], [3150, 1.9], [6300, 2.1], [12500, 1.2], [20000, 0]]),
  pop: preset("Pop", -1.4, [[20, 0.5], [80, 1.8], [250, 0.4], [630, -0.3], [1600, 1.0], [4000, 2.0], [8000, 1.9], [16000, 0.9], [20000, 0]]),
  hip_hop: preset("Hip-Hop", -2.4, [[20, 2.6], [40, 4.2], [80, 3.8], [160, 2.1], [400, -0.7], [1000, 0], [2500, 0.7], [6300, 1.2], [12500, 0.7], [20000, 0]]),
  edm: preset("EDM", -2.8, [[20, 3.0], [40, 4.7], [80, 3.8], [200, 0.8], [500, -0.7], [1250, 0], [3150, 1.3], [6300, 2.5], [10000, 2.7], [16000, 1.5], [20000, 0.5]]),
  bass_boost: preset("Bass Boost", -2.5, [[20, 3.4], [40, 4.4], [63, 4.5], [100, 3.8], [160, 2.2], [250, 0.8], [500, 0], [20000, 0]]),
  deep_bass: preset("Deep Bass", -3.0, [[20, 4.5], [31.5, 5.5], [50, 4.8], [80, 3.6], [125, 2.1], [250, 0.8], [500, 0], [20000, 0]]),
  punch: preset("Punch", -2.0, [[20, 0.7], [50, 2.2], [80, 3.4], [125, 2.8], [200, 1.3], [500, -0.7], [1000, 0], [3150, 1.8], [6300, 1.3], [20000, 0]]),
  vocal: preset("Vocal Clarity", -1.2, [[20, -2.2], [100, -1.4], [250, -0.4], [630, 0.7], [1250, 1.6], [2500, 2.7], [4000, 2.3], [8000, 0.8], [16000, 0], [20000, -0.5]]),
  acoustic: preset("Acoustic", -1.1, [[20, -1.4], [80, 0], [200, 0.7], [500, 0.4], [1000, 0.7], [2500, 1.5], [5000, 1.8], [10000, 1.1], [20000, 0]]),
  warm: preset("Warm", -1.1, [[20, 0.7], [80, 1.7], [250, 1.3], [630, 0.6], [1600, 0], [4000, -0.7], [10000, -1.3], [20000, -1.6]]),
  bright: preset("Bright", -1.7, [[20, -0.7], [100, 0], [500, 0], [1250, 0.7], [3150, 1.6], [6300, 2.5], [12500, 2.4], [20000, 1.4]]),
  late_night: preset("Late Night", -2.0, [[20, 0.6], [63, 1.2], [160, 0.6], [630, 0], [2500, -0.7], [5000, -1.3], [10000, -2.4], [20000, -3.2]]),
  headphones: preset("Headphones", -1.3, [[20, 0.5], [63, 1.3], [200, 0.3], [630, -0.3], [1600, 0.7], [4000, 1.3], [8000, 0.9], [16000, 0], [20000, -0.5]]),
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
  power: { ...PRO_PRESET_DEFAULT, transientAmount: 0.64 },
  rock: { ...PRO_PRESET_DEFAULT, transientAmount: 0.42 },
  hard_rock: { ...PRO_PRESET_DEFAULT, transientAmount: 0.62 },
  metal: { ...PRO_PRESET_DEFAULT, transientAmount: 0.70 },
  alternative: { ...PRO_PRESET_DEFAULT, transientAmount: 0.34 },
  pop: { ...PRO_PRESET_DEFAULT, transientAmount: 0.30 },
  hip_hop: { ...PRO_PRESET_DEFAULT, transientAmount: 0.25 },
  edm: { ...PRO_PRESET_DEFAULT, transientAmount: 0.44 },
  bass_boost: { ...PRO_PRESET_DEFAULT, transientAmount: 0.14 },
  deep_bass: { ...PRO_PRESET_DEFAULT, transientAmount: 0.10 },
  punch: { ...PRO_PRESET_DEFAULT, transientAmount: 0.72 },
  vocal: { ...PRO_PRESET_DEFAULT, transientAmount: 0.18 },
  acoustic: { ...PRO_PRESET_DEFAULT, transientAmount: 0.20 },
  warm: { ...PRO_PRESET_DEFAULT, transientAmount: 0.06 },
  bright: { ...PRO_PRESET_DEFAULT, transientAmount: 0.16 },
  late_night: { ...PRO_PRESET_DEFAULT, transientAmount: 0.03 },
  headphones: { ...PRO_PRESET_DEFAULT, transientAmount: 0.16 },
};

type StudioPresetPersonality = {
  transientScale: number;
  multibandAmount: number;
  dynamicEqAmount: number;
  outputCorrectionAmount: number;
  stereoIntegrityAmount: number;
};
const STUDIO_PRESET_PERSONALITIES: Record<BuiltInMusicEqPreset, StudioPresetPersonality> = {
  flat:        { transientScale: 0.65, multibandAmount: 0.42, dynamicEqAmount: 0.42, outputCorrectionAmount: 0.72, stereoIntegrityAmount: 0.55 },
  power:       { transientScale: 0.96, multibandAmount: 0.72, dynamicEqAmount: 0.66, outputCorrectionAmount: 0.84, stereoIntegrityAmount: 0.68 },
  rock:        { transientScale: 0.88, multibandAmount: 0.54, dynamicEqAmount: 0.50, outputCorrectionAmount: 0.78, stereoIntegrityAmount: 0.60 },
  hard_rock:   { transientScale: 0.96, multibandAmount: 0.66, dynamicEqAmount: 0.66, outputCorrectionAmount: 0.82, stereoIntegrityAmount: 0.64 },
  metal:       { transientScale: 1.00, multibandAmount: 0.72, dynamicEqAmount: 0.76, outputCorrectionAmount: 0.82, stereoIntegrityAmount: 0.68 },
  alternative: { transientScale: 0.84, multibandAmount: 0.52, dynamicEqAmount: 0.55, outputCorrectionAmount: 0.76, stereoIntegrityAmount: 0.60 },
  pop:         { transientScale: 0.78, multibandAmount: 0.50, dynamicEqAmount: 0.48, outputCorrectionAmount: 0.76, stereoIntegrityAmount: 0.58 },
  hip_hop:     { transientScale: 0.70, multibandAmount: 0.62, dynamicEqAmount: 0.44, outputCorrectionAmount: 0.84, stereoIntegrityAmount: 0.58 },
  edm:         { transientScale: 0.82, multibandAmount: 0.68, dynamicEqAmount: 0.52, outputCorrectionAmount: 0.84, stereoIntegrityAmount: 0.60 },
  bass_boost:  { transientScale: 0.60, multibandAmount: 0.58, dynamicEqAmount: 0.40, outputCorrectionAmount: 0.88, stereoIntegrityAmount: 0.55 },
  deep_bass:   { transientScale: 0.52, multibandAmount: 0.54, dynamicEqAmount: 0.36, outputCorrectionAmount: 0.90, stereoIntegrityAmount: 0.52 },
  punch:       { transientScale: 1.00, multibandAmount: 0.68, dynamicEqAmount: 0.54, outputCorrectionAmount: 0.80, stereoIntegrityAmount: 0.60 },
  vocal:       { transientScale: 0.56, multibandAmount: 0.42, dynamicEqAmount: 0.54, outputCorrectionAmount: 0.72, stereoIntegrityAmount: 0.55 },
  acoustic:    { transientScale: 0.58, multibandAmount: 0.38, dynamicEqAmount: 0.34, outputCorrectionAmount: 0.68, stereoIntegrityAmount: 0.50 },
  warm:        { transientScale: 0.42, multibandAmount: 0.36, dynamicEqAmount: 0.30, outputCorrectionAmount: 0.68, stereoIntegrityAmount: 0.50 },
  bright:      { transientScale: 0.50, multibandAmount: 0.42, dynamicEqAmount: 0.56, outputCorrectionAmount: 0.72, stereoIntegrityAmount: 0.54 },
  late_night:  { transientScale: 0.28, multibandAmount: 0.32, dynamicEqAmount: 0.26, outputCorrectionAmount: 0.66, stereoIntegrityAmount: 0.46 },
  headphones:  { transientScale: 0.52, multibandAmount: 0.38, dynamicEqAmount: 0.36, outputCorrectionAmount: 0.68, stereoIntegrityAmount: 0.50 },
};
const STUDIO_CUSTOM_PERSONALITY: StudioPresetPersonality = {
  transientScale: 0.78,
  multibandAmount: 0.52,
  dynamicEqAmount: 0.50,
  outputCorrectionAmount: 0.76,
  stereoIntegrityAmount: 0.58,
};
function currentStudioPersonality(): StudioPresetPersonality {
  return isBuiltInPreset(state.eqPreset) ? STUDIO_PRESET_PERSONALITIES[state.eqPreset] : STUDIO_CUSTOM_PERSONALITY;
}
// MVP_STUDIO_V4_MASTERING_REFINEMENT
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

  // WIDE is intentionally a pure stereo-width mode. No short delay, artificial
  // reflections or crossfeed are requested, so the WASM stage widens the musical
  // image without adding a Haas/echo character.
  wide: { label: "Wide", width: 100, depth: 0, crossfeed: 0, center: 50, bass: 0 },

  // SPATIAL and DEEP use the browser HRTF virtual-speaker path. These values are
  // retained as geometry controls/fallback hints rather than a second widener.
  spatial: { label: "Spatial", width: 76, depth: 56, crossfeed: 0, center: 50, bass: 0 },
  deep: { label: "Deep", width: 86, depth: 100, crossfeed: 0, center: 50, bass: 0 },

  // Legacy "stage" storage is reused as the premium 3D mode so existing saved
  // values remain readable without another migration key. 3D keeps the clean
  // direct feed and adds the strongest parallel HRTF height/depth layer.
  stage: { label: "3D Sound", width: 100, depth: 100, crossfeed: 0, center: 50, bass: 0 },
  focus: { label: "Off", width: 0, depth: 0, crossfeed: 0, center: 50, bass: 0 },
  bass_impact: { label: "Wide", width: 100, depth: 0, crossfeed: 0, center: 50, bass: 0 },
};
// MVP_STUDIO_V4_5_HEADPHONE_CONTINUITY
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
    description: "Studio HD headphone path: full-range clarity, high clean output and optional Wide / Spatial / Deep immersion.",
  },
  speaker: {
    label: "Bluetooth Speaker",
    shortLabel: "BLUETOOTH",
    description: "Clean HD Bluetooth path with maximum usable output, full-range clarity and automatic peak protection.",
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
  outputReserveDb: number;
  autoMakeupEnabled: boolean;
  availableHeadroomDb: number;
  autoMakeupDb: number;
  internalPeak: number;
  parametricEnabled: boolean;
  parametricBands: MusicParametricBand[];
  bassEngineEnabled: boolean;
  bassSubDb: number;
  bassPunchDb: number;
  bassBodyDb: number;
  bassTightness: number;
  toneEngineEnabled: boolean;
  presenceDb: number;
  clarityDb: number;
  airDb: number;
  deharshAmount: number;
  exciterEnabled: boolean;
  exciterAmount: number;
  saturationLow: number;
  saturationMid: number;
  saturationHigh: number;
  stereoFieldEnabled: boolean;
  stereoUserWidth: number;
  stereoCenterFocus: number;
  bassMonoHz: number;
  dynamicsRestoreEnabled: boolean;
  dynamicsRestoreAmount: number;
  smartDspEnabled: boolean;
  smartDspAmount: number;
  hdXpanderLevel: number;
  smartActivity: number;
  bassActivityDb: number;
  toneActivityDb: number;
  exciterActivity: number;
  deharshReductionDb: number;
  headphoneAdvancedEnabled: boolean;
  headphoneSpeakerAngle: number;
  headphoneDistance: number;
  headphoneReflections: number;
  headphoneWet: number;
  soundDnaEnabled: boolean;
  songMemoryEnabled: boolean;
  songMemoryActive: boolean;
  crossfadeSeconds: number;
  transitionMode: MusicTransitionMode;
  normalizationEnabled: boolean;
  multibandEnabled: boolean;
  dynamicEqEnabled: boolean;
  dynamicEqGainReductionDb: number;
  dynamicEqBandReductionDb: [number, number, number, number];
  outputCorrectionReductionDb: number;
  // MVP_STUDIO_WASM_V3_PHASE6_STEREO_INTEGRITY
  stereoCorrelation: number;
  stereoWidthPercent: number;
  stereoGuardReductionDb: number;
  loudnessGainDb: number;
  loudnessMomentaryLufs: number;
  // MVP_STUDIO_WASM_V3_PHASE5_LIVE_METERING
  truePeakDbtp: number;
  limiterGainReductionDb: number;
  transientBoostDb: number;
  multibandGainReductionDb: number;
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
  activeQueueTrackIds: "mvp_music_active_queue_track_ids_v1",
  volume: "mvp_music_volume_v2",
  eqEnabled: "mvp_music_eq_enabled",
  eqPreset: "mvp_music_eq_preset",
  eqGains: "mvp_music_eq_gains",
  eqTopology: "mvp_music_eq_topology_v13_8",
  preampDb: "mvp_music_eq_preamp_db",
  outputReserveDb: "mvp_music_output_reserve_db_v10",
  autoMakeupEnabled: "mvp_music_auto_makeup_v10",
  parametricEnabled: "mvp_music_parametric_enabled_v10",
  parametricBands: "mvp_music_parametric_bands_v10",
  bassEngineEnabled: "mvp_music_bass_engine_v10",
  bassSubDb: "mvp_music_bass_sub_v10",
  bassPunchDb: "mvp_music_bass_punch_v10",
  bassBodyDb: "mvp_music_bass_body_v10",
  bassTightness: "mvp_music_bass_tightness_v10",
  toneEngineEnabled: "mvp_music_tone_engine_v10",
  presenceDb: "mvp_music_presence_v10",
  clarityDb: "mvp_music_clarity_v10",
  airDb: "mvp_music_air_v10",
  deharshAmount: "mvp_music_deharsh_v10",
  exciterEnabled: "mvp_music_exciter_enabled_v10",
  exciterAmount: "mvp_music_exciter_amount_v10",
  saturationLow: "mvp_music_sat_low_v10",
  saturationMid: "mvp_music_sat_mid_v10",
  saturationHigh: "mvp_music_sat_high_v10",
  stereoFieldEnabled: "mvp_music_stereo_field_v10",
  stereoUserWidth: "mvp_music_stereo_width_v10",
  stereoCenterFocus: "mvp_music_center_focus_v10",
  bassMonoHz: "mvp_music_bass_mono_hz_v10",
  dynamicsRestoreEnabled: "mvp_music_dynamics_restore_v10",
  dynamicsRestoreAmount: "mvp_music_dynamics_restore_amount_v10",
  smartDspEnabled: "mvp_music_smart_dsp_v10",
  smartDspAmount: "mvp_music_smart_dsp_amount_v10",
  hdXpanderLevel: "mvp_music_hd_xpander_level_v1",
  headphoneAdvancedEnabled: "mvp_music_headphone_advanced_v10",
  headphoneSpeakerAngle: "mvp_music_headphone_angle_v10",
  headphoneDistance: "mvp_music_headphone_distance_v10",
  headphoneReflections: "mvp_music_headphone_reflections_v10",
  headphoneWet: "mvp_music_headphone_wet_v10",
  soundDnaEnabled: "mvp_music_sound_dna_enabled_v10",
  soundDnaProfile: "mvp_music_sound_dna_profile_v10",
  songMemoryEnabled: "mvp_music_song_memory_enabled_v10",
  songMemoryProfiles: "mvp_music_song_memory_profiles_v10",
  songMemoryBaseline: "mvp_music_song_memory_baseline_v10",
  crossfadeSeconds: "mvp_music_crossfade_seconds",
  transitionMode: "mvp_music_transition_mode_v1",
  normalizationEnabled: "mvp_music_volume_match_enabled_v1",
  multibandEnabled: "mvp_music_multiband_enabled_v13_9",
  dynamicEqEnabled: "mvp_music_dynamic_eq_enabled_v1",
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

const AUDIO_ENGINE_VERSION = "v22-r69-clean-output-gain";
const OUTPUT_PROFILE_STATE_VERSION = 1;
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
        preamp: Math.max(-12, Math.min(6, Number(parsed.preamp))),
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
    if (Number.isFinite(value)) return Math.max(-12, Math.min(6, value));
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
function readTransitionMode(): MusicTransitionMode {
  const value = readStored(STORAGE_KEYS.transitionMode);
  return value === "gapless" || value === "smooth" || value === "off" ? value : "auto";
}

function defaultParametricBands(): MusicParametricBand[] {
  return [
    { enabled: false, frequency: 80, gainDb: 0, q: 0.8, type: "bell" },
    { enabled: false, frequency: 250, gainDb: 0, q: 1.0, type: "bell" },
    { enabled: false, frequency: 1000, gainDb: 0, q: 1.0, type: "bell" },
    { enabled: false, frequency: 3200, gainDb: 0, q: 1.0, type: "bell" },
    { enabled: false, frequency: 7000, gainDb: 0, q: 0.9, type: "bell" },
    { enabled: false, frequency: 12000, gainDb: 0, q: 0.7, type: "high_shelf" },
  ];
}
function readParametricBands(): MusicParametricBand[] {
  try {
    const raw = readStored(STORAGE_KEYS.parametricBands);
    if (!raw) return defaultParametricBands();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultParametricBands();
    return defaultParametricBands().map((fallback, index) => {
      const band = parsed[index] || {};
      const type = ["bell","low_shelf","high_shelf","high_pass","low_pass","notch"].includes(String(band.type)) ? band.type as MusicParametricFilterType : fallback.type;
      return {
        enabled: Boolean(band.enabled),
        frequency: Math.max(20, Math.min(20000, Number(band.frequency) || fallback.frequency)),
        gainDb: Math.max(-12, Math.min(12, Number(band.gainDb) || 0)),
        q: Math.max(0.15, Math.min(12, Number(band.q) || fallback.q)),
        type,
      };
    });
  } catch { return defaultParametricBands(); }
}
function parametricTypeCode(type: MusicParametricFilterType) {
  return type === "low_shelf" ? 1 : type === "high_shelf" ? 2 : type === "high_pass" ? 3 : type === "low_pass" ? 4 : type === "notch" ? 5 : 0;
}

function migrateAudioFidelitySettings() {
  if (readStored(STORAGE_KEYS.audioEngineVersion) === AUDIO_ENGINE_VERSION) return;
  const presetName = readEqPreset();
  if (isBuiltInPreset(presetName)) {
    const definition = MUSIC_EQ_PRESETS[presetName];
    savePlayerSetting(STORAGE_KEYS.eqGains, JSON.stringify(definition.gains));
    savePlayerSetting(STORAGE_KEYS.preampDb, String(definition.preamp));
  } else if (isCustomPresetSlot(presetName)) {
    const definition = readCustomPreset(presetName);
    if (definition) {
      savePlayerSetting(STORAGE_KEYS.eqGains, JSON.stringify(definition.gains));
      savePlayerSetting(STORAGE_KEYS.preampDb, String(definition.preamp));
    }
  }
  if (!readStored(STORAGE_KEYS.eqTopology)) savePlayerSetting(STORAGE_KEYS.eqTopology, "minimum_phase");
  // Core Studio processing starts active, but Volume Match is an optional utility.
  // It stays OFF unless the user explicitly enables track-to-track leveling.
  savePlayerSetting(STORAGE_KEYS.eqEnabled, "true");
  savePlayerSetting(STORAGE_KEYS.normalizationEnabled, "false");
  savePlayerSetting(STORAGE_KEYS.multibandEnabled, "false");
  savePlayerSetting(STORAGE_KEYS.dynamicEqEnabled, "false");
  if (!readStored(STORAGE_KEYS.outputReserveDb)) savePlayerSetting(STORAGE_KEYS.outputReserveDb, "3");
  if (!readStored(STORAGE_KEYS.autoMakeupEnabled)) savePlayerSetting(STORAGE_KEYS.autoMakeupEnabled, "true");
  if (!readStored(STORAGE_KEYS.parametricBands)) savePlayerSetting(STORAGE_KEYS.parametricBands, JSON.stringify(defaultParametricBands()));
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
  outputReserveDb: readNumber(STORAGE_KEYS.outputReserveDb, 3, 0, 12),
  autoMakeupEnabled: readBoolean(STORAGE_KEYS.autoMakeupEnabled, true),
  availableHeadroomDb: 24,
  autoMakeupDb: 0,
  internalPeak: 0,
  parametricEnabled: readBoolean(STORAGE_KEYS.parametricEnabled, false),
  parametricBands: readParametricBands(),
  bassEngineEnabled: readBoolean(STORAGE_KEYS.bassEngineEnabled, false),
  bassSubDb: readNumber(STORAGE_KEYS.bassSubDb, 0, -8, 8),
  bassPunchDb: readNumber(STORAGE_KEYS.bassPunchDb, 0, -8, 8),
  bassBodyDb: readNumber(STORAGE_KEYS.bassBodyDb, 0, -8, 8),
  bassTightness: readNumber(STORAGE_KEYS.bassTightness, 55, 0, 100),
  toneEngineEnabled: readBoolean(STORAGE_KEYS.toneEngineEnabled, false),
  presenceDb: readNumber(STORAGE_KEYS.presenceDb, 0, -8, 8),
  clarityDb: readNumber(STORAGE_KEYS.clarityDb, 0, -8, 8),
  airDb: readNumber(STORAGE_KEYS.airDb, 0, -8, 8),
  deharshAmount: readNumber(STORAGE_KEYS.deharshAmount, 0, 0, 100),
  exciterEnabled: readBoolean(STORAGE_KEYS.exciterEnabled, false),
  exciterAmount: readNumber(STORAGE_KEYS.exciterAmount, 0, 0, 100),
  saturationLow: readNumber(STORAGE_KEYS.saturationLow, 0, 0, 100),
  saturationMid: readNumber(STORAGE_KEYS.saturationMid, 0, 0, 100),
  saturationHigh: readNumber(STORAGE_KEYS.saturationHigh, 0, 0, 100),
  stereoFieldEnabled: readBoolean(STORAGE_KEYS.stereoFieldEnabled, false),
  stereoUserWidth: readNumber(STORAGE_KEYS.stereoUserWidth, 100, 50, 165),
  stereoCenterFocus: readNumber(STORAGE_KEYS.stereoCenterFocus, 100, 75, 130),
  bassMonoHz: readNumber(STORAGE_KEYS.bassMonoHz, 100, 60, 160),
  dynamicsRestoreEnabled: readBoolean(STORAGE_KEYS.dynamicsRestoreEnabled, false),
  dynamicsRestoreAmount: readNumber(STORAGE_KEYS.dynamicsRestoreAmount, 0, 0, 100),
  smartDspEnabled: readBoolean(STORAGE_KEYS.smartDspEnabled, false),
  smartDspAmount: readNumber(STORAGE_KEYS.smartDspAmount, 30, 0, 100),
  hdXpanderLevel: readNumber(STORAGE_KEYS.hdXpanderLevel, 0, 0, 3),
  smartActivity: 0,
  bassActivityDb: 0,
  toneActivityDb: 0,
  exciterActivity: 0,
  deharshReductionDb: 0,
  headphoneAdvancedEnabled: readBoolean(STORAGE_KEYS.headphoneAdvancedEnabled, false),
  headphoneSpeakerAngle: readNumber(STORAGE_KEYS.headphoneSpeakerAngle, 30, 15, 60),
  headphoneDistance: readNumber(STORAGE_KEYS.headphoneDistance, 35, 0, 100),
  headphoneReflections: readNumber(STORAGE_KEYS.headphoneReflections, 6, 0, 30),
  headphoneWet: readNumber(STORAGE_KEYS.headphoneWet, 24, 0, 100),
  soundDnaEnabled: readBoolean(STORAGE_KEYS.soundDnaEnabled, false),
  songMemoryEnabled: readBoolean(STORAGE_KEYS.songMemoryEnabled, false),
  songMemoryActive: false,
  crossfadeSeconds: readNumber(STORAGE_KEYS.crossfadeSeconds, 0, 0, 8),
  transitionMode: readTransitionMode(),
  normalizationEnabled: readBoolean(STORAGE_KEYS.normalizationEnabled, false),
  multibandEnabled: readBoolean(STORAGE_KEYS.multibandEnabled, false),
  dynamicEqEnabled: readBoolean(STORAGE_KEYS.dynamicEqEnabled, false),
  dynamicEqGainReductionDb: 0,
  dynamicEqBandReductionDb: [0, 0, 0, 0],
  outputCorrectionReductionDb: 0,
  stereoCorrelation: 1,
  stereoWidthPercent: 100,
  stereoGuardReductionDb: 0,
  loudnessGainDb: 0,
  loudnessMomentaryLufs: -70,
  truePeakDbtp: -120,
  limiterGainReductionDb: 0,
  transientBoostDb: 0,
  multibandGainReductionDb: 0,
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

// One-time device-path cleanup for the two profiles that were previously most
// vulnerable to inherited/stacked DSP. Car / Hi-Fi is deliberately preserved.
if (
  (state.outputProfile === "headphones" || state.outputProfile === "speaker") &&
  !readOutputProfileSnapshot(state.outputProfile)
) {
  const cleanProfile = cleanOutputProfileSnapshot(state.outputProfile);
  state = {
    ...state,
    ...cleanProfile,
    eqGains: [...cleanProfile.eqGains],
    parametricBands: cleanProfile.parametricBands.map((band) => ({ ...band })),
  };
  persistSnapshotToActiveStorage(cleanProfile);
  writeOutputProfileSnapshot(state.outputProfile, cleanProfile);
}

// R69A: speaker cleanup is invoked after its migration key is initialized.
// Calling it here used to hit the const key while it was still in the TDZ and
// could crash the entire app before React mounted.

let audioElement: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let mediaSource: MediaElementAudioSourceNode | null = null;
let masterVolumeGain: GainNode | null = null;
let referenceRouteGain: GainNode | null = null;
let preampGain: GainNode | null = null;
let studioProcessorNode: AudioWorkletNode | null = null;
let transientProcessorNode: AudioWorkletNode | null = null;
let loudnessNormalizerNode: AudioWorkletNode | null = null;
let multibandProcessorNode: AudioWorkletNode | null = null;
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
// Studio headphone virtualization uses two browser HRTF virtual loudspeakers before the WASM mastering/limiter path.
let studioDirectInputGain: GainNode | null = null;
let studioHrtfSplitter: ChannelSplitterNode | null = null;
let studioHrtfLeftBus: GainNode | null = null;
let studioHrtfRightBus: GainNode | null = null;
let studioHrtfLeftToLeft: GainNode | null = null;
let studioHrtfRightToLeft: GainNode | null = null;
let studioHrtfRightToRight: GainNode | null = null;
let studioHrtfLeftToRight: GainNode | null = null;
let studioHrtfLeftPanner: PannerNode | null = null;
let studioHrtfRightPanner: PannerNode | null = null;
let studioHrtfSum: GainNode | null = null;
let studioHrtfBassShelf: BiquadFilterNode | null = null;
let studioHrtfReflectionDelayA: DelayNode | null = null;
let studioHrtfReflectionDelayB: DelayNode | null = null;
let studioHrtfReflectionGainA: GainNode | null = null;
let studioHrtfReflectionGainB: GainNode | null = null;
let studioHrtfInputGain: GainNode | null = null;
let studioInputBus: GainNode | null = null;
// R74 Max-HD loudness stage. Headphones/Bluetooth use ONE coordinated loudness
// system: the native compressor gently creates crest-factor room at unity input,
// then the WASM adaptive makeup stage fills only the clean room that actually
// exists before the true-peak limiter. There is no fixed pre-compressor boost.
let virtualAmpGainNode: GainNode | null = null;
let loudnessCompressorNode: DynamicsCompressorNode | null = null;
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
let postLimiterVolumeGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let analyserBuffer: Uint8Array<ArrayBuffer> | null = null;
let visualizerEnvelope = new Float32Array(64);
let mediaSourceConnected = false;
let graphBuildPromise: Promise<void> | null = null;
let loadingTrackId: string | null = null;
let transitionPreloadAudio: HTMLAudioElement | null = null;
let transitionPreloadTrackId: string | null = null;
let transitionPreloadUrl: string | null = null;
let studioRecoveryInFlight = false;
let lastStudioRecoveryAt = 0;
let timeSaveTimer = 0;
let recordedPlayToken = "";
let transportQueue: Promise<void> = Promise.resolve();
let playbackIntent = false;
let mediaErrorRecoveryInFlight = false;
let lastMediaErrorRecoveryAt = 0;
let lastMediaErrorRecoveryTrackId = "";
let suppressNextRecoveredPlayCount = false;
let playbackStallRecoveryInFlight = false;
let playbackStallHeartbeat: number | null = null;
let lastPlaybackProgressAt = 0;
let lastPlaybackPosition = 0;
const MEDIA_ERROR_AUTO_RETRY_COOLDOWN_MS = 20_000;
const PLAYBACK_STALL_RECOVERY_MS = 10_000;
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
  // R69 CLEAN OUTPUT: the normal volume control is a true post-limiter attenuator.
  // 100% = unity (0 dB). It never adds hidden boost and therefore can never
  // overdrive EQ/DSP simply because the user raised the volume slider.
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
function graphicEqProcessingRequested() {
  // The visible 31-band curve is the tonal source of truth for built-in presets,
  // custom presets, and manual edits. No hidden duplicate preset EQ is layered on top.
  return eqProcessingRequested() && !eqProofActive();
}
function professionalProcessingRequested() {
  // The legacy professional filter bank is retained only for the explicit EQ proof tool.
  return eqProofActive();
}
function currentProPreset() {
  return eqProofActive() ? DSP_EQ_PROOF_PRESET : MUSIC_PRO_PRESETS.flat;
}
function currentTransientAmount() {
  if (eqProofActive()) return 0;
  if (!eqProcessingRequested() || !isBuiltInPreset(state.eqPreset)) return 0;
  // Headphones are a clean Studio HD path. Bluetooth Speaker also starts clean;
  // its adaptive transient personality is only allowed when Smart DSP is
  // deliberately enabled.
  if (state.outputProfile === "headphones") return 0;
  if (state.outputProfile === "speaker" && !state.smartDspEnabled) return 0;
  return MUSIC_PRO_PRESETS[state.eqPreset].transientAmount;
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
function calculateProcessingGain() {
  if (state.outputProfile === "reference") {
    return { effectivePreampDb: 0, autoHeadroomDb: 0, makeupDb: 0, referenceMatchDb: 0 };
  }
  // R9.2: the Preamp Trim readout is the requested gain. Do not silently subtract
  // EQ-derived headroom from the user control. The protected limiter is the final
  // peak-safety stage on processed paths.
  const simplifiedProfile = state.outputProfile === "headphones" || state.outputProfile === "speaker";
  const requested = simplifiedProfile
    ? 0
    : eqProcessingRequested()
      ? Math.max(-12, Math.min(6, Number(state.preampDb) || 0))
      : 0;
  const response = measureProcessingResponse();
  const makeupDb = currentOutputTuning()?.makeupDb ?? 0;
  // R70: simplified Headphones / Bluetooth Speaker never receive a hidden EQ
  // safety trim. Their clean-output stage and limiter handle real peaks instead.
  const autoHeadroomDb = 0;
  const effectivePreampDb = requested;
  const measuredMatch = Number.isFinite(lastReferenceRmsDb) && Number.isFinite(lastProcessedRmsDb)
    ? Math.max(-6, Math.min(3, lastProcessedRmsDb - lastReferenceRmsDb))
    : Math.max(-6, Math.min(3, effectivePreampDb + response.averageDb + makeupDb));
  return {
    effectivePreampDb,
    autoHeadroomDb,
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
  if (mode === "deep" || mode === "stage") return 3;
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

  const widthScale = enabled ? (proof ? 1.85 : 1 + width * 0.42) : 1;
  // Never turn the clean fallback signal down just because immersion is on.
  // The final limiter owns exceptional peaks; width is an enhancement, not a trim.
  const direct = (1 + widthScale) / 2;
  const widthCross = (1 - widthScale) / 2;
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
function studioHrtfRequested() {
  if (state.dspBypass || state.outputProfile !== "headphones") return false;
  return state.headphoneMode === "spatial" || state.headphoneMode === "deep" || state.headphoneMode === "stage";
}

function configureStudioHrtf(now: number) {
  if (!audioContext || !studioDirectInputGain || !studioHrtfInputGain) return;
  const active = studioHrtfRequested() && Boolean(studioHrtfLeftPanner && studioHrtfRightPanner && studioHrtfBassShelf);
  // R71 PARALLEL IMMERSION: Studio HD never disappears. Earlier builds switched
  // the dry feed OFF and replaced the song with HRTF, which is exactly why
  // Spatial/Deep could sound weak and muddy. Keep the dry path at full unity and
  // blend only a controlled, bass-light spatial cue layer on top.
  setAudioParam(studioDirectInputGain.gain, 1, now, 0.018);
  const mode = state.headphoneMode;
  const threeDMode = mode === "stage";
  const deepMode = mode === "deep";
  const spatialMode = mode === "spatial";
  const wetMix = active ? (threeDMode ? 0.34 : deepMode ? 0.27 : 0.20) : 0;
  setAudioParam(studioHrtfInputGain.gain, wetMix, now, 0.018);
  if (!active || !studioHrtfLeftPanner || !studioHrtfRightPanner || !studioHrtfBassShelf) {
    if (studioHrtfReflectionGainA) setAudioParam(studioHrtfReflectionGainA.gain, 0, now, 0.025);
    if (studioHrtfReflectionGainB) setAudioParam(studioHrtfReflectionGainB.gain, 0, now, 0.025);
    return;
  }

  const proof = state.dspVerificationMode === "spatial";
  const width = proof ? 1 : Math.max(0, Math.min(1, state.headphoneWidth / 100));
  const depth = proof ? 1 : Math.max(0, Math.min(1, state.headphoneDepth / 100));
  const center = proof ? 0.5 : Math.max(0, Math.min(1, state.headphoneCenter / 100));
  const bass = proof ? 0 : Math.max(0, Math.min(1, state.headphoneBassImpact / 100));

  // mode flags are declared above because they also determine the parallel wet mix.

  // HRTF geometry: Spatial is a natural pair of front speakers; Deep moves the
  // same pair farther forward and slightly inward to add front/back separation.
  // rolloffFactor is zero, so perceived distance never becomes a hidden volume cut.
  const baseAngle = threeDMode ? 42 : deepMode ? 31 : 36;
  const widthSpan = threeDMode ? 18 : deepMode ? 14 : 18;
  const centerPull = Math.max(0, center - 0.5) * 8;
  const angleDeg = Math.max(18, Math.min(62, baseAngle + width * widthSpan - centerPull));
  const angle = angleDeg * Math.PI / 180;
  const distance = threeDMode ? (2.15 + depth * 1.20) : deepMode ? (1.75 + depth * 0.95) : (1.15 + depth * 0.40);
  const x = Math.sin(angle) * distance;
  const z = -Math.cos(angle) * distance;
  const y = threeDMode ? 0.32 + depth * 0.18 : 0;

  setAudioParam(studioHrtfLeftPanner.positionX, -x, now, 0.045);
  setAudioParam(studioHrtfLeftPanner.positionY, y, now, 0.045);
  setAudioParam(studioHrtfLeftPanner.positionZ, z, now, 0.045);
  setAudioParam(studioHrtfRightPanner.positionX, x, now, 0.045);
  setAudioParam(studioHrtfRightPanner.positionY, y, now, 0.045);
  setAudioParam(studioHrtfRightPanner.positionZ, z, now, 0.045);
  // This node is a high-pass in R71. Keep bass/kick entirely on the dry Studio
  // HD path so spatial cues can never hollow or smear the low end.
  setAudioParam(studioHrtfBassShelf.frequency, threeDMode ? 175 : deepMode ? 155 : 135, now, 0.05);
  void bass;

  // HRTF already supplies the localization cues. Reflections are deliberately
  // tiny and only add a hint of depth, never an audible reverb tail.
  const reflectionAmount = threeDMode
    ? Math.min(0.030, depth * 0.030)
    : deepMode
      ? Math.min(0.022, depth * 0.022)
      : spatialMode
        ? Math.min(0.008, depth * 0.008)
        : 0;
  if (studioHrtfReflectionDelayA) setAudioParam(studioHrtfReflectionDelayA.delayTime, threeDMode ? 0.017 : deepMode ? 0.013 : 0.009, now, 0.05);
  if (studioHrtfReflectionDelayB) setAudioParam(studioHrtfReflectionDelayB.delayTime, threeDMode ? 0.027 : deepMode ? 0.021 : 0.014, now, 0.05);
  if (studioHrtfReflectionGainA) setAudioParam(studioHrtfReflectionGainA.gain, reflectionAmount, now, 0.05);
  if (studioHrtfReflectionGainB) setAudioParam(studioHrtfReflectionGainB.gain, reflectionAmount * 0.55, now, 0.05);
}

function currentImmersionStatus(): MusicImmersionStatus {
  if (state.outputProfile !== "headphones" || state.dspBypass) return "bypassed";
  const requested = state.headphoneMode !== "off" || state.dspVerificationMode === "spatial";
  if (!requested) return "bypassed";
  if (studioHrtfRequested() && studioHrtfLeftPanner && studioHrtfRightPanner) return "active";
  if (studioProcessorNode && state.dspEngineMode === "studio_wasm") return "active";
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
  const presetAmount = currentTransientAmount();
  if (enabled) setAudioParam(enabled, active && presetAmount > 0.001 ? 1 : 0, now, 0.02);
  if (amount) setAudioParam(amount, Math.max(0, Math.min(1, presetAmount * sourceTransientScale())), now, 0.035);
}

function applyMultibandSettings(now: number, active: boolean) {
  if (!multibandProcessorNode) return;
  const enabled = workletParam(multibandProcessorNode, "enabled");
  const amount = workletParam(multibandProcessorNode, "amount");
  const profileAmount =
    state.outputProfile === "speaker" ? 0.44 :
    state.outputProfile === "car_hifi" ? 0.36 :
    state.outputProfile === "headphones" ? 0.30 :
    0.28;
  if (enabled) setAudioParam(enabled, active && state.multibandEnabled ? 1 : 0, now, 0.02);
  if (amount) setAudioParam(amount, profileAmount, now, 0.06);
}

function applyLoudnessNormalizationSettings(now: number, active: boolean) {
  if (!loudnessNormalizerNode) return;
  const enabled = workletParam(loudnessNormalizerNode, "enabled");
  const target = workletParam(loudnessNormalizerNode, "targetLufs");
  if (enabled) setAudioParam(enabled, active && state.normalizationEnabled ? 1 : 0, now, 0.03);
  if (target) setAudioParam(target, -10, now, 0.12);
}

function applyLimiterSettings(now: number, limiterActive: boolean) {
  if (limiterWorkletNode) {
    const enabled = workletParam(limiterWorkletNode, "enabled");
    const ceiling = workletParam(limiterWorkletNode, "ceilingDb");
    const release = workletParam(limiterWorkletNode, "releaseMs");
    if (enabled) setAudioParam(enabled, limiterActive ? 1 : 0, now, 0.01);
    if (ceiling) setAudioParam(ceiling, state.outputProfile === "car_hifi" ? -1.2 : -1.0, now, 0.02);
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
  if (studioProcessorNode && state.dspEngineMode === "studio_wasm") {
    applyStudioProcessingSettings(now);
    return;
  }
  configureProfessionalFilters(now);
  configureGraphicEq(now);
  configureOutputFilters(now);
  const { effectivePreampDb, autoHeadroomDb, makeupDb, referenceMatchDb } = calculateProcessingGain();
  const pureReference = state.outputProfile === "reference";
  const abBypass = !pureReference && state.dspBypass;
  const processed = !pureReference && !abBypass;
  const headphones = processed && state.outputProfile === "headphones" && Boolean(headphoneProcessorNode || nativeImmersionAvailable());
  const standard = processed && !headphones;

  // Keep the DSP input at unity. User volume lives after the limiter so raising
  // volume cannot change how hard the signal drives EQ, DSP, or limiting.
  if (masterVolumeGain) setAudioParam(masterVolumeGain.gain, 1, now, 0.01);
  applyVirtualAmpSettings(now);
  if (postLimiterVolumeGain) setAudioParam(postLimiterVolumeGain.gain, volumeToGain(state.volume), now, 0.01);
  if (referenceRouteGain) {
    const referenceGain = pureReference ? 1 : abBypass ? dbToGain(referenceMatchDb) : 0;
    setAudioParam(referenceRouteGain.gain, referenceGain, now, 0.008);
  }
  if (standardRouteGain) setAudioParam(standardRouteGain.gain, standard ? 1 : 0, now, 0.008);
  if (headphoneRouteGain) setAudioParam(headphoneRouteGain.gain, headphones ? 1 : 0, now, 0.008);
  if (preampGain) setAudioParam(preampGain.gain, dbToGain(effectivePreampDb), now, 0.018);
  const compatibilityCleanDriveDb =
    processed && (state.outputProfile === "headphones" || state.outputProfile === "speaker")
      ? Math.min(2, Math.max(0, state.outputReserveDb))
      : 0;
  if (makeupGain) setAudioParam(makeupGain.gain, dbToGain(pureReference ? 0 : makeupDb + compatibilityCleanDriveDb), now, 0.025);

  applyTransientSettings(now, processed);
  applyMultibandSettings(now, processed);
  applyLoudnessNormalizationSettings(now, processed);
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
  clearTransitionPreload();
  [
    mediaSource,
    masterVolumeGain,
    referenceRouteGain,
    preampGain,
    studioProcessorNode,
    transientProcessorNode,
    loudnessNormalizerNode,
    multibandProcessorNode,
    professionalHighpass,
    professionalLowShelf,
    professionalHighShelf,
    outputHighpass,
    outputLowShelf,
    outputPresence,
    outputClarity,
    outputHighShelf,
    standardRouteGain,
    studioDirectInputGain,
    studioHrtfSplitter,
    studioHrtfLeftBus,
    studioHrtfRightBus,
    studioHrtfLeftToLeft,
    studioHrtfRightToLeft,
    studioHrtfRightToRight,
    studioHrtfLeftToRight,
    studioHrtfLeftPanner,
    studioHrtfRightPanner,
    studioHrtfSum,
    studioHrtfBassShelf,
    studioHrtfReflectionDelayA,
    studioHrtfReflectionDelayB,
    studioHrtfReflectionGainA,
    studioHrtfReflectionGainB,
    studioHrtfInputGain,
    studioInputBus,
    virtualAmpGainNode,
    loudnessCompressorNode,
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
    postLimiterVolumeGain,
    musicGain,
  ].forEach(disconnectNode);
  professionalPeakFilters.forEach(disconnectNode);
  equalizerFilters.forEach(disconnectNode);
  mediaSource = null;
  masterVolumeGain = null;
  referenceRouteGain = null;
  preampGain = null;
  try { studioProcessorNode?.port.close(); } catch { /* already closed */ }
  studioProcessorNode = null;
  transientProcessorNode = null;
  loudnessNormalizerNode = null;
  multibandProcessorNode = null;
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
  studioDirectInputGain = null;
  studioHrtfSplitter = null;
  studioHrtfLeftBus = null;
  studioHrtfRightBus = null;
  studioHrtfLeftToLeft = null;
  studioHrtfRightToLeft = null;
  studioHrtfRightToRight = null;
  studioHrtfLeftToRight = null;
  studioHrtfLeftPanner = null;
  studioHrtfRightPanner = null;
  studioHrtfSum = null;
  studioHrtfBassShelf = null;
  studioHrtfReflectionDelayA = null;
  studioHrtfReflectionDelayB = null;
  studioHrtfReflectionGainA = null;
  studioHrtfReflectionGainB = null;
  studioHrtfInputGain = null;
  studioInputBus = null;
  virtualAmpGainNode = null;
  loudnessCompressorNode = null;
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
  postLimiterVolumeGain = null;
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

function studioOutputProfileCode(): 0 | 1 | 2 {
  if (state.outputProfile === "headphones") return 1;
  if (state.outputProfile === "speaker") return 2;
  return 0;
}
function calculateStudioGain() {
  // R70 CLEAN-HD GAIN ARCHITECTURE
  // Headphones and Bluetooth Speaker never receive a hidden blanket trim from
  // an EQ preset. Their musical EQ is allowed to remain exactly as selected and
  // the true-peak stage deals only with actual peaks. Car / Hi-Fi keeps its
  // explicit user preamp because that profile intentionally exposes advanced DSP.
  if (state.outputProfile === "reference") {
    return { effectivePreampDb: 0, autoHeadroomDb: 0, referenceMatchDb: 0 };
  }

  const simplifiedProfile = state.outputProfile === "headphones" || state.outputProfile === "speaker";
  const requested = simplifiedProfile
    ? 0
    : state.eqEnabled
      ? Math.max(-12, Math.min(6, Number(state.preampDb) || 0))
      : 0;

  const autoHeadroomDb = 0;
  const effectivePreampDb = requested;
  const measuredMatch = Number.isFinite(lastReferenceRmsDb) && Number.isFinite(lastProcessedRmsDb)
    ? Math.max(-6, Math.min(3, lastProcessedRmsDb - lastReferenceRmsDb))
    : Math.max(-6, Math.min(3, effectivePreampDb));

  return { effectivePreampDb, autoHeadroomDb, referenceMatchDb: measuredMatch };
}

function cleanHdHighOutputActive() {
  return (state.outputProfile === "headphones" || state.outputProfile === "speaker") && state.outputReserveDb >= 5.5;
}

function applyVirtualAmpSettings(now: number) {
  if (!virtualAmpGainNode || !loudnessCompressorNode) return;
  const simplifiedProfile = state.outputProfile === "headphones" || state.outputProfile === "speaker";
  const active = !state.dspBypass && simplifiedProfile;

  // R77 fallback parity: crest management stays active with High/Max Output
  // both ON and OFF. High/Max Output only controls clean post-crest makeup.
  setAudioParam(virtualAmpGainNode.gain, 1, now, 0.025);

  if (active) {
    setAudioParam(loudnessCompressorNode.threshold, -4.8, now, 0.05);
    setAudioParam(loudnessCompressorNode.knee, 5.5, now, 0.05);
    setAudioParam(loudnessCompressorNode.ratio, 1.55, now, 0.05);
    setAudioParam(loudnessCompressorNode.attack, 0.0045, now, 0.05);
    setAudioParam(loudnessCompressorNode.release, 0.12, now, 0.05);
  } else {
    setAudioParam(loudnessCompressorNode.threshold, 0, now, 0.05);
    setAudioParam(loudnessCompressorNode.knee, 0, now, 0.05);
    setAudioParam(loudnessCompressorNode.ratio, 1, now, 0.05);
    setAudioParam(loudnessCompressorNode.attack, 0.003, now, 0.05);
    setAudioParam(loudnessCompressorNode.release, 0.12, now, 0.05);
  }
}

function hdXpanderProfile(level: number) {
  const normalized = Math.max(0, Math.min(3, Math.round(Number(level) || 0)));
  // R75: each level must be an unmistakable A/B change, not a decorative button.
  // These remain parallel restoration boosts and never rewrite the 31-band EQ.
  if (normalized === 1) return { level: 1, presenceDb: 0.75, clarityDb: 1.25, airDb: 1.60, exciterAmount: 0.040, transientAmount: 0.14 };
  if (normalized === 2) return { level: 2, presenceDb: 1.25, clarityDb: 2.10, airDb: 2.85, exciterAmount: 0.072, transientAmount: 0.24 };
  if (normalized === 3) return { level: 3, presenceDb: 1.85, clarityDb: 3.10, airDb: 4.10, exciterAmount: 0.110, transientAmount: 0.36 };
  return { level: 0, presenceDb: 0, clarityDb: 0, airDb: 0, exciterAmount: 0, transientAmount: 0 };
}

function applyStudioProcessingSettings(now: number) {
  if (!audioContext || !studioProcessorNode) return;
  const { effectivePreampDb, autoHeadroomDb, referenceMatchDb } = calculateStudioGain();
  const pureReference = state.outputProfile === "reference";
  const abBypass = !pureReference && state.dspBypass;
  const processed = !pureReference && !abBypass;
  const cleanHdProfile = state.outputProfile === "headphones" || state.outputProfile === "speaker";
  const xpander = hdXpanderProfile(processed && cleanHdProfile ? state.hdXpanderLevel : 0);
  // Studio path also runs at unity into WASM. Listener volume is applied after
  // the WASM limiter, preventing volume-dependent distortion.
  if (masterVolumeGain) setAudioParam(masterVolumeGain.gain, 1, now, 0.01);
  applyVirtualAmpSettings(now);
  if (postLimiterVolumeGain) setAudioParam(postLimiterVolumeGain.gain, volumeToGain(state.volume), now, 0.01);
  if (referenceRouteGain) {
    setAudioParam(referenceRouteGain.gain, pureReference ? 1 : abBypass ? dbToGain(referenceMatchDb) : 0, now, 0.008);
  }
  if (standardRouteGain) setAudioParam(standardRouteGain.gain, processed ? 1 : 0, now, 0.008);
  configureStudioHrtf(now);
  const proof = state.dspVerificationMode === "spatial" && state.outputProfile === "headphones" && !state.dspBypass;
  const hrtfImmersion = processed && studioHrtfRequested();
  const headphoneEnabled =
    processed &&
    state.outputProfile === "headphones" &&
    state.headphoneMode !== "off" &&
    !hrtfImmersion;
  // R75: simplified Headphones/Speaker presets are EQ ONLY. IMPACT/PUNCH now
  // drive the actual stereo-linked transient shaper instead of the unrelated
  // Dynamics Restore stage. Car/Hi-Fi keeps its preset personality behavior.
  const studioPersonality = currentStudioPersonality();
  const userImpactAmount = cleanHdProfile && state.dynamicsRestoreEnabled
    ? Math.max(0, Math.min(1, state.dynamicsRestoreAmount / 100))
    : 0;
  const presetTransientAmount = !cleanHdProfile && processed && state.eqEnabled
    ? Math.max(0, Math.min(1, currentTransientAmount() * sourceTransientScale() * studioPersonality.transientScale))
    : 0;
  // Xpander and Impact are independent layers and therefore add rather than
  // silently masking each other with Math.max().
  const effectiveTransientAmount = Math.max(0, Math.min(1, presetTransientAmount + userImpactAmount + xpander.transientAmount));
  const effectivePresenceDb = Math.max(-6, Math.min(6, state.presenceDb + xpander.presenceDb));
  const effectiveClarityDb = Math.max(-6, Math.min(6, state.clarityDb + xpander.clarityDb));
  const effectiveAirDb = Math.max(-6, Math.min(6, state.airDb + xpander.airDb));
  const effectiveExciterAmount = Math.max(state.exciterAmount / 100, xpander.exciterAmount);
  setMvpStudioState(studioProcessorNode, {
    bypass: !processed,
    eqEnabled: processed && state.eqEnabled,
    // MVP_STUDIO_WASM_V3_PHASE3_LINEAR_PHASE
    // Both EQ topologies now run inside the same Studio WASM processor.
    eqTopologyCode: state.eqTopology === "linear_phase" ? 1 : 0,
    eqGains: [...state.eqGains],
    preampDb:
      state.outputProfile === "headphones" || state.outputProfile === "speaker"
        ? 0
        : state.eqEnabled
          ? state.preampDb
          : 0,
    headroomDb: autoHeadroomDb,
    transientEnabled: effectiveTransientAmount > 0.001,
    transientAmount: effectiveTransientAmount,
    // MVP_STUDIO_WASM_V2_PHASE2_MULTIBAND
    multibandEnabled: processed && state.multibandEnabled,
    multibandAmount: studioPersonality.multibandAmount,
    // MVP_STUDIO_WASM_V3_PHASE1_DYNAMIC_EQ
    // Cut-only adaptive resonance control. It never adds makeup gain and therefore
    // cannot reintroduce the old EQ-slider/global-volume bug.
    dynamicEqEnabled: processed && state.dynamicEqEnabled,
    dynamicEqAmount: studioPersonality.dynamicEqAmount,
    // MVP_STUDIO_WASM_V3_PHASE2_OUTPUT_CORRECTION
    // Device-path intelligence stays separate from the musical preset. The WASM
    // core chooses the correct adaptive guard behavior from outputProfileCode.
    outputCorrectionEnabled: processed && state.smartDspEnabled,
    outputCorrectionAmount: studioPersonality.outputCorrectionAmount,
    // MVP_STUDIO_WASM_V3_PHASE6_STEREO_INTEGRITY
    // Automatic mono-compatible low bass and anti-phase image protection.
    stereoIntegrityEnabled:
      processed &&
      (state.outputProfile === "car_hifi" ||
        (state.outputProfile === "speaker" && state.smartDspEnabled)),
    stereoIntegrityAmount: studioPersonality.stereoIntegrityAmount,
    // MVP_STUDIO_WASM_V2_PHASE3_LOUDNESS
    // R74: High/Max Output no longer enables a second automatic LUFS gain stage.
    // The single Max-HD controller is compressor + adaptive makeup + true-peak
    // guard. Optional user loudness matching remains available independently.
    normalizationEnabled: processed && state.normalizationEnabled,
    normalizationTargetLufs: -11,
    // MVP_STUDIO_WASM_V3_PHASE4_TRUE_PEAK_LIMITER
    // BS.1770-style 4x FIR true-peak detection drives the Studio limiter.
    limiterEnabled: processed && state.limiterEnabled,
    limiterCeilingDb: state.outputProfile === "car_hifi" ? -1.2 : -1.0,
    outputProfileCode: studioOutputProfileCode(),
    headphoneEnabled,
    headphoneWidth: headphoneEnabled ? (proof ? 1 : state.headphoneWidth / 100) : 0,
    headphoneDepth: headphoneEnabled ? (proof ? 1 : state.headphoneDepth / 100) : 0,
    headphoneCrossfeed: headphoneEnabled ? (proof ? 0.72 : state.headphoneCrossfeed / 100) : 0,
    headphoneCenter: headphoneEnabled ? (proof ? 0.5 : state.headphoneCenter / 100) : 0.5,
    headphoneBassImpact: headphoneEnabled ? (proof ? 0 : state.headphoneBassImpact / 100) : 0,
    outputReserveDb: processed ? state.outputReserveDb : 0,
    autoMakeupEnabled: processed && state.autoMakeupEnabled,
    parametricEnabled: processed && state.parametricEnabled,
    parametricBands: state.parametricBands.map((band) => ({ ...band, type: parametricTypeCode(band.type) })),
    bassEngineEnabled: processed && state.bassEngineEnabled,
    bassSubDb: state.bassSubDb,
    bassPunchDb: state.bassPunchDb,
    bassBodyDb: state.bassBodyDb,
    bassTightness: state.bassTightness / 100,
    toneEngineEnabled: processed && (state.toneEngineEnabled || xpander.level > 0),
    presenceDb: effectivePresenceDb,
    clarityDb: effectiveClarityDb,
    airDb: effectiveAirDb,
    deharshAmount: processed ? state.deharshAmount / 100 : 0,
    exciterEnabled: processed && (state.exciterEnabled || xpander.level > 0),
    exciterAmount: effectiveExciterAmount,
    saturationLow: state.saturationLow / 100,
    saturationMid: state.saturationMid / 100,
    saturationHigh: state.saturationHigh / 100,
    stereoFieldEnabled: processed && state.stereoFieldEnabled,
    stereoUserWidth: state.stereoUserWidth / 100,
    stereoCenterFocus: state.stereoCenterFocus / 100,
    bassMonoHz: state.bassMonoHz,
    dynamicsRestoreEnabled: processed && !cleanHdProfile && state.dynamicsRestoreEnabled,
    dynamicsRestoreAmount: !cleanHdProfile ? state.dynamicsRestoreAmount / 100 : 0,
    smartDspEnabled: processed && state.smartDspEnabled,
    smartDspAmount: state.smartDspAmount / 100,
    headphoneAdvancedEnabled: headphoneEnabled && state.headphoneAdvancedEnabled,
    headphoneSpeakerAngle: state.headphoneSpeakerAngle,
    headphoneDistance: state.headphoneDistance / 100,
    headphoneReflections: state.headphoneReflections / 100,
    headphoneWet: state.headphoneWet / 100,
  });
  const runtime = getMvpStudioRuntimeInfo();
  const stateVerified = runtime.ready && !runtime.faulted && runtime.requestedRevision <= runtime.appliedRevision;
  const status: MusicDspStatus = audioContext.state === "running"
    ? (pureReference || abBypass ? "bypassed" : stateVerified ? "active" : "recovering")
    : "recovering";
  setDspTelemetry(status, effectivePreampDb, autoHeadroomDb);
  const immersionStatus = currentImmersionStatus();
  if (state.immersionStatus !== immersionStatus) emit({ immersionStatus });
}
async function tryConnectStudioGraph(context: AudioContext, audio: HTMLAudioElement) {
  // V3 Phase 3: Minimum Phase and Linear Phase are both flagship Studio WASM modes.
  if (!context.audioWorklet) return false;
  let sourceCreated = false;
  try {
    studioProcessorNode = await createMvpStudioNode(context);
  } catch (error) {
    studioProcessorNode = null;
    console.warn("MVP Studio WASM unavailable; trying Compatibility Engine.", error);
    return false;
  }
  try {
    mediaSource = context.createMediaElementSource(audio);
    sourceCreated = true;
    masterVolumeGain = context.createGain();
    referenceRouteGain = context.createGain();
    referenceRouteGain.gain.value = 0;
    standardRouteGain = context.createGain();
    standardRouteGain.gain.value = 0;
    studioInputBus = context.createGain();
    studioDirectInputGain = context.createGain();
    studioDirectInputGain.gain.value = 1;
    studioHrtfInputGain = context.createGain();
    studioHrtfInputGain.gain.value = 0;
    studioHrtfSplitter = context.createChannelSplitter(2);
    // Spatial receives SIDE information only. Mono/center material (lead vocal,
    // kick, snare, bass) therefore remains 100% on the dry Studio HD path and
    // cannot be hollowed out by HRTF phase interaction.
    studioHrtfLeftBus = context.createGain();
    studioHrtfRightBus = context.createGain();
    studioHrtfLeftToLeft = context.createGain();
    studioHrtfRightToLeft = context.createGain();
    studioHrtfRightToRight = context.createGain();
    studioHrtfLeftToRight = context.createGain();
    studioHrtfLeftToLeft.gain.value = 0.5;
    studioHrtfRightToLeft.gain.value = -0.5;
    studioHrtfRightToRight.gain.value = 0.5;
    studioHrtfLeftToRight.gain.value = -0.5;
    studioHrtfLeftPanner = context.createPanner();
    studioHrtfRightPanner = context.createPanner();
    for (const panner of [studioHrtfLeftPanner, studioHrtfRightPanner]) {
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 1;
      panner.maxDistance = 10000;
      panner.rolloffFactor = 0;
    }
    studioHrtfSum = context.createGain();
    studioHrtfSum.gain.value = 1;
    studioHrtfBassShelf = context.createBiquadFilter();
    // Bass remains 100% on the dry Studio HD path. HRTF carries spatial cues,
    // not low-frequency energy that can smear or weaken punch.
    studioHrtfBassShelf.type = "highpass";
    studioHrtfBassShelf.frequency.value = 135;
    studioHrtfBassShelf.Q.value = 0.60;
    studioHrtfReflectionDelayA = context.createDelay(0.06);
    studioHrtfReflectionDelayB = context.createDelay(0.06);
    studioHrtfReflectionGainA = context.createGain();
    studioHrtfReflectionGainB = context.createGain();
    studioHrtfReflectionGainA.gain.value = 0;
    studioHrtfReflectionGainB.gain.value = 0;
    virtualAmpGainNode = context.createGain();
    virtualAmpGainNode.gain.value = 1;
    loudnessCompressorNode = context.createDynamicsCompressor();
    loudnessCompressorNode.threshold.value = 0;
    loudnessCompressorNode.knee.value = 0;
    loudnessCompressorNode.ratio.value = 1;
    loudnessCompressorNode.attack.value = 0.003;
    loudnessCompressorNode.release.value = 0.12;
    mixBus = context.createGain();
    analyserNode = context.createAnalyser();
    analyserNode.fftSize = 4096;
    analyserNode.smoothingTimeConstant = 0.38;
    analyserNode.minDecibels = -92;
    analyserNode.maxDecibels = -10;
    postLimiterVolumeGain = context.createGain();
    postLimiterVolumeGain.gain.value = volumeToGain(state.volume);
    musicGain = context.createGain();
    musicGain.gain.value = 1;
    referenceLevelAnalyser = context.createAnalyser();
    processedLevelAnalyser = context.createAnalyser();
    referenceLevelAnalyser.fftSize = 2048;
    processedLevelAnalyser.fftSize = 2048;
    levelMeterSink = context.createGain();
    levelMeterSink.gain.value = 0;

    mediaSource.connect(masterVolumeGain);
    masterVolumeGain.connect(referenceRouteGain);
    referenceRouteGain.connect(mixBus);

    // Direct processed path.
    masterVolumeGain.connect(studioDirectInputGain);
    studioDirectInputGain.connect(studioInputBus);

    // Headphones: split the stereo master into two mono virtual loudspeakers and
    // let the browser HRTF renderer convolve each source with measured head-related
    // impulse responses. The resulting binaural stereo is then mastered/limited by WASM.
    masterVolumeGain.connect(studioHrtfSplitter);
    studioHrtfSplitter.connect(studioHrtfLeftToLeft, 0);
    studioHrtfSplitter.connect(studioHrtfLeftToRight, 0);
    studioHrtfSplitter.connect(studioHrtfRightToRight, 1);
    studioHrtfSplitter.connect(studioHrtfRightToLeft, 1);
    studioHrtfLeftToLeft.connect(studioHrtfLeftBus);
    studioHrtfRightToLeft.connect(studioHrtfLeftBus);
    studioHrtfRightToRight.connect(studioHrtfRightBus);
    studioHrtfLeftToRight.connect(studioHrtfRightBus);
    studioHrtfLeftBus.connect(studioHrtfLeftPanner);
    studioHrtfRightBus.connect(studioHrtfRightPanner);
    studioHrtfLeftPanner.connect(studioHrtfSum);
    studioHrtfRightPanner.connect(studioHrtfSum);
    studioHrtfSum.connect(studioHrtfBassShelf);
    studioHrtfBassShelf.connect(studioHrtfInputGain);
    studioHrtfInputGain.connect(studioInputBus);
    studioHrtfBassShelf.connect(studioHrtfReflectionDelayA);
    studioHrtfBassShelf.connect(studioHrtfReflectionDelayB);
    studioHrtfReflectionDelayA.connect(studioHrtfReflectionGainA);
    studioHrtfReflectionDelayB.connect(studioHrtfReflectionGainB);
    studioHrtfReflectionGainA.connect(studioInputBus);
    studioHrtfReflectionGainB.connect(studioInputBus);

    // R75: the flagship WASM now owns the final linked compressor AFTER EQ and
    // effects. The browser compressor is not allowed to pre-compress the raw
    // source and then let later EQ boosts create fresh peaks.
    studioInputBus.connect(studioProcessorNode);
    studioProcessorNode.connect(standardRouteGain);
    standardRouteGain.connect(mixBus);
    mixBus.connect(analyserNode);
    analyserNode.connect(postLimiterVolumeGain);
    postLimiterVolumeGain.connect(musicGain);
    musicGain.connect(context.destination);

    masterVolumeGain.connect(referenceLevelAnalyser);
    referenceLevelAnalyser.connect(levelMeterSink);
    studioProcessorNode.connect(processedLevelAnalyser);
    processedLevelAnalyser.connect(levelMeterSink);
    levelMeterSink.connect(context.destination);

    mediaSourceConnected = true;
    audio.volume = 1;
    emit({
      dspEngineMode: "studio_wasm",
      loudnessGainDb: 0,
      loudnessMomentaryLufs: -70,
      truePeakDbtp: -120,
      limiterGainReductionDb: 0,
      transientBoostDb: 0,
      multibandGainReductionDb: 0,
      stereoCorrelation: 1,
      stereoWidthPercent: 100,
      stereoGuardReductionDb: 0,
    });
    applyProcessingSettings();
    return true;
  } catch (error) {
    if (sourceCreated) throw error;
    try { studioProcessorNode?.disconnect(); } catch { /* no-op */ }
    studioProcessorNode = null;
    return false;
  }
}
async function loadAdvancedDspModule(context: AudioContext) {
  if (!context.audioWorklet) return false;
  try {
    const moduleUrl = new URL("./audio/mvpMusicDsp.worklet.js", import.meta.url);
    moduleUrl.searchParams.set("v", "13.9.14");
    await context.audioWorklet.addModule(moduleUrl.href);
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
      if (await tryConnectStudioGraph(context, audio)) return;
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
      virtualAmpGainNode = context.createGain();
      virtualAmpGainNode.gain.value = 1;
      loudnessCompressorNode = context.createDynamicsCompressor();
      loudnessCompressorNode.threshold.value = 0;
      loudnessCompressorNode.knee.value = 0;
      loudnessCompressorNode.ratio.value = 1;
      loudnessCompressorNode.attack.value = 0.003;
      loudnessCompressorNode.release.value = 0.12;
      mixBus = context.createGain();
      makeupGain = context.createGain();
      analyserNode = context.createAnalyser();
      analyserNode.fftSize = 4096;
      analyserNode.smoothingTimeConstant = 0.38;
      analyserNode.minDecibels = -92;
      analyserNode.maxDecibels = -10;
      postLimiterVolumeGain = context.createGain();
      postLimiterVolumeGain.gain.value = volumeToGain(state.volume);
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
          multibandProcessorNode = new AudioWorkletNode(context, "mvp-multiband-processor", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: "max",
          });
          loudnessNormalizerNode = new AudioWorkletNode(context, "mvp-loudness-normalizer", {
            numberOfInputs: 2,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: "max",
          });
          loudnessNormalizerNode.port.onmessage = (event) => {
            const data = event.data;
            if (!data || data.type !== "telemetry") return;
            const gainDb = Number(data.gainDb);
            const lufs = Number(data.lufs);
            emit({
              loudnessGainDb: Number.isFinite(gainDb) ? Math.round(gainDb * 10) / 10 : 0,
              loudnessMomentaryLufs: Number.isFinite(lufs) ? Math.round(lufs * 10) / 10 : -70,
            });
          };
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
          multibandProcessorNode = null;
          loudnessNormalizerNode = null;
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

      // R76 fallback parity: EQ/effects must happen BEFORE the loudness compressor,
      // matching the flagship Studio-WASM topology. The old fallback compressed raw
      // audio first, then let later EQ/effects create new peaks and a different sound.
      if (loudnessNormalizerNode) {
        masterVolumeGain.connect(loudnessNormalizerNode, 0, 0);
        mediaSource.connect(loudnessNormalizerNode, 0, 1);
        loudnessNormalizerNode.connect(preampGain);
      } else {
        masterVolumeGain.connect(preampGain);
      }
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
      if (multibandProcessorNode) {
        processedTail.connect(multibandProcessorNode);
        processedTail = multibandProcessorNode;
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

      // Final loudness control is after EQ/output/headphone processing in every
      // fallback mode. High/Max Output therefore sees the finished sound instead
      // of pre-compressing the source and fighting the limiter later.
      mixBus.connect(loudnessCompressorNode);
      loudnessCompressorNode.connect(makeupGain);
      let limiterTail: AudioNode = makeupGain;
      if (limiterWorkletNode) {
        limiterTail.connect(limiterWorkletNode);
        limiterTail = limiterWorkletNode;
      } else if (limiterFallbackNode) {
        limiterTail.connect(limiterFallbackNode);
        limiterTail = limiterFallbackNode;
      }
      limiterTail.connect(analyserNode);
      analyserNode.connect(postLimiterVolumeGain);
      postLimiterVolumeGain.connect(musicGain);
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
    if (state.dspEngineMode === "studio_wasm") {
      const runtime = getMvpStudioRuntimeInfo();
      if (runtime.faulted) {
        if (state.dspStatus !== "recovering") emit({ dspStatus: "recovering" });
        const now = Date.now();
        if (!studioRecoveryInFlight && now - lastStudioRecoveryAt > 4000) {
          studioRecoveryInFlight = true;
          lastStudioRecoveryAt = now;
          void rebuildMusicAudioEngine().catch(() => emit({ dspStatus: "unavailable" })).finally(() => { studioRecoveryInFlight = false; });
        }
        return;
      }
      const pureReference = state.outputProfile === "reference";
      const abBypass = !pureReference && state.dspBypass;
      const stateVerified = runtime.ready && runtime.requestedRevision <= runtime.appliedRevision;
      // If a control change (EQ/preset/effect) has been requested but the AudioWorklet
      // has not acknowledged it after a real settling window, rebuild the graph instead
      // of leaving a button/slider that only *looks* active. Normal revisions settle in
      // milliseconds; this watchdog only trips on a genuinely stale processor.
      const revisionStale =
        runtime.ready &&
        !stateVerified &&
        runtime.lastRequestedAt > 0 &&
        Date.now() - runtime.lastRequestedAt > 1600;
      if (revisionStale) {
        const now = Date.now();
        if (!studioRecoveryInFlight && now - lastStudioRecoveryAt > 4000) {
          studioRecoveryInFlight = true;
          lastStudioRecoveryAt = now;
          void rebuildMusicAudioEngine()
            .catch(() => emit({ dspStatus: "unavailable" }))
            .finally(() => { studioRecoveryInFlight = false; });
        }
      }
      const verifiedStatus: MusicDspStatus = pureReference || abBypass
        ? "bypassed"
        : stateVerified
          ? "active"
          : "recovering";
      setDspTelemetry(verifiedStatus, state.effectivePreampDb, state.autoHeadroomDb);
      const telemetry = getMvpStudioTelemetry();
      const loudnessActive =
        (state.normalizationEnabled || cleanHdHighOutputActive()) &&
        state.outputProfile !== "reference" &&
        !state.dspBypass;
      const gainDb = loudnessActive && Number.isFinite(telemetry.loudnessGainDb)
        ? Math.round(telemetry.loudnessGainDb * 10) / 10
        : 0;
      const programLufs = loudnessActive && Number.isFinite(telemetry.loudnessProgramLufs) && telemetry.loudnessProgramLufs > -69.5
        ? Math.round(telemetry.loudnessProgramLufs * 10) / 10
        : -70;
      const dynamicEqActive = state.dynamicEqEnabled && state.outputProfile !== "reference" && !state.dspBypass;
      const dynamicEqGainReductionDb = dynamicEqActive && Number.isFinite(telemetry.dynamicEqGainReductionDb)
        ? Math.round(telemetry.dynamicEqGainReductionDb * 10) / 10
        : 0;
      const dynamicEqBandReductionDb = (dynamicEqActive
        ? [0, 1, 2, 3].map((index) => Math.round((Number(telemetry.dynamicEqBandReductionDb?.[index]) || 0) * 10) / 10)
        : [0, 0, 0, 0]) as [number, number, number, number];
      const dynamicEqChanged = dynamicEqGainReductionDb !== state.dynamicEqGainReductionDb
        || dynamicEqBandReductionDb.some((value, index) => value !== state.dynamicEqBandReductionDb[index]);
      const outputCorrectionActive =
        state.smartDspEnabled &&
        state.outputProfile !== "reference" &&
        !state.dspBypass;
      const outputCorrectionReductionDb = outputCorrectionActive && Number.isFinite(telemetry.outputCorrectionReductionDb)
        ? Math.round(telemetry.outputCorrectionReductionDb * 10) / 10
        : 0;
      const outputCorrectionChanged = outputCorrectionReductionDb !== state.outputCorrectionReductionDb;
      const stereoIntegrityActive =
        !state.dspBypass &&
        (state.outputProfile === "car_hifi" ||
          (state.outputProfile === "speaker" && state.smartDspEnabled));
      const stereoCorrelation = stereoIntegrityActive && Number.isFinite(telemetry.stereoCorrelation)
        ? Math.round(Math.max(-1, Math.min(1, telemetry.stereoCorrelation)) * 100) / 100
        : 1;
      const stereoWidthPercent = stereoIntegrityActive && Number.isFinite(telemetry.stereoWidthPercent)
        ? Math.round(Math.max(0, Math.min(140, telemetry.stereoWidthPercent)))
        : 100;
      const stereoGuardReductionDb = stereoIntegrityActive && Number.isFinite(telemetry.stereoGuardReductionDb)
        ? Math.round(Math.max(0, telemetry.stereoGuardReductionDb) * 10) / 10
        : 0;
      const stereoIntegrityChanged = stereoCorrelation !== state.stereoCorrelation
        || stereoWidthPercent !== state.stereoWidthPercent
        || stereoGuardReductionDb !== state.stereoGuardReductionDb;
      const truePeakDbtp = Number.isFinite(telemetry.truePeakDbtp)
        ? Math.round(telemetry.truePeakDbtp * 10) / 10
        : -120;
      const limiterGainReductionDb = state.limiterEnabled && Number.isFinite(telemetry.gainReductionDb)
        ? Math.round(Math.max(0, telemetry.gainReductionDb) * 10) / 10
        : 0;
      const transientActive =
        state.outputProfile !== "reference" &&
        state.eqEnabled &&
        !state.dspBypass &&
        currentTransientAmount() > 0.001;
      const transientBoostDb = transientActive && Number.isFinite(telemetry.transientBoostDb)
        ? Math.round(Math.max(0, telemetry.transientBoostDb) * 10) / 10
        : 0;
      const multibandActive = state.multibandEnabled && state.outputProfile !== "reference" && !state.dspBypass;
      const multibandGainReductionDb = multibandActive && Number.isFinite(telemetry.multibandGainReductionDb)
        ? Math.round(Math.max(0, telemetry.multibandGainReductionDb) * 10) / 10
        : 0;
      const coreMeterChanged = truePeakDbtp !== state.truePeakDbtp
        || limiterGainReductionDb !== state.limiterGainReductionDb
        || transientBoostDb !== state.transientBoostDb
        || multibandGainReductionDb !== state.multibandGainReductionDb;
      if (gainDb !== state.loudnessGainDb || programLufs !== state.loudnessMomentaryLufs || dynamicEqChanged || outputCorrectionChanged || stereoIntegrityChanged || coreMeterChanged || true) {
        emit({
          loudnessGainDb: gainDb,
          loudnessMomentaryLufs: programLufs,
          dynamicEqGainReductionDb,
          dynamicEqBandReductionDb,
          outputCorrectionReductionDb,
          stereoCorrelation,
          stereoWidthPercent,
          stereoGuardReductionDb,
          truePeakDbtp,
          limiterGainReductionDb,
          transientBoostDb,
          multibandGainReductionDb,
          availableHeadroomDb: Math.round((Number(telemetry.availableHeadroomDb) || 0) * 10) / 10,
          autoMakeupDb: Math.round((Number(telemetry.autoMakeupDb) || 0) * 10) / 10,
          internalPeak: Number(telemetry.internalPeak) || 0,
          bassActivityDb: Math.round((Number(telemetry.bassActivityDb) || 0) * 10) / 10,
          toneActivityDb: Math.round((Number(telemetry.toneActivityDb) || 0) * 10) / 10,
          exciterActivity: Math.round((Number(telemetry.exciterActivity) || 0) * 100) / 100,
          deharshReductionDb: Math.round((Number(telemetry.deharshReductionDb) || 0) * 10) / 10,
          smartActivity: Math.round((Number(telemetry.smartActivity) || 0) * 100) / 100,
        });
      }
    }
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
  }, 200);
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

async function recoverStalledPlayback(audio: HTMLAudioElement) {
  if (audio !== audioElement || playbackStallRecoveryInFlight || mediaErrorRecoveryInFlight || state.loading) return;
  const track = state.currentTrack;
  if (!track || !playbackIntent || audio.paused || audio.ended) return;

  playbackStallRecoveryInFlight = true;
  const resumeAt = Math.max(0, Number(audio.currentTime || state.currentTime || 0));
  emit({ loading: true, error: null });
  try {
    signedUrlCache.delete(track.id);
    clearMusicUrlCache(track.id);
    await loadTrack(track, resumeAt);
    if (!playbackIntent || state.currentTrack?.id !== track.id) return;
    suppressNextRecoveredPlayCount = true;
    const recovered = ensureAudioElement();
    await recovered.play();
    lastPlaybackProgressAt = Date.now();
    lastPlaybackPosition = Number(recovered.currentTime || 0);
    emit({ loading: false, playing: true, error: null });
  } catch {
    suppressNextRecoveredPlayCount = false;
    emit({ loading: false, playing: false, error: null });
    if (playbackIntent) {
      try {
        await nextMusicTrack(true);
      } catch {
        emit({ loading: false, playing: false, error: "PLAYBACK STALLED • TAP PLAY TO RETRY" });
      }
    }
  } finally {
    playbackStallRecoveryInFlight = false;
  }
}

function ensureAudioElement() {
  if (audioElement) return audioElement;
  const audio = new Audio();
  // R58: keep the active media element ready to begin a newly assigned source immediately.
  audio.preload = "auto";
  audio.crossOrigin = "anonymous";
  audio.volume = 1;
  audio.addEventListener("play", () => {
    if (audio !== audioElement) return;
    playbackIntent = true;
    lastPlaybackProgressAt = Date.now();
    lastPlaybackPosition = Number(audio.currentTime || 0);
    emit({ playing: true, error: null });
    configureMediaSession();
    const trackId = audio.dataset.trackId;
    const token = trackId ? `${trackId}:${audio.currentSrc || audio.src}` : "";
    if (suppressNextRecoveredPlayCount && trackId === state.currentTrack?.id) {
      suppressNextRecoveredPlayCount = false;
      recordedPlayToken = token;
    } else if (trackId && token !== recordedPlayToken) {
      recordedPlayToken = token;
      rememberPlaybackCycleTrack(trackId);
      void recordMusicTrackPlayed(trackId).catch(() => undefined);
    }
  });
  audio.addEventListener("pause", () => {
    if (audio !== audioElement) return;
    emit({ playing: false });
  });
  audio.addEventListener("playing", () => {
    if (audio !== audioElement) return;
    lastPlaybackProgressAt = Date.now();
    lastPlaybackPosition = Number(audio.currentTime || 0);
  });
  audio.addEventListener("waiting", () => {
    if (audio !== audioElement || !playbackIntent) return;
    if (!lastPlaybackProgressAt) lastPlaybackProgressAt = Date.now();
  });
  audio.addEventListener("stalled", () => {
    if (audio !== audioElement || !playbackIntent) return;
    if (!lastPlaybackProgressAt) lastPlaybackProgressAt = Date.now();
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
    const currentPosition = Number(audio.currentTime || 0);
    emit({ currentTime: currentPosition });
    if (Math.abs(currentPosition - lastPlaybackPosition) >= 0.08) {
      lastPlaybackPosition = currentPosition;
      lastPlaybackProgressAt = Date.now();
    }
    savePlaybackPosition();
    const duration = Number(audio.duration);
    const remaining = duration - Number(audio.currentTime || 0);
    if (Number.isFinite(remaining) && remaining <= 12 && remaining > 0) {
      void preloadNextTransitionTrack();
    }
  });
  audio.addEventListener("ended", () => {
    if (audio !== audioElement) return;
    const finishedId = state.currentTrack?.id;
    recordedPlayToken = "";
    emit({ playing: false, currentTime: 0 });
    if (finishedId) void recordMusicTrackCompleted(finishedId).catch(() => undefined);
    void handleTrackEnded();
  });
  audio.addEventListener("error", () => {
    if (audio !== audioElement || state.loading) return;
    const track = state.currentTrack;
    const now = Date.now();
    const recentlyRetriedSameTrack = Boolean(
      track &&
      lastMediaErrorRecoveryTrackId === track.id &&
      now - lastMediaErrorRecoveryAt < MEDIA_ERROR_AUTO_RETRY_COOLDOWN_MS
    );

    if (!playbackIntent || !track || mediaErrorRecoveryInFlight || recentlyRetriedSameTrack) {
      emit({ playing: false, loading: false, error: "COULDN'T PLAY THIS TRACK • RETRY" });
      return;
    }

    mediaErrorRecoveryInFlight = true;
    lastMediaErrorRecoveryAt = now;
    lastMediaErrorRecoveryTrackId = track.id;
    const resumeAt = Math.max(0, Number(audio.currentTime || state.currentTime || 0));
    emit({ playing: false, loading: true, error: null });

    void (async () => {
      try {
        // A track that played and then errors is commonly a stale/expired signed R2 URL
        // or a transient media fetch failure. Force a fresh URL, preserve position, and
        // recover once automatically instead of making the user press Retry.
        signedUrlCache.delete(track.id);
        clearMusicUrlCache(track.id);
        await loadTrack(track, resumeAt);
        if (!playbackIntent || state.currentTrack?.id !== track.id) return;
        suppressNextRecoveredPlayCount = true;
        const recoveredAudio = ensureAudioElement();
        await recoveredAudio.play();
        emit({ loading: false, playing: true, error: null });
      } catch {
        suppressNextRecoveredPlayCount = false;
        emit({ loading: false, playing: false, error: null });
        if (playbackIntent) {
          try {
            await nextMusicTrack(true);
          } catch {
            emit({ loading: false, playing: false, error: "COULDN'T RECOVER PLAYBACK • TAP PLAY" });
          }
        } else {
          emit({ loading: false, playing: false, error: "COULDN'T PLAY THIS TRACK • RETRY" });
        }
      } finally {
        mediaErrorRecoveryInFlight = false;
      }
    })();
  });
  audioElement = audio;
  if (playbackStallHeartbeat == null && typeof window !== "undefined") {
    playbackStallHeartbeat = window.setInterval(() => {
      const active = audioElement;
      if (!active || !playbackIntent || !state.playing || state.loading || active.paused || active.ended) return;
      if (!lastPlaybackProgressAt) {
        lastPlaybackProgressAt = Date.now();
        lastPlaybackPosition = Number(active.currentTime || 0);
        return;
      }
      if (Date.now() - lastPlaybackProgressAt >= PLAYBACK_STALL_RECOVERY_MS) {
        void recoverStalledPlayback(active);
      }
    }, 2500);
  }
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
  const url = !force && transitionPreloadTrackId === track.id && transitionPreloadUrl
    ? transitionPreloadUrl
    : await resolveTrackUrl(track, force);
  if (loadingTrackId !== track.id) return;
  if (audio.dataset.trackId !== track.id || audio.src !== url) {
    audio.pause();
    recordedPlayToken = "";
    audio.src = url;
    audio.dataset.trackId = track.id;
    loudnessNormalizerNode?.port.postMessage({ type: "reset" });
    resetMvpStudioLoudness(studioProcessorNode);
    emit({ loudnessGainDb: 0, loudnessMomentaryLufs: -70 });
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
  const shouldResetLoudness = state.currentTrack?.id !== track.id || startAt < 0.5;
  if (shouldResetLoudness) {
    loudnessNormalizerNode?.port.postMessage({ type: "reset" });
    resetMvpStudioLoudness(studioProcessorNode);
    emit({ loudnessGainDb: 0, loudnessMomentaryLufs: -70 });
  }
  loadingTrackId = track.id;
  emit({ loading: true, error: null, currentTrack: track });
  restoreSongDspMemory(track.id);
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
    void preloadNextTransitionTrack();
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
  const next = chooseCycleSafeTrack(state.tracks, state.currentTrack?.id ?? null, false);
  return next ? state.tracks.findIndex((track) => track.id === next.id) : -1;
}
function nextTransitionCandidate() {
  if (!state.tracks.length || state.repeat === "one") return null;
  if (state.currentTrack && isAdaptiveRadioName(state.activePlaylistName)) {
    return chooseAdaptiveNextTrack(state.currentTrack, state.libraryTracks, { remember: false }) ?? null;
  }
  // A shuffled next choice is intentionally selected at transition time, not preloaded early.
  if (state.shuffle) return null;
  const index = nextSequentialIndex(1);
  return index >= 0 ? state.tracks[index] ?? null : null;
}

function clearTransitionPreload() {
  if (transitionPreloadAudio) {
    try {
      transitionPreloadAudio.pause();
      transitionPreloadAudio.removeAttribute("src");
      transitionPreloadAudio.load();
    } catch { /* preload cleanup */ }
  }
  transitionPreloadAudio = null;
  transitionPreloadTrackId = null;
  transitionPreloadUrl = null;
}

async function preloadNextTransitionTrack() {
  // R58: pre-resolve and warm the next source even when transition FX are off.
  // This removes signed-URL/network setup from the user's manual Next tap.
  const next = nextTransitionCandidate();
  if (!next || next.id === transitionPreloadTrackId) return;
  const currentIdAtStart = state.currentTrack?.id ?? null;
  try {
    const url = await resolveTrackUrl(next, false);
    // Do not run the adaptive chooser a second time here. The old verification
    // call mutated recent-memory and frequently invalidated its own preload.
    if ((state.currentTrack?.id ?? null) !== currentIdAtStart) return;
    clearTransitionPreload();
    const preload = new Audio();
    preload.preload = "auto";
    preload.crossOrigin = "anonymous";
    preload.volume = 0;
    preload.src = url;
    preload.load();
    transitionPreloadAudio = preload;
    transitionPreloadTrackId = next.id;
    transitionPreloadUrl = url;
  } catch {
    clearTransitionPreload();
  }
}

function transitionTimings() {
  if (state.transitionMode === "off" || state.transitionMode === "gapless") return { down: 0, up: 0 };
  if (state.transitionMode === "smooth") return { down: 180, up: 420 };
  return { down: 90, up: 260 };
}

async function handleTrackEnded() {
  if (state.repeat === "one" && state.currentTrack) {
    await playMusicTrack(state.currentTrack.id, 0);
    return;
  }
  const { up } = transitionTimings();
  const originalGain = Math.max(0.0001, musicGain?.gain.value || 1);
  if (up > 0 && musicGain && audioContext) {
    musicGain.gain.cancelScheduledValues(audioContext.currentTime);
    musicGain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  }
  try {
    await nextMusicTrack(true);
  } catch {
    // Never strand the workout because one next-track URL failed. Walk forward
    // through a few alternate queue candidates; loadTrack already refreshes a
    // stale signed URL once per candidate.
    const start = Math.max(-1, getCurrentIndex());
    let recovered = false;
    for (let step = 1; step <= Math.min(5, state.tracks.length); step += 1) {
      const candidate = state.tracks[(start + step) % Math.max(1, state.tracks.length)];
      if (!candidate || candidate.id === state.currentTrack?.id) continue;
      try {
        await playMusicTrack(candidate.id, 0);
        recovered = true;
        break;
      } catch {
        signedUrlCache.delete(candidate.id);
        clearMusicUrlCache(candidate.id);
      }
    }
    if (!recovered) emit({ playing: false, loading: false, error: "PLAYBACK RECOVERY NEEDED • TAP PLAY" });
  }
  clearTransitionPreload();
  if (up > 0 && musicGain && audioContext && state.playing) await fadeOutputTo(originalGain, up);
  void preloadNextTransitionTrack();
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
          const tracks = ids.map((id) => byId.get(String(id))).filter((track): track is MusicTrack => Boolean(track));
          if (tracks.length) return { tracks, playlistId: null as string | null, playlistName: savedQueueName };
        }
      } catch { /* fall through */ }
    }
    removePlayerSetting(STORAGE_KEYS.activePlaylistName);
    removePlayerSetting(STORAGE_KEYS.activeQueueTrackIds);
    return { tracks: libraryTracks, playlistId: null as string | null, playlistName: null as string | null };
  }
  try {
    const [playlist, links] = await Promise.all([getMusicPlaylist(savedPlaylistId), listMusicPlaylistTrackLinks(savedPlaylistId)]);
    if (!playlist) throw new Error("Playlist no longer exists.");
    const byId = new Map(libraryTracks.map((track) => [track.id, track]));
    const tracks = links.map((link) => byId.get(link.track_id)).filter((track): track is MusicTrack => Boolean(track));
    if (!tracks.length) throw new Error("Playlist is empty.");
    return { tracks, playlistId: playlist.id, playlistName: playlist.name };
  } catch {
    removePlayerSetting(STORAGE_KEYS.activePlaylistId);
    removePlayerSetting(STORAGE_KEYS.activePlaylistName);
    removePlayerSetting(STORAGE_KEYS.activeQueueTrackIds);
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
  const transient = /lock broken|steal|navigator\.locks|aborterror|failed to fetch|networkerror|timeout/i.test(message);
  // Never blank a working library because a transient auth/storage/network request failed.
  const hasCachedLibrary = Boolean(state.libraryTracks.length);
  emit({ loading: false, libraryLoaded: state.libraryLoaded || hasCachedLibrary, error: transient && hasCachedLibrary ? null : message });
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
  removePlayerSetting(STORAGE_KEYS.activePlaylistId);
  removePlayerSetting(STORAGE_KEYS.activePlaylistName);
  removePlayerSetting(STORAGE_KEYS.activeQueueTrackIds);
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
  savePlayerSetting(STORAGE_KEYS.activeQueueTrackIds, JSON.stringify(tracks.map((track) => track.id)));
  const currentTrack = tracks.find((track) => track.id === state.currentTrack?.id) ?? tracks[0] ?? null;
  emit({ tracks: [...tracks], currentTrack, activePlaylistId: null, activePlaylistName: name, error: tracks.length ? null : "This collection has no songs." });
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
  removePlayerSetting(STORAGE_KEYS.activeQueueTrackIds);
  const currentTrack = tracks.find((track) => track.id === state.currentTrack?.id) ?? tracks[0] ?? null;
  emit({ tracks: [...tracks], currentTrack, activePlaylistId: playlist.id, activePlaylistName: playlist.name, error: tracks.length ? null : "This playlist has no songs." });
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

/* MVP_TRAINER_V4_5_2_TRUE_PAUSE_CONTINUITY_R4: PLAYBACK QUERY */
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

async function playTrackWithIntelligentTransition(trackId: string, fromEnded: boolean) {
  const { down, up } = transitionTimings();
  if (fromEnded || state.transitionMode === "off" || state.transitionMode === "gapless" || !musicGain || !audioContext) {
    await playMusicTrack(trackId, 0);
    return;
  }
  const originalGain = Math.max(0.0001, musicGain.gain.value || 1);
  if (down > 0) await fadeOutputTo(Math.min(originalGain, 0.0001), down);
  await playMusicTrack(trackId, 0);
  if (up > 0) await fadeOutputTo(originalGain, up);
}

/* MVP_TRAINER_V5_R6_MUSIC_INTELLIGENCE_SUITE: ADAPTIVE NEXT */
export async function nextMusicTrack(fromEnded = false) {
  if (!state.libraryLoaded) await loadMusicLibrary();

  if (!fromEnded && shouldRecordSkip() && state.currentTrack) {
    void recordMusicTrackSkipped(state.currentTrack.id).catch(() => undefined);
  }

  if (
    state.currentTrack &&
    isAdaptiveRadioName(state.activePlaylistName)
  ) {
    const adaptive = chooseAdaptiveNextTrack(
      state.currentTrack,
      state.libraryTracks,
      { remember: false },
    );

    if (adaptive) {
      // R58: a button-driven track change is transport, not a transition effect.
      // Start it immediately; natural end-of-song playback keeps the existing transition path.
      if (!fromEnded) await playMusicTrack(adaptive.id, 0);
      else if (isAutoMixEnabled() || state.transitionMode !== "off") await playTrackWithIntelligentTransition(adaptive.id, true);
      else await playMusicTrack(adaptive.id, 0);
      return;
    }
  }

  const index = state.shuffle
    ? nextShuffleIndex()
    : nextSequentialIndex(1);

  if (index < 0) {
    if (fromEnded) stopMusic();
    return;
  }

  const track = state.tracks[index];
  if (track) {
    // R58: manual Next must feel immediate. Automatic song-end changes keep the
    // existing natural transition handling in handleTrackEnded().
    if (!fromEnded) await playMusicTrack(track.id, 0);
    else await playTrackWithIntelligentTransition(track.id, true);
  }
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

/* MVP_TRAINER_V5_R6_MUSIC_INTELLIGENCE_SUITE: LIKE RADIO + LIKED SONGS */
export async function setPlayerMusicPreference(
  trackId: string,
  preference: "neutral" | "like" | "play_less",
) {
  const wasCurrent = state.currentTrack?.id === trackId;
  const original = state.libraryTracks.find((track) => track.id === trackId)
    ?? state.tracks.find((track) => track.id === trackId)
    ?? (wasCurrent ? state.currentTrack : null);

  if (!original) {
    throw new Error("Song not found in your music library.");
  }

  const optimistic: MusicTrack = {
    ...original,
    favorite: preference === "like",
    play_less: preference === "play_less",
  };

  const patchOptimistic = (track: MusicTrack) =>
    track.id === trackId ? optimistic : track;

  // Update the player immediately so LIKE / PLAY LESS always latch visually
  // without waiting on storage/network round-trips.
  emit({
    libraryTracks: state.libraryTracks.map(patchOptimistic),
    tracks: state.tracks.map(patchOptimistic),
    currentTrack: wasCurrent ? optimistic : state.currentTrack,
  });

  try {
    const updated = await setMusicTrackPreference(trackId, preference);
    const patchTrack = (track: MusicTrack) =>
      track.id === trackId ? updated : track;

    const nextLibrary = state.libraryTracks.map(patchTrack);
    const nextQueue = state.tracks.map(patchTrack);

    emit({
      libraryTracks: nextLibrary,
      tracks: nextQueue,
      currentTrack: wasCurrent ? updated : state.currentTrack,
    });

    void syncLikedSongsPlaylist(nextLibrary).catch((error) => {
      console.warn("Could not synchronize Liked Songs.", error);
    });

    if (preference === "like" && wasCurrent) {
      const radio = startRadioSession(
        updated,
        nextLibrary,
        "more_like_this",
      );

      activateMusicAdHocQueue(
        `Like Radio • ${updated.title}`,
        radio,
      );
      void preloadNextTransitionTrack();
    }

    return updated;
  } catch (error) {
    const restore = (track: MusicTrack) =>
      track.id === trackId ? original : track;
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
  const seed = state.libraryTracks.find(
    (track) => track.id === seedTrackId,
  );

  if (!seed) {
    throw new Error("Song not found in your music library.");
  }

  const queue = startRadioSession(
    seed,
    state.libraryTracks,
    mode,
  );

  activateMusicAdHocQueue(
    adaptiveRadioQueueName(seed, mode),
    queue,
  );

  // Steering should affect the very next transition, not wait until the
  // current song ends before preparing a candidate.
  void preloadNextTransitionTrack();

  return queue;
}

export function getMusicPlayerSnapshot() {
  return state;
}

export function setMusicVolume(value: number) {
  const next = Math.max(0, Math.min(1, Number(value) || 0));
  savePlayerSetting(STORAGE_KEYS.volume, String(next));
  emit({ volume: next });
  if (audioContext && mediaSourceConnected && postLimiterVolumeGain) {
    setAudioParam(postLimiterVolumeGain.gain, volumeToGain(next), audioContext.currentTime, 0.01);
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
  if (isCustomPresetSlot(presetName)) {
    const definition = readCustomPreset(presetName);
    savePlayerSetting(STORAGE_KEYS.eqPreset, presetName);
    if (definition) {
      savePlayerSetting(STORAGE_KEYS.eqGains, JSON.stringify(definition.gains));
      savePlayerSetting(STORAGE_KEYS.preampDb, String(definition.preamp));
      emit({
        eqPreset: presetName,
        eqGains: [...definition.gains],
        preampDb: definition.preamp,
        dspVerificationMode: "off",
      });
    } else {
      emit({ eqPreset: presetName, dspVerificationMode: "off" });
    }
    applyProcessingSettings();
    scheduleProcessingSettle();
    return;
  }
  if (presetName === "custom") {
    savePlayerSetting(STORAGE_KEYS.eqPreset, presetName);
    emit({ eqPreset: presetName, dspVerificationMode: "off" });
    applyProcessingSettings();
    return;
  }
  if (!isBuiltInPreset(presetName)) return;
  const definition = MUSIC_EQ_PRESETS[presetName];
  const gains = [...definition.gains];
  savePlayerSetting(STORAGE_KEYS.eqPreset, presetName);
  savePlayerSetting(STORAGE_KEYS.eqGains, JSON.stringify(gains));
  savePlayerSetting(STORAGE_KEYS.preampDb, String(definition.preamp));
  emit({
    eqPreset: presetName,
    eqGains: gains,
    preampDb: definition.preamp,
    dspVerificationMode: "off",
  });
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
  savePlayerSetting(STORAGE_KEYS.eqPreset, "custom");
  emit({ eqGains: gains, eqPreset: "custom", dspVerificationMode: "off" });
  applyProcessingSettings();
  // R71 reliability: re-apply once after the live Worklet state settles. This is
  // cheap, and prevents a rapid mobile slider gesture from leaving the UI one
  // revision ahead of the actual WASM state.
  scheduleProcessingSettle();
}

export function setMusicPreamp(preampDb: number) {
  const next = Math.max(-12, Math.min(6, Number(preampDb) || 0));
  savePlayerSetting(STORAGE_KEYS.preampDb, String(next));
  savePlayerSetting(STORAGE_KEYS.eqPreset, "custom");
  emit({ preampDb: next, eqPreset: "custom", dspVerificationMode: "off" });
  applyProcessingSettings();
  scheduleProcessingSettle();
}

export function setMusicEqTopology(topology: MusicEqTopology) {
  const next: MusicEqTopology = topology === "linear_phase" ? "linear_phase" : "minimum_phase";
  const previous = state.eqTopology;
  savePlayerSetting(STORAGE_KEYS.eqTopology, next);
  emit({ eqTopology: next });
  // Studio can change topology in-place. Compatibility paths still rebuild so
  // they can retry the flagship Studio engine after a topology change.
  const engineSwitch = previous !== next && state.dspEngineMode !== "studio_wasm";
  if (engineSwitch) {
    void rebuildMusicAudioEngine();
    return;
  }
  applyProcessingSettings();
  scheduleProcessingSettle();
}



type AdvancedDspSnapshot = Pick<MusicPlayerState,
  "outputReserveDb"|"autoMakeupEnabled"|"parametricEnabled"|"parametricBands"|
  "bassEngineEnabled"|"bassSubDb"|"bassPunchDb"|"bassBodyDb"|"bassTightness"|
  "toneEngineEnabled"|"presenceDb"|"clarityDb"|"airDb"|"deharshAmount"|
  "exciterEnabled"|"exciterAmount"|"saturationLow"|"saturationMid"|"saturationHigh"|
  "stereoFieldEnabled"|"stereoUserWidth"|"stereoCenterFocus"|"bassMonoHz"|
  "dynamicsRestoreEnabled"|"dynamicsRestoreAmount"|"smartDspEnabled"|"smartDspAmount"|
  "headphoneAdvancedEnabled"|"headphoneSpeakerAngle"|"headphoneDistance"|"headphoneReflections"|"headphoneWet"
>;
function currentAdvancedSnapshot(): AdvancedDspSnapshot {
  return {
    outputReserveDb:state.outputReserveDb, autoMakeupEnabled:state.autoMakeupEnabled,
    parametricEnabled:state.parametricEnabled, parametricBands:state.parametricBands.map(b=>({...b})),
    bassEngineEnabled:state.bassEngineEnabled,bassSubDb:state.bassSubDb,bassPunchDb:state.bassPunchDb,bassBodyDb:state.bassBodyDb,bassTightness:state.bassTightness,
    toneEngineEnabled:state.toneEngineEnabled,presenceDb:state.presenceDb,clarityDb:state.clarityDb,airDb:state.airDb,deharshAmount:state.deharshAmount,
    exciterEnabled:state.exciterEnabled,exciterAmount:state.exciterAmount,saturationLow:state.saturationLow,saturationMid:state.saturationMid,saturationHigh:state.saturationHigh,
    stereoFieldEnabled:state.stereoFieldEnabled,stereoUserWidth:state.stereoUserWidth,stereoCenterFocus:state.stereoCenterFocus,bassMonoHz:state.bassMonoHz,
    dynamicsRestoreEnabled:state.dynamicsRestoreEnabled,dynamicsRestoreAmount:state.dynamicsRestoreAmount,smartDspEnabled:state.smartDspEnabled,smartDspAmount:state.smartDspAmount,
    headphoneAdvancedEnabled:state.headphoneAdvancedEnabled,headphoneSpeakerAngle:state.headphoneSpeakerAngle,headphoneDistance:state.headphoneDistance,headphoneReflections:state.headphoneReflections,headphoneWet:state.headphoneWet,
  };
}
function parseAdvancedSnapshot(value: unknown): AdvancedDspSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const baseline=currentAdvancedSnapshot();
  const input=value as Partial<AdvancedDspSnapshot>;
  const merged={...baseline,...input,parametricBands:Array.isArray(input.parametricBands)?input.parametricBands.map((b,i)=>({...baseline.parametricBands[i],...b})):baseline.parametricBands};
  return merged as AdvancedDspSnapshot;
}
function applyAdvancedSnapshot(snapshot: AdvancedDspSnapshot, songMemoryActive=false) {
  emit({...snapshot,parametricBands:snapshot.parametricBands.map(b=>({...b})),songMemoryActive});
  applyProcessingSettings(); scheduleProcessingSettle();
}
function readSongMemoryProfiles(): Record<string,AdvancedDspSnapshot> {
  try { const raw=readStored(STORAGE_KEYS.songMemoryProfiles); const parsed=raw?JSON.parse(raw):{}; return parsed&&typeof parsed==="object"?parsed:{}; } catch { return {}; }
}
function persistCurrentSongDspMemory() {
  if (!state.songMemoryEnabled || !state.currentTrack?.id) return;
  const profiles=readSongMemoryProfiles(); profiles[state.currentTrack.id]=currentAdvancedSnapshot(); savePlayerSetting(STORAGE_KEYS.songMemoryProfiles,JSON.stringify(profiles));
  if (!state.songMemoryActive) emit({songMemoryActive:true});
}
function restoreSongDspMemory(trackId:string) {
  if (!state.songMemoryEnabled) { if(state.songMemoryActive) emit({songMemoryActive:false}); return; }
  const profiles=readSongMemoryProfiles(); const saved=parseAdvancedSnapshot(profiles[trackId]);
  if (saved) { applyAdvancedSnapshot(saved,true); return; }
  try { const baselineRaw=readStored(STORAGE_KEYS.songMemoryBaseline); const baseline=parseAdvancedSnapshot(baselineRaw?JSON.parse(baselineRaw):null); if(baseline) applyAdvancedSnapshot(baseline,false); else emit({songMemoryActive:false}); } catch { emit({songMemoryActive:false}); }
}
type SoundDnaProfile={bassSubDb:number;bassPunchDb:number;bassBodyDb:number;presenceDb:number;clarityDb:number;airDb:number;stereoUserWidth:number;stereoCenterFocus:number;outputReserveDb:number;samples:number};
function readSoundDna():SoundDnaProfile { try{const raw=readStored(STORAGE_KEYS.soundDnaProfile);if(raw)return JSON.parse(raw) as SoundDnaProfile;}catch{} return {bassSubDb:0,bassPunchDb:0,bassBodyDb:0,presenceDb:0,clarityDb:0,airDb:0,stereoUserWidth:100,stereoCenterFocus:100,outputReserveDb:3,samples:0}; }
function learnSoundDna(key:keyof Omit<SoundDnaProfile,"samples">,value:number){ if(!state.soundDnaEnabled)return; const p=readSoundDna(); const a=p.samples<5?.34:.14; p[key]=p[key]*(1-a)+value*a; p.samples=Math.min(999,p.samples+1); savePlayerSetting(STORAGE_KEYS.soundDnaProfile,JSON.stringify(p)); }
export function setMusicSoundDnaEnabled(enabled:boolean){ savePlayerSetting(STORAGE_KEYS.soundDnaEnabled,String(enabled)); emit({soundDnaEnabled:enabled}); if(enabled){const p=readSoundDna(); if(p.samples>0){emit({bassSubDb:p.bassSubDb,bassPunchDb:p.bassPunchDb,bassBodyDb:p.bassBodyDb,presenceDb:p.presenceDb,clarityDb:p.clarityDb,airDb:p.airDb,stereoUserWidth:p.stereoUserWidth,stereoCenterFocus:p.stereoCenterFocus,outputReserveDb:p.outputReserveDb});applyProcessingSettings();}} }
export function getMusicSoundDnaSampleCount(){return readSoundDna().samples;}
export function setMusicSongMemoryEnabled(enabled:boolean){ savePlayerSetting(STORAGE_KEYS.songMemoryEnabled,String(enabled)); emit({songMemoryEnabled:enabled,songMemoryActive:false}); if(enabled){savePlayerSetting(STORAGE_KEYS.songMemoryBaseline,JSON.stringify(currentAdvancedSnapshot())); if(state.currentTrack?.id) restoreSongDspMemory(state.currentTrack.id);} }
export function saveMusicSongDspMemory(){persistCurrentSongDspMemory();}
export function clearMusicSongDspMemory(){ if(!state.currentTrack?.id)return; const profiles=readSongMemoryProfiles();delete profiles[state.currentTrack.id];savePlayerSetting(STORAGE_KEYS.songMemoryProfiles,JSON.stringify(profiles));emit({songMemoryActive:false}); }

export function setMusicOutputReserve(value: number) {
  const next = Math.max(0, Math.min(12, Number(value) || 0));
  savePlayerSetting(STORAGE_KEYS.outputReserveDb, String(next)); emit({ outputReserveDb: next }); learnSoundDna("outputReserveDb",next); applyProcessingSettings(); persistCurrentSongDspMemory();
}
export function setMusicAutoMakeupEnabled(enabled: boolean) { savePlayerSetting(STORAGE_KEYS.autoMakeupEnabled,String(enabled)); emit({autoMakeupEnabled:enabled}); applyProcessingSettings(); }
export function setMusicParametricEnabled(enabled: boolean) { savePlayerSetting(STORAGE_KEYS.parametricEnabled,String(enabled)); emit({parametricEnabled:enabled}); applyProcessingSettings(); }
export function setMusicParametricBand(index: number, patch: Partial<MusicParametricBand>) {
  if (index < 0 || index >= 6) return;
  const bands = state.parametricBands.map((band, i) => i === index ? { ...band, ...patch } : band);
  const band = bands[index];
  band.frequency=Math.max(20,Math.min(20000,Number(band.frequency)||1000)); band.gainDb=Math.max(-12,Math.min(12,Number(band.gainDb)||0)); band.q=Math.max(.15,Math.min(12,Number(band.q)||1));
  savePlayerSetting(STORAGE_KEYS.parametricBands,JSON.stringify(bands)); emit({parametricBands:bands}); applyProcessingSettings();
}
function setAdvancedNumber(key: keyof MusicPlayerState, storageKey: string, value: number, min: number, max: number) {
  const next=Math.max(min,Math.min(max,Number(value)||0)); savePlayerSetting(storageKey,String(next)); emit({[key]:next} as Partial<MusicPlayerState>); applyProcessingSettings();
}
export function setMusicBassEngineEnabled(enabled:boolean){savePlayerSetting(STORAGE_KEYS.bassEngineEnabled,String(enabled));emit({bassEngineEnabled:enabled});applyProcessingSettings();}
export function setMusicBassSub(value:number){if(!state.bassEngineEnabled)setMusicBassEngineEnabled(true);setAdvancedNumber("bassSubDb",STORAGE_KEYS.bassSubDb,value,-8,8);learnSoundDna("bassSubDb",state.bassSubDb);persistCurrentSongDspMemory()}
export function setMusicBassPunch(value:number){if(!state.bassEngineEnabled)setMusicBassEngineEnabled(true);setAdvancedNumber("bassPunchDb",STORAGE_KEYS.bassPunchDb,value,-8,8);learnSoundDna("bassPunchDb",state.bassPunchDb);persistCurrentSongDspMemory()}
export function setMusicBassBody(value:number){if(!state.bassEngineEnabled)setMusicBassEngineEnabled(true);setAdvancedNumber("bassBodyDb",STORAGE_KEYS.bassBodyDb,value,-8,8);learnSoundDna("bassBodyDb",state.bassBodyDb);persistCurrentSongDspMemory()}
export function setMusicBassTightness(value:number){setAdvancedNumber("bassTightness",STORAGE_KEYS.bassTightness,value,0,100)}
export function setMusicToneEngineEnabled(enabled:boolean){savePlayerSetting(STORAGE_KEYS.toneEngineEnabled,String(enabled));emit({toneEngineEnabled:enabled});applyProcessingSettings();}
export function setMusicPresence(value:number){if(!state.toneEngineEnabled)setMusicToneEngineEnabled(true);setAdvancedNumber("presenceDb",STORAGE_KEYS.presenceDb,value,-8,8);learnSoundDna("presenceDb",state.presenceDb);persistCurrentSongDspMemory()}
export function setMusicClarity(value:number){if(!state.toneEngineEnabled)setMusicToneEngineEnabled(true);setAdvancedNumber("clarityDb",STORAGE_KEYS.clarityDb,value,-8,8);learnSoundDna("clarityDb",state.clarityDb);persistCurrentSongDspMemory()}
export function setMusicAir(value:number){if(!state.toneEngineEnabled)setMusicToneEngineEnabled(true);setAdvancedNumber("airDb",STORAGE_KEYS.airDb,value,-8,8);learnSoundDna("airDb",state.airDb);persistCurrentSongDspMemory()}
export function setMusicDeharsh(value:number){setAdvancedNumber("deharshAmount",STORAGE_KEYS.deharshAmount,value,0,100)}
export function setMusicExciterEnabled(enabled:boolean){savePlayerSetting(STORAGE_KEYS.exciterEnabled,String(enabled));emit({exciterEnabled:enabled});applyProcessingSettings();}
export function setMusicExciterAmount(value:number){if(!state.exciterEnabled)setMusicExciterEnabled(true);setAdvancedNumber("exciterAmount",STORAGE_KEYS.exciterAmount,value,0,100)}
export function setMusicSaturationLow(value:number){setAdvancedNumber("saturationLow",STORAGE_KEYS.saturationLow,value,0,100)}
export function setMusicSaturationMid(value:number){setAdvancedNumber("saturationMid",STORAGE_KEYS.saturationMid,value,0,100)}
export function setMusicSaturationHigh(value:number){setAdvancedNumber("saturationHigh",STORAGE_KEYS.saturationHigh,value,0,100)}
export function setMusicStereoFieldEnabled(enabled:boolean){savePlayerSetting(STORAGE_KEYS.stereoFieldEnabled,String(enabled));emit({stereoFieldEnabled:enabled});applyProcessingSettings();}
export function setMusicStereoWidth(value:number){if(!state.stereoFieldEnabled)setMusicStereoFieldEnabled(true);setAdvancedNumber("stereoUserWidth",STORAGE_KEYS.stereoUserWidth,value,50,165);learnSoundDna("stereoUserWidth",state.stereoUserWidth);persistCurrentSongDspMemory()}
export function setMusicCenterFocus(value:number){if(!state.stereoFieldEnabled)setMusicStereoFieldEnabled(true);setAdvancedNumber("stereoCenterFocus",STORAGE_KEYS.stereoCenterFocus,value,75,130);learnSoundDna("stereoCenterFocus",state.stereoCenterFocus);persistCurrentSongDspMemory()}
export function setMusicBassMonoHz(value:number){setAdvancedNumber("bassMonoHz",STORAGE_KEYS.bassMonoHz,value,60,160)}
export function setMusicDynamicsRestoreEnabled(enabled:boolean){savePlayerSetting(STORAGE_KEYS.dynamicsRestoreEnabled,String(enabled));emit({dynamicsRestoreEnabled:enabled});applyProcessingSettings();}
export function setMusicDynamicsRestoreAmount(value:number){setAdvancedNumber("dynamicsRestoreAmount",STORAGE_KEYS.dynamicsRestoreAmount,value,0,100)}
export function setMusicSmartDspEnabled(enabled:boolean){savePlayerSetting(STORAGE_KEYS.smartDspEnabled,String(enabled));emit({smartDspEnabled:enabled});applyProcessingSettings();}
export function setMusicSmartDspAmount(value:number){setAdvancedNumber("smartDspAmount",STORAGE_KEYS.smartDspAmount,value,0,100)}
export function setMusicHeadphoneAdvancedEnabled(enabled:boolean){savePlayerSetting(STORAGE_KEYS.headphoneAdvancedEnabled,String(enabled));emit({headphoneAdvancedEnabled:enabled});applyProcessingSettings();}
export function setMusicHeadphoneSpeakerAngle(value:number){setAdvancedNumber("headphoneSpeakerAngle",STORAGE_KEYS.headphoneSpeakerAngle,value,15,60)}
export function setMusicHeadphoneDistance(value:number){setAdvancedNumber("headphoneDistance",STORAGE_KEYS.headphoneDistance,value,0,100)}
export function setMusicHeadphoneReflections(value:number){setAdvancedNumber("headphoneReflections",STORAGE_KEYS.headphoneReflections,value,0,30)}
export function setMusicHeadphoneWet(value:number){setAdvancedNumber("headphoneWet",STORAGE_KEYS.headphoneWet,value,0,100)}

export function setMusicCrossfadeSeconds(seconds: number) {
  const next = Math.max(0, Math.min(8, Number(seconds) || 0));
  savePlayerSetting(STORAGE_KEYS.crossfadeSeconds, String(next));
  emit({ crossfadeSeconds: next });
}

export function setMusicTransitionMode(mode: MusicTransitionMode) {
  const next: MusicTransitionMode = mode === "gapless" || mode === "smooth" || mode === "off" ? mode : "auto";
  savePlayerSetting(STORAGE_KEYS.transitionMode, next);
  emit({ transitionMode: next });
  clearTransitionPreload();
  void preloadNextTransitionTrack();
}

export function setMusicNormalizationEnabled(enabled: boolean) {
  savePlayerSetting(STORAGE_KEYS.normalizationEnabled, String(enabled));
  emit({ normalizationEnabled: enabled });
  applyProcessingSettings();
  if (!enabled) {
    emit({ loudnessGainDb: 0, loudnessMomentaryLufs: -70 });
  } else {
    loudnessNormalizerNode?.port.postMessage({ type: "reset" });
    resetMvpStudioLoudness(studioProcessorNode);
  }
}

export function setMusicMultibandEnabled(enabled: boolean) {
  savePlayerSetting(STORAGE_KEYS.multibandEnabled, String(enabled));
  emit({ multibandEnabled: enabled });
  applyProcessingSettings();
}
export function setMusicDynamicEqEnabled(enabled: boolean) {
  savePlayerSetting(STORAGE_KEYS.dynamicEqEnabled, String(enabled));
  if (enabled) emit({ dynamicEqEnabled: true });
  else emit({ dynamicEqEnabled: false, dynamicEqGainReductionDb: 0, dynamicEqBandReductionDb: [0, 0, 0, 0] });
  applyProcessingSettings();
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


type OutputProfileSnapshot = Pick<
  MusicPlayerState,
  | "eqEnabled"
  | "eqPreset"
  | "eqGains"
  | "eqTopology"
  | "preampDb"
  | "outputReserveDb"
  | "autoMakeupEnabled"
  | "parametricEnabled"
  | "parametricBands"
  | "bassEngineEnabled"
  | "bassSubDb"
  | "bassPunchDb"
  | "bassBodyDb"
  | "bassTightness"
  | "toneEngineEnabled"
  | "presenceDb"
  | "clarityDb"
  | "airDb"
  | "deharshAmount"
  | "exciterEnabled"
  | "exciterAmount"
  | "saturationLow"
  | "saturationMid"
  | "saturationHigh"
  | "stereoFieldEnabled"
  | "stereoUserWidth"
  | "stereoCenterFocus"
  | "bassMonoHz"
  | "dynamicsRestoreEnabled"
  | "dynamicsRestoreAmount"
  | "smartDspEnabled"
  | "smartDspAmount"
  | "hdXpanderLevel"
  | "headphoneAdvancedEnabled"
  | "headphoneSpeakerAngle"
  | "headphoneDistance"
  | "headphoneReflections"
  | "headphoneWet"
  | "normalizationEnabled"
  | "multibandEnabled"
  | "dynamicEqEnabled"
  | "limiterEnabled"
  | "headphoneMode"
  | "headphoneWidth"
  | "headphoneDepth"
  | "headphoneCrossfeed"
  | "headphoneCenter"
  | "headphoneBassImpact"
>;

function outputProfileStateKey(profile: MusicOutputProfile) {
  return `mvp_music_output_profile_state_v${OUTPUT_PROFILE_STATE_VERSION}:${profile}`;
}

function currentOutputProfileSnapshot(): OutputProfileSnapshot {
  return {
    eqEnabled: state.eqEnabled,
    eqPreset: state.eqPreset,
    eqGains: [...state.eqGains],
    eqTopology: state.eqTopology,
    preampDb: state.preampDb,
    outputReserveDb: state.outputReserveDb,
    autoMakeupEnabled: state.autoMakeupEnabled,
    parametricEnabled: state.parametricEnabled,
    parametricBands: state.parametricBands.map((band) => ({ ...band })),
    bassEngineEnabled: state.bassEngineEnabled,
    bassSubDb: state.bassSubDb,
    bassPunchDb: state.bassPunchDb,
    bassBodyDb: state.bassBodyDb,
    bassTightness: state.bassTightness,
    toneEngineEnabled: state.toneEngineEnabled,
    presenceDb: state.presenceDb,
    clarityDb: state.clarityDb,
    airDb: state.airDb,
    deharshAmount: state.deharshAmount,
    exciterEnabled: state.exciterEnabled,
    exciterAmount: state.exciterAmount,
    saturationLow: state.saturationLow,
    saturationMid: state.saturationMid,
    saturationHigh: state.saturationHigh,
    stereoFieldEnabled: state.stereoFieldEnabled,
    stereoUserWidth: state.stereoUserWidth,
    stereoCenterFocus: state.stereoCenterFocus,
    bassMonoHz: state.bassMonoHz,
    dynamicsRestoreEnabled: state.dynamicsRestoreEnabled,
    dynamicsRestoreAmount: state.dynamicsRestoreAmount,
    smartDspEnabled: state.smartDspEnabled,
    smartDspAmount: state.smartDspAmount,
    hdXpanderLevel: state.hdXpanderLevel,
    headphoneAdvancedEnabled: state.headphoneAdvancedEnabled,
    headphoneSpeakerAngle: state.headphoneSpeakerAngle,
    headphoneDistance: state.headphoneDistance,
    headphoneReflections: state.headphoneReflections,
    headphoneWet: state.headphoneWet,
    normalizationEnabled: state.normalizationEnabled,
    multibandEnabled: state.multibandEnabled,
    dynamicEqEnabled: state.dynamicEqEnabled,
    limiterEnabled: state.limiterEnabled,
    headphoneMode: state.headphoneMode,
    headphoneWidth: state.headphoneWidth,
    headphoneDepth: state.headphoneDepth,
    headphoneCrossfeed: state.headphoneCrossfeed,
    headphoneCenter: state.headphoneCenter,
    headphoneBassImpact: state.headphoneBassImpact,
  };
}

function cleanOutputProfileSnapshot(profile: MusicOutputProfile): OutputProfileSnapshot {
  const base = currentOutputProfileSnapshot();
  const clean: OutputProfileSnapshot = {
    ...base,
    eqEnabled: true,
    eqPreset: "flat",
    eqGains: [...MUSIC_EQ_PRESETS.flat.gains],
    eqTopology: "minimum_phase",
    preampDb: 0,
    // Bluetooth Speaker starts at true unity. Extra gain must be explicit; it is
    // never injected as a hidden device-profile default.
    outputReserveDb: profile === "headphones" || profile === "speaker" ? 0 : 3.0,
    autoMakeupEnabled: false,
    parametricEnabled: false,
    parametricBands: defaultParametricBands(),
    bassEngineEnabled: false,
    bassSubDb: 0,
    bassPunchDb: 0,
    bassBodyDb: 0,
    bassTightness: 55,
    toneEngineEnabled: false,
    presenceDb: 0,
    clarityDb: 0,
    airDb: 0,
    deharshAmount: 0,
    exciterEnabled: false,
    exciterAmount: 0,
    saturationLow: 0,
    saturationMid: 0,
    saturationHigh: 0,
    stereoFieldEnabled: false,
    stereoUserWidth: 100,
    stereoCenterFocus: 100,
    bassMonoHz: 100,
    dynamicsRestoreEnabled: false,
    dynamicsRestoreAmount: 0,
    smartDspEnabled: false,
    smartDspAmount: 30,
    hdXpanderLevel: 0,
    headphoneAdvancedEnabled: false,
    headphoneSpeakerAngle: 30,
    headphoneDistance: 0,
    headphoneReflections: 0,
    headphoneWet: 0,
    normalizationEnabled: false,
    multibandEnabled: false,
    dynamicEqEnabled: false,
    limiterEnabled: true,
    headphoneMode: "off",
    headphoneWidth: 0,
    headphoneDepth: 0,
    headphoneCrossfeed: 0,
    headphoneCenter: 50,
    headphoneBassImpact: 0,
  };
  return clean;
}

function normalizeOutputProfileSnapshot(value: unknown, profile: MusicOutputProfile): OutputProfileSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const fallback = cleanOutputProfileSnapshot(profile);
  const raw = value as Partial<OutputProfileSnapshot>;
  const presetName = raw.eqPreset as MusicEqPreset | undefined;
  const eqPreset =
    presetName === "custom" || isCustomPresetSlot(presetName as MusicEqPreset) || isBuiltInPreset(presetName as MusicEqPreset)
      ? (presetName as MusicEqPreset)
      : fallback.eqPreset;
  const eqGains =
    Array.isArray(raw.eqGains) && raw.eqGains.length === MUSIC_EQ_FREQUENCIES.length
      ? raw.eqGains.map((gain) => Math.max(-12, Math.min(12, Number(gain) || 0)))
      : [...fallback.eqGains];
  const parametricBands =
    Array.isArray(raw.parametricBands)
      ? defaultParametricBands().map((baseBand, index) => ({ ...baseBand, ...(raw.parametricBands?.[index] ?? {}) }))
      : defaultParametricBands();
  return {
    ...fallback,
    ...raw,
    eqPreset,
    eqGains,
    parametricBands,
  } as OutputProfileSnapshot;
}

function readOutputProfileSnapshot(profile: MusicOutputProfile): OutputProfileSnapshot | null {
  try {
    const raw = readStored(outputProfileStateKey(profile));
    return raw ? normalizeOutputProfileSnapshot(JSON.parse(raw), profile) : null;
  } catch {
    return null;
  }
}

function writeOutputProfileSnapshot(profile: MusicOutputProfile, snapshot: OutputProfileSnapshot) {
  savePlayerSetting(outputProfileStateKey(profile), JSON.stringify(snapshot));
}

const SPEAKER_CLEAN_PATH_R69_KEY = "mvp_music_speaker_clean_path_r69_v1";

function cleanSpeakerSnapshotPreservingEq(source: OutputProfileSnapshot): OutputProfileSnapshot {
  const clean = cleanOutputProfileSnapshot("speaker");
  // Preserve the musical choice; remove only stacked DSP/gain state that can
  // turn high-volume Bluetooth playback into limiter-driven distortion.
  clean.eqEnabled = source.eqEnabled;
  clean.eqPreset = source.eqPreset;
  clean.eqGains = [...source.eqGains];
  clean.eqTopology = source.eqTopology;
  clean.preampDb = source.preampDb;
  clean.outputReserveDb = 0;
  clean.autoMakeupEnabled = false;
  clean.normalizationEnabled = false;
  clean.multibandEnabled = false;
  clean.dynamicEqEnabled = false;
  clean.smartDspEnabled = false;
  clean.dynamicsRestoreEnabled = false;
  clean.exciterEnabled = false;
  clean.limiterEnabled = true;
  return clean;
}

function migrateSpeakerCleanPathR69() {
  if (readStored(SPEAKER_CLEAN_PATH_R69_KEY) === "1") return;
  const storedSpeaker = readOutputProfileSnapshot("speaker");
  const source = state.outputProfile === "speaker"
    ? currentOutputProfileSnapshot()
    : storedSpeaker;
  if (source) {
    const clean = cleanSpeakerSnapshotPreservingEq(source);
    writeOutputProfileSnapshot("speaker", clean);
    if (state.outputProfile === "speaker") {
      persistSnapshotToActiveStorage(clean);
      state = {
        ...state,
        ...clean,
        eqGains: [...clean.eqGains],
        parametricBands: clean.parametricBands.map((band) => ({ ...band })),
      };
    }
  }
  savePlayerSetting(SPEAKER_CLEAN_PATH_R69_KEY, "1");
}

// R69A: run only after SPEAKER_CLEAN_PATH_R69_KEY has been initialized.
migrateSpeakerCleanPathR69();

const CLEAN_HD_R70_KEY = "mvp_music_clean_hd_r70_v1";

function cleanR70SnapshotPreservingMusic(profile: "headphones" | "speaker", source: OutputProfileSnapshot): OutputProfileSnapshot {
  const clean = cleanOutputProfileSnapshot(profile);
  clean.eqEnabled = source.eqEnabled;
  clean.eqPreset = source.eqPreset;
  clean.eqGains = [...source.eqGains];
  clean.eqTopology = source.eqTopology;
  clean.preampDb = 0;
  clean.outputReserveDb = 0;
  clean.autoMakeupEnabled = false;
  clean.normalizationEnabled = false;
  clean.multibandEnabled = false;
  clean.dynamicEqEnabled = false;
  clean.smartDspEnabled = false;
  clean.dynamicsRestoreEnabled = false;
  clean.exciterEnabled = false;
  clean.deharshAmount = 0;
  clean.limiterEnabled = true;

  if (profile === "headphones") {
    clean.headphoneMode =
      source.headphoneMode === "wide" ||
      source.headphoneMode === "spatial" ||
      source.headphoneMode === "deep" ||
      source.headphoneMode === "stage"
        ? source.headphoneMode
        : "off";
    const values = MUSIC_HEADPHONE_MODES[clean.headphoneMode];
    clean.headphoneWidth = values.width;
    clean.headphoneDepth = values.depth;
    clean.headphoneCrossfeed = values.crossfeed;
    clean.headphoneCenter = values.center;
    clean.headphoneBassImpact = values.bass;
  } else {
    clean.headphoneMode = "off";
  }

  return clean;
}

function migrateCleanHdR70() {
  if (readStored(CLEAN_HD_R70_KEY) === "1") return;

  (["headphones", "speaker"] as const).forEach((profile) => {
    const stored = readOutputProfileSnapshot(profile);
    const source = state.outputProfile === profile ? currentOutputProfileSnapshot() : stored;
    if (!source) return;
    const clean = cleanR70SnapshotPreservingMusic(profile, source);
    writeOutputProfileSnapshot(profile, clean);
    if (state.outputProfile === profile) {
      persistSnapshotToActiveStorage(clean);
      state = {
        ...state,
        ...clean,
        eqGains: [...clean.eqGains],
        parametricBands: clean.parametricBands.map((band) => ({ ...band })),
      };
    }
  });

  savePlayerSetting(CLEAN_HD_R70_KEY, "1");
}

// R70 migration runs only after all state/profile helpers exist.
migrateCleanHdR70();

const MAX_HD_R71_KEY = "mvp_music_max_hd_r71_v1";

function migrateMaxHdR71() {
  if (readStored(MAX_HD_R71_KEY) === "1") return;

  // One-time clean start for the simplified profiles. Preserve the user's music
  // EQ/preset and headphone immersion choice, remove stale hidden processors,
  // and make High/Max Output the default as requested. No blanket negative trim.
  (["headphones", "speaker"] as const).forEach((profile) => {
    const stored = readOutputProfileSnapshot(profile);
    const source = state.outputProfile === profile ? currentOutputProfileSnapshot() : stored;
    if (!source) return;
    const clean = cleanR70SnapshotPreservingMusic(profile, source);
    clean.outputReserveDb = 8.0;
    clean.autoMakeupEnabled = false;
    clean.normalizationEnabled = false; // High Output enables upward-only matching internally.
    clean.limiterEnabled = true;
    writeOutputProfileSnapshot(profile, clean);
    if (state.outputProfile === profile) {
      persistSnapshotToActiveStorage(clean);
      state = {
        ...state,
        ...clean,
        eqGains: [...clean.eqGains],
        parametricBands: clean.parametricBands.map((band) => ({ ...band })),
      };
    }
  });

  savePlayerSetting(MAX_HD_R71_KEY, "1");
}

migrateMaxHdR71();

const MAX_HD_R74_KEY = "mvp_music_max_hd_r74_single_gain_v1";

function migrateMaxHdR74() {
  if (readStored(MAX_HD_R74_KEY) === "1") return;

  // Remove the old automatic LUFS booster from simplified outputs. Preserve the
  // user's EQ, effects, immersion and High/Max Output choice. Output Reserve now
  // represents ONLY the maximum adaptive makeup allowance, never a fixed gain.
  (["headphones", "speaker"] as const).forEach((profile) => {
    const stored = readOutputProfileSnapshot(profile);
    const source = state.outputProfile === profile ? currentOutputProfileSnapshot() : stored;
    if (!source) return;
    const next: OutputProfileSnapshot = {
      ...source,
      normalizationEnabled: false,
      autoMakeupEnabled: false,
    };
    writeOutputProfileSnapshot(profile, next);
    if (state.outputProfile === profile) {
      persistSnapshotToActiveStorage(next);
      state = {
        ...state,
        ...next,
        eqGains: [...next.eqGains],
        parametricBands: next.parametricBands.map((band) => ({ ...band })),
      };
    }
  });

  savePlayerSetting(MAX_HD_R74_KEY, "1");
}

function persistSnapshotToActiveStorage(snapshot: OutputProfileSnapshot) {
  savePlayerSetting(STORAGE_KEYS.eqEnabled, String(snapshot.eqEnabled));
  savePlayerSetting(STORAGE_KEYS.eqPreset, snapshot.eqPreset);
  savePlayerSetting(STORAGE_KEYS.eqGains, JSON.stringify(snapshot.eqGains));
  savePlayerSetting(STORAGE_KEYS.eqTopology, snapshot.eqTopology);
  savePlayerSetting(STORAGE_KEYS.preampDb, String(snapshot.preampDb));
  savePlayerSetting(STORAGE_KEYS.outputReserveDb, String(snapshot.outputReserveDb));
  savePlayerSetting(STORAGE_KEYS.autoMakeupEnabled, String(snapshot.autoMakeupEnabled));
  savePlayerSetting(STORAGE_KEYS.parametricEnabled, String(snapshot.parametricEnabled));
  savePlayerSetting(STORAGE_KEYS.parametricBands, JSON.stringify(snapshot.parametricBands));
  savePlayerSetting(STORAGE_KEYS.bassEngineEnabled, String(snapshot.bassEngineEnabled));
  savePlayerSetting(STORAGE_KEYS.bassSubDb, String(snapshot.bassSubDb));
  savePlayerSetting(STORAGE_KEYS.bassPunchDb, String(snapshot.bassPunchDb));
  savePlayerSetting(STORAGE_KEYS.bassBodyDb, String(snapshot.bassBodyDb));
  savePlayerSetting(STORAGE_KEYS.bassTightness, String(snapshot.bassTightness));
  savePlayerSetting(STORAGE_KEYS.toneEngineEnabled, String(snapshot.toneEngineEnabled));
  savePlayerSetting(STORAGE_KEYS.presenceDb, String(snapshot.presenceDb));
  savePlayerSetting(STORAGE_KEYS.clarityDb, String(snapshot.clarityDb));
  savePlayerSetting(STORAGE_KEYS.airDb, String(snapshot.airDb));
  savePlayerSetting(STORAGE_KEYS.deharshAmount, String(snapshot.deharshAmount));
  savePlayerSetting(STORAGE_KEYS.exciterEnabled, String(snapshot.exciterEnabled));
  savePlayerSetting(STORAGE_KEYS.exciterAmount, String(snapshot.exciterAmount));
  savePlayerSetting(STORAGE_KEYS.saturationLow, String(snapshot.saturationLow));
  savePlayerSetting(STORAGE_KEYS.saturationMid, String(snapshot.saturationMid));
  savePlayerSetting(STORAGE_KEYS.saturationHigh, String(snapshot.saturationHigh));
  savePlayerSetting(STORAGE_KEYS.stereoFieldEnabled, String(snapshot.stereoFieldEnabled));
  savePlayerSetting(STORAGE_KEYS.stereoUserWidth, String(snapshot.stereoUserWidth));
  savePlayerSetting(STORAGE_KEYS.stereoCenterFocus, String(snapshot.stereoCenterFocus));
  savePlayerSetting(STORAGE_KEYS.bassMonoHz, String(snapshot.bassMonoHz));
  savePlayerSetting(STORAGE_KEYS.dynamicsRestoreEnabled, String(snapshot.dynamicsRestoreEnabled));
  savePlayerSetting(STORAGE_KEYS.dynamicsRestoreAmount, String(snapshot.dynamicsRestoreAmount));
  savePlayerSetting(STORAGE_KEYS.smartDspEnabled, String(snapshot.smartDspEnabled));
  savePlayerSetting(STORAGE_KEYS.smartDspAmount, String(snapshot.smartDspAmount));
  savePlayerSetting(STORAGE_KEYS.hdXpanderLevel, String(snapshot.hdXpanderLevel));
  savePlayerSetting(STORAGE_KEYS.headphoneAdvancedEnabled, String(snapshot.headphoneAdvancedEnabled));
  savePlayerSetting(STORAGE_KEYS.headphoneSpeakerAngle, String(snapshot.headphoneSpeakerAngle));
  savePlayerSetting(STORAGE_KEYS.headphoneDistance, String(snapshot.headphoneDistance));
  savePlayerSetting(STORAGE_KEYS.headphoneReflections, String(snapshot.headphoneReflections));
  savePlayerSetting(STORAGE_KEYS.headphoneWet, String(snapshot.headphoneWet));
  savePlayerSetting(STORAGE_KEYS.normalizationEnabled, String(snapshot.normalizationEnabled));
  savePlayerSetting(STORAGE_KEYS.multibandEnabled, String(snapshot.multibandEnabled));
  savePlayerSetting(STORAGE_KEYS.dynamicEqEnabled, String(snapshot.dynamicEqEnabled));
  savePlayerSetting(STORAGE_KEYS.limiterEnabled, String(snapshot.limiterEnabled));
  savePlayerSetting(STORAGE_KEYS.headphoneMode, snapshot.headphoneMode);
  savePlayerSetting(STORAGE_KEYS.headphoneWidth, String(snapshot.headphoneWidth));
  savePlayerSetting(STORAGE_KEYS.headphoneDepth, String(snapshot.headphoneDepth));
  savePlayerSetting(STORAGE_KEYS.headphoneCrossfeed, String(snapshot.headphoneCrossfeed));
  savePlayerSetting(STORAGE_KEYS.headphoneCenter, String(snapshot.headphoneCenter));
  savePlayerSetting(STORAGE_KEYS.headphoneBassImpact, String(snapshot.headphoneBassImpact));
}

function applyOutputProfileSnapshot(profile: MusicOutputProfile, snapshot: OutputProfileSnapshot) {
  persistSnapshotToActiveStorage(snapshot);
  emit({
    ...snapshot,
    eqGains: [...snapshot.eqGains],
    parametricBands: snapshot.parametricBands.map((band) => ({ ...band })),
    outputProfile: profile,
    dspBypass: false,
    dspVerificationMode: "off",
    songMemoryActive: false,
  });
  writeOutputProfileSnapshot(profile, snapshot);
  applyProcessingSettings();
  scheduleProcessingSettle();
}

migrateMaxHdR74();

export function applyMusicHeadphoneStudioHd() {
  const snapshot = cleanOutputProfileSnapshot("headphones");
  snapshot.outputReserveDb = 0;
  applyOutputProfileSnapshot("headphones", snapshot);
}

export function setMusicHeadphoneHighOutput(enabled: boolean) {
  if (state.outputProfile !== "headphones") return;
  const next = currentOutputProfileSnapshot();
  // Requested drive is handled by the clean-drive stage immediately before the
  // true-peak limiter. The DSP may use less on already-hot masters rather than
  // turning extra gain into distortion.
  next.outputReserveDb = enabled ? 8.0 : 0;
  next.autoMakeupEnabled = false;
  next.limiterEnabled = true;
  applyOutputProfileSnapshot("headphones", next);
}

export function setMusicHeadphoneClear(enabled: boolean) {
  if (state.outputProfile !== "headphones") return;
  const next = currentOutputProfileSnapshot();
  next.toneEngineEnabled = enabled;
  next.presenceDb = enabled ? 2.0 : 0;
  next.clarityDb = enabled ? 3.0 : 0;
  next.airDb = enabled ? 3.8 : 0;
  next.deharshAmount = 0;
  applyOutputProfileSnapshot("headphones", next);
}

export function applyMusicSpeakerHdSound() {
  const snapshot = cleanOutputProfileSnapshot("speaker");
  applyOutputProfileSnapshot("speaker", snapshot);
}

export function setMusicSpeakerMaxOutput(enabled: boolean) {
  if (state.outputProfile !== "speaker") return;
  const next = currentOutputProfileSnapshot();
  next.outputReserveDb = enabled ? 8.0 : 0;
  next.autoMakeupEnabled = false;
  next.limiterEnabled = true;
  applyOutputProfileSnapshot("speaker", next);
}

export function setMusicSpeakerClear(enabled: boolean) {
  if (state.outputProfile !== "speaker") return;
  const next = currentOutputProfileSnapshot();
  next.toneEngineEnabled = enabled;
  next.presenceDb = enabled ? 1.8 : 0;
  next.clarityDb = enabled ? 2.7 : 0;
  next.airDb = enabled ? 3.3 : 0;
  next.deharshAmount = 0;
  applyOutputProfileSnapshot("speaker", next);
}

export function setMusicSpeakerPunch(enabled: boolean) {
  if (state.outputProfile !== "speaker") return;
  const next = currentOutputProfileSnapshot();
  // R75: this state is consumed by the Studio transient shaper on clean-HD profiles.
  next.dynamicsRestoreEnabled = enabled;
  next.dynamicsRestoreAmount = enabled ? 92 : 0;
  applyOutputProfileSnapshot("speaker", next);
}

export function setMusicSpeakerWide(enabled: boolean) {
  if (state.outputProfile !== "speaker") return;
  const next = currentOutputProfileSnapshot();
  // Universal speaker WIDE is intentionally geometry-agnostic Mid/Side width,
  // not crosstalk cancellation. True CTC requires known driver/listener geometry.
  next.stereoFieldEnabled = enabled;
  next.stereoUserWidth = enabled ? 138 : 100;
  next.stereoCenterFocus = 100;
  next.bassMonoHz = enabled ? 105 : 90;
  applyOutputProfileSnapshot("speaker", next);
}

export type MusicAnalogMode = "off" | "studio" | "warm";

function applyAnalogModeToSnapshot(next: OutputProfileSnapshot, mode: MusicAnalogMode) {
  if (mode === "off") {
    next.exciterEnabled = false;
    next.exciterAmount = 0;
    next.saturationLow = 0;
    next.saturationMid = 0;
    next.saturationHigh = 0;
    return;
  }
  next.exciterEnabled = true;
  if (mode === "studio") {
    next.exciterAmount = 8;
    next.saturationLow = 2;
    next.saturationMid = 4;
    next.saturationHigh = 3;
  } else {
    next.exciterAmount = 12;
    next.saturationLow = 5;
    next.saturationMid = 8;
    next.saturationHigh = 5;
  }
}

export function setMusicHeadphoneNeuralBass(enabled: boolean) {
  if (state.outputProfile !== "headphones") return;
  const next = currentOutputProfileSnapshot();
  next.bassEngineEnabled = enabled;
  next.bassSubDb = enabled ? 3.8 : 0;
  next.bassPunchDb = enabled ? 1.8 : 0;
  next.bassBodyDb = enabled ? 0.8 : 0;
  next.bassTightness = enabled ? 76 : 55;
  applyOutputProfileSnapshot("headphones", next);
}

export function setMusicSpeakerNeuralBass(enabled: boolean) {
  if (state.outputProfile !== "speaker") return;
  const next = currentOutputProfileSnapshot();
  next.bassEngineEnabled = enabled;
  next.bassSubDb = enabled ? 4.0 : 0;
  next.bassPunchDb = enabled ? 2.0 : 0;
  next.bassBodyDb = enabled ? 0.9 : 0;
  next.bassTightness = enabled ? 78 : 55;
  applyOutputProfileSnapshot("speaker", next);
}

export function setMusicHeadphoneImpact(enabled: boolean) {
  if (state.outputProfile !== "headphones") return;
  const next = currentOutputProfileSnapshot();
  next.dynamicsRestoreEnabled = enabled;
  next.dynamicsRestoreAmount = enabled ? 92 : 0;
  applyOutputProfileSnapshot("headphones", next);
}

export function setMusicHeadphoneAnalog(mode: MusicAnalogMode) {
  if (state.outputProfile !== "headphones") return;
  const next = currentOutputProfileSnapshot();
  applyAnalogModeToSnapshot(next, mode);
  applyOutputProfileSnapshot("headphones", next);
}

export function setMusicSpeakerAnalog(mode: MusicAnalogMode) {
  if (state.outputProfile !== "speaker") return;
  const next = currentOutputProfileSnapshot();
  applyAnalogModeToSnapshot(next, mode);
  applyOutputProfileSnapshot("speaker", next);
}

export type MusicHdXpanderLevel = 0 | 1 | 2 | 3;

function setMusicHdXpanderForProfile(profile: "headphones" | "speaker", level: MusicHdXpanderLevel) {
  if (state.outputProfile !== profile) return;
  const next = currentOutputProfileSnapshot();
  next.hdXpanderLevel = Math.max(0, Math.min(3, Math.round(level))) as MusicHdXpanderLevel;
  applyOutputProfileSnapshot(profile, next);
}

export function setMusicHeadphoneHdXpander(level: MusicHdXpanderLevel) {
  setMusicHdXpanderForProfile("headphones", level);
}

export function setMusicSpeakerHdXpander(level: MusicHdXpanderLevel) {
  setMusicHdXpanderForProfile("speaker", level);
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
  if (profile === state.outputProfile) {
    savePlayerSetting(STORAGE_KEYS.dspBypass, "false");
    emit({ dspBypass: false, dspVerificationMode: "off" });
    applyProcessingSettings();
    return;
  }

  // Store the profile we are leaving before changing any global active keys.
  writeOutputProfileSnapshot(state.outputProfile, currentOutputProfileSnapshot());

  savePlayerSetting(STORAGE_KEYS.outputProfile, profile);
  savePlayerSetting(STORAGE_KEYS.dspBypass, "false");

  if (profile === "reference") {
    emit({
      outputProfile: profile,
      dspBypass: false,
      dspVerificationMode: "off",
    });
    applyProcessingSettings();
    return;
  }

  // Restore the target device's own state. A never-used target starts from a
  // safe clean baseline instead of inheriting the previous device's DSP.
  const target = readOutputProfileSnapshot(profile) ?? cleanOutputProfileSnapshot(profile);
  applyOutputProfileSnapshot(profile, target);
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

let cleanHdRouteRecoveryTimer: number | null = null;

function scheduleCleanHdRouteRecovery(delayMs = 450) {
  if (typeof window === "undefined") return;
  if (state.outputProfile !== "headphones" && state.outputProfile !== "speaker") return;
  if (!state.currentTrack) return;
  if (cleanHdRouteRecoveryTimer != null) window.clearTimeout(cleanHdRouteRecoveryTimer);
  cleanHdRouteRecoveryTimer = window.setTimeout(() => {
    cleanHdRouteRecoveryTimer = null;
    if (studioRecoveryInFlight) return;
    studioRecoveryInFlight = true;
    lastStudioRecoveryAt = Date.now();
    void rebuildMusicAudioEngine()
      .catch(() => emit({ dspStatus: "unavailable" }))
      .finally(() => { studioRecoveryInFlight = false; });
  }, Math.max(120, delayMs));
}

function installCleanHdRouteRecovery() {
  if (typeof window === "undefined") return;
  const guardedWindow = window as Window & { __mvpCleanHdRouteWatchInstalled?: boolean };
  if (guardedWindow.__mvpCleanHdRouteWatchInstalled) return;
  guardedWindow.__mvpCleanHdRouteWatchInstalled = true;

  try {
    navigator.mediaDevices?.addEventListener?.("devicechange", () => scheduleCleanHdRouteRecovery(500));
  } catch {
    /* Browser does not expose output-route change events. */
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (state.outputProfile !== "headphones" && state.outputProfile !== "speaker") return;
    if (!audioContext || audioContext.state === "running") return;
    scheduleCleanHdRouteRecovery(250);
  });

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    scheduleCleanHdRouteRecovery(250);
  });
}

installCleanHdRouteRecovery();

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
export function getMusicStudioTelemetry() {
  return getMvpStudioTelemetry();
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
