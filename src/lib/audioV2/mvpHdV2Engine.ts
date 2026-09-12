import {
  createDefaultMvpHdV2State,
  type MvpHdV2State,
  type MvpHdV2Telemetry,
} from './mvpHdV2Types';

const V2_ASSET_VERSION = '2.0.0-stage2';
const V2_WORKLET_URL = `/audioV2/mvpHdV2.worklet.js?v=${V2_ASSET_VERSION}`;
const V2_WASM_URL = `/audioV2/mvpHdV2.wasm?v=${V2_ASSET_VERSION}`;

type TelemetryListener = (telemetry: MvpHdV2Telemetry) => void;

type WorkletMessage =
  | { type: 'READY'; sampleRate: number; maxFrames: number }
  | { type: 'STATE_APPLIED'; revision: number; bypass: boolean; loudnessMode: string }
  | { type: 'TELEMETRY'; revision: number; truePeakDbtp: number; limiterGrDb: number; clipCount: number; nanCount: number }
  | { type: 'PONG'; ready: boolean; revision: number }
  | { type: 'ERROR'; message: string };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeState(state: MvpHdV2State): MvpHdV2State {
  const eqGains = new Array<number>(31).fill(0);
  for (let index = 0; index < 31; index += 1) {
    const gain = Number(state.eqGains[index]);
    eqGains[index] = Number.isFinite(gain) ? Math.max(-12, Math.min(12, gain)) : 0;
  }
  return {
    bypass: Boolean(state.bypass),
    loudnessMode: state.loudnessMode === 'max' || state.loudnessMode === 'loud' ? state.loudnessMode : 'normal',
    bass: clamp01(state.bass),
    clarity: clamp01(state.clarity),
    punch: clamp01(state.punch),
    wide: clamp01(state.wide),
    eqEnabled: Boolean(state.eqEnabled),
    eqGains,
  };
}

export class MvpHdV2Engine {
  private context: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private outputGain: GainNode | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private state: MvpHdV2State = createDefaultMvpHdV2State();
  private revision = 0;
  private appliedRevision = 0;
  private initialized = false;
  private telemetry: MvpHdV2Telemetry = { revision: 0, truePeakDbtp: -120, limiterGrDb: 0, clipCount: 0, nanCount: 0 };
  private telemetryListeners = new Set<TelemetryListener>();

  async initialize(audioElement: HTMLAudioElement): Promise<void> {
    if (this.initialized && this.audioElement === audioElement) {
      if (this.context?.state === 'suspended') await this.context.resume();
      return;
    }
    if (this.initialized) throw new Error('MVP HD V2 Stage 2 is already attached to a different audio element.');

    const context = new AudioContext({ latencyHint: 'playback' });
    await context.audioWorklet.addModule(V2_WORKLET_URL);
    const wasmResponse = await fetch(V2_WASM_URL, { cache: 'no-store' });
    if (!wasmResponse.ok) {
      await context.close();
      throw new Error(`Unable to load MVP HD V2 WASM (${wasmResponse.status}).`);
    }
    const wasmBytes = await wasmResponse.arrayBuffer();

    const sourceNode = context.createMediaElementSource(audioElement);
    const workletNode = new AudioWorkletNode(context, 'mvp-hd-v2-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    const outputGain = context.createGain();
    outputGain.gain.value = 1;
    sourceNode.connect(workletNode);
    workletNode.connect(outputGain);
    outputGain.connect(context.destination);

    this.context = context;
    this.sourceNode = sourceNode;
    this.workletNode = workletNode;
    this.outputGain = outputGain;
    this.audioElement = audioElement;

    const ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('MVP HD V2 AudioWorklet initialization timed out.')), 8000);
      const handleMessage = (event: MessageEvent<WorkletMessage>) => {
        const message = event.data;
        if (message.type === 'READY') {
          window.clearTimeout(timeout);
          this.initialized = true;
          this.pushState();
          workletNode.port.postMessage({ type: 'SET_TELEMETRY', enabled: true });
          resolve();
          return;
        }
        if (message.type === 'STATE_APPLIED') {
          this.appliedRevision = message.revision;
          return;
        }
        if (message.type === 'TELEMETRY') {
          this.telemetry = {
            revision: message.revision,
            truePeakDbtp: message.truePeakDbtp,
            limiterGrDb: message.limiterGrDb,
            clipCount: message.clipCount,
            nanCount: message.nanCount,
          };
          for (const listener of this.telemetryListeners) listener(this.telemetry);
          return;
        }
        if (message.type === 'ERROR') {
          window.clearTimeout(timeout);
          reject(new Error(message.message));
        }
      };
      workletNode.port.onmessage = handleMessage;
    });

    workletNode.port.postMessage({ type: 'INIT_WASM', wasmBytes }, [wasmBytes]);
    try {
      await ready;
      if (context.state === 'suspended') await context.resume();
    } catch (error) {
      sourceNode.disconnect();
      workletNode.disconnect();
      outputGain.disconnect();
      await context.close();
      this.context = null;
      this.sourceNode = null;
      this.workletNode = null;
      this.outputGain = null;
      this.audioElement = null;
      throw error;
    }
  }

  getState(): MvpHdV2State {
    return { ...this.state, eqGains: [...this.state.eqGains] };
  }

  setState(patch: Partial<MvpHdV2State>): void {
    this.state = normalizeState({
      ...this.state,
      ...patch,
      eqGains: patch.eqGains ? [...patch.eqGains] : [...this.state.eqGains],
    });
    this.pushState();
  }

  setOutputVolume(linearGain: number): void {
    if (!this.outputGain || !this.context) return;
    const gain = Math.max(0, Math.min(1, Number(linearGain) || 0));
    this.outputGain.gain.setTargetAtTime(gain, this.context.currentTime, 0.01);
  }

  subscribeTelemetry(listener: TelemetryListener): () => void {
    this.telemetryListeners.add(listener);
    listener(this.telemetry);
    return () => { this.telemetryListeners.delete(listener); };
  }

  getDebugSnapshot(): {
    initialized: boolean;
    contextState: AudioContextState | 'none';
    revision: number;
    appliedRevision: number;
    currentTime: number;
    paused: boolean;
    src: string;
  } {
    return {
      initialized: this.initialized,
      contextState: this.context?.state ?? 'none',
      revision: this.revision,
      appliedRevision: this.appliedRevision,
      currentTime: this.audioElement?.currentTime ?? 0,
      paused: this.audioElement?.paused ?? true,
      src: this.audioElement?.currentSrc || this.audioElement?.src || '',
    };
  }

  async resume(): Promise<void> {
    if (this.context?.state === 'suspended') await this.context.resume();
  }

  async dispose(): Promise<void> {
    this.sourceNode?.disconnect();
    this.workletNode?.disconnect();
    this.outputGain?.disconnect();
    const context = this.context;
    this.context = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.outputGain = null;
    this.audioElement = null;
    this.initialized = false;
    this.appliedRevision = 0;
    if (context && context.state !== 'closed') await context.close();
  }

  private pushState(): void {
    if (!this.workletNode) return;
    this.revision += 1;
    this.workletNode.port.postMessage({ type: 'SET_STATE', revision: this.revision, state: this.state });
  }
}
