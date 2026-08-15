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

    const alphaCross = 1 - Math.exp(-2 * Math.PI * 1350 / sampleRate);
    const alphaBass = 1 - Math.exp(-2 * Math.PI * 165 / sampleRate);
    const envAttack = 1 - Math.exp(-1 / (sampleRate * 0.008));
    const envRelease = 1 - Math.exp(-1 / (sampleRate * 0.082));
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

      // Read before writing so every tap is a true delay.
      const proofL = this.read(this.delayL, Math.max(1, Math.round(sampleRate * 0.017)));
      const proofR = this.read(this.delayR, Math.max(1, Math.round(sampleRate * 0.011)));

      let crossDelayMs = 0.28 + crossfeed * 0.95;
      if (mode === 3) crossDelayMs += 0.18;
      const crossDelaySamples = Math.max(1, Math.min(this.crossDelayL.length - 1, Math.round(sampleRate * crossDelayMs / 1000)));
      const delayedCrossL = this.read(this.crossDelayL, crossDelaySamples);
      const delayedCrossR = this.read(this.crossDelayR, crossDelaySamples);

      let depthDelayMsL = 3.4 + depth * 7.6;
      let depthDelayMsR = 6.6 + depth * 10.8;
      if (mode === 3) {
        depthDelayMsL += 1.4;
        depthDelayMsR += 2.8;
      } else if (mode === 1) {
        depthDelayMsL *= 0.62;
        depthDelayMsR *= 0.62;
      } else if (mode === 4) {
        depthDelayMsL *= 0.35;
        depthDelayMsR *= 0.35;
      }
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
        // Deliberately exaggerated verification signal. This is meant to sound unmistakably
        // different, not pretty, so a user can prove the headphone worklet is truly audible.
        const proofOutL = left * 0.56 + proofR * 0.78 - right * 0.14;
        const proofOutR = right * 0.56 - proofL * 0.78 + left * 0.14;
        outL[i] = proofOutL * 0.78;
        outR[i] = proofOutR * 0.78;
        this.writeIndex += 1;
        if (this.writeIndex >= this.delayL.length) this.writeIndex = 0;
        continue;
      }

      const mid = (left + right) * 0.5;
      const side = (left - right) * 0.5;
      const sideLow = (this.bassLpL - this.bassLpR) * 0.5;
      const sideHigh = side - sideLow;

      let sideScale;
      if (mode === 4) sideScale = 0.38 + width * 0.22;
      else {
        const modeLift = mode === 1 ? 0.28 : mode === 2 ? 0.22 : mode === 3 ? 0.08 : 0;
        sideScale = 1 + width * 1.45 + modeLift;
      }
      const bassSideScale = mode === 4 ? 0.62 : 0.88 + width * 0.10;
      const widenedSide = sideHigh * sideScale + sideLow * bassSideScale;

      let centerScale = 1 + (center - 0.5) * 0.55;
      if (mode === 4) centerScale += 0.24;
      if (mode === 3) centerScale += 0.08;

      let depthCharacter = mode === 2 ? 1.15 : mode === 3 ? 1.05 : mode === 1 ? 0.42 : mode === 4 ? 0.16 : 0.34;
      const depthMix = depth * 0.48 * depthCharacter;
      let crossCharacter = mode === 3 ? 1.2 : mode === 2 ? 0.82 : mode === 1 ? 0.30 : mode === 4 ? 0.76 : 0.55;
      const crossMix = crossfeed * 0.38 * crossCharacter;

      let processedL = mid * centerScale + widenedSide;
      let processedR = mid * centerScale - widenedSide;

      // Frequency-shaped crossfeed creates speaker-like blending without smearing the bass.
      processedL += delayedCrossR * crossMix;
      processedR += delayedCrossL * crossMix;

      // Asymmetric high-frequency ambience taps add a real depth cue rather than only scaling M/S.
      processedL += (delayedHighR * 0.72 - delayedHighL * 0.16) * depthMix;
      processedR += (delayedHighL * 0.72 - delayedHighR * 0.16) * depthMix;

      const transientL = Math.max(0, absBassL - this.bassEnvL * 0.70);
      const transientR = Math.max(0, absBassR - this.bassEnvR * 0.70);
      const bassDrive = bassImpact * (mode === 5 ? 0.72 : 0.54);
      const bassPunchL = this.bassLpL * bassImpact * 0.10 + Math.sign(this.bassLpL) * transientL * bassDrive;
      const bassPunchR = this.bassLpR * bassImpact * 0.10 + Math.sign(this.bassLpR) * transientR * bassDrive;
      processedL += bassPunchL;
      processedR += bassPunchR;

      const widthCost = Math.max(0, sideScale - 1) * 0.23;
      const compensation = 1 / Math.max(1, 1 + widthCost + depthMix * 0.28 + crossMix * 0.16 + bassImpact * 0.07);
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
