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
  successfulFeatures: string[];
  failedFeatures: Array<{ feature: string; error: string }>;
};

type AnalyzeRequest = {
  type: "analyze";
  id: number;
  pcm: Float32Array;
  sampleRate: number;
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

async function decodeToMono(audioUrl: string) {
  const response = await fetch(audioUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Audio fetch failed (${response.status}).`);
  const bytes = await response.arrayBuffer();

  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error("Web Audio decoding is unavailable in this browser.");

  const context = new AudioContextCtor({ latencyHint: "playback" });
  try {
    const decoded = await context.decodeAudioData(bytes.slice(0));
    if (!decoded.length || !decoded.numberOfChannels) throw new Error("Decoded audio is empty.");

    // One full channel is enough for tempo/key/energy analysis and avoids a large
    // stereo down-mix on the UI thread. The PCM copy is transferred to the worker.
    const source = decoded.getChannelData(0);
    const pcm = new Float32Array(source.length);
    pcm.set(source);
    return {
      pcm,
      sampleRate: finite(decoded.sampleRate, 44100),
      durationSeconds: finite(decoded.duration, source.length / Math.max(1, decoded.sampleRate)),
    };
  } finally {
    void context.close().catch(() => undefined);
  }
}

export async function analyzeMusicAudioLocally(audioUrl: string): Promise<LocalAudioIntelligence> {
  const { pcm, sampleRate, durationSeconds } = await decodeToMono(audioUrl);
  const id = nextId++;
  const target = getWorker();

  const result = await new Promise<LocalAudioIntelligence>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error("Local audio analysis timed out."));
    }, 150_000);
    pending.set(id, { resolve, reject, timeout });
    const request: AnalyzeRequest = { type: "analyze", id, pcm, sampleRate };
    target.postMessage(request, [pcm.buffer]);
  });

  return {
    ...result,
    durationSeconds: finite(result.durationSeconds, durationSeconds),
  };
}
