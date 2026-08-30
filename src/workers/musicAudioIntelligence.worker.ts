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
  Intensity: (signal: any, sampleRate?: number) => Record<string, unknown>;
  DynamicComplexity: (signal: any, frameSize?: number, sampleRate?: number) => Record<string, unknown>;
  SpectralCentroidTime: (signal: any, sampleRate?: number) => Record<string, unknown>;
  ZeroCrossingRate: (signal: any, threshold?: number) => Record<string, unknown>;
};

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

function safeDelete(value: unknown) {
  if (value && typeof value === "object" && "delete" in value && typeof (value as { delete?: unknown }).delete === "function") {
    try {
      (value as { delete: () => void }).delete();
    } catch {
      // Emscripten vector cleanup is best-effort.
    }
  }
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

function analyze(message: AnalyzeRequest): LocalAudioIntelligence {
  const api = getEssentia();
  if (!(message.pcm instanceof Float32Array) || message.pcm.length < 4096) {
    throw new Error("Not enough decoded audio for analysis.");
  }

  const inputRate = Number.isFinite(message.sampleRate) && message.sampleRate > 0 ? message.sampleRate : 44100;
  const durationSeconds = message.pcm.length / inputRate;
  const rmsDb = calculateRmsDb(message.pcm);

  let inputVector: any = null;
  let analysisVector: any = null;
  try {
    inputVector = api.arrayToVector(message.pcm);
    analysisVector = inputRate === 44100
      ? inputVector
      : api.Resample(inputVector, inputRate, 44100, 1).signal;

    const rhythm = api.RhythmExtractor2013(analysisVector, 208, "multifeature", 40);
    const keyResult = api.KeyExtractor(analysisVector);
    const dance = api.Danceability(analysisVector, 8800, 310, 44100, 1.1);
    const intensity = api.Intensity(analysisVector, 44100);
    const dynamics = api.DynamicComplexity(analysisVector, 0.2, 44100);
    const centroid = api.SpectralCentroidTime(analysisVector, 44100);
    const zero = api.ZeroCrossingRate(analysisVector, 0.0001);

    const bpmRaw = numberOrNull(rhythm.bpm);
    const bpm = bpmRaw != null && bpmRaw >= 40 && bpmRaw <= 240 ? Math.round(bpmRaw * 10) / 10 : null;
    const rhythmConfidenceRaw = numberOrNull(rhythm.confidence);
    // RhythmExtractor2013 confidence is not normalized to 0..1. Compress it to
    // a stable confidence value instead of treating values >1 as percentages.
    const bpmConfidence = rhythmConfidenceRaw == null
      ? 0
      : Math.max(0, Math.min(1, rhythmConfidenceRaw / (rhythmConfidenceRaw + 1.5)));

    const key = typeof keyResult.key === "string" && keyResult.key.trim() ? keyResult.key.trim() : null;
    const scale = typeof keyResult.scale === "string" && keyResult.scale.trim() ? keyResult.scale.trim() : null;

    return {
      bpm,
      bpmConfidence,
      key,
      scale,
      keyStrength: clamp01(keyResult.strength),
      danceability: numberOrNull(dance.danceability),
      intensityClass: numberOrNull(intensity.intensity),
      loudnessDb: numberOrNull(dynamics.loudness),
      dynamicComplexity: numberOrNull(dynamics.dynamicComplexity),
      spectralCentroidHz: numberOrNull(centroid.centroid),
      zeroCrossingRate: numberOrNull(zero.zeroCrossingRate),
      rmsDb,
      durationSeconds,
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
      error: error instanceof Error ? error.message : String(error || "Local audio analysis failed."),
    };
  }
  self.postMessage(response);
});
