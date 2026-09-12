// MVP Trainer Pro HD V2 - isolated AudioWorklet bridge.
// No heap allocation or object creation in the render loop.

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

    this.port.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === 'INIT_WASM' && message.wasmBytes instanceof ArrayBuffer) {
        void this.initializeWasm(message.wasmBytes);
        return;
      }
      if (message.type === 'SET_STATE') {
        this.pendingState = { revision: Number(message.revision) || 0, state: message.state || {} };
        if (this.ready) this.applyPendingState();
        return;
      }
      if (message.type === 'SET_TELEMETRY') {
        this.telemetryEnabled = Boolean(message.enabled);
        this.telemetryCountdown = 0;
        return;
      }
      if (message.type === 'PING') {
        this.port.postMessage({ type: 'PONG', ready: this.ready, revision: this.appliedRevision });
      }
    };
  }

  async initializeWasm(wasmBytes) {
    try {
      const imports = { env: { sin: Math.sin, cos: Math.cos, pow: Math.pow, exp: Math.exp, log10: Math.log10 } };
      const result = await WebAssembly.instantiate(wasmBytes, imports);
      const exports = result.instance.exports;
      const memory = exports.memory;
      const required = [
        'mvp_v2_input_l','mvp_v2_input_r','mvp_v2_output_l','mvp_v2_output_r','mvp_v2_max_frames',
        'mvp_v2_init','mvp_v2_set_bypass','mvp_v2_set_loudness_mode','mvp_v2_set_bass','mvp_v2_set_clarity',
        'mvp_v2_set_punch','mvp_v2_set_wide','mvp_v2_set_eq_enabled','mvp_v2_set_eq_band','mvp_v2_process',
        'mvp_v2_meter_true_peak_dbtp','mvp_v2_meter_limiter_gr_db','mvp_v2_meter_clip_count','mvp_v2_meter_nan_count'
      ];
      for (const name of required) {
        if (typeof exports[name] !== 'function') throw new Error(`Missing V2 WASM export: ${name}`);
      }
      if (!(memory instanceof WebAssembly.Memory)) throw new Error('V2 WASM memory export is missing');
      const maxFrames = Number(exports.mvp_v2_max_frames());
      if (!Number.isFinite(maxFrames) || maxFrames < 128) throw new Error(`Invalid V2 max frame count: ${maxFrames}`);
      if (exports.mvp_v2_init(sampleRate) !== 1) throw new Error(`V2 WASM rejected sample rate ${sampleRate}`);

      this.exports = exports;
      this.maxFrames = maxFrames;
      this.inputL = new Float32Array(memory.buffer, Number(exports.mvp_v2_input_l()), maxFrames);
      this.inputR = new Float32Array(memory.buffer, Number(exports.mvp_v2_input_r()), maxFrames);
      this.outputL = new Float32Array(memory.buffer, Number(exports.mvp_v2_output_l()), maxFrames);
      this.outputR = new Float32Array(memory.buffer, Number(exports.mvp_v2_output_r()), maxFrames);
      this.ready = true;
      this.applyPendingState();
      this.port.postMessage({ type: 'READY', sampleRate, maxFrames });
    } catch (error) {
      this.ready = false;
      this.port.postMessage({ type: 'ERROR', message: error instanceof Error ? error.message : String(error) });
    }
  }

  applyPendingState() {
    if (!this.ready || !this.exports || !this.pendingState) return;
    const exports = this.exports;
    const state = this.pendingState.state || {};
    const loudnessCode = state.loudnessMode === 'max' ? 2 : state.loudnessMode === 'loud' ? 1 : 0;
    exports.mvp_v2_set_bypass(state.bypass ? 1 : 0);
    exports.mvp_v2_set_loudness_mode(loudnessCode);
    exports.mvp_v2_set_bass(this.clamp01(state.bass));
    exports.mvp_v2_set_clarity(this.clamp01(state.clarity));
    exports.mvp_v2_set_punch(this.clamp01(state.punch));
    exports.mvp_v2_set_wide(this.clamp01(state.wide));
    exports.mvp_v2_set_eq_enabled(state.eqEnabled ? 1 : 0);
    const gains = Array.isArray(state.eqGains) ? state.eqGains : [];
    for (let band = 0; band < 31; band += 1) {
      const gain = Number(gains[band]);
      exports.mvp_v2_set_eq_band(band, Number.isFinite(gain) ? Math.max(-12, Math.min(12, gain)) : 0);
    }
    this.appliedRevision = this.pendingState.revision;
    this.pendingState = null;
    this.port.postMessage({
      type: 'STATE_APPLIED',
      revision: this.appliedRevision,
      bypass: Boolean(state.bypass),
      loudnessMode: loudnessCode === 2 ? 'max' : loudnessCode === 1 ? 'loud' : 'normal',
    });
  }

  clamp01(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(1, numeric));
  }

  writePassThrough(inputs, outputs) {
    const inputBus = inputs[0];
    const outputBus = outputs[0];
    if (!outputBus || outputBus.length === 0 || !outputBus[0]) return;
    const inL = inputBus && inputBus[0] ? inputBus[0] : null;
    const inR = inputBus && inputBus[1] ? inputBus[1] : inL;
    const outL = outputBus[0];
    const outR = outputBus[1] || null;
    const frames = outL.length;
    for (let i = 0; i < frames; i += 1) {
      const left = inL ? inL[i] || 0 : 0;
      const right = inR ? inR[i] || 0 : left;
      outL[i] = left;
      if (outR) outR[i] = right;
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
      if (ok !== 1) {
        for (let i = 0; i < chunk; i += 1) {
          const sourceIndex = offset + i;
          const left = inL ? inL[sourceIndex] || 0 : 0;
          const right = inR ? inR[sourceIndex] || 0 : left;
          outL[sourceIndex] = left;
          if (outR) outR[sourceIndex] = right;
        }
      } else {
        for (let i = 0; i < chunk; i += 1) {
          const targetIndex = offset + i;
          outL[targetIndex] = this.outputL[i];
          if (outR) outR[targetIndex] = this.outputR[i];
        }
      }
      offset += chunk;
    }

    if (this.telemetryEnabled) {
      this.telemetryCountdown -= frames;
      if (this.telemetryCountdown <= 0) {
        this.telemetryCountdown = Math.max(128, Math.floor(sampleRate / 10));
        this.port.postMessage({
          type: 'TELEMETRY',
          revision: this.appliedRevision,
          truePeakDbtp: Number(this.exports.mvp_v2_meter_true_peak_dbtp()),
          limiterGrDb: Number(this.exports.mvp_v2_meter_limiter_gr_db()),
          clipCount: Number(this.exports.mvp_v2_meter_clip_count()),
          nanCount: Number(this.exports.mvp_v2_meter_nan_count()),
        });
      }
    }
    return true;
  }
}

registerProcessor('mvp-hd-v2-processor', MvpHdV2Processor);
