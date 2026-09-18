class MvpSoundModesProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "pure";
    this.pendingModeConfirmation = true;

    this.programPeak = 0;
    this.programAvg = 0;
    this.compEnv = 0;
    this.compGain = 1;
    this.limiterEnvelope = 0;

    this.lookaheadFrames = 256;
    this.lookL = new Float32Array(this.lookaheadFrames);
    this.lookR = new Float32Array(this.lookaheadFrames);
    this.lookGain = new Float32Array(this.lookaheadFrames);
    this.lookGain.fill(1);
    this.lookIndex = 0;

    this.filters = {
      adaptive: this.createToneBank("adaptive"),
      power: this.createToneBank("power"),
    };

    this.telemetryFrames = 0;
    this.telemetryInputSq = 0;
    this.telemetryOutputSq = 0;
    this.telemetrySamples = 0;
    this.telemetryOutputPeak = 0;

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

  static clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  static dbToGain(db) {
    return Math.pow(10, db / 20);
  }

  static gainToDb(gain) {
    return 20 * Math.log10(Math.max(1e-12, gain));
  }

  createBiquad() {
    return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 };
  }

  setPeaking(filter, frequency, q, gainDb) {
    const rate = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const f = MvpSoundModesProcessor.clamp(frequency, 10, rate * 0.475);
    const A = Math.pow(10, gainDb / 40);
    const w = 2 * Math.PI * f / rate;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const alpha = s / (2 * q);
    const aa = 1 + alpha / A;
    filter.b0 = (1 + alpha * A) / aa;
    filter.b1 = (-2 * c) / aa;
    filter.b2 = (1 - alpha * A) / aa;
    filter.a1 = (-2 * c) / aa;
    filter.a2 = (1 - alpha / A) / aa;
  }

  setLowShelf(filter, frequency, gainDb) {
    const rate = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const f = MvpSoundModesProcessor.clamp(frequency, 10, rate * 0.475);
    const A = Math.pow(10, gainDb / 40);
    const w = 2 * Math.PI * f / rate;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const beta = 2 * Math.sqrt(A) * s;
    const aa = (A + 1) + (A - 1) * c + beta;
    filter.b0 = A * ((A + 1) - (A - 1) * c + beta) / aa;
    filter.b1 = 2 * A * ((A - 1) - (A + 1) * c) / aa;
    filter.b2 = A * ((A + 1) - (A - 1) * c - beta) / aa;
    filter.a1 = -2 * ((A - 1) + (A + 1) * c) / aa;
    filter.a2 = ((A + 1) + (A - 1) * c - beta) / aa;
  }

  setHighShelf(filter, frequency, gainDb) {
    const rate = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const f = MvpSoundModesProcessor.clamp(frequency, 10, rate * 0.475);
    const A = Math.pow(10, gainDb / 40);
    const w = 2 * Math.PI * f / rate;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const beta = 2 * Math.sqrt(A) * s;
    const aa = (A + 1) - (A - 1) * c + beta;
    filter.b0 = A * ((A + 1) + (A - 1) * c + beta) / aa;
    filter.b1 = -2 * A * ((A - 1) + (A + 1) * c) / aa;
    filter.b2 = A * ((A + 1) + (A - 1) * c - beta) / aa;
    filter.a1 = 2 * ((A - 1) - (A + 1) * c) / aa;
    filter.a2 = ((A + 1) - (A - 1) * c - beta) / aa;
  }

  createToneBank(mode) {
    const left = Array.from({ length: 5 }, () => this.createBiquad());
    const right = Array.from({ length: 5 }, () => this.createBiquad());

    const gains = mode === "power"
      ? { bass: 1.8, body: 0.8, mud: -1.5, presence: 5.5, air: 5.5 }
      : { bass: 0.7, body: 0.25, mud: -0.5, presence: 1.2, air: 1.3 };

    for (const bank of [left, right]) {
      this.setLowShelf(bank[0], 76, gains.bass);
      this.setPeaking(bank[1], 160, 0.72, gains.body);
      this.setPeaking(bank[2], 520, 0.70, gains.mud);
      this.setPeaking(bank[3], 3200, 0.80, gains.presence);
      this.setHighShelf(bank[4], 9600, gains.air);
    }

    return { left, right };
  }

  processBiquad(filter, input) {
    const output = filter.b0 * input + filter.z1;
    filter.z1 = filter.b1 * input - filter.a1 * output + filter.z2;
    filter.z2 = filter.b2 * input - filter.a2 * output;
    return output;
  }

  processTone(bank, channel, input) {
    const filters = channel === 0 ? bank.left : bank.right;
    let output = input;
    for (let index = 0; index < filters.length; index += 1) {
      output = this.processBiquad(filters[index], output);
    }
    return output;
  }

  resetFilterState(bank) {
    for (const filter of [...bank.left, ...bank.right]) {
      filter.z1 = 0;
      filter.z2 = 0;
    }
  }

  resetDynamics() {
    this.programPeak = 0;
    this.programAvg = 0;
    this.compEnv = 0;
    this.compGain = 1;
    this.limiterEnvelope = 0;
    this.lookL.fill(0);
    this.lookR.fill(0);
    this.lookGain.fill(1);
    this.lookIndex = 0;
    this.resetFilterState(this.filters.adaptive);
    this.resetFilterState(this.filters.power);
    this.telemetryFrames = 0;
    this.telemetryInputSq = 0;
    this.telemetryOutputSq = 0;
    this.telemetrySamples = 0;
    this.telemetryOutputPeak = 0;
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

  addTelemetry(inputLeft, inputRight, outputLeft, outputRight) {
    this.telemetryInputSq += inputLeft * inputLeft + inputRight * inputRight;
    this.telemetryOutputSq += outputLeft * outputLeft + outputRight * outputRight;
    this.telemetrySamples += 2;
    this.telemetryOutputPeak = Math.max(
      this.telemetryOutputPeak,
      Math.abs(outputLeft),
      Math.abs(outputRight),
    );
    this.telemetryFrames += 1;

    const rate = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    if (this.telemetryFrames < Math.floor(rate * 0.5)) return;

    const inputRms = Math.sqrt(this.telemetryInputSq / Math.max(1, this.telemetrySamples));
    const outputRms = Math.sqrt(this.telemetryOutputSq / Math.max(1, this.telemetrySamples));
    const inputRmsDb = MvpSoundModesProcessor.gainToDb(inputRms);
    const outputRmsDb = MvpSoundModesProcessor.gainToDb(outputRms);

    this.port.postMessage({
      type: "telemetry",
      mode: this.mode,
      inputRmsDb,
      outputRmsDb,
      deltaDb: outputRmsDb - inputRmsDb,
      outputPeakDb: MvpSoundModesProcessor.gainToDb(this.telemetryOutputPeak),
    });

    this.telemetryFrames = 0;
    this.telemetryInputSq = 0;
    this.telemetryOutputSq = 0;
    this.telemetrySamples = 0;
    this.telemetryOutputPeak = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    if (!output.length) return true;

    const frames = output[0]?.length ?? 0;

    if (this.mode === "pure") {
      MvpSoundModesProcessor.copyInput(input, output);
      for (let frame = 0; frame < frames; frame += 1) {
        const left = input[0]?.[frame] ?? 0;
        const right = input[1]?.[frame] ?? left;
        this.addTelemetry(left, right, left, right);
      }
      this.confirmModeIfAudible(input, frames);
      return true;
    }

    const power = this.mode === "power";
    const bank = power ? this.filters.power : this.filters.adaptive;
    const rate = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;

    const peakAttack = 1 - Math.exp(-1 / (rate * 0.001));
    const peakRelease = 1 - Math.exp(-1 / (rate * 0.180));
    const avgAttack = 1 - Math.exp(-1 / (rate * 0.025));
    const avgRelease = 1 - Math.exp(-1 / (rate * 0.300));
    const compAttack = 1 - Math.exp(-1 / (rate * (power ? 0.004 : 0.008)));
    const compRelease = 1 - Math.exp(-1 / (rate * (power ? 0.110 : 0.160)));
    const limiterRelease = 1 - Math.exp(-1 / (rate * 0.150));

    const ceiling = power ? 0.894 : 0.80;

    for (let frame = 0; frame < frames; frame += 1) {
      const inputLeft = input[0]?.[frame] ?? 0;
      const inputRight = input[1]?.[frame] ?? inputLeft;

      const detector = Math.max(Math.abs(inputLeft), Math.abs(inputRight));
      const peakCoeff = detector > this.programPeak ? peakAttack : peakRelease;
      this.programPeak += (detector - this.programPeak) * peakCoeff;
      const avgCoeff = detector > this.programAvg ? avgAttack : avgRelease;
      this.programAvg += (detector - this.programAvg) * avgCoeff;

      const density = MvpSoundModesProcessor.clamp(
        this.programAvg / Math.max(this.programPeak, 1e-6),
        0,
        1,
      );
      const hotGuard = MvpSoundModesProcessor.clamp((this.programPeak - 0.70) / 0.22, 0, 1);

      let preampDb = power ? 6.28 : 2.35;
      preampDb -= power ? hotGuard * 3.60 : hotGuard * 1.00;
      const preamp = MvpSoundModesProcessor.dbToGain(preampDb);

      let left = inputLeft * preamp;
      let right = inputRight * preamp;

      const compDetector = Math.max(this.programAvg * preamp, 1e-6);
      const compEnvCoeff = compDetector > this.compEnv ? compAttack : compRelease;
      this.compEnv += (compDetector - this.compEnv) * compEnvCoeff;

      const threshold = power ? 0.473 : 0.681;
      const ratio = power ? 3.78 : 1.71;
      let targetGain = 1;
      if (this.compEnv > threshold) {
        targetGain = Math.pow(this.compEnv / threshold, (1 / ratio) - 1);
      }

      const compGainCoeff = targetGain < this.compGain ? compAttack : compRelease;
      this.compGain += (targetGain - this.compGain) * compGainCoeff;

      const blend = power ? 0.75 : 0.38;
      const compression = (1 - blend) + blend * this.compGain;
      const envNorm = MvpSoundModesProcessor.clamp(
        this.compEnv / (power ? 0.72 : 0.80),
        0,
        1,
      );
      const upwardDb = (1 - envNorm) * (power ? 1.10 : 0.30);
      const densityGuard = MvpSoundModesProcessor.clamp((density - 0.82) / 0.13, 0, 1);
      const makeupDb = (power ? 3.70 : 1.30) - (power ? densityGuard * 0.30 : 0);
      const programGain = compression * MvpSoundModesProcessor.dbToGain(makeupDb + upwardDb);

      left *= programGain;
      right *= programGain;

      left = this.processTone(bank, 0, left);
      right = this.processTone(bank, 1, right);

      const processedPeak = Math.max(Math.abs(left), Math.abs(right));

      // Stereo-linked lookahead limiter. Attack is immediate, release is slow.
      // Store the gain alongside the delayed samples so each sample exits with
      // the exact clean attenuation calculated from its own future peak envelope.
      if (processedPeak > this.limiterEnvelope) {
        this.limiterEnvelope = processedPeak;
      } else {
        this.limiterEnvelope += (processedPeak - this.limiterEnvelope) * limiterRelease;
      }

      const requiredGain = this.limiterEnvelope > ceiling
        ? ceiling / Math.max(this.limiterEnvelope, 1e-12)
        : 1;

      const delayedLeft = this.lookL[this.lookIndex];
      const delayedRight = this.lookR[this.lookIndex];
      const delayedGain = this.lookGain[this.lookIndex];

      this.lookL[this.lookIndex] = left;
      this.lookR[this.lookIndex] = right;
      this.lookGain[this.lookIndex] = requiredGain;
      this.lookIndex += 1;
      if (this.lookIndex >= this.lookaheadFrames) this.lookIndex = 0;

      const outputLeft = delayedLeft * delayedGain;
      const outputRight = delayedRight * delayedGain;

      if (output[0]) output[0][frame] = outputLeft;
      if (output[1]) output[1][frame] = outputRight;
      for (let channel = 2; channel < output.length; channel += 1) {
        const target = output[channel];
        if (!target) continue;
        target[frame] = channel % 2 === 0 ? outputLeft : outputRight;
      }

      this.addTelemetry(inputLeft, inputRight, outputLeft, outputRight);
    }

    this.confirmModeIfAudible(input, frames);
    return true;
  }
}

registerProcessor("mvp-sound-modes", MvpSoundModesProcessor);
