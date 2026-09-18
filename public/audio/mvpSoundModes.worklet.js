class MvpSoundModesProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "pure";
    this.pendingModeConfirmation = true;

    this.compEnvelope = 0;
    this.limiterGain = 1;
    this.bassShare = 0;
    this.bassState = [0, 0];

    this.lookaheadFrames = 256;
    this.delay = [
      new Float32Array(this.lookaheadFrames),
      new Float32Array(this.lookaheadFrames),
    ];
    this.delayIndex = 0;

    this.port.onmessage = (event) => {
      const message = event?.data ?? {};
      if (message.type === "ping") {
        this.port.postMessage({ type: "ready" });
        return;
      }
      if (message.type === "mode" && ["pure", "adaptive", "power"].includes(message.mode)) {
        this.mode = message.mode;
        this.resetDynamics();
        this.pendingModeConfirmation = true;
        this.port.postMessage({ type: "mode-selected", mode: this.mode });
        return;
      }
      if (message.type === "reset") {
        this.resetDynamics();
        this.pendingModeConfirmation = true;
      }
    };
  }

  resetDynamics() {
    this.compEnvelope = 0;
    this.limiterGain = 1;
    this.bassShare = 0;
    this.bassState[0] = 0;
    this.bassState[1] = 0;
    this.delay[0].fill(0);
    this.delay[1].fill(0);
    this.delayIndex = 0;
  }

  static dbToGain(db) {
    return Math.pow(10, db / 20);
  }

  static gainToDb(gain) {
    return 20 * Math.log10(Math.max(1e-12, gain));
  }

  static clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  static copyInput(input, output) {
    const frames = output[0]?.length ?? 0;
    for (let channel = 0; channel < output.length; channel += 1) {
      const source = input[channel] ?? input[0];
      const target = output[channel];
      if (!target) continue;
      if (!source) {
        target.fill(0);
        continue;
      }
      for (let frame = 0; frame < frames; frame += 1) {
        target[frame] = source[frame] ?? 0;
      }
    }
  }

  static hasAudibleSignal(input, frames) {
    for (let channel = 0; channel < input.length; channel += 1) {
      const source = input[channel];
      if (!source) continue;
      for (let frame = 0; frame < frames; frame += 1) {
        if (Math.abs(source[frame] ?? 0) > 1e-5) return true;
      }
    }
    return false;
  }

  confirmModeIfAudible(input, frames) {
    if (!this.pendingModeConfirmation) return;
    if (!MvpSoundModesProcessor.hasAudibleSignal(input, frames)) return;
    this.pendingModeConfirmation = false;
    this.port.postMessage({ type: "mode-active", mode: this.mode });
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    if (!output.length) return true;

    const frames = output[0]?.length ?? 0;

    if (this.mode === "pure") {
      MvpSoundModesProcessor.copyInput(input, output);
      this.confirmModeIfAudible(input, frames);
      return true;
    }

    // R8: parallel crest compression + bass-aware lookahead limiting.
    // This raises average musical energy instead of brute-force clipping peaks.
    // PURE remains untouched. No EQ, saturation, bass boost, stereo widening,
    // exciter, spatial processing or device-specific profile is used here.
    const isPower = this.mode === "power";
    const settings = isPower
      ? {
          thresholdDb: -26,
          ratio: 10,
          attackMs: 1.5,
          releaseMs: 45,
          parallelAmount: 3.0,
          makeupDb: 5.5,
          ceiling: 0.89,
          limiterFastReleaseMs: 10,
          limiterBassReleaseMs: 300,
          bassCutoffHz: 145,
          bassMemoryMs: 100,
          bassParallelReduction: 0.95,
          bassMakeupReduction: 0.70,
        }
      : {
          thresholdDb: -14,
          ratio: 2,
          attackMs: 8,
          releaseMs: 120,
          parallelAmount: 0.10,
          makeupDb: 0.40,
          ceiling: 0.89,
          limiterFastReleaseMs: 60,
          limiterBassReleaseMs: 180,
          bassCutoffHz: 140,
          bassMemoryMs: 120,
          bassParallelReduction: 0.30,
          bassMakeupReduction: 0.10,
        };

    const rate = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const attackCoeff = Math.exp(-1 / (rate * settings.attackMs / 1000));
    const releaseCoeff = Math.exp(-1 / (rate * settings.releaseMs / 1000));
    const bassMemoryCoeff = Math.exp(-1 / (rate * settings.bassMemoryMs / 1000));
    const lowPassAlpha = 1 - Math.exp(-2 * Math.PI * settings.bassCutoffHz / rate);

    for (let frame = 0; frame < frames; frame += 1) {
      const left = input[0]?.[frame] ?? 0;
      const right = input[1]?.[frame] ?? left;
      const samplePeak = Math.max(Math.abs(left), Math.abs(right));

      const envelopeCoeff = samplePeak > this.compEnvelope ? attackCoeff : releaseCoeff;
      this.compEnvelope =
        envelopeCoeff * this.compEnvelope +
        (1 - envelopeCoeff) * samplePeak;

      const envelopeDb = MvpSoundModesProcessor.gainToDb(this.compEnvelope);
      const overDb = Math.max(0, envelopeDb - settings.thresholdDb);
      const compressionDb = overDb * (1 - 1 / settings.ratio);
      const compressedGain = MvpSoundModesProcessor.dbToGain(-compressionDb);

      let sampleSq = 0;
      let lowSq = 0;
      const samples = [left, right];
      for (let channel = 0; channel < 2; channel += 1) {
        const sample = samples[channel];
        sampleSq += sample * sample;
        const low =
          this.bassState[channel] +
          lowPassAlpha * (sample - this.bassState[channel]);
        this.bassState[channel] = low;
        lowSq += low * low;
      }
      sampleSq *= 0.5;
      lowSq *= 0.5;

      const instantaneousBassShare =
        sampleSq > 1e-12
          ? MvpSoundModesProcessor.clamp(lowSq / sampleSq, 0, 1)
          : 0;
      this.bassShare =
        bassMemoryCoeff * this.bassShare +
        (1 - bassMemoryCoeff) * instantaneousBassShare;

      const effectiveParallel =
        settings.parallelAmount *
        (1 - settings.bassParallelReduction * this.bassShare);
      const effectiveMakeupDb =
        settings.makeupDb *
        (1 - settings.bassMakeupReduction * this.bassShare);

      const makeupGain = MvpSoundModesProcessor.dbToGain(effectiveMakeupDb);

      // Direct path + heavily compressed parallel path. Peaks receive much less
      // contribution than the musical body, which lowers crest factor without
      // soft-clipping or saturating the waveform.
      const programGain =
        (1 + effectiveParallel * compressedGain) * makeupGain;

      // Look ahead 256 samples (~5.3 ms at 48 kHz) so the limiter reduces gain
      // before the protected peak reaches the output.
      const delayedLeft = this.delay[0][this.delayIndex];
      const delayedRight = this.delay[1][this.delayIndex];
      this.delay[0][this.delayIndex] = left;
      this.delay[1][this.delayIndex] = right;
      this.delayIndex += 1;
      if (this.delayIndex >= this.lookaheadFrames) this.delayIndex = 0;

      const candidatePeak = samplePeak * programGain;
      const requiredLimiter =
        candidatePeak > settings.ceiling
          ? settings.ceiling / Math.max(candidatePeak, 1e-12)
          : 1;

      if (requiredLimiter < this.limiterGain) {
        this.limiterGain = requiredLimiter;
      } else {
        const limiterReleaseMs =
          settings.limiterFastReleaseMs +
          (settings.limiterBassReleaseMs - settings.limiterFastReleaseMs) *
            this.bassShare;
        const limiterReleaseCoeff =
          Math.exp(-1 / (rate * limiterReleaseMs / 1000));
        this.limiterGain =
          limiterReleaseCoeff * this.limiterGain +
          (1 - limiterReleaseCoeff);
      }

      const finalGain = programGain * this.limiterGain;
      const outLeft = delayedLeft * finalGain;
      const outRight = delayedRight * finalGain;

      if (output[0]) {
        output[0][frame] = MvpSoundModesProcessor.clamp(
          outLeft,
          -settings.ceiling,
          settings.ceiling,
        );
      }
      if (output[1]) {
        output[1][frame] = MvpSoundModesProcessor.clamp(
          outRight,
          -settings.ceiling,
          settings.ceiling,
        );
      }
      for (let channel = 2; channel < output.length; channel += 1) {
        const target = output[channel];
        if (!target) continue;
        const delayed = channel % 2 === 0 ? delayedLeft : delayedRight;
        target[frame] = MvpSoundModesProcessor.clamp(
          delayed * finalGain,
          -settings.ceiling,
          settings.ceiling,
        );
      }
    }

    this.confirmModeIfAudible(input, frames);
    return true;
  }
}

registerProcessor("mvp-sound-modes", MvpSoundModesProcessor);
