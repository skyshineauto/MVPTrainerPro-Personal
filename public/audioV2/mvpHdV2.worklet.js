// MVP Trainer Pro Broadcast Engine V3 R4 live-state AudioWorklet bridge.
// Single audible route. Fixed WASM buffers. No heap allocation in the render loop.

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
    this.telemetryEnabled = true;
    this.telemetryCountdown = 0;
    this.proofMute = false;
    this.appliedState = {
      mode: "pure",
      outputProfile: "headphones",
      intensity: 0.72,
      bassEnabled: false,
      bassCharacter: 0.5,
      impactEnabled: false,
      clarityEnabled: false,
      spatialEnabled: false,
      spaceMode: "studio",
      personalEnabled: false,
      personalBass: 0,
      personalPresence: 0,
      personalBrightness: 0,
      eqEnabled: false,
      eqGains: new Array(31).fill(0),
    };
    this.inputEnergy = 0;
    this.outputEnergy = 0;
    this.energySamples = 0;
    this.inputPeak = 0;
    this.outputPeak = 0;
    this.totalClipCount = 0;
    this.totalNanCount = 0;

    this.port.onmessage = (event) => {
      const message = event.data || {};

      if ((message.type === "INIT_WASM" || message.type === "init") && message.wasmBytes instanceof ArrayBuffer) {
        void this.initializeWasm(message.wasmBytes);
        return;
      }
      if (message.type === "SET_STATE" || message.type === "state") {
        this.pendingState = {
          revision: Number(message.revision) || 0,
          state: message.state || {},
        };
        if (this.ready) this.applyPendingState();
        return;
      }
      if (message.type === "SET_TELEMETRY") {
        this.telemetryEnabled = Boolean(message.enabled);
        this.telemetryCountdown = 0;
        return;
      }
      if (message.type === "SET_PROOF_MUTE") {
        this.proofMute = Boolean(message.enabled);
        this.port.postMessage({
          type: "PROOF_MUTE_APPLIED",
          enabled: this.proofMute,
          revision: this.appliedRevision,
        });
        return;
      }
      if (message.type === "RESET_ENGINE" || message.type === "reset") {
        if (this.ready && this.exports) this.exports.mvp_v2_reset();
        return;
      }
      if (message.type === "RESET_METERS" || message.type === "reset-loudness") {
        if (this.ready && this.exports) this.exports.mvp_v2_reset_meters();
        this.totalClipCount = 0;
        this.totalNanCount = 0;
        return;
      }
      if (message.type === "PING") {
        this.port.postMessage({
          type: "PONG",
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
        "mvp_v2_input_l","mvp_v2_input_r","mvp_v2_output_l","mvp_v2_output_r","mvp_v2_max_frames",
        "mvp_v2_init","mvp_v2_reset","mvp_v2_reset_meters",
        "mvp_v2_set_mode","mvp_v2_set_output_profile","mvp_v2_set_intensity",
        "mvp_v2_set_bass_enabled","mvp_v2_set_bass_character","mvp_v2_set_impact_enabled",
        "mvp_v2_set_clarity_enabled","mvp_v2_set_spatial_enabled","mvp_v2_set_space_mode",
        "mvp_v2_set_personal_enabled","mvp_v2_set_personal_bass","mvp_v2_set_personal_presence",
        "mvp_v2_set_personal_brightness","mvp_v2_set_eq_enabled","mvp_v2_set_eq_band","mvp_v2_process",
        "mvp_v2_meter_true_peak_dbtp","mvp_v2_meter_limiter_gr_db","mvp_v2_meter_clip_count",
        "mvp_v2_meter_nan_count","mvp_v2_meter_multiband_gr_db","mvp_v2_meter_impact_boost_db",
        "mvp_v2_meter_bass_activity_db","mvp_v2_meter_clarity_activity_db","mvp_v2_meter_spatial_width_percent",
      ];
      for (const name of required) {
        if (typeof exports[name] !== "function") throw new Error(`Missing Broadcast V3 WASM export: ${name}`);
      }
      if (!(memory instanceof WebAssembly.Memory)) throw new Error("Broadcast V3 WASM memory export is missing");

      const maxFrames = Number(exports.mvp_v2_max_frames());
      if (!Number.isFinite(maxFrames) || maxFrames < 128) throw new Error(`Invalid V3 max frame count: ${maxFrames}`);
      if (exports.mvp_v2_init(sampleRate) !== 1) throw new Error(`Broadcast V3 rejected sample rate ${sampleRate}`);

      this.exports = exports;
      this.maxFrames = maxFrames;
      this.inputL = new Float32Array(memory.buffer, Number(exports.mvp_v2_input_l()), maxFrames);
      this.inputR = new Float32Array(memory.buffer, Number(exports.mvp_v2_input_r()), maxFrames);
      this.outputL = new Float32Array(memory.buffer, Number(exports.mvp_v2_output_l()), maxFrames);
      this.outputR = new Float32Array(memory.buffer, Number(exports.mvp_v2_output_r()), maxFrames);
      this.ready = true;
      this.applyPendingState();
      this.port.postMessage({
        type: "READY",
        legacyType: "ready",
        version: "broadcast-v3",
        sampleRate,
        maxFrames,
      });
    } catch (error) {
      this.ready = false;
      this.port.postMessage({
        type: "ERROR",
        legacyType: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  clamp(value, lo, hi, fallback = lo) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(lo, Math.min(hi, numeric));
  }

  normalizeState(raw) {
    const oldBypass = Boolean(raw.bypass);
    const oldPower = Boolean(raw.autoMakeupEnabled) && Number(raw.outputReserveDb) >= 10;
    const explicitMode = String(raw.mode || "");
    const mode =
      explicitMode === "pure" || explicitMode === "adaptive" || explicitMode === "power"
        ? explicitMode
        : oldBypass ? "pure" : oldPower ? "power" : "adaptive";

    const profileCode = Number(raw.outputProfileCode);
    const profile =
      raw.outputProfile === "car_hifi" || raw.outputProfile === "headphones" || raw.outputProfile === "speaker"
        ? raw.outputProfile
        : profileCode === 2 ? "speaker" : profileCode === 1 ? "headphones" : "car_hifi";

    const bassTightness = this.clamp(raw.bassTightness, 0, 1, 0.5);
    const eqGains = Array.isArray(raw.eqGains) ? raw.eqGains.slice(0, 31) : [];
    while (eqGains.length < 31) eqGains.push(0);

    return {
      mode,
      outputProfile: profile,
      intensity: this.clamp(raw.intensity ?? raw.broadcastIntensity, 0, 1, 0.72),
      bassEnabled: Boolean(raw.bassEnabled ?? raw.broadcastBassEnabled ?? raw.bassEngineEnabled),
      bassCharacter: this.clamp(raw.bassCharacter ?? raw.broadcastBassCharacter, 0, 1, 1 - bassTightness),
      impactEnabled: Boolean(raw.impactEnabled ?? raw.broadcastImpactEnabled ?? raw.transientEnabled),
      clarityEnabled: Boolean(raw.clarityEnabled ?? raw.broadcastClarityEnabled ?? raw.toneEngineEnabled),
      spatialEnabled: Boolean(raw.spatialEnabled ?? raw.broadcastSpatialEnabled ?? raw.stereoFieldEnabled ?? raw.headphoneEnabled),
      spaceMode: raw.spaceMode === "arena" || raw.spaceMode === "live" || raw.spaceMode === "studio"
        ? raw.spaceMode
        : Number(raw.broadcastSpaceModeCode) === 2 ? "arena" : Number(raw.broadcastSpaceModeCode) === 1 ? "live" : "studio",
      personalEnabled: Boolean(raw.personalEnabled ?? raw.broadcastPersonalEnabled),
      personalBass: this.clamp(raw.personalBass ?? raw.broadcastPersonalBass, -1, 1, 0),
      personalPresence: this.clamp(raw.personalPresence ?? raw.broadcastPersonalPresence, -1, 1, 0),
      personalBrightness: this.clamp(raw.personalBrightness ?? raw.broadcastPersonalBrightness, -1, 1, 0),
      eqEnabled: Boolean(raw.eqEnabled),
      eqGains: eqGains.map((value) => this.clamp(value, -12, 12, 0)),
    };
  }

  applyPendingState() {
    if (!this.ready || !this.exports || !this.pendingState) return;
    const next = this.normalizeState(this.pendingState.state);
    const ex = this.exports;
    const modeCode = next.mode === "power" ? 2 : next.mode === "adaptive" ? 1 : 0;
    const profileCode = next.outputProfile === "speaker" ? 2 : next.outputProfile === "headphones" ? 1 : 0;
    const spaceCode = next.spaceMode === "arena" ? 2 : next.spaceMode === "live" ? 1 : 0;

    ex.mvp_v2_set_mode(modeCode);
    ex.mvp_v2_set_output_profile(profileCode);
    ex.mvp_v2_set_intensity(next.intensity);
    ex.mvp_v2_set_bass_enabled(next.bassEnabled ? 1 : 0);
    ex.mvp_v2_set_bass_character(next.bassCharacter);
    ex.mvp_v2_set_impact_enabled(next.impactEnabled ? 1 : 0);
    ex.mvp_v2_set_clarity_enabled(next.clarityEnabled ? 1 : 0);
    ex.mvp_v2_set_spatial_enabled(next.spatialEnabled ? 1 : 0);
    ex.mvp_v2_set_space_mode(spaceCode);
    ex.mvp_v2_set_personal_enabled(next.personalEnabled ? 1 : 0);
    ex.mvp_v2_set_personal_bass(next.personalBass);
    ex.mvp_v2_set_personal_presence(next.personalPresence);
    ex.mvp_v2_set_personal_brightness(next.personalBrightness);
    ex.mvp_v2_set_eq_enabled(next.eqEnabled ? 1 : 0);
    for (let band = 0; band < 31; band += 1) ex.mvp_v2_set_eq_band(band, next.eqGains[band]);

    this.appliedState = next;
    this.appliedRevision = this.pendingState.revision;
    this.pendingState = null;
    this.port.postMessage({
      type: "STATE_APPLIED",
      legacyType: "state-applied",
      revision: this.appliedRevision,
      appliedState: this.appliedState,
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
      outL[i] = this.proofMute ? 0 : left;
      if (outR) outR[i] = this.proofMute ? 0 : right;
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
            : outputRms <= 0.00000001 ? -120 : 0;

        // V3 R4 telemetry is a LIVE window, not a stale maximum from some earlier mode.
        // Safety counters remain cumulative in the bridge while activity meters reset every window.
        const intervalClipCount = Number(this.exports.mvp_v2_meter_clip_count());
        const intervalNanCount = Number(this.exports.mvp_v2_meter_nan_count());
        this.totalClipCount += intervalClipCount;
        this.totalNanCount += intervalNanCount;
        const liveTruePeakDbtp = Number(this.exports.mvp_v2_meter_true_peak_dbtp());
        const liveLimiterGrDb = Number(this.exports.mvp_v2_meter_limiter_gr_db());
        const liveMultibandGrDb = Number(this.exports.mvp_v2_meter_multiband_gr_db());
        const liveImpactDb = Number(this.exports.mvp_v2_meter_impact_boost_db());
        const liveBassDb = Number(this.exports.mvp_v2_meter_bass_activity_db());
        const liveClarityDb = Number(this.exports.mvp_v2_meter_clarity_activity_db());
        const liveWidth = Number(this.exports.mvp_v2_meter_spatial_width_percent());

        this.port.postMessage({
          type: "TELEMETRY",
          legacyType: "telemetry",
          revision: this.appliedRevision,
          state: this.appliedState,
          proofMute: this.proofMute,
          inputRms,
          outputRms,
          inputPeak: this.inputPeak,
          outputPeak: this.outputPeak,
          rmsDeltaDb,
          truePeakDbtp: liveTruePeakDbtp,
          limiterGrDb: liveLimiterGrDb,
          limiterGrDbMaxSinceInit: liveLimiterGrDb,
          clipCount: this.totalClipCount,
          nanCount: this.totalNanCount,
          multibandGainReductionDb: liveMultibandGrDb,
          impactBoostDb: liveImpactDb,
          bassActivityDb: liveBassDb,
          clarityActivityDb: liveClarityDb,
          spatialWidthPercent: liveWidth,
        });

        this.exports.mvp_v2_reset_meters();
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

registerProcessor("mvp-hd-v2-processor", MvpHdV2Processor);
