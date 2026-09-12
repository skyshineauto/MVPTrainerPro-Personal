// MVP Trainer Pro Broadcast Engine V3 production bridge.
// Compatibility surface for musicPlayer.ts, backed by the proven V3 AudioWorklet/WASM route.
// AI Audio / venue runtime is intentionally removed.

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

  // Broadcast Engine V3 authoritative state.
  broadcastModeCode?: 0 | 1 | 2;
  broadcastIntensity?: number;
  broadcastBassEnabled?: boolean;
  broadcastBassCharacter?: number;
  broadcastImpactEnabled?: boolean;
  broadcastClarityEnabled?: boolean;
  broadcastSpatialEnabled?: boolean;
  broadcastSpaceModeCode?: 0 | 1 | 2;
  broadcastPersonalEnabled?: boolean;
  broadcastPersonalBass?: number;
  broadcastPersonalPresence?: number;
  broadcastPersonalBrightness?: number;
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

const ASSET_VERSION = "10.0.0-broadcast-v3";
const READY_TIMEOUT_MS = 7000;

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
let nextRevision = 0;
let activeNode: AudioWorkletNode | null = null;

const requestedRevisionByNode = new WeakMap<AudioWorkletNode, number>();
const appliedRevisionByNode = new WeakMap<AudioWorkletNode, number>();
const faultedByNode = new WeakMap<AudioWorkletNode, boolean>();
const latestStateByNode = new WeakMap<AudioWorkletNode, { revision: number; state: MvpStudioState }>();

let runtimeInfo: MvpStudioRuntimeInfo = {
  assetVersion: ASSET_VERSION,
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

function clamp(value: unknown, min: number, max: number, fallback: number) {
  return Math.max(min, Math.min(max, finite(value, fallback)));
}

function cloneState(state: MvpStudioState): MvpStudioState {
  return {
    ...state,
    eqGains: [...state.eqGains],
    parametricBands: state.parametricBands.map((band) => ({ ...band })),
  };
}

function updateTelemetry(data: Record<string, unknown>) {
  const limiterGr = Math.max(0, finite(data.limiterGrDb ?? data.limiterGrDbMaxSinceInit));
  const delta = finite(data.rmsDeltaDb);
  latestTelemetry = {
    inputPeak: finite(data.inputPeak),
    outputPeak: finite(data.outputPeak),
    inputRms: finite(data.inputRms),
    outputRms: finite(data.outputRms),
    gainReductionDb: limiterGr,
    limiterGain: Math.pow(10, -limiterGr / 20),
    truePeakDbtp: finite(data.truePeakDbtp, -120),
    transientBoostDb: finite(data.impactBoostDb),
    multibandGainReductionDb: finite(data.multibandGainReductionDb),
    multibandBandReductionDb: [0, 0, 0, 0],
    dynamicEqGainReductionDb: 0,
    dynamicEqBandReductionDb: [0, 0, 0, 0],
    outputCorrectionReductionDb: 0,
    stereoCorrelation: 1,
    stereoWidthPercent: finite(data.spatialWidthPercent, 100),
    stereoGuardReductionDb: 0,
    headphoneOutputDriveDb: delta,
    loudnessGainDb: delta,
    loudnessMomentaryLufs: -70,
    loudnessProgramLufs: -70,
    autoMakeupDb: 0,
    outputReserveDb: 0,
    finalCompressorReductionDb: limiterGr,
    maxHdInputTruePeakDbtp: finite(data.truePeakDbtp, -120),
    availableHeadroomDb: Math.max(0, -finite(data.truePeakDbtp, -24)),
    internalPeak: finite(data.outputPeak),
    bassActivityDb: finite(data.bassActivityDb),
    toneActivityDb: finite(data.clarityActivityDb),
    exciterActivity: 0,
    deharshReductionDb: 0,
    smartActivity: 0,
  };
}

async function loadWasmBytes() {
  if (wasmBytesPromise) return wasmBytesPromise;
  wasmBytesPromise = (async () => {
    if (typeof window === "undefined") throw new Error("Broadcast Engine V3 requires a browser runtime.");
    const url = new URL("/audioV2/mvpHdV2.wasm", window.location.origin);
    url.searchParams.set("v", ASSET_VERSION);
    const response = await fetch(url.href, { cache: "no-store" });
    if (!response.ok) throw new Error(`Broadcast V3 WASM download failed (${response.status}).`);
    return response.arrayBuffer();
  })().catch((error) => {
    wasmBytesPromise = null;
    throw error;
  });
  return wasmBytesPromise;
}

function publicState(state: MvpStudioState) {
  const explicitMode = state.broadcastModeCode;
  const mode =
    explicitMode === 2 ? "power" :
    explicitMode === 1 ? "adaptive" :
    explicitMode === 0 ? "pure" :
    state.bypass ? "pure" :
    state.autoMakeupEnabled && state.outputReserveDb >= 10 ? "power" : "adaptive";

  return {
    mode,
    outputProfile: state.outputProfileCode === 2 ? "speaker" : state.outputProfileCode === 1 ? "headphones" : "car_hifi",
    intensity: clamp(state.broadcastIntensity, 0, 1, 0.72),
    bassEnabled: Boolean(state.broadcastBassEnabled ?? state.bassEngineEnabled),
    bassCharacter: clamp(state.broadcastBassCharacter, 0, 1, 1 - clamp(state.bassTightness, 0, 1, 0.5)),
    impactEnabled: Boolean(state.broadcastImpactEnabled ?? state.transientEnabled),
    clarityEnabled: Boolean(state.broadcastClarityEnabled ?? state.toneEngineEnabled),
    spatialEnabled: Boolean(state.broadcastSpatialEnabled ?? state.stereoFieldEnabled ?? state.headphoneEnabled),
    spaceMode:
      state.broadcastSpaceModeCode === 2 ? "arena" :
      state.broadcastSpaceModeCode === 1 ? "live" : "studio",
    personalEnabled: Boolean(state.broadcastPersonalEnabled),
    personalBass: clamp(state.broadcastPersonalBass, -1, 1, 0),
    personalPresence: clamp(state.broadcastPersonalPresence, -1, 1, 0),
    personalBrightness: clamp(state.broadcastPersonalBrightness, -1, 1, 0),
    eqEnabled: Boolean(state.eqEnabled),
    eqGains: state.eqGains.slice(0, 31),
  };
}

// AI Audio and AI venue DSP were intentionally removed in Broadcast V3.
// These compatibility exports remain no-ops so older callers cannot reintroduce hidden processing.
export function setMvpStudioMasterPrep(_profile: unknown) {}
export function setMvpStudioVenue(_profile: MvpStudioVenueProfile | null) {}

export async function createMvpStudioNode(context: AudioContext) {
  if (!context.audioWorklet) throw new Error("AudioWorklet is unavailable.");

  runtimeInfo = {
    assetVersion: ASSET_VERSION,
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

  const workletUrl = new URL("/audioV2/mvpHdV2.worklet.js", window.location.origin);
  workletUrl.searchParams.set("v", ASSET_VERSION);
  await context.audioWorklet.addModule(workletUrl.href);
  const wasmBytes = await loadWasmBytes();

  const node = new AudioWorkletNode(context, "mvp-hd-v2-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
  });

  activeNode = node;
  requestedRevisionByNode.set(node, 0);
  appliedRevisionByNode.set(node, 0);
  faultedByNode.set(node, false);

  return new Promise<AudioWorkletNode>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      runtimeInfo = {
        ...runtimeInfo,
        ready: false,
        faulted: true,
        lastError: "Broadcast V3 processor timed out during startup.",
      };
      if (activeNode === node) activeNode = null;
      try { node.port.close(); } catch { /* closed */ }
      reject(new Error(runtimeInfo.lastError || "Broadcast V3 startup timeout."));
    }, READY_TIMEOUT_MS);

    const fail = (message: string) => {
      faultedByNode.set(node, true);
      runtimeInfo = { ...runtimeInfo, ready: false, faulted: true, lastError: message };
      if (!settled) {
        settled = true;
        window.clearTimeout(timeout);
        if (activeNode === node) activeNode = null;
        try { node.port.close(); } catch { /* closed */ }
        reject(new Error(message));
      } else if (activeNode === node && typeof window !== "undefined") {
        window.dispatchEvent(new Event("mvp-studio-runtime-fault"));
      }
    };

    node.port.onmessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object") return;

      if (data.type === "READY") {
        faultedByNode.set(node, false);
        node.port.postMessage({ type: "SET_TELEMETRY", enabled: true });
        if (activeNode === node) {
          runtimeInfo = {
            ...runtimeInfo,
            processorVersion: String(data.version || "broadcast-v3"),
            ready: true,
            faulted: false,
            lastError: null,
          };
        }
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          resolve(node);
        }
        return;
      }

      if (data.type === "TELEMETRY") {
        if (activeNode === node) updateTelemetry(data);
        return;
      }

      if (data.type === "STATE_APPLIED") {
        const revision = Math.max(0, Math.floor(finite(data.revision)));
        appliedRevisionByNode.set(node, Math.max(appliedRevisionByNode.get(node) || 0, revision));
        faultedByNode.set(node, false);
        if (activeNode === node) {
          const latest = latestStateByNode.get(node);
          runtimeInfo = {
            ...runtimeInfo,
            ready: true,
            faulted: false,
            lastError: null,
            appliedRevision: Math.max(runtimeInfo.appliedRevision, revision),
            lastAppliedAt: Date.now(),
            appliedState: latest && latest.revision <= revision ? cloneState(latest.state) : runtimeInfo.appliedState,
          };
        }
        return;
      }

      if (data.type === "ERROR") fail(String(data.message || "Broadcast V3 processor error."));
    };

    node.addEventListener("processorerror", () => fail("Broadcast V3 AudioWorklet stopped unexpectedly."));

    const initBytes = wasmBytes.slice(0);
    node.port.postMessage({ type: "INIT_WASM", wasmBytes: initBytes }, [initBytes]);
  });
}

export function setMvpStudioState(node: AudioWorkletNode | null, state: MvpStudioState) {
  if (!node) return 0;
  const revision = ++nextRevision;
  const snapshot = cloneState(state);
  requestedRevisionByNode.set(node, revision);
  latestStateByNode.set(node, { revision, state: snapshot });
  if (activeNode === node) {
    runtimeInfo = { ...runtimeInfo, requestedRevision: revision, lastRequestedAt: Date.now() };
  }
  node.port.postMessage({ type: "SET_STATE", revision, state: publicState(snapshot) });
  return revision;
}

export function repostMvpStudioState(node: AudioWorkletNode | null) {
  if (!node) return 0;
  const latest = latestStateByNode.get(node);
  if (!latest) return 0;
  if (activeNode === node) runtimeInfo = { ...runtimeInfo, lastRequestedAt: Date.now() };
  node.port.postMessage({ type: "SET_STATE", revision: latest.revision, state: publicState(latest.state) });
  return latest.revision;
}

export async function waitForMvpStudioRevision(node: AudioWorkletNode | null, revision: number, timeoutMs = 360) {
  if (!node || revision <= 0) return false;
  const started = Date.now();
  return new Promise<boolean>((resolve) => {
    const poll = () => {
      if ((appliedRevisionByNode.get(node) || 0) >= revision) { resolve(true); return; }
      if (faultedByNode.get(node)) { resolve(false); return; }
      if (Date.now() - started >= Math.max(80, timeoutMs)) { resolve(false); return; }
      window.setTimeout(poll, 12);
    };
    poll();
  });
}

export function activateMvpStudioNode(node: AudioWorkletNode | null) {
  activeNode = node;
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
}

export function disposeMvpStudioNode(node: AudioWorkletNode | null) {
  if (!node) return;
  if (activeNode === node) activeNode = null;
  try { node.disconnect(); } catch { /* already disconnected */ }
  try { node.port.close(); } catch { /* already closed */ }
}

export function resetMvpStudioLoudness(node: AudioWorkletNode | null) {
  node?.port.postMessage({ type: "RESET_METERS" });
}

export function resetMvpStudio(node: AudioWorkletNode | null) {
  node?.port.postMessage({ type: "RESET_ENGINE" });
}

export function getMvpStudioTelemetry(): MvpStudioTelemetry {
  return latestTelemetry;
}

export function getMvpStudioRuntimeInfo(): MvpStudioRuntimeInfo {
  return { ...runtimeInfo };
}
