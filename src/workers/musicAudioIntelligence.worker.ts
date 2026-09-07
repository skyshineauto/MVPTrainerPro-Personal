import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
import type {
  LocalAudioIntelligence,
  MusicAiAutoSoundProfiles,
  MusicAudioSourceMeta,
  MusicAudioTechnicalAnalysis,
  MusicMasterPrepProfile,
} from "../lib/musicAudioIntelligence";

type AnalyzeRequest = {
  type: "analyze";
  id: number;
  pcmLeft: Float32Array;
  pcmRight: Float32Array;
  sampleRate: number;
  sourceMeta: MusicAudioSourceMeta;
};

type AnalyzeResponse =
  | { type: "result"; id: number; result: LocalAudioIntelligence }
  | { type: "error"; id: number; error: string };

type EssentiaLike = {
  arrayToVector: (value: Float32Array | number[]) => any;
  RhythmExtractor2013: (signal: any, maxTempo?: number, method?: string, minTempo?: number) => Record<string, unknown>;
  PercivalBpmEstimator: (
    signal: any,
    frameSize?: number,
    frameSizeOSS?: number,
    hopSize?: number,
    hopSizeOSS?: number,
    maxBPM?: number,
    minBPM?: number,
    sampleRate?: number,
  ) => Record<string, unknown>;
  KeyExtractor: (signal: any, ...args: any[]) => Record<string, unknown>;
  Danceability: (signal: any, maxTau?: number, minTau?: number, sampleRate?: number, tauMultiplier?: number) => Record<string, unknown>;
  DynamicComplexity: (signal: any, frameSize?: number, sampleRate?: number) => Record<string, unknown>;
  SpectralCentroidTime: (signal: any, sampleRate?: number) => Record<string, unknown>;
  ZeroCrossingRate: (signal: any, threshold?: number) => Record<string, unknown>;
};

type FeatureFailure = { feature: string; error: string };

const TARGET_SAMPLE_RATE = 44100;
const ANALYSIS_WINDOW_SECONDS = 45;
let essentia: EssentiaLike | null = null;

function getEssentia() {
  if (essentia) return essentia;
  if (!Essentia || !EssentiaWASM) throw new Error("Essentia.js failed to initialize.");
  essentia = new Essentia(EssentiaWASM) as unknown as EssentiaLike;
  return essentia;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 1) : 0;
}

function clamp100(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 100) : 0;
}

function db(value: number, floor = -120) {
  return value > 0 ? Math.max(floor, 20 * Math.log10(value)) : floor;
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "number") return `Essentia WASM exception ${error}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error || "Unknown Essentia error");
  }
}

function safeDelete(value: unknown) {
  if (value && typeof value === "object" && "delete" in value && typeof (value as { delete?: unknown }).delete === "function") {
    try {
      (value as { delete: () => void }).delete();
    } catch {
      // Emscripten vector cleanup is best-effort.
    }
  }
}

function cleanupResultVectors(result: Record<string, unknown> | null | undefined) {
  if (!result) return;
  for (const value of Object.values(result)) safeDelete(value);
}

function finiteSample(value: number) {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, -4, 4);
}

function representativeWindow(pcm: Float32Array, sampleRate: number, maxSeconds = ANALYSIS_WINDOW_SECONDS) {
  const maxSamples = Math.max(4096, Math.floor(sampleRate * maxSeconds));
  if (pcm.length <= maxSamples) return pcm;
  const center = Math.floor(pcm.length * 0.52);
  const start = Math.max(0, Math.min(pcm.length - maxSamples, center - Math.floor(maxSamples / 2)));
  return pcm.subarray(start, start + maxSamples);
}

function resampleLinear(input: Float32Array, inputRate: number, outputRate: number) {
  const safeInputRate = Number.isFinite(inputRate) && inputRate > 0 ? inputRate : outputRate;
  if (input.length < 2) return new Float32Array(input);
  if (Math.abs(safeInputRate - outputRate) < 1) {
    const output = new Float32Array(input.length);
    for (let index = 0; index < input.length; index += 1) output[index] = clamp(finiteSample(input[index]), -1, 1);
    return output;
  }
  const outputLength = Math.max(4096, Math.round(input.length * outputRate / safeInputRate));
  const output = new Float32Array(outputLength);
  const sourceStep = safeInputRate / outputRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * sourceStep;
    const leftIndex = Math.min(input.length - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(input.length - 1, leftIndex + 1);
    const mix = sourcePosition - leftIndex;
    const left = clamp(finiteSample(input[leftIndex]), -1, 1);
    const right = clamp(finiteSample(input[rightIndex]), -1, 1);
    output[index] = left + (right - left) * mix;
  }
  return output;
}

function prepareAnalysisPcm(pcm: Float32Array, sampleRate: number) {
  const window = representativeWindow(pcm, sampleRate, ANALYSIS_WINDOW_SECONDS);
  const prepared = resampleLinear(window, sampleRate, TARGET_SAMPLE_RATE);
  if (prepared.length < 4096) throw new Error("Prepared audio window is too short for Essentia analysis.");
  return prepared;
}

function normalize(value: number | null, low: number, high: number, fallback = 50) {
  if (value == null || !Number.isFinite(value) || high <= low) return fallback;
  return clamp100(((value - low) / (high - low)) * 100);
}

function monoFromStereo(left: Float32Array, right: Float32Array) {
  const length = Math.min(left.length, right.length || left.length);
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i += 1) mono[i] = clamp((finiteSample(left[i]) + finiteSample(right[i])) * 0.5, -1, 1);
  return mono;
}

function percentile(values: number[], amount: number) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const at = clamp(amount, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const mix = at - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * mix;
}

function goertzelMagnitude(pcm: Float32Array, sampleRate: number, frequency: number) {
  if (!pcm.length || frequency <= 0 || frequency >= sampleRate * 0.49) return 0;
  const maxPoints = 260_000;
  const stride = Math.max(1, Math.floor(pcm.length / maxPoints));
  const effectiveRate = sampleRate / stride;
  if (frequency >= effectiveRate * 0.49) return 0;
  const omega = 2 * Math.PI * frequency / effectiveRate;
  const coeff = 2 * Math.cos(omega);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let count = 0;
  for (let i = 0; i < pcm.length; i += stride) {
    s0 = finiteSample(pcm[i]) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
    count += 1;
  }
  if (!count) return 0;
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return Math.sqrt(Math.max(0, power)) / count;
}

function codecFromMeta(meta: MusicAudioSourceMeta) {
  const name = String(meta.originalName || "").toLowerCase();
  const mime = String(meta.mimeType || "").toLowerCase();
  if (name.endsWith(".wav") || mime.includes("wav")) return "WAV";
  if (name.endsWith(".flac") || mime.includes("flac")) return "FLAC";
  if (name.endsWith(".m4a") || mime.includes("mp4") || mime.includes("m4a")) return "AAC/M4A";
  if (name.endsWith(".mp3") || mime.includes("mpeg") || mime.includes("mp3")) return "MP3";
  return mime ? mime.toUpperCase() : "UNKNOWN";
}

function buildTechnical(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  durationSeconds: number,
  meta: MusicAudioSourceMeta,
): MusicAudioTechnicalAnalysis {
  const length = Math.max(1, Math.min(left.length, right.length || left.length));
  let sumL2 = 0;
  let sumR2 = 0;
  let sumLR = 0;
  let sumL = 0;
  let sumR = 0;
  let samplePeak = 0;
  let clippedSamples = 0;
  let transientSum = 0;
  let previousMono = 0;
  const blockDb: number[] = [];
  const blockFrames = Math.max(256, Math.floor(sampleRate * 0.4));
  let blockSum = 0;
  let blockCount = 0;

  for (let i = 0; i < length; i += 1) {
    const l = finiteSample(left[i]);
    const r = finiteSample(right[i]);
    const mono = (l + r) * 0.5;
    samplePeak = Math.max(samplePeak, Math.abs(l), Math.abs(r));
    if (Math.abs(l) >= 0.9995) clippedSamples += 1;
    if (Math.abs(r) >= 0.9995) clippedSamples += 1;
    sumL2 += l * l;
    sumR2 += r * r;
    sumLR += l * r;
    sumL += l;
    sumR += r;
    transientSum += Math.abs(mono - previousMono);
    previousMono = mono;
    blockSum += mono * mono;
    blockCount += 1;
    if (blockCount >= blockFrames) {
      blockDb.push(db(Math.sqrt(blockSum / blockCount), -90));
      blockSum = 0;
      blockCount = 0;
    }
  }
  if (blockCount) blockDb.push(db(Math.sqrt(blockSum / blockCount), -90));

  let estimatedTruePeak = samplePeak;
  let intersampleOvers = 0;
  const truePeakStride = Math.max(1, Math.floor(length / 2_500_000));
  for (let i = 1; i < length - 2; i += truePeakStride) {
    for (const channel of [left, right]) {
      const y0 = finiteSample(channel[i - 1]);
      const y1 = finiteSample(channel[i]);
      const y2 = finiteSample(channel[i + 1]);
      const y3 = finiteSample(channel[i + 2]);
      for (let phase = 1; phase < 4; phase += 1) {
        const t = phase / 4;
        const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
        const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
        const a2 = -0.5 * y0 + 0.5 * y2;
        const estimate = ((a0 * t + a1) * t + a2) * t + y1;
        const magnitude = Math.abs(estimate);
        estimatedTruePeak = Math.max(estimatedTruePeak, magnitude);
        if (magnitude > 1) intersampleOvers += 1;
      }
    }
  }

  const rmsL = Math.sqrt(sumL2 / length);
  const rmsR = Math.sqrt(sumR2 / length);
  const rms = Math.sqrt((sumL2 + sumR2) / (2 * length));
  const denom = Math.sqrt(sumL2 * sumR2);
  const correlation = denom > 1e-12 ? clamp(sumLR / denom, -1, 1) : 1;
  const midEnergy = Math.max(1e-12, (sumL2 + sumR2 + 2 * sumLR) * 0.25);
  const sideEnergy = Math.max(0, (sumL2 + sumR2 - 2 * sumLR) * 0.25);
  const widthPercent = clamp(Math.sqrt(sideEnergy / midEnergy) * 100, 0, 240);
  const channelBalanceDb = clamp(db(Math.max(1e-9, rmsL)) - db(Math.max(1e-9, rmsR)), -6, 6);
  const dcOffset = Math.max(Math.abs(sumL / length), Math.abs(sumR / length));

  const mono = representativeWindow(monoFromStereo(left, right), sampleRate, 36);
  const hz35 = goertzelMagnitude(mono, sampleRate, 35);
  const hz55 = goertzelMagnitude(mono, sampleRate, 55);
  const hz90 = goertzelMagnitude(mono, sampleRate, 90);
  const hz180 = goertzelMagnitude(mono, sampleRate, 180);
  const hz300 = goertzelMagnitude(mono, sampleRate, 300);
  const hz500 = goertzelMagnitude(mono, sampleRate, 500);
  const hz1000 = goertzelMagnitude(mono, sampleRate, 1000);
  const hz2500 = goertzelMagnitude(mono, sampleRate, 2500);
  const hz4500 = goertzelMagnitude(mono, sampleRate, 4500);
  const hz7000 = goertzelMagnitude(mono, sampleRate, 7000);
  const hz9500 = goertzelMagnitude(mono, sampleRate, 9500);
  const hz13000 = goertzelMagnitude(mono, sampleRate, 13000);
  const hz16000 = goertzelMagnitude(mono, sampleRate, 16000);
  const safe = (value: number) => Math.max(1e-9, value);
  const ratioScore = (a: number, b: number, center = 1, span = 2) => clamp100(50 + (20 * Math.log10(safe(a) / safe(b)) - center) * (50 / span));

  const bassRef = (hz90 + hz180) * 0.5;
  const bassExtension = clamp100(50 + 18 * Math.log10(safe((hz35 + hz55) * 0.5) / safe(bassRef)) + 34);
  const lowMidBuildup = clamp100(50 + 18 * Math.log10(safe((hz180 + hz300 + hz500) / 3) / safe((hz1000 + hz2500) * 0.5)) + 8);
  const presenceBalance = ratioScore((hz2500 + hz4500) * 0.5, (hz500 + hz1000) * 0.5, 0, 16);
  const harshness = clamp100(50 + 22 * Math.log10(safe((hz4500 + hz7000) * 0.5) / safe((hz1000 + hz2500) * 0.5)) + 17);
  const sibilance = clamp100(50 + 22 * Math.log10(safe((hz7000 + hz9500) * 0.5) / safe((hz2500 + hz4500) * 0.5)) + 18);
  const hfRolloff = clamp100(50 - 22 * Math.log10(safe((hz13000 + hz16000) * 0.5) / safe((hz4500 + hz7000) * 0.5)) - 23);
  const rumble = clamp100(50 + 24 * Math.log10(safe(hz35) / safe((hz90 + hz180) * 0.5)) + 30);
  const transientStrength = clamp100((transientSum / length) / Math.max(1e-6, rms) * 180);
  const crestFactorDb = clamp(db(Math.max(samplePeak, 1e-9)) - db(Math.max(rms, 1e-9)), 0, 30);
  const dynamicRangeDb = clamp(percentile(blockDb, 0.9) - percentile(blockDb, 0.1), 0, 30);

  const codec = codecFromMeta(meta);
  const lossless = codec === "WAV" || codec === "FLAC" || /ALAC/i.test(codec);
  const fileSize = Number(meta.fileSizeBytes || 0);
  const bitrateKbps = fileSize > 0 && durationSeconds > 0 ? Math.round(fileSize * 8 / durationSeconds / 1000) : null;
  const sourceQuality = lossless
    ? "lossless"
    : bitrateKbps == null
      ? "unknown"
      : bitrateKbps >= 256
        ? "high"
        : bitrateKbps >= 160
          ? "standard"
          : "low";
  const defects: string[] = [];
  if (clippedSamples > 0) defects.push("sample clipping detected");
  if (intersampleOvers > 0) defects.push("intersample overs detected");
  if (dcOffset > 0.003) defects.push("DC offset detected");
  if (rumble > 72) defects.push("subsonic/rumble buildup");
  if (Math.abs(channelBalanceDb) > 1.2) defects.push("left/right level imbalance");
  const phaseRisk = correlation < 0.12 || widthPercent > 190;
  if (phaseRisk) defects.push("stereo phase/correlation risk");
  if (harshness > 78) defects.push("upper-mid harshness");
  if (sibilance > 82) defects.push("sibilance emphasis");
  if (hfRolloff > 82) defects.push("high-frequency rolloff");

  return {
    codec,
    bitrateKbps,
    sampleRateHz: sampleRate,
    bitDepth: Number.isFinite(Number(meta.bitDepth)) ? Number(meta.bitDepth) : null,
    channelCount: Number.isFinite(Number(meta.channelCount)) ? Math.max(1, Math.round(Number(meta.channelCount))) : 2,
    lossless,
    sourceQuality,
    averageLoudnessDb: db(rms, -90),
    rmsDb: db(rms, -90),
    samplePeakDbfs: db(samplePeak, -120),
    truePeakDbtp: db(estimatedTruePeak, -120),
    intersampleOvers,
    clippedSamples,
    crestFactorDb,
    dynamicRangeDb,
    bassExtension,
    lowMidBuildup,
    presenceBalance,
    harshness,
    sibilance,
    hfRolloff,
    transientStrength,
    stereoWidthPercent: widthPercent,
    correlation,
    channelBalanceDb,
    dcOffset,
    rumble,
    phaseRisk,
    defects,
  };
}

function buildMasterPrep(technical: MusicAudioTechnicalAnalysis): MusicMasterPrepProfile {
  const reasons: string[] = [];
  // R78f: Master Prep never turns down the song. The proven r77i shared clean-headroom
  // controller already owns attenuation and true-peak safety. Master Prep may only
  // recover clean level from quieter masters.
  const sourceGainDb = clamp(-1.3 - technical.truePeakDbtp, 0, 1.5);
  const highpassHz = technical.rumble > 72 ? 26 : technical.rumble > 55 || technical.dcOffset > 0.002 ? 22 : 18;
  const lowMidDb = -clamp((technical.lowMidBuildup - 56) * 0.035, 0, 1.5);
  const presenceDb = technical.presenceBalance < 34 ? 0.55 : technical.presenceBalance > 78 ? -0.45 : 0;
  const harshnessDb = -clamp((Math.max(technical.harshness, technical.sibilance) - 58) * 0.035, 0, 1.4);
  const channelBalanceDb = clamp(technical.channelBalanceDb, -0.8, 0.8);
  const widthScale = technical.phaseRisk ? 0.9 : technical.correlation < 0.3 ? 0.95 : 1;
  if (Math.abs(sourceGainDb) >= 0.25) reasons.push("source gain/headroom");
  if (highpassHz > 18) reasons.push("rumble/DC cleanup");
  if (lowMidDb < -0.15) reasons.push("low-mid cleanup");
  if (Math.abs(presenceDb) > 0.1) reasons.push("presence balance");
  if (harshnessDb < -0.15) reasons.push("harshness/sibilance control");
  if (Math.abs(channelBalanceDb) > 0.15) reasons.push("channel balance");
  if (widthScale < 0.99) reasons.push("stereo phase integrity");
  return {
    enabled: true,
    sourceGainDb: Math.round(sourceGainDb * 100) / 100,
    highpassHz,
    lowMidDb: Math.round(lowMidDb * 100) / 100,
    presenceDb: Math.round(presenceDb * 100) / 100,
    harshnessDb: Math.round(harshnessDb * 100) / 100,
    channelBalanceDb: Math.round(channelBalanceDb * 100) / 100,
    widthScale,
    reasons,
  };
}

function buildAutoSound(technical: MusicAudioTechnicalAnalysis, meta: MusicAudioSourceMeta): MusicAiAutoSoundProfiles {
  const text = `${meta.genre || ""} ${meta.energyLevel || ""}`.toLowerCase();
  const energetic = /high|rock|metal|punk|hardcore|industrial|edm|hip.?hop/.test(text);
  const heavy = /metal|hard rock|hardcore|industrial|grunge|post-grunge/.test(text);
  const cleanBase = technical.harshness < 74 && technical.sibilance < 78 && (technical.hfRolloff > 38 || technical.presenceBalance < 48);
  const bassBase = technical.bassExtension < 60 || heavy;
  const impactBase = energetic && technical.transientStrength < 72;
  let xpander: 0 | 1 | 2 | 3 = technical.hfRolloff > 78 ? 3 : technical.hfRolloff > 58 || technical.sourceQuality === "low" ? 2 : technical.hfRolloff > 38 ? 1 : 0;
  const analog: "off" | "studio" | "warm" = technical.harshness > 76 ? "warm" : technical.sourceQuality === "low" ? "studio" : "off";
  const compatibilityNotes: string[] = [];
  if (cleanBase && xpander > 2) {
    xpander = 2;
    compatibilityNotes.push("Clear + Xpander share the HF/detail budget");
  }
  if (impactBase && xpander > 2) {
    xpander = 2;
    compatibilityNotes.push("Impact/Punch + Xpander share the transient budget");
  }
  if (analog !== "off" && xpander > 2) {
    xpander = 2;
    compatibilityNotes.push("Analog + Xpander share the harmonic budget");
  }
  const safeWide = technical.correlation > 0.28 && !technical.phaseRisk && technical.stereoWidthPercent < 125;
  // R78f: always request High/Max Output from the r77i clean-output controller.
  // That controller measures the real post-effect true peak and grants only the
  // clean gain that actually exists, so AI must not make hot masters artificially quiet.
  const cleanOutput = true;

  return {
    headphones: {
      clear: cleanBase,
      neuralBass: bassBase,
      impactOrPunch: impactBase,
      hdXpanderLevel: xpander,
      analog,
      wide: safeWide && technical.stereoWidthPercent < 105,
      highOutput: cleanOutput,
      compatibilityNotes: [...compatibilityNotes],
    },
    speaker: {
      clear: cleanBase && technical.harshness < 70,
      neuralBass: bassBase || technical.bassExtension < 67,
      impactOrPunch: energetic && technical.transientStrength < 78,
      hdXpanderLevel: xpander > 0 ? (Math.min(2, xpander) as 1 | 2) : 0,
      analog,
      wide: safeWide && technical.stereoWidthPercent < 112,
      highOutput: cleanOutput,
      compatibilityNotes: [
        ...compatibilityNotes,
        ...(bassBase && safeWide ? ["Neural Bass + Wide keeps low bass centered"] : []),
      ],
    },
  };
}

function analyze(message: AnalyzeRequest): LocalAudioIntelligence {
  const api = getEssentia();
  if (!(message.pcmLeft instanceof Float32Array) || message.pcmLeft.length < 4096) {
    throw new Error("Not enough decoded audio for analysis.");
  }
  const right = message.pcmRight instanceof Float32Array && message.pcmRight.length ? message.pcmRight : message.pcmLeft;
  const inputRate = Number.isFinite(message.sampleRate) && message.sampleRate > 0 ? message.sampleRate : TARGET_SAMPLE_RATE;
  const durationSeconds = message.pcmLeft.length / inputRate;
  const technical = buildTechnical(message.pcmLeft, right, inputRate, durationSeconds, message.sourceMeta || {});
  const masterPrep = buildMasterPrep(technical);
  const autoSound = buildAutoSound(technical, message.sourceMeta || {});
  const mono = monoFromStereo(message.pcmLeft, right);
  const rmsDb = technical.rmsDb;

  let preparedPcm: Float32Array;
  try {
    preparedPcm = prepareAnalysisPcm(mono, inputRate);
  } catch (error) {
    throw new Error(`Audio preparation failed: ${errorText(error)}`);
  }

  const successfulFeatures: string[] = ["master-prep", "technical-audio"];
  const failedFeatures: FeatureFailure[] = [];
  const runFeature = <T>(feature: string, fn: () => T): T | null => {
    try {
      const value = fn();
      successfulFeatures.push(feature);
      return value;
    } catch (error) {
      const failure = { feature, error: errorText(error) };
      failedFeatures.push(failure);
      console.warn(`[MVP audio worker] ${feature} failed: ${failure.error}`);
      return null;
    }
  };

  let analysisVector: any = null;
  try {
    analysisVector = api.arrayToVector(preparedPcm);
    let rhythm = runFeature("bpm-rhythm", () => api.RhythmExtractor2013(analysisVector, 208, "multifeature", 40));
    if (!rhythm || numberOrNull(rhythm.bpm) == null) {
      cleanupResultVectors(rhythm);
      rhythm = runFeature("bpm-percival", () => api.PercivalBpmEstimator(analysisVector, 1024, 2048, 128, 128, 210, 40, TARGET_SAMPLE_RATE));
    }
    const keyResult = runFeature("key", () => api.KeyExtractor(analysisVector));
    const dance = runFeature("danceability", () => api.Danceability(analysisVector, 8800, 310, TARGET_SAMPLE_RATE, 1.1));
    const dynamics = runFeature("dynamics", () => api.DynamicComplexity(analysisVector, 0.2, TARGET_SAMPLE_RATE));
    const centroid = runFeature("spectral-centroid", () => api.SpectralCentroidTime(analysisVector, TARGET_SAMPLE_RATE));
    const zero = runFeature("zero-crossing", () => api.ZeroCrossingRate(analysisVector, 0.0001));

    const bpmRaw = numberOrNull(rhythm?.bpm);
    const bpm = bpmRaw != null && bpmRaw >= 40 && bpmRaw <= 240 ? Math.round(bpmRaw * 10) / 10 : null;
    const rhythmConfidenceRaw = numberOrNull(rhythm?.confidence);
    const bpmConfidence = rhythmConfidenceRaw == null ? (bpm == null ? 0 : 0.58) : clamp01(rhythmConfidenceRaw / (rhythmConfidenceRaw + 1.5));
    const key = typeof keyResult?.key === "string" && keyResult.key.trim() ? keyResult.key.trim() : null;
    const scale = typeof keyResult?.scale === "string" && keyResult.scale.trim() ? keyResult.scale.trim() : null;
    const keyStrength = clamp01(keyResult?.strength);
    const danceability = numberOrNull(dance?.danceability);
    const loudnessDb = numberOrNull(dynamics?.loudness);
    const dynamicComplexity = numberOrNull(dynamics?.dynamicComplexity);
    const spectralCentroidHz = numberOrNull(centroid?.centroid);
    const zeroCrossingRate = numberOrNull(zero?.zeroCrossingRate);
    const pace = bpm == null ? 50 : normalize(bpm, 62, 176, 50);
    const loudness = normalize(rmsDb, -28, -7, 50);
    const danceScore = danceability == null ? 50 : clamp100((danceability / 3) * 100);
    const brightness = normalize(spectralCentroidHz, 650, 5200, 50);
    const noiseMotion = normalize(zeroCrossingRate, 0.018, 0.19, 35);
    const intensityScore = clamp100(pace * 0.27 + loudness * 0.37 + danceScore * 0.16 + brightness * 0.10 + noiseMotion * 0.10);

    cleanupResultVectors(rhythm);
    cleanupResultVectors(dance);

    return {
      bpm,
      bpmConfidence,
      key,
      scale,
      keyStrength,
      danceability,
      intensityScore,
      loudnessDb,
      dynamicComplexity,
      spectralCentroidHz,
      zeroCrossingRate,
      rmsDb,
      durationSeconds,
      technical,
      masterPrep,
      autoSound,
      successfulFeatures,
      failedFeatures,
    };
  } finally {
    safeDelete(analysisVector);
  }
}

self.addEventListener("message", (event: MessageEvent<AnalyzeRequest>) => {
  const message = event.data;
  if (!message || message.type !== "analyze") return;
  let response: AnalyzeResponse;
  try {
    response = { type: "result", id: message.id, result: analyze(message) };
  } catch (error) {
    response = { type: "error", id: message.id, error: errorText(error) };
  }
  self.postMessage(response);
});
