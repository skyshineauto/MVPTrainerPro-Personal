// MVP Trainer Pro R78 Master Prep DSP.
// Technical source correction only. No limiter, compressor, spatializer or creative effect lives here.

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
}

function dbToGain(db) {
  return 10 ** (clamp(db, -24, 12) / 20);
}

class Biquad {
  constructor(sampleRate) {
    this.sampleRate = Math.max(8000, Number(sampleRate) || 48000);
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.z1 = 0;
    this.z2 = 0;
  }

  reset() {
    this.z1 = 0;
    this.z2 = 0;
  }

  setNormalized(b0, b1, b2, a0, a1, a2) {
    const inv = Math.abs(a0) > 1e-12 ? 1 / a0 : 1;
    this.b0 = b0 * inv;
    this.b1 = b1 * inv;
    this.b2 = b2 * inv;
    this.a1 = a1 * inv;
    this.a2 = a2 * inv;
  }

  setHighpass(frequency, q = 0.70710678) {
    const hz = clamp(frequency, 8, Math.min(180, this.sampleRate * 0.22));
    const omega = 2 * Math.PI * hz / this.sampleRate;
    const cos = Math.cos(omega);
    const sin = Math.sin(omega);
    const alpha = sin / (2 * Math.max(0.15, q));
    this.setNormalized((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
  }

  setPeak(frequency, gainDb, q = 0.9) {
    const hz = clamp(frequency, 20, this.sampleRate * 0.45);
    const gain = clamp(gainDb, -4, 4);
    if (Math.abs(gain) < 0.001) {
      this.setNormalized(1, 0, 0, 1, 0, 0);
      return;
    }
    const A = 10 ** (gain / 40);
    const omega = 2 * Math.PI * hz / this.sampleRate;
    const cos = Math.cos(omega);
    const sin = Math.sin(omega);
    const alpha = sin / (2 * Math.max(0.15, q));
    this.setNormalized(
      1 + alpha * A,
      -2 * cos,
      1 - alpha * A,
      1 + alpha / A,
      -2 * cos,
      1 - alpha / A,
    );
  }

  process(sample) {
    const x = Number.isFinite(sample) ? sample : 0;
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return Number.isFinite(y) ? y : 0;
  }
}

const MVP_MASTER_PREP_NEUTRAL = Object.freeze({
  enabled: false,
  sourceGainDb: 0,
  highpassHz: 18,
  lowMidDb: 0,
  presenceDb: 0,
  harshnessDb: 0,
  channelBalanceDb: 0,
  widthScale: 1,
  reasons: [],
});

class MvpMasterPrepProcessor {
  constructor(sampleRate) {
    this.sampleRate = Math.max(8000, Number(sampleRate) || 48000);
    this.hpL = new Biquad(this.sampleRate);
    this.hpR = new Biquad(this.sampleRate);
    this.lowMidL = new Biquad(this.sampleRate);
    this.lowMidR = new Biquad(this.sampleRate);
    this.presenceL = new Biquad(this.sampleRate);
    this.presenceR = new Biquad(this.sampleRate);
    this.harshL = new Biquad(this.sampleRate);
    this.harshR = new Biquad(this.sampleRate);
    this.profile = { ...MVP_MASTER_PREP_NEUTRAL };
    this.sourceGain = 1;
    this.leftGain = 1;
    this.rightGain = 1;
    this.widthScale = 1;
    this.update(this.profile);
  }

  update(profile) {
    const next = profile && typeof profile === "object" ? profile : MVP_MASTER_PREP_NEUTRAL;
    this.profile = {
      enabled: Boolean(next.enabled),
      sourceGainDb: clamp(next.sourceGainDb, 0, 1.5),
      highpassHz: clamp(next.highpassHz, 16, 32),
      lowMidDb: clamp(next.lowMidDb, -1.5, 0.6),
      presenceDb: clamp(next.presenceDb, -0.7, 0.7),
      harshnessDb: clamp(next.harshnessDb, -1.5, 0.3),
      channelBalanceDb: clamp(next.channelBalanceDb, -0.8, 0.8),
      widthScale: clamp(next.widthScale, 0.86, 1.02),
      reasons: Array.isArray(next.reasons) ? next.reasons.slice(0, 8) : [],
    };
    this.sourceGain = dbToGain(this.profile.sourceGainDb);
    const balance = this.profile.channelBalanceDb;
    this.leftGain = balance > 0 ? dbToGain(-balance) : 1;
    this.rightGain = balance < 0 ? dbToGain(balance) : 1;
    this.widthScale = this.profile.widthScale;
    this.hpL.setHighpass(this.profile.highpassHz);
    this.hpR.setHighpass(this.profile.highpassHz);
    this.lowMidL.setPeak(310, this.profile.lowMidDb, 0.85);
    this.lowMidR.setPeak(310, this.profile.lowMidDb, 0.85);
    this.presenceL.setPeak(2800, this.profile.presenceDb, 0.9);
    this.presenceR.setPeak(2800, this.profile.presenceDb, 0.9);
    this.harshL.setPeak(6500, this.profile.harshnessDb, 1.05);
    this.harshR.setPeak(6500, this.profile.harshnessDb, 1.05);
  }

  reset() {
    this.hpL.reset();
    this.hpR.reset();
    this.lowMidL.reset();
    this.lowMidR.reset();
    this.presenceL.reset();
    this.presenceR.reset();
    this.harshL.reset();
    this.harshR.reset();
  }

  processInto(inputL, inputR, outputL, outputR, frames) {
    if (!this.profile.enabled) {
      outputL.set(inputL.subarray(0, frames), 0);
      outputR.set((inputR || inputL).subarray(0, frames), 0);
      return;
    }
    const right = inputR || inputL;
    const sourceGain = this.sourceGain;
    const leftGain = this.leftGain;
    const rightGain = this.rightGain;
    const width = this.widthScale;
    for (let i = 0; i < frames; i += 1) {
      let l = this.hpL.process(inputL[i]);
      let r = this.hpR.process(right[i]);
      l = this.lowMidL.process(l);
      r = this.lowMidR.process(r);
      l = this.presenceL.process(l);
      r = this.presenceR.process(r);
      l = this.harshL.process(l);
      r = this.harshR.process(r);
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5 * width;
      outputL[i] = (mid + side) * leftGain * sourceGain;
      outputR[i] = (mid - side) * rightGain * sourceGain;
    }
  }
}

// R78f real Soundstage/Venue stage. It adds only short, bounded early reflections
// and stereo stage cues. There is no compressor/limiter here. The unchanged r77i
// core follows it and still owns final clean headroom and emergency Peak Guard.
class MvpVenueProcessor {
  constructor(sampleRateValue) {
    this.sampleRate = Math.max(8000, Number(sampleRateValue) || 48000);
    this.maxDelay = Math.max(2048, Math.ceil(this.sampleRate * 0.09));
    this.delayL = new Float32Array(this.maxDelay);
    this.delayR = new Float32Array(this.maxDelay);
    this.writeIndex = 0;
    this.lpL = 0;
    this.lpR = 0;
    this.update(null);
  }

  update(profile) {
    const value = profile && typeof profile === "object" ? profile : {};
    this.enabled = Boolean(value.enabled);
    this.width = clamp(value.widthScale, 1, 1.22);
    this.mix = clamp(value.reflectionMix, 0, 0.16);
    this.delayA = Math.max(1, Math.min(this.maxDelay - 2, Math.round(this.sampleRate * clamp(value.delayMsA, 4, 55) / 1000)));
    this.delayB = Math.max(1, Math.min(this.maxDelay - 2, Math.round(this.sampleRate * clamp(value.delayMsB, 7, 75) / 1000)));
    this.damping = clamp(value.damping, 0.16, 0.62);
  }

  reset() {
    this.delayL.fill(0);
    this.delayR.fill(0);
    this.writeIndex = 0;
    this.lpL = 0;
    this.lpR = 0;
  }

  processInto(inputL, inputR, outputL, outputR, frames) {
    const right = inputR || inputL;
    if (!this.enabled || this.mix <= 0.0001) {
      outputL.set(inputL.subarray(0, frames), 0);
      outputR.set(right.subarray(0, frames), 0);
      return;
    }
    let write = this.writeIndex;
    let lpL = this.lpL;
    let lpR = this.lpR;
    const size = this.maxDelay;
    const width = this.width;
    const wet = this.mix;
    const damping = this.damping;
    for (let i = 0; i < frames; i += 1) {
      const l0 = Number.isFinite(inputL[i]) ? inputL[i] : 0;
      const r0 = Number.isFinite(right[i]) ? right[i] : 0;
      const mid = (l0 + r0) * 0.5;
      const side = (l0 - r0) * 0.5 * width;
      const l = mid + side;
      const r = mid - side;
      const a = (write - this.delayA + size) % size;
      const b = (write - this.delayB + size) % size;
      const reflectedL = this.delayL[a] * 0.72 + this.delayR[b] * 0.28;
      const reflectedR = this.delayR[a] * 0.72 + this.delayL[b] * 0.28;
      lpL += damping * (reflectedL - lpL);
      lpR += damping * (reflectedR - lpR);
      outputL[i] = l + lpL * wet;
      outputR[i] = r + lpR * wet;
      this.delayL[write] = l;
      this.delayR[write] = r;
      write += 1;
      if (write >= size) write = 0;
    }
    this.writeIndex = write;
    this.lpL = lpL;
    this.lpR = lpR;
  }
}

// MVP Trainer Pro - MVP Studio WASM AudioWorklet V6.5 R78g Real Clean Loudness

// Master Prep runs before the unchanged r77i C++ core. The r77i core still owns
// EQ/effects, shared clean headroom, output gain and emergency-only Peak Guard.

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
    this.masterPrep = new MvpMasterPrepProcessor(sampleRate);
    this.venue = new MvpVenueProcessor(sampleRate);
    this.prepL = null;
    this.prepR = null;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "init" && data.wasmBytes) {
        void this.initialize(data.wasmBytes);
        return;
      }
      if (data.type === "state") {
        this.pendingState = data.state || null;
        this.stateRevision += 1;
        this.pendingExternalRevision = Number.isFinite(Number(data.revision))
          ? Math.max(0, Math.floor(Number(data.revision)))
          : this.stateRevision;
        return;
      }
      if (data.type === "master-prep") {
        this.masterPrep.update(data.profile || null);
        return;
      }
      if (data.type === "venue") {
        this.venue.update(data.profile || null);
        return;
      }
      if (data.type === "reset" && this.ready && this.exports?.mvp_reset) {
        this.exports.mvp_reset();
        this.masterPrep.reset();
        this.venue.reset();
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
      this.prepL = new Float32Array(this.maxFrames);
      this.prepR = new Float32Array(this.maxFrames);
      this.ready = true;
      this.port.postMessage({
        type: "ready",
        sampleRate,
        maxFrames: this.maxFrames,
        version: "studio-wasm-v6.5-r78g-real-clean-loudness",
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

    if (first || Boolean(state.bypass) !== Boolean(previous.bypass)) api.mvp_set_bypass(state.bypass ? 1 : 0);
    if (first || Boolean(state.eqEnabled) !== Boolean(previous.eqEnabled)) api.mvp_set_eq_enabled(state.eqEnabled ? 1 : 0);

    if (eqChanged) {
      for (let index = 0; index < 31; index += 1) {
        api.mvp_set_eq_band(index, Number.isFinite(Number(gains[index])) ? Number(gains[index]) : 0);
      }
      this.linearEqDirty = true;
      this.linearCommitFrames = Math.max(1, Math.round(sampleRate * 0.12));
    }

    if (first || nextTopology !== previousTopology) {
      if (nextTopology === 1 && this.linearEqDirty && typeof api.mvp_commit_eq === "function") {
        api.mvp_commit_eq();
        this.linearEqDirty = false;
        this.linearCommitFrames = 0;
      }
      if (typeof api.mvp_set_eq_topology === "function") api.mvp_set_eq_topology(nextTopology);
    }

    if (first || !this.sameNumber(state.preampDb, previous.preampDb)) api.mvp_set_preamp_db(Number.isFinite(Number(state.preampDb)) ? Number(state.preampDb) : 0);
    if (first || !this.sameNumber(state.headroomDb, previous.headroomDb)) api.mvp_set_headroom_db(Number.isFinite(Number(state.headroomDb)) ? Number(state.headroomDb) : 0);

    if (first || Boolean(state.transientEnabled) !== Boolean(previous.transientEnabled) || !this.sameNumber(state.transientAmount, previous.transientAmount)) {
      if (typeof api.mvp_set_transient === "function") api.mvp_set_transient(state.transientEnabled ? 1 : 0, Number.isFinite(Number(state.transientAmount)) ? Number(state.transientAmount) : 0);
    }
    if (first || Boolean(state.multibandEnabled) !== Boolean(previous.multibandEnabled) || !this.sameNumber(state.multibandAmount, previous.multibandAmount)) {
      if (typeof api.mvp_set_multiband === "function") api.mvp_set_multiband(state.multibandEnabled ? 1 : 0, Number.isFinite(Number(state.multibandAmount)) ? Number(state.multibandAmount) : 1);
    }
    if (first || Boolean(state.dynamicEqEnabled) !== Boolean(previous.dynamicEqEnabled) || !this.sameNumber(state.dynamicEqAmount, previous.dynamicEqAmount)) {
      if (typeof api.mvp_set_dynamic_eq === "function") api.mvp_set_dynamic_eq(state.dynamicEqEnabled ? 1 : 0, Number.isFinite(Number(state.dynamicEqAmount)) ? Number(state.dynamicEqAmount) : 0.72);
    }
    if (first || Boolean(state.outputCorrectionEnabled) !== Boolean(previous.outputCorrectionEnabled) || !this.sameNumber(state.outputCorrectionAmount, previous.outputCorrectionAmount)) {
      if (typeof api.mvp_set_output_correction === "function") api.mvp_set_output_correction(state.outputCorrectionEnabled ? 1 : 0, Number.isFinite(Number(state.outputCorrectionAmount)) ? Number(state.outputCorrectionAmount) : 1);
    }
    if (first || Boolean(state.stereoIntegrityEnabled) !== Boolean(previous.stereoIntegrityEnabled) || !this.sameNumber(state.stereoIntegrityAmount, previous.stereoIntegrityAmount)) {
      if (typeof api.mvp_set_stereo_integrity === "function") api.mvp_set_stereo_integrity(state.stereoIntegrityEnabled ? 1 : 0, Number.isFinite(Number(state.stereoIntegrityAmount)) ? Number(state.stereoIntegrityAmount) : 1);
    }
    if (first || Boolean(state.normalizationEnabled) !== Boolean(previous.normalizationEnabled) || !this.sameNumber(state.normalizationTargetLufs, previous.normalizationTargetLufs)) {
      if (typeof api.mvp_set_loudness === "function") api.mvp_set_loudness(state.normalizationEnabled ? 1 : 0, Number.isFinite(Number(state.normalizationTargetLufs)) ? Number(state.normalizationTargetLufs) : -10);
    }
    if (first || Boolean(state.limiterEnabled) !== Boolean(previous.limiterEnabled) || !this.sameNumber(state.limiterCeilingDb, previous.limiterCeilingDb)) {
      api.mvp_set_limiter(state.limiterEnabled ? 1 : 0, Number.isFinite(Number(state.limiterCeilingDb)) ? Number(state.limiterCeilingDb) : -1);
    }
    if (first || !this.sameNumber(state.outputProfileCode, previous.outputProfileCode)) api.mvp_set_output_profile(Number.isFinite(Number(state.outputProfileCode)) ? Number(state.outputProfileCode) : 0);

    const headphoneChanged = first || Boolean(state.headphoneEnabled) !== Boolean(previous.headphoneEnabled) ||
      !this.sameNumber(state.headphoneWidth, previous.headphoneWidth) || !this.sameNumber(state.headphoneDepth, previous.headphoneDepth) ||
      !this.sameNumber(state.headphoneCrossfeed, previous.headphoneCrossfeed) || !this.sameNumber(state.headphoneCenter, previous.headphoneCenter) ||
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
      first ||
      Boolean(state.autoMakeupEnabled) !== Boolean(previous.autoMakeupEnabled) ||
      Boolean(state.highOutputEnabled) !== Boolean(previous.highOutputEnabled) ||
      !this.sameNumber(state.outputReserveDb, previous.outputReserveDb)
    )) {
      api.mvp_set_output_gain(
        state.autoMakeupEnabled ? 1 : 0,
        Number(state.outputReserveDb) || 0,
        state.highOutputEnabled ? 1 : 0,
      );
    }
    if (typeof api.mvp_set_parametric_enabled === "function" && (first || Boolean(state.parametricEnabled) !== Boolean(previous.parametricEnabled))) api.mvp_set_parametric_enabled(state.parametricEnabled ? 1 : 0);
    if (typeof api.mvp_set_parametric_band === "function") {
      const bands = Array.isArray(state.parametricBands) ? state.parametricBands : [];
      const oldBands = Array.isArray(previous?.parametricBands) ? previous.parametricBands : [];
      for (let index = 0; index < 6; index += 1) {
        const band = bands[index] || {};
        const old = oldBands[index] || {};
        const changed = first || Boolean(band.enabled) !== Boolean(old.enabled) || !this.sameNumber(band.frequency, old.frequency) || !this.sameNumber(band.gainDb, old.gainDb) || !this.sameNumber(band.q, old.q) || !this.sameNumber(band.type, old.type);
        if (changed) api.mvp_set_parametric_band(index, band.enabled ? 1 : 0, Number(band.frequency) || 1000, Number(band.gainDb) || 0, Number(band.q) || 1, Number(band.type) || 0);
      }
    }
    if (typeof api.mvp_set_bass_engine === "function" && (first || Boolean(state.bassEngineEnabled) !== Boolean(previous.bassEngineEnabled) || !this.sameNumber(state.bassSubDb, previous.bassSubDb) || !this.sameNumber(state.bassPunchDb, previous.bassPunchDb) || !this.sameNumber(state.bassBodyDb, previous.bassBodyDb) || !this.sameNumber(state.bassTightness, previous.bassTightness))) {
      api.mvp_set_bass_engine(state.bassEngineEnabled ? 1 : 0, Number(state.bassSubDb)||0, Number(state.bassPunchDb)||0, Number(state.bassBodyDb)||0, Number(state.bassTightness)||0);
    }
    if (typeof api.mvp_set_tone_engine === "function" && (first || Boolean(state.toneEngineEnabled) !== Boolean(previous.toneEngineEnabled) || !this.sameNumber(state.presenceDb, previous.presenceDb) || !this.sameNumber(state.clarityDb, previous.clarityDb) || !this.sameNumber(state.airDb, previous.airDb) || !this.sameNumber(state.deharshAmount, previous.deharshAmount))) {
      api.mvp_set_tone_engine(state.toneEngineEnabled ? 1 : 0, Number(state.presenceDb)||0, Number(state.clarityDb)||0, Number(state.airDb)||0, Number(state.deharshAmount)||0);
    }
    if (typeof api.mvp_set_exciter === "function" && (first || Boolean(state.exciterEnabled) !== Boolean(previous.exciterEnabled) || !this.sameNumber(state.exciterAmount, previous.exciterAmount) || !this.sameNumber(state.saturationLow, previous.saturationLow) || !this.sameNumber(state.saturationMid, previous.saturationMid) || !this.sameNumber(state.saturationHigh, previous.saturationHigh))) {
      api.mvp_set_exciter(state.exciterEnabled ? 1 : 0, Number(state.exciterAmount)||0, Number(state.saturationLow)||0, Number(state.saturationMid)||0, Number(state.saturationHigh)||0);
    }
    if (typeof api.mvp_set_stereo_field === "function" && (first || Boolean(state.stereoFieldEnabled) !== Boolean(previous.stereoFieldEnabled) || !this.sameNumber(state.stereoUserWidth, previous.stereoUserWidth) || !this.sameNumber(state.stereoCenterFocus, previous.stereoCenterFocus) || !this.sameNumber(state.bassMonoHz, previous.bassMonoHz))) {
      api.mvp_set_stereo_field(state.stereoFieldEnabled ? 1 : 0, Number(state.stereoUserWidth)||1, Number(state.stereoCenterFocus)||1, Number(state.bassMonoHz)||100);
    }
    if (typeof api.mvp_set_dynamics_restore === "function" && (first || Boolean(state.dynamicsRestoreEnabled) !== Boolean(previous.dynamicsRestoreEnabled) || !this.sameNumber(state.dynamicsRestoreAmount, previous.dynamicsRestoreAmount))) api.mvp_set_dynamics_restore(state.dynamicsRestoreEnabled ? 1 : 0, Number(state.dynamicsRestoreAmount)||0);
    if (typeof api.mvp_set_smart_dsp === "function" && (first || Boolean(state.smartDspEnabled) !== Boolean(previous.smartDspEnabled) || !this.sameNumber(state.smartDspAmount, previous.smartDspAmount))) api.mvp_set_smart_dsp(state.smartDspEnabled ? 1 : 0, Number(state.smartDspAmount)||0);
    if (typeof api.mvp_set_headphone_advanced === "function" && (first || Boolean(state.headphoneAdvancedEnabled) !== Boolean(previous.headphoneAdvancedEnabled) || !this.sameNumber(state.headphoneSpeakerAngle, previous.headphoneSpeakerAngle) || !this.sameNumber(state.headphoneDistance, previous.headphoneDistance) || !this.sameNumber(state.headphoneReflections, previous.headphoneReflections) || !this.sameNumber(state.headphoneWet, previous.headphoneWet))) {
      api.mvp_set_headphone_advanced(state.headphoneAdvancedEnabled ? 1 : 0, Number(state.headphoneSpeakerAngle)||30, Number(state.headphoneDistance)||0.35, Number(state.headphoneReflections)||0, Number(state.headphoneWet)||0);
    }

    this.appliedState = { ...state, eqGains: gains.slice(0, 31) };
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
      highOutputEnabled: Boolean(state.highOutputEnabled),
      autoMakeupEnabled: Boolean(state.autoMakeupEnabled),
      smartDspEnabled: Boolean(state.smartDspEnabled),
    });
  }

  maybeCommitLinearEq(frames) {
    if (!this.linearEqDirty || !this.appliedState || !this.exports) return;
    if (Number(this.appliedState.eqTopologyCode) !== 1) return;
    this.linearCommitFrames -= frames;
    if (this.linearCommitFrames > 0) return;
    if (typeof this.exports.mvp_commit_eq === "function") this.exports.mvp_commit_eq();
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
    if (inL) outL.set(inL); else outL.fill(0);
    if (outR !== outL) {
      if (inR) outR.set(inR); else outR.fill(0);
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

    if (this.inputL.buffer !== this.memory.buffer) this.refreshViews();

    // R78f: source -> Master Prep (recovery-only) -> Venue early reflections/stage ->
    // unchanged r77i WASM EQ/effects/shared clean output/emergency Peak Guard.
    if (!this.prepL || !this.prepR) {
      this.copyBypass(input, output);
      return true;
    }
    this.masterPrep.processInto(inL, inR || inL, this.prepL, this.prepR, frames);
    this.venue.processInto(this.prepL, this.prepR, this.inputL, this.inputR, frames);

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
        transientBoostDb: typeof this.exports.mvp_meter_transient_boost_db === "function" ? this.exports.mvp_meter_transient_boost_db() : 0,
        multibandGainReductionDb: typeof this.exports.mvp_meter_multiband_gain_reduction_db === "function" ? this.exports.mvp_meter_multiband_gain_reduction_db() : 0,
        multibandBandReductionDb: typeof this.exports.mvp_meter_multiband_band_reduction_db === "function" ? [0, 1, 2, 3].map((band) => this.exports.mvp_meter_multiband_band_reduction_db(band)) : [0, 0, 0, 0],
        dynamicEqGainReductionDb: typeof this.exports.mvp_meter_dynamic_eq_gain_reduction_db === "function" ? this.exports.mvp_meter_dynamic_eq_gain_reduction_db() : 0,
        dynamicEqBandReductionDb: typeof this.exports.mvp_meter_dynamic_eq_band_reduction_db === "function" ? [0, 1, 2, 3].map((band) => this.exports.mvp_meter_dynamic_eq_band_reduction_db(band)) : [0, 0, 0, 0],
        outputCorrectionReductionDb: typeof this.exports.mvp_meter_output_correction_reduction_db === "function" ? this.exports.mvp_meter_output_correction_reduction_db() : 0,
        stereoCorrelation: typeof this.exports.mvp_meter_stereo_correlation === "function" ? this.exports.mvp_meter_stereo_correlation() : 1,
        stereoWidthPercent: typeof this.exports.mvp_meter_stereo_width_percent === "function" ? this.exports.mvp_meter_stereo_width_percent() : 100,
        stereoGuardReductionDb: typeof this.exports.mvp_meter_stereo_guard_reduction_db === "function" ? this.exports.mvp_meter_stereo_guard_reduction_db() : 0,
        headphoneOutputDriveDb: typeof this.exports.mvp_meter_headphone_output_drive_db === "function" ? this.exports.mvp_meter_headphone_output_drive_db() : 0,
        loudnessGainDb: typeof this.exports.mvp_meter_loudness_gain_db === "function" ? this.exports.mvp_meter_loudness_gain_db() : 0,
        loudnessMomentaryLufs: typeof this.exports.mvp_meter_loudness_momentary_lufs === "function" ? this.exports.mvp_meter_loudness_momentary_lufs() : -70,
        loudnessProgramLufs: typeof this.exports.mvp_meter_loudness_program_lufs === "function" ? this.exports.mvp_meter_loudness_program_lufs() : -70,
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
