export type MusicAudioSourceQuality = "lossless" | "high" | "standard" | "low" | "unknown";

export type MusicAudioTechnicalAnalysis = {
  codec: string;
  bitrateKbps: number | null;
  sampleRateHz: number;
  bitDepth: number | null;
  channelCount: number;
  lossless: boolean;
  sourceQuality: MusicAudioSourceQuality;
  averageLoudnessDb: number | null;
  rmsDb: number | null;
  samplePeakDbfs: number;
  truePeakDbtp: number;
  intersampleOvers: number;
  clippedSamples: number;
  crestFactorDb: number;
  dynamicRangeDb: number;
  bassExtension: number;
  lowMidBuildup: number;
  presenceBalance: number;
  harshness: number;
  sibilance: number;
  hfRolloff: number;
  transientStrength: number;
  stereoWidthPercent: number;
  correlation: number;
  channelBalanceDb: number;
  dcOffset: number;
  rumble: number;
  phaseRisk: boolean;
  defects: string[];
};

export type MusicMasterPrepProfile = {
  enabled: boolean;
  sourceGainDb: number;
  highpassHz: number;
  lowMidDb: number;
  presenceDb: number;
  harshnessDb: number;
  channelBalanceDb: number;
  widthScale: number;
  reasons: string[];
};

export type MusicAnalogRecommendation = "off" | "studio" | "warm";

export type MusicAiAutoSoundRecommendation = {
  clear: boolean;
  neuralBass: boolean;
  impactOrPunch: boolean;
  hdXpanderLevel: 0 | 1 | 2 | 3;
  analog: MusicAnalogRecommendation;
  wide: boolean;
  highOutput: boolean;
  compatibilityNotes: string[];
};

export type MusicAiAutoSoundProfiles = {
  headphones: MusicAiAutoSoundRecommendation;
  speaker: MusicAiAutoSoundRecommendation;
};

export type LocalAudioIntelligence = {
  bpm: number | null;
  bpmConfidence: number;
  key: string | null;
  scale: string | null;
  keyStrength: number;
  danceability: number | null;
  intensityScore: number | null;
  loudnessDb: number | null;
  dynamicComplexity: number | null;
  spectralCentroidHz: number | null;
  zeroCrossingRate: number | null;
  rmsDb: number | null;
  durationSeconds: number;
  technical: MusicAudioTechnicalAnalysis;
  masterPrep: MusicMasterPrepProfile;
  autoSound: MusicAiAutoSoundProfiles;
  successfulFeatures: string[];
  failedFeatures: Array<{ feature: string; error: string }>;
};

export type MusicAudioSourceMeta = {
  fileSizeBytes?: number | null;
  mimeType?: string | null;
  originalName?: string | null;
  releaseYear?: number | null;
  genre?: string | null;
  energyLevel?: string | null;
  bitDepth?: number | null;
  channelCount?: number | null;
};

type AnalyzeRequest = {
  type: "analyze";
  id: number;
  pcmLeft: Float32Array;
  pcmRight: Float32Array;
  sampleRate: number;
  sourceMeta: MusicAudioSourceMeta;
};

type AnalyzeSuccess = {
  type: "result";
  id: number;
  result: LocalAudioIntelligence;
};

type AnalyzeFailure = {
  type: "error";
  id: number;
  error: string;
};

type WorkerResponse = AnalyzeSuccess | AnalyzeFailure;

type PendingJob = {
  resolve: (value: LocalAudioIntelligence) => void;
  reject: (reason?: unknown) => void;
  timeout: number;
};

const pending = new Map<number, PendingJob>();
let worker: Worker | null = null;
let nextId = 1;

function getWorker() {
  if (worker) return worker;
  if (typeof Worker === "undefined") throw new Error("Local audio analysis requires Web Worker support.");

  worker = new Worker(new URL("../workers/musicAudioIntelligence.worker.ts", import.meta.url), {
    type: "module",
    name: "mvp-music-audio-intelligence",
  });

  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const job = pending.get(message.id);
    if (!job) return;
    window.clearTimeout(job.timeout);
    pending.delete(message.id);
    if (message.type === "result") job.resolve(message.result);
    else job.reject(new Error(message.error || "Local audio analysis failed."));
  });

  worker.addEventListener("error", (event) => {
    const error = new Error(event.message || "Local audio analysis worker failed.");
    for (const [id, job] of pending) {
      window.clearTimeout(job.timeout);
      job.reject(error);
      pending.delete(id);
    }
    worker?.terminate();
    worker = null;
  });

  return worker;
}

function finite(value: number | null | undefined, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function wavBitDepth(bytes: ArrayBuffer, mimeType: string | null | undefined, originalName: string | null | undefined) {
  const mime = String(mimeType || "").toLowerCase();
  const name = String(originalName || "").toLowerCase();
  if (!mime.includes("wav") && !name.endsWith(".wav")) return null;
  try {
    const view = new DataView(bytes);
    if (view.byteLength < 36) return null;
    const bits = view.getUint16(34, true);
    return bits >= 8 && bits <= 64 ? bits : null;
  } catch {
    return null;
  }
}

async function decodeStereo(audioUrl: string, sourceMeta: MusicAudioSourceMeta) {
  const response = await fetch(audioUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Audio fetch failed (${response.status}).`);
  const bytes = await response.arrayBuffer();

  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error("Web Audio decoding is unavailable in this browser.");

  const context = new AudioContextCtor({ latencyHint: "playback" });
  try {
    const decoded = await context.decodeAudioData(bytes.slice(0));
    if (!decoded.length || !decoded.numberOfChannels) throw new Error("Decoded audio is empty.");

    const leftSource = decoded.getChannelData(0);
    const rightSource = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : leftSource;
    const pcmLeft = new Float32Array(leftSource.length);
    const pcmRight = new Float32Array(rightSource.length);
    pcmLeft.set(leftSource);
    pcmRight.set(rightSource);

    return {
      pcmLeft,
      pcmRight,
      sampleRate: finite(decoded.sampleRate, 44100),
      durationSeconds: finite(decoded.duration, leftSource.length / Math.max(1, decoded.sampleRate)),
      sourceMeta: {
        ...sourceMeta,
        fileSizeBytes: finite(sourceMeta.fileSizeBytes, bytes.byteLength) || bytes.byteLength,
        bitDepth: sourceMeta.bitDepth ?? wavBitDepth(bytes, sourceMeta.mimeType, sourceMeta.originalName),
        channelCount: decoded.numberOfChannels,
      },
    };
  } finally {
    void context.close().catch(() => undefined);
  }
}

export async function analyzeMusicAudioLocally(
  audioUrl: string,
  sourceMeta: MusicAudioSourceMeta = {},
): Promise<LocalAudioIntelligence> {
  const { pcmLeft, pcmRight, sampleRate, durationSeconds, sourceMeta: decodedMeta } = await decodeStereo(audioUrl, sourceMeta);
  const id = nextId++;
  const target = getWorker();

  const result = await new Promise<LocalAudioIntelligence>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error("Local audio analysis timed out."));
    }, 180_000);
    pending.set(id, { resolve, reject, timeout });
    const request: AnalyzeRequest = {
      type: "analyze",
      id,
      pcmLeft,
      pcmRight,
      sampleRate,
      sourceMeta: decodedMeta,
    };
    target.postMessage(request, [pcmLeft.buffer, pcmRight.buffer]);
  });

  return {
    ...result,
    durationSeconds: finite(result.durationSeconds, durationSeconds),
  };
}
