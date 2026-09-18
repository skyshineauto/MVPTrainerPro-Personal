class MvpSoundModesProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "pure";
    this.detector = 0;
    this.gain = 1;
    this.port.onmessage = (event) => {
      const message = event?.data ?? {};
      if (message.type === "mode" && ["pure", "adaptive", "power"].includes(message.mode)) {
        this.mode = message.mode;
        this.detector = 0;
        this.gain = 1;
      } else if (message.type === "reset") {
        this.detector = 0;
        this.gain = 1;
      }
    };
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

  static softCeiling(value, ceiling) {
    const absolute = Math.abs(value);
    const kneeStart = ceiling * 0.82;
    if (absolute <= kneeStart) return value;
    const span = Math.max(1e-6, ceiling - kneeStart);
    const shaped = kneeStart + span * Math.tanh((absolute - kneeStart) / span);
    return Math.sign(value) * Math.min(ceiling, shaped);
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    if (!output.length) return true;

    if (this.mode === "pure") {
      MvpSoundModesProcessor.copyInput(input, output);
      return true;
    }

    const settings = this.mode === "power"
      ? { drive: 1.65, threshold: 0.42, ratio: 3.4, makeup: 1.15, ceiling: 0.985, envAttackMs: 3.0, envReleaseMs: 145, gainAttackMs: 2.0, gainReleaseMs: 120 }
      : { drive: 1.25, threshold: 0.55, ratio: 2.0, makeup: 1.06, ceiling: 0.985, envAttackMs: 5.0, envReleaseMs: 190, gainAttackMs: 3.0, gainReleaseMs: 165 };

    const rate = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const envAttack = Math.exp(-1 / (rate * settings.envAttackMs / 1000));
    const envRelease = Math.exp(-1 / (rate * settings.envReleaseMs / 1000));
    const gainAttack = Math.exp(-1 / (rate * settings.gainAttackMs / 1000));
    const gainRelease = Math.exp(-1 / (rate * settings.gainReleaseMs / 1000));
    const frames = output[0]?.length ?? 0;

    for (let frame = 0; frame < frames; frame += 1) {
      let peak = 0;
      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[channel] ?? input[0];
        const sample = (source?.[frame] ?? 0) * settings.drive;
        peak = Math.max(peak, Math.abs(sample));
      }

      const envCoefficient = peak > this.detector ? envAttack : envRelease;
      this.detector = envCoefficient * this.detector + (1 - envCoefficient) * peak;

      let desiredGain = 1;
      if (this.detector > settings.threshold) {
        const exponent = 1 - 1 / settings.ratio;
        desiredGain = Math.pow(settings.threshold / Math.max(this.detector, 1e-9), exponent);
      }

      const gainCoefficient = desiredGain < this.gain ? gainAttack : gainRelease;
      this.gain = gainCoefficient * this.gain + (1 - gainCoefficient) * desiredGain;

      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[channel] ?? input[0];
        const target = output[channel];
        if (!target) continue;
        const sample = (source?.[frame] ?? 0) * settings.drive * this.gain * settings.makeup;
        target[frame] = MvpSoundModesProcessor.softCeiling(sample, settings.ceiling);
      }
    }

    return true;
  }
}

registerProcessor("mvp-sound-modes", MvpSoundModesProcessor);
