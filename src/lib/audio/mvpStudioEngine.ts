// MVP Trainer Pro R79A Studio WASM bridge
// MVP_R79A_LIVE_STATE_RELIABILITY: full-state ACK tracking + disposable Studio nodes
// R77i WASM remains the shared protection core. Master Prep is injected in the worklet before that core.

import type { MusicMasterPrepProfile } from "../musicAudioIntelligence";
import { installMusicAiAudioRuntime } from "../musicAiAudioRuntime";

export type MvpStudioTelemetry = {
  inputPeak: number;
  outputPeak: number;
  inputRms: number;
  outputRms: number;
  gainReductionDb: number;
  limiterGain: number;
  truePeakDbtp: number;
  transientBoostDb: number;
  multibandGainReductionDb: number;
  multibandBandReductionDb: [number, number, number, number];
  dynamicEqGainReductionDb: number;
  dynamicEqBandReductionDb: [number, number, number, number];
  outputCorrectionReductionDb: number;
  stereoCorrelation: number;
  stereoWidthPercent: number;
  stereoGuardReductionDb: number;
  headphoneOutputDriveDb: number;
  loudnessGainDb: number;
  loudnessMomentaryLufs: number;
  loudnessProgramLufs: number;
  autoMakeupDb: number;
  outputReserveDb: number;
  finalCompressorReductionDb: number;
  maxHdInputTruePeakDbtp: number;
  availableHeadroomDb: number;
  internalPeak: number;
  bassActivityDb: number;
  toneActivityDb: number;
  exciterActivity: number;
  deharshReductionDb: number;
  smartActivity: number;
};

export type MvpStudioState = {
  bypass: boolean;
  eqEnabled: boolean;
  eqTopologyCode: number;
  eqGains: number[];
  preampDb: number;
  headroomDb: number;
  transientEnabled: boolean;
  transientAmount: number;
  multibandEnabled: boolean;
  multibandAmount: number;
  dynamicEqEnabled: boolean;
  dynamicEqAmount: number;
  outputCorrectionEnabled: boolean;
  outputCorrectionAmount: number;
  stereoIntegrityEnabled: boolean;
  stereoIntegrityAmount: number;
  normalizationEnabled: boolean;
  normalizationTargetLufs: number;
  limiterEnabled: boolean;
  limiterCeilingDb: number;
  outputProfileCode: number;
  headphoneEnabled: boolean;
  headphoneWidth: number;
  headphoneDepth: number;
  headphoneCrossfeed: number;
  headphoneCenter: number;
  headphoneBassImpact: number;
  outputReserveDb: number;
  autoMakeupEnabled: boolean;
  parametricEnabled: boolean;
  parametricBands: Array<{ enabled: boolean; frequency: number; gainDb: number; q: number; type: number }>;
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
  headphoneAdvancedEnabled: boolean;
  headphoneSpeakerAngle: number;
  headphoneDistance: number;
  headphoneReflections: number;
  headphoneWet: number;
};

export type MvpStudioVenueProfile = {
  enabled: boolean;
  widthScale: number;
  reflectionMix: number;
  delayMsA: number;
  delayMsB: number;
  damping: number;
};

export type MvpStudioRuntimeInfo = {
  assetVersion: string;
  processorVersion: string;
  ready: boolean;
  faulted: boolean;
  requestedRevision: number;
  appliedRevision: number;
  lastError: string | null;
  lastRequestedAt: number;
  lastAppliedAt: number;
  appliedState: MvpStudioState | null;
};

const MVP_STUDIO_ASSET_VERSION = "7.1.0-r80-r3-final-audio-control";
const READY_TIMEOUT_MS = 6000;

const EMPTY_TELEMETRY: MvpStudioTelemetry = {
  inputPeak: 0,
  outputPeak: 0,
  inputRms: 0,
  outputRms: 0,
  gainReductionDb: 0,
  limiterGain: 1,
  truePeakDbtp: -120,
  transientBoostDb: 0,
  multibandGainReductionDb: 0,
  multibandBandReductionDb: [0, 0, 0, 0],
  dynamicEqGainReductionDb: 0,
  dynamicEqBandReductionDb: [0, 0, 0, 0],
  outputCorrectionReductionDb: 0,
  stereoCorrelation: 1,
  stereoWidthPercent: 100,
  stereoGuardReductionDb: 0,
  headphoneOutputDriveDb: 0,
  loudnessGainDb: 0,
  loudnessMomentaryLufs: -70,
  loudnessProgramLufs: -70,
  autoMakeupDb: 0,
  outputReserveDb: 0,
  finalCompressorReductionDb: 0,
  maxHdInputTruePeakDbtp: -120,
  availableHeadroomDb: 24,
  internalPeak: 0,
  bassActivityDb: 0,
  toneActivityDb: 0,
  exciterActivity: 0,
  deharshReductionDb: 0,
  smartActivity: 0,
};

let latestTelemetry: MvpStudioTelemetry = { ...EMPTY_TELEMETRY };
let wasmBytesPromise: Promise<ArrayBuffer> | null = null;
let nextStateRevision = 0;
let activeStudioNode: AudioWorkletNode | null = null;
let activeMasterPrep: MusicMasterPrepProfile | null = null;
let activeVenue: MvpStudioVenueProfile | null = null;

// MVP_R79A_LIVE_STATE_RELIABILITY: each disposable Worklet keeps its own state/revision record.
// The UI-facing runtime follows only activeStudioNode, so an old node can never
// overwrite the health of a replacement during the short crossfade window.
const requestedRevisionByNode = new WeakMap<AudioWorkletNode, number>();
const appliedRevisionByNode = new WeakMap<AudioWorkletNode, number>();
const faultedByNode = new WeakMap<AudioWorkletNode, boolean>();
const latestStateByNode = new WeakMap<AudioWorkletNode, { revision: number; state: MvpStudioState }>();

function cloneStudioState(state: MvpStudioState): MvpStudioState {
  return {
    ...state,
    eqGains: [...state.eqGains],
    parametricBands: state.parametricBands.map((band) => ({ ...band })),
  };
}

let runtimeInstalled = false;
let runtimeInfo: MvpStudioRuntimeInfo = {
  assetVersion: MVP_STUDIO_ASSET_VERSION,
  processorVersion: "not-ready",
  ready: false,
  faulted: false,
  requestedRevision: 0,
  appliedRevision: 0,
  lastError: null,
  lastRequestedAt: 0,
  lastAppliedAt: 0,
  appliedState: null,
};

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function fixedFour(value: unknown): [number, number, number, number] {
  const values = Array.isArray(value) ? value : [];
  return [finite(values[0]), finite(values[1]), finite(values[2]), finite(values[3])];
}

function updateTelemetry(data: Record<string, unknown>) {
  latestTelemetry = {
    inputPeak: finite(data.inputPeak),
    outputPeak: finite(data.outputPeak),
    inputRms: finite(data.inputRms),
    outputRms: finite(data.outputRms),
    gainReductionDb: finite(data.gainReductionDb),
    limiterGain: finite(data.limiterGain, 1),
    truePeakDbtp: finite(data.truePeakDbtp, -120),
    transientBoostDb: finite(data.transientBoostDb),
    multibandGainReductionDb: finite(data.multibandGainReductionDb),
    multibandBandReductionDb: fixedFour(data.multibandBandReductionDb),
    dynamicEqGainReductionDb: finite(data.dynamicEqGainReductionDb),
    dynamicEqBandReductionDb: fixedFour(data.dynamicEqBandReductionDb),
    outputCorrectionReductionDb: finite(data.outputCorrectionReductionDb),
    stereoCorrelation: finite(data.stereoCorrelation, 1),
    stereoWidthPercent: finite(data.stereoWidthPercent, 100),
    stereoGuardReductionDb: finite(data.stereoGuardReductionDb),
    headphoneOutputDriveDb: finite(data.headphoneOutputDriveDb),
    loudnessGainDb: finite(data.loudnessGainDb),
    loudnessMomentaryLufs: finite(data.loudnessMomentaryLufs, -70),
    loudnessProgramLufs: finite(data.loudnessProgramLufs, -70),
    autoMakeupDb: finite(data.autoMakeupDb),
    outputReserveDb: finite(data.outputReserveDb),
    finalCompressorReductionDb: finite(data.finalCompressorReductionDb),
    maxHdInputTruePeakDbtp: finite(data.maxHdInputTruePeakDbtp, -120),
    availableHeadroomDb: finite(data.availableHeadroomDb, 24),
    internalPeak: finite(data.internalPeak),
    bassActivityDb: finite(data.bassActivityDb),
    toneActivityDb: finite(data.toneActivityDb),
    exciterActivity: finite(data.exciterActivity),
    deharshReductionDb: finite(data.deharshReductionDb),
    smartActivity: finite(data.smartActivity),
  };
}

async function loadStudioWasmBytes() {
  if (wasmBytesPromise) return wasmBytesPromise;
  wasmBytesPromise = (async () => {
    if (typeof window === "undefined") throw new Error("MVP Studio requires a browser runtime.");
    const url = new URL("/audio/mvpStudioEngine-r78k.wasm", window.location.origin);
    url.searchParams.set("v", MVP_STUDIO_ASSET_VERSION);
    const response = await fetch(url.href, { cache: "no-store" });
    if (!response.ok) throw new Error(`MVP Studio WASM download failed (${response.status}).`);
    return response.arrayBuffer();
  })().catch((error) => {
    wasmBytesPromise = null;
    throw error;
  });
  return wasmBytesPromise;
}

function postMasterPrep(node: AudioWorkletNode | null) {
  node?.port.postMessage({ type: "master-prep", profile: activeMasterPrep });
}

export function setMvpStudioMasterPrep(profile: MusicMasterPrepProfile | null) {
  activeMasterPrep = profile && profile.enabled ? { ...profile, reasons: [...(profile.reasons || [])] } : null;
  postMasterPrep(activeStudioNode);
}

function postVenue(node: AudioWorkletNode | null) {
  node?.port.postMessage({ type: "venue", profile: activeVenue });
}

export function setMvpStudioVenue(profile: MvpStudioVenueProfile | null) {
  activeVenue = profile && profile.enabled ? { ...profile } : null;
  postVenue(activeStudioNode);
}

function ensureMusicAiAudioRuntime() {
  if (runtimeInstalled || typeof window === "undefined") return;
  runtimeInstalled = true;
  installMusicAiAudioRuntime(setMvpStudioMasterPrep, setMvpStudioVenue);
}

// R78d: mount AI AUDIO from the normal browser module lifecycle, not from
// successful Studio WASM creation. The UI therefore remains available even if
// the audio engine is still starting or a compatibility fallback is active.
ensureMusicAiAudioRuntime();

export async function createMvpStudioNode(context: AudioContext) {
  if (!context.audioWorklet) throw new Error("AudioWorklet is unavailable.");
  runtimeInfo = {
    assetVersion: MVP_STUDIO_ASSET_VERSION,
    processorVersion: "loading",
    ready: false,
    faulted: false,
    requestedRevision: 0,
    appliedRevision: 0,
    lastError: null,
    lastRequestedAt: 0,
    lastAppliedAt: 0,
    appliedState: null,
  };
  latestTelemetry = { ...EMPTY_TELEMETRY };

  const workletUrl = new URL("./mvpStudioDsp.worklet.js", import.meta.url);
  workletUrl.searchParams.set("v", MVP_STUDIO_ASSET_VERSION);
  await context.audioWorklet.addModule(workletUrl.href);
  const wasmBytes = await loadStudioWasmBytes();

  const node = new AudioWorkletNode(context, "mvp-studio-wasm", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
  });
  activeStudioNode = node;
  requestedRevisionByNode.set(node, 0);
  appliedRevisionByNode.set(node, 0);
  faultedByNode.set(node, false);
  ensureMusicAiAudioRuntime();

  return new Promise<AudioWorkletNode>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      runtimeInfo = { ...runtimeInfo, faulted: true, lastError: "MVP Studio processor timed out during startup." };
      if (activeStudioNode === node) activeStudioNode = null;
      try { node.port.close(); } catch { /* already closed */ }
      reject(new Error(runtimeInfo.lastError ?? "MVP Studio startup timeout."));
    }, READY_TIMEOUT_MS);

    const failStartup = (message: string) => {
      runtimeInfo = { ...runtimeInfo, ready: false, faulted: true, lastError: message };
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (activeStudioNode === node) activeStudioNode = null;
      try { node.port.close(); } catch { /* already closed */ }
      reject(new Error(message));
    };

    node.port.onmessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "ready") {
        faultedByNode.set(node, false);
        if (activeStudioNode === node) {
          runtimeInfo = { ...runtimeInfo, processorVersion: String(data.version || "studio-wasm"), ready: true, faulted: false, lastError: null };
        }
        postMasterPrep(node);
        postVenue(node);
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          resolve(node);
        }
        return;
      }
      if (data.type === "telemetry") {
        if (activeStudioNode === node) updateTelemetry(data);
        return;
      }
      if (data.type === "state-applied") {
        const revision = Math.max(0, Math.floor(finite(data.revision)));
        appliedRevisionByNode.set(node, Math.max(appliedRevisionByNode.get(node) || 0, revision));
        faultedByNode.set(node, false);
        if (activeStudioNode === node) {
          const appliedState = data.appliedState && typeof data.appliedState === "object"
            ? cloneStudioState(data.appliedState as MvpStudioState)
            : runtimeInfo.appliedState;
          runtimeInfo = {
            ...runtimeInfo,
            appliedRevision: Math.max(runtimeInfo.appliedRevision, revision),
            ready: true,
            faulted: false,
            lastError: null,
            lastAppliedAt: Date.now(),
            appliedState,
          };
        }
        return;
      }
      if (data.type === "error") {
        const message = String(data.message || "MVP Studio processor error.");
        faultedByNode.set(node, true);
        if (!settled) failStartup(message);
        else if (activeStudioNode === node) {
          runtimeInfo = { ...runtimeInfo, faulted: true, lastError: message };
          if (typeof window !== "undefined") window.dispatchEvent(new Event("mvp-studio-runtime-fault"));
        }
      }
    };

    node.addEventListener("processorerror", () => {
      const message = "MVP Studio AudioWorklet processor stopped unexpectedly.";
      faultedByNode.set(node, true);
      if (!settled) failStartup(message);
      else if (activeStudioNode === node) {
        runtimeInfo = { ...runtimeInfo, ready: false, faulted: true, lastError: message };
        if (typeof window !== "undefined") window.dispatchEvent(new Event("mvp-studio-runtime-fault"));
      }
    });

    const initBytes = wasmBytes.slice(0);
    node.port.postMessage({ type: "init", wasmBytes: initBytes }, [initBytes]);
  });
}

export function setMvpStudioState(node: AudioWorkletNode | null, state: MvpStudioState) {
  if (!node) return 0;
  const revision = ++nextStateRevision;
  const snapshot = cloneStudioState(state);
  requestedRevisionByNode.set(node, revision);
  latestStateByNode.set(node, { revision, state: snapshot });
  if (activeStudioNode === node) {
    runtimeInfo = { ...runtimeInfo, requestedRevision: revision, lastRequestedAt: Date.now() };
  }
  node.port.postMessage({ type: "state", revision, state: snapshot });
  return revision;
}

// Re-send the exact same authoritative snapshot/revision once before deciding
// that the Worklet control path must be replaced. No incremental mutation is used.
export function repostMvpStudioState(node: AudioWorkletNode | null) {
  if (!node) return 0;
  const latest = latestStateByNode.get(node);
  if (!latest) return 0;
  if (activeStudioNode === node) runtimeInfo = { ...runtimeInfo, lastRequestedAt: Date.now() };
  node.port.postMessage({ type: "state", revision: latest.revision, state: cloneStudioState(latest.state) });
  return latest.revision;
}

export async function waitForMvpStudioRevision(node: AudioWorkletNode | null, revision: number, timeoutMs = 320) {
  if (!node || revision <= 0) return false;
  const started = Date.now();
  return new Promise<boolean>((resolve) => {
    const poll = () => {
      if ((appliedRevisionByNode.get(node) || 0) >= revision) { resolve(true); return; }
      if (faultedByNode.get(node)) { resolve(false); return; }
      if (Date.now() - started >= Math.max(60, timeoutMs)) { resolve(false); return; }
      window.setTimeout(poll, 12);
    };
    poll();
  });
}

export function activateMvpStudioNode(node: AudioWorkletNode | null) {
  activeStudioNode = node;
  if (!node) {
    runtimeInfo = { ...runtimeInfo, ready: false };
    return;
  }
  const requestedRevision = requestedRevisionByNode.get(node) || 0;
  const appliedRevision = appliedRevisionByNode.get(node) || 0;
  const faulted = Boolean(faultedByNode.get(node));
  runtimeInfo = {
    ...runtimeInfo,
    ready: !faulted,
    faulted,
    requestedRevision,
    appliedRevision,
    lastError: faulted ? runtimeInfo.lastError : null,
  };
  postMasterPrep(node);
  postVenue(node);
}

export function disposeMvpStudioNode(node: AudioWorkletNode | null) {
  if (!node) return;
  if (activeStudioNode === node) activeStudioNode = null;
  try { node.disconnect(); } catch { /* already disconnected */ }
  try { node.port.close(); } catch { /* already closed */ }
}

export function resetMvpStudioLoudness(node: AudioWorkletNode | null) {
  node?.port.postMessage({ type: "reset-loudness" });
}

export function resetMvpStudio(node: AudioWorkletNode | null) {
  node?.port.postMessage({ type: "reset" });
  postMasterPrep(node);
  postVenue(node);
}

export function getMvpStudioTelemetry(): MvpStudioTelemetry {
  return latestTelemetry;
}

export function getMvpStudioRuntimeInfo(): MvpStudioRuntimeInfo {
  return { ...runtimeInfo };
}
