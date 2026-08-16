class MvpTransientProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "enabled", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "amount", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.fastEnv = 0;
    this.slowEnv = 0;
    this.lowL = 0;
    this.lowR = 0;
  }

  param(parameters, name, index) {
    const values = parameters[name];
    if (!values || values.length === 0) return 0;
    return values.length === 1 ? values[0] : values[index];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    if (!inL || !outL) return true;

    const fastAttack = 1 - Math.exp(-1 / (sampleRate * 0.0018));
    const fastRelease = 1 - Math.exp(-1 / (sampleRate * 0.028));
    const slowAttack = 1 - Math.exp(-1 / (sampleRate * 0.018));
    const slowRelease = 1 - Math.exp(-1 / (sampleRate * 0.115));
    const lowAlpha = 1 - Math.exp(-2 * Math.PI * 170 / sampleRate);

    for (let i = 0; i < outL.length; i += 1) {
      const left = inL[i] || 0;
      const right = inR ? inR[i] || 0 : left;
      const enabled = this.param(parameters, "enabled", i) >= 0.5;
      const amount = this.param(parameters, "amount", i);
      if (!enabled || amount <= 0.0001) {
        outL[i] = left;
        outR[i] = right;
        continue;
      }

      const detector = Math.max(Math.abs(left), Math.abs(right));
      this.fastEnv += (detector > this.fastEnv ? fastAttack : fastRelease) * (detector - this.fastEnv);
      this.slowEnv += (detector > this.slowEnv ? slowAttack : slowRelease) * (detector - this.slowEnv);
      const transientRatio = Math.max(0, Math.min(1, (this.fastEnv - this.slowEnv) / Math.max(0.035, this.slowEnv + 0.02)));
      const transientGain = 1 + transientRatio * amount * 0.28;

      this.lowL += lowAlpha * (left - this.lowL);
      this.lowR += lowAlpha * (right - this.lowR);
      const highL = left - this.lowL;
      const highR = right - this.lowR;
      const lowGain = 1 + (transientGain - 1) * 0.26;
      const highGain = 1 + (transientGain - 1) * 0.92;
      outL[i] = this.lowL * lowGain + highL * highGain;
      outR[i] = this.lowR * lowGain + highR * highGain;
    }
    return true;
  }
}

class MvpLinearPhaseEqProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "enabled", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.coefficients = new Float32Array([1]);
    this.bufferL = new Float32Array(1);
    this.bufferR = new Float32Array(1);
    this.index = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data || data.type !== "coefficients" || !Array.isArray(data.coefficients) || data.coefficients.length < 1) return;
      const coefficients = Float32Array.from(data.coefficients.map((value) => Number(value) || 0));
      this.coefficients = coefficients;
      this.bufferL = new Float32Array(coefficients.length);
      this.bufferR = new Float32Array(coefficients.length);
      this.index = 0;
    };
  }

  param(parameters, name, index) {
    const values = parameters[name];
    if (!values || values.length === 0) return 0;
    return values.length === 1 ? values[0] : values[index];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    if (!inL || !outL) return true;

    const coefficients = this.coefficients;
    const taps = coefficients.length;
    for (let i = 0; i < outL.length; i += 1) {
      const left = inL[i] || 0;
      const right = inR ? inR[i] || 0 : left;
      const enabled = this.param(parameters, "enabled", i) >= 0.5;
      if (!enabled || taps === 1) {
        outL[i] = left;
        outR[i] = right;
        continue;
      }

      this.bufferL[this.index] = left;
      this.bufferR[this.index] = right;
      let sumL = 0;
      let sumR = 0;
      let read = this.index;
      for (let tap = 0; tap < taps; tap += 1) {
        const coefficient = coefficients[tap];
        sumL += this.bufferL[read] * coefficient;
        sumR += this.bufferR[read] * coefficient;
        read -= 1;
        if (read < 0) read = taps - 1;
      }
      outL[i] = sumL;
      outR[i] = sumR;
      this.index += 1;
      if (this.index >= taps) this.index = 0;
    }
    return true;
  }
}

class MvpHeadphoneProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "enabled", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "mode", defaultValue: 0, minValue: 0, maxValue: 5, automationRate: "k-rate" },
      { name: "proof", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "width", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "depth", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "crossfeed", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "center", defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "bassImpact", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    const maxDelay = Math.max(1024, Math.ceil(sampleRate * 0.032));
    this.delayL = new Float32Array(maxDelay);
    this.delayR = new Float32Array(maxDelay);
    this.crossDelayL = new Float32Array(maxDelay);
    this.crossDelayR = new Float32Array(maxDelay);
    this.highDelayL = new Float32Array(maxDelay);
    this.highDelayR = new Float32Array(maxDelay);
    this.writeIndex = 0;
    this.crossLpL = 0;
    this.crossLpR = 0;
    this.bassLpL = 0;
    this.bassLpR = 0;
    this.bassEnvL = 0;
    this.bassEnvR = 0;
  }

  param(parameters, name, index) {
    const values = parameters[name];
    if (!values || values.length === 0) return 0;
    return values.length === 1 ? values[0] : values[index];
  }

  read(buffer, delaySamples) {
    const readIndex = (this.writeIndex - delaySamples + buffer.length) % buffer.length;
    return buffer[readIndex];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    if (!inL || !outL) return true;

    const alphaCross = 1 - Math.exp(-2 * Math.PI * 1450 / sampleRate);
    const alphaBass = 1 - Math.exp(-2 * Math.PI * 155 / sampleRate);
    const envAttack = 1 - Math.exp(-1 / (sampleRate * 0.006));
    const envRelease = 1 - Math.exp(-1 / (sampleRate * 0.085));

    for (let i = 0; i < outL.length; i += 1) {
      const left = inL[i] || 0;
      const right = inR ? inR[i] || 0 : left;
      const enabled = this.param(parameters, "enabled", i) >= 0.5;
      if (!enabled) {
        outL[i] = left;
        outR[i] = right;
        continue;
      }

      const mode = Math.round(this.param(parameters, "mode", i));
      const proof = this.param(parameters, "proof", i) >= 0.5;
      const width = this.param(parameters, "width", i);
      const depth = this.param(parameters, "depth", i);
      const crossfeed = this.param(parameters, "crossfeed", i);
      const center = this.param(parameters, "center", i);
      const bassImpact = this.param(parameters, "bassImpact", i);

      this.crossLpL += alphaCross * (left - this.crossLpL);
      this.crossLpR += alphaCross * (right - this.crossLpR);
      this.bassLpL += alphaBass * (left - this.bassLpL);
      this.bassLpR += alphaBass * (right - this.bassLpR);

      const highL = left - this.bassLpL;
      const highR = right - this.bassLpR;
      const absBassL = Math.abs(this.bassLpL);
      const absBassR = Math.abs(this.bassLpR);
      this.bassEnvL += (absBassL > this.bassEnvL ? envAttack : envRelease) * (absBassL - this.bassEnvL);
      this.bassEnvR += (absBassR > this.bassEnvR ? envAttack : envRelease) * (absBassR - this.bassEnvR);

      const proofL = this.read(this.delayL, Math.max(1, Math.round(sampleRate * 0.017)));
      const proofR = this.read(this.delayR, Math.max(1, Math.round(sampleRate * 0.011)));
      let crossDelayMs = 0.30 + crossfeed * 0.85;
      if (mode === 3) crossDelayMs += 0.16;
      const crossDelaySamples = Math.max(1, Math.min(this.crossDelayL.length - 1, Math.round(sampleRate * crossDelayMs / 1000)));
      const delayedCrossL = this.read(this.crossDelayL, crossDelaySamples);
      const delayedCrossR = this.read(this.crossDelayR, crossDelaySamples);

      let depthDelayMsL = 3.0 + depth * 7.2;
      let depthDelayMsR = 5.4 + depth * 9.6;
      if (mode === 3) { depthDelayMsL += 1.2; depthDelayMsR += 2.4; }
      else if (mode === 1) { depthDelayMsL *= 0.55; depthDelayMsR *= 0.55; }
      else if (mode === 4) { depthDelayMsL *= 0.28; depthDelayMsR *= 0.28; }
      const depthDelaySamplesL = Math.max(1, Math.min(this.highDelayL.length - 1, Math.round(sampleRate * depthDelayMsL / 1000)));
      const depthDelaySamplesR = Math.max(1, Math.min(this.highDelayR.length - 1, Math.round(sampleRate * depthDelayMsR / 1000)));
      const delayedHighL = this.read(this.highDelayL, depthDelaySamplesL);
      const delayedHighR = this.read(this.highDelayR, depthDelaySamplesR);

      this.delayL[this.writeIndex] = left;
      this.delayR[this.writeIndex] = right;
      this.crossDelayL[this.writeIndex] = this.crossLpL;
      this.crossDelayR[this.writeIndex] = this.crossLpR;
      this.highDelayL[this.writeIndex] = highL;
      this.highDelayR[this.writeIndex] = highR;

      if (proof) {
        outL[i] = (left * 0.52 + proofR * 0.86 - right * 0.16) * 0.76;
        outR[i] = (right * 0.52 - proofL * 0.86 + left * 0.16) * 0.76;
        this.writeIndex = (this.writeIndex + 1) % this.delayL.length;
        continue;
      }

      const mid = (left + right) * 0.5;
      const side = (left - right) * 0.5;
      const sideLow = (this.bassLpL - this.bassLpR) * 0.5;
      const sideHigh = side - sideLow;
      const sideScale = mode === 4 ? 0.45 + width * 0.18 : 1 + width * (mode === 1 ? 1.25 : mode === 2 ? 1.05 : mode === 3 ? 0.72 : 0.62);
      const bassSideScale = mode === 4 ? 0.58 : 0.88 + width * 0.08;
      const widenedSide = sideHigh * sideScale + sideLow * bassSideScale;

      let centerScale = 1 + (center - 0.5) * 0.48;
      if (mode === 4) centerScale += 0.28;
      if (mode === 3) centerScale += 0.06;
      const depthCharacter = mode === 2 ? 1.0 : mode === 3 ? 0.88 : mode === 1 ? 0.28 : mode === 4 ? 0.10 : 0.30;
      const depthMix = depth * 0.36 * depthCharacter;
      const crossCharacter = mode === 3 ? 1.0 : mode === 2 ? 0.78 : mode === 1 ? 0.22 : mode === 4 ? 0.72 : 0.5;
      const crossMix = crossfeed * 0.30 * crossCharacter;

      let processedL = mid * centerScale + widenedSide;
      let processedR = mid * centerScale - widenedSide;
      processedL += delayedCrossR * crossMix;
      processedR += delayedCrossL * crossMix;
      processedL += (delayedHighR * 0.66 - delayedHighL * 0.14) * depthMix;
      processedR += (delayedHighL * 0.66 - delayedHighR * 0.14) * depthMix;

      const transientL = Math.max(0, absBassL - this.bassEnvL * 0.72);
      const transientR = Math.max(0, absBassR - this.bassEnvR * 0.72);
      const bassDrive = bassImpact * (mode === 5 ? 0.58 : 0.42);
      processedL += this.bassLpL * bassImpact * 0.065 + Math.sign(this.bassLpL) * transientL * bassDrive;
      processedR += this.bassLpR * bassImpact * 0.065 + Math.sign(this.bassLpR) * transientR * bassDrive;

      const compensation = 1 / Math.max(1, 1 + Math.max(0, sideScale - 1) * 0.17 + depthMix * 0.20 + crossMix * 0.12 + bassImpact * 0.045);
      outL[i] = processedL * compensation;
      outR[i] = processedR * compensation;
      this.writeIndex = (this.writeIndex + 1) % this.delayL.length;
    }
    return true;
  }
}

class MvpLookaheadLimiterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "enabled", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "ceilingDb", defaultValue: -1.0, minValue: -6, maxValue: 0, automationRate: "k-rate" },
      { name: "releaseMs", defaultValue: 98, minValue: 25, maxValue: 400, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.lookaheadSamples = Math.max(32, Math.round(sampleRate * 0.0055));
    this.bufferL = new Float32Array(this.lookaheadSamples + 1);
    this.bufferR = new Float32Array(this.lookaheadSamples + 1);
    this.index = 0;
    this.gain = 1;
    this.previousL = 0;
    this.previousR = 0;
  }

  param(parameters, name, index) {
    const values = parameters[name];
    if (!values || values.length === 0) return 0;
    return values.length === 1 ? values[0] : values[index];
  }

  cubicInterpolate(previous, current, next, next2, t) {
    const a0 = -0.5 * previous + 1.5 * current - 1.5 * next + 0.5 * next2;
    const a1 = previous - 2.5 * current + 2 * next - 0.5 * next2;
    const a2 = -0.5 * previous + 0.5 * next;
    return ((a0 * t + a1) * t + a2) * t + current;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    if (!inL || !outL) return true;

    for (let i = 0; i < outL.length; i += 1) {
      const left = inL[i] || 0;
      const right = inR ? inR[i] || 0 : left;
      const nextL = i + 1 < inL.length ? inL[i + 1] || 0 : left;
      const nextR = inR && i + 1 < inR.length ? inR[i + 1] || 0 : right;
      const next2L = i + 2 < inL.length ? inL[i + 2] || 0 : nextL;
      const next2R = inR && i + 2 < inR.length ? inR[i + 2] || 0 : nextR;
      const enabled = this.param(parameters, "enabled", i) >= 0.5;
      const ceiling = Math.pow(10, this.param(parameters, "ceilingDb", i) / 20);
      const releaseMs = Math.max(25, this.param(parameters, "releaseMs", i));
      const releaseCoeff = Math.exp(-1 / (sampleRate * releaseMs / 1000));

      const delayedL = this.bufferL[this.index];
      const delayedR = this.bufferR[this.index];
      this.bufferL[this.index] = left;
      this.bufferR[this.index] = right;
      this.index = (this.index + 1) % this.bufferL.length;

      if (!enabled) {
        this.gain = 1;
        outL[i] = left;
        outR[i] = right;
        this.previousL = left;
        this.previousR = right;
        continue;
      }

      // Four-times oversampled inter-sample peak estimate. The detector checks the native
      // sample plus three sub-sample reconstruction points before the delayed sample reaches output.
      let peak = Math.max(Math.abs(left), Math.abs(right), 1e-9);
      for (let phase = 1; phase < 4; phase += 1) {
        const t = phase / 4;
        const interpL = this.cubicInterpolate(this.previousL, left, nextL, next2L, t);
        const interpR = this.cubicInterpolate(this.previousR, right, nextR, next2R, t);
        peak = Math.max(peak, Math.abs(interpL), Math.abs(interpR));
      }
      const target = peak > ceiling ? ceiling / peak : 1;
      if (target < this.gain) this.gain = target;
      else this.gain = 1 - (1 - this.gain) * releaseCoeff;

      const limitedL = delayedL * this.gain;
      const limitedR = delayedR * this.gain;
      // Final sample-domain safety net. The gain computer is driven by the 4x detector;
      // these clamps should only engage on pathological reconstruction/automation edges.
      outL[i] = Math.max(-ceiling, Math.min(ceiling, limitedL));
      outR[i] = Math.max(-ceiling, Math.min(ceiling, limitedR));
      this.previousL = left;
      this.previousR = right;
    }
    return true;
  }
}

class MvpBiquad {
  constructor(type, frequency, q = 0.70710678, gainDb = 0) {
    this.type = type;
    this.frequency = frequency;
    this.q = q;
    this.gainDb = gainDb;
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
    this.update();
  }

  update() {
    const frequency = Math.max(10, Math.min(sampleRate * 0.45, this.frequency));
    const omega = 2 * Math.PI * frequency / sampleRate;
    const cos = Math.cos(omega);
    const sin = Math.sin(omega);
    const q = Math.max(0.05, this.q);
    const alpha = sin / (2 * q);
    let b0 = 1;
    let b1 = 0;
    let b2 = 0;
    let a0 = 1;
    let a1 = 0;
    let a2 = 0;

    if (this.type === "lowpass") {
      b0 = (1 - cos) * 0.5;
      b1 = 1 - cos;
      b2 = (1 - cos) * 0.5;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (this.type === "highpass") {
      b0 = (1 + cos) * 0.5;
      b1 = -(1 + cos);
      b2 = (1 + cos) * 0.5;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (this.type === "highshelf") {
      const A = Math.pow(10, this.gainDb / 40);
      const beta = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cos + beta);
      b1 = -2 * A * ((A - 1) + (A + 1) * cos);
      b2 = A * ((A + 1) + (A - 1) * cos - beta);
      a0 = (A + 1) - (A - 1) * cos + beta;
      a1 = 2 * ((A - 1) - (A + 1) * cos);
      a2 = (A + 1) - (A - 1) * cos - beta;
    }

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(input) {
    const output = this.b0 * input + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = input;
    this.y2 = this.y1;
    this.y1 = output;
    return output;
  }

  reset() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

class MvpMultibandProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "enabled", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "amount", defaultValue: 0.34, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.crossovers = [120, 500, 4000];
    this.filters = [0, 1].map(() => ({
      low120a: new MvpBiquad("lowpass", 120),
      low120b: new MvpBiquad("lowpass", 120),
      low500a: new MvpBiquad("lowpass", 500),
      low500b: new MvpBiquad("lowpass", 500),
      low4000a: new MvpBiquad("lowpass", 4000),
      low4000b: new MvpBiquad("lowpass", 4000),
    }));
    this.bandGain = new Float64Array([1, 1, 1, 1]);
    this.bandEnvelope = new Float64Array(4);
  }

  param(parameters, name, index) {
    const values = parameters[name];
    if (!values || values.length === 0) return 0;
    return values.length === 1 ? values[0] : values[index];
  }

  split(channel, sample) {
    const f = this.filters[channel];
    // Perfect-reconstruction telescoping crossover. With all band gains at unity:
    // low + (low500-low120) + (low4000-low500) + (input-low4000) === input.
    // This keeps the multiband stage tonally transparent until gain reduction occurs.
    const low120 = f.low120b.process(f.low120a.process(sample));
    const low500 = f.low500b.process(f.low500a.process(sample));
    const low4000 = f.low4000b.process(f.low4000a.process(sample));
    return [
      low120,
      low500 - low120,
      low4000 - low500,
      sample - low4000,
    ];
  }

  compressorGain(band, detector, amount) {
    const thresholds = [-14.0, -17.0, -16.0, -14.5];
    const ratios = [1.55, 1.42, 1.48, 1.36];
    const attacks = [0.030, 0.020, 0.010, 0.006];
    const releases = [0.220, 0.170, 0.125, 0.095];
    const levelDb = 20 * Math.log10(Math.max(1e-7, detector));
    const ratio = 1 + (ratios[band] - 1) * amount;
    let reductionDb = 0;
    if (levelDb > thresholds[band] && ratio > 1.0001) {
      const compressedDb = thresholds[band] + (levelDb - thresholds[band]) / ratio;
      reductionDb = compressedDb - levelDb;
    }
    const target = Math.pow(10, reductionDb / 20);
    const time = target < this.bandGain[band] ? attacks[band] : releases[band];
    const coeff = Math.exp(-1 / Math.max(1, sampleRate * time));
    this.bandGain[band] = target + coeff * (this.bandGain[band] - target);
    return this.bandGain[band];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    if (!inL || !outL) return true;

    for (let i = 0; i < outL.length; i += 1) {
      const left = inL[i] || 0;
      const right = inR ? inR[i] || 0 : left;
      const enabled = this.param(parameters, "enabled", i) >= 0.5;
      const amount = Math.max(0, Math.min(1, this.param(parameters, "amount", i)));
      if (!enabled || amount <= 0.0001) {
        // Keep crossover state warm so toggling the stage does not create a stale-filter transient.
        this.split(0, left);
        this.split(1, right);
        this.bandGain[0] = 1;
        this.bandGain[1] = 1;
        this.bandGain[2] = 1;
        this.bandGain[3] = 1;
        outL[i] = left;
        outR[i] = right;
        continue;
      }

      const bandsL = this.split(0, left);
      const bandsR = this.split(1, right);
      let sumL = 0;
      let sumR = 0;
      for (let band = 0; band < 4; band += 1) {
        const detector = Math.max(Math.abs(bandsL[band]), Math.abs(bandsR[band]));
        const gain = this.compressorGain(band, detector, amount);
        sumL += bandsL[band] * gain;
        sumR += bandsR[band] * gain;
      }
      outL[i] = sumL;
      outR[i] = sumR;
    }
    return true;
  }
}

class MvpLoudnessNormalizerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "enabled", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "targetLufs", defaultValue: -14, minValue: -20, maxValue: -9, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.kShelfL = new MvpBiquad("highshelf", 1681.974, 0.707, 4.0);
    this.kShelfR = new MvpBiquad("highshelf", 1681.974, 0.707, 4.0);
    this.kHighL = new MvpBiquad("highpass", 38.135, 0.5);
    this.kHighR = new MvpBiquad("highpass", 38.135, 0.5);
    this.meanSquare = 0;
    this.gain = 1;
    this.samplesSeen = 0;
    this.reportCounter = 0;
    this.lastLufs = -70;
    this.port.onmessage = (event) => {
      if (event.data?.type === "reset") this.reset();
    };
  }

  reset() {
    this.kShelfL.reset();
    this.kShelfR.reset();
    this.kHighL.reset();
    this.kHighR.reset();
    this.meanSquare = 0;
    this.gain = 1;
    this.samplesSeen = 0;
    this.lastLufs = -70;
  }

  param(parameters, name, index) {
    const values = parameters[name];
    if (!values || values.length === 0) return 0;
    return values.length === 1 ? values[0] : values[index];
  }

  process(inputs, outputs, parameters) {
    const signal = inputs[0];
    const detectorInput = inputs[1] && inputs[1][0] ? inputs[1] : signal;
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const inL = signal[0];
    const inR = signal[1] || signal[0];
    const detL = detectorInput[0];
    const detR = detectorInput[1] || detectorInput[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    if (!inL || !outL) return true;

    const energyCoeff = 1 - Math.exp(-1 / (sampleRate * 3.0));
    for (let i = 0; i < outL.length; i += 1) {
      const left = inL[i] || 0;
      const right = inR ? inR[i] || 0 : left;
      const dLeft = detL ? detL[i] || 0 : left;
      const dRight = detR ? detR[i] || 0 : dLeft;
      const enabled = this.param(parameters, "enabled", i) >= 0.5;
      const targetLufs = this.param(parameters, "targetLufs", i);

      if (!enabled) {
        this.gain += (1 - this.gain) * 0.0008;
        outL[i] = left;
        outR[i] = right;
        continue;
      }

      const weightedL = this.kHighL.process(this.kShelfL.process(dLeft));
      const weightedR = this.kHighR.process(this.kShelfR.process(dRight));
      const energy = 0.5 * (weightedL * weightedL + weightedR * weightedR);
      this.meanSquare += energyCoeff * (energy - this.meanSquare);
      this.samplesSeen += 1;

      const lufs = -0.691 + 10 * Math.log10(Math.max(1e-12, this.meanSquare));
      this.lastLufs = lufs;
      let targetGainDb = 0;
      if (this.samplesSeen > sampleRate * 0.75 && lufs > -55) {
        targetGainDb = Math.max(-8, Math.min(6, targetLufs - lufs));
      }
      const targetGain = Math.pow(10, targetGainDb / 20);
      const tau = targetGain < this.gain ? 1.8 : 7.5;
      const gainCoeff = 1 - Math.exp(-1 / (sampleRate * tau));
      this.gain += gainCoeff * (targetGain - this.gain);

      outL[i] = left * this.gain;
      outR[i] = right * this.gain;
    }

    this.reportCounter += outL.length;
    if (this.reportCounter >= sampleRate * 1.0) {
      this.reportCounter = 0;
      this.port.postMessage({
        type: "telemetry",
        gainDb: 20 * Math.log10(Math.max(1e-6, this.gain)),
        lufs: this.lastLufs,
      });
    }
    return true;
  }
}


registerProcessor("mvp-transient-processor", MvpTransientProcessor);
registerProcessor("mvp-linear-phase-eq", MvpLinearPhaseEqProcessor);
registerProcessor("mvp-headphone-processor", MvpHeadphoneProcessor);
registerProcessor("mvp-lookahead-limiter", MvpLookaheadLimiterProcessor);
registerProcessor("mvp-multiband-processor", MvpMultibandProcessor);
registerProcessor("mvp-loudness-normalizer", MvpLoudnessNormalizerProcessor);
