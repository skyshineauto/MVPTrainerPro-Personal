// MVP Trainer Pro HD V2 - isolated AudioWorklet bridge.
// R2 diagnostic build: proves the processed PCM is the audible browser route.

class MvpHdV2Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.exports = null;
    this.maxFrames = 0;
    this.inputL = null;
    this.inputR = null;
    this.outputL = null;
    this.outputR = null;
    this.ready = false;
    this.pendingState = null;
    this.appliedRevision = 0;
    this.telemetryEnabled = false;
    this.telemetryCountdown = 0;
    this.proofMute = false;

    this.appliedState = {
      bypass: true,
      loudnessMode: 'normal',
      bass: 0,
      clarity: 0,
      punch: 0,
      wide: 0,
      eqEnabled: false,
    };

    this.inputEnergy = 0;
    this.outputEnergy = 0;
    this.energySamples = 0;
    this.inputPeak = 0;
    this.outputPeak = 0;

    this.port.onmessage = (event) => {
      const message = event.data || {};

      if (message.type === 'INIT_WASM' && message.wasmBytes instanceof ArrayBuffer) {
        void this.initializeWasm(message.wasmBytes);
        return;
      }

      if (message.type === 'SET_STATE') {
        this.pendingState = {
          revision: Number(message.revision) || 0,
          state: message.state || {},
        };
        if (this.ready) this.applyPendingState();
        return;
      }

      if (message.type === 'SET_TELEMETRY') {
        this.telemetryEnabled = Boolean(message.enabled);
        this.telemetryCountdown = 0;
        return;
      }

      if (message.type === 'SET_PROOF_MUTE') {
        this.proofMute = Boolean(message.enabled);
        this.port.postMessage({
          type: 'PROOF_MUTE_APPLIED',
          enabled: this.proofMute,
          revision: this.appliedRevision,
        });
        return;
      }

      if (message.type === 'PING') {
        this.port.postMessage({
          type: 'PONG',
          ready: this.ready,
          revision: this.appliedRevision,
          state: this.appliedState,
          proofMute: this.proofMute,
        });
      }
    };
  }

  async initializeWasm(wasmBytes) {
    try {
      const imports = {
        env: {
          sin: Math.sin,
          cos: Math.cos,
          pow: Math.pow,
          exp: Math.exp,
          log10: Math.log10,
        },
      };
      const result = await WebAssembly.instantiate(wasmBytes, imports);
      const exports = result.instance.exports;
      const memory = exports.memory;

      const required = [
        'mvp_v2_input_l','mvp_v2_input_r','mvp_v2_output_l','mvp_v2_output_r','mvp_v2_max_frames',
        'mvp_v2_init','mvp_v2_set_bypass','mvp_v2_set_loudness_mode','mvp_v2_set_bass','mvp_v2_set_clarity',
        'mvp_v2_set_punch','mvp_v2_set_wide','mvp_v2_set_eq_enabled','mvp_v2_set_eq_band','mvp_v2_process',
        'mvp_v2_meter_true_peak_dbtp','mvp_v2_meter_limiter_gr_db','mvp_v2_meter_clip_count','mvp_v2_meter_nan_count',
      ];
      for (const name of required) {
        if (typeof exports[name] !== 'function') throw new Error(`Missing V2 WASM export: ${name}`);
      }
      if (!(memory instanceof WebAssembly.Memory)) throw new Error('V2 WASM memory export is missing');

      const maxFrames = Number(exports.mvp_v2_max_frames());
      if (!Number.isFinite(maxFrames) || maxFrames < 128) {
        throw new Error(`Invalid V2 max frame count: ${maxFrames}`);
      }
      if (exports.mvp_v2_init(sampleRate) !== 1) {
        throw new Error(`V2 WASM rejected sample rate ${sampleRate}`);
      }

      this.exports = exports;
      this.maxFrames = maxFrames;
      this.inputL = new Float32Array(memory.buffer, Number(exports.mvp_v2_input_l()), maxFrames);
      this.inputR = new Float32Array(memory.buffer, Number(exports.mvp_v2_input_r()), maxFrames);
      this.outputL = new Float32Array(memory.buffer, Number(exports.mvp_v2_output_l()), maxFrames);
      this.outputR = new Float32Array(memory.buffer, Number(exports.mvp_v2_output_r()), maxFrames);
      this.ready = true;
      this.applyPendingState();
      this.port.postMessage({ type: 'READY', sampleRate, maxFrames, build: 'v2-stage2-r2-route-proof' });
    } catch (error) {
      this.ready = false;
      this.port.postMessage({
        type: 'ERROR',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  clamp01(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(1, numeric));
  }

  applyPendingState() {
    if (!this.ready || !this.exports || !this.pendingState) return;

    const exports = this.exports;
    const state = this.pendingState.state || {};
    const loudnessCode =
      state.loudnessMode === 'max' ? 2 :
      state.loudnessMode === 'loud' ? 1 : 0;

    const bass = this.clamp01(state.bass);
    const clarity = this.clamp01(state.clarity);
    const punch = this.clamp01(state.punch);
    const wide = this.clamp01(state.wide);
    const bypass = Boolean(state.bypass);
    const eqEnabled = Boolean(state.eqEnabled);
    const loudnessMode =
      loudnessCode === 2 ? 'max' :
      loudnessCode === 1 ? 'loud' : 'normal';

    exports.mvp_v2_set_bypass(bypass ? 1 : 0);
    exports.mvp_v2_set_loudness_mode(loudnessCode);
    exports.mvp_v2_set_bass(bass);
    exports.mvp_v2_set_clarity(clarity);
    exports.mvp_v2_set_punch(punch);
    exports.mvp_v2_set_wide(wide);
    exports.mvp_v2_set_eq_enabled(eqEnabled ? 1 : 0);

    const gains = Array.isArray(state.eqGains) ? state.eqGains : [];
    for (let band = 0; band < 31; band += 1) {
      const gain = Number(gains[band]);
      exports.mvp_v2_set_eq_band(
        band,
        Number.isFinite(gain) ? Math.max(-12, Math.min(12, gain)) : 0,
      );
    }

    this.appliedState = {
      bypass,
      loudnessMode,
      bass,
      clarity,
      punch,
      wide,
      eqEnabled,
    };

    this.appliedRevision = this.pendingState.revision;
    this.pendingState = null;

    this.port.postMessage({
      type: 'STATE_APPLIED',
      revision: this.appliedRevision,
      state: this.appliedState,
    });
  }

  writePassThrough(inputs, outputs) {
    const inputBus = inputs[0];
    const outputBus = outputs[0];
    if (!outputBus || outputBus.length === 0 || !outputBus[0]) return;

    const inL = inputBus && inputBus[0] ? inputBus[0] : null;
    const inR = inputBus && inputBus[1] ? inputBus[1] : inL;
    const outL = outputBus[0];
    const outR = outputBus[1] || null;

    for (let i = 0; i < outL.length; i += 1) {
      const left = inL ? inL[i] || 0 : 0;
      const right = inR ? inR[i] || 0 : left;
      const finalL = this.proofMute ? 0 : left;
      const finalR = this.proofMute ? 0 : right;
      outL[i] = finalL;
      if (outR) outR[i] = finalR;
    }
  }

  process(inputs, outputs) {
    if (!this.ready || !this.exports || !this.inputL || !this.inputR || !this.outputL || !this.outputR) {
      this.writePassThrough(inputs, outputs);
      return true;
    }

    const inputBus = inputs[0];
    const outputBus = outputs[0];
    if (!outputBus || outputBus.length === 0 || !outputBus[0]) return true;

    const inL = inputBus && inputBus[0] ? inputBus[0] : null;
    const inR = inputBus && inputBus[1] ? inputBus[1] : inL;
    const outL = outputBus[0];
    const outR = outputBus[1] || null;
    const frames = outL.length;

    let offset = 0;
    while (offset < frames) {
      const chunk = Math.min(this.maxFrames, frames - offset);

      for (let i = 0; i < chunk; i += 1) {
        const sourceIndex = offset + i;
        const left = inL ? inL[sourceIndex] || 0 : 0;
        const right = inR ? inR[sourceIndex] || 0 : left;
        this.inputL[i] = left;
        this.inputR[i] = right;
      }

      const ok = this.exports.mvp_v2_process(chunk);

      for (let i = 0; i < chunk; i += 1) {
        const targetIndex = offset + i;
        const leftIn = inL ? inL[targetIndex] || 0 : 0;
        const rightIn = inR ? inR[targetIndex] || 0 : leftIn;

        const processedL = ok === 1 ? this.outputL[i] : leftIn;
        const processedR = ok === 1 ? this.outputR[i] : rightIn;

        const finalL = this.proofMute ? 0 : processedL;
        const finalR = this.proofMute ? 0 : processedR;

        outL[targetIndex] = finalL;
        if (outR) outR[targetIndex] = finalR;

        this.inputEnergy += leftIn * leftIn + rightIn * rightIn;
        this.outputEnergy += finalL * finalL + finalR * finalR;
        this.energySamples += 2;

        const inPeak = Math.max(Math.abs(leftIn), Math.abs(rightIn));
        const outPeak = Math.max(Math.abs(finalL), Math.abs(finalR));
        if (inPeak > this.inputPeak) this.inputPeak = inPeak;
        if (outPeak > this.outputPeak) this.outputPeak = outPeak;
      }

      offset += chunk;
    }

    if (this.telemetryEnabled) {
      this.telemetryCountdown -= frames;
      if (this.telemetryCountdown <= 0) {
        this.telemetryCountdown = Math.max(128, Math.floor(sampleRate / 8));

        const samples = Math.max(1, this.energySamples);
        const inputRms = Math.sqrt(this.inputEnergy / samples);
        const outputRms = Math.sqrt(this.outputEnergy / samples);
        const rmsDeltaDb =
          inputRms > 0.00000001 && outputRms > 0.00000001
            ? 20 * Math.log10(outputRms / inputRms)
            : outputRms <= 0.00000001
              ? -120
              : 0;

        this.port.postMessage({
          type: 'TELEMETRY',
          revision: this.appliedRevision,
          state: this.appliedState,
          proofMute: this.proofMute,
          inputRms,
          outputRms,
          inputPeak: this.inputPeak,
          outputPeak: this.outputPeak,
          rmsDeltaDb,
          truePeakDbtp: Number(this.exports.mvp_v2_meter_true_peak_dbtp()),
          limiterGrDbMaxSinceInit: Number(this.exports.mvp_v2_meter_limiter_gr_db()),
          clipCount: Number(this.exports.mvp_v2_meter_clip_count()),
          nanCount: Number(this.exports.mvp_v2_meter_nan_count()),
        });

        this.inputEnergy = 0;
        this.outputEnergy = 0;
        this.energySamples = 0;
        this.inputPeak = 0;
        this.outputPeak = 0;
      }
    }

    return true;
  }
}

registerProcessor('mvp-hd-v2-processor', MvpHdV2Processor);
