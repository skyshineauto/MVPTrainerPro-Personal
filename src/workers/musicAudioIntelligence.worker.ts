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

function finiteSample(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function calculateRmsDb(pcm: Float32Array) {
  if (!pcm.length) return null;
  const stride = Math.max(1, Math.floor(pcm.length / 2_000_000));
  let sum = 0;
  let count = 0;
  for (let index = 0; index < pcm.length; index += stride) {
    const sample = finiteSample(pcm[index]);
    sum += sample * sample;
    count += 1;
  }
  if (!count) return null;
  const rms = Math.sqrt(sum / count);
  if (!(rms > 0)) return -90;
  return Math.max(-90, 20 * Math.log10(rms));
}

function representativeWindow(pcm: Float32Array, sampleRate: number, maxSeconds = ANALYSIS_WINDOW_SECONDS) {
  const maxSamples = Math.max(4096, Math.floor(sampleRate * maxSeconds));
  if (pcm.length <= maxSamples) return pcm;

  // Favor the middle of the song so long intros/outros do not dominate BPM/key.
  const center = Math.floor(pcm.length * 0.52);
  const start = Math.max(0, Math.min(pcm.length - maxSamples, center - Math.floor(maxSamples / 2)));
  return pcm.subarray(start, start + maxSamples);
}

function resampleLinear(input: Float32Array, inputRate: number, outputRate: number) {
  const safeInputRate = Number.isFinite(inputRate) && inputRate > 0 ? inputRate : outputRate;
  if (input.length < 2) return new Float32Array(input);

  if (Math.abs(safeInputRate - outputRate) < 1) {
    const output = new Float32Array(input.length);
    for (let index = 0; index < input.length; index += 1) output[index] = finiteSample(input[index]);
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
    const left = finiteSample(input[leftIndex]);
    const right = finiteSample(input[rightIndex]);
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

function analyze(message: AnalyzeRequest): LocalAudioIntelligence {
  const api = getEssentia();
  if (!(message.pcm instanceof Float32Array) || message.pcm.length < 4096) {
    throw new Error("Not enough decoded audio for analysis.");
  }

  const inputRate = Number.isFinite(message.sampleRate) && message.sampleRate > 0 ? message.sampleRate : TARGET_SAMPLE_RATE;
  const durationSeconds = message.pcm.length / inputRate;
  const rmsDb = calculateRmsDb(message.pcm);

  let preparedPcm: Float32Array;
  try {
    preparedPcm = prepareAnalysisPcm(message.pcm, inputRate);
  } catch (error) {
    throw new Error(`Audio preparation failed: ${errorText(error)}`);
  }

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

  let analysisVector: any = null;
  try {
    try {
      analysisVector = api.arrayToVector(preparedPcm);
    } catch (error) {
      throw new Error(`Essentia vectorize failed: ${errorText(error)}`);
    }

    // Tempo gets a second independent estimator. A RhythmExtractor2013 WASM
    // failure no longer prevents a valid BPM from PercivalBpmEstimator.
    let rhythm = runFeature("bpm-rhythm", () => api.RhythmExtractor2013(analysisVector, 208, "multifeature", 40));
    if (!rhythm || numberOrNull(rhythm.bpm) == null) {
      cleanupResultVectors(rhythm);
      rhythm = runFeature("bpm-percival", () => api.PercivalBpmEstimator(
        analysisVector,
        1024,
        2048,
        128,
        128,
        210,
        40,
        TARGET_SAMPLE_RATE,
      ));
    }

    const keyResult = runFeature("key", () => api.KeyExtractor(analysisVector));
    const dance = runFeature("danceability", () => api.Danceability(analysisVector, 8800, 310, TARGET_SAMPLE_RATE, 1.1));
    const dynamics = runFeature("dynamics", () => api.DynamicComplexity(analysisVector, 0.2, TARGET_SAMPLE_RATE));
    const centroid = runFeature("spectral-centroid", () => api.SpectralCentroidTime(analysisVector, TARGET_SAMPLE_RATE));
    const zero = runFeature("zero-crossing", () => api.ZeroCrossingRate(analysisVector, 0.0001));

    const bpmRaw = numberOrNull(rhythm?.bpm);
    const bpm = bpmRaw != null && bpmRaw >= 40 && bpmRaw <= 240 ? Math.round(bpmRaw * 10) / 10 : null;
    const rhythmConfidenceRaw = numberOrNull(rhythm?.confidence);
    const bpmConfidence = rhythmConfidenceRaw == null
      ? (bpm == null ? 0 : 0.58)
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
    response = {
      type: "error",
      id: message.id,
      error: errorText(error),
    };
  }
  self.postMessage(response);
});
