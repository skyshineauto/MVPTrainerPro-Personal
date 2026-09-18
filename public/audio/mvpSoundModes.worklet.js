class MvpSoundModesProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "pure";
    this.pendingModeConfirmation = true;
    this.sampleCounter = 0;

    this.lowSplit = this.createSplitBank(180);
    this.highSplit = this.createSplitBank(4200);

    this.bandState = {
      low: this.createBandState(),
      mid: this.createBandState(),
      high: this.createBandState(),
    };

    this.tone = {
      adaptive: this.createToneBank("adaptive"),
      power: this.createToneBank("power"),
    };

    this.programRmsSq = 0;
    this.processedRmsSq = 0;
    this.programPeak = 0;
    this.programGain = 1;
    this.limiterGain = 1;
    this.limiterMaxReductionDb = 0;

    this.lookaheadFrames = 144;
    this.lookL = new Float32Array(this.lookaheadFrames);
    this.lookR = new Float32Array(this.lookaheadFrames);
    this.lookIndex = 0;

    this.peakQueueValues = new Float32Array(this.lookaheadFrames + 16);
    this.peakQueueIndices = new Float64Array(this.lookaheadFrames + 16);
    this.peakQueueHead = 0;
    this.peakQueueTail = 0;

    this.tpL = this.createTruePeakState();
    this.tpR = this.createTruePeakState();

    this.telemetryFrames = 0;
    this.telemetryInputSq = 0;
    this.telemetryOutputSq = 0;
    this.telemetrySamples = 0;
    this.telemetryOutputPeak = 0;
    this.telemetryLimiterReductionDb = 0;

    this.port.onmessage = (event) => {
      const message = event?.data ?? {};
      if (message.type === "ping") {
        this.port.postMessage({ type: "ready", engine: "r10" });
        return;
      }
      if (message.type === "mode" && ["pure", "adaptive", "power"].includes(message.mode)) {
        const previous = this.mode;
        this.mode = message.mode;
        if (previous !== this.mode) this.resetForModeChange();
        this.pendingModeConfirmation = true;
        this.port.postMessage({ type: "mode-selected", mode: this.mode, engine: "r10" });
        return;
      }
      if (message.type === "reset") {
        this.resetAll();
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

  setLowpass(filter, frequency, q = 0.70710678118) {
    const rate = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const f = MvpSoundModesProcessor.clamp(frequency, 10, rate * 0.475);
    const w = 2 * Math.PI * f / rate;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const alpha = s / (2 * q);
    const aa = 1 + alpha;
    filter.b0 = ((1 - c) * 0.5) / aa;
    filter.b1 = (1 - c) / aa;
    filter.b2 = ((1 - c) * 0.5) / aa;
    filter.a1 = (-2 * c) / aa;
    filter.a2 = (1 - alpha) / aa;
  }

  setHighpass(filter, frequency, q = 0.70710678118) {
    const rate = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const f = MvpSoundModesProcessor.clamp(frequency, 10, rate * 0.475);
    const w = 2 * Math.PI * f / rate;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const alpha = s / (2 * q);
    const aa = 1 + alpha;
    filter.b0 = ((1 + c) * 0.5) / aa;
    filter.b1 = (-(1 + c)) / aa;
    filter.b2 = ((1 + c) * 0.5) / aa;
    filter.a1 = (-2 * c) / aa;
    filter.a2 = (1 - alpha) / aa;
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

  processBiquad(filter, input) {
    const output = filter.b0 * input + filter.z1;
    filter.z1 = filter.b1 * input - filter.a1 * output + filter.z2;
    filter.z2 = filter.b2 * input - filter.a2 * output;
    return output;
  }

  createSplitBank(frequency) {
    const createChannel = () => {
      const lp1 = this.createBiquad();
      const lp2 = this.createBiquad();
      const hp1 = this.createBiquad();
      const hp2 = this.createBiquad();
      this.setLowpass(lp1, frequency);
      this.setLowpass(lp2, frequency);
      this.setHighpass(hp1, frequency);
      this.setHighpass(hp2, frequency);
      return { lp1, lp2, hp1, hp2 };
    };
    return [createChannel(), createChannel()];
  }

  splitSample(bank, channel, input) {
    const state = bank[channel];
    const low = this.processBiquad(state.lp2, this.processBiquad(state.lp1, input));
    const high = this.processBiquad(state.hp2, this.processBiquad(state.hp1, input));
    return [low, high];
  }

  createBandState() {
    return { env: 0, gain: 1 };
  }

  createToneBank(mode) {
    const create = () => {
      const low = this.createBiquad();
      const body = this.createBiquad();
      const mud = this.createBiquad();
      const mid = this.createBiquad();
      const presence = this.createBiquad();
      const air = this.createBiquad();

      const settings = mode === "power"
        ? { low: 4.5, body: 3.2, mud: -0.8, mid: 2.5, presence: 1.30, air: 1.00 }
        : { low: 1.1, body: 0.8, mud: -0.25, mid: 0.55, presence: 0.30, air: 0.20 };

      this.setLowShelf(low, 78, settings.low);
      this.setPeaking(body, 165, 0.78, settings.body);
      this.setPeaking(mud, 480, 0.78, settings.mud);
      this.setPeaking(mid, 950, 0.72, settings.mid);
      this.setPeaking(presence, 3300, 0.85, settings.presence);
      this.setHighShelf(air, 10500, settings.air);
      return { low, body, mud, mid, presence, air };
    };
    return [create(), create()];
  }

  processTone(bank, channel, input) {
    const f = bank[channel];
    let output = input;
    output = this.processBiquad(f.low, output);
    output = this.processBiquad(f.body, output);
    output = this.processBiquad(f.mud, output);
    output = this.processBiquad(f.mid, output);
    output = this.processBiquad(f.presence, output);
    output = this.processBiquad(f.air, output);
    return output;
  }

  resetBiquad(filter) {
    filter.z1 = 0;
    filter.z2 = 0;
  }

  resetSplitBank(bank) {
    for (const channel of bank) {
      for (const filter of Object.values(channel)) this.resetBiquad(filter);
    }
  }

  resetToneBank(bank) {
    for (const channel of bank) {
      for (const filter of Object.values(channel)) this.resetBiquad(filter);
    }
  }

  createTruePeakState() {
    return { hist: new Float32Array(16) };
  }

  resetTruePeak(state) {
    state.hist.fill(0);
  }

  truePeak4x(state, sample) {
    const h = state.hist;
    for (let i = h.length - 1; i > 0; i -= 1) h[i] = h[i - 1];
    h[0] = sample;

    const taps = MvpSoundModesProcessor.TRUE_PEAK_TAPS;
    let peak = Math.abs(sample);
    for (let phase = 0; phase < taps.length; phase += 1) {
      let value = 0;
      const phaseTaps = taps[phase];
      for (let i = 0; i < phaseTaps.length; i += 1) value += h[i] * phaseTaps[i];
      peak = Math.max(peak, Math.abs(value));
    }
    return peak;
  }

  resetLimiterQueue() {
    this.peakQueueHead = 0;
    this.peakQueueTail = 0;
    this.sampleCounter = 0;
  }

  pushPeak(value, index) {
    while (
      this.peakQueueTail > this.peakQueueHead &&
      this.peakQueueValues[(this.peakQueueTail - 1) % this.peakQueueValues.length] <= value
    ) {
      this.peakQueueTail -= 1;
    }
    const slot = this.peakQueueTail % this.peakQueueValues.length;
    this.peakQueueValues[slot] = value;
    this.peakQueueIndices[slot] = index;
    this.peakQueueTail += 1;

    const minIndex = index - this.lookaheadFrames + 1;
    while (
      this.peakQueueTail > this.peakQueueHead &&
      this.peakQueueIndices[this.peakQueueHead % this.peakQueueValues.length] < minIndex
    ) {
      this.peakQueueHead += 1;
    }

    // Rebase counters so integer growth never becomes an issue on long sessions.
    if (this.peakQueueHead > 1000000) {
      const active = this.peakQueueTail - this.peakQueueHead;
      for (let i = 0; i < active; i += 1) {
        const source = (this.peakQueueHead + i) % this.peakQueueValues.length;
        this.peakQueueValues[i] = this.peakQueueValues[source];
        this.peakQueueIndices[i] = this.peakQueueIndices[source];
      }
      this.peakQueueTail = active;
      this.peakQueueHead = 0;
    }
  }

  maxFuturePeak() {
    if (this.peakQueueTail <= this.peakQueueHead) return 0;
    return this.peakQueueValues[this.peakQueueHead % this.peakQueueValues.length];
  }

  resetForModeChange() {
    // Do not reset telemetry or program analysis to zero; keeping the detector
    // warm avoids the thin/quiet "re-learning" sound during mode switching.
    this.programGain = 1;
    this.limiterGain = 1;
    this.limiterMaxReductionDb = 0;
    this.lookL.fill(0);
    this.lookR.fill(0);
    this.lookIndex = 0;
    this.resetLimiterQueue();
    this.resetTruePeak(this.tpL);
    this.resetTruePeak(this.tpR);
    this.resetSplitBank(this.lowSplit);
    this.resetSplitBank(this.highSplit);
    this.resetToneBank(this.tone.adaptive);
    this.resetToneBank(this.tone.power);
    this.bandState.low.env = this.bandState.mid.env = this.bandState.high.env = 0;
    this.bandState.low.gain = this.bandState.mid.gain = this.bandState.high.gain = 1;
  }

  resetAll() {
    this.programRmsSq = 0;
    this.processedRmsSq = 0;
    this.programPeak = 0;
    this.resetForModeChange();
    this.telemetryFrames = 0;
    this.telemetryInputSq = 0;
    this.telemetryOutputSq = 0;
    this.telemetrySamples = 0;
    this.telemetryOutputPeak = 0;
    this.telemetryLimiterReductionDb = 0;
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
    this.port.postMessage({ type: "mode-active", mode: this.mode, engine: "r10" });
  }

  compressBand(name, left, right, settings, rate, wetScale = 1) {
    const state = this.bandState[name];
    const detector = Math.max(Math.abs(left), Math.abs(right));
    const attack = 1 - Math.exp(-1 / (rate * settings.attackMs / 1000));
    const release = 1 - Math.exp(-1 / (rate * settings.releaseMs / 1000));
    const envCoeff = detector > state.env ? attack : release;
    state.env += (detector - state.env) * envCoeff;

    const threshold = MvpSoundModesProcessor.dbToGain(settings.thresholdDb);
    let target = 1;
    if (state.env > threshold) {
      const over = state.env / threshold;
      target = Math.pow(over, (1 / settings.ratio) - 1);
    }

    const gainCoeff = target < state.gain ? attack : release;
    state.gain += (target - state.gain) * gainCoeff;

    // Parallel compression: keep the original transient and add controlled density.
    const effectiveWet = settings.wet * MvpSoundModesProcessor.clamp(wetScale, 0, 1);
    const wetGain = (1 - effectiveWet) + effectiveWet * state.gain;
    const makeup = MvpSoundModesProcessor.dbToGain(settings.makeupDb);
    return [left * wetGain * makeup, right * wetGain * makeup];
  }

  addTelemetry(inputLeft, inputRight, outputLeft, outputRight, limiterReductionDb) {
    this.telemetryInputSq += inputLeft * inputLeft + inputRight * inputRight;
    this.telemetryOutputSq += outputLeft * outputLeft + outputRight * outputRight;
    this.telemetrySamples += 2;
    this.telemetryOutputPeak = Math.max(
      this.telemetryOutputPeak,
      Math.abs(outputLeft),
      Math.abs(outputRight),
    );
    this.telemetryLimiterReductionDb = Math.max(this.telemetryLimiterReductionDb, limiterReductionDb);
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
      engine: "r10",
      inputRmsDb,
      outputRmsDb,
      deltaDb: outputRmsDb - inputRmsDb,
      outputPeakDb: MvpSoundModesProcessor.gainToDb(this.telemetryOutputPeak),
      limiterReductionDb: this.telemetryLimiterReductionDb,
    });

    this.telemetryFrames = 0;
    this.telemetryInputSq = 0;
    this.telemetryOutputSq = 0;
    this.telemetrySamples = 0;
    this.telemetryOutputPeak = 0;
    this.telemetryLimiterReductionDb = 0;
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
        this.addTelemetry(left, right, left, right, 0);
      }
      this.confirmModeIfAudible(input, frames);
      return true;
    }

    const power = this.mode === "power";
    const rate = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const toneBank = power ? this.tone.power : this.tone.adaptive;

    const settings = power
      ? {
          targetRmsDb: -6.5,
          maxMakeupDb: 8.3,
          ceiling: 0.90,
          gainAttackMs: 220,
          gainReleaseMs: 560,
          limiterReleaseFastMs: 34,
          limiterReleaseBassMs: 120,
          bands: {
            low:  { thresholdDb: -20, ratio: 2.35, attackMs: 22, releaseMs: 190, wet: 0.48, makeupDb: 1.9 },
            mid:  { thresholdDb: -24, ratio: 3.60, attackMs: 9,  releaseMs: 115, wet: 0.78, makeupDb: 2.0 },
            high: { thresholdDb: -21, ratio: 2.00, attackMs: 4,  releaseMs: 85,  wet: 0.30, makeupDb: 0.35 },
          },
        }
      : {
          targetRmsDb: -11.5,
          maxMakeupDb: 3.6,
          ceiling: 0.91,
          gainAttackMs: 320,
          gainReleaseMs: 760,
          limiterReleaseFastMs: 65,
          limiterReleaseBassMs: 165,
          bands: {
            low:  { thresholdDb: -17, ratio: 1.65, attackMs: 26, releaseMs: 210, wet: 0.30, makeupDb: 0.8 },
            mid:  { thresholdDb: -19, ratio: 1.85, attackMs: 12, releaseMs: 145, wet: 0.42, makeupDb: 0.9 },
            high: { thresholdDb: -18, ratio: 1.45, attackMs: 6,  releaseMs: 110, wet: 0.18, makeupDb: 0.25 },
          },
        };

    const rmsCoeff = Math.exp(-1 / (rate * 0.600));
    const peakAttack = 1 - Math.exp(-1 / (rate * 0.001));
    const peakRelease = 1 - Math.exp(-1 / (rate * 0.220));
    const gainAttack = 1 - Math.exp(-1 / (rate * settings.gainAttackMs / 1000));
    const gainRelease = 1 - Math.exp(-1 / (rate * settings.gainReleaseMs / 1000));
    const maxMakeup = MvpSoundModesProcessor.dbToGain(settings.maxMakeupDb);

    for (let frame = 0; frame < frames; frame += 1) {
      const inputLeft = input[0]?.[frame] ?? 0;
      const inputRight = input[1]?.[frame] ?? inputLeft;
      const inputPeak = Math.max(Math.abs(inputLeft), Math.abs(inputRight));
      const inputSq = (inputLeft * inputLeft + inputRight * inputRight) * 0.5;

      this.programRmsSq = rmsCoeff * this.programRmsSq + (1 - rmsCoeff) * inputSq;
      const peakCoeff = inputPeak > this.programPeak ? peakAttack : peakRelease;
      this.programPeak += (inputPeak - this.programPeak) * peakCoeff;

      const programRms = Math.sqrt(Math.max(1e-12, this.programRmsSq));
      const density = MvpSoundModesProcessor.clamp(
        programRms / Math.max(this.programPeak, 1e-6),
        0,
        1,
      );
      const denseGuard = MvpSoundModesProcessor.clamp((density - 0.22) / 0.30, 0, 1);
      const wetScale = 1 - denseGuard * (power ? 0.70 : 0.55);

      const [lowL, highRestL] = this.splitSample(this.lowSplit, 0, inputLeft);
      const [lowR, highRestR] = this.splitSample(this.lowSplit, 1, inputRight);
      const [midL, highL] = this.splitSample(this.highSplit, 0, highRestL);
      const [midR, highR] = this.splitSample(this.highSplit, 1, highRestR);

      const [lowOutL, lowOutR] = this.compressBand("low", lowL, lowR, settings.bands.low, rate, 0.35 + 0.65 * wetScale);
      const [midOutL, midOutR] = this.compressBand("mid", midL, midR, settings.bands.mid, rate, wetScale);
      const [highOutL, highOutR] = this.compressBand("high", highL, highR, settings.bands.high, rate, wetScale);

      let left = lowOutL + midOutL + highOutL;
      let right = lowOutR + midOutR + highOutR;

      // Tonal shaping is deliberately bottom/body weighted. R10 does NOT use
      // a large presence/air shelf to fake loudness.
      left = this.processTone(toneBank, 0, left);
      right = this.processTone(toneBank, 1, right);

      const processedSq = (left * left + right * right) * 0.5;
      this.processedRmsSq = rmsCoeff * this.processedRmsSq + (1 - rmsCoeff) * processedSq;
      const processedRms = Math.sqrt(Math.max(1e-12, this.processedRmsSq));
      const processedRmsDb = MvpSoundModesProcessor.gainToDb(processedRms);
      const targetMakeup = MvpSoundModesProcessor.dbToGain(settings.targetRmsDb - processedRmsDb);
      const desiredMakeup = MvpSoundModesProcessor.clamp(targetMakeup, 1, maxMakeup);

      const gainCoeff = desiredMakeup < this.programGain ? gainAttack : gainRelease;
      this.programGain += (desiredMakeup - this.programGain) * gainCoeff;

      left *= this.programGain;
      right *= this.programGain;

      const truePeak = Math.max(this.truePeak4x(this.tpL, left), this.truePeak4x(this.tpR, right));
      this.pushPeak(truePeak, this.sampleCounter);
      this.sampleCounter += 1;

      const futurePeak = this.maxFuturePeak();
      const requiredLimiter = futurePeak > settings.ceiling
        ? settings.ceiling / Math.max(futurePeak, 1e-12)
        : 1;

      if (requiredLimiter < this.limiterGain) {
        this.limiterGain = requiredLimiter;
      } else {
        const totalBandEnergy =
          lowOutL * lowOutL + lowOutR * lowOutR +
          midOutL * midOutL + midOutR * midOutR +
          highOutL * highOutL + highOutR * highOutR + 1e-12;
        const lowBandEnergy = lowOutL * lowOutL + lowOutR * lowOutR;
        const bassShare = MvpSoundModesProcessor.clamp(lowBandEnergy / totalBandEnergy, 0, 1);
        const limiterReleaseMs =
          settings.limiterReleaseFastMs +
          (settings.limiterReleaseBassMs - settings.limiterReleaseFastMs) * bassShare;
        const limiterRelease = 1 - Math.exp(-1 / (rate * limiterReleaseMs / 1000));
        this.limiterGain += (1 - this.limiterGain) * limiterRelease;
      }
      this.limiterGain = MvpSoundModesProcessor.clamp(this.limiterGain, 0.18, 1);

      const delayedLeft = this.lookL[this.lookIndex];
      const delayedRight = this.lookR[this.lookIndex];
      this.lookL[this.lookIndex] = left;
      this.lookR[this.lookIndex] = right;
      this.lookIndex += 1;
      if (this.lookIndex >= this.lookaheadFrames) this.lookIndex = 0;

      const outputLeft = MvpSoundModesProcessor.clamp(delayedLeft * this.limiterGain, -settings.ceiling, settings.ceiling);
      const outputRight = MvpSoundModesProcessor.clamp(delayedRight * this.limiterGain, -settings.ceiling, settings.ceiling);
      const limiterReductionDb = Math.max(0, -MvpSoundModesProcessor.gainToDb(this.limiterGain));
      this.limiterMaxReductionDb = Math.max(this.limiterMaxReductionDb, limiterReductionDb);

      if (output[0]) output[0][frame] = outputLeft;
      if (output[1]) output[1][frame] = outputRight;
      for (let channel = 2; channel < output.length; channel += 1) {
        const target = output[channel];
        if (!target) continue;
        target[frame] = channel % 2 === 0 ? outputLeft : outputRight;
      }

      this.addTelemetry(inputLeft, inputRight, outputLeft, outputRight, limiterReductionDb);
    }

    this.confirmModeIfAudible(input, frames);
    return true;
  }
}

MvpSoundModesProcessor.TRUE_PEAK_TAPS = [
  [0.0000000000,0.0006967276,-0.0036114518,0.0106894409,-0.0243920034,0.0473988787,-0.0853522687,0.1749621972,0.9271834644,-0.0558089374,0.0065336228,0.0051465217,-0.0059139618,0.0036139880,-0.0014253083,0.0002466871],
  [-0.0000259944,0.0009306425,-0.0045142792,0.0140661965,-0.0349789143,0.0763806998,-0.1630375417,0.4750888740,0.7567609472,-0.1677299103,0.0663150886,-0.0261387989,0.0088488163,-0.0022472932,0.0003169478,-0.0000030777],
  [-0.0000030777,0.0003169478,-0.0022472932,0.0088488163,-0.0261387989,0.0663150886,-0.1677299103,0.7567609472,0.4750888740,-0.1630375417,0.0763806998,-0.0349789143,0.0140661965,-0.0045142792,0.0009306425,-0.0000259944],
  [0.0002466871,-0.0014253083,0.0036139880,-0.0059139618,0.0051465217,0.0065336228,-0.0558089374,0.9271834644,0.1749621972,-0.0853522687,0.0473988787,-0.0243920034,0.0106894409,-0.0036114518,0.0006967276,0.0000000000],
];

registerProcessor("mvp-sound-modes", MvpSoundModesProcessor);
