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
  MUSIC_OUTPUT_PROFILES,
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
  setMusicEqTopology,
  setMusicMultibandEnabled,
  setMusicDynamicEqEnabled,
  setMusicNormalizationEnabled,
  setMusicHeadphoneBassImpact,
  setMusicHeadphoneCenter,
  setMusicHeadphoneCrossfeed,
  setMusicHeadphoneDepth,
  setMusicHeadphoneMode,
  setMusicHeadphoneWidth,
  setMusicPreamp,
  setMusicOutputProfile,
  setMusicVolume,
  setPlayerMusicPreference,
  stopMusic,
  toggleMusicShuffle,
  useMusicPlayer,
  type MusicCustomPresetSlot,
  type MusicEqPreset,
  type MusicEqTopology,
  type MusicHeadphoneMode,
  type MusicOutputProfile,
  type MusicDspEngineMode,
} from "../../lib/musicPlayer";
import { discoverMoreFromTrack } from "../../lib/musicDiscovery";
import {
  analyzeMusicSourceFile,
  analyzeMusicTrackSource,
  compareMusicSources,
  flushDeferredMusicSourceCleanup,
  replaceMusicTrackSource,
  type MusicSourceAnalysis,
  type MusicSourceUpgradeComparison,
} from "../../lib/musicSourceUpgrade";

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
  | "guitar"
  | "discover"
  | "music"
  | "headphones"
  | "car"
  | "speaker"
  | "save";

function outputProfileIconName(profile: MusicOutputProfile): IconName {
  if (profile === "headphones") return "headphones";
  if (profile === "car_hifi") return "car";
  if (profile === "speaker") return "speaker";
  return "equalizer";
}

type SavedDspProfile = {
  name: string;
  outputProfile: MusicOutputProfile;
  tonePreset: MusicEqPreset;
  eqTopology: MusicEqTopology;
  eqEnabled: boolean;
  eqGains: number[];
  preampDb: number;
  normalizationEnabled: boolean;
  multibandEnabled: boolean;
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

function musicSourceQualityLabel(track: MusicTrack | null) {
  const source = analyzeMusicTrackSource(track);
  return `${source.codec} • ${source.bitrateLabel}${source.lossless ? " • LOSSLESS" : ""}`;
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
  if (name === "guitar") return <svg viewBox="0 0 24 24" aria-hidden><path d="M15.7 2.7 21.3 8.3l-2.1 2.1-1.3-1.3-4.3 4.3c.7 2 .2 4.3-1.5 6-2.5 2.5-6.4 2.7-8.7.4-2.3-2.3-2.1-6.2.4-8.7 1.7-1.7 4-2.2 6-1.5l4.3-4.3-1.3-1.3 2.9-1.3ZM7.1 12.2a2.35 2.35 0 1 0 0 4.7 2.35 2.35 0 0 0 0-4.7Zm4-1.1 1.8 1.8 4.3-4.3-1.8-1.8-4.3 4.3Z" /></svg>;
  if (name === "discover") return <svg viewBox="0 0 24 24" aria-hidden><path d="m12 1.7 2.05 5.25L19.3 9 14.05 11.05 12 16.3l-2.05-5.25L4.7 9l5.25-2.05L12 1.7Zm6.2 11.6 1.15 2.95 2.95 1.15-2.95 1.15-1.15 2.95-1.15-2.95-2.95-1.15 2.95-1.15 1.15-2.95ZM5.1 14.6l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3Z" /></svg>;
  if (name === "equalizer") return <svg viewBox="0 0 24 24" aria-hidden><path d="M5 3h2v18H5V3Zm6 4h2v14h-2V7Zm6-4h2v18h-2V3ZM3 8h6v3H3V8Zm6 5h6v3H9v-3Zm6-4h6v3h-6V9Z" /></svg>;
  if (name === "headphones") return <svg viewBox="0 0 24 24" aria-hidden><path d="M12 3a8 8 0 0 0-8 8v6.2A2.8 2.8 0 0 0 6.8 20H9v-7H6v-2a6 6 0 0 1 12 0v2h-3v7h2.2a2.8 2.8 0 0 0 2.8-2.8V11a8 8 0 0 0-8-8ZM7 15v3h-.2a.8.8 0 0 1-.8-.8V15h1Zm11 2.2a.8.8 0 0 1-.8.8H17v-3h1v2.2Z" /></svg>;
  if (name === "car") return <svg viewBox="0 0 24 24" aria-hidden><path d="m5.2 6.2 1.4-2.8A2.5 2.5 0 0 1 8.8 2h6.4a2.5 2.5 0 0 1 2.2 1.4l1.4 2.8 1.4.5c1.1.4 1.8 1.4 1.8 2.6V18a2 2 0 0 1-2 2h-1v1.2a.8.8 0 0 1-.8.8h-1.4a.8.8 0 0 1-.8-.8V20H8v1.2a.8.8 0 0 1-.8.8H5.8a.8.8 0 0 1-.8-.8V20H4a2 2 0 0 1-2-2V9.3c0-1.2.7-2.2 1.8-2.6l1.4-.5ZM7.4 6h9.2l-.9-1.8a.6.6 0 0 0-.5-.3H8.8a.6.6 0 0 0-.5.3L7.4 6ZM5.5 10a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm13 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM7 16h10v-2H7v2Z" /></svg>;
  if (name === "speaker") return <svg viewBox="0 0 24 24" aria-hidden><path d="M7 2h10a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Zm5 3.2a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Zm0 6.1a4.1 4.1 0 1 0 0 8.2 4.1 4.1 0 0 0 0-8.2Zm0 2a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2Z" /></svg>;
  if (name === "save") return <svg viewBox="0 0 24 24" aria-hidden><path d="M5 3h11.6L21 7.4V21H3V3h2Zm1 2v5h10V5H6Zm0 8v6h12v-6H6Zm2-7h6v2H8V6Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden><path d="M9 4v11.1A4.5 4.5 0 1 0 11 19V8.1l8-2V12a4.5 4.5 0 1 0 2 3.9V2L9 4Z" /></svg>;
}

const RTA_LABELS = ["31", "63", "125", "250", "500", "1K", "2K", "4K", "8K", "16K"] as const;

function MusicActivityRta({
  playing,
  profileLabel,
  eqLabel,
  outputProfile,
  sourceQuality,
  dspEngineMode,
}: {
  playing: boolean;
  profileLabel: string;
  eqLabel: string;
  outputProfile: MusicOutputProfile;
  sourceQuality: MusicSourceAnalysis;
  dspEngineMode: MusicDspEngineMode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineBadgeTone = dspEngineMode === "studio_wasm" ? "studio" : dspEngineMode === "advanced_worklet" ? "worklet" : dspEngineMode === "native_fallback" ? "native" : "unavailable";
  const engineBadgeLabel = dspEngineMode === "studio_wasm" ? "MVP STUDIO • WASM" : dspEngineMode === "advanced_worklet" ? "COMPATIBILITY • WORKLET" : dspEngineMode === "native_fallback" ? "COMPATIBILITY • NATIVE" : "DSP UNAVAILABLE";

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    let frame = 0;
    let lastDraw = 0;
    let visible = true;
    const displayed = new Float32Array(10);
    const rawHistory = new Float32Array(10);
    const peaks = new Float32Array(10);
    const peakHoldUntil = new Float64Array(10);

    const observer = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => {
          visible = entries.some((entry) => entry.isIntersecting);
        }, { threshold: 0.02 })
      : null;
    observer?.observe(host);

    const draw = (now: number) => {
      frame = window.requestAnimationFrame(draw);
      if (!visible || (typeof document !== "undefined" && document.hidden) || now - lastDraw < 28) return;
      lastDraw = now;

      const width = Math.max(1, Math.floor(canvas.clientWidth));
      const height = Math.max(1, Math.floor(canvas.clientHeight));
      const dpr = Math.min(1.75, window.devicePixelRatio || 1);
      const pixelWidth = Math.floor(width * dpr);
      const pixelHeight = Math.floor(height * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const compact = width < 520;
      const plotLeft = compact ? 27 : 40;
      const plotRight = compact ? 5 : 8;
      const plotTop = compact ? 27 : 31;
      const plotBottom = compact ? 22 : 24;
      const plotWidth = Math.max(1, width - plotLeft - plotRight);
      const plotHeight = Math.max(1, height - plotTop - plotBottom);

      const background = ctx.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, "#081319");
      background.addColorStop(0.24, "#041016");
      background.addColorStop(0.70, "#02080c");
      background.addColorStop(1, "#010405");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      // Recessed optical-glass crown. Purely visual and does not touch the audio signal.
      const crown = ctx.createLinearGradient(0, 0, 0, Math.max(24, plotTop));
      crown.addColorStop(0, "rgba(132,229,255,.055)");
      crown.addColorStop(0.42, "rgba(51,132,157,.018)");
      crown.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = crown;
      ctx.fillRect(0, 0, width, plotTop + 4);

      const raw = playing ? getMusicRtaLevels() : Array(10).fill(0);
      let framePeak = 0;
      let frameSum = 0;
      for (let index = 0; index < 10; index += 1) {
        const value = Math.max(0, Math.min(1, Number(raw[index]) || 0));
        framePeak = Math.max(framePeak, value);
        frameSum += value;
      }
      const frameAverage = frameSum / 10;
      const activity = Math.max(0, Math.min(1, (framePeak - 0.022) / 0.50));
      const dynamicFloor = Math.min(framePeak * 0.44, Math.max(0.012, frameAverage * 0.48));
      const dynamicRange = Math.max(0.078, framePeak - dynamicFloor);

      for (let index = 0; index < 10; index += 1) {
        const source = Math.max(0, Math.min(1, Number(raw[index]) || 0));
        const opened = source < 0.012 ? 0 : Math.min(1, (source - 0.012) / 0.70);
        const absoluteShape = Math.pow(opened, 1.015);
        const contrast = Math.max(0, Math.min(1, (source - dynamicFloor) / dynamicRange));
        const contrastShape = Math.pow(contrast, 1.30) * activity;
        const transient = playing ? Math.max(0, source - rawHistory[index]) : 0;
        rawHistory[index] = source;

        // Every movement term comes from the real analyzer signal. No fake/random motion.
        const shaped = Math.min(1, absoluteShape * 0.66 + contrastShape * 0.28 + Math.min(0.12, transient * 1.35));
        const previous = displayed[index];
        const attack = 0.91;
        // Bass decays with more physical weight; upper bands release faster and finer.
        const frequencyRelease = 0.095 + index * 0.0105;
        const release = playing ? frequencyRelease : 0.44;
        displayed[index] = previous + (shaped - previous) * (shaped > previous ? attack : release);

        if (displayed[index] >= peaks[index] - 0.0025) {
          peaks[index] = displayed[index];
          peakHoldUntil[index] = now + 720;
        } else if (now > peakHoldUntil[index]) {
          const peakFall = 0.0095 + index * 0.00075;
          peaks[index] = Math.max(displayed[index], peaks[index] - peakFall);
        }
      }

      const gridRatios = [0, 0.2, 0.4, 0.6, 0.8, 1];
      ctx.lineWidth = 1;
      gridRatios.forEach((ratio, index) => {
        const y = Math.round(plotTop + plotHeight * ratio) + 0.5;
        ctx.strokeStyle = index === 0 || index === gridRatios.length - 1
          ? "rgba(126,207,231,.135)"
          : "rgba(126,207,231,.058)";
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(width - plotRight, y);
        ctx.stroke();
      });

      // Fine subdivisions give the window studio-RTA precision without becoming graph paper.
      for (let division = 1; division < 10; division += 1) {
        if (division % 2 === 0) continue;
        const y = Math.round(plotTop + plotHeight * (division / 10)) + 0.5;
        ctx.strokeStyle = "rgba(105,185,210,.024)";
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(width - plotRight, y);
        ctx.stroke();
      }

      {
        const dbLabels = ["0", "-12", "-24", "-36", "-48", "-60"];
        ctx.fillStyle = compact ? "rgba(187,220,230,.62)" : "rgba(187,220,230,.64)";
        ctx.font = compact ? "800 7px system-ui, sans-serif" : "800 9px system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        dbLabels.forEach((label, index) => {
          ctx.fillText(label, plotLeft - (compact ? 5 : 8), plotTop + plotHeight * (index / (dbLabels.length - 1)));
        });
      }

      const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
      const mixChannel = (from: number, to: number, amount: number) => Math.round(from + (to - from) * clamp01(amount));
      const mixMeterColor = (from: [number, number, number], to: [number, number, number], amount: number, alpha = 1) =>
        `rgba(${mixChannel(from[0], to[0], amount)},${mixChannel(from[1], to[1], amount)},${mixChannel(from[2], to[2], amount)},${alpha})`;
      const meterColorAt = (ratio: number, alpha = 1) => {
        const level = clamp01(ratio);
        // Exact visual dB zones from -60 dB at the floor to 0 dB at the crown.
        // -60..-48 deep cyan, -48..-36 cyan, -36..-24 aqua,
        // -24..-12 yellow-green -> warm yellow, -12..-6 amber, -6..0 orange/red.
        if (level <= 0.20) return mixMeterColor([7, 113, 160], [13, 169, 204], level / 0.20, alpha);
        if (level <= 0.40) return mixMeterColor([13, 169, 204], [20, 210, 232], (level - 0.20) / 0.20, alpha);
        if (level <= 0.60) return mixMeterColor([20, 210, 232], [57, 233, 205], (level - 0.40) / 0.20, alpha);
        if (level <= 0.80) return mixMeterColor([57, 233, 205], [244, 209, 70], (level - 0.60) / 0.20, alpha);
        if (level <= 0.90) return mixMeterColor([244, 209, 70], [255, 161, 52], (level - 0.80) / 0.10, alpha);
        return mixMeterColor([255, 161, 52], [255, 74, 63], (level - 0.90) / 0.10, alpha);
      };
      const meterGlowAt = (ratio: number) => {
        const level = clamp01(ratio);
        if (level >= 0.90) return "rgba(255,90,67,.62)";
        if (level >= 0.80) return "rgba(255,178,58,.58)";
        if (level >= 0.60) return "rgba(227,214,80,.48)";
        return "rgba(48,218,239,.42)";
      };

      const gap = Math.max(compact ? 3 : 7, Math.min(compact ? 6 : 12, plotWidth * 0.010));
      const slotWidth = Math.max(9, (plotWidth - gap * 9) / 10);

      for (let band = 0; band < 10; band += 1) {
        const slotX = plotLeft + band * (slotWidth + gap);
        const widthRatio = Math.max(0.48, 0.64 - band * 0.014);
        const barWidth = Math.max(5, slotWidth * (compact ? Math.max(0.50, widthRatio - 0.05) : widthRatio));
        const barX = slotX + (slotWidth - barWidth) / 2;

        // Smoked recessed meter well with a fine vertical spine.
        const wellGradient = ctx.createLinearGradient(0, plotTop, 0, plotTop + plotHeight);
        wellGradient.addColorStop(0, "rgba(40,69,79,.16)");
        wellGradient.addColorStop(0.42, "rgba(7,30,38,.22)");
        wellGradient.addColorStop(1, "rgba(1,9,13,.82)");
        ctx.fillStyle = wellGradient;
        ctx.fillRect(slotX, plotTop, slotWidth, plotHeight);
        ctx.strokeStyle = "rgba(111,196,221,.09)";
        ctx.strokeRect(Math.round(slotX) + 0.5, Math.round(plotTop) + 0.5, Math.max(1, Math.round(slotWidth) - 1), Math.max(1, Math.round(plotHeight) - 1));
        ctx.fillStyle = "rgba(190,238,250,.025)";
        ctx.fillRect(Math.round(slotX + slotWidth * 0.5), plotTop + 1, 1, plotHeight - 2);

        const level = Math.max(0, Math.min(1, displayed[band]));
        const activeHeight = Math.max(0, plotHeight * level);
        if (activeHeight > 0.5) {
          const activeY = plotTop + plotHeight - activeHeight;
          const segmentHeight = compact ? 2.2 : 2.7;
          const segmentGap = compact ? 1.65 : 1.9;
          const pitch = segmentHeight + segmentGap;
          const segmentCount = Math.ceil(activeHeight / pitch);

          ctx.save();
          ctx.shadowColor = "rgba(45,211,242,.22)";
          ctx.shadowBlur = compact ? 3 : 5;
          for (let segment = 0; segment < segmentCount; segment += 1) {
            const segmentY = plotTop + plotHeight - (segment + 1) * pitch;
            if (segmentY + segmentHeight < activeY) continue;
            const normalizedHeight = clamp01(1 - (segmentY - plotTop) / plotHeight);
            ctx.fillStyle = meterColorAt(normalizedHeight, 0.98);
            ctx.shadowColor = meterGlowAt(normalizedHeight);
            ctx.fillRect(barX, segmentY, barWidth, segmentHeight);

            // Bright optical core follows the same dB color zone instead of turning every band white.
            ctx.fillStyle = meterColorAt(Math.min(1, normalizedHeight + 0.035), normalizedHeight >= 0.80 ? 0.42 : 0.30);
            const coreWidth = Math.max(1, barWidth * 0.28);
            ctx.fillRect(barX + (barWidth - coreWidth) / 2, segmentY, coreWidth, segmentHeight);
          }
          ctx.restore();

          // Current-level cap uses the exact dB zone color reached by this band.
          ctx.fillStyle = meterColorAt(level, 0.88);
          ctx.fillRect(barX - 0.5, Math.round(activeY), barWidth + 1, compact ? 1.2 : 1.6);
        }

        if (playing && peaks[band] > 0.022) {
          const peakRatio = clamp01(peaks[band]);
          const peakY = Math.max(plotTop, plotTop + plotHeight * (1 - peakRatio));
          ctx.save();
          ctx.fillStyle = meterColorAt(peakRatio, 1);
          ctx.shadowColor = meterGlowAt(peakRatio);
          ctx.shadowBlur = compact ? 5 : 8;
          ctx.fillRect(barX - 2, Math.round(peakY), barWidth + 4, compact ? 2.0 : 2.5);
          // Hairline highlight makes the peak marker read like a calibrated hardware hold line.
          ctx.fillStyle = "rgba(255,255,255,.36)";
          ctx.fillRect(barX - 1, Math.round(peakY), barWidth + 2, 0.7);
          ctx.restore();
        }
      }

      const floorGlow = ctx.createLinearGradient(0, plotTop + plotHeight * 0.68, 0, plotTop + plotHeight);
      floorGlow.addColorStop(0, "rgba(13,143,173,0)");
      floorGlow.addColorStop(1, playing && framePeak > 0.075 ? "rgba(18,173,199,.075)" : "rgba(18,143,171,.018)");
      ctx.fillStyle = floorGlow;
      ctx.fillRect(plotLeft, plotTop + plotHeight * 0.66, plotWidth, plotHeight * 0.34);

      const glass = ctx.createLinearGradient(0, plotTop, 0, plotTop + plotHeight * 0.48);
      glass.addColorStop(0, "rgba(255,255,255,.032)");
      glass.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glass;
      ctx.fillRect(plotLeft, plotTop, plotWidth, plotHeight * 0.48);
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [playing]);

  return (
    <div ref={hostRef} className="tr-activityRta tr-activityRta--10band tr-rtaFidelity" aria-label="10 band real-time spectrum analyzer">
      <canvas ref={canvasRef} />
      <div className="tr-rtaFidelityHead" aria-hidden>
        <span><i className={playing ? "is-live" : ""} />REAL-TIME SPECTRUM <span className={`tr-rtaEngineBadge is-${engineBadgeTone}`}><svg viewBox="0 0 28 14" aria-hidden><path d="M1 7h3l2-4.5L9 11.5 12 2l3 10 3-7 2 4h7" /></svg><b>{engineBadgeLabel}</b></span></span>
        <strong>
          <span className={`tr-rtaSourceQuality is-${sourceQuality.tier}`}>
            <span>{sourceQuality.codec} · {sourceQuality.bitrateLabel}</span>
            <em>{sourceQuality.qualityLabel}</em>
          </span>
          <span className="tr-rtaHeadDivider">|</span>
          <span className="tr-rtaOutputIcon" data-profile={outputProfile}><PlayerIcon name={outputProfileIconName(outputProfile)} /></span>
          <span className="tr-rtaProfileCopy">{profileLabel}</span><b>•</b><span className="tr-rtaEqCopy">{eqLabel}</span>
        </strong>
      </div>
      <div className="tr-activityRtaLabels" aria-hidden>
        {RTA_LABELS.map((label) => <span key={label}>{label}</span>)}
      </div>
    </div>
  );
}

type HeroRgb = { r: number; g: number; b: number };
type HeroPalette = [HeroRgb, HeroRgb, HeroRgb, HeroRgb, HeroRgb];
type HeroColorPool = HeroRgb[];

const HERO_SCENE_COUNT = 5;
const HERO_SCENE_MIN_MS = 8000;
const HERO_SCENE_MAX_MS = 10000;
const HERO_MORPH_MS = 1150;
const HERO_PALETTE_MIN_MS = 4200;
const HERO_PALETTE_MAX_MS = 6500;
const HERO_NEUTRAL_PALETTE: HeroPalette = [
  { r: 196, g: 216, b: 220 },
  { r: 137, g: 164, b: 171 },
  { r: 194, g: 151, b: 114 },
  { r: 241, g: 235, b: 220 },
  { r: 20, g: 27, b: 31 },
];

function heroClamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function heroHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function heroMix(left: HeroRgb, right: HeroRgb, amount: number): HeroRgb {
  const mix = heroClamp(amount);
  return {
    r: left.r + (right.r - left.r) * mix,
    g: left.g + (right.g - left.g) * mix,
    b: left.b + (right.b - left.b) * mix,
  };
}

function heroLightness(color: HeroRgb) {
  return (Math.max(color.r, color.g, color.b) + Math.min(color.r, color.g, color.b)) / 510;
}

function heroSaturation(color: HeroRgb) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const chroma = max - min;
  return chroma === 0 ? 0 : heroClamp(chroma / Math.max(0.001, 1 - Math.abs(2 * light - 1)));
}

function heroColorDistance(left: HeroRgb, right: HeroRgb) {
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function heroMakeVisible(color: HeroRgb) {
  const gray = (color.r + color.g + color.b) / 3;
  const saturationBoost = 1.18;
  let adjusted: HeroRgb = {
    r: heroClamp(gray + (color.r - gray) * saturationBoost, 0, 255),
    g: heroClamp(gray + (color.g - gray) * saturationBoost, 0, 255),
    b: heroClamp(gray + (color.b - gray) * saturationBoost, 0, 255),
  };
  const light = heroLightness(adjusted);
  if (light < 0.14) {
    const scale = Math.min(2.1, 0.22 / Math.max(0.035, light));
    adjusted = {
      r: heroClamp(adjusted.r * scale, 0, 255),
      g: heroClamp(adjusted.g * scale, 0, 255),
      b: heroClamp(adjusted.b * scale, 0, 255),
    };
  } else if (light > 0.88) {
    const scale = 0.82 / Math.max(0.001, light);
    adjusted = {
      r: heroClamp(adjusted.r * scale, 0, 255),
      g: heroClamp(adjusted.g * scale, 0, 255),
      b: heroClamp(adjusted.b * scale, 0, 255),
    };
  }
  return adjusted;
}

function extractHeroPalette(data: Uint8ClampedArray): HeroPalette | null {
  type Bucket = { color: HeroRgb; hits: number; saturation: number; light: number };
  const bins = new Map<string, { r: number; g: number; b: number; hits: number }>();
  const quantum = 24;

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 180) continue;
    const color = { r: data[index], g: data[index + 1], b: data[index + 2] };
    const light = heroLightness(color);
    if (light < 0.025 || light > 0.985) continue;
    const qr = Math.round(color.r / quantum) * quantum;
    const qg = Math.round(color.g / quantum) * quantum;
    const qb = Math.round(color.b / quantum) * quantum;
    const key = `${qr}:${qg}:${qb}`;
    const bucket = bins.get(key) ?? { r: 0, g: 0, b: 0, hits: 0 };
    bucket.r += color.r;
    bucket.g += color.g;
    bucket.b += color.b;
    bucket.hits += 1;
    bins.set(key, bucket);
  }

  const ranked: Bucket[] = Array.from(bins.values())
    .filter((bucket) => bucket.hits >= 2)
    .map((bucket) => {
      const color = { r: bucket.r / bucket.hits, g: bucket.g / bucket.hits, b: bucket.b / bucket.hits };
      return { color, hits: bucket.hits, saturation: heroSaturation(color), light: heroLightness(color) };
    })
    .sort((a, b) => b.hits - a.hits);

  if (!ranked.length) return null;

  const usable = ranked.filter((item) => item.light > 0.07 && item.light < 0.95);
  const source = usable.length ? usable : ranked;
  const colorful = source.filter((item) => item.saturation > 0.16);
  const primaryPool = colorful.length >= 2 ? colorful : source;
  const dominant = [...primaryPool].sort((a, b) => {
    const score = (item: Bucket) => Math.sqrt(item.hits) * (0.72 + item.saturation * 2.35) * (1.08 - Math.abs(item.light - 0.48) * 0.42);
    return score(b) - score(a);
  })[0];

  const diversityScore = (item: Bucket, anchors: HeroRgb[]) => {
    const distance = Math.min(...anchors.map((anchor) => heroColorDistance(anchor, item.color)));
    const population = Math.sqrt(item.hits);
    return distance * (0.48 + item.saturation * 0.88) + population * (7.0 + item.saturation * 9.0);
  };

  const chosen: HeroRgb[] = [heroMakeVisible(dominant.color)];
  while (chosen.length < 3) {
    let best: Bucket | null = null;
    let bestScore = -Infinity;
    for (const item of source.slice(0, Math.min(80, source.length))) {
      const score = diversityScore(item, chosen);
      if (score > bestScore && chosen.every((color) => heroColorDistance(color, item.color) > 38)) {
        best = item;
        bestScore = score;
      }
    }
    chosen.push(heroMakeVisible((best ?? source[Math.min(chosen.length, source.length - 1)]).color));
  }

  const accentCandidate = [...source]
    .sort((a, b) => (b.saturation * 1.6 + Math.sqrt(b.hits) * 0.10) - (a.saturation * 1.6 + Math.sqrt(a.hits) * 0.10))
    .find((item) => chosen.every((color) => heroColorDistance(color, item.color) > 34));
  if (accentCandidate) chosen[2] = heroMakeVisible(accentCandidate.color);

  const highlightCandidate = [...source]
    .filter((item) => item.light > 0.48)
    .sort((a, b) => (b.light * 1.5 + b.saturation * 0.35 + Math.sqrt(b.hits) * 0.03) - (a.light * 1.5 + a.saturation * 0.35 + Math.sqrt(a.hits) * 0.03))[0];
  const highlightBase = highlightCandidate?.color ?? chosen.reduce((best, color) => heroLightness(color) > heroLightness(best) ? color : best, chosen[0]);
  const highlight = heroMix(heroMakeVisible(highlightBase), { r: 255, g: 255, b: 255 }, 0.18);
  const shadow = heroMix(heroMix(chosen[0], chosen[1], 0.48), { r: 0, g: 0, b: 0 }, 0.82);
  return [chosen[0], chosen[1], chosen[2], highlight, shadow];
}


function extractHeroColorPool(data: Uint8ClampedArray): HeroColorPool {
  type PoolBucket = { color: HeroRgb; hits: number; saturation: number; light: number };
  const bins = new Map<string, { r: number; g: number; b: number; hits: number }>();
  const quantum = 20;

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 180) continue;
    const color = { r: data[index], g: data[index + 1], b: data[index + 2] };
    const light = heroLightness(color);
    if (light < 0.025 || light > 0.985) continue;
    const qr = Math.round(color.r / quantum) * quantum;
    const qg = Math.round(color.g / quantum) * quantum;
    const qb = Math.round(color.b / quantum) * quantum;
    const key = `${qr}:${qg}:${qb}`;
    const bucket = bins.get(key) ?? { r: 0, g: 0, b: 0, hits: 0 };
    bucket.r += color.r;
    bucket.g += color.g;
    bucket.b += color.b;
    bucket.hits += 1;
    bins.set(key, bucket);
  }

  const ranked: PoolBucket[] = Array.from(bins.values())
    .filter((bucket) => bucket.hits >= 2)
    .map((bucket) => {
      const color = { r: bucket.r / bucket.hits, g: bucket.g / bucket.hits, b: bucket.b / bucket.hits };
      return { color, hits: bucket.hits, saturation: heroSaturation(color), light: heroLightness(color) };
    })
    .filter((item) => item.light > 0.055 && item.light < 0.96)
    .sort((a, b) => {
      const score = (item: PoolBucket) => Math.sqrt(item.hits) * (0.92 + item.saturation * 1.85) * (1.08 - Math.abs(item.light - 0.5) * 0.34);
      return score(b) - score(a);
    });

  if (!ranked.length) return HERO_NEUTRAL_PALETTE.slice(0, 4).map((color) => ({ ...color }));

  const pool: HeroRgb[] = [];
  for (const item of ranked.slice(0, 100)) {
    const visible = heroMakeVisible(item.color);
    const minDistance = pool.length < 4 ? 34 : 27;
    if (pool.every((existing) => heroColorDistance(existing, visible) > minDistance)) pool.push(visible);
    if (pool.length >= 9) break;
  }

  // Preserve useful light and dark neutrals from the actual artwork as fidelity accents.
  const lightNeutral = ranked
    .filter((item) => item.light > 0.62 && item.saturation < 0.34)
    .sort((a, b) => (b.hits * b.light) - (a.hits * a.light))[0];
  const darkNeutral = ranked
    .filter((item) => item.light < 0.32)
    .sort((a, b) => b.hits - a.hits)[0];
  for (const item of [lightNeutral, darkNeutral]) {
    if (!item) continue;
    const visible = heroMakeVisible(item.color);
    if (pool.every((existing) => heroColorDistance(existing, visible) > 24)) pool.push(visible);
  }

  while (pool.length < 5) pool.push({ ...HERO_NEUTRAL_PALETTE[pool.length % 4] });
  return pool.slice(0, 10);
}

function heroPaletteFromPool(pool: HeroColorPool, phase: number, seed: number): HeroPalette {
  const source = pool.length ? pool : HERO_NEUTRAL_PALETTE.slice(0, 4);
  const count = source.length;
  const cycleStep = count % 2 === 0 ? (count % 3 === 0 ? 5 : 3) : 2;
  const start = (seed + phase * cycleStep) % count;
  const stride = count > 7 ? 3 : count > 4 ? 2 : 1;
  const pick = (offset: number) => ({ ...source[(start + offset * stride) % count] });
  const c0 = pick(0);
  let c1 = pick(1);
  let c2 = pick(2);

  if (heroColorDistance(c0, c1) < 28 && count > 3) c1 = pick(3);
  if (heroColorDistance(c0, c2) < 28 && count > 4) c2 = pick(4);

  const highlightBase = [...source].sort((a, b) => heroLightness(b) - heroLightness(a))[phase % Math.min(3, count)] ?? c1;
  const highlight = heroMix(heroMakeVisible(highlightBase), { r: 255, g: 255, b: 255 }, 0.12);
  const darkest = [...source].sort((a, b) => heroLightness(a) - heroLightness(b))[phase % Math.min(2, count)] ?? c0;
  const shadow = heroMix(darkest, { r: 0, g: 0, b: 0 }, 0.72);
  return [c0, c1, c2, highlight, shadow];
}

function heroTimedDuration(seed: number, step: number, minMs: number, maxMs: number) {
  const span = Math.max(1, maxMs - minMs);
  return minMs + (heroHash(`${seed}:${step}`) % (span + 1));
}

const HERO_VERTEX_SHADER = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const HERO_FRAGMENT_SHADER = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_sceneA;
  uniform float u_sceneB;
  uniform float u_blend;
  uniform vec4 u_audio;
  uniform float u_character;
  uniform vec3 u_c0;
  uniform vec3 u_c1;
  uniform vec3 u_c2;
  uniform vec3 u_c3;
  uniform vec3 u_c4;

  float sat(float v){ return clamp(v,0.0,1.0); }
  vec2 rot(vec2 p,float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c)*p; }

  float hash21(vec2 p){
    p=fract(p*vec2(123.34,456.21));
    p+=dot(p,p+45.32);
    return fract(p.x*p.y);
  }
  vec2 hash22(vec2 p){ float n=hash21(p); return vec2(n,hash21(p+n+19.19)); }

  float noise(vec2 p){
    vec2 i=floor(p), f=fract(p);
    f=f*f*(3.0-2.0*f);
    float a=hash21(i),b=hash21(i+vec2(1.0,0.0));
    float c=hash21(i+vec2(0.0,1.0)),d=hash21(i+vec2(1.0,1.0));
    return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
  }
  float fbm(vec2 p){
    float v=0.0,a=0.54;
    mat2 m=mat2(0.80,-0.60,0.60,0.80);
    for(int i=0;i<4;i++){
      v+=a*noise(p);
      p=m*p*2.02+vec2(13.7,8.1);
      a*=0.49;
    }
    return v;
  }

  vec2 cuv(vec2 uv){
    vec2 p=uv-0.5;
    p.x*=u_resolution.x/max(1.0,u_resolution.y);
    return p;
  }

  vec3 album(float x){
    x=fract(x)*4.0;
    if(x<1.0) return mix(u_c0,u_c1,smoothstep(0.0,1.0,x));
    if(x<2.0) return mix(u_c1,u_c2,smoothstep(0.0,1.0,x-1.0));
    if(x<3.0) return mix(u_c2,u_c0,smoothstep(0.0,1.0,x-2.0));
    return mix(u_c0,u_c3,smoothstep(0.0,1.0,x-3.0));
  }
  vec3 darkBase(){ return mix(vec3(0.0025,0.005,0.007),u_c4,0.54); }

  vec2 flowWarp(vec2 p,float t,float strength){
    vec2 q=vec2(
      fbm(p*0.72+vec2(t*0.12,-t*0.09)),
      fbm(p*0.76+vec2(4.7-t*0.10,1.9+t*0.11))
    )-0.5;
    vec2 r=vec2(
      fbm(p*0.88+q*1.55+vec2(7.1,2.3)+t*0.08),
      fbm(p*0.84+q*1.62+vec2(2.1,8.4)-t*0.085)
    )-0.5;
    return p+(q*0.72+r*0.48)*strength;
  }

  // Volumetric light field. Broad depth layers, no identifiable blobs or rings.
  vec3 sceneVolume(vec2 uv,float t){
    vec2 p=cuv(uv)*1.05;
    vec3 col=darkBase();
    float total=0.0;
    for(int i=0;i<9;i++){
      float z=float(i)/8.0;
      vec2 q=p*(0.78+z*0.82);
      q=rot(q,0.10*sin(t*0.16+z*3.2));
      q+=vec2(sin(t*0.20+z*5.1)*0.18,cos(t*0.17+z*4.3)*0.14);
      q=flowWarp(q,t+z*1.7,0.36+z*0.16);
      float n=fbm(q*1.32+vec2(z*5.3,-z*3.8));
      float d=smoothstep(0.44,0.77,n)*(1.0-z*0.38);
      float w=(0.066+z*0.014)*(1.0+u_audio.x*0.030);
      col+=album(n*0.54+z*0.19+u_character*0.13)*d*w;
      total+=d*w;
    }
    float bloom=smoothstep(0.18,0.52,total);
    col+=album(total*1.7+0.16)*bloom*(0.072+u_audio.w*0.010);
    return col;
  }

  // Liquid glass: continuous refractive heightfield with restrained specular light.
  vec3 sceneGlass(vec2 uv,float t){
    vec2 p=cuv(uv)*1.28;
    p=flowWarp(p,t,0.46);
    float e=0.012;
    float h=fbm(p*1.22+vec2(t*0.10,-t*0.075));
    float hx=fbm((p+vec2(e,0.0))*1.22+vec2(t*0.10,-t*0.075));
    float hy=fbm((p+vec2(0.0,e))*1.22+vec2(t*0.10,-t*0.075));
    vec2 g=clamp(vec2(h-hx,h-hy)/e,vec2(-1.1),vec2(1.1));
    vec2 refr=p+g*(0.075+u_audio.y*0.010);
    float under=fbm(refr*1.42-vec2(t*0.08,t*0.095));
    float depth=fbm(refr*0.62+vec2(-t*0.045,t*0.055));
    vec3 nrm=normalize(vec3(g*0.62,1.0));
    vec3 light=normalize(vec3(-0.38,0.30,1.0));
    float spec=pow(max(0.0,dot(nrm,light)),22.0);
    float rim=pow(1.0-max(0.0,nrm.z),2.4);
    vec3 col=mix(darkBase(),album(under*0.62+depth*0.21+0.08),0.42+under*0.46);
    col+=u_c3*spec*(0.145+u_audio.z*0.010);
    col+=album(depth+0.38)*rim*0.125;
    return col;
  }

  // Luminous fabric: a broad shaded surface, not traveling ribbon lines.
  vec3 sceneSilk(vec2 uv,float t){
    vec2 p=cuv(uv)*1.03;
    p=rot(p,0.08*sin(t*0.12));
    p=flowWarp(p,t,0.27);
    float phase=p.x*1.18+p.y*0.48;
    float h=0.34*sin(phase*1.24+t*0.34)+0.22*sin(p.x*0.78-p.y*1.12-t*0.27+2.3);
    h+=0.16*(fbm(p*1.05+vec2(t*0.065,-t*0.055))-0.5);
    float ex=0.018;
    vec2 px=p+vec2(ex,0.0), py=p+vec2(0.0,ex);
    float hx=0.34*sin((px.x*1.18+px.y*0.48)*1.24+t*0.34)+0.22*sin(px.x*0.78-px.y*1.12-t*0.27+2.3);
    float hy=0.34*sin((py.x*1.18+py.y*0.48)*1.24+t*0.34)+0.22*sin(py.x*0.78-py.y*1.12-t*0.27+2.3);
    vec3 nrm=normalize(vec3((h-hx)/ex*0.22,(h-hy)/ex*0.22,1.0));
    vec3 ld=normalize(vec3(-0.45,0.40,1.0));
    float diff=0.48+0.52*max(0.0,dot(nrm,ld));
    float sheen=pow(max(0.0,dot(nrm,normalize(vec3(0.30,-0.15,1.0)))),18.0);
    float tint=fbm(p*0.74+vec2(-t*0.045,t*0.052));
    vec3 surface=album(tint*0.58+h*0.13+u_character*0.08);
    vec3 col=mix(darkBase(),surface,0.18+diff*0.60);
    col+=u_c3*sheen*(0.115+u_audio.z*0.006);
    return col;
  }

  // Photon atmosphere: layered depth particles suspended inside colored haze.
  vec3 scenePhotons(vec2 uv,float t){
    vec2 p=cuv(uv);
    float haze=fbm(flowWarp(p*0.92,t,0.22)+vec2(t*0.045,-t*0.035));
    vec3 col=mix(darkBase(),album(haze*0.42+0.10),smoothstep(0.25,0.82,haze)*0.32);
    for(int layer=0;layer<4;layer++){
      float lf=float(layer);
      float scale=8.0+lf*6.5;
      vec2 drift=vec2(
        sin(t*(0.13+lf*0.012)+uv.y*2.7)*0.045+t*(0.005+lf*0.001),
        cos(t*(0.11+lf*0.010)+uv.x*2.2)*0.040-t*(0.003+lf*0.0008)
      );
      vec2 grid=(uv+drift)*scale;
      vec2 id=floor(grid), gv=fract(grid)-0.5;
      vec2 rnd=hash22(id+lf*71.3);
      vec2 pos=(rnd-0.5)*0.80;
      float d=length(gv-pos);
      float point=smoothstep(0.070+lf*0.005,0.0,d)*step(0.48-lf*0.040,rnd.x);
      float halo=smoothstep(0.18,0.0,d)*0.10*point;
      float twinkle=0.82+0.18*sin(t*(0.32+rnd.y*0.18)+rnd.x*14.0);
      vec3 pc=album(rnd.y+lf*0.17+u_character*0.09);
      col+=pc*(point*twinkle*(0.19+lf*0.024+u_audio.z*0.006)+halo*0.09);
    }
    return col;
  }

  // Plasma current: smooth domain-warped energy with broad caustics, never marble-gray.
  vec3 scenePlasma(vec2 uv,float t){
    vec2 p=cuv(uv)*1.20;
    p=flowWarp(p,t,0.58);
    float a=fbm(p*1.10+vec2(t*0.105,-t*0.082));
    float b=fbm(rot(p,0.72)*1.36+vec2(-t*0.075,t*0.090)+3.7);
    float c=fbm(p*0.62+vec2(t*0.048,t*0.042)+8.2);
    float field=sat(a*0.56+b*0.34+c*0.22);
    float caustic=pow(smoothstep(0.48,0.82,abs(a-b)*1.45),1.35);
    vec3 col=mix(darkBase(),album(field*0.64+c*0.18+u_character*0.11),0.40+field*0.50);
    col+=album(field+0.31)*caustic*(0.135+u_audio.w*0.008);
    return col;
  }

  vec3 renderScene(float scene,vec2 uv,float t){
    if(scene<0.5) return sceneVolume(uv,t);
    if(scene<1.5) return sceneGlass(uv,t);
    if(scene<2.5) return sceneSilk(uv,t);
    if(scene<3.5) return scenePhotons(uv,t);
    return scenePlasma(uv,t);
  }

  void main(){
    vec2 uv=gl_FragCoord.xy/u_resolution.xy;
    // One uninterrupted visual clock. Audio never changes time, velocity, direction, or scene position.
    float visualTime=u_time*1.46;
    vec3 color=renderScene(u_sceneA,uv,visualTime);

    // Short material morph instead of a long double-exposure crossfade.
    if(u_blend>0.001){
      vec3 incoming=renderScene(u_sceneB,uv,visualTime);
      vec2 mp=flowWarp(cuv(uv)*0.68,visualTime*0.42,0.26);
      float field=fbm(mp+vec2(visualTime*0.018,-visualTime*0.014)+u_character*6.7);
      float reveal=1.0-smoothstep(u_blend-0.16,u_blend+0.16,field);
      float lumA=dot(color,vec3(0.2126,0.7152,0.0722));
      float lumB=dot(incoming,vec3(0.2126,0.7152,0.0722));
      incoming*=clamp((lumA+0.10)/(lumB+0.10),0.82,1.18);
      color=mix(color,incoming,reveal);
    }

    // Multiple album colors coexist and drift independently so the cover never collapses to one tint.
    vec2 ap=cuv(uv)*0.62;
    float p0=fbm(ap+vec2(visualTime*0.030,-visualTime*0.022));
    float p1=fbm(rot(ap,0.78)*1.12+vec2(-visualTime*0.021,visualTime*0.027)+4.8);
    vec3 albumWash=mix(u_c0,u_c1,smoothstep(0.16,0.84,p0));
    albumWash=mix(albumWash,u_c2,smoothstep(0.30,0.78,p1)*0.72);
    color+=albumWash*(0.070+0.042*p0);

    // Fine refractive fidelity layer. Smaller scale than V10 to avoid giant blurry patches.
    vec2 detailUv=cuv(uv)*1.64;
    float caA=fbm(flowWarp(detailUv,visualTime*0.58,0.18)+vec2(visualTime*0.034,-visualTime*0.025));
    float caB=fbm(rot(detailUv,0.91)*1.34+vec2(-visualTime*0.027,visualTime*0.031)+5.4);
    float caustic=pow(smoothstep(0.20,0.54,abs(caA-caB)),2.25);
    float micro=pow(smoothstep(0.47,0.76,fbm(detailUv*1.70+vec2(-visualTime*0.030,visualTime*0.024)+11.0)),2.1);
    color+=album(caA*0.61+caB*0.39+0.17)*caustic*0.072;
    color+=mix(u_c3,album(caB+0.53),0.42)*micro*0.032;

    // Tiny depth shimmer, deliberately independent of beat transients.
    vec2 g=uv*vec2(36.0,20.0)+vec2(visualTime*0.028,-visualTime*0.019);
    vec2 id=floor(g),gv=fract(g)-0.5;
    vec2 rnd=hash22(id);
    float sparkle=smoothstep(0.032,0.0,length(gv-(rnd-0.5)*0.72))*step(0.84,rnd.x);
    color+=album(rnd.y+0.21)*sparkle*0.055;

    float vig=smoothstep(1.05,0.20,length((uv-0.5)*vec2(0.88,1.02)));
    color=mix(darkBase(),color,0.94+vig*0.06);
    float luminance=dot(color,vec3(0.2126,0.7152,0.0722));
    color=mix(vec3(luminance),color,1.42);
    color=1.0-exp(-color*1.72);
    color=pow(max(color,vec3(0.0)),vec3(0.93));
    float dither=(hash21(gl_FragCoord.xy+visualTime*13.7)-0.5)/255.0;
    color+=vec3(dither);
    gl_FragColor=vec4(color,0.98);
  }
`;

function MusicHeroSceneEngine({
  playing,
  trackKey,
  artworkUrl,
}: {
  playing: boolean;
  trackKey: string;
  artworkUrl: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playingRef = useRef(playing);
  const targetCharacterRef = useRef((heroHash(trackKey || "mvp-music") % 10000) / 10000);
  const trackKeyRef = useRef(trackKey || "mvp-music");
  const palettePoolRef = useRef<HeroColorPool>(HERO_NEUTRAL_PALETTE.slice(0, 4).map((color) => ({ ...color })));
  const targetPaletteRef = useRef<HeroPalette>(HERO_NEUTRAL_PALETTE.map((color) => ({ ...color })) as HeroPalette);
  const livePaletteRef = useRef<HeroPalette>(HERO_NEUTRAL_PALETTE.map((color) => ({ ...color })) as HeroPalette);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [engineGeneration, setEngineGeneration] = useState(0);
  const lastRecoveryAtRef = useRef(0);

  const requestEngineRecovery = () => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (lastRecoveryAtRef.current && now - lastRecoveryAtRef.current < 750) return;
    lastRecoveryAtRef.current = now;
    setEngineGeneration((generation) => generation + 1);
  };

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    trackKeyRef.current = trackKey || "mvp-music";
    targetCharacterRef.current = (heroHash(trackKeyRef.current) % 10000) / 10000;
  }, [trackKey]);

  useEffect(() => {
    if (!artworkUrl || typeof document === "undefined") {
      palettePoolRef.current = HERO_NEUTRAL_PALETTE.slice(0, 4).map((color) => ({ ...color }));
      targetPaletteRef.current = HERO_NEUTRAL_PALETTE.map((color) => ({ ...color })) as HeroPalette;
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";

    const sampleArtwork = () => {
      if (cancelled || !image.naturalWidth || !image.naturalHeight) return;
      try {
        const sample = document.createElement("canvas");
        const size = 72;
        sample.width = size;
        sample.height = size;
        const context = sample.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, 0, 0, size, size);
        const imageData = context.getImageData(0, 0, size, size).data;
        const pool = extractHeroColorPool(imageData);
        const fallbackPalette = extractHeroPalette(imageData);
        if (!cancelled) {
          palettePoolRef.current = pool;
          const seed = heroHash(trackKeyRef.current);
          targetPaletteRef.current = pool.length >= 3 ? heroPaletteFromPool(pool, 0, seed) : (fallbackPalette ?? HERO_NEUTRAL_PALETTE);
        }
      } catch {
        targetPaletteRef.current = HERO_NEUTRAL_PALETTE.map((color) => ({ ...color })) as HeroPalette;
      }
    };

    image.onload = sampleArtwork;
    image.src = artworkUrl;
    if (image.complete) sampleArtwork();
    return () => { cancelled = true; };
  }, [artworkUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;

    let engineVisible = true;
    let contextLost = false;
    let lastSuccessfulFrame = performance.now();
    let retryTimer = 0;

    const visibilityObserver = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => {
          const nextVisible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0);
          if (nextVisible && !engineVisible) lastSuccessfulFrame = performance.now();
          engineVisible = nextVisible;
        }, { rootMargin: "120px 0px", threshold: 0.01 })
      : null;
    visibilityObserver?.observe(host);

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      retryTimer = window.setTimeout(requestEngineRecovery, 600);
      return () => {
        window.clearTimeout(retryTimer);
        visibilityObserver?.disconnect();
      };
    }

    const compileShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertexShader = compileShader(gl.VERTEX_SHADER, HERO_VERTEX_SHADER);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, HERO_FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) {
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
      return;
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return;
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return;
    }

    const buffer = gl.createBuffer();
    if (!buffer) {
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.useProgram(program);

    const positionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const timeLocation = gl.getUniformLocation(program, "u_time");
    const sceneALocation = gl.getUniformLocation(program, "u_sceneA");
    const sceneBLocation = gl.getUniformLocation(program, "u_sceneB");
    const blendLocation = gl.getUniformLocation(program, "u_blend");
    const audioLocation = gl.getUniformLocation(program, "u_audio");
    const characterLocation = gl.getUniformLocation(program, "u_character");
    const colorLocations = [0, 1, 2, 3, 4].map((index) => gl.getUniformLocation(program, `u_c${index}`));

    let frame = 0;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let lastNow = performance.now();
    let lastAudioSample = 0;
    let liveCharacter = targetCharacterRef.current;
    let sceneIndex = heroHash("v11-scene-seed") % HERO_SCENE_COUNT;
    let sceneSerial = 0;
    let sceneStartedAt = performance.now();
    let sceneDuration = heroTimedDuration(heroHash("v11-scene-duration"), sceneSerial, HERO_SCENE_MIN_MS, HERO_SCENE_MAX_MS);
    let palettePhase = 0;
    let paletteChangedAt = performance.now();
    let paletteDuration = heroTimedDuration(heroHash(trackKeyRef.current), palettePhase, HERO_PALETTE_MIN_MS, HERO_PALETTE_MAX_MS);
    let lastPaletteTrackKey = trackKeyRef.current;
    const audioSmooth = { low: 0, mid: 0, high: 0, energy: 0 };
    const audioTarget = { low: 0, mid: 0, high: 0, energy: 0 };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      const device = window.devicePixelRatio || 1;
      dpr = Math.min(device, 1.0);
      const pixelWidth = Math.max(1, Math.floor(width * dpr));
      const pixelHeight = Math.max(1, Math.floor(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      gl.viewport(0, 0, pixelWidth, pixelHeight);
    };

    resize();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(canvas);

    const expApproach = (current: number, target: number, dtSeconds: number, tauSeconds: number) => {
      const amount = 1 - Math.exp(-Math.max(0, dtSeconds) / tauSeconds);
      return current + (target - current) * amount;
    };

    const setColor = (location: WebGLUniformLocation | null, color: HeroRgb) => {
      if (!location) return;
      gl.uniform3f(location, color.r / 255, color.g / 255, color.b / 255);
    };

    const recoverSilently = () => {
      requestEngineRecovery();
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      window.cancelAnimationFrame(frame);
      retryTimer = window.setTimeout(recoverSilently, 120);
    };

    const onContextRestored = () => {
      contextLost = false;
      recoverSilently();
    };

    canvas.addEventListener("webglcontextlost", onContextLost, false);
    canvas.addEventListener("webglcontextrestored", onContextRestored, false);

    const draw = (now: number) => {
      frame = window.requestAnimationFrame(draw);
      if (typeof document !== "undefined" && (document.hidden || !engineVisible)) {
        lastNow = now;
        return;
      }
      if (contextLost || gl.isContextLost()) {
        recoverSilently();
        return;
      }

      const dtSeconds = heroClamp((now - lastNow) / 1000, 0, 0.08);
      lastNow = now;

      // Sample the analyzer at 20 Hz. Rendering remains display-rate and independent of beat transients.
      if (now - lastAudioSample >= 50) {
        lastAudioSample = now;
        const raw = playingRef.current ? getMusicRtaLevels() : Array(10).fill(0);
        const average = (from: number, to: number) => {
          let sum = 0;
          let count = 0;
          for (let index = from; index <= to; index += 1) {
            sum += heroClamp(Number(raw[index]) || 0);
            count += 1;
          }
          return count ? sum / count : 0;
        };
        const lowRaw = average(0, 2);
        const midRaw = average(3, 6);
        const highRaw = average(7, 9);
        const energyRaw = lowRaw * 0.38 + midRaw * 0.42 + highRaw * 0.20;
        audioTarget.low = playingRef.current ? heroClamp(lowRaw * 0.72, 0, 0.46) : 0;
        audioTarget.mid = playingRef.current ? heroClamp(midRaw * 0.68, 0, 0.44) : 0;
        audioTarget.high = playingRef.current ? heroClamp(highRaw * 0.62, 0, 0.40) : 0;
        audioTarget.energy = playingRef.current ? heroClamp(energyRaw * 0.66, 0, 0.42) : 0;
      }

      // The scene owns 90%+ of the motion. Music is a slow pressure layer, never a positional driver.
      audioSmooth.low = expApproach(audioSmooth.low, audioTarget.low, dtSeconds, 1.55);
      audioSmooth.mid = expApproach(audioSmooth.mid, audioTarget.mid, dtSeconds, 1.80);
      audioSmooth.high = expApproach(audioSmooth.high, audioTarget.high, dtSeconds, 1.28);
      audioSmooth.energy = expApproach(audioSmooth.energy, audioTarget.energy, dtSeconds, 2.05);

      if (lastPaletteTrackKey !== trackKeyRef.current) {
        lastPaletteTrackKey = trackKeyRef.current;
        palettePhase = 0;
        paletteChangedAt = now;
        paletteDuration = heroTimedDuration(heroHash(trackKeyRef.current), palettePhase, HERO_PALETTE_MIN_MS, HERO_PALETTE_MAX_MS);
        targetPaletteRef.current = heroPaletteFromPool(palettePoolRef.current, palettePhase, heroHash(trackKeyRef.current));
      }

      // During playback, smoothly rotate emphasis across the full artwork color pool every 4.2–6.5 s.
      if (playingRef.current && now - paletteChangedAt >= paletteDuration) {
        palettePhase += 1;
        paletteChangedAt = now;
        paletteDuration = heroTimedDuration(heroHash(trackKeyRef.current), palettePhase, HERO_PALETTE_MIN_MS, HERO_PALETTE_MAX_MS);
        targetPaletteRef.current = heroPaletteFromPool(palettePoolRef.current, palettePhase, heroHash(trackKeyRef.current));
      } else if (!playingRef.current) {
        paletteChangedAt = now;
      }

      const livePalette = livePaletteRef.current;
      const targetPalette = targetPaletteRef.current;
      const paletteAmount = 1 - Math.exp(-dtSeconds / 1.35);
      for (let index = 0; index < livePalette.length; index += 1) {
        livePalette[index] = heroMix(livePalette[index], targetPalette[index], paletteAmount);
      }
      liveCharacter = expApproach(liveCharacter, targetCharacterRef.current, dtSeconds, 2.2);

      while (now - sceneStartedAt >= sceneDuration) {
        sceneStartedAt += sceneDuration;
        sceneIndex = (sceneIndex + 1) % HERO_SCENE_COUNT;
        sceneSerial += 1;
        sceneDuration = heroTimedDuration(heroHash("v11-scene-duration"), sceneSerial, HERO_SCENE_MIN_MS, HERO_SCENE_MAX_MS);
      }
      const sceneElapsed = now - sceneStartedAt;
      const sceneA = sceneIndex;
      const sceneB = (sceneIndex + 1) % HERO_SCENE_COUNT;
      const morphStart = Math.max(0, sceneDuration - HERO_MORPH_MS);
      const rawBlend = sceneElapsed > morphStart ? heroClamp((sceneElapsed - morphStart) / HERO_MORPH_MS) : 0;
      const blend = rawBlend * rawBlend * (3 - 2 * rawBlend);

      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, now * 0.001);
      gl.uniform1f(sceneALocation, sceneA);
      gl.uniform1f(sceneBLocation, sceneB);
      gl.uniform1f(blendLocation, blend);
      gl.uniform4f(audioLocation, audioSmooth.low, audioSmooth.mid, audioSmooth.high, audioSmooth.energy);
      gl.uniform1f(characterLocation, liveCharacter);
      colorLocations.forEach((location, index) => setColor(location, livePalette[index]));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      lastSuccessfulFrame = now;
    };

    const watchdog = window.setInterval(() => {
      if (document.hidden || !engineVisible) return;
      if (contextLost || gl.isContextLost() || performance.now() - lastSuccessfulFrame > 4500) {
        recoverSilently();
      }
    }, 2200);

    const onVisibilityChange = () => {
      if (document.hidden || !engineVisible) return;
      const now = performance.now();
      if (contextLost || gl.isContextLost() || now - lastSuccessfulFrame > 4500) {
        recoverSilently();
      } else {
        lastNow = now;
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(watchdog);
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      canvas.removeEventListener("webglcontextlost", onContextLost, false);
      canvas.removeEventListener("webglcontextrestored", onContextRestored, false);
      visibilityObserver?.disconnect();
      resizeObserver?.disconnect();
      if (!gl.isContextLost()) {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
      }
    };
  }, [engineGeneration]);

  return (
    <div ref={hostRef} className="tr-playerVisualEngine" aria-hidden="true">
      {artworkUrl ? <img className="tr-playerVisualArtwork" src={artworkUrl} alt="" /> : null}
      <canvas key={engineGeneration} ref={canvasRef} />
      <span className="tr-playerVisualGlass" />
    </div>
  );
}

export function MusicMiniPlayer({ navigate }: { navigate: (to: string) => void }) {
  const player = useMusicPlayer();
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [eqOpen, setEqOpen] = useState(false);
  const [mobileDspTab, setMobileDspTab] = useState<"overview" | "eq" | "processing" | "meters">("overview");
  const [queueBusy, setQueueBusy] = useState(false);
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [dspProfiles, setDspProfiles] = useState<SavedDspProfiles>(() => readSavedDspProfiles());
  const [activeCustomSlot, setActiveCustomSlot] = useState<MusicCustomPresetSlot | null>(
    isCustomSlot(player.eqPreset) ? player.eqPreset : null
  );
  const [profileMessage, setProfileMessage] = useState("");
  const [discoverMessage, setDiscoverMessage] = useState("");
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetSlot, setSavePresetSlot] = useState<MusicCustomPresetSlot>("custom_1");
  const [savePresetName, setSavePresetName] = useState("");
  const [presetSaveFlash, setPresetSaveFlash] = useState(false);
  const [sourcePulse, setSourcePulse] = useState(false);
  const [sourceUpgradeOpen, setSourceUpgradeOpen] = useState(false);
  const [sourceUpgradeFile, setSourceUpgradeFile] = useState<File | null>(null);
  const [sourceUpgradeCandidate, setSourceUpgradeCandidate] = useState<MusicSourceAnalysis | null>(null);
  const [sourceUpgradeComparison, setSourceUpgradeComparison] = useState<MusicSourceUpgradeComparison | null>(null);
  const [sourceUpgradeBusy, setSourceUpgradeBusy] = useState(false);
  const [sourceUpgradeMessage, setSourceUpgradeMessage] = useState("");
  const [sourceUpgradePendingRefresh, setSourceUpgradePendingRefresh] = useState(false);
  const sourceUpgradeInputRef = useRef<HTMLInputElement | null>(null);
  const restoredProfileRef = useRef<string>("");
  const heroIdentityRef = useRef<HTMLDivElement | null>(null);
  const sourceDesktopValueRef = useRef<HTMLSpanElement | null>(null);
  const sourceMobileValueRef = useRef<HTMLSpanElement | null>(null);
  const heroTitleRef = useRef<HTMLElement | null>(null);
  const heroArtistRef = useRef<HTMLElement | null>(null);
  const heroActionsRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    setSourceUpgradeOpen(false);
    setSourceUpgradeFile(null);
    setSourceUpgradeCandidate(null);
    setSourceUpgradeComparison(null);
    setSourceUpgradeMessage("");
    if (sourceUpgradeInputRef.current) sourceUpgradeInputRef.current.value = "";
  }, [player.currentTrack?.id]);

  async function inspectSourceUpgrade(file: File) {
    const currentTrack = player.currentTrack;
    if (!currentTrack) return;
    setSourceUpgradeBusy(true);
    setSourceUpgradeMessage("");
    try {
      const candidate = await analyzeMusicSourceFile(file);
      const current = analyzeMusicTrackSource(currentTrack);
      const comparison = compareMusicSources(current, candidate);
      setSourceUpgradeFile(file);
      setSourceUpgradeCandidate(candidate);
      setSourceUpgradeComparison(comparison);
    } catch (error) {
      setSourceUpgradeFile(null);
      setSourceUpgradeCandidate(null);
      setSourceUpgradeComparison(null);
      setSourceUpgradeMessage(error instanceof Error ? error.message : "The replacement source could not be analyzed.");
    } finally {
      setSourceUpgradeBusy(false);
    }
  }

  async function commitSourceUpgrade() {
    const currentTrack = player.currentTrack;
    if (!currentTrack || !sourceUpgradeFile || !sourceUpgradeCandidate || !sourceUpgradeComparison?.isUpgrade) return;
    setSourceUpgradeBusy(true);
    setSourceUpgradeMessage("");
    try {
      const deferOldDelete = player.currentTrack?.id === currentTrack.id && (player.playing || player.currentTime > 0.5);
      await replaceMusicTrackSource(currentTrack, sourceUpgradeFile, sourceUpgradeCandidate, { deferOldDelete });
      if (deferOldDelete) {
        setSourceUpgradePendingRefresh(true);
        setSourceUpgradeMessage(`SOURCE UPGRADED • ${sourceUpgradeCandidate.codec} • ${sourceUpgradeCandidate.bitrateLabel} • NEW SOURCE STARTS NEXT PLAY`);
      } else {
        await loadMusicLibrary(true);
        await flushDeferredMusicSourceCleanup().catch(() => undefined);
        setSourceUpgradeMessage(`SOURCE UPGRADED • ${sourceUpgradeCandidate.codec} • ${sourceUpgradeCandidate.bitrateLabel}`);
      }
      setSourceUpgradeComparison(null);
      setSourceUpgradeFile(null);
      setSourceUpgradeCandidate(null);
      if (sourceUpgradeInputRef.current) sourceUpgradeInputRef.current.value = "";
    } catch (error) {
      setSourceUpgradeMessage(error instanceof Error ? error.message : "The music source could not be upgraded.");
    } finally {
      setSourceUpgradeBusy(false);
    }
  }

  useEffect(() => {
    if (player.playing || player.currentTime > 0.5) return;
    void flushDeferredMusicSourceCleanup().catch(() => undefined);
    if (!sourceUpgradePendingRefresh) return;
    setSourceUpgradePendingRefresh(false);
    void loadMusicLibrary(true);
  }, [player.playing, player.currentTime, sourceUpgradePendingRefresh]);

  const run = (action: () => void | Promise<void>) => {
    try {
      const result = action();
      if (result instanceof Promise) void result.catch(() => undefined);
    } catch {
      // Player state surfaces the useful error.
    }
  };



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
      setSourcePulse(true);
      window.setTimeout(() => setSourcePulse(false), 520);
    }
  }

  function currentDspSnapshot(name: string): SavedDspProfile {
    return {
      name: name.trim() || "Custom DSP",
      outputProfile: player.outputProfile,
      tonePreset: player.eqPreset,
      eqTopology: player.eqTopology,
      eqEnabled: player.eqEnabled,
      eqGains: [...player.eqGains],
      preampDb: player.preampDb,
      normalizationEnabled: player.normalizationEnabled,
      multibandEnabled: player.multibandEnabled,
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
    if ((profile.outputProfile ?? "headphones") !== player.outputProfile) return false;
    if ((profile.tonePreset ?? "flat") !== player.eqPreset) return false;
    if ((profile.eqTopology ?? "minimum_phase") !== player.eqTopology) return false;
    if (profile.eqEnabled !== player.eqEnabled) return false;
    if (profile.headphoneMode !== player.headphoneMode) return false;
    if (!sameDspNumber(profile.preampDb, player.preampDb)) return false;
    if ((profile.normalizationEnabled ?? true) !== player.normalizationEnabled) return false;
    if ((profile.multibandEnabled ?? true) !== player.multibandEnabled) return false;
    if (!sameDspNumber(profile.headphoneWidth, player.headphoneWidth)) return false;
    if (!sameDspNumber(profile.headphoneDepth, player.headphoneDepth)) return false;
    if (!sameDspNumber(profile.headphoneCrossfeed, player.headphoneCrossfeed)) return false;
    if (!sameDspNumber(profile.headphoneCenter, player.headphoneCenter)) return false;
    if (!sameDspNumber(profile.headphoneBassImpact, player.headphoneBassImpact)) return false;
    if (profile.eqGains.length !== player.eqGains.length) return false;
    return profile.eqGains.every((gain, index) => sameDspNumber(gain, player.eqGains[index] ?? 0));
  }

  function runDspMutation(action: () => void, ensureEq = false) {
    try {
      // IMPORTANT: every UI mutation is applied synchronously first. Never wait on
      // AudioContext recovery before changing state, because a suspended browser
      // context can otherwise make selects, checkboxes and sliders appear frozen.
      if (player.dspBypass) setMusicDspBypass(false);
      if (ensureEq && !player.eqEnabled) setMusicEqEnabled(true);
      action();

      // The V13.8 engine already applies the live graph inside each setter. Recovery
      // is only a silent fallback when the browser reports DSP as inactive.
      if (player.dspStatus !== "active") void recoverMusicDsp();
    } catch {
      // The player engine owns the useful error state.
    }
  }

  async function applySavedDspProfile(slot: MusicCustomPresetSlot) {
    const profile = dspProfiles[slot];
    setActiveCustomSlot(slot);
    if (!profile) {
      runDspMutation(() => applyMusicEqPreset(slot), true);
      setProfileMessage(`${slotFallbackLabel(slot)} has no full DSP profile saved yet.`);
      return;
    }
    runDspMutation(() => {
      setMusicOutputProfile(profile.outputProfile ?? "headphones");
      applyMusicEqPreset(profile.tonePreset ?? "flat");
      setMusicEqTopology(profile.eqTopology ?? "minimum_phase");
      profile.eqGains.forEach((gain, index) => setMusicEqBand(index, gain));
      setMusicPreamp(profile.preampDb);
      setMusicEqEnabled(profile.eqEnabled);
      setMusicNormalizationEnabled(profile.normalizationEnabled ?? true);
      setMusicMultibandEnabled(profile.multibandEnabled ?? true);
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
    setPresetSaveFlash(true);
    window.setTimeout(() => setPresetSaveFlash(false), 1500);
    setSavePresetOpen(false);
  }


  const track = player.currentTrack;
  const sourceQuality = analyzeMusicTrackSource(track);

  useEffect(() => {
    const identity = heroIdentityRef.current;
    const title = heroTitleRef.current;
    const artist = heroArtistRef.current;
    const actions = heroActionsRef.current;
    if (!identity || !title || !artist || !actions) return;

    let raf = 0;
    const fitHeroTitle = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        const mobile = window.matchMedia("(max-width: 650px)").matches;
        const narrow = window.matchMedia("(max-width: 390px)").matches;
        const maxSize = mobile ? (narrow ? 25 : 30) : window.innerWidth >= 1100 ? 62 : 46;
        const minSize = mobile ? (narrow ? 17 : 18) : 27;
        const computed = window.getComputedStyle(identity);
        const paddingY = (parseFloat(computed.paddingTop) || 0) + (parseFloat(computed.paddingBottom) || 0);
        const artistHeight = artist.getBoundingClientRect().height;
        const actionsHeight = actions.getBoundingClientRect().height;
        const safetyGap = mobile ? 26 : 42;
        const targetHeroHeight = mobile ? (narrow ? 218 : 216) : Math.max(220, identity.parentElement?.clientHeight || identity.clientHeight);
        const availableTitleHeight = Math.max(42, targetHeroHeight - paddingY - artistHeight - actionsHeight - safetyGap);

        let chosen = maxSize;
        for (let size = maxSize; size >= minSize; size -= 1) {
          identity.style.setProperty("--tr-hero-title-size", `${size}px`);
          const fitsHeight = title.scrollHeight <= availableTitleHeight + 2;
          const fitsWidth = title.scrollWidth <= title.clientWidth + 2;
          if (fitsHeight && fitsWidth) {
            chosen = size;
            break;
          }
          chosen = size;
        }
        identity.style.setProperty("--tr-hero-title-size", `${chosen}px`);
      });
    };

    fitHeroTitle();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fitHeroTitle) : null;
    observer?.observe(identity);
    window.addEventListener("resize", fitHeroTitle);
    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", fitHeroTitle);
    };
  }, [track?.title, track?.artist]);

  function openSavePresetDialog(preferredSlot?: MusicCustomPresetSlot) {
    const firstEmpty = DSP_SLOTS.find((slot) => !dspProfiles[slot]);
    const slot = preferredSlot ?? firstEmpty ?? activeCustomSlot ?? "custom_1";
    setSavePresetSlot(slot);
    setSavePresetName(dspProfiles[slot]?.name ?? "");
    setSavePresetOpen(true);
  }

  const duration = Math.max(0, player.duration || track?.duration_seconds || 0);
  const currentTime = Math.min(duration || Number.MAX_SAFE_INTEGER, Math.max(0, player.currentTime));
  const volumePercent = Math.max(0, Math.min(100, Math.round(player.volume * 100)));
  const activeSavedProfile = activeCustomSlot ? dspProfiles[activeCustomSlot] : null;
  const activeProfileDirty = activeSavedProfile ? !profileMatchesCurrent(activeSavedProfile) : false;
  const presetSelectValue: MusicEqPreset = activeCustomSlot ? (activeProfileDirty ? "custom" : activeCustomSlot) : player.eqPreset;
  const presetStatusLabel = activeSavedProfile
    ? `${activeSavedProfile.name}${activeProfileDirty ? " • Modified" : " • Saved"}`
    : "Built-in music preset";
  const dspOutputStatus = MUSIC_OUTPUT_PROFILES[player.outputProfile].shortLabel;
  const activeBuiltInEq = (MUSIC_EQ_PRESETS as Record<string, { label: string }>)[player.eqPreset]?.label;
  const dspEqStatus = player.outputProfile === "reference" || player.dspBypass
    ? "REFERENCE"
    : !player.eqEnabled
      ? "FLAT"
      : activeSavedProfile?.name || activeBuiltInEq || "CUSTOM";
  const activePlaylistLabel = player.activePlaylistId
    ? playlists.find((playlist) => playlist.id === player.activePlaylistId)?.name || "All Uploaded Songs"
    : "All Uploaded Songs";
  const activePlaylistMobileLabel = activePlaylistLabel;

  useEffect(() => {
    let frame = 0;

    const fitLabel = (
      element: HTMLSpanElement | null,
      maxSize: number,
      minSize: number
    ) => {
      if (!element) return;

      element.style.fontSize = `${maxSize}px`;
      element.style.letterSpacing = "0.015em";

      let size = maxSize;
      while (element.scrollWidth > element.clientWidth + 1 && size > minSize) {
        size = Math.max(minSize, size - 0.25);
        element.style.fontSize = `${size}px`;
      }

      if (element.scrollWidth > element.clientWidth + 1) {
        element.style.letterSpacing = "0";
      }
    };

    const fitSourceLabels = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        fitLabel(sourceDesktopValueRef.current, 12, 9.5);
        fitLabel(sourceMobileValueRef.current, 14, 10.5);
      });
    };

    fitSourceLabels();

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(fitSourceLabels)
        : null;

    if (sourceDesktopValueRef.current) observer?.observe(sourceDesktopValueRef.current);
    if (sourceMobileValueRef.current) observer?.observe(sourceMobileValueRef.current);

    window.addEventListener("resize", fitSourceLabels);
    window.addEventListener("orientationchange", fitSourceLabels);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", fitSourceLabels);
      window.removeEventListener("orientationchange", fitSourceLabels);
    };
  }, [activePlaylistLabel]);

  return (
    <section
      className={`tr-audioDeck tr-audioDeck--v4 tr-audioDeck--pro7 ${player.playing ? "is-playing" : ""} ${player.loading || queueBusy ? "is-busy" : ""}`}
      aria-label="MVP Trainer music console"
    >

      <div className="tr-playerHero">
        <MusicHeroSceneEngine
          playing={player.playing}
          trackKey={track?.id || `${track?.title || "music"}:${track?.artist || "unknown"}`}
          artworkUrl={artworkUrl}
        />
        <button type="button" className="tr-audioArtwork" onClick={() => navigate("/music")} aria-label="Open music library">
          {artworkUrl ? <img className="tr-audioArtworkImage" src={artworkUrl} alt="" /> : <span className="tr-audioArtworkFallback"><PlayerIcon name="music" /></span>}
        </button>
        <div ref={heroIdentityRef} className="tr-audioIdentity">
          <button type="button" className="tr-audioIdentityMain" onClick={() => navigate("/music")} aria-label="Open current song in music library">
            <strong ref={heroTitleRef}>{track?.title || (player.loading ? "Loading music…" : "Music")}</strong>
            <small ref={heroArtistRef}>{track?.artist || "Unknown Artist"}</small>
          </button>
          <div ref={heroActionsRef} className="tr-heroPreferenceStage" aria-label="Track preference controls">
            <button type="button" className={`tr-heroPrefButton tr-prefLike ${track?.favorite ? "is-liked" : ""}`} disabled={!track} title={track?.favorite ? "Unlike" : "Like"} onClick={() => {
              if (!track) return;
              void setPlayerMusicPreference(track.id, track.favorite ? "neutral" : "like");
            }} aria-label={track?.favorite ? "Unlike this song" : "Like this song"}><PlayerIcon name="like" /><span>{track?.favorite ? "Liked" : "Like"}</span></button>
            <button type="button" className={`tr-heroPrefButton tr-prefLess ${track?.play_less ? "is-disliked" : ""}`} disabled={!track} title={track?.play_less ? "Remove Play Less" : "Play Less"} onClick={() => {
              if (!track) return;
              void setPlayerMusicPreference(track.id, track.play_less ? "neutral" : "play_less");
            }} aria-label={track?.play_less ? "Remove play less preference" : "Play this song less"}><PlayerIcon name="dislike" /><span>Play Less</span></button>
            <button type="button" className={`tr-heroPrefButton tr-prefDiscover ${discoverMessage ? "is-confirming" : ""}`} disabled={!track} title="Rediscover music" onClick={() => {
              if (!track) return;
              setDiscoverMessage("SEARCHING…");
              void discoverMoreFromTrack(track, player.libraryTracks)
                .then(() => { setDiscoverMessage("✓ REDISCOVERED"); window.setTimeout(() => setDiscoverMessage(""), 2200); })
                .catch(() => { setDiscoverMessage("REDISCOVER RETRY"); window.setTimeout(() => setDiscoverMessage(""), 2200); });
            }} aria-label="Rediscover music"><PlayerIcon name="discover" /><span>Rediscover</span></button>
          </div>
        </div>
      </div>

      <div className="tr-audioTimeline">
        <span>{formatMusicTime(currentTime)}</span>
        <input type="range" min="0" max={Math.max(1, duration)} step="1" value={Math.min(Math.max(1, duration), currentTime)} onChange={(event: ChangeEvent<HTMLInputElement>) => seekMusic(Number(event.target.value))} disabled={!track || !duration} aria-label="Music playback position" />
        <span>{formatMusicTime(duration)}</span>
      </div>

      <div className="tr-playerTransportStage" aria-label="Music transport controls">
        <div className="tr-audioTransportUnit is-previous"><button type="button" className="tr-audioTransportButton is-previous" onClick={() => run(previousMusicTrack)} disabled={!player.tracks.length || player.loading || queueBusy} aria-label="Previous song"><span className="tr-audioTransportFace"><PlayerIcon name="back" /></span></button><span>PREVIOUS</span></div>
        <div className="tr-audioTransportUnit is-primary"><button type="button" className={`tr-audioTransportButton tr-audioTransportButton--primary ${player.playing ? "is-playing" : "is-ready"}`} onClick={() => run(player.playing ? pauseMusic : playMusic)} disabled={player.loading || queueBusy} aria-label={player.playing ? "Pause music" : "Play music"}><span className="tr-audioTransportFace"><PlayerIcon name={player.playing ? "pause" : "play"} /></span></button><span>{player.playing ? "PAUSE" : "PLAY"}</span></div>
        <div className="tr-audioTransportUnit is-stop"><button type="button" className="tr-audioTransportButton is-stop" onClick={() => stopMusic()} disabled={!track || player.loading || queueBusy} aria-label="Stop music"><span className="tr-audioTransportFace"><PlayerIcon name="stop" /></span></button><span>STOP</span></div>
        <div className="tr-audioTransportUnit is-next"><button type="button" className="tr-audioTransportButton is-next" onClick={() => run(() => nextMusicTrack())} disabled={!player.tracks.length || player.loading || queueBusy} aria-label="Next song"><span className="tr-audioTransportFace"><PlayerIcon name="next" /></span></button><span>NEXT</span></div>
      </div>

      <div className="tr-playerModeStage" aria-label="Shuffle and repeat controls">
        <button type="button" className={`tr-audioModeButton is-repeat ${player.repeat !== "off" ? "is-active" : ""}`} onClick={() => cycleMusicRepeat()} aria-label={`Repeat ${player.repeat}`} aria-pressed={player.repeat !== "off"}><PlayerIcon name="repeat" /><span>{player.repeat === "one" ? "REPEAT 1" : "REPEAT"}</span><i className="tr-modeState">{player.repeat === "off" ? "OFF" : "ON"}</i></button>
        <button type="button" className={`tr-audioModeButton is-shuffle ${player.shuffle ? "is-active" : ""}`} onClick={() => toggleMusicShuffle()} aria-label={`Shuffle ${player.shuffle ? "on" : "off"}`} aria-pressed={player.shuffle}><PlayerIcon name="shuffle" /><span>SHUFFLE</span><i className="tr-modeState">{player.shuffle ? "ON" : "OFF"}</i></button>
      </div>

      <button
        type="button"
        data-profile={player.outputProfile}
        className={`tr-mobileDspStatusToggle ${eqOpen ? "is-active" : ""}`}
        onClick={() => setEqOpen((current) => !current)}
        aria-expanded={eqOpen}
        aria-label="Open DSP and equalizer controls"
      >
        <span className="tr-mobileDspStatusIcon"><PlayerIcon name={outputProfileIconName(player.outputProfile)} /></span>
        <span className="tr-mobileDspStatusCopy"><b>DSP / EQ</b><small>{dspOutputStatus} • {dspEqStatus}</small></span>
        <span className={`tr-mobileDspChevron ${eqOpen ? "is-open" : ""}`} aria-hidden><svg viewBox="0 0 24 24"><path d="m6.5 9 5.5 5.5L17.5 9" /></svg></span>
        <i className={`tr-mobileDspStatusLed is-${player.dspStatus}`} aria-hidden />
      </button>

      <MusicActivityRta playing={player.playing} profileLabel={dspOutputStatus} eqLabel={dspEqStatus} outputProfile={player.outputProfile} sourceQuality={sourceQuality} dspEngineMode={player.dspEngineMode} />


      <div className="tr-playerUtilityRow">
        <label className="tr-playerVolume">
          <span>VOLUME</span>
          <input type="range" min="0" max="100" step="1" value={volumePercent} onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const percent = Math.max(0, Math.min(100, Number(event.target.value)));
            setMusicVolume(percent / 100);
          }} aria-label="Music volume" />
          <strong>{volumePercent}%</strong>
        </label>
        <div className="tr-playerSourceTools">
          <label className={`tr-audioQueueSelector ${sourcePulse ? "is-changed" : ""}`}>
            <span>PLAYING FROM</span>
            <span className="tr-audioQueueSelectorField">
              <i className="tr-sourceIcon" aria-hidden><PlayerIcon name="music" /></i>
              <span ref={sourceDesktopValueRef} className="tr-audioQueueSelectorValue tr-audioQueueSelectorValue--desktop" aria-hidden>{activePlaylistLabel}</span>
              <span ref={sourceMobileValueRef} className="tr-audioQueueSelectorValue tr-audioQueueSelectorValue--mobile" aria-hidden>{activePlaylistMobileLabel}</span>
              <select value={player.activePlaylistId || "all"} disabled={queueBusy} onChange={(event: ChangeEvent<HTMLSelectElement>) => void selectQueue(event.target.value)} aria-label="Choose music playlist">
                <option value="all">All Uploaded Songs</option>
                {playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
              </select>
              <i className="tr-sourceChevron" aria-hidden><svg viewBox="0 0 24 24"><path d="m6.5 9 5.5 5.5L17.5 9" /></svg></i>
            </span>
          </label>
          <button type="button" data-profile={player.outputProfile} className={`tr-audioEqToggle tr-dspStatusToggle ${eqOpen ? "is-active" : ""}`} onClick={() => setEqOpen((current) => !current)} aria-expanded={eqOpen}>
            <span className="tr-dspStatusIcon"><PlayerIcon name={outputProfileIconName(player.outputProfile)} /></span>
            <span className="tr-dspStatusCopy"><b>DSP / EQ</b><small>{dspOutputStatus} • {dspEqStatus}</small></span>
            <span className={`tr-dspChevron ${eqOpen ? "is-open" : ""}`} aria-hidden><svg viewBox="0 0 24 24"><path d="m6.5 9 5.5 5.5L17.5 9" /></svg></span>
            <i className={`tr-dspStatusLed is-${player.dspStatus}`} aria-hidden />
          </button>
        </div>
      </div>

      {discoverMessage ? <div className="tr-discoverToast" role="status">{discoverMessage}</div> : null}

      {eqOpen ? (
        <section className="tr-audioEqPanel tr-audioEqPanel--pro7" data-mobile-dsp-tab={mobileDspTab}>
          <div className="tr-mobileDspWorkspace" aria-label="Mobile Studio DSP workspace">
            <div className="tr-mobileDspContext" aria-label="Current Studio DSP context">
              <span className={`tr-mobileDspContextEngine is-${player.dspEngineMode}`}><i aria-hidden />{player.dspEngineMode === "studio_wasm" ? "STUDIO WASM" : player.dspEngineMode === "advanced_worklet" ? "WORKLET" : player.dspEngineMode === "native_fallback" ? "NATIVE" : "DSP"}</span>
              <span>{dspOutputStatus}</span>
              <span>{dspEqStatus}</span>
              <span>{player.eqTopology === "linear_phase" ? "LINEAR" : "MIN PHASE"}</span>
            </div>
            <nav className="tr-mobileDspTabs" role="tablist" aria-label="DSP workspace sections">
              <button type="button" role="tab" aria-selected={mobileDspTab === "overview"} className={mobileDspTab === "overview" ? "is-active" : ""} onClick={() => setMobileDspTab("overview")}><svg viewBox="0 0 24 24" aria-hidden><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg><span>OVERVIEW</span></button>
              <button type="button" role="tab" aria-selected={mobileDspTab === "eq"} className={mobileDspTab === "eq" ? "is-active" : ""} onClick={() => setMobileDspTab("eq")}><svg viewBox="0 0 24 24" aria-hidden><path d="M5 3v18M12 3v18M19 3v18M2 8h6M9 15h6M16 10h6" /></svg><span>EQ</span></button>
              <button type="button" role="tab" aria-selected={mobileDspTab === "processing"} className={mobileDspTab === "processing" ? "is-active" : ""} onClick={() => setMobileDspTab("processing")}><svg viewBox="0 0 24 24" aria-hidden><path d="M2 12h3l2.2-6 3.4 12 2.8-9 2.7 7 2-4H22" /></svg><span>PROCESS</span></button>
              <button type="button" role="tab" aria-selected={mobileDspTab === "meters"} className={mobileDspTab === "meters" ? "is-active" : ""} onClick={() => setMobileDspTab("meters")}><svg viewBox="0 0 24 24" aria-hidden><path d="M4 20V11h3v9H4Zm6 0V5h3v15h-3Zm6 0V8h3v12h-3Z" /></svg><span>METERS</span></button>
            </nav>
          </div>
          <div className="tr-outputProfilePanel" data-mobile-dsp-section="overview">
            <div className="tr-outputProfileIntro">
              <small>HIGH-FIDELITY OUTPUT</small>
              <div className="tr-outputProfileTitle"><span className="tr-outputProfileIcon" data-profile={player.outputProfile}><PlayerIcon name={outputProfileIconName(player.outputProfile)} /></span><span className="tr-outputProfileTitleText">{MUSIC_OUTPUT_PROFILES[player.outputProfile].label}</span></div>
              <p>{MUSIC_OUTPUT_PROFILES[player.outputProfile].description}</p>
            </div>
            <label className="tr-outputProfileSelect">
              <span className="tr-outputProfileSelectLabel"><i data-profile={player.outputProfile}><PlayerIcon name={outputProfileIconName(player.outputProfile)} /></i><b>OUTPUT PROFILE</b></span>
              <select value={player.outputProfile} onChange={(event: ChangeEvent<HTMLSelectElement>) => void runDspMutation(() => setMusicOutputProfile(event.target.value as MusicOutputProfile))}>
                {(Object.entries(MUSIC_OUTPUT_PROFILES) as Array<[MusicOutputProfile, (typeof MUSIC_OUTPUT_PROFILES)[MusicOutputProfile]]>).map(([value, profile]) => <option key={value} value={value}>{profile.label}</option>)}
              </select>
            </label>
            <div className="tr-outputProfileChoices" aria-label="Output profile quick select">
              {(Object.entries(MUSIC_OUTPUT_PROFILES) as Array<[MusicOutputProfile, (typeof MUSIC_OUTPUT_PROFILES)[MusicOutputProfile]]>).map(([value, profile]) => (
                <button key={value} type="button" data-profile={value} className={player.outputProfile === value ? "is-active" : ""} onClick={() => void runDspMutation(() => setMusicOutputProfile(value))} aria-pressed={player.outputProfile === value}>
                  <i><PlayerIcon name={outputProfileIconName(value)} /></i><span>{profile.shortLabel}</span>
                </button>
              ))}
            </div>
            <div className="tr-outputProfileTelemetry">
              <span className="tr-outputProfileTelemetryActive" data-profile={player.outputProfile}><i><PlayerIcon name={outputProfileIconName(player.outputProfile)} /></i><b>{MUSIC_OUTPUT_PROFILES[player.outputProfile].shortLabel}</b></span>
              <span>SAFETY TRIM <b>{player.autoHeadroomDb > 0 ? `-${player.autoHeadroomDb.toFixed(1)} dB` : "READY"}</b></span>
              <span>PREAMP <b>{player.effectivePreampDb > 0 ? "+" : ""}{player.effectivePreampDb.toFixed(1)} dB</b></span>
              <span>MULTIBAND <b>{player.multibandEnabled && player.dspEngineMode === "advanced_worklet" ? "ON" : "OFF"}</b></span>
              <span>NORMALIZER <b>{player.normalizationEnabled && player.dspEngineMode === "advanced_worklet" ? `${player.loudnessGainDb > 0 ? "+" : ""}${player.loudnessGainDb.toFixed(1)} dB` : "OFF"}</b></span>
              <span>SOURCE <b>{musicSourceQualityLabel(player.currentTrack)}</b></span>
            </div>
          </div>

          <section className={`tr-sourceQualityPanel is-${sourceQuality.tier}`} aria-label="Source quality" data-mobile-dsp-section="overview">
            <div className="tr-sourceQualityCopy">
              <span>SOURCE QUALITY</span>
              <strong>{sourceQuality.codec} · {sourceQuality.bitrateLabel} · {sourceQuality.qualityLabel}</strong>
              <small>{sourceQuality.lossless ? "Lossless source. No replacement is needed." : sourceQuality.upgradeRecommended ? "A better original source can improve fidelity. The app will verify the replacement before changing anything." : "Source quality is already strong for playback."}</small>
            </div>
            {sourceQuality.upgradeRecommended && track ? (
              <button type="button" className="tr-sourceUpgradeButton" onClick={() => {
                setSourceUpgradeMessage("");
                setSourceUpgradeFile(null);
                setSourceUpgradeCandidate(null);
                setSourceUpgradeComparison(null);
                setSourceUpgradeOpen(true);
              }}>UPGRADE SOURCE</button>
            ) : (
              <div className="tr-sourceQualityOk">SOURCE OK</div>
            )}
          </section>

          <section className="tr-preampTrim" aria-label="Preamp trim" data-mobile-dsp-section="overview">
            <div className="tr-preampTrimCopy">
              <span>ADVANCED GAIN</span>
              <strong>PREAMP TRIM</strong>
              <small>Independent preamp. EQ bands change only their frequencies; the WASM output limiter catches real peaks.</small>
            </div>
            <div className="tr-preampTrimControl">
              <div className="tr-preampTrimReadout"><span>{Math.abs(player.preampDb) < 0.05 ? "AUTO" : "MANUAL"}</span><b>{player.preampDb > 0 ? "+" : ""}{player.preampDb.toFixed(1)} dB</b></div>
              <input type="range" min="-6" max="3" step="0.5" value={Math.max(-6, Math.min(3, player.preampDb))} onChange={(event: ChangeEvent<HTMLInputElement>) => void runDspMutation(() => setMusicPreamp(Number(event.target.value)), true)} aria-label="Preamp trim in decibels" />
              <div className="tr-preampTrimScale" aria-hidden="true"><span>-6 dB</span><span className="tr-preampTrimZero">0 dB</span><span>+3 dB</span></div>
            </div>
            <button type="button" className="tr-preampAutoButton" disabled={Math.abs(player.preampDb) < 0.05} onClick={() => void runDspMutation(() => setMusicPreamp(0), true)}>RESET TO AUTO</button>
          </section>

          <section className="tr-dspProofPanel tr-dspEnginePanel" aria-label="DSP engine status" data-mobile-dsp-section="overview">
            <div className="tr-dspProofStatus">
              <span>DSP ENGINE <b className={player.dspEngineMode === "studio_wasm" || player.dspEngineMode === "advanced_worklet" ? "is-good" : player.dspEngineMode === "native_fallback" ? "is-fallback" : "is-bad"}>{player.dspEngineMode === "studio_wasm" ? "MVP STUDIO • WASM" : player.dspEngineMode === "advanced_worklet" ? "COMPATIBILITY • WORKLET" : player.dspEngineMode === "native_fallback" ? "COMPATIBILITY • NATIVE" : "UNAVAILABLE"}</b></span>
              <span>IMMERSION PATH <b className={player.immersionStatus === "active" ? "is-good" : player.immersionStatus === "native_fallback" ? "is-fallback" : player.immersionStatus === "unavailable" ? "is-bad" : ""}>{player.immersionStatus === "active" ? "ADVANCED ACTIVE" : player.immersionStatus === "native_fallback" ? "NATIVE ACTIVE" : player.immersionStatus === "unavailable" ? "UNAVAILABLE" : "BYPASSED"}</b></span>
              <span>OUTPUT LIMITER <b className="is-good">{player.dspEngineMode === "studio_wasm" ? "WASM • BS.1770 TRUE PEAK" : "4× • -1 dBTP"}</b></span>
              {/* MVP_STUDIO_WASM_V3_PHASE2_OUTPUT_CORRECTION */}
              <span>OUTPUT CORRECTION <b className={player.dspEngineMode === "studio_wasm" && player.outputProfile !== "reference" && !player.dspBypass ? "is-good" : "is-fallback"}>{player.outputProfile === "reference" || player.dspBypass ? "BYPASSED" : player.dspEngineMode === "studio_wasm" ? `WASM • ${player.outputProfile === "speaker" ? "BLUETOOTH" : player.outputProfile === "headphones" ? "HEADPHONES" : "CAR / HI-FI"} AUTO${player.outputCorrectionReductionDb > 0.05 ? ` • -${player.outputCorrectionReductionDb.toFixed(1)} dB` : ""}` : "COMPAT • STATIC"}</b></span>
              <span>STEREO INTEGRITY <b className={player.dspEngineMode === "studio_wasm" && player.outputProfile !== "reference" && !player.dspBypass ? "is-good" : "is-fallback"}>{player.dspEngineMode === "studio_wasm" && player.outputProfile !== "reference" && !player.dspBypass ? `WASM • PHASE SAFE${player.stereoGuardReductionDb > 0.05 ? ` • -${player.stereoGuardReductionDb.toFixed(1)} dB` : ""}` : "BYPASSED"}</b></span>
              <span>MULTIBAND DYNAMICS <b className={player.multibandEnabled && (player.dspEngineMode === "advanced_worklet" || (player.dspEngineMode === "studio_wasm" && player.outputProfile !== "reference" && !player.dspBypass)) ? "is-good" : "is-fallback"}>{player.multibandEnabled && player.dspEngineMode === "studio_wasm" && player.outputProfile !== "reference" && !player.dspBypass ? "WASM • 4-BAND ACTIVE" : player.multibandEnabled && player.dspEngineMode === "advanced_worklet" ? "4-BAND ACTIVE" : "BYPASSED"}</b></span>
              {/* MVP_STUDIO_WASM_V3_PHASE1_DYNAMIC_EQ */}
              <span>DYNAMIC EQ <b className={player.dynamicEqEnabled && player.dspEngineMode === "studio_wasm" && player.outputProfile !== "reference" && !player.dspBypass ? "is-good" : "is-fallback"}>{player.dspEngineMode !== "studio_wasm" ? "STUDIO ONLY" : player.dynamicEqEnabled && player.outputProfile !== "reference" && !player.dspBypass ? `WASM • 4-BAND AUTO${player.dynamicEqGainReductionDb > 0.05 ? ` • -${player.dynamicEqGainReductionDb.toFixed(1)} dB` : ""}` : "BYPASSED"}</b></span>
              <span>VOLUME MATCH <b className={player.normalizationEnabled && (player.dspEngineMode === "advanced_worklet" || (player.dspEngineMode === "studio_wasm" && player.outputProfile !== "reference" && !player.dspBypass)) ? "is-good" : "is-fallback"}>{player.normalizationEnabled && player.dspEngineMode === "studio_wasm" && player.outputProfile !== "reference" && !player.dspBypass ? "WASM • SMART LEVELING" : player.normalizationEnabled && player.dspEngineMode === "advanced_worklet" ? "COMPAT • LEVELING" : "BYPASSED"}</b></span>
              <span>TRANSIENT DETAIL <b className={player.dspEngineMode === "studio_wasm" && player.outputProfile !== "reference" && player.eqEnabled && !player.dspBypass ? "is-good" : "is-fallback"}>{player.dspEngineMode === "studio_wasm" ? (player.outputProfile !== "reference" && player.eqEnabled && !player.dspBypass ? "WASM • AUTO" : "BYPASSED") : "AUTO"}</b></span>
            </div>
          </section>

          <section className="tr-studioMeterPanel" aria-label="Live Studio DSP metering" data-mobile-dsp-section="meters">
            <header>
              <div><span>LIVE DSP METERING</span><strong>REAL-TIME ENGINE TELEMETRY</strong></div>
              <small>{player.dspEngineMode === "studio_wasm" ? "DIRECT FROM WASM CORE" : "AVAILABLE IN MVP STUDIO"}</small>
            </header>
            <div className="tr-studioMeterGrid">
              <article data-meter="peak">
                <span>TRUE PEAK</span>
                <strong>{player.dspEngineMode === "studio_wasm" && player.truePeakDbtp > -119 ? `${player.truePeakDbtp.toFixed(1)} dBTP` : "—"}</strong>
                <i><b style={{ width: `${player.dspEngineMode === "studio_wasm" && player.truePeakDbtp > -119 ? Math.max(0, Math.min(100, ((player.truePeakDbtp + 18) / 18) * 100)) : 0}%` }} /></i>
                <small>BS.1770 reconstructed peak</small>
              </article>
              <article data-meter="limiter">
                <span>LIMITER GR</span>
                <strong>{player.dspEngineMode === "studio_wasm" ? `${player.limiterGainReductionDb.toFixed(1)} dB` : "—"}</strong>
                <i><b style={{ width: `${player.dspEngineMode === "studio_wasm" ? Math.max(0, Math.min(100, (player.limiterGainReductionDb / 6) * 100)) : 0}%` }} /></i>
                <small>True-peak gain reduction</small>
              </article>
              <article data-meter="multiband">
                <span>MULTIBAND GR</span>
                <strong>{player.dspEngineMode === "studio_wasm" && player.multibandEnabled ? `${player.multibandGainReductionDb.toFixed(1)} dB` : "OFF"}</strong>
                <i><b style={{ width: `${player.dspEngineMode === "studio_wasm" && player.multibandEnabled ? Math.max(0, Math.min(100, (player.multibandGainReductionDb / 6) * 100)) : 0}%` }} /></i>
                <small>Maximum 4-band reduction</small>
              </article>
              <article data-meter="dynamic">
                <span>DYNAMIC EQ</span>
                <strong>{player.dspEngineMode === "studio_wasm" && player.dynamicEqEnabled ? `${player.dynamicEqGainReductionDb.toFixed(1)} dB` : "OFF"}</strong>
                <i><b style={{ width: `${player.dspEngineMode === "studio_wasm" && player.dynamicEqEnabled ? Math.max(0, Math.min(100, (player.dynamicEqGainReductionDb / 3) * 100)) : 0}%` }} /></i>
                <small>Maximum adaptive cut</small>
              </article>
              <article data-meter="output">
                <span>OUTPUT CORR</span>
                <strong>{player.dspEngineMode === "studio_wasm" && player.outputProfile !== "reference" ? `${player.outputCorrectionReductionDb.toFixed(1)} dB` : "OFF"}</strong>
                <i><b style={{ width: `${player.dspEngineMode === "studio_wasm" && player.outputProfile !== "reference" ? Math.max(0, Math.min(100, (player.outputCorrectionReductionDb / 3) * 100)) : 0}%` }} /></i>
                <small>{player.outputProfile === "speaker" ? "Bluetooth correction" : player.outputProfile === "headphones" ? "Headphone correction" : player.outputProfile === "car_hifi" ? "Car / Hi-Fi correction" : "Reference path"}</small>
              </article>
              <article data-meter="transient">
                <span>TRANSIENT</span>
                <strong>{player.dspEngineMode === "studio_wasm" && player.outputProfile !== "reference" && player.eqEnabled && !player.dspBypass ? `+${player.transientBoostDb.toFixed(1)} dB` : "OFF"}</strong>
                <i><b style={{ width: `${player.dspEngineMode === "studio_wasm" ? Math.max(0, Math.min(100, (player.transientBoostDb / 2.5) * 100)) : 0}%` }} /></i>
                <small>Adaptive attack enhancement</small>
              </article>
              <article data-meter="stereo">
                <span>STEREO FIELD</span>
                <strong>{player.dspEngineMode === "studio_wasm" && player.outputProfile !== "reference" ? `CORR ${player.stereoCorrelation >= 0 ? "+" : ""}${player.stereoCorrelation.toFixed(2)}` : "OFF"}</strong>
                <i><b style={{ width: `${player.dspEngineMode === "studio_wasm" && player.outputProfile !== "reference" ? Math.max(0, Math.min(100, ((player.stereoCorrelation + 1) / 2) * 100)) : 0}%` }} /></i>
                <small>{player.dspEngineMode === "studio_wasm" && player.outputProfile !== "reference" ? `Width ${player.stereoWidthPercent}% • Guard ${player.stereoGuardReductionDb.toFixed(1)} dB` : "Stereo Integrity bypassed"}</small>
              </article>
              <article data-meter="level">
                <span>TRACK LEVEL</span>
                <strong>{player.normalizationEnabled && player.loudnessMomentaryLufs > -60 ? `${player.loudnessMomentaryLufs.toFixed(1)} LUFS` : player.normalizationEnabled ? "ANALYZING" : "RAW"}</strong>
                <i><b style={{ width: `${player.normalizationEnabled ? Math.max(0, Math.min(100, (Math.abs(player.loudnessGainDb) / 3) * 100)) : 0}%` }} /></i>
                <small>{player.normalizationEnabled ? `Volume Match trim ${player.loudnessGainDb > 0 ? "+" : ""}${player.loudnessGainDb.toFixed(1)} dB` : "Volume Match off"}</small>
              </article>
            </div>
          </section>
          <section className="tr-studioProcessingPanel" aria-label="Studio dynamics processing" data-mobile-dsp-section="processing">
            <button type="button" className={player.multibandEnabled && (player.dspEngineMode === "studio_wasm" || player.dspEngineMode === "advanced_worklet") ? "is-active" : ""} aria-pressed={player.multibandEnabled && (player.dspEngineMode === "studio_wasm" || player.dspEngineMode === "advanced_worklet")} disabled={player.outputProfile === "reference" || (player.dspEngineMode !== "studio_wasm" && player.dspEngineMode !== "advanced_worklet")} onClick={() => void runDspMutation(() => setMusicMultibandEnabled(!player.multibandEnabled))}>
              <span>MULTIBAND DYNAMICS</span><strong>{player.multibandEnabled ? (player.dspEngineMode === "studio_wasm" ? "ON • WASM" : "ON") : "OFF"}</strong><small>4-band transparent control • 120 Hz / 500 Hz / 4 kHz LR4 crossovers</small>
            </button>
            <button type="button" className={player.dynamicEqEnabled && player.dspEngineMode === "studio_wasm" ? "is-active" : ""} aria-pressed={player.dynamicEqEnabled && player.dspEngineMode === "studio_wasm"} disabled={player.outputProfile === "reference" || player.dspEngineMode !== "studio_wasm"} onClick={() => void runDspMutation(() => setMusicDynamicEqEnabled(!player.dynamicEqEnabled))}>
              <span>DYNAMIC EQ</span><strong>{player.dspEngineMode !== "studio_wasm" ? "STUDIO ONLY" : player.dynamicEqEnabled ? "ON • WASM" : "OFF"}</strong><small>{player.dynamicEqEnabled && player.dspEngineMode === "studio_wasm" ? `Adaptive cut ${player.dynamicEqGainReductionDb.toFixed(1)} dB max • 90 Hz / 280 Hz / 3.2 kHz / 7.6 kHz` : "Adaptive resonance control • boom / mud / harshness / edge"}</small>
            </button>
            <button type="button" className={player.normalizationEnabled && (player.dspEngineMode === "studio_wasm" || player.dspEngineMode === "advanced_worklet") ? "is-active" : ""} aria-pressed={player.normalizationEnabled && (player.dspEngineMode === "studio_wasm" || player.dspEngineMode === "advanced_worklet")} disabled={player.outputProfile === "reference" || (player.dspEngineMode !== "studio_wasm" && player.dspEngineMode !== "advanced_worklet")} onClick={() => void runDspMutation(() => setMusicNormalizationEnabled(!player.normalizationEnabled))}>
              <span>VOLUME MATCH</span><strong>{player.normalizationEnabled ? (player.dspEngineMode === "studio_wasm" ? "ON • WASM" : "ON • COMPAT") : "OFF"}</strong><small>{player.normalizationEnabled ? `Track trim ${player.loudnessGainDb > 0 ? "+" : ""}${player.loudnessGainDb.toFixed(1)} dB • Program ${player.loudnessMomentaryLufs > -60 ? `${player.loudnessMomentaryLufs.toFixed(1)} LUFS` : "ANALYZING"}` : "Optional track-to-track leveling • leaves well-matched songs alone"}</small>
            </button>
          </section>

          <div className="tr-audioEqHead" data-mobile-dsp-section="eq">
            <div><strong>Music Preset + 31-Band Studio EQ</strong><small className="tr-eqHeadHint">Preset loads the exact live 31-band curve. The sliders and orange dB values are the DSP values you hear.</small></div>
            <div className="tr-dspAbControls">
              <label className="tr-audioEqSwitch"><input type="checkbox" checked={player.eqEnabled} disabled={player.outputProfile === "reference"} onChange={(event: ChangeEvent<HTMLInputElement>) => void runDspMutation(() => setMusicEqEnabled(event.target.checked))} /><span>{player.outputProfile === "reference" ? "REF" : player.eqEnabled ? "ON" : "FLAT"}</span></label>
              <button type="button" className={`tr-dspBypassButton ${player.dspBypass || player.outputProfile === "reference" ? "is-active" : ""}`} onClick={() => void runDspMutation(() => setMusicDspBypass(!player.dspBypass))}>GAIN-MATCH {player.dspBypass || player.outputProfile === "reference" ? "REFERENCE" : "A/B"}</button>
            </div>
            <label className="tr-audioEqPreset"><span>MUSIC PRESET</span><select disabled={player.outputProfile === "reference"} value={presetSelectValue} onChange={(event: ChangeEvent<HTMLSelectElement>) => handlePresetSelection(event.target.value as MusicEqPreset)}>
              {(Object.entries(MUSIC_EQ_PRESETS) as Array<[string, { label: string }]>).map(([value, preset]) => <option key={value} value={value}>{preset.label}</option>)}
              {DSP_SLOTS.map((slot) => <option key={slot} value={slot}>{dspProfiles[slot]?.name ?? slotFallbackLabel(slot)}</option>)}
              <option value="custom">{activeSavedProfile && activeProfileDirty ? `${activeSavedProfile.name} • Modified` : "Unsaved Custom"}</option>
            </select></label>
          </div>

          <div className="tr-eqArchitecturePanel" data-mobile-dsp-section="eq">
            <div className="tr-eqArchitectureCopy"><span>FILTER TOPOLOGY</span><strong>{player.eqTopology === "linear_phase" ? "LINEAR PHASE • STUDIO WASM" : "MINIMUM PHASE • STUDIO WASM"}</strong><small>{player.eqTopology === "linear_phase" ? "4097-tap partitioned symmetric FIR inside MVP Studio WASM for critical listening. Adds about 45 ms at 48 kHz." : "Low-latency 1/3-octave minimum-phase EQ inside the same MVP Studio WASM chain. Recommended for workouts and normal playback."}</small></div>
            <div className="tr-eqArchitectureButtons">
              <button type="button" className={player.eqTopology === "minimum_phase" ? "is-active" : ""} onClick={() => void runDspMutation(() => setMusicEqTopology("minimum_phase"), true)}>MINIMUM PHASE</button>
              <button type="button" className={player.eqTopology === "linear_phase" ? "is-active" : ""} disabled={player.dspEngineMode === "native_fallback" || player.dspEngineMode === "unavailable"} onClick={() => void runDspMutation(() => setMusicEqTopology("linear_phase"), true)}>LINEAR PHASE</button>
            </div>
          </div>

          <div className="tr-audioEqScroll" aria-label="31 band user offset equalizer" data-mobile-dsp-section="eq">
            <div className="tr-audioEqBands tr-audioEqBands--31">
              {MUSIC_EQ_FREQUENCIES.map((frequency, index) => {
                const gain = Number(player.eqGains[index] ?? 0);
                return (
                  <label key={frequency} className="tr-audioEqBand" data-band-index={index} data-frequency={frequency}>
                    <span className="tr-audioEqGain">{gain > 0 ? "+" : ""}{gain.toFixed(1)} dB</span>
                    <span className="tr-audioEqSliderShell">
                      <input type="range" min="-12" max="12" step="0.5" value={gain} onChange={(event: ChangeEvent<HTMLInputElement>) => void runDspMutation(() => setMusicEqBand(index, Number(event.target.value)), true)} aria-label={`${formatHz(frequency)} equalizer gain, ${gain.toFixed(1)} decibels`} />
                    </span>
                    <span className="tr-audioEqFrequency">{formatHz(frequency)}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="tr-audioEqFooter tr-audioEqFooter--pro7" data-mobile-dsp-section="eq">
            
            <div className="tr-audioEqQuickActions"><button type="button" className={`is-flat ${player.eqPreset === "flat" ? "is-selected" : ""}`} aria-pressed={player.eqPreset === "flat"} onClick={() => void runDspMutation(() => applyMusicEqPreset("flat"), true)}><span>FLAT</span><i>REFERENCE TONE</i></button><button type="button" className={`is-power ${player.eqPreset === "power" ? "is-selected" : ""}`} aria-pressed={player.eqPreset === "power"} onClick={() => void runDspMutation(() => applyMusicEqPreset("power"), true)}><span>POWER TRAINING</span><i>HIGH ENERGY</i></button></div>
          </div>

          <div className="tr-dspProfileSave" data-mobile-dsp-section="eq">
            <div className="tr-dspProfileSaveStatus"><span>DSP PROFILE</span><strong>{presetStatusLabel}</strong>{profileMessage ? <small aria-live="polite">{profileMessage}</small> : null}</div>
            <div className="tr-dspProfileSaveActions">
              {activeCustomSlot && activeSavedProfile ? <button type="button" onClick={() => saveCurrentDspProfile(activeCustomSlot, activeSavedProfile.name)}>UPDATE PRESET</button> : null}
              <button type="button" className={`is-primary tr-savePresetCommand ${presetSaveFlash ? "is-saved" : ""}`} onClick={() => openSavePresetDialog()}><PlayerIcon name="save" /><span>{presetSaveFlash ? "PRESET SAVED" : activeCustomSlot ? "SAVE AS NEW" : "SAVE CUSTOM PRESET"}</span></button>
            </div>
          </div>

          <section className={`tr-headphoneProcessor ${player.outputProfile !== "headphones" ? "is-disabled" : ""}`} data-mobile-dsp-section="processing">
            <header><div><strong>Headphone Immersion</strong><small>{player.outputProfile === "headphones" ? `Headphone-only processing path • ${player.immersionStatus === "active" ? "ADVANCED" : player.immersionStatus === "native_fallback" ? "NATIVE FALLBACK" : player.immersionStatus === "unavailable" ? "UNAVAILABLE" : "BYPASSED"}` : "Disabled outside Headphones profile to preserve stereo fidelity"}</small></div><label><span>MODE</span><select disabled={player.outputProfile !== "headphones"} value={player.headphoneMode} onChange={(event: ChangeEvent<HTMLSelectElement>) => void runDspMutation(() => setMusicHeadphoneMode(event.target.value as MusicHeadphoneMode))}>{(Object.entries(MUSIC_HEADPHONE_MODES) as Array<[MusicHeadphoneMode, (typeof MUSIC_HEADPHONE_MODES)[MusicHeadphoneMode]]>).map(([value, mode]) => <option key={value} value={value}>{mode.label}</option>)}</select></label></header>
            <div className="tr-headphoneModes">{(Object.entries(MUSIC_HEADPHONE_MODES) as Array<[MusicHeadphoneMode, (typeof MUSIC_HEADPHONE_MODES)[MusicHeadphoneMode]]>).map(([value, mode]) => <button key={value} type="button" className={player.headphoneMode === value ? "is-active" : ""} disabled={player.outputProfile !== "headphones"} onClick={() => void runDspMutation(() => setMusicHeadphoneMode(value))}>{mode.label}</button>)}</div>
            <div className="tr-headphoneControls">
              <label><span>WIDTH <b>{player.headphoneWidth}%</b></span><input disabled={player.outputProfile !== "headphones"} type="range" min="0" max="100" value={player.headphoneWidth} onChange={(event: ChangeEvent<HTMLInputElement>) => void runDspMutation(() => setMusicHeadphoneWidth(Number(event.target.value)))} /></label>
              <label><span>DEPTH <b>{player.headphoneDepth}%</b></span><input disabled={player.outputProfile !== "headphones"} type="range" min="0" max="100" value={player.headphoneDepth} onChange={(event: ChangeEvent<HTMLInputElement>) => void runDspMutation(() => setMusicHeadphoneDepth(Number(event.target.value)))} /></label>
              <label><span>CROSSFEED <b>{player.headphoneCrossfeed}%</b></span><input disabled={player.outputProfile !== "headphones"} type="range" min="0" max="100" value={player.headphoneCrossfeed} onChange={(event: ChangeEvent<HTMLInputElement>) => void runDspMutation(() => setMusicHeadphoneCrossfeed(Number(event.target.value)))} /></label>
              <label><span>CENTER <b>{player.headphoneCenter}%</b></span><input disabled={player.outputProfile !== "headphones"} type="range" min="0" max="100" value={player.headphoneCenter} onChange={(event: ChangeEvent<HTMLInputElement>) => void runDspMutation(() => setMusicHeadphoneCenter(Number(event.target.value)))} /></label>
              <label><span>BASS IMPACT <b>{player.headphoneBassImpact}%</b></span><input disabled={player.outputProfile !== "headphones"} type="range" min="0" max="100" value={player.headphoneBassImpact} onChange={(event: ChangeEvent<HTMLInputElement>) => void runDspMutation(() => setMusicHeadphoneBassImpact(Number(event.target.value)))} /></label>
            </div>
          </section>
        </section>
      ) : null}

      {savePresetOpen ? (
        <div className="tr-dspSaveBack" onMouseDown={() => setSavePresetOpen(false)}>
          <section className="tr-dspSaveDialog" role="dialog" aria-modal="true" onMouseDown={(event: { stopPropagation: () => void }) => event.stopPropagation()}>
            <header><div><small>SAVE DSP PROFILE</small><h3>Store this complete sound setup</h3></div><button type="button" onClick={() => setSavePresetOpen(false)}>×</button></header>
            <label className="tr-dspSaveName"><span>PROFILE NAME</span><input value={savePresetName} onChange={(event: ChangeEvent<HTMLInputElement>) => setSavePresetName(event.target.value)} placeholder="Example: Gym Headphones" maxLength={32} /></label>
            <div className="tr-dspSaveSlots"><span>SAVE TO</span><div>{DSP_SLOTS.map((slot, index) => <button key={slot} type="button" className={savePresetSlot === slot ? "is-active" : ""} onClick={() => { setSavePresetSlot(slot); setSavePresetName(dspProfiles[slot]?.name ?? ""); }}><b>CUSTOM {index + 1}</b><small>{dspProfiles[slot]?.name ?? "Empty slot"}</small></button>)}</div></div>
            <div className="tr-dspSaveIncludes"><span>SAVES</span><p>Output profile • Music preset • Filter topology • 31-band EQ • Preamp • Multiband • Volume Match • Headphone mode • Width • Depth • Crossfeed • Center focus • Bass impact</p></div>
            <footer><button type="button" onClick={() => setSavePresetOpen(false)}>CANCEL</button><button type="button" className="is-primary" onClick={() => saveCurrentDspProfile(savePresetSlot, savePresetName.trim() || slotFallbackLabel(savePresetSlot))}>SAVE PRESET</button></footer>
          </section>
        </div>
      ) : null}

      {sourceUpgradeOpen && track ? (
        <div className="tr-sourceUpgradeBack" onMouseDown={() => !sourceUpgradeBusy && setSourceUpgradeOpen(false)}>
          <section className="tr-sourceUpgradeDialog" role="dialog" aria-modal="true" aria-label="Upgrade music source" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><small>SOURCE QUALITY</small><h3>Upgrade the original audio source</h3></div>
              <button type="button" disabled={sourceUpgradeBusy} onClick={() => setSourceUpgradeOpen(false)}>×</button>
            </header>

            <div className="tr-sourceUpgradeCompare">
              <article>
                <span>CURRENT SOURCE</span>
                <strong>{sourceQuality.codec} · {sourceQuality.bitrateLabel}</strong>
                <small className={`is-${sourceQuality.tier}`}>{sourceQuality.qualityLabel}</small>
              </article>
              <div className="tr-sourceUpgradeArrow" aria-hidden>→</div>
              <article className={sourceUpgradeCandidate ? "has-candidate" : ""}>
                <span>NEW SOURCE</span>
                <strong>{sourceUpgradeCandidate ? `${sourceUpgradeCandidate.codec} · ${sourceUpgradeCandidate.bitrateLabel}` : "Choose a better file"}</strong>
                <small className={sourceUpgradeCandidate ? `is-${sourceUpgradeCandidate.tier}` : ""}>{sourceUpgradeCandidate?.qualityLabel || "WAITING"}</small>
              </article>
            </div>

            <input
              ref={sourceUpgradeInputRef}
              type="file"
              accept=".mp3,.m4a,.wav,.flac,audio/mpeg,audio/mp4,audio/wav,audio/flac"
              className="tr-sourceUpgradeHiddenInput"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const file = event.target.files?.[0];
                if (file) void inspectSourceUpgrade(file);
              }}
            />

            <button type="button" className="tr-sourceUpgradeChoose" disabled={sourceUpgradeBusy} onClick={() => sourceUpgradeInputRef.current?.click()}>
              {sourceUpgradeBusy && !sourceUpgradeCandidate ? "ANALYZING…" : sourceUpgradeCandidate ? "CHOOSE DIFFERENT FILE" : "CHOOSE BETTER FILE"}
            </button>

            {sourceUpgradeComparison ? (
              <div className={`tr-sourceUpgradeVerdict ${sourceUpgradeComparison.isUpgrade ? "is-upgrade" : "is-no-upgrade"}`}>
                <strong>{sourceUpgradeComparison.isUpgrade ? "QUALITY UPGRADE ✓" : "NO QUALITY UPGRADE"}</strong>
                <span>{sourceUpgradeComparison.message}</span>
                {sourceUpgradeComparison.durationDeltaSeconds != null ? <small>Duration difference: {Math.round(sourceUpgradeComparison.durationDeltaSeconds)} sec</small> : null}
              </div>
            ) : null}

            {sourceUpgradeMessage ? <div className={`tr-sourceUpgradeMessage ${sourceUpgradeMessage.startsWith("SOURCE UPGRADED") ? "is-ok" : "is-error"}`} role="status">{sourceUpgradeMessage}</div> : null}

            <div className="tr-sourceUpgradeSafety">
              <b>SAFE REPLACEMENT</b>
              <span>The new file uploads to Cloudflare R2 first. Title, artist, artwork, playlists, Like, Play Less and history stay attached to this song. The old source is deleted only after the replacement is active.</span>
            </div>

            <footer>
              <button type="button" disabled={sourceUpgradeBusy} onClick={() => setSourceUpgradeOpen(false)}>CANCEL</button>
              <button type="button" className="is-primary" disabled={sourceUpgradeBusy || !sourceUpgradeComparison?.isUpgrade || !sourceUpgradeFile || !sourceUpgradeCandidate} onClick={() => void commitSourceUpgrade()}>
                {sourceUpgradeBusy ? "UPGRADING…" : "REPLACE SOURCE"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {player.error ? <div className="tr-audioError">{/no supported source|src_not_supported|media_err_src/i.test(player.error) ? "COULDN’T PLAY THIS TRACK • RETRY" : player.error}</div> : null}

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
        .tr-dspProofPanel{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px 12px;align-items:center;margin:10px 0 12px;padding:11px 12px;border:1px solid rgba(95,187,218,.17);border-radius:11px;background:linear-gradient(180deg,rgba(7,23,31,.84),rgba(3,12,17,.92));box-shadow:inset 0 1px 0 rgba(255,255,255,.025)}.tr-dspProofStatus{display:flex;gap:7px;flex-wrap:wrap}.tr-dspProofStatus>span{display:inline-flex;align-items:center;gap:6px;min-height:27px;padding:0 9px;border:1px solid rgba(92,166,191,.13);border-radius:7px;background:rgba(0,0,0,.18);color:#7f9ca7;font-size:6.5px;font-weight:1000;letter-spacing:.075em}.tr-dspProofStatus b{color:#c7d9e0;font-size:7px}.tr-dspProofStatus b.is-good{color:#65e5ad}.tr-dspProofStatus b.is-fallback{color:#ffc762}.tr-dspProofStatus b.is-bad{color:#ff7979}.tr-dspProofActions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}.tr-dspProofActions button{min-height:31px;padding:0 11px;border:1px solid rgba(101,186,216,.19);border-radius:8px;background:linear-gradient(180deg,rgba(14,34,43,.94),rgba(4,13,18,.96));color:#dcecf2;font-size:7px;font-weight:1000;letter-spacing:.065em;cursor:pointer}.tr-dspProofActions button.is-active{border-color:rgba(255,184,76,.58);background:rgba(119,64,6,.24);color:#ffd486;box-shadow:inset 0 0 16px rgba(255,155,36,.07)}.tr-dspProofActions button.is-reset{border-color:rgba(255,113,113,.28);color:#ff9d9d}.tr-dspProofActions button:disabled{opacity:.36;cursor:not-allowed}.tr-dspProofPanel>small{grid-column:1/-1;color:#6f8993;font-size:7px;line-height:1.45;font-weight:750}.tr-headphoneProcessor{margin-top:12px;padding:13px;border:1px solid rgba(71,186,229,.20);border-radius:14px;background:linear-gradient(180deg,rgba(11,27,38,.88),rgba(5,13,19,.92));box-shadow:inset 0 1px 0 rgba(255,255,255,.035)}.tr-headphoneProcessor header{display:grid;grid-template-columns:minmax(0,1fr) 190px;align-items:end;gap:12px}.tr-headphoneProcessor header>div{display:grid;gap:3px}.tr-headphoneProcessor header strong{color:#f4f9fc;font-size:12px}.tr-headphoneProcessor header label{display:grid;gap:4px}.tr-headphoneProcessor header label>span{color:rgba(180,204,217,.52);font-size:7px;font-weight:1000;letter-spacing:.14em}.tr-headphoneProcessor select{min-height:35px;border:1px solid rgba(125,198,224,.16);border-radius:9px;color:#f2f8fb;background:#081119;padding:0 10px;font-weight:900}.tr-headphoneModes{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}.tr-headphoneModes button.is-active{border-color:rgba(65,199,248,.52);color:#9de5ff;background:rgba(0,158,223,.11);box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}.tr-headphoneControls{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:11px}.tr-headphoneControls label{display:grid;gap:6px;padding:9px;border:1px solid rgba(255,255,255,.06);border-radius:10px;background:rgba(0,0,0,.15)}.tr-headphoneControls label>span{display:flex;justify-content:space-between;gap:6px;color:rgba(184,208,220,.55);font-size:7px;font-weight:1000;letter-spacing:.08em}.tr-headphoneControls b{color:#91defb}.tr-headphoneControls input{width:100%}
        .tr-dspSaveBack{position:fixed;inset:0;z-index:7000;display:grid;place-items:center;padding:16px;background:rgba(0,4,7,.86);backdrop-filter:blur(8px)}.tr-dspSaveDialog{width:min(560px,100%);overflow:hidden;border:1px solid rgba(78,196,236,.30);border-radius:16px;background:linear-gradient(180deg,#0b202a,#050d12);box-shadow:0 30px 80px rgba(0,0,0,.66)}.tr-dspSaveDialog header{padding:15px 17px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(91,170,199,.12)}.tr-dspSaveDialog header small,.tr-dspSaveName>span,.tr-dspSaveSlots>span,.tr-dspSaveIncludes>span{color:#5bd3f5;font-size:7px;font-weight:1000;letter-spacing:.12em}.tr-dspSaveDialog h3{margin:4px 0 0;font-size:18px}.tr-dspSaveDialog header>button{width:34px;height:34px;border:1px solid rgba(123,174,193,.16);border-radius:9px;background:#071219;color:#dce9ed;font-size:20px}.tr-dspSaveName{padding:13px 17px 7px;display:grid;gap:6px}.tr-dspSaveName input{height:42px;border:1px solid rgba(116,198,228,.20);border-radius:10px;padding:0 12px;color:#f5f9fb;background:#060d12;outline:none;font:inherit;font-weight:850}.tr-dspSaveSlots{display:grid;gap:7px;padding:9px 17px}.tr-dspSaveSlots>div{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.tr-dspSaveSlots button{min-height:60px;display:grid;align-content:center;gap:4px;padding:8px;border:1px solid rgba(255,255,255,.07);border-radius:10px;color:#d8e7ee;background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(0,0,0,.15));cursor:pointer;text-align:left}.tr-dspSaveSlots button b{font-size:9px}.tr-dspSaveSlots button small{color:rgba(184,205,216,.50);font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tr-dspSaveSlots button.is-active{border-color:rgba(65,200,248,.52);background:rgba(0,158,223,.10)}.tr-dspSaveIncludes{display:grid;gap:5px;margin:7px 17px 0;padding:11px;border:1px solid rgba(255,255,255,.055);border-radius:10px;background:rgba(0,0,0,.13)}.tr-dspSaveIncludes p{margin:0;color:rgba(212,227,235,.62);font-size:9px;line-height:1.45}.tr-dspSaveDialog footer{display:flex;justify-content:flex-end;gap:8px;padding:15px 17px 17px}.tr-dspSaveDialog footer button{min-height:38px;padding:0 16px;border:1px solid rgba(120,193,220,.14);border-radius:10px;color:#dceaf1;background:#0b151c;font-size:9px;font-weight:1000;cursor:pointer}.tr-dspSaveDialog footer button.is-primary{border-color:rgba(255,190,89,.42);color:#171006;background:linear-gradient(180deg,#ffc762,#f09a18)}
        @media(max-width:900px){.tr-audioDeck--pro7 .tr-audioDeckTop{grid-template-columns:50px minmax(0,1fr) minmax(150px,175px) max-content!important;gap:8px!important}.tr-audioDeck--pro7 .tr-audioLibraryButton{min-width:70px;padding:0 9px}.tr-audioDeck--pro7 .tr-audioEqToggle{padding-left:8px!important;padding-right:8px!important}}
        @media(max-width:700px){.tr-dspProofPanel{grid-template-columns:1fr!important}.tr-dspProofActions{justify-content:stretch!important}.tr-dspProofActions button{flex:1!important}.tr-dspProofStatus{display:grid!important;grid-template-columns:1fr!important}.tr-dspProofStatus>span{justify-content:space-between!important}.tr-audioDeck--pro7 .tr-audioDeckTop{grid-template-columns:48px minmax(0,1fr)!important;gap:8px!important}.tr-audioDeck--pro7 .tr-audioQueueSelector{grid-column:1/-1;max-width:none!important}.tr-audioDeck--pro7 .tr-audioTopButtons{grid-column:1/-1;width:100%;display:grid;grid-template-columns:1fr 1fr;min-width:0;justify-self:stretch}.tr-audioDeck--pro7 .tr-audioLibraryButton{min-height:42px;min-width:0}.tr-audioDeck--pro7 .tr-rta10Body{grid-template-columns:27px minmax(0,1fr);min-height:112px}.tr-audioDeck--pro7 .tr-rta10Grid{padding:8px 5px 6px;gap:3px}.tr-audioDeck--pro7 .tr-rta10Band{grid-template-rows:80px 12px;gap:4px}.tr-audioDeck--pro7 .tr-rta10Inactive,.tr-audioDeck--pro7 .tr-rta10Fill{inset:2px}.tr-audioDeck--pro7 .tr-rta10Band strong{font-size:5px}.tr-audioDeck--pro7 .tr-rta10Scale{padding-right:4px;font-size:5px}.tr-audioDeck--pro7 .tr-rta10Head span:last-child{display:none}.tr-audioDeck--pro7 .tr-mainAudioTuning{grid-template-columns:1fr}.tr-audioDeck--pro7 .tr-trackPreference button{flex:1}.tr-audioDeck--pro7 .tr-mainPreamp{grid-template-columns:47px minmax(80px,1fr) 56px}.tr-audioEqBands--31{grid-template-columns:repeat(31,44px)!important;min-width:1530px!important}.tr-headphoneProcessor header{grid-template-columns:1fr}.tr-headphoneControls{grid-template-columns:repeat(2,minmax(0,1fr))}.tr-dspProfileSave{align-items:flex-start;flex-direction:column}.tr-dspSaveSlots>div{grid-template-columns:1fr}}

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

        /* FINAL PRO PLAYER / MOBILE SYSTEM */
        .tr-playerHero{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:18px 12px 9px;text-align:center;min-width:0}
        .tr-playerHero .tr-audioArtwork{position:relative;width:118px!important;height:118px!important;min-width:118px!important;min-height:118px!important;max-width:118px!important;max-height:118px!important;border-radius:14px!important;overflow:hidden!important;border:1px solid rgba(130,204,228,.25)!important;background:#061018!important;box-shadow:0 16px 40px rgba(0,0,0,.35),inset 0 1px rgba(255,255,255,.05)!important}
        .tr-playerHero .tr-audioArtworkImage{display:block;width:100%!important;height:100%!important;object-fit:cover!important;object-position:center!important}
        .tr-playerHero .tr-audioIdentity{display:block;max-width:min(760px,calc(100% - 20px));min-width:0;padding:0!important;text-align:center!important;background:transparent!important;border:0!important}
        .tr-playerHero .tr-audioIdentity strong{display:block!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff!important;font-size:clamp(20px,2vw,28px)!important;line-height:1.08!important;font-weight:1000!important;letter-spacing:-.025em!important}
        .tr-playerHero .tr-audioIdentity small{display:block!important;margin-top:5px!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c3d6de!important;font-size:clamp(12px,1.1vw,15px)!important;font-weight:800!important}
        .tr-activityRta{position:relative;margin:4px auto 8px;width:calc(100% - 24px);height:102px;overflow:hidden;border:1px solid rgba(111,184,210,.17);border-radius:10px;background:linear-gradient(180deg,#02080c,#041018);box-shadow:inset 0 0 30px rgba(0,0,0,.44)}
        .tr-activityRta canvas{display:block;width:100%;height:82px}
        .tr-activityRtaLabels{position:absolute;left:7px;right:7px;bottom:4px;display:flex;justify-content:space-between;color:#849da7;font-size:8px;font-weight:900;letter-spacing:.04em;pointer-events:none}
        .tr-playerControlStage{display:flex;align-items:center;justify-content:center;gap:10px;margin:3px 12px 8px;min-width:0;flex-wrap:wrap}
        .tr-playerControlStage .tr-audioTransport{display:flex;align-items:flex-end;justify-content:center;gap:10px}
        .tr-playerControlStage .tr-trackPreference{display:flex;gap:6px}
        .tr-playerControlStage .tr-trackPreference button,.tr-playerControlStage .tr-audioModeButton{min-height:36px;padding:0 10px;border-radius:8px;color:#fff!important;font-size:9px!important;font-weight:950!important}
        .tr-audioDeck--pro7 .tr-audioTimeline{width:calc(100% - 24px)!important;margin:4px auto 7px!important;min-height:30px!important;color:#e4eff3!important;font-size:10px!important}
        .tr-playerUtilityRow{display:grid;grid-template-columns:minmax(210px,1fr) minmax(330px,auto);align-items:end;gap:16px;width:calc(100% - 24px);margin:0 auto 10px;min-width:0}
        .tr-playerVolume{display:grid;grid-template-columns:auto minmax(90px,240px) 42px;align-items:center;justify-content:center;gap:8px;min-width:0}
        .tr-playerVolume>span{color:#aec5cf;font-size:9px;font-weight:1000;letter-spacing:.08em}.tr-playerVolume>strong{color:#fff;font-size:11px;font-variant-numeric:tabular-nums}
        .tr-playerVolume input[type=range]{width:100%;accent-color:#4dd5f6}
        .tr-playerSourceTools{display:grid;grid-template-columns:minmax(190px,270px) 112px;align-items:end;justify-content:end;gap:8px;min-width:0}
        .tr-playerSourceTools .tr-audioQueueSelector{display:grid!important;grid-template-columns:1fr!important;gap:4px!important;max-width:none!important;min-width:0!important}
        .tr-playerSourceTools .tr-audioQueueSelector>span{color:#a9c2cc!important;font-size:8px!important;font-weight:1000!important;letter-spacing:.08em!important}
        .tr-playerSourceTools .tr-audioQueueSelector select{width:100%!important;height:38px!important;min-height:38px!important;padding:0 30px 0 11px!important;border-radius:8px!important;border:1px solid rgba(98,183,214,.24)!important;background:linear-gradient(180deg,#071a23,#041016)!important;color:#fff!important;font-size:10px!important;font-weight:900!important;box-shadow:inset 0 1px rgba(255,255,255,.035)!important}
        .tr-playerSourceTools .tr-audioEqToggle{width:112px!important;min-width:112px!important;height:38px!important;min-height:38px!important;padding:0 10px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:7px!important;white-space:nowrap!important;border-radius:8px!important;color:#fff!important;font-size:9px!important;font-weight:1000!important;letter-spacing:.055em!important}
        .tr-playerSourceTools .tr-audioEqToggle svg{width:15px!important;height:15px!important;flex:0 0 auto!important}
        .tr-proGlobalActions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}.tr-proHeaderButton{min-height:36px;padding:0 11px;border:1px solid rgba(111,189,218,.24);border-radius:9px;background:linear-gradient(180deg,#0a1b23,#061016);color:#fff;font-size:10px;font-weight:950;letter-spacing:.035em;cursor:pointer}.tr-proHeaderButton:hover{border-color:rgba(77,212,251,.52);background:#0a2935}.tr-proAccountWrap{position:relative}.tr-proAccountMenu{position:absolute;right:0;top:calc(100% + 6px);z-index:500;width:130px;padding:5px;border:1px solid rgba(105,184,212,.25);border-radius:9px;background:#071218;box-shadow:0 16px 34px rgba(0,0,0,.45)}.tr-proAccountMenu button{width:100%;min-height:36px;border:0;border-radius:6px;background:transparent;color:#fff;font-size:10px;font-weight:950;cursor:pointer}.tr-proAccountMenu button:hover{background:#102631}
        @media(max-width:700px){
          .tr-playerHero{gap:7px;padding:12px 8px 6px}.tr-playerHero .tr-audioArtwork{width:92px!important;height:92px!important;min-width:92px!important;min-height:92px!important;max-width:92px!important;max-height:92px!important;border-radius:12px!important}.tr-playerHero .tr-audioIdentity strong{font-size:20px!important}.tr-playerHero .tr-audioIdentity small{font-size:12px!important;margin-top:3px!important}
          .tr-activityRta{width:calc(100% - 14px);height:78px;margin:3px auto 6px}.tr-activityRta canvas{height:61px}.tr-activityRtaLabels{font-size:6.5px;bottom:3px}
          .tr-playerControlStage{gap:5px;margin:2px 7px 5px;display:grid;grid-template-columns:42px minmax(0,1fr) 42px;align-items:center}.tr-playerControlStage .tr-audioTransport{gap:4px}.tr-playerControlStage .tr-trackPreference{grid-column:1/-1;justify-content:center}.tr-playerControlStage .tr-trackPreference button{min-height:31px;font-size:8px!important;padding:0 8px}.tr-playerControlStage .tr-audioModeButton{min-width:42px!important;width:42px!important;min-height:32px!important;padding:0 3px!important;font-size:0!important}.tr-playerControlStage .tr-audioModeButton svg{width:16px;height:16px}.tr-playerControlStage .tr-audioTransportButton{transform:scale(.82)!important}.tr-playerControlStage .tr-audioTransportUnit>span{font-size:6.5px!important}
          .tr-audioDeck--pro7 .tr-audioTimeline{width:calc(100% - 14px)!important;margin:2px auto 5px!important;font-size:9px!important}
          .tr-playerUtilityRow{grid-template-columns:1fr;width:calc(100% - 14px);gap:7px;margin-bottom:8px}.tr-playerVolume{grid-template-columns:48px minmax(0,1fr) 38px;gap:6px}.tr-playerSourceTools{grid-template-columns:minmax(0,1fr) 96px;gap:6px;justify-content:stretch}.tr-playerSourceTools .tr-audioEqToggle{width:96px!important;min-width:96px!important;padding:0 6px!important;font-size:8px!important}.tr-playerSourceTools .tr-audioQueueSelector select{font-size:9px!important;padding-left:8px!important}.tr-playerSourceTools .tr-audioQueueSelector>span{font-size:8px!important}
          .tr-proGlobalActions{width:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.tr-proHeaderButton{width:100%;min-width:0;padding:0 6px;font-size:9px}.tr-proAccountWrap{width:100%}.tr-proAccountWrap>.tr-proHeaderButton{width:100%}.tr-proAccountMenu{right:0;left:0;width:auto}
        }

        /* AUG 9 FINAL PLAYER + GLOBAL MOBILE POLISH */
        .tr-audioDeck--pro7{overflow:hidden!important}
        .tr-playerHero{padding-top:16px!important}
        .tr-playerHero .tr-audioArtwork{width:132px!important;height:132px!important;min-width:132px!important;min-height:132px!important;max-width:132px!important;max-height:132px!important}
        .tr-playerHero .tr-audioIdentity{max-width:min(820px,calc(100% - 28px))!important}
        .tr-playerHero .tr-audioIdentity strong{font-size:clamp(23px,2.2vw,31px)!important}
        .tr-playerHero .tr-audioIdentity small{font-size:clamp(13px,1.2vw,16px)!important}
        .tr-activityRta{height:108px!important;margin:5px 14px 8px!important}
        .tr-playerControlStage{max-width:820px!important;margin-inline:auto!important}
        .tr-audioTimeline{max-width:860px!important;margin-inline:auto!important}
        .tr-playerUtilityRow{max-width:860px!important;margin:8px auto 12px!important;grid-template-columns:minmax(170px,250px) minmax(0,1fr)!important;align-items:end!important}
        .tr-playerVolume{min-width:0!important}
        .tr-playerVolume input{width:100%!important}
        .tr-playerSourceTools{min-width:0!important;display:grid!important;grid-template-columns:minmax(180px,1fr) 112px!important;gap:8px!important;align-items:end!important}
        .tr-audioQueueSelector{max-width:none!important;width:100%!important;min-width:0!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important}
        .tr-audioQueueSelector>span{display:block!important;margin:0 0 5px 2px!important;color:#9ec0cd!important;font-size:9px!important;font-weight:950!important;letter-spacing:.09em!important}
        .tr-audioQueueSelector select{height:40px!important;width:100%!important;min-width:0!important;padding:0 34px 0 12px!important;border:1px solid rgba(105,186,215,.22)!important;border-radius:9px!important;background:#07161e!important;color:#fff!important;font-size:11px!important;font-weight:900!important;box-shadow:inset 0 1px rgba(255,255,255,.03)!important}
        .tr-audioEqToggle{width:112px!important;min-width:112px!important;max-width:112px!important;height:40px!important;min-height:40px!important;padding:0 10px!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:7px!important;white-space:nowrap!important;border-radius:9px!important;color:#fff!important;font-size:10px!important;letter-spacing:.03em!important}
        .tr-audioEqToggle svg{width:16px!important;height:16px!important;flex:0 0 16px!important}
        .tr-proHeaderButton.is-resume{border-color:rgba(78,221,156,.48)!important;background:linear-gradient(180deg,#0b3a2b,#082319)!important;color:#fff!important}
        .tr-audioError{max-width:860px!important;margin:7px auto 10px!important;color:#ffd8da!important;font-size:12px!important;font-weight:900!important}
        @media(max-width:650px){
          html,body,#root{max-width:100%!important;overflow-x:hidden!important}
          .tr-shellInner{max-width:100%!important;overflow-x:hidden!important}
          .tr-audioDeck--pro7{width:100%!important;max-width:100%!important;border-radius:12px!important}
          .tr-playerHero{padding:11px 7px 5px!important;gap:6px!important}
          .tr-playerHero .tr-audioArtwork{width:104px!important;height:104px!important;min-width:104px!important;min-height:104px!important;max-width:104px!important;max-height:104px!important}
          .tr-playerHero .tr-audioIdentity{max-width:calc(100% - 14px)!important}
          .tr-playerHero .tr-audioIdentity strong{font-size:21px!important;line-height:1.1!important}
          .tr-playerHero .tr-audioIdentity small{font-size:13px!important}
          .tr-activityRta{height:72px!important;margin:4px 7px 6px!important;border-radius:8px!important}
          .tr-activityRtaLabels{font-size:6px!important;padding-inline:3px!important}
          .tr-playerControlStage{padding:0 5px!important;gap:5px!important}
          .tr-audioTransport{gap:4px!important}
          .tr-audioTransportUnit>span,.tr-audioModeButton span,.tr-trackPreference span{font-size:7px!important}
          .tr-audioTimeline{margin:4px 8px!important;grid-template-columns:34px minmax(0,1fr) 34px!important;gap:5px!important}
          .tr-audioTimeline>span{font-size:8px!important}
          .tr-playerUtilityRow{margin:6px 7px 9px!important;grid-template-columns:1fr!important;gap:7px!important}
          .tr-playerVolume{display:grid!important;grid-template-columns:48px minmax(0,1fr) 38px!important;align-items:center!important;gap:7px!important}
          .tr-playerVolume>span{margin:0!important;font-size:8px!important}
          .tr-playerVolume>strong{font-size:9px!important;text-align:right!important}
          .tr-playerSourceTools{grid-template-columns:minmax(0,1fr) 96px!important;gap:6px!important}
          .tr-audioQueueSelector>span{font-size:7.5px!important;margin-bottom:4px!important}
          .tr-audioQueueSelector select{height:38px!important;font-size:10px!important;padding-left:9px!important}
          .tr-audioEqToggle{width:96px!important;min-width:96px!important;max-width:96px!important;height:38px!important;min-height:38px!important;font-size:9px!important;padding:0 7px!important}
          .tr-audioEqToggle svg{width:14px!important;height:14px!important;flex-basis:14px!important}
          .tr-audioEqPanel{max-width:100%!important;overflow:hidden!important}
          .tr-audioEqScroll{max-width:100%!important;overflow-x:auto!important;-webkit-overflow-scrolling:touch!important}
          .tr-proGlobalActions{grid-template-columns:repeat(2,minmax(0,1fr))!important}
          .tr-proHeaderButton{min-height:40px!important;font-size:9px!important}
        }

        /* AUG 9 LOCKED PRO PLAYER: authoritative layout + no clipping */
        .tr-audioDeck--pro7{background:radial-gradient(circle at 50% -10%,rgba(26,78,98,.16),transparent 36%),linear-gradient(180deg,#091219 0%,#050a0e 54%,#030608 100%)!important;border:1px solid rgba(91,190,226,.18)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 18px 55px rgba(0,0,0,.34)!important}
        .tr-playerHero{display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;text-align:center!important;overflow:visible!important}
        .tr-playerHero .tr-audioArtwork{width:148px!important;height:148px!important;min-width:148px!important;min-height:148px!important;max-width:148px!important;max-height:148px!important;border-radius:16px!important;overflow:hidden!important;box-shadow:0 14px 36px rgba(0,0,0,.45),0 0 0 1px rgba(119,211,245,.14)!important}
        .tr-playerHero .tr-audioArtwork img{width:100%!important;height:100%!important;object-fit:cover!important;display:block!important}
        .tr-playerHero .tr-audioIdentity{display:flex!important;flex-direction:column!important;align-items:center!important;width:min(920px,calc(100% - 28px))!important;max-width:min(920px,calc(100% - 28px))!important;height:auto!important;min-height:0!important;overflow:visible!important;padding:4px 4px 8px!important;white-space:normal!important}
        .tr-playerHero .tr-audioIdentity strong{display:block!important;overflow:visible!important;text-overflow:clip!important;width:100%!important;max-width:100%!important;height:auto!important;max-height:none!important;padding:3px 0 7px!important;margin:0!important;font-size:clamp(23px,2.35vw,32px)!important;line-height:1.22!important;letter-spacing:-.025em!important;color:#fff!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:normal!important}
        .tr-playerHero .tr-audioIdentity small{display:block!important;width:100%!important;padding:0 0 2px!important;overflow:visible!important;font-size:clamp(13px,1.25vw,16px)!important;line-height:1.35!important;color:#b9d0da!important;white-space:normal!important;word-break:break-word!important}
        .tr-activityRta{background:linear-gradient(180deg,#040a0e,#020507)!important;border:1px solid rgba(91,184,216,.13)!important;box-shadow:inset 0 1px 16px rgba(0,0,0,.55)!important}
        .tr-playerControlStage{display:flex!important;flex-wrap:wrap!important;align-items:center!important;justify-content:center!important;gap:10px 12px!important;width:min(980px,calc(100% - 24px))!important;max-width:980px!important;margin:8px auto 6px!important;padding:0!important}
        .tr-playerControlStage>.tr-audioModeButton{flex:0 0 auto!important;align-self:center!important}
        .tr-playerControlStage .tr-audioTransport{display:flex!important;align-items:center!important;justify-content:center!important;gap:12px!important;flex:0 1 auto!important;margin:0!important}
        .tr-playerControlStage .tr-audioTransportUnit{display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;margin:0!important}
        .tr-playerControlStage .tr-audioTransportButton{margin:0!important}
        .tr-trackPreference{display:flex!important;align-items:center!important;justify-content:center!important;gap:8px!important;flex-wrap:wrap!important;margin:0!important}
        .tr-trackPreference button{height:38px!important;min-height:38px!important;padding:0 12px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:7px!important;border-radius:9px!important;font-size:9px!important;font-weight:1000!important;line-height:1!important;white-space:nowrap!important;transition:background .18s ease,border-color .18s ease,box-shadow .18s ease,transform .18s ease!important}
        .tr-trackPreference button svg{width:16px!important;height:16px!important;flex:0 0 16px!important}
        .tr-trackPreference .tr-prefLike{color:#ffd84d!important;border-color:rgba(255,216,77,.36)!important;background:linear-gradient(180deg,rgba(69,55,8,.55),rgba(20,16,4,.76))!important}
        .tr-trackPreference .tr-prefLike.is-liked{color:#fff!important;border-color:#46e394!important;background:linear-gradient(180deg,#15975f,#087746)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 0 0 1px rgba(70,227,148,.22),0 0 18px rgba(36,210,127,.25)!important}
        .tr-trackPreference .tr-prefLess{color:#ff6b74!important;border-color:rgba(255,85,95,.38)!important;background:linear-gradient(180deg,rgba(71,15,20,.58),rgba(24,7,9,.8))!important}
        .tr-trackPreference .tr-prefLess.is-disliked{color:#fff!important;border-color:#ff5360!important;background:linear-gradient(180deg,#c52e3a,#8f1420)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.13),0 0 0 1px rgba(255,83,96,.18),0 0 18px rgba(224,42,57,.24)!important}
        .tr-trackPreference .tr-prefDiscover{color:#ffd879!important;border-color:rgba(255,197,79,.34)!important;background:linear-gradient(180deg,rgba(69,48,9,.48),rgba(24,15,3,.78))!important}
        .tr-trackPreference .tr-prefDiscover:active{transform:translateY(1px) scale(.985)!important;background:linear-gradient(180deg,#b56f10,#744207)!important;color:#fff!important}
        .tr-discoverToast{width:max-content;max-width:calc(100% - 24px);margin:4px auto 7px;padding:7px 11px;border:1px solid rgba(255,203,91,.32);border-radius:999px;background:#171106;color:#ffe4a1;font-size:9px;font-weight:1000;letter-spacing:.06em}
        .tr-playerSourceTools .tr-audioEqToggle{overflow:visible!important;position:relative!important;border-color:rgba(61,195,242,.34)!important;background:linear-gradient(180deg,#09202a,#061118)!important;transition:background .2s ease,border-color .2s ease,box-shadow .2s ease,transform .2s ease!important}
        .tr-playerSourceTools .tr-audioEqToggle:hover{border-color:rgba(71,214,255,.64)!important;background:linear-gradient(180deg,#0d3442,#07202a)!important}
        .tr-playerSourceTools .tr-audioEqToggle.is-active{color:#fff!important;border-color:#55d9ff!important;background:linear-gradient(180deg,#087da4,#07546e)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 0 0 1px rgba(85,217,255,.18),0 0 20px rgba(50,195,239,.26)!important;animation:trEqOpenPulse .2s ease-out 1!important}
        @keyframes trEqOpenPulse{0%{transform:scale(.96);filter:brightness(.85)}100%{transform:scale(1);filter:brightness(1)}}
        .tr-proGlobalActions{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:6px!important;flex-wrap:nowrap!important;width:auto!important}
        .tr-proHeaderButton{min-height:34px!important;height:34px!important;padding:0 10px!important;font-size:9px!important;white-space:nowrap!important}
        @media(max-width:650px){
          .tr-playerHero .tr-audioArtwork{width:108px!important;height:108px!important;min-width:108px!important;min-height:108px!important;max-width:108px!important;max-height:108px!important;border-radius:13px!important}
          .tr-playerHero .tr-audioIdentity{width:calc(100% - 12px)!important;max-width:calc(100% - 12px)!important;padding:3px 4px 5px!important}
          .tr-playerHero .tr-audioIdentity strong{font-size:20px!important;line-height:1.22!important;padding-bottom:5px!important}
          .tr-playerHero .tr-audioIdentity small{font-size:12.5px!important;line-height:1.3!important}
          .tr-activityRta{height:66px!important;margin:3px 6px 5px!important}
          .tr-playerControlStage{display:flex!important;width:calc(100% - 10px)!important;gap:6px!important;margin:5px auto!important}
          .tr-playerControlStage .tr-audioTransport{order:1;width:100%!important;gap:8px!important}
          .tr-playerControlStage>.tr-audioModeButton{order:2!important;width:42px!important;min-width:42px!important;height:34px!important;min-height:34px!important}
          .tr-trackPreference{order:3!important;width:100%!important;gap:5px!important}
          .tr-trackPreference button{height:34px!important;min-height:34px!important;padding:0 8px!important;font-size:7.7px!important;gap:5px!important}
          .tr-trackPreference button svg{width:14px!important;height:14px!important;flex-basis:14px!important}
          .tr-playerUtilityRow{grid-template-columns:1fr!important;margin:5px 6px 8px!important}
          .tr-playerSourceTools{grid-template-columns:minmax(0,1fr) 92px!important;gap:6px!important}
          .tr-playerSourceTools .tr-audioEqToggle{width:92px!important;min-width:92px!important;max-width:92px!important;font-size:8px!important}
          .tr-proGlobalActions{display:flex!important;width:auto!important;max-width:calc(100% - 8px)!important;gap:4px!important;flex-wrap:nowrap!important}
          .tr-proHeaderButton{width:auto!important;min-width:0!important;height:31px!important;min-height:31px!important;padding:0 7px!important;font-size:7.5px!important;letter-spacing:.025em!important}
          .tr-proHeaderButton.is-sound{font-size:0!important;width:36px!important;padding:0!important}
          .tr-proHeaderButton.is-sound:after{content:"♪";font-size:16px!important;color:#fff!important}
          .tr-proHeaderButton--account{font-size:0!important;width:36px!important;padding:0!important}
          .tr-proHeaderButton--account:after{content:"●";font-size:12px!important;color:#9fdff4!important}
          .tr-proAccountWrap{width:auto!important}
          .tr-proAccountWrap>.tr-proHeaderButton{width:36px!important}
          .tr-proAccountMenu{right:0!important;left:auto!important;width:116px!important}
        }


        /* AUG 9 FINAL PRO POLISH: full-width media stage, true 10-band RTA, responsive controls */
        .tr-audioDeck--pro7{overflow:hidden!important}
        .tr-playerHero{
          position:relative!important;
          display:grid!important;
          grid-template-columns:clamp(180px,22vw,260px) minmax(0,1fr)!important;
          align-items:stretch!important;
          gap:0!important;
          width:100%!important;
          min-height:clamp(190px,24vw,260px)!important;
          margin:0!important;
          padding:0!important;
          overflow:hidden!important;
          border-bottom:1px solid rgba(102,196,224,.10)!important;
          background-color:#050b0f!important;
          background-size:cover!important;
          background-position:center!important;
          background-repeat:no-repeat!important;
          text-align:left!important;
        }
        .tr-playerHero::after{
          content:"";position:absolute;inset:0;pointer-events:none;
          background:linear-gradient(180deg,rgba(255,255,255,.025),transparent 35%,rgba(0,0,0,.18));
        }
        .tr-playerHero .tr-audioArtwork{
          position:relative!important;z-index:2!important;
          width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;
          aspect-ratio:auto!important;border:0!important;border-radius:0!important;margin:0!important;padding:0!important;
          overflow:hidden!important;background:#071116!important;box-shadow:none!important;
        }
        .tr-playerHero .tr-audioArtworkImage{width:100%!important;height:100%!important;display:block!important;object-fit:cover!important}
        .tr-playerHero .tr-audioIdentity{
          position:relative!important;z-index:2!important;
          width:100%!important;max-width:none!important;min-width:0!important;height:100%!important;
          padding:clamp(22px,3vw,40px)!important;margin:0!important;
          display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:center!important;
          text-align:left!important;overflow:visible!important;white-space:normal!important;
        }
        .tr-audioNowLabel{display:block;color:#55d8f7;font-size:10px;line-height:1;font-weight:1000;letter-spacing:.16em;margin-bottom:11px}
        .tr-playerHero .tr-audioIdentity strong{
          display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:2!important;
          width:100%!important;max-width:100%!important;min-height:0!important;height:auto!important;max-height:none!important;
          margin:0!important;padding:1px 0 7px!important;overflow:hidden!important;text-overflow:ellipsis!important;
          color:#fff!important;font-size:clamp(27px,3.2vw,44px)!important;line-height:1.11!important;font-weight:1000!important;letter-spacing:-.038em!important;
          overflow-wrap:anywhere!important;word-break:normal!important;
        }
        .tr-playerHero .tr-audioIdentity small{width:100%!important;color:#d1e2e9!important;font-size:clamp(14px,1.4vw,18px)!important;line-height:1.3!important;font-weight:850!important;white-space:normal!important;overflow-wrap:anywhere!important}
        .tr-playerHero .tr-audioIdentity em{display:block;margin-top:7px;color:#82a2ae;font-size:clamp(11px,1vw,14px);line-height:1.35;font-style:normal;font-weight:700;white-space:normal;overflow-wrap:anywhere}

        .tr-activityRta--10band{position:relative!important;height:154px!important;margin:10px 12px 6px!important;border:1px solid rgba(93,199,226,.17)!important;border-radius:12px!important;background:linear-gradient(180deg,#03090d,#010405)!important;box-shadow:inset 0 0 24px rgba(0,0,0,.72),inset 0 1px 0 rgba(255,255,255,.025)!important;overflow:hidden!important}
        .tr-activityRta--10band canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
        .tr-activityRta--10band .tr-activityRtaLabels{position:absolute!important;left:30px!important;right:4px!important;bottom:4px!important;height:13px!important;display:grid!important;grid-template-columns:repeat(10,minmax(0,1fr))!important;gap:clamp(4px,.9vw,11px)!important;align-items:end!important;pointer-events:none!important}
        .tr-activityRta--10band .tr-activityRtaLabels span{min-width:0!important;color:rgba(185,219,229,.64)!important;font-size:8px!important;line-height:1!important;font-weight:900!important;letter-spacing:.02em!important;text-align:center!important;white-space:nowrap!important;overflow:visible!important}

        .tr-playerControlStage{display:grid!important;grid-template-columns:auto minmax(310px,auto) auto minmax(0,auto)!important;align-items:center!important;justify-content:center!important;gap:10px!important;width:100%!important;max-width:none!important;margin:8px auto 6px!important;padding:0 12px!important}
        .tr-trackPreference{display:flex!important;align-items:center!important;justify-content:center!important;gap:7px!important;flex-wrap:nowrap!important;min-width:0!important}
        .tr-trackPreference button,.tr-playerControlStage>.tr-audioModeButton{
          min-height:38px!important;height:38px!important;border:1px solid rgba(143,174,187,.18)!important;border-radius:9px!important;
          background:linear-gradient(180deg,#101b21,#071015)!important;color:#eaf5f8!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.035)!important;
          white-space:nowrap!important;overflow:visible!important;text-overflow:clip!important;
        }
        .tr-trackPreference button{padding:0 11px!important;font-size:9px!important}
        .tr-trackPreference button svg{color:inherit!important;fill:currentColor!important}
        .tr-trackPreference .tr-prefLike,.tr-trackPreference .tr-prefLess,.tr-trackPreference .tr-prefDiscover{color:#eaf5f8!important;border-color:rgba(143,174,187,.18)!important;background:linear-gradient(180deg,#101b21,#071015)!important}
        .tr-trackPreference .tr-prefLike.is-liked{color:#fff!important;border-color:#44e398!important;background:linear-gradient(180deg,#159b63,#087748)!important;box-shadow:0 0 0 1px rgba(68,227,152,.18),0 0 18px rgba(35,207,126,.22)!important}
        .tr-trackPreference .tr-prefLess.is-disliked{color:#fff!important;border-color:#ff5d69!important;background:linear-gradient(180deg,#c73541,#8f1822)!important;box-shadow:0 0 0 1px rgba(255,93,105,.16),0 0 18px rgba(226,48,62,.20)!important}
        .tr-trackPreference .tr-prefDiscover.is-confirming{color:#fff8df!important;border-color:#ffc55b!important;background:linear-gradient(180deg,#a96812,#704006)!important;box-shadow:0 0 17px rgba(240,161,49,.20)!important}

        @media(max-width:900px){
          .tr-playerControlStage{grid-template-columns:auto 1fr auto!important;grid-template-areas:"shuffle transport repeat" "prefs prefs prefs"!important;gap:8px!important}
          .tr-playerControlStage>.tr-audioModeButton:first-child{grid-area:shuffle!important}.tr-playerControlStage>.tr-audioModeButton:nth-of-type(2){grid-area:repeat!important}
          .tr-playerControlStage .tr-audioTransport{grid-area:transport!important}.tr-playerControlStage .tr-trackPreference{grid-area:prefs!important}
        }
        @media(max-width:650px){
          .tr-playerHero{grid-template-columns:minmax(112px,38vw) minmax(0,1fr)!important;min-height:138px!important}
          .tr-playerHero .tr-audioArtwork{width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;border-radius:0!important}
          .tr-playerHero .tr-audioIdentity{width:100%!important;max-width:none!important;padding:14px 12px!important;align-items:flex-start!important;text-align:left!important}
          .tr-audioNowLabel{font-size:7.5px!important;margin-bottom:7px!important;letter-spacing:.12em!important}
          .tr-playerHero .tr-audioIdentity strong{font-size:clamp(19px,6.2vw,25px)!important;line-height:1.12!important;padding:0 0 5px!important;-webkit-line-clamp:2!important}
          .tr-playerHero .tr-audioIdentity small{font-size:12px!important;line-height:1.25!important}
          .tr-playerHero .tr-audioIdentity em{font-size:9.5px!important;margin-top:5px!important;display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:1!important;overflow:hidden!important}
          .tr-activityRta--10band{height:112px!important;margin:7px 6px 5px!important;border-radius:9px!important}
          .tr-activityRta--10band .tr-activityRtaLabels{left:4px!important;right:4px!important;gap:4px!important}
          .tr-activityRta--10band .tr-activityRtaLabels span{font-size:6.3px!important;letter-spacing:-.02em!important}
          .tr-playerControlStage{width:100%!important;padding:0 6px!important;grid-template-columns:38px minmax(0,1fr) 38px!important;gap:5px!important}
          .tr-playerControlStage>.tr-audioModeButton{width:38px!important;min-width:38px!important;height:36px!important;min-height:36px!important;padding:0!important;font-size:0!important}
          .tr-playerControlStage>.tr-audioModeButton svg{width:17px!important;height:17px!important}
          .tr-playerControlStage .tr-audioTransport{width:100%!important;display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:4px!important}
          .tr-playerControlStage .tr-audioTransportUnit{min-width:0!important}
          .tr-playerControlStage .tr-audioTransportButton{width:100%!important;min-width:0!important}
          .tr-playerControlStage .tr-audioTransportUnit>span{font-size:6.5px!important;white-space:nowrap!important}
          .tr-trackPreference{width:100%!important;display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:5px!important}
          .tr-trackPreference button{width:100%!important;min-width:0!important;height:38px!important;min-height:38px!important;padding:0 5px!important;font-size:7.3px!important;gap:4px!important;white-space:normal!important;line-height:1.05!important;text-align:center!important}
          .tr-trackPreference button svg{width:14px!important;height:14px!important;flex:0 0 14px!important}
          .tr-playerUtilityRow{margin:5px 6px 8px!important}
          .tr-playerSourceTools{grid-template-columns:minmax(0,1fr) 88px!important}
          .tr-playerSourceTools .tr-audioEqToggle{width:88px!important;min-width:88px!important;max-width:88px!important;overflow:visible!important}
        }
        @media(max-width:385px){
          .tr-playerHero{grid-template-columns:112px minmax(0,1fr)!important}
          .tr-playerHero .tr-audioIdentity{padding:11px 9px!important}
          .tr-playerHero .tr-audioIdentity strong{font-size:18px!important}
          .tr-trackPreference button{font-size:8.8px!important;padding:0 3px!important}
        }

        /* FINAL NO-CUTOFF PLAYER TEXT + LEGIBLE MOBILE ACTIONS */
        .tr-playerHero .tr-audioIdentity strong{
          display:block!important;-webkit-line-clamp:unset!important;-webkit-box-orient:initial!important;
          overflow:visible!important;text-overflow:clip!important;white-space:normal!important;max-height:none!important;
        }
        .tr-playerHero .tr-audioIdentity em{display:block!important;overflow:visible!important;-webkit-line-clamp:unset!important;white-space:normal!important}
        @media(max-width:650px){
          .tr-playerHero{height:auto!important;min-height:148px!important}
          .tr-playerHero .tr-audioIdentity{height:auto!important;min-height:148px!important}
          .tr-playerHero .tr-audioArtwork{min-height:148px!important}
          .tr-trackPreference button{font-size:9px!important;line-height:1.12!important;font-weight:1000!important}
          .tr-trackPreference button span{display:inline!important;visibility:visible!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important}
          .tr-playerControlStage .tr-audioTransportUnit>span{font-size:8px!important;line-height:1.1!important;white-space:normal!important}
          .tr-playerSourceTools .tr-audioQueueSelector>span{font-size:8.5px!important}
          .tr-playerSourceTools .tr-audioQueueSelector select{font-size:10px!important}
          .tr-playerSourceTools .tr-audioEqToggle{font-size:9px!important}
        }


        /* AUG 9 AUTHORITATIVE MUSIC PLAYER V3: exact requested order, zero dead-space hero */
        .tr-audioDeck--pro7{overflow:hidden!important;background:linear-gradient(180deg,#071118 0%,#03080c 100%)!important}
        .tr-playerHero{
          display:grid!important;grid-template-columns:clamp(220px,30%,310px) minmax(0,1fr)!important;
          width:100%!important;min-width:0!important;height:auto!important;min-height:0!important;
          margin:0!important;padding:0!important;gap:0!important;align-items:stretch!important;
          overflow:hidden!important;text-align:left!important;background:#050c11!important;border-bottom:1px solid rgba(91,194,225,.13)!important;
        }
        .tr-playerHero .tr-audioArtwork{
          position:relative!important;width:100%!important;height:auto!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;
          aspect-ratio:1/1!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;overflow:hidden!important;background:#071116!important;box-shadow:none!important;
        }
        .tr-playerHero .tr-audioArtworkImage{display:block!important;width:100%!important;height:100%!important;object-fit:cover!important;object-position:center!important}
        .tr-playerHero .tr-audioArtworkFallback{width:100%!important;height:100%!important;display:grid!important;place-items:center!important}.tr-playerHero .tr-audioArtworkFallback svg{width:34%!important;height:34%!important}
        .tr-playerHero .tr-audioIdentity{
          width:100%!important;max-width:none!important;min-width:0!important;height:100%!important;min-height:0!important;
          margin:0!important;padding:clamp(22px,3.2vw,42px)!important;display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:center!important;
          border:0!important;background:linear-gradient(120deg,#0a1820 0%,#071117 62%,#04090d 100%)!important;text-align:left!important;overflow:hidden!important;
        }
        .tr-playerHero .tr-audioIdentity strong{
          display:block!important;width:100%!important;max-width:100%!important;margin:0!important;padding:0!important;color:#fff!important;
          font-size:clamp(30px,4vw,52px)!important;line-height:1.04!important;font-weight:1000!important;letter-spacing:-.042em!important;
          white-space:normal!important;overflow:visible!important;text-overflow:clip!important;overflow-wrap:anywhere!important;
        }
        .tr-playerHero .tr-audioIdentity small{
          display:block!important;width:100%!important;margin-top:10px!important;padding:0!important;color:#b9d0da!important;
          font-size:clamp(15px,1.55vw,20px)!important;line-height:1.25!important;font-weight:800!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;
        }
        .tr-playerHero .tr-audioIdentity em,.tr-playerHero .tr-audioNowLabel{display:none!important}

        .tr-audioDeck--pro7 .tr-audioTimeline{
          width:calc(100% - 20px)!important;max-width:none!important;margin:8px auto 6px!important;padding:0!important;min-height:28px!important;
          display:grid!important;grid-template-columns:42px minmax(0,1fr) 42px!important;gap:8px!important;align-items:center!important;color:#dbe9ee!important;font-size:10px!important;
        }
        .tr-audioDeck--pro7 .tr-audioTimeline>span:first-child{text-align:left!important}.tr-audioDeck--pro7 .tr-audioTimeline>span:last-child{text-align:right!important}.tr-audioDeck--pro7 .tr-audioTimeline input{width:100%!important;accent-color:#ffad31!important}

        .tr-playerTransportStage{
          width:min(860px,calc(100% - 20px))!important;margin:4px auto 6px!important;padding:0!important;
          display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:9px!important;align-items:start!important;justify-content:center!important;
        }
        .tr-playerTransportStage .tr-audioTransportUnit{display:grid!important;grid-template-rows:auto 14px!important;gap:5px!important;min-width:0!important;align-items:center!important;justify-items:stretch!important;margin:0!important}
        .tr-playerTransportStage .tr-audioTransportButton{
          width:100%!important;height:54px!important;min-width:0!important;min-height:54px!important;max-width:none!important;margin:0!important;padding:0!important;transform:none!important;
          border:1px solid rgba(130,179,197,.22)!important;border-radius:12px!important;background:linear-gradient(180deg,#102029,#071116)!important;color:#eff9fc!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.045),0 5px 14px rgba(0,0,0,.20)!important;
        }
        .tr-playerTransportStage .tr-audioTransportButton:hover{border-color:rgba(89,209,247,.48)!important;background:linear-gradient(180deg,#12303d,#081922)!important}
        .tr-playerTransportStage .tr-audioTransportButton--primary{border-color:rgba(255,181,66,.62)!important;background:linear-gradient(180deg,#ffbc45,#e98a13)!important;color:#130d05!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.40),0 0 20px rgba(238,147,22,.20)!important}
        .tr-playerTransportStage .tr-audioTransportFace{display:grid!important;place-items:center!important;width:100%!important;height:100%!important}.tr-playerTransportStage .tr-audioTransportFace svg{width:24px!important;height:24px!important;fill:currentColor!important}
        .tr-playerTransportStage .tr-audioTransportUnit>span{display:block!important;color:#9fb5be!important;font-size:8px!important;line-height:1!important;font-weight:1000!important;letter-spacing:.09em!important;text-align:center!important;white-space:nowrap!important}
        .tr-playerTransportStage .tr-audioTransportUnit.is-primary>span{color:#ffc25f!important}

        .tr-playerModeStage{
          width:calc(100% - 20px)!important;margin:0 auto 7px!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:8px!important;
        }
        .tr-playerModeStage .tr-audioModeButton{
          width:auto!important;min-width:108px!important;height:34px!important;min-height:34px!important;padding:0 13px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:7px!important;
          border:1px solid rgba(135,177,193,.19)!important;border-radius:9px!important;background:linear-gradient(180deg,#0d1a21,#061015)!important;color:#d9e9ee!important;font-size:8.5px!important;font-weight:1000!important;letter-spacing:.05em!important;
        }
        .tr-playerModeStage .tr-audioModeButton svg{width:15px!important;height:15px!important;fill:currentColor!important}.tr-playerModeStage .tr-audioModeButton.is-active{border-color:rgba(78,210,250,.58)!important;background:#0a3443!important;color:#a7ebff!important;box-shadow:inset 0 -2px #48d3f6!important}

        .tr-activityRta--10band{
          position:relative!important;width:calc(100% - 20px)!important;height:126px!important;margin:0 auto 7px!important;border:1px solid rgba(97,193,221,.21)!important;border-radius:10px!important;
          overflow:hidden!important;background:#010507!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.015),inset 0 0 26px rgba(0,0,0,.70),0 6px 18px rgba(0,0,0,.15)!important;
        }
        .tr-activityRta--10band canvas{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;display:block!important}
        .tr-activityRta--10band .tr-activityRtaLabels{position:absolute!important;left:34px!important;right:6px!important;bottom:4px!important;height:12px!important;display:grid!important;grid-template-columns:repeat(10,minmax(0,1fr))!important;gap:clamp(7px,1vw,12px)!important;align-items:end!important;pointer-events:none!important}
        .tr-activityRta--10band .tr-activityRtaLabels span{min-width:0!important;color:#b9d1d9!important;font-size:8px!important;line-height:1!important;font-weight:950!important;text-align:center!important;white-space:nowrap!important}

        .tr-playerPreferenceStage{
          width:calc(100% - 20px)!important;margin:0 auto 7px!important;display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:8px!important;
        }
        .tr-playerPreferenceStage button{
          width:100%!important;height:38px!important;min-height:38px!important;min-width:0!important;padding:0!important;display:grid!important;place-items:center!important;
          border:1px solid rgba(135,177,193,.19)!important;border-radius:9px!important;background:linear-gradient(180deg,#0e1a21,#061015)!important;color:#eaf5f8!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.035)!important;
        }
        .tr-playerPreferenceStage button svg{width:19px!important;height:19px!important;fill:currentColor!important}.tr-playerPreferenceStage button:hover{border-color:rgba(91,209,246,.48)!important;background:#0b2631!important}
        .tr-playerPreferenceStage .tr-prefLike.is-liked{color:#fff!important;border-color:#41e394!important;background:linear-gradient(180deg,#169b63,#087649)!important;box-shadow:0 0 16px rgba(43,211,133,.20)!important}
        .tr-playerPreferenceStage .tr-prefLess.is-disliked{color:#fff!important;border-color:#ff5a67!important;background:linear-gradient(180deg,#c43340,#8e1721)!important;box-shadow:0 0 16px rgba(225,51,65,.18)!important}
        .tr-playerPreferenceStage .tr-prefDiscover.is-confirming{color:#fff7db!important;border-color:#ffc45b!important;background:linear-gradient(180deg,#a86812,#6d3e06)!important;box-shadow:0 0 16px rgba(239,161,48,.18)!important}

        .tr-playerUtilityRow{width:calc(100% - 20px)!important;max-width:none!important;margin:0 auto 9px!important;padding:0!important;grid-template-columns:minmax(190px,.75fr) minmax(310px,1.25fr)!important;gap:12px!important}
        .tr-discoverToast{margin:3px auto 7px!important}

        @media(max-width:650px){
          .tr-playerHero{grid-template-columns:112px minmax(0,1fr)!important;width:100%!important;min-height:112px!important}
          .tr-playerHero .tr-audioArtwork{width:112px!important;height:112px!important;min-width:112px!important;min-height:112px!important;max-width:112px!important;max-height:112px!important;aspect-ratio:1/1!important}
          .tr-playerHero .tr-audioIdentity{height:112px!important;min-height:112px!important;padding:12px 11px!important;justify-content:center!important}
          .tr-playerHero .tr-audioIdentity strong{font-size:clamp(18px,5.6vw,23px)!important;line-height:1.08!important;letter-spacing:-.025em!important;display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:2!important;overflow:hidden!important}
          .tr-playerHero .tr-audioIdentity small{margin-top:6px!important;font-size:11.5px!important;line-height:1.2!important;display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:1!important;overflow:hidden!important}
          .tr-audioDeck--pro7 .tr-audioTimeline{width:calc(100% - 12px)!important;margin:6px auto 4px!important;grid-template-columns:32px minmax(0,1fr) 32px!important;gap:5px!important;min-height:24px!important;font-size:8px!important}
          .tr-playerTransportStage{width:calc(100% - 12px)!important;margin:2px auto 4px!important;gap:5px!important}
          .tr-playerTransportStage .tr-audioTransportButton{height:43px!important;min-height:43px!important;border-radius:9px!important}
          .tr-playerTransportStage .tr-audioTransportFace svg{width:20px!important;height:20px!important}
          .tr-playerTransportStage .tr-audioTransportUnit{grid-template-rows:auto 11px!important;gap:3px!important}.tr-playerTransportStage .tr-audioTransportUnit>span{font-size:7.5px!important;letter-spacing:.03em!important}
          .tr-playerModeStage{width:calc(100% - 12px)!important;margin-bottom:5px!important;gap:6px!important}.tr-playerModeStage .tr-audioModeButton{min-width:92px!important;height:31px!important;min-height:31px!important;padding:0 10px!important;font-size:7.5px!important}.tr-playerModeStage .tr-audioModeButton svg{width:14px!important;height:14px!important}
          .tr-activityRta--10band{width:calc(100% - 12px)!important;height:78px!important;margin:0 auto 5px!important;border-radius:8px!important}
          .tr-activityRta--10band .tr-activityRtaLabels{left:6px!important;right:6px!important;gap:4px!important;bottom:3px!important}.tr-activityRta--10band .tr-activityRtaLabels span{font-size:6.8px!important;letter-spacing:-.015em!important}
          .tr-playerPreferenceStage{width:calc(100% - 12px)!important;margin-bottom:6px!important;gap:5px!important}.tr-playerPreferenceStage button{height:34px!important;min-height:34px!important;border-radius:8px!important}.tr-playerPreferenceStage button svg{width:17px!important;height:17px!important}
          .tr-playerUtilityRow{width:calc(100% - 12px)!important;margin:0 auto 8px!important;grid-template-columns:1fr!important;gap:6px!important}.tr-playerVolume{grid-template-columns:44px minmax(0,1fr) 34px!important;gap:6px!important}.tr-playerVolume>span{font-size:8px!important}.tr-playerVolume>strong{font-size:9px!important}.tr-playerSourceTools{grid-template-columns:minmax(0,1fr) 84px!important;gap:5px!important}.tr-playerSourceTools .tr-audioQueueSelector>span{font-size:8px!important}.tr-playerSourceTools .tr-audioQueueSelector select{height:34px!important;min-height:34px!important;font-size:9.5px!important}.tr-playerSourceTools .tr-audioEqToggle{width:84px!important;min-width:84px!important;max-width:84px!important;height:34px!important;min-height:34px!important;font-size:8.5px!important;padding:0 5px!important}
        }
        @media(max-width:380px){
          .tr-playerHero{grid-template-columns:102px minmax(0,1fr)!important;min-height:102px!important}.tr-playerHero .tr-audioArtwork{width:102px!important;height:102px!important;min-width:102px!important;min-height:102px!important;max-width:102px!important;max-height:102px!important}.tr-playerHero .tr-audioIdentity{height:102px!important;min-height:102px!important;padding:9px 8px!important}.tr-playerHero .tr-audioIdentity strong{font-size:17px!important}.tr-playerHero .tr-audioIdentity small{font-size:10.5px!important}
          .tr-playerTransportStage .tr-audioTransportButton{height:40px!important;min-height:40px!important}.tr-playerTransportStage .tr-audioTransportFace svg{width:18px!important;height:18px!important}.tr-playerTransportStage .tr-audioTransportUnit>span{font-size:7px!important}
        }

        /* AUG 9 REDISCOVER + RTA PREMIUM PASS */
        .tr-playerPreferenceStage button{display:flex!important;align-items:center!important;justify-content:center!important;gap:7px!important;padding:0 12px!important}
        .tr-playerPreferenceStage button svg{flex:0 0 auto!important}
        .tr-playerPreferenceStage button>span{display:block!important;min-width:0!important;color:inherit!important;font-size:10px!important;line-height:1!important;font-weight:950!important;letter-spacing:.025em!important;white-space:nowrap!important}
        .tr-activityRta--10band{background:radial-gradient(120% 90% at 50% 0%,rgba(42,112,132,.11),transparent 55%),#010507!important;border-color:rgba(108,199,226,.26)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.035),inset 0 -18px 26px rgba(0,0,0,.40),0 6px 18px rgba(0,0,0,.16)!important}
        @media(max-width:650px){
          .tr-playerPreferenceStage{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:5px 6px!important;align-items:center!important}
          .tr-playerPreferenceStage button{height:32px!important;min-height:32px!important;padding:0 9px!important;gap:5px!important}
          .tr-playerPreferenceStage button svg{width:15px!important;height:15px!important}
          .tr-playerPreferenceStage button>span{font-size:9px!important;letter-spacing:.01em!important}
          .tr-playerPreferenceStage .tr-prefDiscover{grid-column:1/-1!important;width:min(56%,180px)!important;justify-self:center!important}
        }


        /* AUG 9 REMAINING MUSIC FIXES: recommendation-card feedback controls */
        .tr-audioDeck--pro7 .tr-playerPreferenceStage.tr-trackPreference button{
          height:30px!important;min-height:30px!important;padding:0 9px!important;gap:6px!important;
          border:1px solid rgba(96,175,203,.17)!important;border-radius:8px!important;
          background:#08151b!important;color:#e8f6fa!important;
          box-shadow:none!important;text-shadow:none!important;
          font-size:7px!important;font-weight:1000!important;letter-spacing:0!important;
        }
        .tr-audioDeck--pro7 .tr-playerPreferenceStage.tr-trackPreference button svg{
          width:14px!important;height:14px!important;flex:0 0 14px!important;fill:currentColor!important;
        }
        .tr-audioDeck--pro7 .tr-playerPreferenceStage.tr-trackPreference button>span{
          display:inline-block!important;visibility:visible!important;color:inherit!important;
          font-size:7px!important;line-height:1!important;font-weight:1000!important;
          white-space:nowrap!important;overflow:visible!important;text-overflow:clip!important;
        }
        .tr-audioDeck--pro7 .tr-playerPreferenceStage.tr-trackPreference .tr-prefLike.is-liked{
          color:#fff!important;border-color:rgba(68,227,152,.66)!important;
          background:linear-gradient(180deg,#159b63,#087748)!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.13),0 0 13px rgba(35,207,126,.18)!important;
        }
        .tr-audioDeck--pro7 .tr-playerPreferenceStage.tr-trackPreference .tr-prefLess.is-disliked{
          color:#fff!important;border-color:rgba(255,93,105,.72)!important;
          background:linear-gradient(180deg,#c73541,#8f1822)!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 0 13px rgba(226,48,62,.16)!important;
        }
        .tr-audioDeck--pro7 .tr-playerPreferenceStage.tr-trackPreference .tr-prefDiscover.is-confirming{
          color:#1a1005!important;border-color:rgba(255,175,68,.66)!important;
          background:linear-gradient(180deg,#ef9d2e,#b8650e)!important;
          box-shadow:inset 0 1px rgba(255,255,255,.30),0 0 14px rgba(239,157,46,.20)!important;
        }
        @media(max-width:650px){
          .tr-audioDeck--pro7 .tr-playerPreferenceStage.tr-trackPreference{
            grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:5px 6px!important;
          }
          .tr-audioDeck--pro7 .tr-playerPreferenceStage.tr-trackPreference button{
            height:30px!important;min-height:30px!important;padding:0 7px!important;gap:5px!important;
          }
          .tr-audioDeck--pro7 .tr-playerPreferenceStage.tr-trackPreference button>span{
            display:inline-block!important;visibility:visible!important;font-size:7px!important;white-space:nowrap!important;
          }
          .tr-audioDeck--pro7 .tr-playerPreferenceStage.tr-trackPreference .tr-prefDiscover{
            grid-column:1/-1!important;width:min(54%,170px)!important;justify-self:center!important;
          }
        }

        /* AUG 14 V6 GPU AURORA CORE: seamless premium media stage + WebGL scene engine */
        .tr-audioDeck--pro7{
          position:relative!important;
          overflow:hidden!important;
          background:
            radial-gradient(120% 58% at 50% 0%,rgba(39,112,139,.065),transparent 68%),
            linear-gradient(180deg,#03090d 0%,#02070a 38%,#020609 100%)!important;
          border:1px solid rgba(83,177,208,.18)!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 20px 60px rgba(0,0,0,.34)!important;
        }
        .tr-playerHero{
          position:relative!important;
          isolation:isolate!important;
          overflow:hidden!important;
          border:0!important;
          border-bottom:0!important;
          background:transparent!important;
          box-shadow:none!important;
          margin:0!important;
        }
        .tr-playerHero::before{
          content:""!important;
          position:absolute!important;
          z-index:2!important;
          inset:0!important;
          pointer-events:none!important;
          background:
            linear-gradient(90deg,rgba(1,4,6,.10) 0%,rgba(1,4,6,.025) 30%,transparent 62%,rgba(1,4,6,.055) 100%),
            radial-gradient(80% 125% at 82% 50%,transparent 38%,rgba(0,0,0,.09) 100%)!important;
        }
        .tr-playerHero::after{
          content:""!important;
          position:absolute!important;
          z-index:3!important;
          left:0!important;right:0!important;bottom:-1px!important;height:42px!important;
          pointer-events:none!important;
          background:linear-gradient(180deg,transparent 0%,rgba(2,6,9,.28) 48%,#020609 100%)!important;
          box-shadow:none!important;
        }
        .tr-playerVisualEngine{
          position:absolute!important;
          z-index:0!important;
          inset:0!important;
          overflow:hidden!important;
          pointer-events:none!important;
          background:#020609!important;
        }
        .tr-playerVisualArtwork{
          position:absolute!important;
          z-index:0!important;
          left:6%!important;top:-44%!important;
          width:118%!important;height:188%!important;
          object-fit:cover!important;
          object-position:center!important;
          opacity:.30!important;
          filter:blur(62px) saturate(1.58) contrast(1.04) brightness(.64)!important;
          transform:scale(1.10)!important;
          transform-origin:center!important;
          animation:none!important;
        }
        .tr-audioDeck--pro7.is-playing .tr-playerVisualArtwork{opacity:.33!important}
        .tr-playerVisualEngine canvas{
          position:absolute!important;
          z-index:1!important;
          inset:0!important;
          width:100%!important;height:100%!important;
          display:block!important;
          opacity:1!important;
          mix-blend-mode:normal!important;
          filter:saturate(1.04) contrast(1.02)!important;
          transform:translateZ(0)!important;
        }
        .tr-playerVisualGlass{
          position:absolute!important;
          z-index:2!important;
          inset:0!important;
          pointer-events:none!important;
          background:
            linear-gradient(90deg,rgba(1,5,8,.10) 0%,rgba(1,5,8,.015) 25%,transparent 67%,rgba(0,3,5,.07) 100%),
            linear-gradient(180deg,rgba(255,255,255,.018) 0%,transparent 28%,rgba(0,0,0,.10) 100%)!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.018)!important;
        }
        .tr-playerHero .tr-audioArtwork{
          position:relative!important;
          z-index:5!important;
          box-shadow:none!important;
          border:0!important;
          outline:0!important;
        }
        .tr-playerHero .tr-audioArtwork::after{
          content:""!important;
          position:absolute!important;
          z-index:2!important;
          top:0!important;right:-1px!important;bottom:0!important;width:24px!important;
          pointer-events:none!important;
          background:linear-gradient(90deg,transparent,rgba(2,6,9,.16))!important;
        }
        .tr-playerHero .tr-audioIdentity{
          position:relative!important;
          z-index:5!important;
          background:transparent!important;
          border:0!important;
          box-shadow:none!important;
          text-shadow:0 3px 20px rgba(0,0,0,.96),0 1px 4px rgba(0,0,0,.90)!important;
        }
        .tr-playerHero .tr-audioIdentity:before{
          content:""!important;
          position:absolute!important;
          z-index:-1!important;
          inset:-18% -8% -18% -4%!important;
          pointer-events:none!important;
          background:radial-gradient(60% 70% at 18% 50%,rgba(0,0,0,.22),transparent 76%)!important;
          filter:blur(10px)!important;
        }
        .tr-audioDeck--pro7 .tr-audioTimeline{
          position:relative!important;
          z-index:6!important;
          margin-top:5px!important;
        }
        @media(max-width:650px){
          .tr-playerVisualArtwork{
            left:0!important;top:-34%!important;width:130%!important;height:168%!important;
            opacity:.29!important;filter:blur(38px) saturate(1.48) contrast(1.035) brightness(.62)!important;
          }
          .tr-audioDeck--pro7.is-playing .tr-playerVisualArtwork{opacity:.31!important}
          .tr-playerHero::after{height:30px!important}
          .tr-playerHero .tr-audioArtwork::after{width:16px!important}
        }
        @media(prefers-reduced-motion:reduce){.tr-playerVisualArtwork{animation:none!important}}


        /* AUG 14 V7: ONE SEAMLESS PLAYER + ARTWORK-OWNED COLOR + TOP-ONLY PREMIUM ACTIONS */
        .tr-audioDeck--pro7{
          padding:0!important;
          overflow:hidden!important;
          border-radius:16px!important;
          background:linear-gradient(180deg,#050b0f 0%,#020609 52%,#010405 100%)!important;
        }
        .tr-playerHero{
          position:relative!important;
          width:100%!important;
          margin:0!important;
          padding:0!important;
          display:grid!important;
          grid-template-columns:clamp(235px,30%,305px) minmax(0,1fr)!important;
          align-items:stretch!important;
          gap:0!important;
          overflow:hidden!important;
          border:0!important;
          border-radius:15px 15px 0 0!important;
          background:#020609!important;
          box-shadow:none!important;
        }
        .tr-playerHero::before{
          z-index:3!important;
          background:
            radial-gradient(75% 110% at 72% 48%,transparent 30%,rgba(0,0,0,.12) 100%),
            linear-gradient(90deg,rgba(0,0,0,.02),transparent 35%,rgba(0,0,0,.05))!important;
        }
        .tr-playerHero::after{
          z-index:4!important;
          left:0!important;right:0!important;bottom:-1px!important;height:28px!important;
          background:linear-gradient(180deg,transparent 0%,rgba(2,6,9,.14) 48%,#020609 100%)!important;
        }
        .tr-playerVisualEngine{inset:0!important;background:#020609!important}
        .tr-playerVisualArtwork{
          left:-16%!important;top:-58%!important;width:155%!important;height:216%!important;
          opacity:.19!important;
          filter:blur(96px) saturate(1.72) contrast(1.04) brightness(.78)!important;
          transform:scale(1.34)!important;
        }
        .tr-audioDeck--pro7.is-playing .tr-playerVisualArtwork{opacity:.21!important}
        .tr-playerVisualEngine canvas{filter:saturate(1.12) contrast(1.015)!important}
        .tr-playerVisualGlass{
          background:
            radial-gradient(60% 95% at 36% 48%,rgba(255,255,255,.016),transparent 70%),
            linear-gradient(90deg,rgba(0,0,0,.03),transparent 34%,rgba(0,0,0,.055))!important;
          box-shadow:none!important;
        }
        .tr-playerHero .tr-audioArtwork{
          position:relative!important;z-index:6!important;
          width:100%!important;height:auto!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;
          aspect-ratio:1/1!important;margin:0!important;padding:0!important;
          border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;overflow:hidden!important;
        }
        .tr-playerHero .tr-audioArtwork::after{display:none!important;content:none!important}
        .tr-playerHero .tr-audioArtworkImage{
          width:100%!important;height:100%!important;display:block!important;object-fit:cover!important;object-position:center!important;
          -webkit-mask-image:linear-gradient(90deg,#000 0%,#000 86%,rgba(0,0,0,.96) 91%,rgba(0,0,0,.78) 96%,rgba(0,0,0,.46) 100%)!important;
          mask-image:linear-gradient(90deg,#000 0%,#000 86%,rgba(0,0,0,.96) 91%,rgba(0,0,0,.78) 96%,rgba(0,0,0,.46) 100%)!important;
        }
        .tr-playerHero .tr-audioIdentity{
          position:relative!important;z-index:7!important;
          width:100%!important;max-width:none!important;min-width:0!important;height:100%!important;min-height:0!important;
          margin:0!important;padding:clamp(26px,3vw,40px) clamp(22px,3.4vw,48px)!important;
          display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:center!important;
          text-align:left!important;overflow:hidden!important;border:0!important;background:transparent!important;box-shadow:none!important;
          text-shadow:none!important;
        }
        .tr-playerHero .tr-audioIdentity:before{
          inset:2% -8% 2% -10%!important;
          background:radial-gradient(68% 88% at 12% 50%,rgba(0,0,0,.32),rgba(0,0,0,.12) 48%,transparent 78%)!important;
          filter:blur(18px)!important;
        }
        .tr-audioIdentityMain{
          position:relative;z-index:2;width:100%;min-width:0;margin:0;padding:0;
          display:block;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;
          font:inherit;appearance:none;-webkit-appearance:none;
        }
        .tr-playerHero .tr-audioIdentityMain strong,
        .tr-playerHero .tr-audioIdentity strong{
          display:block!important;width:100%!important;margin:0!important;padding:0!important;
          color:#fff!important;font-size:clamp(31px,4vw,52px)!important;line-height:1.03!important;font-weight:1000!important;letter-spacing:-.043em!important;
          white-space:normal!important;overflow:visible!important;text-overflow:clip!important;overflow-wrap:anywhere!important;
          text-shadow:0 3px 22px rgba(0,0,0,.88),0 1px 4px rgba(0,0,0,.92)!important;
        }
        .tr-playerHero .tr-audioIdentityMain small,
        .tr-playerHero .tr-audioIdentity small{
          display:block!important;width:100%!important;margin-top:10px!important;padding:0!important;
          color:#c7d9e0!important;font-size:clamp(15px,1.5vw,20px)!important;line-height:1.2!important;font-weight:850!important;
          white-space:normal!important;overflow:visible!important;text-overflow:clip!important;
          text-shadow:0 2px 12px rgba(0,0,0,.92)!important;
        }
        .tr-heroPreferenceStage{
          position:relative;z-index:3;
          width:min(520px,100%);margin-top:clamp(20px,2.4vw,30px);
          display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;
        }
        .tr-heroPrefButton{
          position:relative;isolation:isolate;overflow:hidden;
          height:42px;min-height:42px;min-width:0;padding:0 14px;
          display:flex;align-items:center;justify-content:center;gap:8px;
          border:1px solid rgba(190,219,230,.19);border-radius:11px;
          background:linear-gradient(180deg,rgba(25,39,47,.68),rgba(5,12,17,.72));
          color:#edf7fa;font-size:9px;font-weight:1000;letter-spacing:.045em;white-space:nowrap;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.065),inset 0 -1px 0 rgba(0,0,0,.46),0 7px 20px rgba(0,0,0,.22);
          backdrop-filter:blur(14px) saturate(1.12);-webkit-backdrop-filter:blur(14px) saturate(1.12);
          cursor:pointer;transition:transform .16s ease,border-color .18s ease,background .18s ease,box-shadow .18s ease,color .18s ease;
        }
        .tr-heroPrefButton::before{
          content:"";position:absolute;z-index:-1;left:12%;right:12%;top:0;height:1px;
          background:linear-gradient(90deg,transparent,rgba(213,244,255,.28),transparent);
        }
        .tr-heroPrefButton:hover:not(:disabled){
          transform:translateY(-1px);border-color:rgba(110,220,248,.42);
          background:linear-gradient(180deg,rgba(23,53,65,.78),rgba(5,20,27,.80));
          box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 9px 22px rgba(0,0,0,.25),0 0 18px rgba(70,204,239,.08);
        }
        .tr-heroPrefButton:active:not(:disabled){transform:translateY(0) scale(.985)}
        .tr-heroPrefButton:disabled{opacity:.42;cursor:default}
        .tr-heroPrefButton svg{width:16px;height:16px;flex:0 0 16px;fill:currentColor}
        .tr-heroPrefButton span{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis}
        .tr-heroPrefButton.tr-prefLike.is-liked{
          color:#effff7;border-color:rgba(78,231,161,.54);
          background:linear-gradient(180deg,rgba(19,125,82,.82),rgba(7,74,47,.84));
          box-shadow:inset 0 1px rgba(255,255,255,.12),0 0 0 1px rgba(75,229,158,.10),0 8px 22px rgba(0,0,0,.22),0 0 18px rgba(55,219,145,.14);
        }
        .tr-heroPrefButton.tr-prefLess.is-disliked{
          color:#fff4f4;border-color:rgba(255,104,111,.55);
          background:linear-gradient(180deg,rgba(151,45,52,.82),rgba(91,18,24,.86));
          box-shadow:inset 0 1px rgba(255,255,255,.10),0 8px 22px rgba(0,0,0,.22),0 0 18px rgba(236,67,79,.12);
        }
        .tr-heroPrefButton.tr-prefDiscover.is-confirming{
          color:#f5fdff;border-color:rgba(104,222,255,.58);
          background:linear-gradient(180deg,rgba(18,112,145,.84),rgba(6,62,84,.88));
          box-shadow:inset 0 1px rgba(255,255,255,.13),0 8px 22px rgba(0,0,0,.22),0 0 20px rgba(66,205,243,.14);
        }
        .tr-playerPreferenceStage{display:none!important}

        /* Desktop sizing: intentionally substantial without becoming oversized. */
        @media(min-width:1100px){
          .tr-playerHero{grid-template-columns:300px minmax(0,1fr)!important}
          .tr-playerHero .tr-audioIdentity{padding:34px 52px!important}
          .tr-heroPreferenceStage{width:min(540px,82%);gap:11px;margin-top:28px}
          .tr-heroPrefButton{height:44px;min-height:44px;font-size:9.5px}
        }
        @media(min-width:651px) and (max-width:900px){
          .tr-playerHero{grid-template-columns:230px minmax(0,1fr)!important}
          .tr-playerHero .tr-audioIdentity{padding:24px 26px!important}
          .tr-playerHero .tr-audioIdentityMain strong{font-size:clamp(27px,4.2vw,38px)!important}
          .tr-playerHero .tr-audioIdentityMain small{font-size:14px!important;margin-top:8px!important}
          .tr-heroPreferenceStage{margin-top:19px;gap:7px;width:100%}
          .tr-heroPrefButton{height:38px;min-height:38px;padding:0 9px;font-size:8px;gap:6px}
          .tr-heroPrefButton svg{width:14px;height:14px;flex-basis:14px}
        }

        /* Mobile: large enough to feel intentional, while keeping all three actions readable. */
        @media(max-width:650px){
          .tr-audioDeck--pro7{border-radius:13px!important}
          .tr-playerHero{
            grid-template-columns:116px minmax(0,1fr)!important;
            min-height:116px!important;
            border-radius:12px 12px 0 0!important;
          }
          .tr-playerHero .tr-audioArtwork{
            width:116px!important;height:116px!important;min-width:116px!important;min-height:116px!important;max-width:116px!important;max-height:116px!important;
          }
          .tr-playerHero .tr-audioArtworkImage{
            -webkit-mask-image:linear-gradient(90deg,#000 0%,#000 90%,rgba(0,0,0,.82) 96%,rgba(0,0,0,.56) 100%)!important;
            mask-image:linear-gradient(90deg,#000 0%,#000 90%,rgba(0,0,0,.82) 96%,rgba(0,0,0,.56) 100%)!important;
          }
          .tr-playerHero .tr-audioIdentity{
            height:116px!important;min-height:116px!important;padding:10px 10px 9px 13px!important;justify-content:center!important;
          }
          .tr-playerHero .tr-audioIdentityMain strong{font-size:clamp(19px,5.8vw,24px)!important;line-height:1.02!important;letter-spacing:-.03em!important}
          .tr-playerHero .tr-audioIdentityMain small{font-size:11.5px!important;margin-top:5px!important;line-height:1.15!important}
          .tr-heroPreferenceStage{width:100%;margin-top:10px;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
          .tr-heroPrefButton{height:32px;min-height:32px;padding:0 5px;border-radius:8px;gap:4px;font-size:7.2px;letter-spacing:0}
          .tr-heroPrefButton svg{width:13px;height:13px;flex:0 0 13px}
          .tr-playerVisualArtwork{left:-22%!important;top:-66%!important;width:176%!important;height:234%!important;opacity:.17!important;filter:blur(64px) saturate(1.68) brightness(.76)!important}
          .tr-audioDeck--pro7.is-playing .tr-playerVisualArtwork{opacity:.19!important}
          .tr-playerHero::after{height:20px!important}
        }
        @media(max-width:390px){
          .tr-playerHero{grid-template-columns:108px minmax(0,1fr)!important;min-height:108px!important}
          .tr-playerHero .tr-audioArtwork{width:108px!important;height:108px!important;min-width:108px!important;min-height:108px!important;max-width:108px!important;max-height:108px!important}
          .tr-playerHero .tr-audioIdentity{height:108px!important;min-height:108px!important;padding:8px 7px 7px 10px!important}
          .tr-playerHero .tr-audioIdentityMain strong{font-size:18px!important}
          .tr-playerHero .tr-audioIdentityMain small{font-size:10.5px!important;margin-top:4px!important}
          .tr-heroPreferenceStage{margin-top:8px;gap:3px}
          .tr-heroPrefButton{height:29px;min-height:29px;padding:0 3px;font-size:6.6px;gap:3px}
          .tr-heroPrefButton svg{width:12px;height:12px;flex-basis:12px}
        }


        /* AUG 14 V8 ULTRA: authoritative seamless media stage, album-owned color, fluid GPU motion */
        .tr-audioDeck--pro7{
          position:relative!important;
          padding:0!important;
          overflow:hidden!important;
          border:1px solid rgba(86,174,205,.18)!important;
          border-radius:17px!important;
          background:linear-gradient(180deg,#050b0f 0%,#020609 46%,#010405 100%)!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.028),0 18px 55px rgba(0,0,0,.30)!important;
        }
        .tr-playerHero{
          position:relative!important;
          isolation:isolate!important;
          width:100%!important;
          min-width:0!important;
          margin:0!important;
          padding:0!important;
          display:grid!important;
          grid-template-columns:clamp(240px,28%,290px) minmax(0,1fr)!important;
          align-items:stretch!important;
          gap:0!important;
          overflow:hidden!important;
          border:0!important;
          border-radius:0!important;
          background:transparent!important;
          box-shadow:none!important;
          text-align:left!important;
        }
        .tr-playerHero::before,.tr-playerHero::after{display:none!important;content:none!important;background:none!important;box-shadow:none!important}
        .tr-playerVisualEngine{
          position:absolute!important;z-index:0!important;inset:0!important;
          overflow:hidden!important;pointer-events:none!important;
          background:linear-gradient(180deg,#04090c 0%,#020609 100%)!important;
        }
        .tr-playerVisualArtwork{
          position:absolute!important;z-index:0!important;
          left:-14%!important;top:-40%!important;width:136%!important;height:184%!important;
          object-fit:cover!important;object-position:center!important;
          opacity:.50!important;
          filter:blur(82px) saturate(1.74) contrast(1.035) brightness(.72)!important;
          transform:scale(1.18)!important;transform-origin:center!important;
          animation:none!important;
        }
        .tr-audioDeck--pro7.is-playing .tr-playerVisualArtwork{opacity:.52!important}
        .tr-playerVisualEngine canvas{
          position:absolute!important;z-index:1!important;inset:0!important;
          width:100%!important;height:100%!important;display:block!important;
          opacity:.90!important;mix-blend-mode:normal!important;
          filter:saturate(1.10) contrast(1.015)!important;
          transform:translateZ(0)!important;will-change:contents!important;
        }
        .tr-playerVisualGlass{
          position:absolute!important;z-index:2!important;inset:0!important;pointer-events:none!important;
          background:
            radial-gradient(78% 125% at 84% 46%,transparent 30%,rgba(0,0,0,.10) 100%),
            linear-gradient(90deg,rgba(0,0,0,.015) 0%,transparent 46%,rgba(0,0,0,.035) 100%)!important;
          box-shadow:none!important;
        }
        .tr-playerHero .tr-audioArtwork{
          position:relative!important;z-index:6!important;
          width:calc(100% + 68px)!important;height:auto!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;
          aspect-ratio:1/1!important;margin:0 -68px 0 0!important;padding:0!important;
          border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;overflow:hidden!important;
        }
        .tr-playerHero .tr-audioArtwork::after{display:none!important;content:none!important}
        .tr-playerHero .tr-audioArtworkImage{
          display:block!important;width:100%!important;height:100%!important;object-fit:cover!important;object-position:center!important;
          -webkit-mask-image:linear-gradient(90deg,#000 0%,#000 76%,rgba(0,0,0,.98) 82%,rgba(0,0,0,.82) 89%,rgba(0,0,0,.48) 95%,transparent 100%)!important;
          mask-image:linear-gradient(90deg,#000 0%,#000 76%,rgba(0,0,0,.98) 82%,rgba(0,0,0,.82) 89%,rgba(0,0,0,.48) 95%,transparent 100%)!important;
        }
        .tr-playerHero .tr-audioIdentity{
          position:relative!important;z-index:7!important;
          width:100%!important;max-width:none!important;min-width:0!important;height:100%!important;min-height:0!important;
          margin:0!important;padding:clamp(28px,3.2vw,42px) clamp(26px,3.8vw,54px) clamp(26px,3vw,38px) clamp(54px,6vw,78px)!important;
          display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:center!important;
          text-align:left!important;overflow:hidden!important;border:0!important;background:transparent!important;box-shadow:none!important;text-shadow:none!important;
        }
        .tr-playerHero .tr-audioIdentity:before{
          content:""!important;display:block!important;position:absolute!important;z-index:-1!important;
          inset:6% -4% 6% -14%!important;pointer-events:none!important;
          background:radial-gradient(62% 86% at 20% 50%,rgba(0,0,0,.33),rgba(0,0,0,.12) 50%,transparent 80%)!important;
          filter:blur(22px)!important;
        }
        .tr-audioIdentityMain{width:100%!important;min-width:0!important;position:relative!important;z-index:2!important}
        .tr-playerHero .tr-audioIdentityMain strong{
          display:block!important;width:100%!important;margin:0!important;padding:0!important;
          color:#fff!important;font-size:clamp(30px,3.8vw,50px)!important;line-height:1.02!important;font-weight:1000!important;letter-spacing:-.043em!important;
          white-space:normal!important;overflow:visible!important;text-overflow:clip!important;overflow-wrap:anywhere!important;
          text-shadow:0 3px 22px rgba(0,0,0,.90),0 1px 4px rgba(0,0,0,.88)!important;
        }
        .tr-playerHero .tr-audioIdentityMain small{
          display:block!important;width:100%!important;margin-top:9px!important;padding:0!important;
          color:#d0e0e6!important;font-size:clamp(14px,1.45vw,19px)!important;line-height:1.18!important;font-weight:850!important;
          text-shadow:0 2px 12px rgba(0,0,0,.88)!important;
        }
        .tr-heroPreferenceStage{
          position:relative!important;z-index:3!important;width:auto!important;max-width:100%!important;margin-top:22px!important;
          display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:8px!important;flex-wrap:nowrap!important;
        }
        .tr-heroPrefButton{
          position:relative!important;isolation:isolate!important;overflow:hidden!important;
          width:auto!important;min-width:0!important;height:36px!important;min-height:36px!important;padding:0 14px!important;
          display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:7px!important;
          border:1px solid rgba(192,220,230,.18)!important;border-radius:11px!important;
          background:linear-gradient(180deg,rgba(26,39,47,.54),rgba(5,11,16,.62))!important;
          color:#edf7fa!important;font-size:8.5px!important;font-weight:1000!important;letter-spacing:.035em!important;white-space:nowrap!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.065),inset 0 -1px 0 rgba(0,0,0,.42),0 7px 18px rgba(0,0,0,.18)!important;
          backdrop-filter:blur(16px) saturate(1.12)!important;-webkit-backdrop-filter:blur(16px) saturate(1.12)!important;
          cursor:pointer!important;transition:transform .16s ease,border-color .18s ease,background .18s ease,box-shadow .18s ease,color .18s ease!important;
        }
        .tr-heroPrefButton:nth-child(1){min-width:92px!important}.tr-heroPrefButton:nth-child(2){min-width:112px!important}.tr-heroPrefButton:nth-child(3){min-width:126px!important}
        .tr-heroPrefButton::before{
          content:""!important;position:absolute!important;z-index:-1!important;left:10%!important;right:10%!important;top:0!important;height:1px!important;
          background:linear-gradient(90deg,transparent,rgba(218,245,255,.25),transparent)!important;
        }
        .tr-heroPrefButton:hover:not(:disabled){
          transform:translateY(-1px)!important;border-color:rgba(112,219,246,.40)!important;
          background:linear-gradient(180deg,rgba(25,55,67,.66),rgba(5,20,27,.70))!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 8px 20px rgba(0,0,0,.20),0 0 16px rgba(67,204,241,.07)!important;
        }
        .tr-heroPrefButton:active:not(:disabled){transform:translateY(0) scale(.985)!important}
        .tr-heroPrefButton:disabled{opacity:.40!important;cursor:default!important}
        .tr-heroPrefButton svg{width:15px!important;height:15px!important;flex:0 0 15px!important;fill:currentColor!important}
        .tr-heroPrefButton span{display:block!important;overflow:visible!important;text-overflow:clip!important}
        .tr-heroPrefButton.tr-prefLike.is-liked{color:#effff8!important;border-color:rgba(76,230,159,.54)!important;background:linear-gradient(180deg,rgba(18,118,78,.78),rgba(6,67,43,.82))!important;box-shadow:inset 0 1px rgba(255,255,255,.11),0 0 18px rgba(53,218,143,.12)!important}
        .tr-heroPrefButton.tr-prefLess.is-disliked{color:#fff5f5!important;border-color:rgba(255,103,111,.54)!important;background:linear-gradient(180deg,rgba(143,42,49,.78),rgba(82,16,22,.84))!important;box-shadow:inset 0 1px rgba(255,255,255,.10),0 0 18px rgba(234,65,77,.10)!important}
        .tr-heroPrefButton.tr-prefDiscover.is-confirming{color:#f5fdff!important;border-color:rgba(100,219,253,.56)!important;background:linear-gradient(180deg,rgba(17,105,137,.80),rgba(5,57,77,.85))!important;box-shadow:inset 0 1px rgba(255,255,255,.12),0 0 18px rgba(62,200,239,.11)!important}
        .tr-playerPreferenceStage{display:none!important}
        .tr-audioDeck--pro7 .tr-audioTimeline{
          position:relative!important;z-index:8!important;width:calc(100% - 24px)!important;max-width:none!important;
          margin:0 auto 6px!important;padding-top:10px!important;min-height:34px!important;
          background:transparent!important;border:0!important;box-shadow:none!important;
        }

        @media(min-width:1100px){
          .tr-playerHero{grid-template-columns:290px minmax(0,1fr)!important}
          .tr-playerHero .tr-audioIdentity{padding:36px 56px 34px 76px!important}
          .tr-heroPreferenceStage{margin-top:24px!important;gap:9px!important}
          .tr-heroPrefButton{height:38px!important;min-height:38px!important;font-size:9px!important}
        }
        @media(min-width:651px) and (max-width:900px){
          .tr-playerHero{grid-template-columns:235px minmax(0,1fr)!important}
          .tr-playerHero .tr-audioArtwork{width:calc(100% + 54px)!important;margin-right:-54px!important}
          .tr-playerHero .tr-audioIdentity{padding:24px 26px 22px 58px!important}
          .tr-playerHero .tr-audioIdentityMain strong{font-size:clamp(27px,4.2vw,38px)!important}
          .tr-playerHero .tr-audioIdentityMain small{font-size:14px!important;margin-top:7px!important}
          .tr-heroPreferenceStage{margin-top:18px!important;gap:6px!important}
          .tr-heroPrefButton{height:34px!important;min-height:34px!important;padding:0 10px!important;font-size:7.8px!important;gap:5px!important}
          .tr-heroPrefButton:nth-child(1){min-width:78px!important}.tr-heroPrefButton:nth-child(2){min-width:96px!important}.tr-heroPrefButton:nth-child(3){min-width:110px!important}
        }
        @media(max-width:650px){
          .tr-audioDeck--pro7{border-radius:14px!important}
          .tr-playerHero{grid-template-columns:128px minmax(0,1fr)!important;min-height:128px!important}
          .tr-playerHero .tr-audioArtwork{width:calc(128px + 34px)!important;height:128px!important;min-width:0!important;min-height:128px!important;max-width:none!important;max-height:128px!important;margin-right:-34px!important;aspect-ratio:auto!important}
          .tr-playerHero .tr-audioArtworkImage{
            -webkit-mask-image:linear-gradient(90deg,#000 0%,#000 75%,rgba(0,0,0,.96) 83%,rgba(0,0,0,.70) 92%,transparent 100%)!important;
            mask-image:linear-gradient(90deg,#000 0%,#000 75%,rgba(0,0,0,.96) 83%,rgba(0,0,0,.70) 92%,transparent 100%)!important;
          }
          .tr-playerHero .tr-audioIdentity{height:128px!important;min-height:128px!important;padding:10px 8px 9px 36px!important;justify-content:center!important}
          .tr-playerHero .tr-audioIdentityMain strong{font-size:clamp(18px,5.3vw,23px)!important;line-height:1.03!important;letter-spacing:-.03em!important}
          .tr-playerHero .tr-audioIdentityMain small{font-size:11px!important;margin-top:5px!important;line-height:1.12!important}
          .tr-heroPreferenceStage{width:100%!important;margin-top:10px!important;gap:4px!important;display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important}
          .tr-heroPrefButton{width:100%!important;min-width:0!important;height:31px!important;min-height:31px!important;padding:0 4px!important;border-radius:8px!important;gap:3px!important;font-size:7px!important;letter-spacing:0!important}
          .tr-heroPrefButton:nth-child(n){min-width:0!important}
          .tr-heroPrefButton svg{width:12px!important;height:12px!important;flex-basis:12px!important}
          .tr-playerVisualArtwork{left:-20%!important;top:-46%!important;width:150%!important;height:194%!important;opacity:.48!important;filter:blur(54px) saturate(1.70) brightness(.72)!important}
          .tr-audioDeck--pro7.is-playing .tr-playerVisualArtwork{opacity:.50!important}
          .tr-audioDeck--pro7 .tr-audioTimeline{width:calc(100% - 14px)!important;padding-top:8px!important}
        }
        @media(max-width:390px){
          .tr-playerHero{grid-template-columns:118px minmax(0,1fr)!important;min-height:118px!important}
          .tr-playerHero .tr-audioArtwork{width:calc(118px + 30px)!important;height:118px!important;min-height:118px!important;max-height:118px!important;margin-right:-30px!important}
          .tr-playerHero .tr-audioIdentity{height:118px!important;min-height:118px!important;padding:8px 6px 7px 31px!important}
          .tr-playerHero .tr-audioIdentityMain strong{font-size:17.5px!important}
          .tr-playerHero .tr-audioIdentityMain small{font-size:10.2px!important;margin-top:4px!important}
          .tr-heroPreferenceStage{margin-top:8px!important;gap:3px!important}
          .tr-heroPrefButton{height:28px!important;min-height:28px!important;padding:0 2px!important;font-size:6.3px!important;gap:2px!important}
          .tr-heroPrefButton svg{width:11px!important;height:11px!important;flex-basis:11px!important}
        }
        @media(prefers-reduced-motion:reduce){.tr-playerVisualArtwork{animation:none!important}}


        /* AUG 14 V9 HERO POLISH: stronger album-owned visuals + centered premium media controls */
        .tr-playerVisualArtwork{
          opacity:.36!important;
          filter:blur(78px) saturate(1.92) contrast(1.05) brightness(.76)!important;
        }
        .tr-audioDeck--pro7.is-playing .tr-playerVisualArtwork{opacity:.38!important}
        .tr-playerVisualEngine canvas{
          opacity:.99!important;
          filter:saturate(1.24) contrast(1.065) brightness(1.08)!important;
        }
        .tr-playerVisualGlass{
          background:
            radial-gradient(82% 130% at 84% 46%,transparent 34%,rgba(0,0,0,.055) 100%),
            linear-gradient(90deg,rgba(0,0,0,.008) 0%,transparent 50%,rgba(0,0,0,.018) 100%)!important;
        }
        .tr-playerHero .tr-audioIdentity{
          padding:clamp(28px,3.1vw,42px) clamp(28px,3.4vw,50px) clamp(28px,3vw,40px) clamp(46px,5vw,64px)!important;
          align-items:center!important;
          justify-content:center!important;
          text-align:center!important;
        }
        .tr-playerHero .tr-audioIdentity:before{
          inset:4% 2% 4% -10%!important;
          background:radial-gradient(66% 86% at 48% 50%,rgba(0,0,0,.20),rgba(0,0,0,.075) 52%,transparent 82%)!important;
          filter:blur(25px)!important;
        }
        .tr-audioIdentityMain{
          width:100%!important;
          display:flex!important;
          flex-direction:column!important;
          align-items:center!important;
          justify-content:center!important;
          text-align:center!important;
          border:0!important;
          background:transparent!important;
          padding:0!important;
          color:inherit!important;
          cursor:pointer!important;
        }
        .tr-playerHero .tr-audioIdentityMain strong{
          width:100%!important;
          max-width:760px!important;
          margin-inline:auto!important;
          text-align:center!important;
          font-size:clamp(38px,4.6vw,58px)!important;
          line-height:1.00!important;
          letter-spacing:-.046em!important;
          text-wrap:balance!important;
          text-shadow:0 4px 24px rgba(0,0,0,.84),0 1px 5px rgba(0,0,0,.88)!important;
        }
        .tr-playerHero .tr-audioIdentityMain small{
          width:100%!important;
          margin-top:11px!important;
          text-align:center!important;
          color:#d9e8ed!important;
          font-size:clamp(17px,1.7vw,22px)!important;
          line-height:1.14!important;
          font-weight:900!important;
          text-shadow:0 2px 14px rgba(0,0,0,.82)!important;
        }
        .tr-heroPreferenceStage{
          width:auto!important;
          max-width:100%!important;
          margin-top:26px!important;
          display:flex!important;
          align-items:center!important;
          justify-content:center!important;
          gap:11px!important;
          flex-wrap:nowrap!important;
        }
        .tr-heroPrefButton{
          height:44px!important;
          min-height:44px!important;
          padding:0 18px!important;
          gap:8px!important;
          border:1px solid rgba(206,235,244,.23)!important;
          border-radius:14px!important;
          background:
            linear-gradient(180deg,rgba(47,62,71,.72) 0%,rgba(18,29,36,.61) 47%,rgba(5,12,17,.76) 100%)!important;
          color:#f3fbfd!important;
          font-size:10px!important;
          font-weight:1000!important;
          letter-spacing:.025em!important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.13),
            inset 0 -1px 0 rgba(0,0,0,.60),
            0 10px 24px rgba(0,0,0,.25),
            0 0 0 1px rgba(255,255,255,.012)!important;
          backdrop-filter:blur(22px) saturate(1.24)!important;
          -webkit-backdrop-filter:blur(22px) saturate(1.24)!important;
        }
        .tr-heroPrefButton:nth-child(1){min-width:108px!important}
        .tr-heroPrefButton:nth-child(2){min-width:132px!important}
        .tr-heroPrefButton:nth-child(3){min-width:148px!important}
        .tr-heroPrefButton::before{
          left:12%!important;right:12%!important;height:1px!important;
          background:linear-gradient(90deg,transparent,rgba(232,250,255,.48),transparent)!important;
        }
        .tr-heroPrefButton::after{
          content:""!important;
          position:absolute!important;
          z-index:-1!important;
          left:18%!important;right:18%!important;bottom:-28%!important;height:58%!important;
          border-radius:50%!important;
          background:radial-gradient(ellipse,rgba(92,210,244,.095),transparent 70%)!important;
          filter:blur(7px)!important;
          pointer-events:none!important;
        }
        .tr-heroPrefButton svg{width:17px!important;height:17px!important;flex:0 0 17px!important}
        .tr-heroPrefButton:hover:not(:disabled){
          transform:translateY(-1px)!important;
          border-color:rgba(126,224,249,.50)!important;
          background:linear-gradient(180deg,rgba(43,76,89,.78),rgba(11,36,46,.70) 54%,rgba(4,17,23,.80))!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 11px 26px rgba(0,0,0,.27),0 0 20px rgba(67,204,241,.09)!important;
        }
        .tr-heroPrefButton.tr-prefLike.is-liked{
          color:#f2fff8!important;
          border-color:rgba(77,227,158,.60)!important;
          background:linear-gradient(180deg,rgba(19,126,82,.86),rgba(7,74,47,.88))!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 10px 22px rgba(0,0,0,.22),0 0 20px rgba(48,218,139,.15)!important;
        }
        .tr-heroPrefButton.tr-prefLess.is-disliked{
          color:#fff7f7!important;
          border-color:rgba(226,91,103,.60)!important;
          background:linear-gradient(180deg,rgba(126,34,44,.88),rgba(67,13,22,.90))!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.13),0 10px 22px rgba(0,0,0,.22),0 0 18px rgba(205,57,72,.13)!important;
        }
        .tr-heroPrefButton.tr-prefDiscover.is-confirming{
          color:#f4fdff!important;
          border-color:rgba(103,219,249,.64)!important;
          background:linear-gradient(180deg,rgba(17,112,145,.88),rgba(5,64,84,.90))!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.15),0 10px 22px rgba(0,0,0,.22),0 0 20px rgba(64,199,235,.14)!important;
        }

        @media(min-width:1100px){
          .tr-playerHero .tr-audioIdentity{padding:34px 50px 34px 62px!important}
          .tr-playerHero .tr-audioIdentityMain strong{font-size:58px!important}
          .tr-playerHero .tr-audioIdentityMain small{font-size:21px!important}
          .tr-heroPreferenceStage{margin-top:28px!important;gap:12px!important}
          .tr-heroPrefButton{height:46px!important;min-height:46px!important;font-size:10.5px!important}
        }
        @media(min-width:651px) and (max-width:900px){
          .tr-playerHero .tr-audioIdentity{padding:22px 20px 22px 48px!important}
          .tr-playerHero .tr-audioIdentityMain strong{font-size:clamp(34px,5vw,44px)!important}
          .tr-playerHero .tr-audioIdentityMain small{font-size:16px!important;margin-top:8px!important}
          .tr-heroPreferenceStage{margin-top:21px!important;gap:7px!important}
          .tr-heroPrefButton{height:39px!important;min-height:39px!important;padding:0 12px!important;font-size:8.6px!important;gap:6px!important}
          .tr-heroPrefButton:nth-child(1){min-width:88px!important}.tr-heroPrefButton:nth-child(2){min-width:106px!important}.tr-heroPrefButton:nth-child(3){min-width:120px!important}
          .tr-heroPrefButton svg{width:15px!important;height:15px!important;flex-basis:15px!important}
        }
        @media(max-width:650px){
          .tr-playerHero{grid-template-columns:148px minmax(0,1fr)!important;min-height:148px!important}
          .tr-playerHero .tr-audioArtwork{width:calc(148px + 38px)!important;height:148px!important;min-height:148px!important;max-height:148px!important;margin-right:-38px!important}
          .tr-playerHero .tr-audioIdentity{height:148px!important;min-height:148px!important;padding:10px 8px 9px 25px!important;align-items:center!important;text-align:center!important}
          .tr-playerHero .tr-audioIdentityMain strong{font-size:clamp(22px,6.5vw,29px)!important;line-height:1.00!important;letter-spacing:-.034em!important}
          .tr-playerHero .tr-audioIdentityMain small{font-size:13.5px!important;margin-top:6px!important;line-height:1.10!important}
          .tr-heroPreferenceStage{width:100%!important;margin-top:14px!important;gap:5px!important;display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important}
          .tr-heroPrefButton,.tr-heroPrefButton:nth-child(n){width:100%!important;min-width:0!important;height:35px!important;min-height:35px!important;padding:0 5px!important;border-radius:10px!important;gap:4px!important;font-size:7.6px!important;letter-spacing:0!important}
          .tr-heroPrefButton svg{width:13.5px!important;height:13.5px!important;flex:0 0 13.5px!important}
          .tr-playerVisualArtwork{opacity:.35!important;filter:blur(52px) saturate(1.88) brightness(.76)!important}
          .tr-audioDeck--pro7.is-playing .tr-playerVisualArtwork{opacity:.37!important}
          .tr-playerVisualEngine canvas{filter:saturate(1.22) contrast(1.06) brightness(1.08)!important}
        }
        @media(max-width:390px){
          .tr-playerHero{grid-template-columns:136px minmax(0,1fr)!important;min-height:136px!important}
          .tr-playerHero .tr-audioArtwork{width:calc(136px + 34px)!important;height:136px!important;min-height:136px!important;max-height:136px!important;margin-right:-34px!important}
          .tr-playerHero .tr-audioIdentity{height:136px!important;min-height:136px!important;padding:8px 5px 7px 22px!important}
          .tr-playerHero .tr-audioIdentityMain strong{font-size:22px!important;line-height:1.0!important}
          .tr-playerHero .tr-audioIdentityMain small{font-size:12.5px!important;margin-top:5px!important}
          .tr-heroPreferenceStage{margin-top:11px!important;gap:4px!important}
          .tr-heroPrefButton,.tr-heroPrefButton:nth-child(n){height:33px!important;min-height:33px!important;padding:0 3px!important;font-size:7.4px!important;gap:3px!important}
          .tr-heroPrefButton svg{width:12.5px!important;height:12.5px!important;flex-basis:12.5px!important}
        }


        /* AUG 14 V10 ULTRA VISUAL + MOBILE CONTROL LOCK
           Authoritative final hero rules. Keeps the seamless shell from V9. */
        .tr-playerVisualArtwork{
          opacity:.22!important;
          filter:blur(88px) saturate(2.08) contrast(1.05) brightness(.72)!important;
        }
        .tr-audioDeck--pro7.is-playing .tr-playerVisualArtwork{opacity:.24!important}
        .tr-playerVisualEngine canvas{
          opacity:1!important;
          filter:saturate(1.38) contrast(1.12) brightness(1.20)!important;
        }
        .tr-playerVisualGlass{
          background:
            radial-gradient(55% 74% at 52% 48%,rgba(0,0,0,.02),rgba(0,0,0,.06) 68%,rgba(0,0,0,.11) 100%),
            linear-gradient(90deg,rgba(0,0,0,.005),transparent 58%,rgba(0,0,0,.018))!important;
        }
        .tr-playerHero .tr-audioIdentity:before{
          inset:10% 5% 10% 0!important;
          background:radial-gradient(62% 78% at 50% 48%,rgba(0,0,0,.24),rgba(0,0,0,.085) 54%,transparent 82%)!important;
          filter:blur(28px)!important;
        }
        .tr-playerHero .tr-audioIdentityMain strong{
          font-size:var(--tr-hero-title-size,clamp(42px,4.9vw,62px))!important;
          line-height:.98!important;
          letter-spacing:-.048em!important;
        }
        .tr-playerHero .tr-audioIdentityMain small{
          margin-top:12px!important;
          font-size:clamp(18px,1.8vw,23px)!important;
          line-height:1.12!important;
        }
        .tr-heroPreferenceStage{
          margin-top:25px!important;
          gap:10px!important;
        }
        .tr-heroPrefButton{
          position:relative!important;
          isolation:isolate!important;
          overflow:visible!important;
          height:46px!important;
          min-height:46px!important;
          padding:0 18px!important;
          border:1px solid rgba(208,239,248,.30)!important;
          border-radius:13px!important;
          background:
            linear-gradient(180deg,rgba(51,68,78,.74) 0%,rgba(22,34,42,.70) 50%,rgba(7,15,20,.84) 100%)!important;
          color:#f5fbfd!important;
          font-size:10.5px!important;
          font-weight:1000!important;
          letter-spacing:.02em!important;
          white-space:nowrap!important;
          text-overflow:clip!important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.16),
            inset 0 -1px 0 rgba(0,0,0,.70),
            0 10px 24px rgba(0,0,0,.30),
            0 0 0 1px rgba(255,255,255,.015)!important;
          backdrop-filter:blur(24px) saturate(1.34)!important;
          -webkit-backdrop-filter:blur(24px) saturate(1.34)!important;
        }
        .tr-heroPrefButton>span{
          display:block!important;
          flex:0 0 auto!important;
          min-width:max-content!important;
          max-width:none!important;
          overflow:visible!important;
          white-space:nowrap!important;
          text-overflow:clip!important;
        }
        .tr-heroPrefButton svg{width:17px!important;height:17px!important;flex:0 0 17px!important}
        .tr-heroPrefButton:nth-child(1){min-width:110px!important}
        .tr-heroPrefButton:nth-child(2){min-width:132px!important}
        .tr-heroPrefButton:nth-child(3){min-width:150px!important}
        .tr-heroPrefButton:before{
          content:""!important;
          position:absolute!important;
          left:14%!important;right:14%!important;top:0!important;height:1px!important;
          background:linear-gradient(90deg,transparent,rgba(240,252,255,.62),transparent)!important;
          opacity:.78!important;
          pointer-events:none!important;
        }
        .tr-heroPrefButton:after{
          content:""!important;
          position:absolute!important;
          z-index:-1!important;
          left:14%!important;right:14%!important;bottom:-9px!important;height:18px!important;
          border-radius:50%!important;
          background:radial-gradient(ellipse,rgba(80,210,245,.14),transparent 72%)!important;
          filter:blur(7px)!important;
          pointer-events:none!important;
        }
        .tr-heroPrefButton.tr-prefLike.is-liked{
          color:#effff7!important;
          border-color:rgba(73,229,156,.66)!important;
          background:linear-gradient(180deg,rgba(15,118,75,.84),rgba(6,59,39,.90))!important;
          box-shadow:inset 0 1px rgba(255,255,255,.15),0 10px 24px rgba(0,0,0,.27),0 0 20px rgba(54,219,142,.17)!important;
        }
        .tr-heroPrefButton.tr-prefLess.is-disliked{
          color:#fff6f7!important;
          border-color:rgba(233,93,105,.66)!important;
          background:linear-gradient(180deg,rgba(126,31,42,.88),rgba(61,12,20,.92))!important;
        }
        .tr-heroPrefButton.tr-prefDiscover.is-confirming{
          color:#f2fcff!important;
          border-color:rgba(87,216,249,.70)!important;
          background:linear-gradient(180deg,rgba(11,111,145,.88),rgba(4,55,75,.92))!important;
        }

        @media(min-width:1100px){
          .tr-playerHero .tr-audioIdentity{padding:34px 48px 34px 64px!important}
          .tr-playerHero .tr-audioIdentityMain strong{font-size:var(--tr-hero-title-size,62px)!important}
          .tr-playerHero .tr-audioIdentityMain small{font-size:22px!important}
          .tr-heroPreferenceStage{margin-top:28px!important;gap:12px!important}
          .tr-heroPrefButton{height:48px!important;min-height:48px!important;font-size:11px!important}
        }

        @media(min-width:651px) and (max-width:900px){
          .tr-playerHero .tr-audioIdentity{padding:22px 20px 22px 48px!important}
          .tr-playerHero .tr-audioIdentityMain strong{font-size:var(--tr-hero-title-size,clamp(34px,5.2vw,46px))!important}
          .tr-playerHero .tr-audioIdentityMain small{font-size:16.5px!important}
          .tr-heroPreferenceStage{margin-top:20px!important;gap:7px!important}
          .tr-heroPrefButton{height:40px!important;min-height:40px!important;padding:0 12px!important;font-size:8.8px!important;gap:6px!important}
          .tr-heroPrefButton:nth-child(1){min-width:90px!important}
          .tr-heroPrefButton:nth-child(2){min-width:108px!important}
          .tr-heroPrefButton:nth-child(3){min-width:124px!important}
          .tr-heroPrefButton svg{width:15px!important;height:15px!important;flex-basis:15px!important}
        }

        @media(max-width:650px){
          /* V11 mobile: more room for metadata, flexible height, and full action labels at every supported width. */
          .tr-playerHero{grid-template-columns:40% minmax(0,1fr)!important;min-height:216px!important;align-items:stretch!important}
          .tr-playerHero .tr-audioArtwork{
            width:calc(100% + 22px)!important;height:100%!important;min-height:216px!important;max-height:none!important;
            margin-right:-22px!important;aspect-ratio:auto!important;align-self:stretch!important;
          }
          .tr-playerHero .tr-audioArtworkImage{object-fit:cover!important;object-position:center!important}
          .tr-playerHero .tr-audioIdentity{
            height:auto!important;min-height:216px!important;
            padding:14px 10px 13px 22px!important;
            align-items:center!important;justify-content:center!important;text-align:center!important;overflow:visible!important;
          }
          .tr-playerHero .tr-audioIdentity:before{
            inset:4% 0 4% -8%!important;
            background:radial-gradient(76% 86% at 52% 48%,rgba(0,0,0,.25),rgba(0,0,0,.075) 60%,transparent 86%)!important;
          }
          .tr-playerHero .tr-audioIdentityMain{
            width:100%!important;min-width:0!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;
          }
          .tr-playerHero .tr-audioIdentityMain strong{
            width:100%!important;max-width:100%!important;
            font-size:var(--tr-hero-title-size,clamp(21px,6.2vw,28px))!important;
            line-height:1.04!important;letter-spacing:-.034em!important;
            white-space:normal!important;overflow:visible!important;text-overflow:clip!important;
            overflow-wrap:anywhere!important;word-break:normal!important;
          }
          .tr-playerHero .tr-audioIdentityMain small{
            width:100%!important;margin-top:6px!important;font-size:14px!important;line-height:1.12!important;
            white-space:normal!important;overflow:visible!important;text-overflow:clip!important;
          }
          .tr-heroPreferenceStage{
            width:100%!important;max-width:270px!important;margin-top:13px!important;
            display:grid!important;grid-template-columns:minmax(max-content,1fr) minmax(max-content,1.18fr)!important;
            gap:7px!important;align-items:center!important;justify-content:center!important;
          }
          .tr-heroPrefButton,.tr-heroPrefButton:nth-child(n){
            width:100%!important;min-width:max-content!important;max-width:none!important;
            height:41px!important;min-height:41px!important;
            padding:0 10px!important;gap:6px!important;border-radius:11px!important;
            font-size:10.6px!important;letter-spacing:0!important;line-height:1!important;
            white-space:nowrap!important;overflow:visible!important;text-overflow:clip!important;
          }
          .tr-heroPrefButton:nth-child(3){
            grid-column:1/-1!important;
            width:max-content!important;min-width:142px!important;justify-self:center!important;
          }
          .tr-heroPrefButton>span{
            display:block!important;min-width:max-content!important;max-width:none!important;
            overflow:visible!important;white-space:nowrap!important;text-overflow:clip!important;
          }
          .tr-heroPrefButton svg{width:16px!important;height:16px!important;flex:0 0 16px!important}
          .tr-playerVisualArtwork{opacity:.18!important;filter:blur(54px) saturate(2.08) brightness(.76)!important}
          .tr-audioDeck--pro7.is-playing .tr-playerVisualArtwork{opacity:.20!important}
          .tr-playerVisualEngine canvas{filter:saturate(1.46) contrast(1.15) brightness(1.25)!important}
        }

        @media(max-width:390px){
          .tr-playerHero{grid-template-columns:38% minmax(0,1fr)!important;min-height:218px!important}
          .tr-playerHero .tr-audioArtwork{min-height:218px!important}
          .tr-playerHero .tr-audioIdentity{min-height:218px!important;padding:12px 7px 11px 18px!important}
          .tr-playerHero .tr-audioIdentityMain strong{font-size:var(--tr-hero-title-size,clamp(18px,5.8vw,24px))!important;line-height:1.05!important}
          .tr-playerHero .tr-audioIdentityMain small{font-size:13px!important;margin-top:5px!important;line-height:1.12!important}
          .tr-heroPreferenceStage{max-width:244px!important;gap:6px!important;margin-top:11px!important;grid-template-columns:minmax(max-content,1fr) minmax(max-content,1.16fr)!important}
          .tr-heroPrefButton,.tr-heroPrefButton:nth-child(n){height:39px!important;min-height:39px!important;padding:0 8px!important;font-size:10px!important;gap:5px!important}
          .tr-heroPrefButton:nth-child(3){min-width:136px!important;width:max-content!important}
          .tr-heroPrefButton svg{width:15px!important;height:15px!important;flex-basis:15px!important}
        }

        @media(max-width:350px){
          .tr-playerHero{grid-template-columns:36% minmax(0,1fr)!important;min-height:246px!important}
          .tr-playerHero .tr-audioArtwork{min-height:246px!important}
          .tr-playerHero .tr-audioIdentity{min-height:246px!important;padding:11px 6px 11px 16px!important}
          .tr-playerHero .tr-audioIdentityMain strong{font-size:var(--tr-hero-title-size,20px)!important}
          .tr-playerHero .tr-audioIdentityMain small{font-size:12.5px!important}
          .tr-heroPreferenceStage{width:100%!important;max-width:154px!important;grid-template-columns:1fr!important;gap:5px!important;margin-top:10px!important}
          .tr-heroPrefButton,.tr-heroPrefButton:nth-child(n){grid-column:1!important;width:100%!important;min-width:0!important;height:37px!important;min-height:37px!important;padding:0 9px!important;font-size:10px!important}
          .tr-heroPrefButton:nth-child(3){width:100%!important;min-width:0!important}
        }


        /* V12 AUDIO FIDELITY OUTPUT PROFILES */
        .tr-outputProfilePanel{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(190px,250px)!important;gap:14px 18px!important;align-items:center!important;margin:0 0 14px!important;padding:14px 16px!important;border:1px solid rgba(88,193,226,.18)!important;border-radius:11px!important;background:linear-gradient(135deg,rgba(6,24,32,.94),rgba(3,11,16,.97))!important;box-shadow:inset 0 1px rgba(255,255,255,.035),0 10px 30px rgba(0,0,0,.20)!important}
        .tr-outputProfileIntro{min-width:0!important}.tr-outputProfileIntro small{display:block!important;margin-bottom:4px!important;color:#65d8fa!important;font-size:7px!important;font-weight:1000!important;letter-spacing:.12em!important}.tr-outputProfileIntro strong{display:block!important;color:#f4fbfe!important;font-size:16px!important;line-height:1.1!important;font-weight:1000!important}.tr-outputProfileIntro p{margin:5px 0 0!important;max-width:720px!important;color:#8ba6b1!important;font-size:9px!important;line-height:1.4!important;font-weight:700!important}
        .tr-outputProfileSelect{display:grid!important;gap:5px!important;min-width:0!important}.tr-outputProfileSelect span{color:#7998a4!important;font-size:7px!important;font-weight:1000!important;letter-spacing:.09em!important}.tr-outputProfileSelect select{width:100%!important;height:38px!important;padding:0 11px!important;border:1px solid rgba(86,196,232,.27)!important;border-radius:8px!important;background:#06151c!important;color:#eefbff!important;font-size:10px!important;font-weight:900!important;outline:none!important}.tr-outputProfileSelect select:focus{border-color:rgba(84,218,255,.66)!important;box-shadow:0 0 0 2px rgba(62,197,237,.10)!important}
        .tr-outputProfileTelemetry{grid-column:1/-1!important;display:flex!important;gap:6px!important;align-items:center!important;flex-wrap:wrap!important}.tr-outputProfileTelemetry>span{display:inline-flex!important;align-items:center!important;gap:5px!important;min-height:25px!important;padding:0 8px!important;border:1px solid rgba(93,164,189,.14)!important;border-radius:6px!important;background:rgba(1,8,12,.55)!important;color:#7996a1!important;font-size:6.5px!important;font-weight:950!important;letter-spacing:.055em!important;white-space:nowrap!important}.tr-outputProfileTelemetry>span:first-child{color:#eafaff!important;border-color:rgba(73,204,244,.34)!important;background:rgba(10,77,98,.22)!important}.tr-outputProfileTelemetry>span.is-car{color:#9ff1ff!important;border-color:rgba(71,215,251,.48)!important;box-shadow:inset 0 0 14px rgba(27,159,197,.09)!important}.tr-outputProfileTelemetry b{color:#dcecf2!important;font-weight:1000!important}
        .tr-headphoneProcessor.is-disabled{opacity:.48!important;filter:saturate(.55)!important}.tr-headphoneProcessor.is-disabled:before{content:"HEADPHONE PROCESSING BYPASSED"!important;display:block!important;margin:0 0 10px!important;padding:7px 9px!important;border:1px solid rgba(85,173,204,.13)!important;border-radius:7px!important;background:rgba(1,8,12,.48)!important;color:#7e9ba6!important;font-size:7px!important;font-weight:1000!important;letter-spacing:.09em!important}.tr-headphoneProcessor header>div>small{display:block!important;margin-top:4px!important;color:#718b95!important;font-size:7px!important;font-weight:750!important}
        .tr-audioEqPanel select:disabled,.tr-audioEqPanel input:disabled,.tr-audioEqPanel button:disabled{cursor:not-allowed!important;opacity:.50!important}
        @media(max-width:650px){.tr-outputProfilePanel{grid-template-columns:1fr!important;gap:10px!important;padding:12px!important}.tr-outputProfileTelemetry{grid-column:1!important;gap:5px!important}.tr-outputProfileTelemetry>span{font-size:6px!important;padding:0 6px!important}.tr-outputProfileIntro strong{font-size:14px!important}.tr-outputProfileIntro p{font-size:8.5px!important}.tr-outputProfileSelect select{height:40px!important;font-size:11px!important}}

        /* V13.5 MOBILE ARTWORK SAFETY
           Keep the complete album cover visible. The hero can grow around the
           square cover, but the cover itself is never stretched or cropped. */
        @media(max-width:650px){
          .tr-playerHero{
            align-items:center!important;
          }
          .tr-playerHero .tr-audioArtwork{
            width:calc(100% + 22px)!important;
            height:auto!important;
            min-height:0!important;
            max-height:none!important;
            aspect-ratio:1 / 1!important;
            align-self:center!important;
            margin-right:-22px!important;
            overflow:hidden!important;
            background:#05080b!important;
          }
          .tr-playerHero .tr-audioArtworkImage{
            width:100%!important;
            height:100%!important;
            object-fit:contain!important;
            object-position:center center!important;
            background:#05080b!important;
          }
        }
        @media(max-width:390px){
          .tr-playerHero .tr-audioArtwork{
            width:calc(100% + 18px)!important;
            height:auto!important;
            min-height:0!important;
            max-height:none!important;
            aspect-ratio:1 / 1!important;
            margin-right:-18px!important;
          }
        }
        @media(max-width:350px){
          .tr-playerHero .tr-audioArtwork{
            width:calc(100% + 14px)!important;
            height:auto!important;
            min-height:0!important;
            max-height:none!important;
            aspect-ratio:1 / 1!important;
            margin-right:-14px!important;
          }
        }


        /* V12.4 TRUE-FIDELITY DSP + RTA READABILITY PASS */
        .tr-rtaFidelity{
          width:calc(100% - 18px)!important;height:154px!important;margin:0 auto 9px!important;
          border:1px solid rgba(105,209,238,.30)!important;border-top-color:rgba(176,237,252,.42)!important;border-radius:12px!important;
          background:linear-gradient(180deg,#071219 0%,#02080c 48%,#010405 100%)!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.05),inset 0 -28px 40px rgba(0,0,0,.44),0 9px 26px rgba(0,0,0,.22)!important;
          overflow:hidden!important;isolation:isolate!important;
        }
        .tr-rtaFidelity:before{
          content:""!important;position:absolute!important;z-index:2!important;inset:0!important;pointer-events:none!important;
          background:linear-gradient(115deg,rgba(255,255,255,.05),transparent 18%,transparent 72%,rgba(82,207,239,.03))!important;
          box-shadow:inset 0 0 0 1px rgba(255,255,255,.014)!important;
        }
        .tr-rtaFidelity canvas{z-index:0!important}
        .tr-rtaFidelityHead{
          position:absolute!important;z-index:3!important;left:13px!important;right:13px!important;top:8px!important;height:18px!important;
          display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;pointer-events:none!important;
          color:#9ab7c1!important;font-size:8px!important;font-weight:1000!important;letter-spacing:.095em!important;line-height:1!important;
        }
        .tr-rtaFidelityHead>span{display:inline-flex!important;align-items:center!important;gap:7px!important;white-space:nowrap!important;color:#c7e0e8!important}
        .tr-rtaFidelityHead>span i{width:6px!important;height:6px!important;border-radius:50%!important;background:#415961!important;box-shadow:0 0 0 3px rgba(75,105,116,.06)!important}
        .tr-rtaFidelityHead>span i.is-live{background:#4fe4ff!important;box-shadow:0 0 10px rgba(79,228,255,.62),0 0 0 3px rgba(79,228,255,.07)!important}
        .tr-rtaFidelityHead>strong{min-width:0!important;overflow:visible!important;text-overflow:clip!important;white-space:nowrap!important;color:#8fe6fa!important;font-size:8px!important;font-weight:1000!important;letter-spacing:.06em!important;text-align:right!important}
        .tr-rtaFidelityHead>strong b{margin:0 6px!important;color:#587884!important;font-weight:1000!important}
        .tr-rtaFidelity .tr-activityRtaLabels{left:40px!important;right:8px!important;bottom:5px!important;gap:clamp(7px,1vw,12px)!important;z-index:3!important}
        .tr-rtaFidelity .tr-activityRtaLabels span{color:#d3e7ed!important;font-size:9px!important;font-weight:1000!important;letter-spacing:.01em!important;text-shadow:0 1px 0 #000!important}

        .tr-playerSourceTools{grid-template-columns:minmax(180px,1fr) 176px!important;gap:9px!important}
        .tr-playerSourceTools .tr-dspStatusToggle{
          position:relative!important;width:176px!important;min-width:176px!important;max-width:176px!important;height:50px!important;min-height:50px!important;
          padding:0 12px!important;display:grid!important;grid-template-columns:29px minmax(0,1fr) 7px!important;gap:9px!important;align-items:center!important;justify-content:stretch!important;
          overflow:hidden!important;border:1px solid rgba(102,206,238,.32)!important;border-top-color:rgba(179,234,250,.40)!important;border-radius:11px!important;
          background:linear-gradient(180deg,rgba(17,37,47,.99),rgba(5,17,23,.99))!important;color:#eefaff!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.065),inset 0 -1px 0 rgba(0,0,0,.68),0 8px 20px rgba(0,0,0,.24)!important;
          backdrop-filter:blur(12px)!important;-webkit-backdrop-filter:blur(12px)!important;
        }
        .tr-playerSourceTools .tr-dspStatusToggle:before{
          content:""!important;position:absolute!important;left:13%!important;right:13%!important;top:0!important;height:1px!important;
          background:linear-gradient(90deg,transparent,rgba(209,246,255,.58),transparent)!important;pointer-events:none!important;
        }
        .tr-playerSourceTools .tr-dspStatusToggle:hover{border-color:rgba(84,220,255,.58)!important;background:linear-gradient(180deg,#12313e,#071c24)!important}
        .tr-playerSourceTools .tr-dspStatusToggle.is-active{border-color:rgba(74,219,255,.72)!important;background:linear-gradient(180deg,#0e3949,#071f2a)!important;box-shadow:inset 0 1px rgba(255,255,255,.08),0 0 20px rgba(50,199,239,.14)!important}
        .tr-dspStatusIcon{width:29px!important;height:29px!important;display:grid!important;place-items:center!important;border:1px solid rgba(100,202,232,.22)!important;border-radius:8px!important;background:linear-gradient(180deg,rgba(14,50,63,.9),rgba(4,18,25,.94))!important;color:#9cecff!important;box-shadow:inset 0 1px rgba(255,255,255,.04)!important}
        .tr-dspStatusIcon svg{width:17px!important;height:17px!important;fill:currentColor!important}
        .tr-dspStatusCopy{min-width:0!important;display:grid!important;gap:3px!important;text-align:left!important;line-height:1!important}
        .tr-dspStatusCopy b{display:block!important;color:#f7fcfe!important;font-size:10px!important;font-weight:1000!important;letter-spacing:.05em!important;white-space:nowrap!important}
        .tr-dspStatusCopy small{display:block!important;min-width:0!important;overflow:visible!important;text-overflow:clip!important;white-space:nowrap!important;color:#82d8ec!important;font-size:7.2px!important;font-weight:1000!important;letter-spacing:.025em!important}
        .tr-dspStatusLed{width:6px!important;height:6px!important;border-radius:50%!important;background:#43555c!important;box-shadow:0 0 0 3px rgba(70,91,99,.07)!important}
        .tr-dspStatusLed.is-live{background:#56e6b0!important;box-shadow:0 0 8px rgba(86,230,176,.46),0 0 0 3px rgba(86,230,176,.05)!important}

        @media(max-width:650px){
          .tr-rtaFidelity{width:calc(100% - 10px)!important;height:124px!important;margin:0 auto 7px!important;border-radius:10px!important}
          .tr-rtaFidelityHead{left:8px!important;right:8px!important;top:6px!important;height:17px!important;font-size:6.7px!important;letter-spacing:.055em!important;gap:7px!important}
          .tr-rtaFidelityHead>span{gap:5px!important}.tr-rtaFidelityHead>span i{width:5px!important;height:5px!important}
          .tr-rtaFidelityHead>strong{font-size:6.6px!important;letter-spacing:.015em!important;max-width:none!important;overflow:visible!important;text-overflow:clip!important}
          .tr-rtaFidelityHead>strong b{margin:0 3px!important}
          .tr-rtaFidelity .tr-activityRtaLabels{left:27px!important;right:5px!important;bottom:4px!important;gap:2px!important}
          .tr-rtaFidelity .tr-activityRtaLabels span{font-size:7.1px!important;letter-spacing:-.025em!important}
          .tr-playerSourceTools{grid-template-columns:minmax(0,1fr) 146px!important;gap:7px!important}
          .tr-playerSourceTools .tr-dspStatusToggle{width:146px!important;min-width:146px!important;max-width:146px!important;height:46px!important;min-height:46px!important;padding:0 8px!important;grid-template-columns:25px minmax(0,1fr) 6px!important;gap:7px!important;border-radius:10px!important}
          .tr-dspStatusIcon{width:25px!important;height:25px!important;border-radius:7px!important}.tr-dspStatusIcon svg{width:15px!important;height:15px!important}
          .tr-dspStatusCopy b{font-size:8.8px!important}.tr-dspStatusCopy small{font-size:6.3px!important;letter-spacing:0!important;overflow:visible!important;text-overflow:clip!important}.tr-dspStatusLed{width:5px!important;height:5px!important}
        }
        @media(max-width:380px){
          .tr-rtaFidelity{height:118px!important}
          .tr-rtaFidelityHead{font-size:6.3px!important}.tr-rtaFidelityHead>strong{font-size:6.1px!important}
          .tr-rtaFidelity .tr-activityRtaLabels span{font-size:6.7px!important}
          .tr-playerSourceTools{grid-template-columns:minmax(0,1fr) 136px!important}
          .tr-playerSourceTools .tr-dspStatusToggle{width:136px!important;min-width:136px!important;max-width:136px!important;height:44px!important;min-height:44px!important;padding:0 7px!important;grid-template-columns:24px minmax(0,1fr) 5px!important;gap:6px!important}
          .tr-dspStatusIcon{width:24px!important;height:24px!important}.tr-dspStatusCopy b{font-size:8.3px!important}.tr-dspStatusCopy small{font-size:5.9px!important}
        }

        /* V13.7 OUTPUT PROFILE IDENTITY */
        .tr-outputProfileTitle{display:flex!important;align-items:center!important;gap:9px!important}
        .tr-outputProfileIcon,.tr-rtaOutputIcon,.tr-outputProfileSelectLabel i,.tr-outputProfileTelemetryActive i{display:inline-grid!important;place-items:center!important;flex:0 0 auto!important;color:#94e9ff!important}
        .tr-outputProfileIcon{width:31px!important;height:31px!important;border:1px solid rgba(89,210,246,.25)!important;border-radius:9px!important;background:linear-gradient(180deg,rgba(11,45,58,.86),rgba(4,18,25,.94))!important;box-shadow:inset 0 1px rgba(255,255,255,.045),0 0 18px rgba(53,200,239,.08)!important}
        .tr-outputProfileIcon svg{width:18px!important;height:18px!important;fill:currentColor!important}
        .tr-outputProfileSelectLabel{display:flex!important;align-items:center!important;gap:6px!important}
        .tr-outputProfileSelectLabel i{width:18px!important;height:18px!important;border:1px solid rgba(89,210,246,.16)!important;border-radius:5px!important;background:rgba(4,20,27,.72)!important}
        .tr-outputProfileSelectLabel i svg{width:11px!important;height:11px!important;fill:currentColor!important}
        .tr-outputProfileTelemetryActive{display:inline-flex!important;align-items:center!important;gap:6px!important}
        .tr-outputProfileTelemetryActive i{width:15px!important;height:15px!important;color:#9cecff!important}
        .tr-outputProfileTelemetryActive i svg{width:11px!important;height:11px!important;fill:currentColor!important}
        .tr-rtaFidelityHead>strong{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:4px!important}
        .tr-rtaOutputIcon{width:16px!important;height:16px!important;border:1px solid rgba(98,214,246,.17)!important;border-radius:5px!important;background:rgba(3,17,23,.76)!important;color:#9beaff!important}
        .tr-rtaOutputIcon svg{width:11px!important;height:11px!important;fill:currentColor!important}
        @media(max-width:650px){.tr-rtaOutputIcon{width:13px!important;height:13px!important;border-radius:4px!important}.tr-rtaOutputIcon svg{width:9px!important;height:9px!important}.tr-outputProfileIcon{width:28px!important;height:28px!important}.tr-outputProfileIcon svg{width:16px!important;height:16px!important}}

        .tr-outputProfileChoices{grid-column:1/-1!important;display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:7px!important;margin-top:2px!important}
        .tr-outputProfileChoices button{min-height:42px!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:7px!important;padding:0 9px!important;border:1px solid rgba(112,192,220,.12)!important;border-radius:10px!important;background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(0,0,0,.16))!important;color:#829da8!important;font-size:7px!important;font-weight:1000!important;letter-spacing:.065em!important;cursor:pointer!important}
        .tr-outputProfileChoices button i{width:22px!important;height:22px!important;display:grid!important;place-items:center!important;border:1px solid rgba(101,190,221,.13)!important;border-radius:6px!important;background:rgba(3,16,22,.7)!important;color:#7da9b8!important}
        .tr-outputProfileChoices button i svg{width:13px!important;height:13px!important;fill:currentColor!important}
        .tr-outputProfileChoices button.is-active{border-color:rgba(73,210,249,.42)!important;color:#dff8ff!important;background:linear-gradient(180deg,rgba(12,55,69,.78),rgba(4,23,31,.92))!important;box-shadow:inset 0 1px rgba(255,255,255,.04),0 0 18px rgba(58,205,244,.07)!important}
        .tr-outputProfileChoices button.is-active i{border-color:rgba(76,216,253,.32)!important;color:#9cecff!important;background:rgba(5,45,58,.84)!important}
        @media(max-width:650px){.tr-outputProfileChoices{grid-template-columns:repeat(2,minmax(0,1fr))!important}.tr-outputProfileChoices button{min-height:40px!important;font-size:6.7px!important}}


        /* V13.7.2 OUTPUT IDENTITY + STATUS ALIGNMENT */
        .tr-playerSourceTools .tr-dspStatusToggle{
          grid-template-columns:29px minmax(0,1fr)!important;
          gap:11px!important;
          padding:0 28px 0 11px!important;
          overflow:hidden!important;
        }
        .tr-dspStatusIcon{margin:0!important;justify-self:start!important}
        .tr-dspStatusCopy{width:100%!important;min-width:0!important;padding:0!important;margin:0!important;overflow:hidden!important}
        .tr-dspStatusCopy small{max-width:100%!important;overflow:hidden!important;text-overflow:ellipsis!important}
        .tr-dspStatusLed{
          position:absolute!important;right:10px!important;top:50%!important;transform:translateY(-50%)!important;
          width:7px!important;height:7px!important;margin:0!important;justify-self:auto!important;align-self:auto!important;
          background:#43555c!important;box-shadow:0 0 0 3px rgba(70,91,99,.07)!important;
        }
        .tr-dspStatusLed.is-active{background:#56e6b0!important;box-shadow:0 0 9px rgba(86,230,176,.54),0 0 0 3px rgba(86,230,176,.06)!important}
        .tr-dspStatusLed.is-recovering{background:#ffb84d!important;box-shadow:0 0 9px rgba(255,184,77,.48),0 0 0 3px rgba(255,184,77,.06)!important}
        .tr-dspStatusLed.is-unavailable{background:#ff626e!important;box-shadow:0 0 9px rgba(255,98,110,.48),0 0 0 3px rgba(255,98,110,.06)!important}
        .tr-dspStatusLed.is-bypassed{background:#71848c!important;box-shadow:0 0 0 3px rgba(113,132,140,.07)!important}

        .tr-outputProfileTitle{gap:11px!important}
        .tr-outputProfileSelectLabel{gap:8px!important}
        .tr-outputProfileSelectLabel>b{font:inherit!important;color:inherit!important}
        .tr-outputProfileTelemetryActive{gap:8px!important}
        .tr-rtaFidelityHead>strong{gap:7px!important}
        .tr-rtaFidelityHead>strong .tr-rtaProfileCopy{margin-left:1px!important}
        .tr-rtaFidelityHead>strong b{margin:0 3px!important}
        .tr-outputProfileChoices button{gap:9px!important}
        .tr-outputProfileChoices button i{margin-right:1px!important}

        /* Profile colors are identity colors. DSP status remains a separate green/amber/red signal. */
        .tr-dspStatusToggle[data-profile="headphones"] .tr-dspStatusIcon,
        [data-profile="headphones"].tr-outputProfileIcon,
        [data-profile="headphones"].tr-rtaOutputIcon,
        .tr-outputProfileSelectLabel i[data-profile="headphones"],
        .tr-outputProfileTelemetryActive[data-profile="headphones"] i,
        .tr-outputProfileChoices button[data-profile="headphones"] i{color:#52dcff!important;border-color:rgba(82,220,255,.38)!important;background:rgba(4,49,65,.78)!important;box-shadow:inset 0 1px rgba(255,255,255,.05),0 0 14px rgba(82,220,255,.10)!important}
        .tr-dspStatusToggle[data-profile="car_hifi"] .tr-dspStatusIcon,
        [data-profile="car_hifi"].tr-outputProfileIcon,
        [data-profile="car_hifi"].tr-rtaOutputIcon,
        .tr-outputProfileSelectLabel i[data-profile="car_hifi"],
        .tr-outputProfileTelemetryActive[data-profile="car_hifi"] i,
        .tr-outputProfileChoices button[data-profile="car_hifi"] i{color:#ffc35a!important;border-color:rgba(255,195,90,.40)!important;background:rgba(68,42,6,.76)!important;box-shadow:inset 0 1px rgba(255,255,255,.05),0 0 14px rgba(255,185,62,.09)!important}
        .tr-dspStatusToggle[data-profile="speaker"] .tr-dspStatusIcon,
        [data-profile="speaker"].tr-outputProfileIcon,
        [data-profile="speaker"].tr-rtaOutputIcon,
        .tr-outputProfileSelectLabel i[data-profile="speaker"],
        .tr-outputProfileTelemetryActive[data-profile="speaker"] i,
        .tr-outputProfileChoices button[data-profile="speaker"] i{color:#b88cff!important;border-color:rgba(184,140,255,.40)!important;background:rgba(45,24,74,.78)!important;box-shadow:inset 0 1px rgba(255,255,255,.05),0 0 14px rgba(174,118,255,.10)!important}
        .tr-dspStatusToggle[data-profile="reference"] .tr-dspStatusIcon,
        [data-profile="reference"].tr-outputProfileIcon,
        [data-profile="reference"].tr-rtaOutputIcon,
        .tr-outputProfileSelectLabel i[data-profile="reference"],
        .tr-outputProfileTelemetryActive[data-profile="reference"] i,
        .tr-outputProfileChoices button[data-profile="reference"] i{color:#edf5f8!important;border-color:rgba(214,231,237,.30)!important;background:rgba(47,58,64,.72)!important;box-shadow:inset 0 1px rgba(255,255,255,.06),0 0 12px rgba(225,240,245,.05)!important}

        .tr-outputProfileChoices button[data-profile="headphones"].is-active{border-color:rgba(82,220,255,.48)!important;box-shadow:inset 0 1px rgba(255,255,255,.05),0 0 18px rgba(82,220,255,.08)!important}
        .tr-outputProfileChoices button[data-profile="car_hifi"].is-active{border-color:rgba(255,195,90,.48)!important;box-shadow:inset 0 1px rgba(255,255,255,.05),0 0 18px rgba(255,195,90,.07)!important}
        .tr-outputProfileChoices button[data-profile="speaker"].is-active{border-color:rgba(184,140,255,.48)!important;box-shadow:inset 0 1px rgba(255,255,255,.05),0 0 18px rgba(184,140,255,.08)!important}
        .tr-outputProfileChoices button[data-profile="reference"].is-active{border-color:rgba(220,235,241,.36)!important;box-shadow:inset 0 1px rgba(255,255,255,.05),0 0 16px rgba(220,235,241,.04)!important}

        @media(max-width:650px){
          .tr-playerSourceTools .tr-dspStatusToggle{grid-template-columns:25px minmax(0,1fr)!important;gap:9px!important;padding:0 23px 0 8px!important}
          .tr-dspStatusLed{right:8px!important;width:6px!important;height:6px!important}
          .tr-rtaFidelityHead>strong{gap:5px!important}
          .tr-rtaFidelityHead>strong b{margin:0 1px!important}
          .tr-outputProfileTitle{gap:9px!important}
          .tr-outputProfileChoices button{gap:8px!important}
        }
        @media(max-width:380px){
          .tr-playerSourceTools .tr-dspStatusToggle{grid-template-columns:26px minmax(0,1fr)!important;gap:10px!important;padding:0 24px 0 8px!important}
          .tr-dspStatusLed{right:7px!important;width:5px!important;height:5px!important}
        }

        /* V13.8 FINAL OUTPUT IDENTITY ALIGNMENT */
        .tr-playerSourceTools .tr-dspStatusToggle{position:relative!important;grid-template-columns:30px minmax(0,1fr)!important;column-gap:12px!important;padding-left:12px!important;padding-right:30px!important}
        .tr-playerSourceTools .tr-dspStatusIcon{width:28px!important;height:28px!important;min-width:28px!important;display:grid!important;place-items:center!important;margin:0!important;border-radius:7px!important}
        .tr-playerSourceTools .tr-dspStatusIcon svg{width:16px!important;height:16px!important}
        .tr-playerSourceTools .tr-dspStatusCopy{padding-left:1px!important}
        .tr-playerSourceTools .tr-dspStatusLed{right:11px!important;top:50%!important;transform:translateY(-50%)!important}
        .tr-rtaFidelityHead>strong{display:inline-flex!important;align-items:center!important;gap:9px!important}
        .tr-rtaOutputIcon{margin-right:1px!important;flex:0 0 auto!important}
        .tr-rtaProfileCopy{padding-left:1px!important}
        .tr-outputProfileTitle,.tr-outputProfileSelectLabel,.tr-outputProfileTelemetryActive{column-gap:10px!important}
        .tr-outputProfileChoices button{column-gap:10px!important}
        .tr-outputProfileChoices button i{flex:0 0 24px!important;width:24px!important;height:24px!important;margin:0!important}

        .tr-eqHeadHint{display:block!important;margin-top:4px!important;color:rgba(174,199,210,.54)!important;font-size:7px!important;font-weight:750!important;line-height:1.35!important}
        .tr-eqArchitecturePanel{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:12px!important;align-items:center!important;margin:9px 0 12px!important;padding:11px 12px!important;border:1px solid rgba(86,190,225,.13)!important;border-radius:10px!important;background:linear-gradient(180deg,rgba(7,23,31,.72),rgba(3,11,16,.82))!important}
        .tr-eqArchitectureCopy{display:grid!important;gap:3px!important;min-width:0!important}.tr-eqArchitectureCopy>span{color:#65d8fa!important;font-size:6.5px!important;font-weight:1000!important;letter-spacing:.12em!important}.tr-eqArchitectureCopy>strong{color:#f1f9fc!important;font-size:10px!important}.tr-eqArchitectureCopy>small{color:#7f9aa5!important;font-size:7.5px!important;line-height:1.35!important}
        .tr-eqArchitectureButtons{display:flex!important;gap:7px!important}.tr-eqArchitectureButtons button{min-height:34px!important;padding:0 11px!important;border:1px solid rgba(102,187,216,.16)!important;border-radius:8px!important;background:#07131a!important;color:#8aa7b2!important;font-size:7px!important;font-weight:1000!important;letter-spacing:.06em!important}.tr-eqArchitectureButtons button.is-active{border-color:rgba(77,211,250,.46)!important;background:rgba(6,55,70,.62)!important;color:#b8efff!important;box-shadow:inset 0 1px rgba(255,255,255,.04),0 0 14px rgba(70,205,244,.06)!important}.tr-eqArchitectureButtons button:disabled{opacity:.38!important;cursor:not-allowed!important}
        .tr-dspEnginePanel{padding-bottom:10px!important}.tr-dspEnginePanel .tr-dspProofStatus{gap:7px!important;flex-wrap:wrap!important}

        @media(max-width:650px){.tr-eqArchitecturePanel{grid-template-columns:1fr!important}.tr-eqArchitectureButtons{display:grid!important;grid-template-columns:1fr 1fr!important}.tr-playerSourceTools .tr-dspStatusToggle{grid-template-columns:27px minmax(0,1fr)!important;column-gap:10px!important;padding-left:9px!important;padding-right:25px!important}.tr-playerSourceTools .tr-dspStatusIcon{width:25px!important;height:25px!important;min-width:25px!important}.tr-playerSourceTools .tr-dspStatusLed{right:8px!important}}

        /* V13.8.1 FLAGSHIP CONTROL SYSTEM — UI ONLY */
        @keyframes trControlSweep{0%{transform:translateX(-140%) skewX(-18deg);opacity:0}28%{opacity:.52}100%{transform:translateX(220%) skewX(-18deg);opacity:0}}
        @keyframes trControlSettle{0%{transform:scale(.965)}58%{transform:scale(1.018)}100%{transform:scale(1)}}
        @keyframes trSourceConfirm{0%{box-shadow:0 0 0 0 rgba(75,214,255,.0)}42%{box-shadow:0 0 0 2px rgba(75,214,255,.18),0 0 22px rgba(75,214,255,.16)}100%{box-shadow:0 0 0 0 rgba(75,214,255,0)}}
        @keyframes trPlayAlive{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.34),inset 0 -1px 0 rgba(89,45,3,.40),0 8px 24px rgba(211,123,15,.19),0 0 0 rgba(255,184,61,0)}50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.38),inset 0 -1px 0 rgba(89,45,3,.40),0 8px 24px rgba(211,123,15,.20),0 0 24px rgba(255,184,61,.10)}}

        .tr-playerTransportStage{gap:9px!important;align-items:start!important}
        .tr-playerTransportStage .tr-audioTransportUnit{grid-template-rows:58px 17px!important;gap:7px!important}
        .tr-playerTransportStage .tr-audioTransportButton{position:relative!important;isolation:isolate!important;overflow:hidden!important;height:58px!important;min-height:58px!important;border-radius:13px!important;border:1px solid rgba(126,188,210,.24)!important;background:linear-gradient(180deg,rgba(19,37,47,.98),rgba(5,13,18,.99))!important;color:#eaf8fc!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.055),inset 0 -1px 0 rgba(0,0,0,.75),0 8px 22px rgba(0,0,0,.25)!important;transition:transform .14s cubic-bezier(.2,.8,.2,1),border-color .18s ease,background .18s ease,box-shadow .18s ease,color .18s ease!important}
        .tr-playerTransportStage .tr-audioTransportButton:before{content:""!important;display:block!important;position:absolute!important;z-index:-1!important;inset:0!important;background:linear-gradient(115deg,transparent 16%,rgba(255,255,255,.07) 45%,transparent 67%)!important;transform:translateX(-130%)!important;pointer-events:none!important}
        .tr-playerTransportStage .tr-audioTransportButton:hover:not(:disabled){transform:translateY(-2px)!important;border-color:rgba(87,215,255,.56)!important;background:linear-gradient(180deg,rgba(22,52,65,.99),rgba(6,20,27,.99))!important;box-shadow:inset 0 1px rgba(255,255,255,.075),0 11px 28px rgba(0,0,0,.29),0 0 18px rgba(67,203,244,.08)!important}
        .tr-playerTransportStage .tr-audioTransportButton:hover:not(:disabled):before{animation:trControlSweep .72s ease-out 1!important}
        .tr-playerTransportStage .tr-audioTransportButton:active:not(:disabled){transform:translateY(1px) scale(.975)!important;transition-duration:.06s!important}
        .tr-playerTransportStage .tr-audioTransportButton:focus-visible{outline:2px solid rgba(103,221,255,.75)!important;outline-offset:2px!important}
        .tr-playerTransportStage .tr-audioTransportButton--primary{border-color:rgba(255,193,83,.72)!important;background:linear-gradient(180deg,#ffc55d 0%,#f2a125 48%,#d77c0c 100%)!important;color:#171007!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.42),inset 0 -1px 0 rgba(112,58,4,.48),0 9px 24px rgba(211,123,15,.20)!important}
        .tr-playerTransportStage .tr-audioTransportButton--primary:hover:not(:disabled){border-color:#ffd486!important;background:linear-gradient(180deg,#ffd071,#ffad2f 48%,#e9890e 100%)!important;color:#120b04!important;box-shadow:inset 0 1px rgba(255,255,255,.48),0 12px 30px rgba(211,123,15,.27),0 0 22px rgba(255,184,61,.14)!important}
        .tr-playerTransportStage .tr-audioTransportButton--primary.is-playing{animation:trPlayAlive 2.8s ease-in-out infinite!important}
        .tr-playerTransportStage .tr-audioTransportButton.is-stop{border-color:rgba(224,104,111,.26)!important;color:#ffd9db!important;background:linear-gradient(180deg,rgba(49,25,29,.92),rgba(17,10,12,.98))!important}
        .tr-playerTransportStage .tr-audioTransportButton.is-stop:hover:not(:disabled){border-color:rgba(255,109,119,.55)!important;color:#fff2f3!important;background:linear-gradient(180deg,rgba(67,29,34,.96),rgba(22,10,13,.99))!important;box-shadow:inset 0 1px rgba(255,255,255,.05),0 10px 26px rgba(0,0,0,.28),0 0 18px rgba(233,78,89,.08)!important}
        .tr-playerTransportStage .tr-audioTransportFace svg{width:27px!important;height:27px!important;filter:drop-shadow(0 1px 0 rgba(0,0,0,.35))!important}
        .tr-playerTransportStage .tr-audioTransportUnit>span{font-size:10px!important;line-height:1!important;letter-spacing:.09em!important;color:#a9c1cb!important;text-shadow:0 1px rgba(0,0,0,.55)!important}
        .tr-playerTransportStage .tr-audioTransportUnit.is-primary>span{color:#ffc86e!important}
        .tr-playerTransportStage .tr-audioTransportUnit.is-stop>span{color:#d8a5aa!important}

        .tr-playerModeStage{display:grid!important;grid-template-columns:repeat(2,minmax(0,170px))!important;justify-content:center!important;gap:10px!important;margin-top:3px!important;margin-bottom:9px!important}
        .tr-playerModeStage .tr-audioModeButton{position:relative!important;isolation:isolate!important;overflow:hidden!important;width:100%!important;min-width:0!important;height:42px!important;min-height:42px!important;padding:0 36px 0 14px!important;display:grid!important;grid-template-columns:18px minmax(0,1fr)!important;align-items:center!important;column-gap:9px!important;border:1px solid rgba(121,179,199,.20)!important;border-radius:11px!important;background:linear-gradient(180deg,#0d1d25,#061016)!important;color:#c7dbe2!important;box-shadow:inset 0 1px rgba(255,255,255,.04),0 6px 16px rgba(0,0,0,.18)!important;transition:transform .13s ease,border-color .18s ease,background .18s ease,box-shadow .18s ease,color .18s ease!important}
        .tr-playerModeStage .tr-audioModeButton:before{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 20%,rgba(255,255,255,.07) 47%,transparent 68%);transform:translateX(-135%);pointer-events:none}
        .tr-playerModeStage .tr-audioModeButton:hover:not(:disabled){transform:translateY(-1px)!important;border-color:rgba(78,209,249,.46)!important;color:#eefbff!important;background:linear-gradient(180deg,#11303c,#071820)!important}
        .tr-playerModeStage .tr-audioModeButton:hover:not(:disabled):before{animation:trControlSweep .7s ease-out 1!important}
        .tr-playerModeStage .tr-audioModeButton:active:not(:disabled){transform:translateY(1px) scale(.98)!important}
        .tr-playerModeStage .tr-audioModeButton svg{width:18px!important;height:18px!important}
        .tr-playerModeStage .tr-audioModeButton>span{min-width:0!important;font-size:10px!important;line-height:1!important;font-weight:1000!important;letter-spacing:.08em!important;text-align:left!important;white-space:nowrap!important}
        .tr-playerModeStage .tr-modeState{position:absolute!important;right:10px!important;top:50%!important;transform:translateY(-50%)!important;font-style:normal!important;font-size:7px!important;font-weight:1000!important;letter-spacing:.08em!important;color:#5f7781!important}
        .tr-playerModeStage .tr-audioModeButton.is-active{border-color:rgba(72,215,255,.62)!important;background:linear-gradient(180deg,#0d4152,#092733)!important;color:#b8efff!important;box-shadow:inset 0 1px rgba(255,255,255,.055),inset 0 -2px #45d5fa,0 0 20px rgba(61,205,247,.10)!important;animation:trControlSettle .26s ease-out 1!important}
        .tr-playerModeStage .tr-audioModeButton.is-active .tr-modeState{color:#66e0ff!important;text-shadow:0 0 9px rgba(86,221,255,.34)!important}

        .tr-playerUtilityRow{align-items:end!important}
        .tr-playerSourceTools{display:grid!important;grid-template-columns:minmax(230px,1fr) 176px!important;gap:10px!important;align-items:end!important}
        .tr-audioDeck--pro7 .tr-playerSourceTools .tr-audioQueueSelector{display:grid!important;gap:6px!important;min-width:0!important;width:100%!important;max-width:none!important}
        .tr-audioDeck--pro7 .tr-playerSourceTools .tr-audioQueueSelector>span:first-child{font-size:9px!important;line-height:1!important;font-weight:1000!important;letter-spacing:.12em!important;color:#91aab4!important}
        .tr-audioQueueSelectorField{position:relative!important;display:grid!important;grid-template-columns:35px minmax(0,1fr) 34px!important;align-items:center!important;height:44px!important;min-height:44px!important;border:1px solid rgba(103,182,210,.23)!important;border-radius:11px!important;background:linear-gradient(180deg,rgba(12,29,38,.98),rgba(4,12,17,.99))!important;box-shadow:inset 0 1px rgba(255,255,255,.045),0 6px 18px rgba(0,0,0,.18)!important;overflow:hidden!important;transition:border-color .18s ease,box-shadow .18s ease,background .18s ease!important}
        .tr-audioQueueSelector:hover .tr-audioQueueSelectorField,.tr-audioQueueSelector:focus-within .tr-audioQueueSelectorField{border-color:rgba(76,210,252,.52)!important;background:linear-gradient(180deg,rgba(13,42,54,.99),rgba(5,19,26,.99))!important;box-shadow:inset 0 1px rgba(255,255,255,.055),0 7px 20px rgba(0,0,0,.20),0 0 16px rgba(55,197,240,.07)!important}
        .tr-audioQueueSelector.is-changed .tr-audioQueueSelectorField{animation:trSourceConfirm .52s ease-out 1!important}
        .tr-audioQueueSelectorField .tr-sourceIcon,.tr-audioQueueSelectorField .tr-sourceChevron{display:grid!important;place-items:center!important;color:#61d9fb!important;pointer-events:none!important}
        .tr-audioQueueSelectorField .tr-sourceIcon{width:35px!important;height:100%!important;border-right:1px solid rgba(104,181,207,.10)!important}
        .tr-audioQueueSelectorField .tr-sourceIcon svg{width:16px!important;height:16px!important;fill:currentColor!important}
        .tr-audioQueueSelectorField .tr-sourceChevron{width:34px!important;height:100%!important;border-left:1px solid rgba(104,181,207,.10)!important;color:#a5c7d2!important}
        .tr-audioQueueSelectorField .tr-sourceChevron svg{width:18px!important;height:18px!important;fill:none!important;stroke:currentColor!important;stroke-width:2.2!important;stroke-linecap:round!important;stroke-linejoin:round!important}
        .tr-audioDeck--pro7 .tr-playerSourceTools .tr-audioQueueSelectorField select{position:relative!important;z-index:1!important;width:100%!important;height:100%!important;min-width:0!important;margin:0!important;padding:0 8px!important;border:0!important;outline:0!important;background:transparent!important;color:#f1f9fc!important;font-size:12px!important;line-height:1!important;font-weight:850!important;text-overflow:ellipsis!important;white-space:nowrap!important;overflow:hidden!important;appearance:none!important;-webkit-appearance:none!important;background-image:none!important;cursor:pointer!important}
        .tr-audioDeck--pro7 .tr-playerSourceTools .tr-audioQueueSelectorField select::-ms-expand{display:none!important}

        .tr-playerSourceTools .tr-dspStatusToggle{position:relative!important;isolation:isolate!important;overflow:hidden!important;width:176px!important;min-width:176px!important;max-width:176px!important;height:44px!important;min-height:44px!important;display:grid!important;grid-template-columns:30px minmax(0,1fr) 18px!important;column-gap:10px!important;align-items:center!important;padding:0 27px 0 10px!important;border-radius:11px!important;border:1px solid rgba(72,195,237,.34)!important;background:linear-gradient(180deg,#0b2631,#06141c)!important;box-shadow:inset 0 1px rgba(255,255,255,.045),0 6px 18px rgba(0,0,0,.20)!important;transition:transform .14s ease,border-color .18s ease,background .18s ease,box-shadow .18s ease!important}
        .tr-playerSourceTools .tr-dspStatusToggle:before{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 20%,rgba(255,255,255,.07) 48%,transparent 70%);transform:translateX(-135%);pointer-events:none}
        .tr-playerSourceTools .tr-dspStatusToggle:hover{transform:translateY(-1px)!important;border-color:rgba(74,216,255,.62)!important;background:linear-gradient(180deg,#0c3543,#071d26)!important}
        .tr-playerSourceTools .tr-dspStatusToggle:hover:before{animation:trControlSweep .72s ease-out 1!important}
        .tr-playerSourceTools .tr-dspStatusToggle:active{transform:translateY(1px) scale(.985)!important}
        .tr-playerSourceTools .tr-dspStatusToggle.is-active{border-color:#55d9ff!important;background:linear-gradient(180deg,#0a4052,#082633)!important;box-shadow:inset 0 1px rgba(255,255,255,.07),inset 0 -2px rgba(67,213,250,.76),0 0 20px rgba(50,195,239,.15)!important}
        .tr-playerSourceTools .tr-dspStatusIcon{width:30px!important;height:30px!important;min-width:30px!important;border-radius:8px!important}
        .tr-playerSourceTools .tr-dspStatusCopy{display:grid!important;gap:3px!important;min-width:0!important;padding:0!important;text-align:left!important}
        .tr-playerSourceTools .tr-dspStatusCopy b{font-size:11px!important;line-height:1!important;color:#f7fcff!important;letter-spacing:.045em!important;white-space:nowrap!important}
        .tr-playerSourceTools .tr-dspStatusCopy small{min-width:0!important;max-width:100%!important;font-size:7.5px!important;line-height:1!important;color:#9ebbc5!important;letter-spacing:.025em!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
        .tr-dspChevron{display:grid!important;place-items:center!important;width:18px!important;height:18px!important;color:#8fb6c3!important;transition:transform .22s cubic-bezier(.2,.8,.2,1),color .18s ease!important;transform:rotate(0deg)!important}
        .tr-dspChevron.is-open{transform:rotate(180deg)!important;color:#69dcff!important}
        .tr-dspChevron svg{width:17px!important;height:17px!important;fill:none!important;stroke:currentColor!important;stroke-width:2.2!important;stroke-linecap:round!important;stroke-linejoin:round!important}
        .tr-playerSourceTools .tr-dspStatusLed{right:9px!important;top:50%!important;transform:translateY(-50%)!important;width:7px!important;height:7px!important;z-index:3!important}

        .tr-audioEqQuickActions{display:grid!important;grid-template-columns:minmax(150px,190px) minmax(190px,235px)!important;gap:9px!important;align-items:stretch!important}
        .tr-audioEqQuickActions button{position:relative!important;isolation:isolate!important;overflow:hidden!important;height:47px!important;min-height:47px!important;padding:0 16px!important;display:grid!important;align-content:center!important;gap:4px!important;text-align:left!important;border-radius:11px!important;border:1px solid rgba(126,187,208,.20)!important;background:linear-gradient(180deg,#111f27,#071116)!important;color:#dceaf0!important;box-shadow:inset 0 1px rgba(255,255,255,.045),0 6px 17px rgba(0,0,0,.18)!important;transition:transform .13s ease,border-color .18s ease,background .18s ease,box-shadow .18s ease!important}
        .tr-audioEqQuickActions button:before{content:"";position:absolute;inset:0;background:linear-gradient(112deg,transparent 18%,rgba(255,255,255,.09) 46%,transparent 69%);transform:translateX(-135%);pointer-events:none}
        .tr-audioEqQuickActions button:hover{transform:translateY(-1px)!important}.tr-audioEqQuickActions button:hover:before{animation:trControlSweep .72s ease-out 1!important}.tr-audioEqQuickActions button:active{transform:translateY(1px) scale(.982)!important}
        .tr-audioEqQuickActions button>span{font-size:11px!important;line-height:1!important;font-weight:1000!important;letter-spacing:.08em!important;color:inherit!important;white-space:nowrap!important}
        .tr-audioEqQuickActions button>i{font-style:normal!important;font-size:7px!important;line-height:1!important;font-weight:900!important;letter-spacing:.10em!important;color:#718b96!important;white-space:nowrap!important}
        .tr-audioEqQuickActions .is-flat:hover,.tr-audioEqQuickActions .is-flat.is-selected{border-color:rgba(99,214,248,.53)!important;background:linear-gradient(180deg,#173440,#0a1b23)!important;color:#eafaff!important;box-shadow:inset 0 1px rgba(255,255,255,.055),inset 0 -2px rgba(75,208,246,.58),0 0 18px rgba(61,199,238,.08)!important}
        .tr-audioEqQuickActions .is-flat.is-selected{animation:trControlSettle .28s ease-out 1!important}.tr-audioEqQuickActions .is-flat.is-selected>i{color:#70d9f7!important}
        .tr-audioEqQuickActions .is-power{border-color:rgba(224,156,54,.32)!important;background:linear-gradient(180deg,#33210d,#191006)!important;color:#f3d8a5!important}
        .tr-audioEqQuickActions .is-power:hover,.tr-audioEqQuickActions .is-power.is-selected{border-color:rgba(255,191,79,.68)!important;background:linear-gradient(180deg,#6c430e,#3f2407)!important;color:#fff1d2!important;box-shadow:inset 0 1px rgba(255,255,255,.08),inset 0 -2px rgba(255,177,54,.72),0 0 20px rgba(236,153,35,.11)!important}
        .tr-audioEqQuickActions .is-power.is-selected{animation:trControlSettle .28s ease-out 1!important}.tr-audioEqQuickActions .is-power.is-selected>i{color:#ffc565!important}

        .tr-dspProfileSaveActions button.tr-savePresetCommand{position:relative!important;isolation:isolate!important;overflow:hidden!important;min-width:190px!important;min-height:43px!important;padding:0 17px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:9px!important;border-radius:11px!important;border:1px solid rgba(255,190,79,.62)!important;background:linear-gradient(180deg,#d99825,#a75f0b)!important;color:#171006!important;font-size:10px!important;font-weight:1000!important;letter-spacing:.055em!important;box-shadow:inset 0 1px rgba(255,255,255,.28),inset 0 -1px rgba(91,47,2,.42),0 7px 19px rgba(151,85,6,.17)!important;transition:transform .13s ease,background .18s ease,border-color .18s ease,box-shadow .18s ease!important}
        .tr-dspProfileSaveActions button.tr-savePresetCommand:before{content:"";position:absolute;inset:0;background:linear-gradient(112deg,transparent 20%,rgba(255,255,255,.16) 46%,transparent 68%);transform:translateX(-135%);pointer-events:none}.tr-dspProfileSaveActions button.tr-savePresetCommand:hover:before{animation:trControlSweep .72s ease-out 1!important}
        .tr-dspProfileSaveActions button.tr-savePresetCommand:hover{transform:translateY(-1px)!important;border-color:#ffd17b!important;background:linear-gradient(180deg,#e7aa39,#b66a0e)!important;box-shadow:inset 0 1px rgba(255,255,255,.32),0 9px 23px rgba(151,85,6,.23),0 0 18px rgba(245,170,47,.10)!important}
        .tr-dspProfileSaveActions button.tr-savePresetCommand:active{transform:translateY(1px) scale(.985)!important}
        .tr-dspProfileSaveActions button.tr-savePresetCommand svg{width:16px!important;height:16px!important;fill:currentColor!important;flex:0 0 16px!important}
        .tr-dspProfileSaveActions button.tr-savePresetCommand.is-saved{border-color:rgba(76,228,151,.72)!important;background:linear-gradient(180deg,#2bb877,#128053)!important;color:#06130d!important;box-shadow:inset 0 1px rgba(255,255,255,.25),0 0 22px rgba(55,220,143,.15)!important;animation:trControlSettle .28s ease-out 1!important}

        .tr-preampTrim{display:grid!important;grid-template-columns:minmax(190px,1fr) minmax(260px,1.25fr) auto!important;gap:15px!important;align-items:center!important;margin:10px 0 12px!important;padding:13px 14px!important;border:1px solid rgba(103,188,218,.15)!important;border-radius:12px!important;background:linear-gradient(180deg,rgba(8,24,32,.82),rgba(3,11,16,.90))!important;box-shadow:inset 0 1px rgba(255,255,255,.035)!important}
        .tr-preampTrimCopy{display:grid!important;gap:3px!important;min-width:0!important}.tr-preampTrimCopy>span{color:#58d7fb!important;font-size:7px!important;font-weight:1000!important;letter-spacing:.13em!important}.tr-preampTrimCopy>strong{color:#f4fbfe!important;font-size:11px!important}.tr-preampTrimCopy>small{color:#819ca7!important;font-size:8px!important;line-height:1.35!important}
        .tr-preampTrimControl{display:grid!important;gap:6px!important;min-width:0!important}.tr-preampTrimReadout{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important}.tr-preampTrimReadout>span{color:#6fe0ff!important;font-size:7px!important;font-weight:1000!important;letter-spacing:.11em!important}.tr-preampTrimReadout>b{color:#f3fbfe!important;font-size:10px!important;font-variant-numeric:tabular-nums!important}.tr-preampTrimControl input{width:100%!important;accent-color:#55d8fb!important}.tr-preampTrimScale{position:relative!important;height:11px!important;color:#69828d!important;font-size:7px!important;font-weight:850!important;font-variant-numeric:tabular-nums!important;line-height:11px!important}.tr-preampTrimScale>span{position:absolute!important;top:0!important;white-space:nowrap!important}.tr-preampTrimScale>span:first-child{left:0!important}.tr-preampTrimScale>span:last-child{right:0!important}.tr-preampTrimScale>.tr-preampTrimZero{left:66.6667%!important;transform:translateX(-50%)!important;color:#a8c4cf!important}.tr-preampTrimScale>.tr-preampTrimZero:before{content:""!important;position:absolute!important;left:50%!important;top:-8px!important;width:1px!important;height:6px!important;background:rgba(116,222,250,.5)!important;transform:translateX(-50%)!important}
        .tr-preampAutoButton{height:37px!important;min-height:37px!important;padding:0 12px!important;border:1px solid rgba(85,206,244,.24)!important;border-radius:9px!important;background:#071820!important;color:#9edff3!important;font-size:8px!important;font-weight:1000!important;letter-spacing:.07em!important;white-space:nowrap!important}.tr-preampAutoButton:hover:not(:disabled){border-color:rgba(83,218,255,.52)!important;background:#0b2d39!important;color:#effbff!important}.tr-preampAutoButton:disabled{opacity:.38!important}

        @media(max-width:650px){
          .tr-playerTransportStage{width:calc(100% - 12px)!important;gap:6px!important}.tr-playerTransportStage .tr-audioTransportUnit{grid-template-rows:48px 15px!important;gap:5px!important}.tr-playerTransportStage .tr-audioTransportButton{height:48px!important;min-height:48px!important;border-radius:11px!important}.tr-playerTransportStage .tr-audioTransportFace svg{width:22px!important;height:22px!important}.tr-playerTransportStage .tr-audioTransportUnit>span{font-size:9px!important;letter-spacing:.035em!important}
          .tr-playerModeStage{width:calc(100% - 12px)!important;grid-template-columns:1fr 1fr!important;gap:7px!important;margin-bottom:8px!important}.tr-playerModeStage .tr-audioModeButton{height:44px!important;min-height:44px!important;padding:0 33px 0 12px!important;grid-template-columns:17px minmax(0,1fr)!important;column-gap:7px!important}.tr-playerModeStage .tr-audioModeButton>span{font-size:10px!important;letter-spacing:.045em!important}.tr-playerModeStage .tr-modeState{right:8px!important;font-size:6.8px!important}
          .tr-playerUtilityRow{width:calc(100% - 12px)!important;grid-template-columns:1fr!important;gap:8px!important}.tr-playerSourceTools{display:grid!important;grid-template-columns:1fr!important;gap:8px!important;width:100%!important}.tr-audioDeck--pro7 .tr-playerSourceTools .tr-audioQueueSelector{width:100%!important;max-width:none!important}.tr-audioDeck--pro7 .tr-playerSourceTools .tr-audioQueueSelector>span:first-child{font-size:10px!important}.tr-audioQueueSelectorField{height:48px!important;min-height:48px!important;grid-template-columns:38px minmax(0,1fr) 38px!important}.tr-audioQueueSelectorField .tr-sourceIcon{width:38px!important}.tr-audioQueueSelectorField .tr-sourceChevron{width:38px!important}.tr-audioDeck--pro7 .tr-playerSourceTools .tr-audioQueueSelectorField select{font-size:13px!important;padding:0 9px!important}
          .tr-playerSourceTools .tr-dspStatusToggle{width:100%!important;min-width:0!important;max-width:none!important;height:48px!important;min-height:48px!important;grid-template-columns:32px minmax(0,1fr) 20px!important;column-gap:11px!important;padding:0 31px 0 10px!important}.tr-playerSourceTools .tr-dspStatusIcon{width:32px!important;height:32px!important;min-width:32px!important}.tr-playerSourceTools .tr-dspStatusCopy b{font-size:12px!important}.tr-playerSourceTools .tr-dspStatusCopy small{font-size:8.5px!important}.tr-dspChevron{width:20px!important;height:20px!important}.tr-playerSourceTools .tr-dspStatusLed{right:11px!important;width:7px!important;height:7px!important}
          .tr-audioEqQuickActions{grid-template-columns:1fr 1fr!important;gap:7px!important;width:100%!important}.tr-audioEqQuickActions button{height:50px!important;min-height:50px!important;padding:0 11px!important}.tr-audioEqQuickActions button>span{font-size:11px!important;letter-spacing:.045em!important}.tr-audioEqQuickActions button>i{font-size:6.8px!important;letter-spacing:.055em!important}
          .tr-dspProfileSave{gap:10px!important}.tr-dspProfileSaveActions{width:100%!important;display:grid!important;grid-template-columns:1fr!important;gap:7px!important}.tr-dspProfileSaveActions button{width:100%!important;min-width:0!important;min-height:46px!important;font-size:10.5px!important}.tr-dspProfileSaveActions button.tr-savePresetCommand{min-width:0!important;min-height:48px!important;font-size:11px!important}
          .tr-preampTrim{grid-template-columns:1fr!important;gap:11px!important;padding:13px!important}.tr-preampTrimCopy>span{font-size:8px!important}.tr-preampTrimCopy>strong{font-size:12px!important}.tr-preampTrimCopy>small{font-size:9px!important}.tr-preampTrimReadout>span{font-size:8px!important}.tr-preampTrimReadout>b{font-size:11px!important}.tr-preampTrimScale{font-size:8px!important}.tr-preampAutoButton{width:100%!important;height:44px!important;min-height:44px!important;font-size:9px!important}
        }
        @media(max-width:390px){
          .tr-playerTransportStage{gap:4px!important}.tr-playerTransportStage .tr-audioTransportUnit{grid-template-rows:46px 14px!important}.tr-playerTransportStage .tr-audioTransportButton{height:46px!important;min-height:46px!important;padding:0!important}.tr-playerTransportStage .tr-audioTransportFace svg{width:20px!important;height:20px!important}.tr-playerTransportStage .tr-audioTransportUnit>span{font-size:8.5px!important;letter-spacing:.01em!important}
          .tr-playerModeStage .tr-audioModeButton{padding-left:10px!important;padding-right:31px!important}.tr-playerModeStage .tr-audioModeButton>span{font-size:9.5px!important;letter-spacing:.025em!important}
          .tr-audioDeck--pro7 .tr-playerSourceTools .tr-audioQueueSelectorField select{font-size:12px!important}.tr-playerSourceTools .tr-dspStatusCopy b{font-size:11px!important}.tr-playerSourceTools .tr-dspStatusCopy small{font-size:8px!important}
          .tr-audioEqQuickActions button>span{font-size:10px!important}.tr-audioEqQuickActions button>i{font-size:6.4px!important}.tr-dspProfileSaveActions button.tr-savePresetCommand{font-size:10.5px!important}
        }
        @media(max-width:350px){
          .tr-playerTransportStage .tr-audioTransportUnit>span{font-size:8px!important}.tr-playerModeStage{gap:5px!important}.tr-playerModeStage .tr-audioModeButton{padding-left:8px!important;padding-right:27px!important;column-gap:5px!important}.tr-playerModeStage .tr-audioModeButton>span{font-size:8.8px!important}.tr-playerModeStage .tr-modeState{right:6px!important;font-size:6.2px!important}.tr-audioQueueSelectorField{grid-template-columns:34px minmax(0,1fr) 34px!important}.tr-audioQueueSelectorField .tr-sourceIcon,.tr-audioQueueSelectorField .tr-sourceChevron{width:34px!important}.tr-audioDeck--pro7 .tr-playerSourceTools .tr-audioQueueSelectorField select{font-size:11.5px!important;padding:0 6px!important}.tr-playerSourceTools .tr-dspStatusToggle{grid-template-columns:30px minmax(0,1fr) 18px!important;column-gap:8px!important;padding-left:8px!important;padding-right:28px!important}.tr-playerSourceTools .tr-dspStatusIcon{width:30px!important;height:30px!important;min-width:30px!important}.tr-playerSourceTools .tr-dspStatusCopy b{font-size:10.5px!important}.tr-playerSourceTools .tr-dspStatusCopy small{font-size:7.6px!important}.tr-audioEqQuickActions{grid-template-columns:1fr!important}.tr-audioEqQuickActions button{height:48px!important;min-height:48px!important}.tr-audioEqQuickActions button>span{font-size:11px!important}.tr-audioEqQuickActions button>i{font-size:6.8px!important}}
        @media(hover:none){.tr-playerTransportStage .tr-audioTransportButton:hover:not(:disabled),.tr-playerModeStage .tr-audioModeButton:hover:not(:disabled),.tr-playerSourceTools .tr-dspStatusToggle:hover,.tr-audioEqQuickActions button:hover,.tr-dspProfileSaveActions button.tr-savePresetCommand:hover{transform:none!important}}
        @media(prefers-reduced-motion:reduce){.tr-playerTransportStage .tr-audioTransportButton,.tr-playerModeStage .tr-audioModeButton,.tr-playerSourceTools .tr-dspStatusToggle,.tr-audioEqQuickActions button,.tr-dspProfileSaveActions .tr-savePresetCommand,.tr-dspChevron{animation:none!important;transition:none!important}.tr-playerTransportStage .tr-audioTransportButton:before,.tr-playerModeStage .tr-audioModeButton:before,.tr-playerSourceTools .tr-dspStatusToggle:before,.tr-audioEqQuickActions button:before,.tr-dspProfileSaveActions button.tr-savePresetCommand:before{display:none!important}}



        /* V13.8.2 PLAYER LAYOUT + READABILITY POLISH */
        .tr-playerTransportStage{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;justify-content:stretch!important;align-items:start!important}
        .tr-playerTransportStage .tr-audioTransportUnit{justify-items:stretch!important;align-items:center!important}
        .tr-playerTransportStage .tr-audioTransportButton{display:grid!important;place-items:center!important;padding:0!important}
        .tr-playerTransportStage .tr-audioTransportFace{display:grid!important;place-items:center!important;width:100%!important;height:100%!important}
        .tr-playerTransportStage .tr-audioTransportFace svg{width:30px!important;height:30px!important}
        .tr-playerTransportStage .tr-audioTransportUnit>span{display:block!important;width:100%!important;text-align:center!important}

        .tr-playerModeStage{display:flex!important;justify-content:center!important;align-items:center!important;flex-wrap:nowrap!important;gap:10px!important}
        .tr-playerModeStage .tr-audioModeButton{flex:0 1 170px!important;max-width:170px!important}

        .tr-audioQueueSelectorField{position:relative!important}
        .tr-audioQueueSelectorValue{position:absolute!important;left:35px!important;right:34px!important;top:0!important;bottom:0!important;display:flex!important;align-items:center!important;min-width:0!important;padding:0 10px!important;color:#f1f9fc!important;font-size:12px!important;line-height:1!important;font-weight:850!important;letter-spacing:.01em!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;pointer-events:none!important;z-index:0!important}
        .tr-audioDeck--pro7 .tr-playerSourceTools .tr-audioQueueSelectorField select{position:absolute!important;inset:0!important;z-index:2!important;opacity:0!important;cursor:pointer!important}
        .tr-audioQueueSelectorField .tr-sourceIcon,.tr-audioQueueSelectorField .tr-sourceChevron{position:relative!important;z-index:1!important}
        .tr-audioQueueSelectorField .tr-sourceChevron{justify-self:end!important}
        .tr-audioQueueSelectorField .tr-sourceChevron svg{margin-top:1px!important}

        .tr-outputProfileTitle,.tr-outputProfileSelectLabel,.tr-outputProfileTelemetryActive{min-width:0!important;align-items:center!important}
        .tr-outputProfileTitle{column-gap:12px!important}
        .tr-outputProfileTitle>span:last-child,.tr-outputProfileSelectLabel>b,.tr-outputProfileTelemetryActive>b{line-height:1.05!important}
        .tr-outputProfileIcon{display:grid!important;place-items:center!important;margin:0!important}
        .tr-outputProfileSelectLabel i,.tr-outputProfileTelemetryActive i{display:grid!important;place-items:center!important;margin:0!important;vertical-align:middle!important}
        .tr-outputProfileSelectLabel{column-gap:10px!important}
        .tr-outputProfileTelemetryActive{column-gap:9px!important}

        @media(max-width:650px){
          .tr-playerTransportStage{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:7px!important}
          .tr-playerTransportStage .tr-audioTransportButton{height:50px!important;min-height:50px!important}
          .tr-playerTransportStage .tr-audioTransportFace svg{width:24px!important;height:24px!important}
          .tr-playerTransportStage .tr-audioTransportUnit>span{font-size:8.7px!important;letter-spacing:.03em!important}
          .tr-playerModeStage{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;justify-content:stretch!important;gap:8px!important}
          .tr-playerModeStage .tr-audioModeButton{flex:none!important;max-width:none!important;width:100%!important}
          .tr-audioQueueSelectorValue{left:38px!important;right:38px!important;font-size:13px!important;padding:0 10px!important}
          .tr-outputProfileTitle{column-gap:10px!important}
          .tr-outputProfileSelectLabel{column-gap:9px!important}
          .tr-outputProfileTelemetryActive{column-gap:8px!important}
        }
        @media(max-width:390px){
          .tr-playerTransportStage .tr-audioTransportButton{height:48px!important;min-height:48px!important}
          .tr-playerTransportStage .tr-audioTransportFace svg{width:23px!important;height:23px!important}
          .tr-playerTransportStage .tr-audioTransportUnit>span{font-size:8.2px!important}
          .tr-playerModeStage{gap:7px!important}
          .tr-playerModeStage .tr-audioModeButton{height:42px!important;min-height:42px!important;padding:0 28px 0 10px!important;column-gap:6px!important}
          .tr-playerModeStage .tr-audioModeButton svg{width:16px!important;height:16px!important}
          .tr-playerModeStage .tr-audioModeButton>span{font-size:9px!important;letter-spacing:.02em!important}
          .tr-playerModeStage .tr-modeState{right:7px!important}
          .tr-audioQueueSelectorValue{font-size:12px!important;padding:0 8px!important}
        }
        @media(max-width:350px){
          .tr-playerTransportStage{gap:5px!important}
          .tr-playerTransportStage .tr-audioTransportFace svg{width:22px!important;height:22px!important}
          .tr-playerModeStage .tr-audioModeButton{padding:0 24px 0 9px!important}
          .tr-playerModeStage .tr-audioModeButton>span{font-size:8.6px!important}
          .tr-audioQueueSelectorValue{font-size:11.4px!important;padding:0 6px!important}
        }


        /* V13.8.3 MOBILE CONTROL LAYOUT — STRUCTURAL FIX */
        .tr-audioQueueSelectorValue--mobile{display:none!important}

        /* Force both mode controls to remain real, centered grid items. */
        .tr-playerModeStage .tr-audioModeButton.is-repeat,
        .tr-playerModeStage .tr-audioModeButton.is-shuffle{
          display:grid!important;
          position:relative!important;
          inset:auto!important;
          float:none!important;
          visibility:visible!important;
          opacity:1!important;
          transform:none!important;
          grid-column:auto!important;
          grid-row:auto!important;
          order:0!important;
        }

        @media(max-width:900px){
          /* Repeat + Shuffle are always a centered matched pair on phone/tablet layouts. */
          .tr-playerModeStage{
            display:grid!important;
            grid-template-columns:repeat(2,minmax(0,1fr))!important;
            width:calc(100% - 24px)!important;
            max-width:520px!important;
            margin:8px auto 12px!important;
            padding:0!important;
            gap:10px!important;
            justify-content:center!important;
            align-items:stretch!important;
            overflow:visible!important;
          }
          .tr-playerModeStage .tr-audioModeButton.is-repeat,
          .tr-playerModeStage .tr-audioModeButton.is-shuffle{
            width:100%!important;
            max-width:none!important;
            min-width:0!important;
            height:46px!important;
            min-height:46px!important;
            padding:0 34px 0 13px!important;
            grid-template-columns:18px minmax(0,1fr)!important;
            column-gap:8px!important;
          }
          .tr-playerModeStage .tr-audioModeButton>span{
            text-align:left!important;
            overflow:visible!important;
            text-overflow:clip!important;
          }

          /* Do not crush PLAYING FROM beside DSP/EQ on mobile. Stack both at full width. */
          .tr-playerUtilityRow{
            grid-template-columns:1fr!important;
            width:calc(100% - 24px)!important;
            margin-left:auto!important;
            margin-right:auto!important;
            gap:12px!important;
          }
          .tr-playerSourceTools{
            display:grid!important;
            grid-template-columns:1fr!important;
            width:100%!important;
            max-width:none!important;
            gap:10px!important;
          }
          .tr-audioDeck--pro7 .tr-playerSourceTools .tr-audioQueueSelector{
            width:100%!important;
            max-width:none!important;
            min-width:0!important;
          }
          .tr-audioQueueSelectorField{
            width:100%!important;
            height:50px!important;
            min-height:50px!important;
            grid-template-columns:42px minmax(0,1fr) 42px!important;
          }
          .tr-audioQueueSelectorField .tr-sourceIcon,
          .tr-audioQueueSelectorField .tr-sourceChevron{
            width:42px!important;
          }
          .tr-audioQueueSelectorValue{
            left:42px!important;
            right:42px!important;
            padding:0 12px!important;
            font-size:14px!important;
            font-weight:950!important;
            letter-spacing:.015em!important;
          }
          .tr-audioQueueSelectorValue--desktop{display:none!important}
          .tr-audioQueueSelectorValue--mobile{display:flex!important}
          .tr-playerSourceTools .tr-dspStatusToggle{
            width:100%!important;
            max-width:none!important;
            min-width:0!important;
            height:50px!important;
            min-height:50px!important;
          }
        }

        @media(max-width:650px){
          .tr-playerModeStage{
            width:calc(100% - 24px)!important;
            gap:8px!important;
          }
          .tr-playerModeStage .tr-audioModeButton.is-repeat,
          .tr-playerModeStage .tr-audioModeButton.is-shuffle{
            height:48px!important;
            min-height:48px!important;
          }
          .tr-playerTransportStage .tr-audioTransportFace svg{
            width:25px!important;
            height:25px!important;
          }
          .tr-audioQueueSelectorValue{
            font-size:13.5px!important;
          }
        }

        @media(max-width:390px){
          .tr-playerModeStage{gap:7px!important}
          .tr-playerModeStage .tr-audioModeButton.is-repeat,
          .tr-playerModeStage .tr-audioModeButton.is-shuffle{
            padding:0 30px 0 11px!important;
            column-gap:7px!important;
          }
          .tr-playerModeStage .tr-audioModeButton>span{
            font-size:9.4px!important;
          }
          .tr-playerModeStage .tr-modeState{
            right:8px!important;
            font-size:6.8px!important;
          }
          .tr-audioQueueSelectorValue{
            font-size:13px!important;
            padding:0 9px!important;
          }
        }

        @media(max-width:350px){
          .tr-playerModeStage{
            width:calc(100% - 20px)!important;
            gap:6px!important;
          }
          .tr-playerModeStage .tr-audioModeButton.is-repeat,
          .tr-playerModeStage .tr-audioModeButton.is-shuffle{
            padding:0 27px 0 9px!important;
            column-gap:5px!important;
          }
          .tr-playerModeStage .tr-audioModeButton>span{
            font-size:8.8px!important;
          }
          .tr-audioQueueSelectorValue{
            font-size:12.4px!important;
            padding:0 7px!important;
          }
        }


        /* V13.8.4 MOBILE SOURCE SELECTOR — HIGH-SPECIFICITY STRUCTURAL OVERRIDE */
        @media(max-width:900px){
          /* Force source + DSP to stack. Older source-tool rules must not be able to put them side-by-side. */
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools{
            display:flex!important;
            flex-direction:column!important;
            align-items:stretch!important;
            justify-content:flex-start!important;
            grid-template-columns:none!important;
            grid-auto-flow:row!important;
            width:100%!important;
            max-width:none!important;
            min-width:0!important;
            gap:10px!important;
            overflow:visible!important;
          }

          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-audioQueueSelector,
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-dspStatusToggle{
            display:block!important;
            position:relative!important;
            flex:0 0 auto!important;
            width:100%!important;
            max-width:none!important;
            min-width:0!important;
            margin:0!important;
            grid-column:1/-1!important;
            grid-row:auto!important;
            align-self:stretch!important;
          }

          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-audioQueueSelector{
            display:grid!important;
            gap:7px!important;
          }

          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-audioQueueSelectorField{
            width:100%!important;
            max-width:none!important;
            min-width:0!important;
            height:52px!important;
            min-height:52px!important;
            grid-template-columns:44px minmax(0,1fr) 44px!important;
            border-radius:12px!important;
          }

          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-audioQueueSelectorField .tr-sourceIcon,
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-audioQueueSelectorField .tr-sourceChevron{
            width:44px!important;
            min-width:44px!important;
          }

          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-audioQueueSelectorValue{
            left:44px!important;
            right:44px!important;
            padding:0 13px!important;
            font-size:14px!important;
            line-height:1!important;
            font-weight:1000!important;
            letter-spacing:.025em!important;
            text-transform:uppercase!important;
            white-space:nowrap!important;
            overflow:hidden!important;
            text-overflow:ellipsis!important;
          }

          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-dspStatusToggle{
            display:grid!important;
            height:52px!important;
            min-height:52px!important;
            grid-template-columns:34px minmax(0,1fr) 20px!important;
            column-gap:11px!important;
            padding:0 34px 0 11px!important;
            border-radius:12px!important;
          }

          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-dspStatusToggle .tr-dspStatusIcon{
            width:34px!important;
            min-width:34px!important;
            height:34px!important;
          }
        }

        @media(max-width:650px){
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow{
            width:calc(100% - 24px)!important;
            margin-left:auto!important;
            margin-right:auto!important;
          }

          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-audioQueueSelector > span:first-child{
            display:block!important;
            font-size:11px!important;
            line-height:1!important;
            letter-spacing:.14em!important;
            font-weight:1000!important;
            color:#9db3bd!important;
          }

          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools{
            gap:9px!important;
          }
        }

        @media(max-width:390px){
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-audioQueueSelectorValue{
            font-size:13.5px!important;
            padding:0 11px!important;
          }

          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-dspStatusToggle{
            grid-template-columns:32px minmax(0,1fr) 19px!important;
            column-gap:10px!important;
            padding-left:10px!important;
            padding-right:32px!important;
          }

          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-dspStatusToggle .tr-dspStatusIcon{
            width:32px!important;
            min-width:32px!important;
            height:32px!important;
          }
        }

        @media(max-width:350px){
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow{
            width:calc(100% - 20px)!important;
          }

          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-audioQueueSelectorValue{
            font-size:13px!important;
            padding:0 9px!important;
          }
        }


        /* V13.8.5 SOURCE LABEL AUTO-FIT */
        .tr-audioQueueSelectorValue{
          text-transform:none!important;
          min-width:0!important;
          max-width:none!important;
          white-space:nowrap!important;
          overflow:hidden!important;
          text-overflow:clip!important;
          line-height:1!important;
          font-weight:950!important;
        }

        /* Only fall back to an ellipsis if an unusually long name still cannot fit at the safe minimum. */
        .tr-audioQueueSelectorValue[style*="10.5px"],
        .tr-audioQueueSelectorValue[style*="9.5px"]{
          text-overflow:ellipsis!important;
        }



        /* V13.9.2 STRUCTURAL MOBILE RESTORE + DSP PLACEMENT */
        .tr-mobileDspStatusToggle{
          display:none;
        }

        /* Hard-lock High-Fidelity Output icon + text horizontally on every viewport. */
        .tr-outputProfileIntro > .tr-outputProfileTitle{
          display:flex!important;
          flex-direction:row!important;
          flex-wrap:nowrap!important;
          align-items:center!important;
          justify-content:flex-start!important;
          gap:12px!important;
          width:100%!important;
          min-width:0!important;
          margin:0!important;
          padding:0!important;
          color:#f4fbfe!important;
          font-size:16px!important;
          line-height:1.05!important;
          font-weight:1000!important;
        }
        .tr-outputProfileIntro > .tr-outputProfileTitle > .tr-outputProfileIcon{
          flex:0 0 31px!important;
          width:31px!important;
          min-width:31px!important;
          height:31px!important;
          margin:0!important;
        }
        .tr-outputProfileIntro > .tr-outputProfileTitle > .tr-outputProfileTitleText{
          display:block!important;
          flex:1 1 auto!important;
          min-width:0!important;
          width:auto!important;
          margin:0!important;
          padding:0!important;
          white-space:nowrap!important;
          overflow:visible!important;
          text-overflow:clip!important;
          line-height:1.05!important;
        }

        @media(max-width:650px){
          /* Keep the known-good V13.8.5 player as a single vertical stack. */
          .tr-audioDeck.tr-audioDeck--pro7{
            display:block!important;
            width:100%!important;
            max-width:100%!important;
            min-width:0!important;
            overflow:hidden!important;
          }
          .tr-audioDeck.tr-audioDeck--pro7 > *{
            max-width:100%!important;
            min-width:0!important;
          }
          .tr-playerHero,
          .tr-playerTransportStage,
          .tr-playerModeStage,
          .tr-activityRta,
          .tr-playerUtilityRow,
          .tr-audioEqPanel{
            grid-column:auto!important;
            grid-row:auto!important;
            float:none!important;
          }

          /* DSP/EQ lives directly below Repeat/Shuffle on mobile. */
          .tr-mobileDspStatusToggle{
            position:relative!important;
            isolation:isolate!important;
            width:calc(100% - 24px)!important;
            max-width:none!important;
            min-width:0!important;
            height:52px!important;
            min-height:52px!important;
            margin:0 auto 9px!important;
            padding:0 38px 0 11px!important;
            display:grid!important;
            grid-template-columns:34px minmax(0,1fr) 20px!important;
            align-items:center!important;
            column-gap:11px!important;
            border:1px solid rgba(69,208,249,.42)!important;
            border-radius:12px!important;
            background:linear-gradient(180deg,#0b2c39,#061821)!important;
            color:#effbff!important;
            box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 8px 20px rgba(0,0,0,.24)!important;
            cursor:pointer!important;
            overflow:hidden!important;
          }
          .tr-mobileDspStatusToggle.is-active{
            border-color:rgba(77,220,255,.72)!important;
            background:linear-gradient(180deg,#0d4052,#072631)!important;
            box-shadow:inset 0 -2px rgba(67,213,250,.72),0 0 20px rgba(50,195,239,.13)!important;
          }
          .tr-mobileDspStatusIcon{
            width:34px!important;
            min-width:34px!important;
            height:34px!important;
            display:grid!important;
            place-items:center!important;
            border:1px solid rgba(94,208,242,.22)!important;
            border-radius:9px!important;
            background:rgba(4,27,36,.78)!important;
            color:#8be6ff!important;
          }
          .tr-mobileDspStatusIcon svg{
            width:19px!important;
            height:19px!important;
            fill:currentColor!important;
          }
          .tr-mobileDspStatusCopy{
            min-width:0!important;
            display:grid!important;
            align-content:center!important;
            justify-items:start!important;
            gap:3px!important;
            text-align:left!important;
          }
          .tr-mobileDspStatusCopy b{
            color:#fff!important;
            font-size:12px!important;
            line-height:1!important;
            font-weight:1100!important;
            letter-spacing:.055em!important;
            white-space:nowrap!important;
          }
          .tr-mobileDspStatusCopy small{
            display:block!important;
            max-width:100%!important;
            color:#8faeba!important;
            font-size:8.5px!important;
            line-height:1!important;
            font-weight:900!important;
            white-space:nowrap!important;
            overflow:hidden!important;
            text-overflow:clip!important;
          }
          .tr-mobileDspChevron{
            width:20px!important;
            height:20px!important;
            display:grid!important;
            place-items:center!important;
            color:#93dff7!important;
            transition:transform .18s ease!important;
          }
          .tr-mobileDspChevron.is-open{transform:rotate(180deg)!important}
          .tr-mobileDspChevron svg{width:15px!important;height:15px!important;fill:none!important;stroke:currentColor!important;stroke-width:2!important}
          .tr-mobileDspStatusLed{
            position:absolute!important;
            right:11px!important;
            top:10px!important;
            width:7px!important;
            height:7px!important;
            border-radius:50%!important;
            background:#68777d!important;
          }
          .tr-mobileDspStatusLed.is-active{background:#5ae4aa!important;box-shadow:0 0 9px rgba(90,228,170,.55)!important}
          .tr-mobileDspStatusLed.is-recovering{background:#ffbf59!important;box-shadow:0 0 9px rgba(255,191,89,.48)!important}
          .tr-mobileDspStatusLed.is-unavailable{background:#ff7474!important;box-shadow:0 0 9px rgba(255,116,116,.45)!important}

          /* Hide the old utility-row DSP button on mobile so it is not duplicated below PLAYING FROM. */
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-dspStatusToggle{
            display:none!important;
          }
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools{
            display:block!important;
            width:100%!important;
          }
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-audioQueueSelector{
            display:grid!important;
            width:100%!important;
            max-width:none!important;
            min-width:0!important;
          }

          /* High-Fidelity Output remains icon -> gap -> text, never stacked. */
          .tr-outputProfileIntro > .tr-outputProfileTitle{
            display:flex!important;
            flex-direction:row!important;
            flex-wrap:nowrap!important;
            align-items:center!important;
            gap:10px!important;
            font-size:15px!important;
          }
          .tr-outputProfileIntro > .tr-outputProfileTitle > .tr-outputProfileIcon{
            flex-basis:30px!important;
            width:30px!important;
            min-width:30px!important;
            height:30px!important;
          }
          .tr-outputProfileIntro > .tr-outputProfileTitle > .tr-outputProfileTitleText{
            min-width:0!important;
            font-size:15px!important;
            white-space:nowrap!important;
          }
        }

        @media(max-width:390px){
          .tr-mobileDspStatusToggle{
            width:calc(100% - 20px)!important;
            grid-template-columns:32px minmax(0,1fr) 18px!important;
            column-gap:9px!important;
            padding-left:9px!important;
            padding-right:34px!important;
          }
          .tr-mobileDspStatusIcon{width:32px!important;min-width:32px!important;height:32px!important}
          .tr-mobileDspStatusCopy b{font-size:11px!important}
          .tr-mobileDspStatusCopy small{font-size:7.8px!important}
          .tr-outputProfileIntro > .tr-outputProfileTitle{font-size:14px!important;gap:9px!important}
          .tr-outputProfileIntro > .tr-outputProfileTitle > .tr-outputProfileTitleText{font-size:14px!important}
        }


        /* V13.9.3 SOURCE QUALITY + UPGRADE SOURCE. The V13.8.5 hero visual engine above is untouched. */
        .tr-rtaFidelityHead>strong{
          display:flex!important;
          align-items:center!important;
          justify-content:flex-end!important;
          gap:6px!important;
          min-width:0!important;
        }
        .tr-rtaSourceQuality{
          display:inline-flex!important;
          align-items:center!important;
          gap:5px!important;
          min-width:0!important;
          white-space:nowrap!important;
          font-variant-numeric:tabular-nums!important;
        }
        .tr-rtaSourceQuality>span{white-space:nowrap!important}
        .tr-rtaSourceQuality em{
          font-style:normal!important;
          font-size:.86em!important;
          font-weight:1100!important;
          letter-spacing:.045em!important;
        }
        .tr-rtaSourceQuality.is-lossless{color:#66e9c0!important}
        .tr-rtaSourceQuality.is-high{color:#68e6a8!important}
        .tr-rtaSourceQuality.is-good{color:#68dfff!important}
        .tr-rtaSourceQuality.is-standard{color:#ffd36b!important}
        .tr-rtaSourceQuality.is-low{color:#ff8b63!important}
        .tr-rtaSourceQuality.is-unknown{color:#9eb1ba!important}
        .tr-rtaHeadDivider{color:#506973!important;margin:0 1px!important}
        .tr-rtaEqCopy{white-space:nowrap!important}

        .tr-sourceQualityPanel{
          margin:10px 0 12px!important;
          padding:12px 13px!important;
          display:grid!important;
          grid-template-columns:minmax(0,1fr) auto!important;
          align-items:center!important;
          gap:12px!important;
          border:1px solid rgba(103,192,222,.18)!important;
          border-radius:12px!important;
          background:linear-gradient(180deg,rgba(8,24,32,.86),rgba(3,11,16,.94))!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.035)!important;
        }
        .tr-sourceQualityPanel.is-low{border-color:rgba(255,120,77,.30)!important;background:linear-gradient(180deg,rgba(45,20,12,.72),rgba(15,8,5,.92))!important}
        .tr-sourceQualityPanel.is-standard{border-color:rgba(255,201,82,.26)!important}
        .tr-sourceQualityPanel.is-lossless{border-color:rgba(85,226,183,.28)!important}
        .tr-sourceQualityCopy{min-width:0!important;display:grid!important;gap:4px!important}
        .tr-sourceQualityCopy>span{color:#6ddcf8!important;font-size:7px!important;font-weight:1100!important;letter-spacing:.15em!important}
        .tr-sourceQualityCopy>strong{color:#f5fbfd!important;font-size:13px!important;line-height:1.05!important;font-weight:1100!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;font-variant-numeric:tabular-nums!important}
        .tr-sourceQualityCopy>small{color:#7f9ca7!important;font-size:8.5px!important;line-height:1.35!important;font-weight:750!important}
        .tr-sourceUpgradeButton,.tr-sourceQualityOk{
          min-height:38px!important;
          padding:0 13px!important;
          display:inline-flex!important;
          align-items:center!important;
          justify-content:center!important;
          border-radius:9px!important;
          font-size:8px!important;
          font-weight:1100!important;
          letter-spacing:.07em!important;
          white-space:nowrap!important;
        }
        .tr-sourceUpgradeButton{
          border:1px solid rgba(255,170,66,.43)!important;
          background:linear-gradient(180deg,#5a3208,#241505)!important;
          color:#ffd28d!important;
          cursor:pointer!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 0 18px rgba(255,142,27,.08)!important;
        }
        .tr-sourceQualityOk{border:1px solid rgba(82,220,168,.23)!important;background:rgba(22,92,67,.16)!important;color:#72e8b5!important}

        .tr-sourceUpgradeBack{
          position:fixed!important;
          inset:0!important;
          z-index:9200!important;
          display:grid!important;
          place-items:center!important;
          padding:16px!important;
          background:rgba(0,4,7,.88)!important;
          backdrop-filter:blur(10px)!important;
          -webkit-backdrop-filter:blur(10px)!important;
        }
        .tr-sourceUpgradeDialog{
          width:min(620px,100%)!important;
          max-height:calc(100dvh - 32px)!important;
          overflow:auto!important;
          border:1px solid rgba(71,201,241,.34)!important;
          border-radius:17px!important;
          background:linear-gradient(180deg,#0a1d26,#040a0e)!important;
          box-shadow:0 32px 90px rgba(0,0,0,.70),inset 0 1px 0 rgba(255,255,255,.045)!important;
        }
        .tr-sourceUpgradeDialog>header{
          padding:15px 17px!important;
          display:flex!important;
          align-items:center!important;
          justify-content:space-between!important;
          gap:12px!important;
          border-bottom:1px solid rgba(89,180,211,.12)!important;
        }
        .tr-sourceUpgradeDialog>header>div{min-width:0!important;display:grid!important;gap:4px!important}
        .tr-sourceUpgradeDialog>header small{color:#5ed9fb!important;font-size:7px!important;font-weight:1100!important;letter-spacing:.15em!important}
        .tr-sourceUpgradeDialog h3{margin:0!important;color:#f6fbfd!important;font-size:18px!important;line-height:1.1!important}
        .tr-sourceUpgradeDialog>header>button{
          width:34px!important;height:34px!important;border:1px solid rgba(120,190,215,.17)!important;border-radius:9px!important;background:#07131a!important;color:#eef9fc!important;font-size:20px!important;cursor:pointer!important;
        }
        .tr-sourceUpgradeCompare{
          padding:15px 17px 10px!important;
          display:grid!important;
          grid-template-columns:minmax(0,1fr) 28px minmax(0,1fr)!important;
          align-items:stretch!important;
          gap:8px!important;
        }
        .tr-sourceUpgradeCompare article{
          min-width:0!important;
          padding:12px!important;
          display:grid!important;
          align-content:center!important;
          gap:5px!important;
          border:1px solid rgba(255,255,255,.07)!important;
          border-radius:11px!important;
          background:rgba(0,0,0,.18)!important;
        }
        .tr-sourceUpgradeCompare article.has-candidate{border-color:rgba(79,206,242,.24)!important}
        .tr-sourceUpgradeCompare article>span{color:#7795a1!important;font-size:7px!important;font-weight:1100!important;letter-spacing:.11em!important}
        .tr-sourceUpgradeCompare article>strong{min-width:0!important;color:#f5fafc!important;font-size:12px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;font-variant-numeric:tabular-nums!important}
        .tr-sourceUpgradeCompare article>small{color:#8da2ab!important;font-size:8px!important;font-weight:1100!important;letter-spacing:.06em!important}
        .tr-sourceUpgradeCompare article>small.is-lossless{color:#68e6bd!important}.tr-sourceUpgradeCompare article>small.is-high{color:#68e6a8!important}.tr-sourceUpgradeCompare article>small.is-good{color:#68dfff!important}.tr-sourceUpgradeCompare article>small.is-standard{color:#ffd36b!important}.tr-sourceUpgradeCompare article>small.is-low{color:#ff8b63!important}
        .tr-sourceUpgradeArrow{display:grid!important;place-items:center!important;color:#60dafa!important;font-size:20px!important;font-weight:900!important}
        .tr-sourceUpgradeHiddenInput{display:none!important}
        .tr-sourceUpgradeChoose{
          width:calc(100% - 34px)!important;
          min-height:42px!important;
          margin:2px 17px 10px!important;
          border:1px solid rgba(86,205,240,.31)!important;
          border-radius:10px!important;
          background:linear-gradient(180deg,#0c2f3d,#061821)!important;
          color:#eafaff!important;
          font-size:9px!important;
          font-weight:1100!important;
          letter-spacing:.07em!important;
          cursor:pointer!important;
        }
        .tr-sourceUpgradeVerdict,.tr-sourceUpgradeMessage,.tr-sourceUpgradeSafety{
          margin:0 17px 10px!important;
          padding:10px 12px!important;
          display:grid!important;
          gap:4px!important;
          border-radius:10px!important;
          font-size:9px!important;
          line-height:1.35!important;
        }
        .tr-sourceUpgradeVerdict{border:1px solid rgba(255,255,255,.08)!important;background:rgba(0,0,0,.18)!important;color:#afc3cc!important}
        .tr-sourceUpgradeVerdict.is-upgrade{border-color:rgba(73,221,158,.30)!important;background:rgba(18,95,61,.16)!important}.tr-sourceUpgradeVerdict.is-upgrade strong{color:#79e9b4!important}
        .tr-sourceUpgradeVerdict.is-no-upgrade{border-color:rgba(255,151,71,.27)!important;background:rgba(86,41,11,.16)!important}.tr-sourceUpgradeVerdict.is-no-upgrade strong{color:#ffc070!important}
        .tr-sourceUpgradeVerdict small{color:#738d98!important}
        .tr-sourceUpgradeMessage.is-ok{border:1px solid rgba(70,222,158,.30)!important;background:rgba(16,92,60,.18)!important;color:#78e8b3!important;font-weight:1000!important}
        .tr-sourceUpgradeMessage.is-error{border:1px solid rgba(255,105,105,.26)!important;background:rgba(94,24,24,.18)!important;color:#ffabab!important;font-weight:900!important}
        .tr-sourceUpgradeSafety{border:1px solid rgba(255,255,255,.06)!important;background:rgba(0,0,0,.13)!important;color:#7f98a3!important}.tr-sourceUpgradeSafety b{color:#dcecf2!important;font-size:7px!important;letter-spacing:.11em!important}
        .tr-sourceUpgradeDialog>footer{padding:7px 17px 17px!important;display:flex!important;justify-content:flex-end!important;gap:8px!important}
        .tr-sourceUpgradeDialog>footer button{min-height:39px!important;padding:0 15px!important;border:1px solid rgba(112,190,217,.15)!important;border-radius:9px!important;background:#0a151b!important;color:#dcecf2!important;font-size:8px!important;font-weight:1100!important;cursor:pointer!important}
        .tr-sourceUpgradeDialog>footer button.is-primary{border-color:rgba(255,180,72,.40)!important;background:linear-gradient(180deg,#ffc45c,#ef9717)!important;color:#191007!important}
        .tr-sourceUpgradeDialog button:disabled{opacity:.42!important;cursor:not-allowed!important}

        @media(max-width:650px){
          .tr-rtaFidelityHead>strong{gap:4px!important}
          .tr-rtaSourceQuality{font-size:6.2px!important;gap:2px!important;letter-spacing:-.01em!important}
          .tr-rtaSourceQuality em{display:none!important}
          .tr-rtaHeadDivider{margin:0!important}
          .tr-sourceQualityPanel{grid-template-columns:1fr!important;gap:9px!important;padding:11px!important}
          .tr-sourceQualityCopy>strong{font-size:11px!important}
          .tr-sourceUpgradeButton,.tr-sourceQualityOk{width:100%!important;min-height:40px!important}
          .tr-sourceUpgradeBack{padding:8px!important}
          .tr-sourceUpgradeDialog{max-height:calc(100dvh - 16px)!important;border-radius:14px!important}
          .tr-sourceUpgradeCompare{grid-template-columns:1fr!important;gap:7px!important;padding:12px!important}
          .tr-sourceUpgradeArrow{transform:rotate(90deg)!important;height:20px!important}
          .tr-sourceUpgradeChoose{width:calc(100% - 24px)!important;margin:2px 12px 9px!important}
          .tr-sourceUpgradeVerdict,.tr-sourceUpgradeMessage,.tr-sourceUpgradeSafety{margin-left:12px!important;margin-right:12px!important}
          .tr-sourceUpgradeDialog>footer{padding:7px 12px 13px!important}.tr-sourceUpgradeDialog>footer button{flex:1!important;min-width:0!important}
        }
        @media(max-width:430px){
          .tr-rtaEqCopy,.tr-rtaFidelityHead>strong>b{display:none!important}
          .tr-rtaSourceQuality{font-size:5.9px!important}
          .tr-rtaFidelityHead>strong{gap:3px!important}
        }

        /* MVP_STUDIO_WASM_V2_PHASE3_LOUDNESS CRISP ENGINE LABEL */
        /* MVP_STUDIO_WASM_V2_PHASE3_1_VOLUME_MATCH */
        .tr-rtaEngineBadge{
          display:inline-flex!important;align-items:center!important;gap:4px!important;margin-left:7px!important;padding:0!important;
          border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;
          color:#f4f6f7!important;font-size:8.2px!important;font-weight:800!important;letter-spacing:.035em!important;line-height:1!important;
          text-shadow:none!important;filter:none!important;white-space:nowrap!important;vertical-align:middle!important;
          text-rendering:geometricPrecision!important;-webkit-font-smoothing:antialiased!important;
        }
        .tr-rtaEngineBadge svg{width:15px!important;height:9px!important;fill:none!important;stroke:currentColor!important;stroke-width:1.85!important;stroke-linecap:round!important;stroke-linejoin:round!important;filter:none!important;shape-rendering:geometricPrecision!important}
        .tr-rtaEngineBadge b{margin:0!important;color:inherit!important;font:inherit!important;font-weight:800!important;letter-spacing:inherit!important;text-shadow:none!important}
        .tr-rtaEngineBadge.is-studio{color:#f4f6f7!important}
        .tr-rtaEngineBadge.is-worklet{color:#ffc05d!important}
        .tr-rtaEngineBadge.is-native,.tr-rtaEngineBadge.is-unavailable{color:#ff6d67!important}
        @media(max-width:650px){
          .tr-rtaEngineBadge{gap:3px!important;margin-left:4px!important;font-size:6.4px!important;letter-spacing:.015em!important}
          .tr-rtaEngineBadge svg{width:11px!important;height:7px!important;stroke-width:1.75!important}
          .tr-rtaEngineBadge b{font-size:inherit!important}
        }
        /* V13.9.13 31-BAND EQ GEOMETRY LOCK: one gain + one centered slider + one label per frequency */
        .tr-audioEqBands--31{
          display:grid!important;
          grid-template-columns:repeat(31,48px)!important;
          grid-auto-columns:48px!important;
          gap:6px!important;
          width:max-content!important;
          min-width:max-content!important;
          padding:0 6px!important;
          align-items:stretch!important;
          box-sizing:border-box!important;
        }
        .tr-audioEqBands--31 .tr-audioEqBand{
          position:relative!important;
          width:48px!important;
          min-width:48px!important;
          max-width:48px!important;
          height:178px!important;
          padding:7px 2px 6px!important;
          margin:0!important;
          display:grid!important;
          grid-template-rows:24px 126px 15px!important;
          justify-items:center!important;
          align-items:center!important;
          gap:0!important;
          box-sizing:border-box!important;
          overflow:visible!important;
          text-align:center!important;
        }
        .tr-audioEqBands--31 .tr-audioEqGain{
          display:block!important;
          width:100%!important;
          min-width:0!important;
          margin:0!important;
          padding:0!important;
          align-self:center!important;
          justify-self:center!important;
          text-align:center!important;
          color:#ff9f2f!important;
          font-size:7.5px!important;
          line-height:1!important;
          font-weight:1000!important;
          letter-spacing:-.02em!important;
          white-space:nowrap!important;
          font-variant-numeric:tabular-nums!important;
          text-shadow:0 0 8px rgba(255,159,47,.16)!important;
        }
        .tr-audioEqBands--31 .tr-audioEqSliderShell{
          position:relative!important;
          display:block!important;
          width:48px!important;
          min-width:48px!important;
          max-width:48px!important;
          height:126px!important;
          margin:0!important;
          padding:0!important;
          justify-self:center!important;
          align-self:center!important;
          overflow:visible!important;
          box-sizing:border-box!important;
        }
        .tr-audioEqBands--31 .tr-audioEqSliderShell input[type="range"]{
          position:absolute!important;
          inset:auto!important;
          left:50%!important;
          top:50%!important;
          right:auto!important;
          bottom:auto!important;
          width:112px!important;
          min-width:112px!important;
          max-width:112px!important;
          height:18px!important;
          margin:0!important;
          padding:0!important;
          transform:translate(-50%,-50%) rotate(-90deg)!important;
          transform-origin:50% 50%!important;
          accent-color:#43d3ff!important;
          box-sizing:border-box!important;
          cursor:pointer!important;
          z-index:2!important;
        }
        .tr-audioEqBands--31 .tr-audioEqFrequency{
          display:block!important;
          width:100%!important;
          min-width:0!important;
          margin:0!important;
          padding:0!important;
          align-self:end!important;
          justify-self:center!important;
          text-align:center!important;
          color:#ffffff!important;
          font-size:8px!important;
          line-height:1!important;
          font-weight:1000!important;
          letter-spacing:.01em!important;
          white-space:nowrap!important;
          text-shadow:0 0 8px rgba(255,255,255,.14)!important;
        }
        @media(max-width:700px){
          .tr-audioEqBands--31{grid-template-columns:repeat(31,48px)!important;grid-auto-columns:48px!important;min-width:max-content!important;width:max-content!important}
          .tr-audioEqBands--31 .tr-audioEqBand{width:48px!important;min-width:48px!important;max-width:48px!important}
        }

        .tr-studioMeterPanel{margin:10px 0 12px;padding:12px;border:1px solid rgba(102,190,219,.16);border-radius:12px;background:linear-gradient(180deg,rgba(7,22,30,.91),rgba(2,10,14,.96));box-shadow:inset 0 1px 0 rgba(255,255,255,.025)}.tr-studioMeterPanel>header{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:9px}.tr-studioMeterPanel>header>div{display:grid;gap:2px}.tr-studioMeterPanel>header span{color:#6fbdd7;font-size:6.5px;font-weight:1000;letter-spacing:.13em}.tr-studioMeterPanel>header strong{color:#edf7fa;font-size:10px;letter-spacing:.035em}.tr-studioMeterPanel>header small{color:#72919d;font-size:6.5px;font-weight:900;letter-spacing:.08em}.tr-studioMeterGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.tr-studioMeterGrid article{min-width:0;padding:9px 9px 8px;border:1px solid rgba(112,182,205,.10);border-radius:9px;background:linear-gradient(180deg,rgba(13,31,40,.72),rgba(2,9,13,.78));box-shadow:inset 0 1px 0 rgba(255,255,255,.02)}.tr-studioMeterGrid article>span{display:block;color:#718d98;font-size:6px;font-weight:1000;letter-spacing:.09em;white-space:nowrap}.tr-studioMeterGrid article>strong{display:block;margin-top:4px;color:#f2f8fa;font-size:12px;line-height:1;font-variant-numeric:tabular-nums}.tr-studioMeterGrid article>i{display:block;height:3px;margin:8px 0 6px;border-radius:999px;background:rgba(121,165,179,.12);overflow:hidden}.tr-studioMeterGrid article>i>b{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#29c7e8,#83e5d0);transition:width .16s linear}.tr-studioMeterGrid article[data-meter="peak"]>i>b,.tr-studioMeterGrid article[data-meter="limiter"]>i>b{background:linear-gradient(90deg,#f1cf55,#ff914d)}.tr-studioMeterGrid article>small{display:block;min-height:18px;color:#63808b;font-size:6.3px;line-height:1.35;font-weight:750}.tr-studioMeterGrid article[data-meter="peak"]>strong{color:#ffd36a}.tr-studioMeterGrid article[data-meter="limiter"]>strong{color:#ffb57d}
        @media(max-width:700px){.tr-studioMeterPanel>header{align-items:flex-start;flex-direction:column;gap:4px}.tr-studioMeterGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        .tr-studioProcessingPanel{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:10px!important;margin:10px 0 12px!important}
        .tr-studioProcessingPanel button{min-width:0!important;min-height:72px!important;padding:11px 12px!important;display:grid!important;grid-template-columns:1fr auto!important;grid-template-rows:auto auto!important;gap:5px 10px!important;align-items:center!important;text-align:left!important;border:1px solid rgba(99,181,211,.18)!important;border-radius:11px!important;background:linear-gradient(180deg,rgba(7,25,34,.92),rgba(3,12,17,.96))!important;color:#eefaff!important;box-shadow:inset 0 1px rgba(255,255,255,.035)!important}
        .tr-studioProcessingPanel button>span{font-size:8px!important;font-weight:1000!important;letter-spacing:.09em!important;color:#8bb8c8!important}.tr-studioProcessingPanel button>strong{font-size:9px!important;font-weight:1000!important;color:#819ba5!important;white-space:nowrap!important}.tr-studioProcessingPanel button>small{grid-column:1/-1!important;font-size:7.5px!important;line-height:1.35!important;color:#78919b!important;font-weight:750!important}
        .tr-studioProcessingPanel button.is-active{border-color:rgba(79,214,251,.42)!important;background:linear-gradient(180deg,rgba(8,47,61,.92),rgba(4,24,33,.97))!important;box-shadow:inset 0 1px rgba(255,255,255,.045),0 0 18px rgba(55,201,241,.07)!important}.tr-studioProcessingPanel button.is-active>span{color:#63dcff!important}.tr-studioProcessingPanel button.is-active>strong{color:#8ef0c0!important}.tr-studioProcessingPanel button:disabled{opacity:.46!important;cursor:not-allowed!important}
        @media(max-width:700px){.tr-studioProcessingPanel{grid-template-columns:1fr!important}.tr-studioProcessingPanel button{min-height:76px!important;padding:12px!important}.tr-studioProcessingPanel button>span{font-size:8.5px!important}.tr-studioProcessingPanel button>strong{font-size:9.5px!important}.tr-studioProcessingPanel button>small{font-size:8px!important}}


        /* MVP_STUDIO_V4_MASTERING_REFINEMENT — desktop geometry + full responsive polish */
        .tr-studioMeterGrid article i b{transition:width .18s ease-out!important}
        .tr-dspProofStatus{align-items:center!important;gap:7px 9px!important}
        .tr-studioProcessingPanel button,.tr-studioMeterGrid article{min-width:0!important}
        .tr-dspAbControls .tr-dspBypassButton{white-space:nowrap!important}
        @media(min-width:701px){
          .tr-playerUtilityRow{align-items:end!important}
          .tr-playerSourceTools{align-items:end!important}
          .tr-playerSourceTools>.tr-audioQueueSelector{align-self:end!important}
          .tr-playerSourceTools>.tr-dspStatusToggle{align-self:end!important;margin:0!important;height:50px!important;min-height:50px!important}
          .tr-playerSourceTools .tr-audioQueueSelectorField{height:50px!important;min-height:50px!important}
          .tr-studioMeterGrid{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:8px!important}
        }
        @media(max-width:700px){
          .tr-audioEqPanel--pro7{width:calc(100% - 16px)!important;margin-left:auto!important;margin-right:auto!important;padding:10px!important;padding-bottom:104px!important;box-sizing:border-box!important}
          .tr-outputProfilePanel{grid-template-columns:1fr!important;gap:11px!important}
          .tr-outputProfileSelect{width:100%!important;max-width:none!important}
          .tr-outputProfileChoices{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}
          .tr-outputProfileChoices button{min-height:46px!important}
          .tr-outputProfileTelemetry{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:7px!important}
          .tr-sourceQualityPanel{grid-template-columns:1fr!important}
          .tr-preampTrim{grid-template-columns:1fr!important;gap:10px!important;padding:12px!important}
          .tr-preampTrimControl{width:100%!important;min-width:0!important}
          .tr-preampAutoButton{width:100%!important;min-height:42px!important}
          .tr-preampTrimScale{position:relative!important}
          .tr-dspProofStatus{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:7px!important}
          .tr-dspProofStatus>span{min-width:0!important;white-space:normal!important;line-height:1.25!important}
          .tr-studioMeterGrid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}
          .tr-studioMeterGrid article{padding:10px!important;min-height:82px!important}
          .tr-studioProcessingPanel{grid-template-columns:1fr!important;gap:8px!important}
          .tr-studioProcessingPanel button{min-height:74px!important}
          .tr-audioEqHead{grid-template-columns:1fr!important;gap:10px!important;align-items:stretch!important}
          .tr-dspAbControls{display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px!important;width:100%!important}
          .tr-dspAbControls>*{width:100%!important;min-width:0!important}
          .tr-audioEqPreset{width:100%!important;max-width:none!important}
          .tr-audioEqPreset select{width:100%!important;min-height:44px!important}
          .tr-eqArchitecturePanel{grid-template-columns:1fr!important;gap:10px!important}
          .tr-eqArchitectureButtons{display:grid!important;grid-template-columns:1fr 1fr!important;gap:7px!important}
          .tr-eqArchitectureButtons button{min-height:42px!important}
          .tr-audioEqScroll{padding-bottom:8px!important;overscroll-behavior-inline:contain!important;scrollbar-width:thin!important}
          .tr-audioEqBands--31{grid-template-columns:repeat(31,52px)!important;grid-auto-columns:52px!important;gap:7px!important;padding:0 8px!important}
          .tr-audioEqBands--31 .tr-audioEqBand{width:52px!important;min-width:52px!important;max-width:52px!important;height:190px!important;grid-template-rows:25px 138px 16px!important}
          .tr-audioEqBands--31 .tr-audioEqSliderShell{width:52px!important;min-width:52px!important;max-width:52px!important;height:138px!important}
          .tr-audioEqBands--31 .tr-audioEqSliderShell input[type="range"]{width:122px!important;min-width:122px!important;max-width:122px!important;height:22px!important}
          .tr-audioEqBands--31 .tr-audioEqGain{font-size:8px!important}
          .tr-audioEqBands--31 .tr-audioEqFrequency{font-size:8.5px!important}
        }
        @media(max-width:430px){
          .tr-audioEqPanel--pro7{width:calc(100% - 10px)!important;padding:8px!important;padding-bottom:108px!important}
          .tr-playerUtilityRow{gap:10px!important}
          .tr-outputProfileTelemetry{grid-template-columns:1fr 1fr!important}
          .tr-dspProofStatus{grid-template-columns:1fr!important}
          .tr-studioMeterGrid{grid-template-columns:1fr!important}
          .tr-studioMeterGrid article{min-height:76px!important}
          .tr-dspAbControls{grid-template-columns:1fr 1fr!important}
          .tr-dspAbControls .tr-audioEqSwitch,.tr-dspAbControls .tr-dspBypassButton{min-height:42px!important}
          .tr-eqArchitectureButtons{grid-template-columns:1fr 1fr!important}
          .tr-outputProfileChoices button{min-height:48px!important;font-size:9px!important}
          .tr-sourceQualityCopy>strong{white-space:normal!important;line-height:1.2!important}
        }

        /* MVP_STUDIO_V4_1_DSP_EQ_DESKTOP_ALIGNMENT
           Desktop only: hard-lock DSP/EQ to the exact geometry of the
           All Uploaded Songs field. Mobile uses the separate mobile DSP button. */
        @media(min-width:901px){
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools{
            align-items:end!important;
          }
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-audioQueueSelector .tr-audioQueueSelectorField,
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-dspStatusToggle{
            box-sizing:border-box!important;
            height:44px!important;
            min-height:44px!important;
            max-height:44px!important;
          }
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-dspStatusToggle{
            align-self:end!important;
            margin:0!important;
          }
        }

        /* MVP_STUDIO_V4_2_SOURCE_DSP_EXACT_ALIGNMENT
           Root-cause fix: an older broad >span rule gives the visible
           Playing From field a 5px bottom margin. That margin makes the
           field look 5px higher than DSP/EQ even when the grid items align.
           Keep spacing on the PLAYING FROM label, but remove it from the field. */
        @media(min-width:901px){
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools{
            align-items:end!important;
          }
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-audioQueueSelector > span:first-child{
            margin:0 0 5px 2px!important;
          }
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-audioQueueSelector > .tr-audioQueueSelectorField{
            margin:0!important;
            box-sizing:border-box!important;
            height:44px!important;
            min-height:44px!important;
            max-height:44px!important;
          }
          .tr-audioDeck.tr-audioDeck--pro7 .tr-playerUtilityRow .tr-playerSourceTools > .tr-dspStatusToggle{
            position:relative!important;
            top:0!important;
            margin:0!important;
            align-self:end!important;
            box-sizing:border-box!important;
            height:44px!important;
            min-height:44px!important;
            max-height:44px!important;
          }
        }

        /* MVP_STUDIO_V4_4_MOBILE_DSP_WORKSPACE — high-end mobile tabbed Studio workspace */
        .tr-mobileDspWorkspace{display:none}
        @media(max-width:700px){
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] > [data-mobile-dsp-section]:not([data-mobile-dsp-section="overview"]),
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="eq"] > [data-mobile-dsp-section]:not([data-mobile-dsp-section="eq"]),
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="processing"] > [data-mobile-dsp-section]:not([data-mobile-dsp-section="processing"]),
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="meters"] > [data-mobile-dsp-section]:not([data-mobile-dsp-section="meters"]){
            display:none!important;
          }
          .tr-audioEqPanel--pro7 > [data-mobile-dsp-section]{
            animation:trMobileDspPaneIn .18s cubic-bezier(.2,.8,.2,1) both;
          }
          @keyframes trMobileDspPaneIn{from{opacity:.45;transform:translateY(4px)}to{opacity:1;transform:none}}

          .tr-mobileDspWorkspace{
            display:block!important;
            position:sticky;
            top:6px;
            z-index:45;
            margin:0 0 12px;
            padding:8px;
            border:1px solid rgba(120,205,229,.20);
            border-radius:15px;
            background:linear-gradient(180deg,rgba(8,24,32,.96),rgba(3,12,17,.97));
            box-shadow:0 12px 30px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.045);
            -webkit-backdrop-filter:blur(18px) saturate(135%);
            backdrop-filter:blur(18px) saturate(135%);
          }
          .tr-mobileDspContext{
            min-width:0;
            display:flex;
            align-items:center;
            gap:7px;
            padding:2px 4px 8px;
            overflow:hidden;
            white-space:nowrap;
          }
          .tr-mobileDspContext>span{
            min-width:0;
            max-width:32%;
            overflow:hidden;
            text-overflow:ellipsis;
            color:#9ab3bd;
            font-size:8px;
            line-height:1;
            font-weight:950;
            letter-spacing:.055em;
            text-transform:uppercase;
          }
          .tr-mobileDspContext>span+span:before{content:"•";margin-right:7px;color:#41606c}
          .tr-mobileDspContext .tr-mobileDspContextEngine{
            flex:0 0 auto;
            max-width:none;
            color:#f2f7f9;
          }
          .tr-mobileDspContextEngine>i{
            display:inline-block;
            width:5px;
            height:5px;
            margin-right:6px;
            border-radius:50%;
            vertical-align:1px;
            background:#d7e2e6;
            box-shadow:0 0 8px rgba(230,241,245,.28);
          }
          .tr-mobileDspContextEngine.is-advanced_worklet>i{background:#ffb545;box-shadow:0 0 8px rgba(255,181,69,.35)}
          .tr-mobileDspContextEngine.is-native_fallback>i,.tr-mobileDspContextEngine.is-unavailable>i{background:#ff675f;box-shadow:0 0 8px rgba(255,103,95,.35)}

          .tr-mobileDspTabs{
            display:grid;
            grid-template-columns:repeat(4,minmax(0,1fr));
            gap:5px;
            padding:4px;
            border:1px solid rgba(117,186,208,.12);
            border-radius:12px;
            background:rgba(0,5,8,.58);
          }
          .tr-mobileDspTabs button{
            min-width:0;
            height:47px;
            padding:5px 2px 4px;
            display:flex;
            flex-direction:column;
            align-items:center;
            justify-content:center;
            gap:4px;
            border:1px solid transparent;
            border-radius:9px;
            background:transparent;
            color:#718d98;
            box-shadow:none;
          }
          .tr-mobileDspTabs button svg{
            width:16px;
            height:16px;
            fill:none;
            stroke:currentColor;
            stroke-width:1.8;
            stroke-linecap:round;
            stroke-linejoin:round;
          }
          .tr-mobileDspTabs button span{
            font-size:7.4px;
            line-height:1;
            font-weight:1000;
            letter-spacing:.075em;
          }
          .tr-mobileDspTabs button.is-active{
            border-color:rgba(72,202,239,.34);
            background:linear-gradient(180deg,rgba(11,55,70,.88),rgba(5,28,38,.95));
            color:#eaf9fd;
            box-shadow:inset 0 1px 0 rgba(255,255,255,.055),0 0 18px rgba(36,190,229,.07);
          }
          .tr-mobileDspTabs button.is-active svg{color:#51d8f5}

          /* OVERVIEW: remove redundant vertical bulk while keeping the important controls. */
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-outputProfilePanel{
            padding:12px!important;
            gap:10px!important;
          }
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-outputProfileIntro p{display:none!important}
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-outputProfileSelect{display:none!important}
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-outputProfileTelemetry{display:none!important}
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-outputProfileChoices{grid-template-columns:repeat(4,minmax(0,1fr))!important}
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-outputProfileChoices button{min-height:44px!important}
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-sourceQualityPanel,
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-preampTrim,
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-dspEnginePanel{margin-top:9px!important;margin-bottom:0!important}
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-sourceQualityCopy small,
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-preampTrimCopy small{font-size:8px!important;line-height:1.35!important}

          /* PROCESSING: compact module cards. Headphone controls only appear when relevant. */
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="processing"] .tr-studioProcessingPanel{
            margin:0!important;
            gap:8px!important;
          }
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="processing"] .tr-studioProcessingPanel button{
            min-height:66px!important;
            padding:10px 11px!important;
          }
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="processing"] .tr-headphoneProcessor{margin:9px 0 0!important}
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="processing"] .tr-headphoneProcessor.is-disabled{display:none!important}

          /* METERS: dense real telemetry, two columns even on small phones. */
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="meters"] .tr-studioMeterPanel{
            margin:0!important;
            padding:10px!important;
          }
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="meters"] .tr-studioMeterPanel>header{
            display:flex!important;
            flex-direction:row!important;
            align-items:flex-end!important;
            gap:8px!important;
          }
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="meters"] .tr-studioMeterGrid{
            grid-template-columns:repeat(2,minmax(0,1fr))!important;
            gap:7px!important;
          }
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="meters"] .tr-studioMeterGrid article{padding:9px!important}

          /* EQ: dedicated tuning workspace. */
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="eq"] .tr-audioEqHead{
            margin-top:0!important;
            padding-top:0!important;
          }
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="eq"] .tr-audioEqScroll{
            margin-top:10px!important;
            padding-bottom:4px!important;
            overscroll-behavior-x:contain;
            -webkit-overflow-scrolling:touch;
          }
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="eq"] .tr-audioEqBand{
            min-width:50px!important;
          }
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="eq"] .tr-audioEqBand input[type="range"]{
            touch-action:none;
          }
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="eq"] .tr-dspProfileSave{margin-bottom:0!important}

          /* Tabs remove the need for giant vertical spacing between every Studio system. */
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab] > [data-mobile-dsp-section]{
            scroll-margin-top:112px;
          }
        }

        @media(max-width:430px){
          .tr-mobileDspWorkspace{margin-left:-2px;margin-right:-2px;padding:7px;border-radius:13px}
          .tr-mobileDspContext{gap:5px;padding-left:2px;padding-right:2px}
          .tr-mobileDspContext>span{font-size:7.3px;letter-spacing:.035em}
          .tr-mobileDspContext>span+span:before{margin-right:5px}
          .tr-mobileDspTabs{gap:4px;padding:3px}
          .tr-mobileDspTabs button{height:45px;border-radius:8px}
          .tr-mobileDspTabs button svg{width:15px;height:15px}
          .tr-mobileDspTabs button span{font-size:6.8px;letter-spacing:.045em}
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="overview"] .tr-outputProfileChoices{grid-template-columns:repeat(2,minmax(0,1fr))!important}
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="meters"] .tr-studioMeterGrid article>strong{font-size:11px!important}
          .tr-audioEqPanel--pro7[data-mobile-dsp-tab="meters"] .tr-studioMeterGrid article>small{font-size:6.1px!important}
        }
      `}</style>
    </section>
  );
}
