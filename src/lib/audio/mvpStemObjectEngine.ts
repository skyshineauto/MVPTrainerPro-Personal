export type MvpStemName = "vocals" | "drums" | "bass" | "other";
export type MvpStemStageMode = "studio" | "live" | "arena";
export type MvpStemOutputProfile = "headphones" | "speaker" | "car_hifi";

export type MvpStemBundle = Record<MvpStemName, string>;

type StemVoiceLayout = {
  leftX: number;
  rightX: number;
  z: number;
  room: number;
};

export type MvpStemStageLayout = Record<MvpStemName, StemVoiceLayout>;

type Voice = {
  input: GainNode;
  hrtf: PannerNode;
  hrtfGain: GainNode;
  speakerPan: StereoPannerNode;
  speakerGain: GainNode;
  roomDelay: DelayNode;
  roomFilter: BiquadFilterNode;
  roomPan: StereoPannerNode;
  roomGain: GainNode;
};

type StemGraph = {
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  splitter: ChannelSplitterNode;
  left: Voice;
  right: Voice;
};

export type MvpStemObjectEngine = {
  readonly output: GainNode;
  prepare(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  setStage(profile: MvpStemOutputProfile, mode: MvpStemStageMode, intensity: number): void;
  hardSync(): void;
  dispose(): void;
};

const STEMS: MvpStemName[] = ["vocals", "drums", "bass", "other"];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function spreadForMode(mode: MvpStemStageMode) {
  if (mode === "arena") return 1;
  if (mode === "live") return 0.72;
  return 0.44;
}

export function getMvpStemStageLayout(
  profile: MvpStemOutputProfile,
  mode: MvpStemStageMode,
  intensity: number,
): MvpStemStageLayout {
  const i = clamp(Number(intensity) || 0, 0, 1);
  const m = spreadForMode(mode);
  const headphoneScale = profile === "headphones" ? 1 : 0.76;
  const stage = (0.72 + 0.58 * i) * m * headphoneScale;
  const depth = mode === "arena" ? 1.9 : mode === "live" ? 1.35 : 0.92;

  return {
    vocals: {
      leftX: -0.09 * headphoneScale,
      rightX: 0.09 * headphoneScale,
      z: -0.82 - 0.16 * i,
      room: mode === "studio" ? 0.018 : mode === "live" ? 0.055 + 0.025 * i : 0.09 + 0.045 * i,
    },
    bass: {
      leftX: -0.025,
      rightX: 0.025,
      z: -0.76,
      room: mode === "arena" ? 0.012 : 0.006,
    },
    drums: {
      leftX: -(0.68 + stage * 0.74),
      rightX: 0.68 + stage * 0.74,
      z: -depth - 0.14 * i,
      room: mode === "studio" ? 0.025 : mode === "live" ? 0.085 + 0.035 * i : 0.14 + 0.055 * i,
    },
    other: {
      leftX: -(0.96 + stage * 1.05),
      rightX: 0.96 + stage * 1.05,
      z: -depth - (mode === "arena" ? 0.7 : 0.35),
      room: mode === "studio" ? 0.03 : mode === "live" ? 0.095 + 0.045 * i : 0.17 + 0.07 * i,
    },
  };
}

function waitUntilReady(element: HTMLAudioElement, timeoutMs = 18_000) {
  if (element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error("Stem audio timed out.")), timeoutMs);
    const finish = (error?: Error) => {
      window.clearTimeout(timer);
      element.removeEventListener("canplay", onReady);
      element.removeEventListener("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onError = () => finish(new Error("Stem audio could not be loaded."));
    element.addEventListener("canplay", onReady, { once: true });
    element.addEventListener("error", onError, { once: true });
    element.load();
  });
}

function setPannerPosition(panner: PannerNode, x: number, z: number, now: number) {
  panner.positionX.setTargetAtTime(x, now, 0.02);
  panner.positionY.setTargetAtTime(0, now, 0.02);
  panner.positionZ.setTargetAtTime(z, now, 0.02);
}

function createVoice(context: AudioContext, output: AudioNode, side: -1 | 1): Voice {
  const input = context.createGain();
  input.gain.value = 0.67;

  const hrtf = context.createPanner();
  hrtf.panningModel = "HRTF";
  hrtf.distanceModel = "inverse";
  hrtf.refDistance = 1;
  hrtf.maxDistance = 30;
  hrtf.rolloffFactor = 0.18;
  hrtf.coneInnerAngle = 360;
  hrtf.coneOuterAngle = 360;

  const hrtfGain = context.createGain();
  hrtfGain.gain.value = 0;

  const speakerPan = context.createStereoPanner();
  const speakerGain = context.createGain();
  speakerGain.gain.value = 0;

  const roomDelay = context.createDelay(0.08);
  roomDelay.delayTime.value = side < 0 ? 0.013 : 0.021;
  const roomFilter = context.createBiquadFilter();
  roomFilter.type = "lowpass";
  roomFilter.frequency.value = 6800;
  roomFilter.Q.value = 0.45;
  const roomPan = context.createStereoPanner();
  roomPan.pan.value = side < 0 ? -0.58 : 0.58;
  const roomGain = context.createGain();
  roomGain.gain.value = 0;

  input.connect(hrtf);
  hrtf.connect(hrtfGain);
  hrtfGain.connect(output);

  input.connect(speakerPan);
  speakerPan.connect(speakerGain);
  speakerGain.connect(output);

  input.connect(roomDelay);
  roomDelay.connect(roomFilter);
  roomFilter.connect(roomPan);
  roomPan.connect(roomGain);
  roomGain.connect(output);

  return { input, hrtf, hrtfGain, speakerPan, speakerGain, roomDelay, roomFilter, roomPan, roomGain };
}

export function createMvpStemObjectEngine(
  context: AudioContext,
  reference: HTMLAudioElement,
  destination: AudioNode,
  bundle: MvpStemBundle,
): MvpStemObjectEngine {
  const output = context.createGain();
  output.gain.value = 0;
  output.connect(destination);

  const graphs = new Map<MvpStemName, StemGraph>();
  let enabled = false;
  let disposed = false;
  let prepared = false;
  let currentProfile: MvpStemOutputProfile = "headphones";
  let currentMode: MvpStemStageMode = "studio";
  let currentIntensity = 0.72;
  let syncTimer: number | null = null;

  for (const stem of STEMS) {
    const element = new Audio();
    element.preload = "auto";
    element.crossOrigin = "anonymous";
    element.src = bundle[stem];
    element.volume = 1;

    const source = context.createMediaElementSource(element);
    const splitter = context.createChannelSplitter(2);
    source.connect(splitter);

    const left = createVoice(context, output, -1);
    const right = createVoice(context, output, 1);
    splitter.connect(left.input, 0);
    splitter.connect(right.input, 1);

    graphs.set(stem, { element, source, splitter, left, right });
  }

  const allElements = () => Array.from(graphs.values(), (graph) => graph.element);

  const syncOne = (element: HTMLAudioElement, hard = false) => {
    const target = Number(reference.currentTime || 0);
    const actual = Number(element.currentTime || 0);
    const delta = target - actual;
    const baseRate = clamp(Number(reference.playbackRate || 1), 0.5, 2);

    if (hard || Math.abs(delta) > 0.055) {
      try { element.currentTime = Math.max(0, target); } catch { /* media not seekable yet */ }
      element.playbackRate = baseRate;
      return;
    }

    if (Math.abs(delta) > 0.012) {
      element.playbackRate = clamp(baseRate * (delta > 0 ? 1.018 : 0.982), 0.5, 2);
    } else {
      element.playbackRate = baseRate;
    }
  };

  const hardSync = () => {
    for (const element of allElements()) syncOne(element, true);
  };

  const playStems = async () => {
    if (!enabled || disposed || reference.paused) return;
    hardSync();
    await Promise.allSettled(allElements().map((element) => element.play()));
  };

  const pauseStems = () => {
    for (const element of allElements()) element.pause();
  };

  const stopTimer = () => {
    if (syncTimer != null) window.clearInterval(syncTimer);
    syncTimer = null;
  };

  const startTimer = () => {
    stopTimer();
    syncTimer = window.setInterval(() => {
      if (!enabled || disposed) return;
      for (const element of allElements()) syncOne(element, false);
    }, 220);
  };

  const updateStage = () => {
    const layout = getMvpStemStageLayout(currentProfile, currentMode, currentIntensity);
    const now = context.currentTime;
    const headphones = currentProfile === "headphones";

    for (const stem of STEMS) {
      const graph = graphs.get(stem);
      if (!graph) continue;
      const row = layout[stem];
      const leftPan = clamp(row.leftX / 2.8, -1, 1);
      const rightPan = clamp(row.rightX / 2.8, -1, 1);

      setPannerPosition(graph.left.hrtf, row.leftX, row.z, now);
      setPannerPosition(graph.right.hrtf, row.rightX, row.z, now);
      graph.left.speakerPan.pan.setTargetAtTime(leftPan, now, 0.02);
      graph.right.speakerPan.pan.setTargetAtTime(rightPan, now, 0.02);

      graph.left.hrtfGain.gain.setTargetAtTime(headphones ? 1 : 0, now, 0.015);
      graph.right.hrtfGain.gain.setTargetAtTime(headphones ? 1 : 0, now, 0.015);
      graph.left.speakerGain.gain.setTargetAtTime(headphones ? 0 : 1, now, 0.015);
      graph.right.speakerGain.gain.setTargetAtTime(headphones ? 0 : 1, now, 0.015);

      const roomScale = headphones ? 1 : currentProfile === "car_hifi" ? 0.62 : 0.48;
      graph.left.roomGain.gain.setTargetAtTime(row.room * roomScale, now, 0.035);
      graph.right.roomGain.gain.setTargetAtTime(row.room * roomScale, now, 0.035);
      graph.left.roomDelay.delayTime.setTargetAtTime(currentMode === "arena" ? 0.026 : currentMode === "live" ? 0.018 : 0.011, now, 0.03);
      graph.right.roomDelay.delayTime.setTargetAtTime(currentMode === "arena" ? 0.039 : currentMode === "live" ? 0.027 : 0.017, now, 0.03);
    }
  };

  const onPlay = () => { void playStems(); };
  const onPause = () => pauseStems();
  const onSeeking = () => hardSync();
  const onRate = () => hardSync();

  reference.addEventListener("play", onPlay);
  reference.addEventListener("pause", onPause);
  reference.addEventListener("seeking", onSeeking);
  reference.addEventListener("ratechange", onRate);
  reference.addEventListener("ended", onPause);

  const prepare = async () => {
    if (prepared) return;
    await Promise.all(allElements().map((element) => waitUntilReady(element)));
    hardSync();
    prepared = true;
    updateStage();
  };

  const setEnabled = async (nextEnabled: boolean) => {
    if (disposed) return;
    enabled = Boolean(nextEnabled);
    const now = context.currentTime;
    output.gain.cancelScheduledValues(now);
    output.gain.setValueAtTime(output.gain.value, now);

    if (!enabled) {
      output.gain.linearRampToValueAtTime(0, now + 0.035);
      window.setTimeout(() => {
        if (!enabled) pauseStems();
      }, 55);
      stopTimer();
      return;
    }

    await prepare();
    hardSync();
    await playStems();
    output.gain.linearRampToValueAtTime(0.82, now + 0.045);
    startTimer();
  };

  const setStage = (profile: MvpStemOutputProfile, mode: MvpStemStageMode, intensity: number) => {
    currentProfile = profile;
    currentMode = mode;
    currentIntensity = clamp(Number(intensity) || 0, 0, 1);
    updateStage();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    enabled = false;
    stopTimer();
    reference.removeEventListener("play", onPlay);
    reference.removeEventListener("pause", onPause);
    reference.removeEventListener("seeking", onSeeking);
    reference.removeEventListener("ratechange", onRate);
    reference.removeEventListener("ended", onPause);
    for (const graph of graphs.values()) {
      graph.element.pause();
      graph.element.removeAttribute("src");
      graph.element.load();
      try { graph.source.disconnect(); } catch { /* disposed */ }
      try { graph.splitter.disconnect(); } catch { /* disposed */ }
      for (const voice of [graph.left, graph.right]) {
        for (const node of [voice.input, voice.hrtf, voice.hrtfGain, voice.speakerPan, voice.speakerGain, voice.roomDelay, voice.roomFilter, voice.roomPan, voice.roomGain]) {
          try { node.disconnect(); } catch { /* disposed */ }
        }
      }
    }
    graphs.clear();
    try { output.disconnect(); } catch { /* disposed */ }
  };

  return { output, prepare, setEnabled, setStage, hardSync, dispose };
}
