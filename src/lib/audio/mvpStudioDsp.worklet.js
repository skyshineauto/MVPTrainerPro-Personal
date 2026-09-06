// MVP Trainer Pro - MVP Studio WASM AudioWorklet V5 Advanced Audio Engine
// The C++ core owns sample processing. This wrapper only moves fixed buffers,
// applies state changes outside the sample loop, and reports low-rate telemetry.

class MvpStudioWasmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.failed = false;
    this.instance = null;
    this.exports = null;
    this.memory = null;
    this.maxFrames = 0;
    this.inputL = null;
    this.inputR = null;
    this.outputL = null;
    this.outputR = null;
    this.pendingState = null;
    this.appliedState = null;
    this.stateRevision = 0;
    this.pendingExternalRevision = 0;
    this.appliedStateRevision = -1;
    this.linearEqDirty = false;
    this.linearCommitFrames = 0;
    this.telemetryFrames = 0;
    this.blockSizeWarningSent = false;
    this.u8Cache = null;
    this.u8CacheBuffer = null;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "init" && data.wasmBytes) {
        void this.initialize(data.wasmBytes);
        return;
      }
      if (data.type === "state") {
        // Coalesce rapid UI mutations. The newest complete state wins and is
        // applied once at the next render-quantum boundary.
        this.pendingState = data.state || null;
        this.stateRevision += 1;
        this.pendingExternalRevision = Number.isFinite(Number(data.revision))
          ? Math.max(0, Math.floor(Number(data.revision)))
          : this.stateRevision;
        return;
      }
      if (data.type === "reset" && this.ready && this.exports?.mvp_reset) {
        this.exports.mvp_reset();
        return;
      }
      if (data.type === "reset-loudness" && this.ready && this.exports?.mvp_reset_loudness) {
        this.exports.mvp_reset_loudness();
      }
    };
  }

  getU8() {
    if (!this.memory) return null;
    if (!this.u8Cache || this.u8CacheBuffer !== this.memory.buffer) {
      this.u8CacheBuffer = this.memory.buffer;
      this.u8Cache = new Uint8Array(this.memory.buffer);
    }
    return this.u8Cache;
  }

  async initialize(wasmBytes) {
    if (this.ready || this.failed) return;
    let memoryRef = null;
    const imports = {
      env: {
        sin: Math.sin,
        cos: Math.cos,
        exp: Math.exp,
        exp2: (value) => 2 ** value,
        pow: Math.pow,
        log10: Math.log10,
        memset: (pointer, value, length) => {
          if (!memoryRef) return pointer;
          const bytes = new Uint8Array(memoryRef.buffer);
          bytes.fill(value & 0xff, pointer >>> 0, (pointer + length) >>> 0);
          return pointer;
        },
        memcpy: (destination, source, length) => {
          if (!memoryRef) return destination;
          const bytes = new Uint8Array(memoryRef.buffer);
          bytes.copyWithin(destination >>> 0, source >>> 0, (source + length) >>> 0);
          return destination;
        },
      },
    };

    try {
      const result = await WebAssembly.instantiate(wasmBytes, imports);
      const instance = result.instance || result;
      const api = instance.exports;
      if (!api?.memory || typeof api.mvp_process !== "function") {
        throw new Error("MVP Studio WASM exports are incomplete.");
      }
      memoryRef = api.memory;
      this.instance = instance;
      this.exports = api;
      this.memory = api.memory;
      const initialized = api.mvp_init(sampleRate);
      if (!initialized) throw new Error("MVP Studio WASM initialization failed.");
      this.maxFrames = api.mvp_max_frames();
      this.refreshViews();
      this.ready = true;
      this.port.postMessage({
        type: "ready",
        sampleRate,
        maxFrames: this.maxFrames,
        version: "studio-wasm-v5.8-r77f-max-output-headroom-lock",
      });
    } catch (error) {
      this.failed = true;
      this.port.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  refreshViews() {
    if (!this.exports || !this.memory || !this.maxFrames) return;
    const buffer = this.memory.buffer;
    this.inputL = new Float32Array(buffer, this.exports.mvp_input_l(), this.maxFrames);
    this.inputR = new Float32Array(buffer, this.exports.mvp_input_r(), this.maxFrames);
    this.outputL = new Float32Array(buffer, this.exports.mvp_output_l(), this.maxFrames);
    this.outputR = new Float32Array(buffer, this.exports.mvp_output_r(), this.maxFrames);
  }

  sameNumber(a, b, epsilon = 0.000001) {
    const left = Number(a);
    const right = Number(b);
    if (!Number.isFinite(left) && !Number.isFinite(right)) return true;
    return Math.abs((Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0)) <= epsilon;
  }

  sameArray(a, b, length = 31) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    for (let index = 0; index < length; index += 1) {
      if (!this.sameNumber(a[index], b[index])) return false;
    }
    return true;
  }

  applyStateAtQuantumBoundary() {
    if (!this.ready || !this.exports || !this.pendingState) return;
    if (this.appliedStateRevision === this.stateRevision && this.appliedState) return;

    const state = this.pendingState;
    const previous = this.appliedState;
    const api = this.exports;
    const first = !previous;

    const nextTopology = Number(state.eqTopologyCode) === 1 ? 1 : 0;
    const previousTopology = first ? nextTopology : (Number(previous.eqTopologyCode) === 1 ? 1 : 0);
    const gains = Array.isArray(state.eqGains) ? state.eqGains : [];
    const previousGains = Array.isArray(previous?.eqGains) ? previous.eqGains : [];
    const eqChanged = first || !this.sameArray(gains, previousGains, 31);

    if (first || Boolean(state.bypass) !== Boolean(previous.bypass)) {
      api.mvp_set_bypass(state.bypass ? 1 : 0);
    }
    if (first || Boolean(state.eqEnabled) !== Boolean(previous.eqEnabled)) {
      api.mvp_set_eq_enabled(state.eqEnabled ? 1 : 0);
    }

    if (eqChanged) {
      for (let index = 0; index < 31; index += 1) {
        api.mvp_set_eq_band(index, Number.isFinite(Number(gains[index])) ? Number(gains[index]) : 0);
      }
      this.linearEqDirty = true;
      // Minimum-phase bands update immediately in the core. The expensive FIR
      // rebuild waits until the user has stopped dragging for ~120 ms.
      this.linearCommitFrames = Math.max(1, Math.round(sampleRate * 0.12));
    }

    if (first || nextTopology !== previousTopology) {
      // Before entering Linear Phase, build its FIR once from the latest EQ
      // targets. The C++ core then performs a short muted topology transition.
      if (nextTopology === 1 && this.linearEqDirty && typeof api.mvp_commit_eq === "function") {
        api.mvp_commit_eq();
        this.linearEqDirty = false;
        this.linearCommitFrames = 0;
      }
      if (typeof api.mvp_set_eq_topology === "function") {
        api.mvp_set_eq_topology(nextTopology);
      }
    }

    if (first || !this.sameNumber(state.preampDb, previous.preampDb)) {
      api.mvp_set_preamp_db(Number.isFinite(Number(state.preampDb)) ? Number(state.preampDb) : 0);
    }
    if (first || !this.sameNumber(state.headroomDb, previous.headroomDb)) {
      api.mvp_set_headroom_db(Number.isFinite(Number(state.headroomDb)) ? Number(state.headroomDb) : 0);
    }

    if (
      first ||
      Boolean(state.transientEnabled) !== Boolean(previous.transientEnabled) ||
      !this.sameNumber(state.transientAmount, previous.transientAmount)
    ) {
      if (typeof api.mvp_set_transient === "function") {
        api.mvp_set_transient(
          state.transientEnabled ? 1 : 0,
          Number.isFinite(Number(state.transientAmount)) ? Number(state.transientAmount) : 0,
        );
      }
    }

    if (
      first ||
      Boolean(state.multibandEnabled) !== Boolean(previous.multibandEnabled) ||
      !this.sameNumber(state.multibandAmount, previous.multibandAmount)
    ) {
      if (typeof api.mvp_set_multiband === "function") {
        api.mvp_set_multiband(
          state.multibandEnabled ? 1 : 0,
          Number.isFinite(Number(state.multibandAmount)) ? Number(state.multibandAmount) : 1,
        );
      }
    }

    if (
      first ||
      Boolean(state.dynamicEqEnabled) !== Boolean(previous.dynamicEqEnabled) ||
      !this.sameNumber(state.dynamicEqAmount, previous.dynamicEqAmount)
    ) {
      if (typeof api.mvp_set_dynamic_eq === "function") {
        api.mvp_set_dynamic_eq(
          state.dynamicEqEnabled ? 1 : 0,
          Number.isFinite(Number(state.dynamicEqAmount)) ? Number(state.dynamicEqAmount) : 0.72,
        );
      }
    }

    if (
      first ||
      Boolean(state.outputCorrectionEnabled) !== Boolean(previous.outputCorrectionEnabled) ||
      !this.sameNumber(state.outputCorrectionAmount, previous.outputCorrectionAmount)
    ) {
      if (typeof api.mvp_set_output_correction === "function") {
        api.mvp_set_output_correction(
          state.outputCorrectionEnabled ? 1 : 0,
          Number.isFinite(Number(state.outputCorrectionAmount)) ? Number(state.outputCorrectionAmount) : 1,
        );
      }
    }

    if (
      first ||
      Boolean(state.stereoIntegrityEnabled) !== Boolean(previous.stereoIntegrityEnabled) ||
      !this.sameNumber(state.stereoIntegrityAmount, previous.stereoIntegrityAmount)
    ) {
      if (typeof api.mvp_set_stereo_integrity === "function") {
        api.mvp_set_stereo_integrity(
          state.stereoIntegrityEnabled ? 1 : 0,
          Number.isFinite(Number(state.stereoIntegrityAmount)) ? Number(state.stereoIntegrityAmount) : 1,
        );
      }
    }

    if (
      first ||
      Boolean(state.normalizationEnabled) !== Boolean(previous.normalizationEnabled) ||
      !this.sameNumber(state.normalizationTargetLufs, previous.normalizationTargetLufs)
    ) {
      if (typeof api.mvp_set_loudness === "function") {
        api.mvp_set_loudness(
          state.normalizationEnabled ? 1 : 0,
          Number.isFinite(Number(state.normalizationTargetLufs)) ? Number(state.normalizationTargetLufs) : -10,
        );
      }
    }

    if (
      first ||
      Boolean(state.limiterEnabled) !== Boolean(previous.limiterEnabled) ||
      !this.sameNumber(state.limiterCeilingDb, previous.limiterCeilingDb)
    ) {
      api.mvp_set_limiter(
        state.limiterEnabled ? 1 : 0,
        Number.isFinite(Number(state.limiterCeilingDb)) ? Number(state.limiterCeilingDb) : -1,
      );
    }

    if (first || !this.sameNumber(state.outputProfileCode, previous.outputProfileCode)) {
      api.mvp_set_output_profile(Number.isFinite(Number(state.outputProfileCode)) ? Number(state.outputProfileCode) : 0);
    }

    const headphoneChanged =
      first ||
      Boolean(state.headphoneEnabled) !== Boolean(previous.headphoneEnabled) ||
      !this.sameNumber(state.headphoneWidth, previous.headphoneWidth) ||
      !this.sameNumber(state.headphoneDepth, previous.headphoneDepth) ||
      !this.sameNumber(state.headphoneCrossfeed, previous.headphoneCrossfeed) ||
      !this.sameNumber(state.headphoneCenter, previous.headphoneCenter) ||
      !this.sameNumber(state.headphoneBassImpact, previous.headphoneBassImpact);

    if (headphoneChanged) {
      api.mvp_set_headphone(
        state.headphoneEnabled ? 1 : 0,
        Number(state.headphoneWidth) || 0,
        Number(state.headphoneDepth) || 0,
        Number(state.headphoneCrossfeed) || 0,
        Number.isFinite(Number(state.headphoneCenter)) ? Number(state.headphoneCenter) : 0.5,
        Number(state.headphoneBassImpact) || 0,
      );
    }


    if (typeof api.mvp_set_output_gain === "function" && (
      first || Boolean(state.autoMakeupEnabled) !== Boolean(previous.autoMakeupEnabled) ||
      !this.sameNumber(state.outputReserveDb, previous.outputReserveDb)
    )) {
      api.mvp_set_output_gain(state.autoMakeupEnabled ? 1 : 0, Number(state.outputReserveDb) || 0);
    }

    if (typeof api.mvp_set_parametric_enabled === "function" && (first || Boolean(state.parametricEnabled) !== Boolean(previous.parametricEnabled))) {
      api.mvp_set_parametric_enabled(state.parametricEnabled ? 1 : 0);
    }
    if (typeof api.mvp_set_parametric_band === "function") {
      const bands = Array.isArray(state.parametricBands) ? state.parametricBands : [];
      const oldBands = Array.isArray(previous?.parametricBands) ? previous.parametricBands : [];
      for (let index = 0; index < 6; index += 1) {
        const band = bands[index] || {};
        const old = oldBands[index] || {};
        const changed = first || Boolean(band.enabled) !== Boolean(old.enabled) ||
          !this.sameNumber(band.frequency, old.frequency) || !this.sameNumber(band.gainDb, old.gainDb) ||
          !this.sameNumber(band.q, old.q) || !this.sameNumber(band.type, old.type);
        if (changed) api.mvp_set_parametric_band(index, band.enabled ? 1 : 0, Number(band.frequency) || 1000, Number(band.gainDb) || 0, Number(band.q) || 1, Number(band.type) || 0);
      }
    }

    if (typeof api.mvp_set_bass_engine === "function" && (first || Boolean(state.bassEngineEnabled) !== Boolean(previous.bassEngineEnabled) ||
      !this.sameNumber(state.bassSubDb, previous.bassSubDb) || !this.sameNumber(state.bassPunchDb, previous.bassPunchDb) ||
      !this.sameNumber(state.bassBodyDb, previous.bassBodyDb) || !this.sameNumber(state.bassTightness, previous.bassTightness))) {
      api.mvp_set_bass_engine(state.bassEngineEnabled ? 1 : 0, Number(state.bassSubDb)||0, Number(state.bassPunchDb)||0, Number(state.bassBodyDb)||0, Number(state.bassTightness)||0);
    }
    if (typeof api.mvp_set_tone_engine === "function" && (first || Boolean(state.toneEngineEnabled) !== Boolean(previous.toneEngineEnabled) ||
      !this.sameNumber(state.presenceDb, previous.presenceDb) || !this.sameNumber(state.clarityDb, previous.clarityDb) ||
      !this.sameNumber(state.airDb, previous.airDb) || !this.sameNumber(state.deharshAmount, previous.deharshAmount))) {
      api.mvp_set_tone_engine(state.toneEngineEnabled ? 1 : 0, Number(state.presenceDb)||0, Number(state.clarityDb)||0, Number(state.airDb)||0, Number(state.deharshAmount)||0);
    }
    if (typeof api.mvp_set_exciter === "function" && (first || Boolean(state.exciterEnabled) !== Boolean(previous.exciterEnabled) ||
      !this.sameNumber(state.exciterAmount, previous.exciterAmount) || !this.sameNumber(state.saturationLow, previous.saturationLow) ||
      !this.sameNumber(state.saturationMid, previous.saturationMid) || !this.sameNumber(state.saturationHigh, previous.saturationHigh))) {
      api.mvp_set_exciter(state.exciterEnabled ? 1 : 0, Number(state.exciterAmount)||0, Number(state.saturationLow)||0, Number(state.saturationMid)||0, Number(state.saturationHigh)||0);
    }
    if (typeof api.mvp_set_stereo_field === "function" && (first || Boolean(state.stereoFieldEnabled) !== Boolean(previous.stereoFieldEnabled) ||
      !this.sameNumber(state.stereoUserWidth, previous.stereoUserWidth) || !this.sameNumber(state.stereoCenterFocus, previous.stereoCenterFocus) || !this.sameNumber(state.bassMonoHz, previous.bassMonoHz))) {
      api.mvp_set_stereo_field(state.stereoFieldEnabled ? 1 : 0, Number(state.stereoUserWidth)||1, Number(state.stereoCenterFocus)||1, Number(state.bassMonoHz)||100);
    }
    if (typeof api.mvp_set_dynamics_restore === "function" && (first || Boolean(state.dynamicsRestoreEnabled) !== Boolean(previous.dynamicsRestoreEnabled) || !this.sameNumber(state.dynamicsRestoreAmount, previous.dynamicsRestoreAmount))) {
      api.mvp_set_dynamics_restore(state.dynamicsRestoreEnabled ? 1 : 0, Number(state.dynamicsRestoreAmount)||0);
    }
    if (typeof api.mvp_set_smart_dsp === "function" && (first || Boolean(state.smartDspEnabled) !== Boolean(previous.smartDspEnabled) || !this.sameNumber(state.smartDspAmount, previous.smartDspAmount))) {
      api.mvp_set_smart_dsp(state.smartDspEnabled ? 1 : 0, Number(state.smartDspAmount)||0);
    }
    if (typeof api.mvp_set_headphone_advanced === "function" && (first || Boolean(state.headphoneAdvancedEnabled) !== Boolean(previous.headphoneAdvancedEnabled) ||
      !this.sameNumber(state.headphoneSpeakerAngle, previous.headphoneSpeakerAngle) || !this.sameNumber(state.headphoneDistance, previous.headphoneDistance) ||
      !this.sameNumber(state.headphoneReflections, previous.headphoneReflections) || !this.sameNumber(state.headphoneWet, previous.headphoneWet))) {
      api.mvp_set_headphone_advanced(state.headphoneAdvancedEnabled ? 1 : 0, Number(state.headphoneSpeakerAngle)||30, Number(state.headphoneDistance)||0.35, Number(state.headphoneReflections)||0, Number(state.headphoneWet)||0);
    }

    this.appliedState = {
      ...state,
      eqGains: gains.slice(0, 31),
    };
    this.appliedStateRevision = this.stateRevision;
    this.port.postMessage({
      type: "state-applied",
      revision: this.pendingExternalRevision || this.appliedStateRevision,
      eqEnabled: Boolean(state.eqEnabled),
      eqTopologyCode: nextTopology,
      eqGains: gains.slice(0, 31),
      preampDb: Number.isFinite(Number(state.preampDb)) ? Number(state.preampDb) : 0,
      headphoneEnabled: Boolean(state.headphoneEnabled),
      headphoneWidth: Number(state.headphoneWidth) || 0,
      headphoneDepth: Number(state.headphoneDepth) || 0,
      headphoneCrossfeed: Number(state.headphoneCrossfeed) || 0,
      headphoneCenter: Number.isFinite(Number(state.headphoneCenter)) ? Number(state.headphoneCenter) : 0.5,
      headphoneBassImpact: Number(state.headphoneBassImpact) || 0,
      outputReserveDb: Number(state.outputReserveDb) || 0,
      autoMakeupEnabled: Boolean(state.autoMakeupEnabled),
      smartDspEnabled: Boolean(state.smartDspEnabled),
    });
  }

  maybeCommitLinearEq(frames) {
    if (!this.linearEqDirty || !this.appliedState || !this.exports) return;
    if (Number(this.appliedState.eqTopologyCode) !== 1) return;
    this.linearCommitFrames -= frames;
    if (this.linearCommitFrames > 0) return;
    if (typeof this.exports.mvp_commit_eq === "function") {
      this.exports.mvp_commit_eq();
    }
    this.linearEqDirty = false;
    this.linearCommitFrames = 0;
  }

  copyBypass(input, output) {
    if (!output || output.length === 0) return;
    const inL = input?.[0];
    const inR = input?.[1] || inL;
    const outL = output[0];
    const outR = output[1] || output[0];
    if (!outL) return;
    if (inL) outL.set(inL);
    else outL.fill(0);
    if (outR !== outL) {
      if (inR) outR.set(inR);
      else outR.fill(0);
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const inL = input?.[0];
    const inR = input?.[1] || inL;
    const outL = output[0];
    const outR = output[1] || output[0];

    // Apply the newest complete UI state once per render quantum. This keeps
    // coefficient/control work out of the message callback and collapses bursts
    // of slider/preset mutations to the latest state.
    this.applyStateAtQuantumBoundary();

    if (!inL || !outL) {
      this.copyBypass(input, output);
      return true;
    }

    const frames = outL.length;
    this.maybeCommitLinearEq(frames);
    if (!this.ready || !this.exports || !this.inputL || !this.outputL) {
      this.copyBypass(input, output);
      return true;
    }
    if (frames > this.maxFrames) {
      this.copyBypass(input, output);
      if (!this.blockSizeWarningSent) {
        this.blockSizeWarningSent = true;
        this.port.postMessage({ type: "error", message: `Render quantum ${frames} exceeds Studio capacity ${this.maxFrames}.` });
      }
      return true;
    }

    // Memory never grows in this build, but keep the views correct if a future build changes that.
    if (this.inputL.buffer !== this.memory.buffer) this.refreshViews();
    this.inputL.set(inL, 0);
    if (inR) this.inputR.set(inR, 0);
    else this.inputR.set(inL, 0);

    const processed = this.exports.mvp_process(frames);
    if (!processed) {
      this.copyBypass(input, output);
      return true;
    }
    for (let index = 0; index < frames; index += 1) {
      outL[index] = this.outputL[index];
      if (outR !== outL) outR[index] = this.outputR[index];
    }

    this.telemetryFrames += frames;
    if (this.telemetryFrames >= sampleRate / 20) {
      this.telemetryFrames = 0;
      this.port.postMessage({
        type: "telemetry",
        inputPeak: this.exports.mvp_meter_input_peak(),
        outputPeak: this.exports.mvp_meter_output_peak(),
        inputRms: this.exports.mvp_meter_input_rms(),
        outputRms: this.exports.mvp_meter_output_rms(),
        gainReductionDb: this.exports.mvp_meter_gain_reduction_db(),
        limiterGain: this.exports.mvp_meter_limiter_gain(),
        truePeakDbtp: this.exports.mvp_meter_true_peak_dbtp ? this.exports.mvp_meter_true_peak_dbtp() : -120,
        transientBoostDb: typeof this.exports.mvp_meter_transient_boost_db === "function"
          ? this.exports.mvp_meter_transient_boost_db()
          : 0,
        multibandGainReductionDb: typeof this.exports.mvp_meter_multiband_gain_reduction_db === "function"
          ? this.exports.mvp_meter_multiband_gain_reduction_db()
          : 0,
        multibandBandReductionDb: typeof this.exports.mvp_meter_multiband_band_reduction_db === "function"
          ? [0, 1, 2, 3].map((band) => this.exports.mvp_meter_multiband_band_reduction_db(band))
          : [0, 0, 0, 0],
        dynamicEqGainReductionDb: typeof this.exports.mvp_meter_dynamic_eq_gain_reduction_db === "function"
          ? this.exports.mvp_meter_dynamic_eq_gain_reduction_db()
          : 0,
        dynamicEqBandReductionDb: typeof this.exports.mvp_meter_dynamic_eq_band_reduction_db === "function"
          ? [0, 1, 2, 3].map((band) => this.exports.mvp_meter_dynamic_eq_band_reduction_db(band))
          : [0, 0, 0, 0],
        outputCorrectionReductionDb: typeof this.exports.mvp_meter_output_correction_reduction_db === "function"
          ? this.exports.mvp_meter_output_correction_reduction_db()
          : 0,
        stereoCorrelation: typeof this.exports.mvp_meter_stereo_correlation === "function"
          ? this.exports.mvp_meter_stereo_correlation()
          : 1,
        stereoWidthPercent: typeof this.exports.mvp_meter_stereo_width_percent === "function"
          ? this.exports.mvp_meter_stereo_width_percent()
          : 100,
        stereoGuardReductionDb: typeof this.exports.mvp_meter_stereo_guard_reduction_db === "function"
          ? this.exports.mvp_meter_stereo_guard_reduction_db()
          : 0,
        headphoneOutputDriveDb: typeof this.exports.mvp_meter_headphone_output_drive_db === "function"
          ? this.exports.mvp_meter_headphone_output_drive_db()
          : 0,
        loudnessGainDb: typeof this.exports.mvp_meter_loudness_gain_db === "function"
          ? this.exports.mvp_meter_loudness_gain_db()
          : 0,
        loudnessMomentaryLufs: typeof this.exports.mvp_meter_loudness_momentary_lufs === "function"
          ? this.exports.mvp_meter_loudness_momentary_lufs()
          : -70,
        loudnessProgramLufs: typeof this.exports.mvp_meter_loudness_program_lufs === "function"
          ? this.exports.mvp_meter_loudness_program_lufs()
          : -70,
        autoMakeupDb: typeof this.exports.mvp_meter_auto_makeup_db === "function" ? this.exports.mvp_meter_auto_makeup_db() : 0,
        outputReserveDb: typeof this.exports.mvp_meter_output_reserve_db === "function" ? this.exports.mvp_meter_output_reserve_db() : 0,
        finalCompressorReductionDb: typeof this.exports.mvp_meter_final_compressor_reduction_db === "function" ? this.exports.mvp_meter_final_compressor_reduction_db() : 0,
        maxHdInputTruePeakDbtp: typeof this.exports.mvp_meter_max_hd_input_true_peak_dbtp === "function" ? this.exports.mvp_meter_max_hd_input_true_peak_dbtp() : -120,
        availableHeadroomDb: typeof this.exports.mvp_meter_available_headroom_db === "function" ? this.exports.mvp_meter_available_headroom_db() : 24,
        internalPeak: typeof this.exports.mvp_meter_internal_peak === "function" ? this.exports.mvp_meter_internal_peak() : 0,
        bassActivityDb: typeof this.exports.mvp_meter_bass_activity_db === "function" ? this.exports.mvp_meter_bass_activity_db() : 0,
        toneActivityDb: typeof this.exports.mvp_meter_tone_activity_db === "function" ? this.exports.mvp_meter_tone_activity_db() : 0,
        exciterActivity: typeof this.exports.mvp_meter_exciter_activity === "function" ? this.exports.mvp_meter_exciter_activity() : 0,
        deharshReductionDb: typeof this.exports.mvp_meter_deharsh_reduction_db === "function" ? this.exports.mvp_meter_deharsh_reduction_db() : 0,
        smartActivity: typeof this.exports.mvp_meter_smart_activity === "function" ? this.exports.mvp_meter_smart_activity() : 0,
      });
    }
    return true;
  }
}

registerProcessor("mvp-studio-wasm", MvpStudioWasmProcessor);
