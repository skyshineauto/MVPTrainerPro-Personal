class MvpSoundModesProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "pure";
    this.pendingModeConfirmation = true;
    this.detector = 0;
    this.rmsSq = 0;
    this.compGain = 0;
    this.makeupGain = 1;
    this.limiterGain = 1;
    this.bassState = [0, 0];
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
    this.detector = 0;
    this.rmsSq = 0;
    this.compGain = 0;
    this.makeupGain = 1;
    this.limiterGain = 1;
    this.bassState[0] = 0;
    this.bassState[1] = 0;
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
      for (let frame = 0; frame < frames; frame += 1) target[frame] = source[frame] ?? 0;
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

  static dbToGain(db) { return Math.pow(10, db / 20); }
  static gainToDb(gain) { return 20 * Math.log10(Math.max(1e-9, gain)); }
  static clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

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

    const isPower = this.mode === "power";
    const settings = isPower
      ? {
          targetRmsDb: -7.5,
          maxGainDb: 7.5,
          ceiling: 0.94,
          rmsMs: 650,
          peakAttackMs: 1.0,
          peakReleaseMs: 420,
          gainAttackMs: 500,
          gainReleaseMs: 900,
          limiterReleaseFastMs: 95,
          limiterReleaseBassMs: 240,
          bassCutoffHz: 145,
          bassMemoryMs: 180,
        }
      : {
          targetRmsDb: -11.8,
          maxGainDb: 3.2,
          ceiling: 0.92,
          rmsMs: 800,
          peakAttackMs: 1.5,
          peakReleaseMs: 500,
          gainAttackMs: 650,
          gainReleaseMs: 1100,
          limiterReleaseFastMs: 150,
          limiterReleaseBassMs: 280,
          bassCutoffHz: 140,
          bassMemoryMs: 220,
        };

    const rate = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const rmsCoeff = Math.exp(-1 / (rate * settings.rmsMs / 1000));
    const peakAttack = Math.exp(-1 / (rate * settings.peakAttackMs / 1000));
    const peakRelease = Math.exp(-1 / (rate * settings.peakReleaseMs / 1000));
    const gainAttack = Math.exp(-1 / (rate * settings.gainAttackMs / 1000));
    const gainRelease = Math.exp(-1 / (rate * settings.gainReleaseMs / 1000));
    const lpAlpha = 1 - Math.exp(-2 * Math.PI * settings.bassCutoffHz / rate);
    const bassMemoryCoeff = Math.exp(-1 / (rate * settings.bassMemoryMs / 1000));
    const maxGain = MvpSoundModesProcessor.dbToGain(settings.maxGainDb);

    // Reuse detector as the slow peak envelope and compGain as bass-energy memory.
    // makeupGain is the slowly changing loudness gain; limiterGain is the final guard.
    for (let frame = 0; frame < frames; frame += 1) {
      let samplePeak = 0;
      let sampleSq = 0;
      let lowSq = 0;
      let activeChannels = 0;

      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[channel] ?? input[0];
        const sample = source?.[frame] ?? 0;
        samplePeak = Math.max(samplePeak, Math.abs(sample));
        sampleSq += sample * sample;
        const bassIndex = channel < 2 ? channel : 0;
        const low = this.bassState[bassIndex] + lpAlpha * (sample - this.bassState[bassIndex]);
        this.bassState[bassIndex] = low;
        lowSq += low * low;
        activeChannels += 1;
      }

      if (activeChannels) {
        sampleSq /= activeChannels;
        lowSq /= activeChannels;
      }

      this.rmsSq = rmsCoeff * this.rmsSq + (1 - rmsCoeff) * sampleSq;
      const peakCoeff = samplePeak > this.detector ? peakAttack : peakRelease;
      this.detector = peakCoeff * this.detector + (1 - peakCoeff) * samplePeak;

      const instantaneousBassShare = sampleSq > 1e-12 ? MvpSoundModesProcessor.clamp(lowSq / sampleSq, 0, 1) : 0;
      this.compGain = bassMemoryCoeff * this.compGain + (1 - bassMemoryCoeff) * instantaneousBassShare;

      const rms = Math.sqrt(Math.max(1e-12, this.rmsSq));
      const rmsDb = MvpSoundModesProcessor.gainToDb(rms);
      const rmsTargetGain = MvpSoundModesProcessor.dbToGain(settings.targetRmsDb - rmsDb);
      const headroomGain = this.detector > 1e-6 ? settings.ceiling / this.detector : maxGain;
      const desiredProgramGain = MvpSoundModesProcessor.clamp(
        Math.max(1, Math.min(rmsTargetGain, maxGain), Math.min(headroomGain, maxGain)),
        1,
        maxGain,
      );

      const programCoeff = desiredProgramGain < this.makeupGain ? gainAttack : gainRelease;
      this.makeupGain = programCoeff * this.makeupGain + (1 - programCoeff) * desiredProgramGain;

      let candidatePeak = 0;
      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[channel] ?? input[0];
        candidatePeak = Math.max(candidatePeak, Math.abs((source?.[frame] ?? 0) * this.makeupGain));
      }

      const requiredLimiter = candidatePeak > settings.ceiling
        ? settings.ceiling / Math.max(candidatePeak, 1e-12)
        : 1;
      if (requiredLimiter < this.limiterGain) {
        this.limiterGain = requiredLimiter;
      } else {
        const bassShare = MvpSoundModesProcessor.clamp(this.compGain, 0, 1);
        const releaseMs = settings.limiterReleaseFastMs
          + (settings.limiterReleaseBassMs - settings.limiterReleaseFastMs) * bassShare;
        const limiterRelease = Math.exp(-1 / (rate * releaseMs / 1000));
        this.limiterGain = limiterRelease * this.limiterGain + (1 - limiterRelease) * 1;
      }

      const finalGain = this.makeupGain * this.limiterGain;
      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[channel] ?? input[0];
        const target = output[channel];
        if (!target) continue;
        const sample = (source?.[frame] ?? 0) * finalGain;
        target[frame] = MvpSoundModesProcessor.clamp(sample, -settings.ceiling, settings.ceiling);
      }
    }

    this.confirmModeIfAudible(input, frames);
    return true;
  }

}

registerProcessor("mvp-sound-modes", MvpSoundModesProcessor);
