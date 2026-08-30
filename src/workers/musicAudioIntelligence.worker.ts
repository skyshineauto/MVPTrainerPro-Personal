import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
import type { LocalAudioIntelligence } from "../lib/musicAudioIntelligence";

type AnalyzeRequest = {
  type: "analyze";
  id: number;
  pcm: Float32Array;
  sampleRate: number;
};

type AnalyzeResponse =
  | { type: "result"; id: number; result: LocalAudioIntelligence }
  | { type: "error"; id: number; error: string };

type EssentiaLike = {
  arrayToVector: (value: Float32Array | number[]) => any;
  Resample: (signal: any, inputSampleRate?: number, outputSampleRate?: number, quality?: number) => { signal: any };
  RhythmExtractor2013: (signal: any, maxTempo?: number, method?: string, minTempo?: number) => Record<string, unknown>;
  KeyExtractor: (signal: any, ...args: any[]) => Record<string, unknown>;
  Danceability: (signal: any, maxTau?: number, minTau?: number, sampleRate?: number, tauMultiplier?: number) => Record<string, unknown>;
  DynamicComplexity: (signal: any, frameSize?: number, sampleRate?: number) => Record<string, unknown>;
  SpectralCentroidTime: (signal: any, sampleRate?: number) => Record<string, unknown>;
  ZeroCrossingRate: (signal: any, threshold?: number) => Record<string, unknown>;
};

type FeatureFailure = { feature: string; error: string };

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

function clamp01(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function clamp100(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
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

function calculateRmsDb(pcm: Float32Array) {
  if (!pcm.length) return null;
  const stride = Math.max(1, Math.floor(pcm.length / 2_000_000));
  let sum = 0;
  let count = 0;
  for (let index = 0; index < pcm.length; index += stride) {
    const sample = pcm[index];
    sum += sample * sample;
    count += 1;
  }
  if (!count) return null;
  const rms = Math.sqrt(sum / count);
  if (!(rms > 0)) return -90;
  return Math.max(-90, 20 * Math.log10(rms));
}

function representativeWindow(pcm: Float32Array, sampleRate: number, maxSeconds = 90) {
  const maxSamples = Math.max(4096, Math.floor(sampleRate * maxSeconds));
  if (pcm.length <= maxSamples) return pcm;

  // Avoid intros/outros when possible. A centered window is more representative
  // for BPM/key while keeping WASM memory bounded on long tracks.
  const center = Math.floor(pcm.length * 0.52);
  const start = Math.max(0, Math.min(pcm.length - maxSamples, center - Math.floor(maxSamples / 2)));
  return pcm.subarray(start, start + maxSamples);
}

function normalize(value: number | null, low: number, high: number, fallback = 50) {
  if (value == null || !Number.isFinite(value) || high <= low) return fallback;
  return clamp100(((value - low) / (high - low)) * 100);
}

function analyze(message: AnalyzeRequest): LocalAudioIntelligence {
  const api = getEssentia();
  if (!(message.pcm instanceof Float32Array) || message.pcm.length < 4096) {
    throw new Error("Not enough decoded audio for analysis.");
  }

  const inputRate = Number.isFinite(message.sampleRate) && message.sampleRate > 0 ? message.sampleRate : 44100;
  const durationSeconds = message.pcm.length / inputRate;
  const rmsDb = calculateRmsDb(message.pcm);
  const analysisPcm = representativeWindow(message.pcm, inputRate, 90);

  const successfulFeatures: string[] = [];
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

  let inputVector: any = null;
  let analysisVector: any = null;
  try {
    inputVector = api.arrayToVector(analysisPcm);
    analysisVector = inputRate === 44100
      ? inputVector
      : api.Resample(inputVector, inputRate, 44100, 1).signal;

    // Core features first. If a later optional descriptor throws a WASM
    // exception, BPM/key survive instead of losing the entire analysis.
    const rhythm = runFeature("bpm", () => api.RhythmExtractor2013(analysisVector, 208, "multifeature", 40));
    const keyResult = runFeature("key", () => api.KeyExtractor(analysisVector));
    const dance = runFeature("danceability", () => api.Danceability(analysisVector, 8800, 310, 44100, 1.1));
    const dynamics = runFeature("dynamics", () => api.DynamicComplexity(analysisVector, 0.2, 44100));
    const centroid = runFeature("spectral-centroid", () => api.SpectralCentroidTime(analysisVector, 44100));
    const zero = runFeature("zero-crossing", () => api.ZeroCrossingRate(analysisVector, 0.0001));

    const bpmRaw = numberOrNull(rhythm?.bpm);
    const bpm = bpmRaw != null && bpmRaw >= 40 && bpmRaw <= 240 ? Math.round(bpmRaw * 10) / 10 : null;
    const rhythmConfidenceRaw = numberOrNull(rhythm?.confidence);
    const bpmConfidence = rhythmConfidenceRaw == null
      ? 0
      : Math.max(0, Math.min(1, rhythmConfidenceRaw / (rhythmConfidenceRaw + 1.5)));

    const key = typeof keyResult?.key === "string" && keyResult.key.trim() ? keyResult.key.trim() : null;
    const scale = typeof keyResult?.scale === "string" && keyResult.scale.trim() ? keyResult.scale.trim() : null;
    const keyStrength = clamp01(keyResult?.strength);
    const danceability = numberOrNull(dance?.danceability);
    const loudnessDb = numberOrNull(dynamics?.loudness);
    const dynamicComplexity = numberOrNull(dynamics?.dynamicComplexity);
    const spectralCentroidHz = numberOrNull(centroid?.centroid);
    const zeroCrossingRate = numberOrNull(zero?.zeroCrossingRate);

    // Essentia's legacy Intensity classifier is intentionally not used. Build
    // an MVP intensity score from measured tempo, loudness, danceability,
    // brightness and zero-crossing motion instead.
    const pace = bpm == null ? 50 : normalize(bpm, 62, 176, 50);
    const loudness = normalize(rmsDb, -28, -7, 50);
    const danceScore = danceability == null ? 50 : clamp100((danceability / 3) * 100);
    const brightness = normalize(spectralCentroidHz, 650, 5200, 50);
    const noiseMotion = normalize(zeroCrossingRate, 0.018, 0.19, 35);
    const intensityScore = clamp100(
      pace * 0.27 +
      loudness * 0.37 +
      danceScore * 0.16 +
      brightness * 0.10 +
      noiseMotion * 0.10,
    );

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
      successfulFeatures,
      failedFeatures,
    };
  } finally {
    if (analysisVector && analysisVector !== inputVector) safeDelete(analysisVector);
    safeDelete(inputVector);
  }
}

self.addEventListener("message", (event: MessageEvent<AnalyzeRequest>) => {
  const message = event.data;
  if (!message || message.type !== "analyze") return;
  let response: AnalyzeResponse;
  try {
    response = { type: "result", id: message.id, result: analyze(message) };
  } catch (error) {
    response = {
      type: "error",
      id: message.id,
      error: errorText(error),
    };
  }
  self.postMessage(response);
});
