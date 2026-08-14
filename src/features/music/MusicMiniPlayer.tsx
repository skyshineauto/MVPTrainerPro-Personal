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
  setMusicVolume,
  setPlayerMusicPreference,
  stopMusic,
  toggleMusicShuffle,
  useMusicPlayer,
  type MusicCustomPresetSlot,
  type MusicEqPreset,
  type MusicHeadphoneMode,
} from "../../lib/musicPlayer";
import { discoverMoreFromTrack } from "../../lib/musicDiscovery";

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
  if (name === "guitar") return <svg viewBox="0 0 24 24" aria-hidden><path d="M15.7 2.7 21.3 8.3l-2.1 2.1-1.3-1.3-4.3 4.3c.7 2 .2 4.3-1.5 6-2.5 2.5-6.4 2.7-8.7.4-2.3-2.3-2.1-6.2.4-8.7 1.7-1.7 4-2.2 6-1.5l4.3-4.3-1.3-1.3 2.9-1.3ZM7.1 12.2a2.35 2.35 0 1 0 0 4.7 2.35 2.35 0 0 0 0-4.7Zm4-1.1 1.8 1.8 4.3-4.3-1.8-1.8-4.3 4.3Z" /></svg>;
  if (name === "discover") return <svg viewBox="0 0 24 24" aria-hidden><path d="m12 1.7 2.05 5.25L19.3 9 14.05 11.05 12 16.3l-2.05-5.25L4.7 9l5.25-2.05L12 1.7Zm6.2 11.6 1.15 2.95 2.95 1.15-2.95 1.15-1.15 2.95-1.15-2.95-2.95-1.15 2.95-1.15 1.15-2.95ZM5.1 14.6l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3Z" /></svg>;
  if (name === "equalizer") return <svg viewBox="0 0 24 24" aria-hidden><path d="M5 3h2v18H5V3Zm6 4h2v14h-2V7Zm6-4h2v18h-2V3ZM3 8h6v3H3V8Zm6 5h6v3H9v-3Zm6-4h6v3h-6V9Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden><path d="M9 4v11.1A4.5 4.5 0 1 0 11 19V8.1l8-2V12a4.5 4.5 0 1 0 2 3.9V2L9 4Z" /></svg>;
}

const RTA_LABELS = ["31", "63", "125", "250", "500", "1K", "2K", "4K", "8K", "16K"] as const;

function MusicActivityRta({ playing }: { playing: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
      if (!visible || (typeof document !== "undefined" && document.hidden) || now - lastDraw < 30) return;
      lastDraw = now;

      const width = Math.max(1, Math.floor(canvas.clientWidth));
      const height = Math.max(1, Math.floor(canvas.clientHeight));
      const dpr = Math.min(1.6, window.devicePixelRatio || 1);
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
      const plotLeft = compact ? 6 : 34;
      const plotRight = 6;
      const plotTop = 7;
      const plotBottom = 19;
      const plotWidth = Math.max(1, width - plotLeft - plotRight);
      const plotHeight = Math.max(1, height - plotTop - plotBottom);

      const background = ctx.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, "#09141a");
      background.addColorStop(0.36, "#040b0f");
      background.addColorStop(1, "#010405");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      const raw = playing ? getMusicRtaLevels() : Array(10).fill(0);
      let framePeak = 0;
      let frameSum = 0;
      for (let index = 0; index < 10; index += 1) {
        const value = Math.max(0, Math.min(1, Number(raw[index]) || 0));
        framePeak = Math.max(framePeak, value);
        frameSum += value;
      }
      const frameAverage = frameSum / 10;
      const activity = Math.max(0, Math.min(1, (framePeak - 0.025) / 0.52));
      const dynamicFloor = Math.min(framePeak * 0.46, Math.max(0.014, frameAverage * 0.52));
      const dynamicRange = Math.max(0.075, framePeak - dynamicFloor);

      for (let index = 0; index < 10; index += 1) {
        const source = Math.max(0, Math.min(1, Number(raw[index]) || 0));
        const opened = source < 0.014 ? 0 : Math.min(1, (source - 0.014) / 0.72);
        const absoluteShape = Math.pow(opened, 1.02);
        const contrast = Math.max(0, Math.min(1, (source - dynamicFloor) / dynamicRange));
        const contrastShape = Math.pow(contrast, 1.34) * activity;
        const transient = playing ? Math.max(0, source - rawHistory[index]) : 0;
        rawHistory[index] = source;

        // All three terms come from the real analyzer signal. The frame-relative contrast and
        // short transient lift simply use more of the available meter travel so the display
        // behaves like a lively hardware RTA instead of ten similarly tall columns.
        const shaped = Math.min(1, absoluteShape * 0.62 + contrastShape * 0.31 + Math.min(0.16, transient * 1.65));
        const previous = displayed[index];
        const attack = 0.97;
        const release = playing ? 0.105 : 0.46;
        displayed[index] = previous + (shaped - previous) * (shaped > previous ? attack : release);

        if (displayed[index] >= peaks[index] - 0.003) {
          peaks[index] = displayed[index];
          peakHoldUntil[index] = now + 680;
        } else if (now > peakHoldUntil[index]) {
          peaks[index] = Math.max(displayed[index], peaks[index] - 0.013);
        }
      }

      const gridRatios = [0, 0.2, 0.4, 0.6, 0.8, 1];
      ctx.lineWidth = 1;
      gridRatios.forEach((ratio, index) => {
        const y = Math.round(plotTop + plotHeight * ratio) + 0.5;
        ctx.strokeStyle = index === 0 || index === gridRatios.length - 1
          ? "rgba(127,207,231,.13)"
          : "rgba(127,207,231,.072)";
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(width - plotRight, y);
        ctx.stroke();
      });

      if (!compact) {
        const dbLabels = ["0", "-12", "-24", "-36", "-48", "-60"];
        ctx.fillStyle = "rgba(181,212,222,.56)";
        ctx.font = "800 8px system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        dbLabels.forEach((label, index) => {
          ctx.fillText(label, plotLeft - 7, plotTop + plotHeight * (index / (dbLabels.length - 1)));
        });
      }

      const gap = Math.max(compact ? 3 : 6, Math.min(compact ? 6 : 10, plotWidth * 0.009));
      const slotWidth = Math.max(9, (plotWidth - gap * 9) / 10);
      const barWidth = Math.max(6, slotWidth * (compact ? 0.58 : 0.56));
      const insetX = (slotWidth - barWidth) / 2;

      const wellGradient = ctx.createLinearGradient(0, plotTop, 0, plotTop + plotHeight);
      wellGradient.addColorStop(0, "rgba(36,23,12,.20)");
      wellGradient.addColorStop(0.18, "rgba(22,30,18,.16)");
      wellGradient.addColorStop(0.52, "rgba(5,29,35,.28)");
      wellGradient.addColorStop(1, "rgba(1,11,17,.86)");

      const meterGradient = ctx.createLinearGradient(0, plotTop + plotHeight, 0, plotTop);
      meterGradient.addColorStop(0, "#057f9d");
      meterGradient.addColorStop(0.20, "#0fb6d0");
      meterGradient.addColorStop(0.42, "#25d4db");
      meterGradient.addColorStop(0.62, "#55d58a");
      meterGradient.addColorStop(0.78, "#d6d64a");
      meterGradient.addColorStop(0.90, "#f0a43e");
      meterGradient.addColorStop(1, "#f26f54");

      for (let band = 0; band < 10; band += 1) {
        const slotX = plotLeft + band * (slotWidth + gap);
        const barX = slotX + insetX;

        ctx.fillStyle = wellGradient;
        ctx.fillRect(slotX, plotTop, slotWidth, plotHeight);
        ctx.fillStyle = "rgba(255,255,255,.025)";
        ctx.fillRect(slotX + 1, plotTop + 1, 1, plotHeight - 2);
        ctx.fillStyle = "rgba(0,0,0,.28)";
        ctx.fillRect(slotX + slotWidth - 2, plotTop + 1, 1, plotHeight - 2);
        ctx.strokeStyle = "rgba(110,195,219,.105)";
        ctx.strokeRect(Math.round(slotX) + 0.5, Math.round(plotTop) + 0.5, Math.max(1, Math.round(slotWidth) - 1), Math.max(1, Math.round(plotHeight) - 1));

        const level = Math.max(0, Math.min(1, displayed[band]));
        const activeHeight = Math.max(0, plotHeight * level);
        if (activeHeight > 0.5) {
          const activeY = plotTop + plotHeight - activeHeight;
          ctx.fillStyle = meterGradient;
          ctx.fillRect(barX, activeY, barWidth, activeHeight);

          // Narrow luminous core creates depth without an expensive full-canvas blur.
          const coreWidth = Math.max(1, barWidth * 0.30);
          ctx.fillStyle = level > 0.82 ? "rgba(255,236,170,.23)" : "rgba(198,249,255,.17)";
          ctx.fillRect(barX + (barWidth - coreWidth) / 2, activeY, coreWidth, activeHeight);
          ctx.fillStyle = "rgba(255,255,255,.17)";
          ctx.fillRect(barX + 1, activeY, 1, activeHeight);
          ctx.fillStyle = "rgba(0,0,0,.22)";
          ctx.fillRect(barX + barWidth - 2, activeY, 1, activeHeight);
          ctx.fillStyle = level > 0.78 ? "rgba(255,224,139,.62)" : "rgba(205,251,255,.48)";
          ctx.fillRect(barX, Math.round(activeY), barWidth, compact ? 1 : 1.5);

          const division = compact ? 6 : 7;
          ctx.strokeStyle = "rgba(0,5,8,.28)";
          for (let y = plotTop + plotHeight - division; y > activeY; y -= division) {
            ctx.beginPath();
            ctx.moveTo(barX, Math.round(y) + 0.5);
            ctx.lineTo(barX + barWidth, Math.round(y) + 0.5);
            ctx.stroke();
          }

          if (level > 0.72) {
            const hotHeight = Math.min(activeHeight, plotHeight * 0.16);
            ctx.fillStyle = "rgba(255,184,65,.10)";
            ctx.fillRect(barX, activeY, barWidth, hotHeight);
          }
        }

        if (playing && peaks[band] > 0.025) {
          const peakY = Math.max(plotTop, plotTop + plotHeight * (1 - peaks[band]));
          ctx.save();
          ctx.fillStyle = peaks[band] > 0.82 ? "#ffd66e" : "#dffaff";
          ctx.shadowColor = peaks[band] > 0.82 ? "rgba(255,183,61,.58)" : "rgba(97,226,255,.48)";
          ctx.shadowBlur = compact ? 3 : 4;
          ctx.fillRect(barX - 1, Math.round(peakY), barWidth + 2, compact ? 1.5 : 2);
          ctx.restore();
        }
      }

      const floorGlow = ctx.createLinearGradient(0, plotTop + plotHeight * 0.72, 0, plotTop + plotHeight);
      floorGlow.addColorStop(0, "rgba(13,123,151,0)");
      floorGlow.addColorStop(1, playing && framePeak > 0.08 ? "rgba(14,142,166,.075)" : "rgba(14,142,166,.02)");
      ctx.fillStyle = floorGlow;
      ctx.fillRect(plotLeft, plotTop + plotHeight * 0.68, plotWidth, plotHeight * 0.32);

      const glass = ctx.createLinearGradient(0, plotTop, 0, plotTop + plotHeight * 0.55);
      glass.addColorStop(0, "rgba(255,255,255,.035)");
      glass.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glass;
      ctx.fillRect(plotLeft, plotTop, plotWidth, plotHeight * 0.55);
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [playing]);

  return (
    <div ref={hostRef} className="tr-activityRta tr-activityRta--10band" aria-label="10 band real-time spectrum analyzer">
      <canvas ref={canvasRef} />
      <div className="tr-activityRtaLabels" aria-hidden>
        {RTA_LABELS.map((label) => <span key={label}>{label}</span>)}
      </div>
    </div>
  );
}


type HeroRgb = { r: number; g: number; b: number };
type HeroPalette = [HeroRgb, HeroRgb, HeroRgb, HeroRgb, HeroRgb];
type HeroSceneName = "fluid" | "waves" | "stars" | "plasma" | "bloom" | "haze" | "tunnel" | "flow";
type HeroAudioShape = { low: number; mid: number; high: number; energy: number; depth: number; pulse: number; speed: number };

const HERO_SCENES: HeroSceneName[] = ["fluid", "stars", "plasma", "waves", "bloom", "haze", "tunnel", "flow"];
const HERO_SCENE_MS = 9000;
const HERO_CROSSFADE_MS = 1250;
const HERO_ENGINE_VERSION = "AUG14-V4";

function heroSceneDisplayName(scene: HeroSceneName) {
  if (scene === "flow") return "PARTICLES";
  if (scene === "haze") return "SMOKE";
  return scene.toUpperCase();
}
const HERO_NEUTRAL_PALETTE: HeroPalette = [
  { r: 225, g: 235, b: 239 },
  { r: 170, g: 184, b: 190 },
  { r: 118, g: 132, b: 140 },
  { r: 245, g: 248, b: 250 },
  { r: 64, g: 74, b: 80 },
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

function heroNoise(index: number, seed: number) {
  let value = Math.imul(index + 1, 374761393) ^ Math.imul(seed + 23, 668265263);
  value = (value ^ (value >>> 13)) >>> 0;
  value = Math.imul(value, 1274126177) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function heroMix(left: HeroRgb, right: HeroRgb, amount: number): HeroRgb {
  const mix = heroClamp(amount);
  return {
    r: left.r + (right.r - left.r) * mix,
    g: left.g + (right.g - left.g) * mix,
    b: left.b + (right.b - left.b) * mix,
  };
}

function heroRgba(color: HeroRgb, alpha: number) {
  return `rgba(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)},${heroClamp(alpha).toFixed(3)})`;
}

function heroLightness(color: HeroRgb) {
  const max = Math.max(color.r, color.g, color.b) / 255;
  const min = Math.min(color.r, color.g, color.b) / 255;
  return (max + min) / 2;
}

function heroSaturation(color: HeroRgb) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const chroma = max - min;
  return chroma === 0 ? 0 : heroClamp(chroma / (1 - Math.abs(2 * light - 1)));
}

function heroColorDistance(left: HeroRgb, right: HeroRgb) {
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function heroMakeVisible(color: HeroRgb) {
  const light = heroLightness(color);
  if (light < 0.18) return heroMix(color, { r: 255, g: 255, b: 255 }, 0.28);
  if (light > 0.86) return heroMix(color, { r: 0, g: 0, b: 0 }, 0.14);
  return color;
}

function extractHeroPalette(data: Uint8ClampedArray): HeroPalette | null {
  type Bucket = { r: number; g: number; b: number; weight: number; hits: number };
  const buckets = new Map<string, Bucket>();

  for (let index = 0; index < data.length; index += 12) {
    const alpha = data[index + 3] / 255;
    if (alpha < 0.65) continue;
    const color = { r: data[index], g: data[index + 1], b: data[index + 2] };
    const light = heroLightness(color);
    if (light < 0.035 || light > 0.97) continue;
    const saturation = heroSaturation(color);
    const q = 28;
    const qr = Math.round(color.r / q) * q;
    const qg = Math.round(color.g / q) * q;
    const qb = Math.round(color.b / q) * q;
    const key = `${qr}:${qg}:${qb}`;
    const centerBias = 1 - Math.min(1, Math.abs(light - 0.48) * 1.35);
    const weight = alpha * (0.72 + saturation * 1.35) * (0.68 + centerBias * 0.32);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, weight: 0, hits: 0 };
    bucket.r += color.r * weight;
    bucket.g += color.g * weight;
    bucket.b += color.b * weight;
    bucket.weight += weight;
    bucket.hits += 1;
    buckets.set(key, bucket);
  }

  const ranked = Array.from(buckets.values())
    .filter((bucket) => bucket.weight > 0)
    .map((bucket) => ({
      color: {
        r: bucket.r / bucket.weight,
        g: bucket.g / bucket.weight,
        b: bucket.b / bucket.weight,
      },
      score: bucket.weight * Math.sqrt(bucket.hits),
    }))
    .sort((left, right) => right.score - left.score);

  if (!ranked.length) return null;
  const chosen: HeroRgb[] = [];
  for (const candidate of ranked) {
    if (!chosen.length || chosen.every((existing) => heroColorDistance(existing, candidate.color) > 54)) {
      chosen.push(heroMakeVisible(candidate.color));
      if (chosen.length === 4) break;
    }
  }
  while (chosen.length < 4) {
    const fallback = ranked[Math.min(chosen.length, ranked.length - 1)]?.color ?? HERO_NEUTRAL_PALETTE[chosen.length];
    chosen.push(heroMakeVisible(fallback));
  }

  const brightest = [...chosen].sort((a, b) => heroLightness(b) - heroLightness(a))[0];
  const shadow = heroMix(heroMix(chosen[0], chosen[1], 0.42), { r: 0, g: 0, b: 0 }, 0.76);
  return [chosen[0], chosen[1], chosen[2], heroMix(brightest, { r: 255, g: 255, b: 255 }, 0.20), shadow];
}

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
  const seedRef = useRef(heroHash(trackKey || "mvp-music"));
  const targetPaletteRef = useRef<HeroPalette>(HERO_NEUTRAL_PALETTE.map((color) => ({ ...color })) as HeroPalette);
  const livePaletteRef = useRef<HeroPalette>(HERO_NEUTRAL_PALETTE.map((color) => ({ ...color })) as HeroPalette);
  const [debugScene, setDebugScene] = useState<HeroSceneName>(() => HERO_SCENES[Math.floor(Date.now() / HERO_SCENE_MS) % HERO_SCENES.length]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    seedRef.current = heroHash(trackKey || "mvp-music");
  }, [trackKey]);

  useEffect(() => {
    const syncScene = () => {
      const sceneStep = Math.floor(Date.now() / HERO_SCENE_MS);
      setDebugScene(HERO_SCENES[sceneStep % HERO_SCENES.length]);
    };
    syncScene();
    const timer = window.setInterval(syncScene, 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!artworkUrl || typeof document === "undefined") {
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
        const size = 64;
        sample.width = size;
        sample.height = size;
        const context = sample.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
        const sourceWidth = size / scale;
        const sourceHeight = size / scale;
        const sourceX = Math.max(0, (image.naturalWidth - sourceWidth) / 2);
        const sourceY = Math.max(0, (image.naturalHeight - sourceHeight) / 2);
        context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, size, size);
        const palette = extractHeroPalette(context.getImageData(0, 0, size, size).data);
        if (!cancelled && palette) targetPaletteRef.current = palette;
      } catch {
        // The blurred artwork remains underneath the transparent canvas, so a CORS-blocked
        // palette read still preserves the album's real colors instead of inventing a theme.
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
    if (!canvas) return;

    let frame = 0;
    let lastNow = performance.now();
    let width = 1;
    let height = 1;
    let dpr = 1;
    const smoothed = { low: 0.11, mid: 0.10, high: 0.08, energy: 0.16, depth: 0.16, pulse: 0.10 };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(width < 560 ? 1.2 : 1.45, window.devicePixelRatio || 1);
      const pixelWidth = Math.max(1, Math.floor(width * dpr));
      const pixelHeight = Math.max(1, Math.floor(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
    };

    resize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);

    const smoothPath = (ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) => {
      if (points.length < 2) return;
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length - 1; index += 1) {
        const current = points[index];
        const next = points[index + 1];
        ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
    };

    const drawFluid = (ctx: CanvasRenderingContext2D, t: number, audio: HeroAudioShape, palette: HeroPalette, alpha: number, seed: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = "screen";
      for (let index = 0; index < 7; index += 1) {
        const p = heroNoise(index * 7 + 1, seed);
        const q = heroNoise(index * 7 + 2, seed);
        const r = heroNoise(index * 7 + 3, seed);
        const x = width * (0.12 + p * 0.78) + Math.sin(t * (0.18 + q * 0.07) + r * 6.28) * width * (0.04 + audio.depth * 0.055);
        const y = height * (0.16 + q * 0.68) + Math.cos(t * (0.15 + r * 0.06) + p * 6.28) * height * (0.07 + audio.depth * 0.05);
        const radius = Math.max(width, height) * (0.18 + r * 0.18 + audio.low * 0.055);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, heroRgba(palette[index % 4], 0.18 + audio.energy * 0.08));
        gradient.addColorStop(0.42, heroRgba(palette[(index + 1) % 4], 0.07 + audio.mid * 0.04));
        gradient.addColorStop(1, heroRgba(palette[index % 4], 0));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(x, y, radius * (1.0 + Math.sin(t * 0.21 + index) * 0.18), radius * (0.58 + q * 0.34), t * 0.07 + index, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const drawWaves = (ctx: CanvasRenderingContext2D, t: number, audio: HeroAudioShape, palette: HeroPalette, alpha: number, seed: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = "screen";
      const layers = width < 520 ? 3 : 5;
      const pointCount = 13;
      for (let layer = 0; layer < layers; layer += 1) {
        const upper: Array<{ x: number; y: number }> = [];
        const lower: Array<{ x: number; y: number }> = [];
        const layerSeed = seed + layer * 37;
        const baseY = height * (0.25 + layer * (0.52 / Math.max(1, layers - 1)));
        const thickness = height * (0.035 + heroNoise(layer + 2, layerSeed) * 0.045 + audio.depth * 0.022);
        for (let point = 0; point < pointCount; point += 1) {
          const u = point / (pointCount - 1);
          const p = heroNoise(point * 5 + 1, layerSeed);
          const q = heroNoise(point * 5 + 2, layerSeed);
          const xDrift = Math.sin(t * (0.24 + q * 0.08) + point * 0.73 + layer * 1.17) * width * (0.012 + audio.mid * 0.014);
          const fold = Math.sin(t * 0.31 + point * 0.55 + layer * 0.9) * height * (0.045 + audio.mid * 0.045);
          const curl = Math.cos(t * 0.19 + point * 0.96 + p * 5.5) * height * (0.028 + audio.low * 0.035);
          const swell = Math.sin(t * 0.11 + layer * 1.7) * height * 0.035;
          const x = u * width + xDrift + Math.sin(t * 0.14 + point * 0.31 + layer) * width * 0.012;
          const y = baseY + fold + curl + swell + Math.sin(u * Math.PI * 2 + layer) * height * 0.025;
          const localThickness = thickness * (0.72 + q * 0.55) * (0.92 + Math.sin(t * 0.25 + point * 0.44) * 0.14);
          upper.push({ x, y: y - localThickness });
          lower.push({ x, y: y + localThickness });
        }

        ctx.beginPath();
        smoothPath(ctx, upper);
        for (let point = lower.length - 1; point >= 0; point -= 1) {
          const current = lower[point];
          if (point === lower.length - 1) ctx.lineTo(current.x, current.y);
          else {
            const next = lower[Math.max(0, point - 1)];
            ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
          }
        }
        ctx.closePath();
        const gradient = ctx.createLinearGradient(0, baseY - height * 0.12, width, baseY + height * 0.12);
        gradient.addColorStop(0, heroRgba(palette[layer % 4], 0.025));
        gradient.addColorStop(0.32, heroRgba(palette[(layer + 1) % 4], 0.12 + audio.energy * 0.035));
        gradient.addColorStop(0.72, heroRgba(palette[(layer + 2) % 4], 0.16 + audio.energy * 0.045));
        gradient.addColorStop(1, heroRgba(palette[layer % 4], 0.018));
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.beginPath();
        const center = upper.map((point, index) => ({ x: point.x, y: (point.y + lower[index].y) / 2 }));
        smoothPath(ctx, center);
        ctx.strokeStyle = heroRgba(palette[(layer + 3) % 4], 0.08 + audio.high * 0.035);
        ctx.lineWidth = 0.8 + layer * 0.22;
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawStars = (ctx: CanvasRenderingContext2D, t: number, audio: HeroAudioShape, palette: HeroPalette, alpha: number, seed: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = "screen";
      const count = width < 520 ? 72 : 132;
      const cx = width * (0.54 + Math.sin(t * 0.08) * 0.055);
      const cy = height * (0.50 + Math.cos(t * 0.07) * 0.07);
      for (let index = 0; index < count; index += 1) {
        const a = heroNoise(index * 4 + 1, seed) * Math.PI * 2;
        const baseDepth = heroNoise(index * 4 + 2, seed);
        const radiusSeed = heroNoise(index * 4 + 3, seed);
        const depth = (baseDepth + t * (0.035 + radiusSeed * 0.02)) % 1;
        const eased = depth * depth;
        const radius = eased * Math.max(width, height) * (0.22 + radiusSeed * 0.48);
        const angle = a + t * (0.018 + radiusSeed * 0.018) * (index % 2 ? 1 : -1);
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * (0.48 + radiusSeed * 0.20);
        const size = 0.5 + eased * (1.2 + audio.high * 0.7);
        const color = palette[index % 4];
        ctx.fillStyle = heroRgba(color, 0.12 + eased * 0.42);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        if (depth > 0.76 && playingRef.current) {
          const trail = 3 + eased * 7;
          ctx.strokeStyle = heroRgba(color, 0.05 + audio.high * 0.05);
          ctx.lineWidth = Math.max(0.5, size * 0.48);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - Math.cos(angle) * trail, y - Math.sin(angle) * trail * 0.55);
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    const drawPlasma = (ctx: CanvasRenderingContext2D, t: number, audio: HeroAudioShape, palette: HeroPalette, alpha: number, seed: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = "screen";
      for (let index = 0; index < 9; index += 1) {
        const p = heroNoise(index * 5 + 1, seed);
        const q = heroNoise(index * 5 + 2, seed);
        const x = width * (0.08 + p * 0.84) + Math.sin(t * (0.14 + q * 0.08) + index) * width * 0.06;
        const y = height * (0.12 + q * 0.76) + Math.cos(t * (0.17 + p * 0.05) + index * 0.6) * height * 0.10;
        const radius = Math.max(width, height) * (0.10 + heroNoise(index * 5 + 3, seed) * 0.12 + audio.depth * 0.035);
        const gradient = ctx.createRadialGradient(x, y, radius * 0.03, x, y, radius);
        gradient.addColorStop(0, heroRgba(palette[index % 4], 0.21 + audio.energy * 0.06));
        gradient.addColorStop(0.46, heroRgba(palette[(index + 2) % 4], 0.08));
        gradient.addColorStop(1, heroRgba(palette[index % 4], 0));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(x, y, radius * (1.15 + Math.sin(t * 0.22 + index) * 0.22), radius * (0.72 + Math.cos(t * 0.18 + index) * 0.18), t * 0.11 + index, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const drawBloom = (ctx: CanvasRenderingContext2D, t: number, audio: HeroAudioShape, palette: HeroPalette, alpha: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = "screen";
      const cx = width * (0.58 + Math.sin(t * 0.09) * 0.05);
      const cy = height * (0.50 + Math.cos(t * 0.08) * 0.06);
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.42);
      halo.addColorStop(0, heroRgba(palette[0], 0.12 + audio.low * 0.05));
      halo.addColorStop(0.38, heroRgba(palette[1], 0.055));
      halo.addColorStop(1, heroRgba(palette[2], 0));
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);
      for (let ring = 0; ring < 7; ring += 1) {
        const progress = (ring / 7 + t * 0.035) % 1;
        const radiusX = width * (0.05 + progress * 0.60) * (1 + audio.depth * 0.08);
        const radiusY = height * (0.05 + progress * 0.52) * (1 + audio.low * 0.08);
        ctx.beginPath();
        ctx.ellipse(cx, cy, radiusX, radiusY, Math.sin(t * 0.11 + ring) * 0.10, 0, Math.PI * 2);
        ctx.strokeStyle = heroRgba(palette[ring % 4], (1 - progress) * (0.11 + audio.energy * 0.045));
        ctx.lineWidth = 0.8 + (1 - progress) * 2.2;
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawHaze = (ctx: CanvasRenderingContext2D, t: number, audio: HeroAudioShape, palette: HeroPalette, alpha: number, seed: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = "screen";
      for (let wisp = 0; wisp < 7; wisp += 1) {
        const base = height * (0.14 + heroNoise(wisp + 1, seed) * 0.72);
        const points: Array<{ x: number; y: number }> = [];
        for (let point = 0; point < 9; point += 1) {
          const u = point / 8;
          const x = width * u + Math.sin(t * 0.12 + point * 0.7 + wisp) * width * 0.02;
          const y = base + Math.sin(t * (0.15 + wisp * 0.006) + point * 0.52 + wisp * 1.3) * height * (0.055 + audio.mid * 0.045) + Math.cos(t * 0.09 + point * 0.91) * height * 0.025;
          points.push({ x, y });
        }
        ctx.beginPath();
        smoothPath(ctx, points);
        ctx.strokeStyle = heroRgba(palette[wisp % 4], 0.045 + audio.energy * 0.025);
        ctx.lineWidth = height * (0.07 + heroNoise(wisp + 4, seed) * 0.06);
        ctx.lineCap = "round";
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawTunnel = (ctx: CanvasRenderingContext2D, t: number, audio: HeroAudioShape, palette: HeroPalette, alpha: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = "screen";
      const cx = width * (0.57 + Math.sin(t * 0.10) * 0.06);
      const cy = height * (0.50 + Math.cos(t * 0.085) * 0.07);
      for (let ring = 0; ring < 12; ring += 1) {
        const phase = (ring / 12 + t * 0.025) % 1;
        const scale = 0.06 + phase * 0.92;
        ctx.beginPath();
        ctx.ellipse(cx + Math.sin(t * 0.13 + ring * 0.3) * width * 0.02, cy + Math.cos(t * 0.11 + ring * 0.4) * height * 0.025, width * scale * 0.55, height * scale * 0.46, Math.sin(t * 0.07) * 0.08, 0, Math.PI * 2);
        ctx.strokeStyle = heroRgba(palette[ring % 4], (1 - phase) * (0.09 + audio.high * 0.025));
        ctx.lineWidth = 0.7 + (1 - phase) * 2.4;
        ctx.stroke();
      }
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(width, height) * 0.28);
      core.addColorStop(0, heroRgba(palette[3], 0.10 + audio.low * 0.035));
      core.addColorStop(1, heroRgba(palette[0], 0));
      ctx.fillStyle = core;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    };

    const drawFlow = (ctx: CanvasRenderingContext2D, t: number, audio: HeroAudioShape, palette: HeroPalette, alpha: number, seed: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = "screen";
      const count = width < 520 ? 74 : 128;
      const cx = width * (0.55 + Math.sin(t * 0.08) * 0.09);
      const cy = height * (0.50 + Math.cos(t * 0.065) * 0.10);
      for (let index = 0; index < count; index += 1) {
        const p = heroNoise(index * 5 + 1, seed);
        const q = heroNoise(index * 5 + 2, seed);
        const r = heroNoise(index * 5 + 3, seed);
        const direction = index % 2 ? 1 : -1;
        const angle = p * Math.PI * 2 + direction * t * (0.035 + r * 0.028) + Math.sin(t * 0.09 + q * 7) * 0.22;
        const radius = Math.max(width, height) * (0.03 + q * 0.48) * (0.95 + Math.sin(t * 0.08 + p * 8) * 0.07);
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * (0.42 + r * 0.28);
        const tangent = angle + direction * Math.PI / 2;
        const len = 3 + r * 10 + audio.high * 3;
        ctx.strokeStyle = heroRgba(palette[index % 4], 0.07 + r * 0.18 + audio.high * 0.018);
        ctx.lineWidth = 0.6 + r * 1.1;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(tangent) * len, y - Math.sin(tangent) * len);
        ctx.quadraticCurveTo(x - Math.cos(tangent) * len * 0.3 + Math.cos(angle) * 4, y - Math.sin(tangent) * len * 0.3 + Math.sin(angle) * 3, x, y);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawScene = (ctx: CanvasRenderingContext2D, scene: HeroSceneName, t: number, audio: HeroAudioShape, palette: HeroPalette, alpha: number, seed: number) => {
      if (alpha <= 0.002) return;
      if (scene === "fluid") drawFluid(ctx, t, audio, palette, alpha, seed);
      else if (scene === "waves") drawWaves(ctx, t, audio, palette, alpha, seed);
      else if (scene === "stars") drawStars(ctx, t, audio, palette, alpha, seed);
      else if (scene === "plasma") drawPlasma(ctx, t, audio, palette, alpha, seed);
      else if (scene === "bloom") drawBloom(ctx, t, audio, palette, alpha);
      else if (scene === "haze") drawHaze(ctx, t, audio, palette, alpha, seed);
      else if (scene === "tunnel") drawTunnel(ctx, t, audio, palette, alpha);
      else drawFlow(ctx, t, audio, palette, alpha, seed);
    };

    const draw = (now: number) => {
      frame = window.requestAnimationFrame(draw);
      if (typeof document !== "undefined" && document.hidden) return;
      if (width < 2 || height < 2) resize();

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const dt = heroClamp((now - lastNow) / 16.667, 0.2, 3);
      lastNow = now;
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
      const overall = lowRaw * 0.38 + midRaw * 0.40 + highRaw * 0.22;

      const targets = playingRef.current ? {
        low: heroClamp(0.12 + lowRaw * 0.40, 0.12, 0.56),
        mid: heroClamp(0.11 + midRaw * 0.37, 0.11, 0.52),
        high: heroClamp(0.08 + highRaw * 0.34, 0.08, 0.46),
        energy: heroClamp(0.23 + Math.tanh(overall * 1.85) * 0.32, 0.23, 0.58),
        depth: heroClamp(0.18 + lowRaw * 0.25 + overall * 0.13, 0.18, 0.52),
      } : { low: 0.105, mid: 0.095, high: 0.075, energy: 0.15, depth: 0.15 };

      const approach = (current: number, target: number) => {
        const rate = target > current ? 1 - Math.pow(0.83, dt) : 1 - Math.pow(0.956, dt);
        return current + (target - current) * rate;
      };
      smoothed.low = approach(smoothed.low, targets.low);
      smoothed.mid = approach(smoothed.mid, targets.mid);
      smoothed.high = approach(smoothed.high, targets.high);
      smoothed.energy = approach(smoothed.energy, targets.energy);
      smoothed.depth = approach(smoothed.depth, targets.depth);
      smoothed.pulse = approach(smoothed.pulse, targets.low * 0.72 + targets.mid * 0.28);

      const livePalette = livePaletteRef.current;
      const targetPalette = targetPaletteRef.current;
      for (let index = 0; index < livePalette.length; index += 1) {
        livePalette[index] = heroMix(livePalette[index], targetPalette[index], 1 - Math.pow(0.962, dt));
      }

      // Real wall-clock timing means React renders/remounts cannot trap the visualizer on scene one.
      const absoluteNow = Date.now();
      const sceneStep = Math.floor(absoluteNow / HERO_SCENE_MS);
      const sceneElapsed = absoluteNow - sceneStep * HERO_SCENE_MS;
      const currentScene = HERO_SCENES[sceneStep % HERO_SCENES.length];
      const nextScene = HERO_SCENES[(sceneStep + 1) % HERO_SCENES.length];
      const fadeStart = HERO_SCENE_MS - HERO_CROSSFADE_MS;
      const fadeLinear = sceneElapsed > fadeStart ? heroClamp((sceneElapsed - fadeStart) / HERO_CROSSFADE_MS) : 0;
      const fade = fadeLinear * fadeLinear * (3 - 2 * fadeLinear);
      const audio: HeroAudioShape = {
        low: smoothed.low,
        mid: smoothed.mid,
        high: smoothed.high,
        energy: smoothed.energy,
        depth: smoothed.depth,
        pulse: smoothed.pulse,
        speed: playingRef.current ? 0.56 + smoothed.energy * 0.14 : 0.34,
      };
      const t = now * 0.001 * audio.speed;
      const seed = seedRef.current;

      // Keep the canvas transparent so the blurred album art underneath is always the palette base.
      const shade = ctx.createLinearGradient(0, 0, width, height);
      shade.addColorStop(0, "rgba(0,0,0,.10)");
      shade.addColorStop(0.55, "rgba(0,0,0,.035)");
      shade.addColorStop(1, "rgba(0,0,0,.16)");
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, width, height);

      drawScene(ctx, currentScene, t, audio, livePalette, 1 - fade * 0.88, seed + sceneStep * 41);
      if (fade > 0) drawScene(ctx, nextScene, t + 0.61, audio, livePalette, fade, seed + (sceneStep + 1) * 41);

      const edge = ctx.createLinearGradient(0, 0, width, 0);
      edge.addColorStop(0, "rgba(0,0,0,.20)");
      edge.addColorStop(0.22, "rgba(0,0,0,.03)");
      edge.addColorStop(0.78, "rgba(0,0,0,.02)");
      edge.addColorStop(1, "rgba(0,0,0,.18)");
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, width, height);
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);

  return (
    <>
      <div className="tr-playerVisualEngine" aria-hidden="true">
        {artworkUrl ? <img className="tr-playerVisualArtwork" src={artworkUrl} alt="" /> : null}
        <canvas ref={canvasRef} />
        <span className="tr-playerVisualGlass" />
      </div>
      <div className="tr-playerVisualDebug" aria-hidden="true">
        <span>{HERO_ENGINE_VERSION}</span>
        <strong>{heroSceneDisplayName(debugScene)}</strong>
      </div>
    </>
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
  const [discoverMessage, setDiscoverMessage] = useState("");
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetSlot, setSavePresetSlot] = useState<MusicCustomPresetSlot>("custom_1");
  const [savePresetName, setSavePresetName] = useState("");
  const restoredProfileRef = useRef<string>("");


  useEffect(() => {
    const title = document.querySelector<HTMLElement>(".tr-topTitle");
    const header = title?.parentElement;
    if (!header) return;
    const originalActions = Array.from(header.children).find((node) => node !== title && node instanceof HTMLElement) as HTMLElement | undefined;
    if (!originalActions) return;

    const oldDisplay = originalActions.style.display;
    originalActions.style.display = "none";

    let mount = header.querySelector<HTMLElement>(".tr-proGlobalActions");
    if (!mount) {
      mount = document.createElement("div");
      mount.className = "tr-proGlobalActions";
      header.appendChild(mount);
    }
    mount.innerHTML = "";

    const makeButton = (label: string, action: () => void, className = "") => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tr-proHeaderButton ${className}`.trim();
      button.textContent = label;
      button.addEventListener("click", action);
      mount?.appendChild(button);
      return button;
    };

    const hasActiveWorkout = Boolean(
      window.localStorage.getItem("mvp_active_session_id") ||
      window.localStorage.getItem("mvp_active_workout_id")
    );
    if (hasActiveWorkout) makeButton("RESUME", () => navigate("/"), "is-resume");
    makeButton("SOUND & ALERTS", () => navigate("/sound-alerts"), "is-sound");

    const accountWrap = document.createElement("div");
    accountWrap.className = "tr-proAccountWrap";
    const accountButton = document.createElement("button");
    accountButton.type = "button";
    accountButton.className = "tr-proHeaderButton tr-proHeaderButton--account";
    accountButton.textContent = "ACCOUNT ▾";
    const menu = document.createElement("div");
    menu.className = "tr-proAccountMenu";
    menu.hidden = true;
    const signOut = document.createElement("button");
    signOut.type = "button";
    signOut.textContent = "SIGN OUT";
    signOut.addEventListener("click", () => {
      const oldSignOut = Array.from(originalActions.querySelectorAll("button")).find((button) => button.textContent?.trim().toUpperCase() === "SIGN OUT") as HTMLButtonElement | undefined;
      oldSignOut?.click();
    });
    menu.appendChild(signOut);
    accountButton.addEventListener("click", () => { menu.hidden = !menu.hidden; });
    accountWrap.append(accountButton, menu);
    mount.appendChild(accountWrap);

    return () => {
      originalActions.style.display = oldDisplay;
      mount?.remove();
    };
  }, [navigate]);

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
  const volumePercent = Math.max(0, Math.min(100, Math.round(player.volume * 100)));
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

      <div className="tr-playerHero">
        <MusicHeroSceneEngine
          playing={player.playing}
          trackKey={track?.id || `${track?.title || "music"}:${track?.artist || "unknown"}`}
          artworkUrl={artworkUrl}
        />
        <button type="button" className="tr-audioArtwork" onClick={() => navigate("/music")} aria-label="Open music library">
          {artworkUrl ? <img className="tr-audioArtworkImage" src={artworkUrl} alt="" /> : <span className="tr-audioArtworkFallback"><PlayerIcon name="music" /></span>}
        </button>
        <button type="button" className="tr-audioIdentity" onClick={() => navigate("/music")}>
          <strong>{track?.title || (player.loading ? "Loading music…" : "Music")}</strong>
          <small>{track?.artist || "Unknown Artist"}</small>
        </button>
      </div>

      <div className="tr-audioTimeline">
        <span>{formatMusicTime(currentTime)}</span>
        <input type="range" min="0" max={Math.max(1, duration)} step="1" value={Math.min(Math.max(1, duration), currentTime)} onChange={(event: ChangeEvent<HTMLInputElement>) => seekMusic(Number(event.target.value))} disabled={!track || !duration} aria-label="Music playback position" />
        <span>{formatMusicTime(duration)}</span>
      </div>

      <div className="tr-playerTransportStage" aria-label="Music transport controls">
        <div className="tr-audioTransportUnit"><button type="button" className="tr-audioTransportButton" onClick={() => run(previousMusicTrack)} disabled={!player.tracks.length || player.loading || queueBusy} aria-label="Previous song"><span className="tr-audioTransportFace"><PlayerIcon name="back" /></span></button><span>PREVIOUS</span></div>
        <div className="tr-audioTransportUnit is-primary"><button type="button" className="tr-audioTransportButton tr-audioTransportButton--primary" onClick={() => run(player.playing ? pauseMusic : playMusic)} disabled={player.loading || queueBusy} aria-label={player.playing ? "Pause music" : "Play music"}><span className="tr-audioTransportFace"><PlayerIcon name={player.playing ? "pause" : "play"} /></span></button><span>{player.playing ? "PAUSE" : "PLAY"}</span></div>
        <div className="tr-audioTransportUnit"><button type="button" className="tr-audioTransportButton" onClick={() => stopMusic()} disabled={!track || player.loading || queueBusy} aria-label="Stop music"><span className="tr-audioTransportFace"><PlayerIcon name="stop" /></span></button><span>STOP</span></div>
        <div className="tr-audioTransportUnit"><button type="button" className="tr-audioTransportButton" onClick={() => run(() => nextMusicTrack())} disabled={!player.tracks.length || player.loading || queueBusy} aria-label="Next song"><span className="tr-audioTransportFace"><PlayerIcon name="next" /></span></button><span>NEXT</span></div>
      </div>

      <div className="tr-playerModeStage" aria-label="Shuffle and repeat controls">
        <button type="button" className={`tr-audioModeButton ${player.repeat !== "off" ? "is-active" : ""}`} onClick={() => cycleMusicRepeat()} aria-label={`Repeat ${player.repeat}`}><PlayerIcon name="repeat" /><span>{player.repeat === "one" ? "REPEAT 1" : "REPEAT"}</span></button>
        <button type="button" className={`tr-audioModeButton ${player.shuffle ? "is-active" : ""}`} onClick={() => toggleMusicShuffle()} aria-label={`Shuffle ${player.shuffle ? "on" : "off"}`}><PlayerIcon name="shuffle" /><span>SHUFFLE</span></button>
      </div>

      <MusicActivityRta playing={player.playing} />

      <div className="tr-playerPreferenceStage tr-trackPreference" aria-label="Track preference">
        <button type="button" className={`tr-prefLike ${track?.favorite ? "is-liked" : ""}`} disabled={!track} title={track?.favorite ? "Unlike" : "Like"} onClick={() => {
          if (!track) return;
          void setPlayerMusicPreference(track.id, track.favorite ? "neutral" : "like");
        }} aria-label={track?.favorite ? "Unlike this song" : "Like this song"}><PlayerIcon name="like" /><span>Like</span></button>
        <button type="button" className={`tr-prefLess ${track?.play_less ? "is-disliked" : ""}`} disabled={!track} title={track?.play_less ? "Remove Play Less" : "Play Less"} onClick={() => {
          if (!track) return;
          void setPlayerMusicPreference(track.id, track.play_less ? "neutral" : "play_less");
        }} aria-label={track?.play_less ? "Remove play less preference" : "Play this song less"}><PlayerIcon name="dislike" /><span>Play Less</span></button>
        <button type="button" className={`tr-prefDiscover ${discoverMessage ? "is-confirming" : ""}`} disabled={!track} title="Rediscover music" onClick={() => {
          if (!track) return;
          setDiscoverMessage("SEARCHING…");
          void discoverMoreFromTrack(track, player.libraryTracks)
            .then(() => { setDiscoverMessage("✓ REDISCOVERED"); window.setTimeout(() => setDiscoverMessage(""), 2200); })
            .catch(() => { setDiscoverMessage("REDISCOVER RETRY"); window.setTimeout(() => setDiscoverMessage(""), 2200); });
        }} aria-label="Rediscover music"><PlayerIcon name="discover" /><span>Rediscover</span></button>
      </div>

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
          <label className="tr-audioQueueSelector">
            <span>PLAYING FROM</span>
            <select value={player.activePlaylistId || "all"} disabled={queueBusy} onChange={(event: ChangeEvent<HTMLSelectElement>) => void selectQueue(event.target.value)} aria-label="Choose music playlist">
              <option value="all">All Uploaded Songs</option>
              {playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
            </select>
          </label>
          <button type="button" className={`tr-audioEqToggle ${eqOpen ? "is-active" : ""}`} onClick={() => setEqOpen((current) => !current)} aria-expanded={eqOpen}>
            <PlayerIcon name="equalizer" /><span>DSP / EQ</span>
          </button>
        </div>
      </div>

      {discoverMessage ? <div className="tr-discoverToast" role="status">{discoverMessage}</div> : null}

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
            <div className="tr-dspSaveIncludes"><span>SAVES</span><p>31-band EQ • Volume • DSP active state • Headphone mode • Width • Depth • Crossfeed • Center focus • Bass impact</p></div>
            <footer><button type="button" onClick={() => setSavePresetOpen(false)}>CANCEL</button><button type="button" className="is-primary" onClick={() => saveCurrentDspProfile(savePresetSlot, savePresetName.trim() || slotFallbackLabel(savePresetSlot))}>SAVE PRESET</button></footer>
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

        /* AUG 14 AUTHORITATIVE GENERATIVE HERO V4: 8 scenes, artwork palette, visible test verification */
        .tr-playerHero{isolation:isolate!important;background:#020609!important}
        .tr-playerVisualDebug{
          position:absolute!important;z-index:20!important;right:10px!important;top:9px!important;display:flex!important;align-items:center!important;gap:7px!important;
          min-height:24px!important;padding:0 8px!important;border:1px solid rgba(255,255,255,.19)!important;border-radius:999px!important;
          background:rgba(2,7,10,.72)!important;box-shadow:0 5px 16px rgba(0,0,0,.28)!important;backdrop-filter:blur(7px)!important;pointer-events:none!important;
          color:#fff!important;font-size:7px!important;font-weight:1000!important;letter-spacing:.08em!important;text-shadow:0 1px 3px rgba(0,0,0,.9)!important;
        }
        .tr-playerVisualDebug span{color:rgba(220,235,241,.72)!important}.tr-playerVisualDebug strong{color:#fff!important;font-size:8px!important;letter-spacing:.10em!important}
        .tr-playerVisualEngine{
          position:absolute!important;z-index:0!important;top:0!important;right:0!important;bottom:0!important;left:clamp(220px,30%,310px)!important;
          overflow:hidden!important;pointer-events:none!important;background:#020609!important;contain:paint!important;
        }
        .tr-playerVisualArtwork{
          position:absolute!important;z-index:0!important;inset:-34% -26% -34% -18%!important;width:152%!important;height:170%!important;
          object-fit:cover!important;object-position:center!important;opacity:.43!important;
          filter:blur(48px) saturate(1.95) contrast(1.08) brightness(.58)!important;
          transform:translate3d(0,0,0) scale(1.10)!important;transform-origin:center!important;
          animation:trVisualArtworkDrift 15s ease-in-out infinite alternate!important;
        }
        .tr-audioDeck--pro7.is-playing .tr-playerVisualArtwork{opacity:.50!important;animation-duration:11s!important}
        .tr-playerVisualEngine canvas{
          position:absolute!important;z-index:1!important;inset:0!important;width:100%!important;height:100%!important;display:block!important;
          opacity:1!important;mix-blend-mode:screen!important;filter:saturate(1.08) contrast(1.025)!important;
        }
        .tr-playerVisualGlass{
          position:absolute!important;z-index:2!important;inset:0!important;pointer-events:none!important;
          background:linear-gradient(90deg,rgba(1,5,8,.18) 0%,rgba(1,5,8,.02) 24%,rgba(1,5,8,.015) 73%,rgba(1,4,7,.15) 100%),linear-gradient(180deg,rgba(255,255,255,.012),transparent 34%,rgba(0,0,0,.10) 100%)!important;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.02)!important;
        }
        .tr-playerHero .tr-audioArtwork{position:relative!important;z-index:4!important}
        .tr-playerHero .tr-audioIdentity{
          position:relative!important;z-index:4!important;
          background:linear-gradient(90deg,rgba(2,7,10,.36) 0%,rgba(2,7,10,.14) 34%,rgba(2,7,10,.06) 68%,rgba(2,7,10,.13) 100%)!important;
          text-shadow:0 2px 18px rgba(0,0,0,.94),0 1px 3px rgba(0,0,0,.80)!important;
        }
        .tr-playerHero .tr-audioIdentity:before{background:radial-gradient(72% 95% at 10% 50%,rgba(0,0,0,.17),transparent 72%),linear-gradient(90deg,rgba(0,0,0,.055),transparent 58%)!important}
        @keyframes trVisualArtworkDrift{
          0%{transform:translate3d(-2%,-2%,0) scale(1.08)}
          50%{transform:translate3d(2%,2%,0) scale(1.15)}
          100%{transform:translate3d(-1%,4%,0) scale(1.11)}
        }
        @media(max-width:650px){
          .tr-playerVisualDebug{right:6px!important;top:6px!important;min-height:20px!important;padding:0 6px!important;gap:5px!important;font-size:5.5px!important}.tr-playerVisualDebug strong{font-size:6.5px!important}
          .tr-playerVisualEngine{left:112px!important}
          .tr-playerVisualArtwork{inset:-28% -32% -30% -16%!important;width:160%!important;height:160%!important;opacity:.39!important;filter:blur(31px) saturate(1.85) contrast(1.06) brightness(.56)!important}
          .tr-audioDeck--pro7.is-playing .tr-playerVisualArtwork{opacity:.46!important}
          .tr-playerHero .tr-audioIdentity{background:linear-gradient(90deg,rgba(2,7,10,.34),rgba(2,7,10,.11) 62%,rgba(2,7,10,.16))!important}
        }
        @media(max-width:380px){.tr-playerVisualEngine{left:102px!important}}
        @media(prefers-reduced-motion:reduce){.tr-playerVisualArtwork{animation:none!important}}

      `}</style>
    </section>
  );
}
