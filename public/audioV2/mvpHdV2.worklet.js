// MVP Trainer Pro Broadcast Engine V6.2 DIRECT STEREO AUTHORITY.
// STATE_APPLIED is emitted only after the actual C++ WASM state reads back correctly.
const MVP_V62_ENGINE_BUILD_ID = 6200;
const MVP_V62_SUPPORTED_ENGINE_BUILD_IDS = new Set([6200]);

class MvpHdV2Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.exports = null;
    this.engineBuildId = 0;
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
    this.appliedState = this.normalizeState({});
    this.appliedSignature = this.stateSignature(this.appliedState);
    this.inputEnergy = 0;
    this.outputEnergy = 0;
    this.energySamples = 0;
    this.inputPeak = 0;
    this.outputPeak = 0;
    this.totalClipCount = 0;
    this.totalNanCount = 0;

    this.port.onmessage = (event) => {
      const message = event.data || {};

      if (
        (message.type === "INIT_WASM" || message.type === "init") &&
        message.wasmBytes instanceof ArrayBuffer
      ) {
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
          requestId: Number(message.requestId) || 0,
          revision: this.appliedRevision,
          engineBuildId: this.engineBuildId,
        });
        return;
      }

      if (message.type === "RESET_ENGINE" || message.type === "reset") {
        if (this.ready && this.exports) this.exports.mvp_v2_reset();
        return;
      }

      if (
        message.type === "RESET_METERS" ||
        message.type === "reset-loudness"
      ) {
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
          appliedState: this.appliedState,
          signature: this.appliedSignature,
          proofMute: this.proofMute,
          engineBuildId: this.engineBuildId,
        });
      }
    };
  }

  clamp(value, lo, hi, fallback = lo) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  }

  normalizeState(raw) {
    const explicitMode = String(raw.mode || "");
    const mode =
      explicitMode === "pure" ||
      explicitMode === "adaptive" ||
      explicitMode === "power"
        ? explicitMode
        : Boolean(raw.bypass)
          ? "pure"
          : "adaptive";

    const pc = Number(raw.outputProfileCode);
    const outputProfile =
      raw.outputProfile === "car_hifi" ||
      raw.outputProfile === "headphones" ||
      raw.outputProfile === "speaker"
        ? raw.outputProfile
        : pc === 2
          ? "speaker"
          : pc === 1
            ? "headphones"
            : "car_hifi";

    const tight = this.clamp(raw.bassTightness, 0, 1, 0.5);
    const eq = Array.isArray(raw.eqGains) ? raw.eqGains.slice(0, 31) : [];
    while (eq.length < 31) eq.push(0);

    return {
      mode,
      outputProfile,
      intensity: this.clamp(
        raw.intensity ?? raw.broadcastIntensity,
        0,
        1,
        0.72,
      ),
      bassEnabled: Boolean(
        raw.bassEnabled ??
          raw.broadcastBassEnabled ??
          raw.bassEngineEnabled,
      ),
      bassCharacter: this.clamp(
        raw.bassCharacter ?? raw.broadcastBassCharacter,
        0,
        1,
        1 - tight,
      ),
      impactEnabled: Boolean(
        raw.impactEnabled ??
          raw.broadcastImpactEnabled ??
          raw.transientEnabled,
      ),
      clarityEnabled: Boolean(
        raw.clarityEnabled ??
          raw.broadcastClarityEnabled ??
          raw.toneEngineEnabled,
      ),
      spatialEnabled: Boolean(
        raw.spatialEnabled ??
          raw.broadcastSpatialEnabled ??
          raw.stereoFieldEnabled ??
          raw.headphoneEnabled,
      ),
      spaceMode:
        raw.spaceMode === "stage3d" ||
        raw.spaceMode === "arena" ||
        raw.spaceMode === "live" ||
        raw.spaceMode === "studio"
          ? raw.spaceMode
          : Number(raw.broadcastSpaceModeCode) === 3
            ? "stage3d"
            : Number(raw.broadcastSpaceModeCode) === 2
              ? "arena"
              : Number(raw.broadcastSpaceModeCode) === 1
                ? "live"
                : "studio",
      personalEnabled: Boolean(
        raw.personalEnabled ?? raw.broadcastPersonalEnabled,
      ),
      personalBass: this.clamp(
        raw.personalBass ?? raw.broadcastPersonalBass,
        -1,
        1,
        0,
      ),
      personalPresence: this.clamp(
        raw.personalPresence ?? raw.broadcastPersonalPresence,
        -1,
        1,
        0,
      ),
      personalBrightness: this.clamp(
        raw.personalBrightness ?? raw.broadcastPersonalBrightness,
        -1,
        1,
        0,
      ),
      masterPrepEnabled: Boolean(raw.masterPrepEnabled),
      masterSourceGainDb: this.clamp(raw.masterSourceGainDb, 0, 3, 0),
      masterHighpassHz: this.clamp(raw.masterHighpassHz, 18, 40, 18),
      masterLowMidDb: this.clamp(raw.masterLowMidDb, -3, 2, 0),
      masterPresenceDb: this.clamp(raw.masterPresenceDb, -2, 2, 0),
      masterHarshnessDb: this.clamp(raw.masterHarshnessDb, -3, 1, 0),
      masterBalanceDb: this.clamp(raw.masterBalanceDb, -1.5, 1.5, 0),
      masterWidthScale: this.clamp(raw.masterWidthScale, 0.75, 1.1, 1),
      eqEnabled: Boolean(raw.eqEnabled),
      eqGains: eq.map((value) => this.clamp(value, -12, 12, 0)),
    };
  }

  stateSignature(s) {
    return JSON.stringify([
      s.mode,
      s.outputProfile,
      +s.intensity.toFixed(4),
      s.bassEnabled,
      +s.bassCharacter.toFixed(4),
      s.impactEnabled,
      s.clarityEnabled,
      s.spatialEnabled,
      s.spaceMode,
      s.personalEnabled,
      +s.personalBass.toFixed(4),
      +s.personalPresence.toFixed(4),
      +s.personalBrightness.toFixed(4),
      s.masterPrepEnabled,
      +s.masterSourceGainDb.toFixed(3),
      +s.masterHighpassHz.toFixed(2),
      +s.masterLowMidDb.toFixed(3),
      +s.masterPresenceDb.toFixed(3),
      +s.masterHarshnessDb.toFixed(3),
      +s.masterBalanceDb.toFixed(3),
      +s.masterWidthScale.toFixed(3),
      s.eqEnabled,
      ...s.eqGains.map((value) => +value.toFixed(3)),
    ]);
  }

  nativeStateMismatch(next) {
    const ex = this.exports;
    if (!ex) return "WASM exports unavailable";

    const near = (actual, expected, tolerance = 0.0002) =>
      Math.abs(Number(actual) - Number(expected)) <= tolerance;

    const mode = next.mode === "power" ? 2 : next.mode === "adaptive" ? 1 : 0;
    const profile =
      next.outputProfile === "speaker"
        ? 2
        : next.outputProfile === "headphones"
          ? 1
          : 0;
    const space =
      next.spaceMode === "stage3d" ? 3 : next.spaceMode === "arena" ? 2 : next.spaceMode === "live" ? 1 : 0;

    if (!MVP_V62_SUPPORTED_ENGINE_BUILD_IDS.has(Number(ex.mvp_v2_build_id())))
      return "engine build id";
    if (Number(ex.mvp_v2_get_mode()) !== mode) return "mode";
    if (Number(ex.mvp_v2_get_output_profile()) !== profile)
      return "output profile";
    if (!near(ex.mvp_v2_get_intensity(), next.intensity))
      return "intensity";
    if (Boolean(ex.mvp_v2_get_bass_enabled()) !== next.bassEnabled)
      return "bass enabled";
    if (!near(ex.mvp_v2_get_bass_character(), next.bassCharacter))
      return "bass character";
    if (Boolean(ex.mvp_v2_get_impact_enabled()) !== next.impactEnabled)
      return "impact";
    if (Boolean(ex.mvp_v2_get_clarity_enabled()) !== next.clarityEnabled)
      return "clarity";
    if (Boolean(ex.mvp_v2_get_spatial_enabled()) !== next.spatialEnabled)
      return "spatial";
    if (Number(ex.mvp_v2_get_space_mode()) !== space) return "space mode";
    if (
      Boolean(ex.mvp_v2_get_personal_enabled()) !== next.personalEnabled
    )
      return "personal enabled";
    if (!near(ex.mvp_v2_get_personal_bass(), next.personalBass))
      return "personal bass";
    if (!near(ex.mvp_v2_get_personal_presence(), next.personalPresence))
      return "personal presence";
    if (
      !near(
        ex.mvp_v2_get_personal_brightness(),
        next.personalBrightness,
      )
    )
      return "personal brightness";
    if (Boolean(ex.mvp_v2_get_eq_enabled()) !== next.eqEnabled)
      return "eq enabled";

    for (let i = 0; i < 31; i += 1) {
      if (!near(ex.mvp_v2_get_eq_band(i), next.eqGains[i], 0.001)) {
        return "eq band " + i;
      }
    }

    return null;
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

      const { instance } = await WebAssembly.instantiate(
        wasmBytes,
        imports,
      );

      const ex = instance.exports;
      const memory = ex.memory;

      const required = [
        "mvp_v2_build_id",
        "mvp_v2_input_l",
        "mvp_v2_input_r",
        "mvp_v2_output_l",
        "mvp_v2_output_r",
        "mvp_v2_max_frames",
        "mvp_v2_init",
        "mvp_v2_reset",
        "mvp_v2_reset_meters",
        "mvp_v2_set_mode",
        "mvp_v2_set_output_profile",
        "mvp_v2_set_intensity",
        "mvp_v2_set_bass_enabled",
        "mvp_v2_set_bass_character",
        "mvp_v2_set_impact_enabled",
        "mvp_v2_set_clarity_enabled",
        "mvp_v2_set_spatial_enabled",
        "mvp_v2_set_space_mode",
        "mvp_v2_set_personal_enabled",
        "mvp_v2_set_personal_bass",
        "mvp_v2_set_personal_presence",
        "mvp_v2_set_personal_brightness",
        "mvp_v2_set_master_prep",
        "mvp_v2_set_eq_enabled",
        "mvp_v2_set_eq_band",
        "mvp_v2_process",
        "mvp_v2_get_mode",
        "mvp_v2_get_output_profile",
        "mvp_v2_get_intensity",
        "mvp_v2_get_bass_enabled",
        "mvp_v2_get_bass_character",
        "mvp_v2_get_impact_enabled",
        "mvp_v2_get_clarity_enabled",
        "mvp_v2_get_spatial_enabled",
        "mvp_v2_get_space_mode",
        "mvp_v2_get_personal_enabled",
        "mvp_v2_get_personal_bass",
        "mvp_v2_get_personal_presence",
        "mvp_v2_get_personal_brightness",
        "mvp_v2_get_eq_enabled",
        "mvp_v2_get_eq_band",
        "mvp_v2_meter_true_peak_dbtp",
        "mvp_v2_meter_limiter_gr_db",
        "mvp_v2_meter_clip_count",
        "mvp_v2_meter_nan_count",
        "mvp_v2_meter_multiband_gr_db",
        "mvp_v2_meter_impact_boost_db",
        "mvp_v2_meter_bass_activity_db",
        "mvp_v2_meter_clarity_activity_db",
        "mvp_v2_meter_spatial_width_percent",
      ];

      for (const name of required) {
        if (typeof ex[name] !== "function") {
          throw new Error("Missing Broadcast V5.6 WASM export: " + name);
        }
      }

      if (!(memory instanceof WebAssembly.Memory)) {
        throw new Error("Broadcast V5.6 WASM memory export is missing");
      }

      const buildId = Number(ex.mvp_v2_build_id());
      if (!MVP_V62_SUPPORTED_ENGINE_BUILD_IDS.has(buildId)) {
        throw new Error(
          "Wrong Broadcast WASM binary. Expected build " +
            MVP_V62_ENGINE_BUILD_ID +
            ", received " +
            buildId,
        );
      }

      this.engineBuildId = buildId;

      const maxFrames = Number(ex.mvp_v2_max_frames());
      if (!Number.isFinite(maxFrames) || maxFrames < 128) {
        throw new Error(
          "Invalid V5.6 max frame count: " + maxFrames,
        );
      }

      if (ex.mvp_v2_init(sampleRate) !== 1) {
        throw new Error(
          "Broadcast V5.6 rejected sample rate " + sampleRate,
        );
      }

      this.exports = ex;
      this.maxFrames = maxFrames;
      this.inputL = new Float32Array(
        memory.buffer,
        Number(ex.mvp_v2_input_l()),
        maxFrames,
      );
      this.inputR = new Float32Array(
        memory.buffer,
        Number(ex.mvp_v2_input_r()),
        maxFrames,
      );
      this.outputL = new Float32Array(
        memory.buffer,
        Number(ex.mvp_v2_output_l()),
        maxFrames,
      );
      this.outputR = new Float32Array(
        memory.buffer,
        Number(ex.mvp_v2_output_r()),
        maxFrames,
      );

      this.ready = true;
      this.applyPendingState();

      this.port.postMessage({
        type: "READY",
        legacyType: "ready",
        version: "broadcast-v6-2-direct-stereo-authority",
        engineBuildId: this.engineBuildId,
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

  applyPendingState() {
    if (!this.ready || !this.exports || !this.pendingState) return;

    const next = this.normalizeState(this.pendingState.state);
    const ex = this.exports;

    ex.mvp_v2_set_mode(
      next.mode === "power" ? 2 : next.mode === "adaptive" ? 1 : 0,
    );
    ex.mvp_v2_set_output_profile(
      next.outputProfile === "speaker"
        ? 2
        : next.outputProfile === "headphones"
          ? 1
          : 0,
    );
    ex.mvp_v2_set_intensity(next.intensity);
    ex.mvp_v2_set_bass_enabled(next.bassEnabled ? 1 : 0);
    ex.mvp_v2_set_bass_character(next.bassCharacter);
    ex.mvp_v2_set_impact_enabled(next.impactEnabled ? 1 : 0);
    ex.mvp_v2_set_clarity_enabled(next.clarityEnabled ? 1 : 0);
    ex.mvp_v2_set_spatial_enabled(next.spatialEnabled ? 1 : 0);
    ex.mvp_v2_set_space_mode(
      next.spaceMode === "stage3d" ? 3 : next.spaceMode === "arena" ? 2 : next.spaceMode === "live" ? 1 : 0,
    );
    ex.mvp_v2_set_personal_enabled(next.personalEnabled ? 1 : 0);
    ex.mvp_v2_set_personal_bass(next.personalBass);
    ex.mvp_v2_set_personal_presence(next.personalPresence);
    ex.mvp_v2_set_personal_brightness(next.personalBrightness);
    ex.mvp_v2_set_master_prep(
      next.masterPrepEnabled ? 1 : 0,
      next.masterSourceGainDb,
      next.masterHighpassHz,
      next.masterLowMidDb,
      next.masterPresenceDb,
      next.masterHarshnessDb,
      next.masterBalanceDb,
      next.masterWidthScale,
    );
    ex.mvp_v2_set_eq_enabled(next.eqEnabled ? 1 : 0);

    for (let i = 0; i < 31; i += 1) {
      ex.mvp_v2_set_eq_band(i, next.eqGains[i]);
    }

    const mismatch = this.nativeStateMismatch(next);
    if (mismatch) {
      this.port.postMessage({
        type: "ERROR",
        legacyType: "error",
        message:
          "Broadcast V5.6 C++ state readback mismatch: " + mismatch,
      });
      return;
    }

    this.appliedState = next;
    this.appliedRevision = this.pendingState.revision;
    this.pendingState = null;
    this.appliedSignature = this.stateSignature(next);

    this.port.postMessage({
      type: "STATE_APPLIED",
      legacyType: "state-applied",
      revision: this.appliedRevision,
      appliedState: next,
      state: next,
      signature: this.appliedSignature,
      engineBuildId: this.engineBuildId,
    });
  }

  writePassThrough(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output?.[0]) return;

    const inL = input?.[0] || null;
    const inR = input?.[1] || inL;
    const outL = output[0];
    const outR = output[1] || null;

    for (let i = 0; i < outL.length; i += 1) {
      const l = inL ? inL[i] || 0 : 0;
      const r = inR ? inR[i] || 0 : l;
      outL[i] = this.proofMute ? 0 : l;
      if (outR) outR[i] = this.proofMute ? 0 : r;
    }
  }

  process(inputs, outputs) {
    if (
      !this.ready ||
      !this.exports ||
      !this.inputL ||
      !this.inputR ||
      !this.outputL ||
      !this.outputR
    ) {
      this.writePassThrough(inputs, outputs);
      return true;
    }

    const input = inputs[0];
    const output = outputs[0];
    if (!output?.[0]) return true;

    const inL = input?.[0] || null;
    const inR = input?.[1] || inL;
    const outL = output[0];
    const outR = output[1] || null;
    const frames = outL.length;

    let offset = 0;

    while (offset < frames) {
      const chunk = Math.min(this.maxFrames, frames - offset);

      for (let i = 0; i < chunk; i += 1) {
        const k = offset + i;
        const l = inL ? inL[k] || 0 : 0;
        const r = inR ? inR[k] || 0 : l;
        this.inputL[i] = l;
        this.inputR[i] = r;
      }

      const ok = this.exports.mvp_v2_process(chunk);

      for (let i = 0; i < chunk; i += 1) {
        const k = offset + i;
        const li = inL ? inL[k] || 0 : 0;
        const ri = inR ? inR[k] || 0 : li;
        const processedL = ok === 1 ? this.outputL[i] : li;
        const processedR = ok === 1 ? this.outputR[i] : ri;
        const l = this.proofMute ? 0 : processedL;
        const r = this.proofMute ? 0 : processedR;

        outL[k] = l;
        if (outR) outR[k] = r;

        this.inputEnergy += li * li + ri * ri;
        this.outputEnergy += l * l + r * r;
        this.energySamples += 2;
        this.inputPeak = Math.max(
          this.inputPeak,
          Math.abs(li),
          Math.abs(ri),
        );
        this.outputPeak = Math.max(
          this.outputPeak,
          Math.abs(l),
          Math.abs(r),
        );
      }

      offset += chunk;
    }

    if (this.telemetryEnabled) {
      this.telemetryCountdown -= frames;

      if (this.telemetryCountdown <= 0) {
        this.telemetryCountdown = Math.max(
          128,
          Math.floor(sampleRate / 8),
        );

        const n = Math.max(1, this.energySamples);
        const inputRms = Math.sqrt(this.inputEnergy / n);
        const outputRms = Math.sqrt(this.outputEnergy / n);
        const delta =
          inputRms > 1e-8 && outputRms > 1e-8
            ? 20 * Math.log10(outputRms / inputRms)
            : outputRms <= 1e-8
              ? -120
              : 0;

        const clips = Number(
          this.exports.mvp_v2_meter_clip_count(),
        );
        const nans = Number(
          this.exports.mvp_v2_meter_nan_count(),
        );

        this.totalClipCount += clips;
        this.totalNanCount += nans;

        this.port.postMessage({
          type: "TELEMETRY",
          legacyType: "telemetry",
          revision: this.appliedRevision,
          state: this.appliedState,
          signature: this.appliedSignature,
          proofMute: this.proofMute,
          engineBuildId: this.engineBuildId,
          inputRms,
          outputRms,
          inputPeak: this.inputPeak,
          outputPeak: this.outputPeak,
          rmsDeltaDb: delta,
          truePeakDbtp: Number(
            this.exports.mvp_v2_meter_true_peak_dbtp(),
          ),
          limiterGrDb: Number(
            this.exports.mvp_v2_meter_limiter_gr_db(),
          ),
          limiterGrDbMaxSinceInit: Number(
            this.exports.mvp_v2_meter_limiter_gr_db(),
          ),
          clipCount: this.totalClipCount,
          nanCount: this.totalNanCount,
          multibandGainReductionDb: Number(
            this.exports.mvp_v2_meter_multiband_gr_db(),
          ),
          impactBoostDb: Number(
            this.exports.mvp_v2_meter_impact_boost_db(),
          ),
          bassActivityDb: Number(
            this.exports.mvp_v2_meter_bass_activity_db(),
          ),
          clarityActivityDb: Number(
            this.exports.mvp_v2_meter_clarity_activity_db(),
          ),
          spatialWidthPercent: Number(
            this.exports.mvp_v2_meter_spatial_width_percent(),
          ),
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
