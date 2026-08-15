class MvpHeadphoneProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "enabled", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "width", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "depth", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "crossfeed", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "center", defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "bassImpact", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    const maxDelay = Math.max(512, Math.ceil(sampleRate * 0.018));
    this.delayL = new Float32Array(maxDelay);
    this.delayR = new Float32Array(maxDelay);
    this.delaySide = new Float32Array(maxDelay);
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

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    if (!inL || !outL) return true;

    const alphaCross = 1 - Math.exp(-2 * Math.PI * 1250 / sampleRate);
    const alphaBass = 1 - Math.exp(-2 * Math.PI * 135 / sampleRate);
    const envAttack = 1 - Math.exp(-1 / (sampleRate * 0.010));
    const envRelease = 1 - Math.exp(-1 / (sampleRate * 0.095));
    const length = outL.length;

    for (let i = 0; i < length; i += 1) {
      const left = inL[i] || 0;
      const right = inR ? inR[i] || 0 : left;
      const enabled = this.param(parameters, "enabled", i) >= 0.5;

      if (!enabled) {
        outL[i] = left;
        outR[i] = right;
        continue;
      }

      const width = this.param(parameters, "width", i);
      const depth = this.param(parameters, "depth", i);
      const crossfeed = this.param(parameters, "crossfeed", i);
      const center = this.param(parameters, "center", i);
      const bassImpact = this.param(parameters, "bassImpact", i);

      this.crossLpL += alphaCross * (left - this.crossLpL);
      this.crossLpR += alphaCross * (right - this.crossLpR);
      this.bassLpL += alphaBass * (left - this.bassLpL);
      this.bassLpR += alphaBass * (right - this.bassLpR);

      const absBassL = Math.abs(this.bassLpL);
      const absBassR = Math.abs(this.bassLpR);
      this.bassEnvL += (absBassL > this.bassEnvL ? envAttack : envRelease) * (absBassL - this.bassEnvL);
      this.bassEnvR += (absBassR > this.bassEnvR ? envAttack : envRelease) * (absBassR - this.bassEnvR);

      const delayMs = 0.22 + crossfeed * 0.62;
      const crossDelaySamples = Math.max(1, Math.min(this.delayL.length - 1, Math.round(sampleRate * delayMs / 1000)));
      const depthDelayMs = 1.8 + depth * 10.8;
      const depthDelaySamples = Math.max(1, Math.min(this.delaySide.length - 1, Math.round(sampleRate * depthDelayMs / 1000)));
      const crossRead = (this.writeIndex - crossDelaySamples + this.delayL.length) % this.delayL.length;
      const depthRead = (this.writeIndex - depthDelaySamples + this.delaySide.length) % this.delaySide.length;

      const delayedCrossL = this.delayL[crossRead];
      const delayedCrossR = this.delayR[crossRead];
      const delayedSide = this.delaySide[depthRead];

      this.delayL[this.writeIndex] = this.crossLpL;
      this.delayR[this.writeIndex] = this.crossLpR;

      const mid = (left + right) * 0.5;
      const side = (left - right) * 0.5;
      this.delaySide[this.writeIndex] = side;

      const sideLow = (this.bassLpL - this.bassLpR) * 0.5;
      const sideHigh = side - sideLow;
      const widthScale = 0.96 + width * 1.02;
      const bassWidth = 0.94 + width * 0.06;
      const widenedSide = sideHigh * widthScale + sideLow * bassWidth;
      const centerScale = 0.72 + center * 0.66;
      const depthMix = depth * 0.36;
      const crossMix = crossfeed * 0.42;

      const transientL = Math.max(0, absBassL - this.bassEnvL * 0.72);
      const transientR = Math.max(0, absBassR - this.bassEnvR * 0.72);
      const bassDrive = bassImpact * 0.50;
      const bassPunchL = this.bassLpL * bassImpact * 0.12 + Math.sign(this.bassLpL) * transientL * bassDrive;
      const bassPunchR = this.bassLpR * bassImpact * 0.12 + Math.sign(this.bassLpR) * transientR * bassDrive;

      let processedL = mid * centerScale + widenedSide;
      let processedR = mid * centerScale - widenedSide;

      processedL += delayedCrossR * crossMix;
      processedR += delayedCrossL * crossMix;
      processedL += delayedSide * depthMix;
      processedR -= delayedSide * depthMix;
      processedL += bassPunchL;
      processedR += bassPunchR;

      const compensation = 1 / Math.max(1, Math.sqrt((centerScale * centerScale + widthScale * widthScale) * 0.46));
      outL[i] = processedL * compensation;
      outR[i] = processedR * compensation;

      this.writeIndex += 1;
      if (this.writeIndex >= this.delayL.length) this.writeIndex = 0;
    }
    return true;
  }
}

class MvpLookaheadLimiterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "enabled", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "ceilingDb", defaultValue: -0.7, minValue: -6, maxValue: 0, automationRate: "k-rate" },
      { name: "releaseMs", defaultValue: 90, minValue: 25, maxValue: 400, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.lookaheadSamples = Math.max(32, Math.round(sampleRate * 0.005));
    this.bufferL = new Float32Array(this.lookaheadSamples + 1);
    this.bufferR = new Float32Array(this.lookaheadSamples + 1);
    this.index = 0;
    this.gain = 1;
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

    for (let i = 0; i < outL.length; i += 1) {
      const left = inL[i] || 0;
      const right = inR ? inR[i] || 0 : left;
      const enabled = this.param(parameters, "enabled", i) >= 0.5;
      const ceiling = Math.pow(10, this.param(parameters, "ceilingDb", i) / 20);
      const releaseMs = Math.max(25, this.param(parameters, "releaseMs", i));
      const releaseCoeff = Math.exp(-1 / (sampleRate * releaseMs / 1000));

      const delayedL = this.bufferL[this.index];
      const delayedR = this.bufferR[this.index];
      this.bufferL[this.index] = left;
      this.bufferR[this.index] = right;
      this.index += 1;
      if (this.index >= this.bufferL.length) this.index = 0;

      if (!enabled) {
        this.gain = 1;
        outL[i] = left;
        outR[i] = right;
        continue;
      }

      const peak = Math.max(Math.abs(left), Math.abs(right), 1e-9);
      const target = peak > ceiling ? ceiling / peak : 1;
      if (target < this.gain) this.gain = target;
      else this.gain = 1 - (1 - this.gain) * releaseCoeff;

      const limitedL = delayedL * this.gain;
      const limitedR = delayedR * this.gain;
      outL[i] = Math.max(-ceiling, Math.min(ceiling, limitedL));
      outR[i] = Math.max(-ceiling, Math.min(ceiling, limitedR));
    }
    return true;
  }
}

registerProcessor("mvp-headphone-processor", MvpHeadphoneProcessor);
registerProcessor("mvp-lookahead-limiter", MvpLookaheadLimiterProcessor);
