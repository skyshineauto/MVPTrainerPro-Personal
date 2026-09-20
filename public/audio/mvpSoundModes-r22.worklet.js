class MvpSoundModesProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "pure";
    this.generation = 0;
    this.pendingModeConfirmation = true;
    this.profile = null;
    this.profileTrackId = null;
    this.profileClass = "fallback";
    this.user = {
      dimensionEnabled: true,
      eqBassDb: 0,
      eqMidsDb: 0,
      eqTrebleDb: 0,
    };

    this.tone = {
      adaptive: this.createToneBank("adaptive"),
      power: this.createToneBank("power"),
    };
    this.settings = {
      adaptive: this.modeSettings("adaptive"),
      power: this.modeSettings("power"),
    };
    this.dimensionState = {
      adaptive: {
        lowSide1: 0,
        lowSide2: 0,
        midLow: 0,
        hpLow: 0,
        ap1X: 0,
        ap1Y: 0,
        ap2X: 0,
        ap2Y: 0,
      },
      power: {
        lowSide1: 0,
        lowSide2: 0,
        midLow: 0,
        hpLow: 0,
        ap1X: 0,
        ap1Y: 0,
        ap2X: 0,
        ap2Y: 0,
      },
    };
    this.userEq = {
      pure: this.createUserEqBank(),
      adaptive: this.createUserEqBank(),
      power: this.createUserEqBank(),
    };
    this.configureUserEq();
    this.resetTelemetry();

    this.port.onmessage = (event) => {
      const m = event?.data ?? {};

      if (m.type === "ping") {
        this.port.postMessage({ type: "ready", engine: "r22" });
        return;
      }

      if (m.type === "track-profile") {
        this.profileTrackId = typeof m.trackId === "string" ? m.trackId : null;
        this.profile = this.sanitizeProfile(m.profile);
        this.profileClass = this.classifyProfile(this.profile);
        this.rebuildToneBanks();
        this.rebuildSettings();
        this.resetToneBanks();
        this.resetDimensionState();
        this.port.postMessage({
          type: "track-profile-active",
          engine: "r22",
          trackId: this.profileTrackId,
          applied: Boolean(this.profile),
          profileClass: this.profileClass,
        });
        return;
      }

      if (m.type === "user-controls") {
        this.user.dimensionEnabled = m.dimensionEnabled !== false;
        this.user.eqBassDb = this.controlDb(m.eqBassDb);
        this.user.eqMidsDb = this.controlDb(m.eqMidsDb);
        this.user.eqTrebleDb = this.controlDb(m.eqTrebleDb);
        this.configureUserEq();
        this.port.postMessage({
          type: "user-controls-active",
          engine: "r22",
          dimensionEnabled: this.user.dimensionEnabled,
          eqBassDb: this.user.eqBassDb,
          eqMidsDb: this.user.eqMidsDb,
          eqTrebleDb: this.user.eqTrebleDb,
        });
        return;
      }

      if (m.type === "mode" && ["pure", "adaptive", "power"].includes(m.mode)) {
        this.mode = m.mode;
        this.generation = Number.isFinite(Number(m.generation))
          ? Number(m.generation)
          : this.generation + 1;
        // Mode changes never reset enhanced branches, Dimension, or user EQ state.
        this.pendingModeConfirmation = true;
        this.resetTelemetry();
        this.port.postMessage({
          type: "mode-selected",
          engine: "r22",
          mode: this.mode,
          generation: this.generation,
        });
        return;
      }

      if (m.type === "reset") {
        // Track/source reset only. Mode switches are never resets.
        this.resetToneBanks();
        this.resetDimensionState();
        this.resetUserEqState();
        this.pendingModeConfirmation = true;
      }
    };
  }

  static clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  static dbToGain(db) {
    return Math.pow(10, db / 20);
  }

  static gainToDb(gain) {
    return 20 * Math.log10(Math.max(1e-12, gain));
  }

  controlDb(value) {
    const n = Number(value);
    return Number.isFinite(n) ? MvpSoundModesProcessor.clamp(n, -6, 6) : 0;
  }

  sanitizeProfile(value) {
    if (!value || typeof value !== "object") return null;

    const n = (key, fallback) => {
      const raw = value[key];
      if (raw === null || raw === undefined || raw === "") return fallback;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    return {
      rmsDb: n("rmsDb", -12),
      truePeakDbtp: n("truePeakDbtp", -1),
      crestFactorDb: n("crestFactorDb", 8),
      dynamicRangeDb: n("dynamicRangeDb", 8),
      bassExtension: n("bassExtension", 50),
      lowMidBuildup: n("lowMidBuildup", 50),
      presenceBalance: n("presenceBalance", 50),
      harshness: n("harshness", 50),
      sibilance: n("sibilance", 50),
      hfRolloff: n("hfRolloff", 50),
      transientStrength: n("transientStrength", 50),
      correlation: n("correlation", 0.7),
      phaseRisk: Boolean(value.phaseRisk),
      sourceGainDb: n("sourceGainDb", 0),
      lowMidDb: n("lowMidDb", 0),
      presenceDb: n("presenceDb", 0),
      harshnessDb: n("harshnessDb", 0),
    };
  }

  classifyProfile(p) {
    if (!p) return "fallback";
    if (p.rmsDb >= -8.5 || p.crestFactorDb <= 6.2 || p.dynamicRangeDb <= 5.5) return "brick";
    if (p.rmsDb >= -10.8 || p.crestFactorDb <= 7.4 || p.dynamicRangeDb <= 7) return "hot";
    if (p.rmsDb <= -14 || p.crestFactorDb >= 10.5 || p.dynamicRangeDb >= 10.5) return "dynamic";
    return "normal";
  }

  createBiquad() {
    return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 };
  }

  setPeaking(f, frequency, q, gainDb) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const hz = MvpSoundModesProcessor.clamp(frequency, 10, sr * 0.475);
    const A = Math.pow(10, gainDb / 40);
    const w = 2 * Math.PI * hz / sr;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const alpha = s / (2 * q);
    const aa = 1 + alpha / A;

    f.b0 = (1 + alpha * A) / aa;
    f.b1 = (-2 * c) / aa;
    f.b2 = (1 - alpha * A) / aa;
    f.a1 = (-2 * c) / aa;
    f.a2 = (1 - alpha / A) / aa;
  }

  setLowShelf(f, frequency, gainDb) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const hz = MvpSoundModesProcessor.clamp(frequency, 10, sr * 0.475);
    const A = Math.pow(10, gainDb / 40);
    const w = 2 * Math.PI * hz / sr;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const beta = 2 * Math.sqrt(A) * s;
    const aa = (A + 1) + (A - 1) * c + beta;

    f.b0 = A * ((A + 1) - (A - 1) * c + beta) / aa;
    f.b1 = 2 * A * ((A - 1) - (A + 1) * c) / aa;
    f.b2 = A * ((A + 1) - (A - 1) * c - beta) / aa;
    f.a1 = -2 * ((A - 1) + (A + 1) * c) / aa;
    f.a2 = ((A + 1) + (A - 1) * c - beta) / aa;
  }

  setHighShelf(f, frequency, gainDb) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const hz = MvpSoundModesProcessor.clamp(frequency, 10, sr * 0.475);
    const A = Math.pow(10, gainDb / 40);
    const w = 2 * Math.PI * hz / sr;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const beta = 2 * Math.sqrt(A) * s;
    const aa = (A + 1) - (A - 1) * c + beta;

    f.b0 = A * ((A + 1) + (A - 1) * c + beta) / aa;
    f.b1 = -2 * A * ((A - 1) + (A + 1) * c) / aa;
    f.b2 = A * ((A + 1) + (A - 1) * c - beta) / aa;
    f.a1 = 2 * ((A - 1) - (A + 1) * c) / aa;
    f.a2 = ((A + 1) - (A - 1) * c - beta) / aa;
  }

  processBiquad(f, x) {
    const y = f.b0 * x + f.z1;
    f.z1 = f.b1 * x - f.a1 * y + f.z2;
    f.z2 = f.b2 * x - f.a2 * y;
    return y;
  }

  resetFilter(f) {
    f.z1 = 0;
    f.z2 = 0;
  }

  profileToneAdjustments(mode) {
    const p = this.profile;
    if (!p) return { low: 0, body: 0, mud: 0, mid: 0, presence: 0, air: 0 };

    const strength = mode === "power" ? 1 : 0.6;
    const bassNeed = MvpSoundModesProcessor.clamp((55 - p.bassExtension) * 0.022, -0.8, 0.7);
    const bodyNeed = MvpSoundModesProcessor.clamp((54 - p.lowMidBuildup) * 0.020, -0.6, 0.6);
    const harsh = Math.max(p.harshness, p.sibilance);
    const harshCut = MvpSoundModesProcessor.clamp((harsh - 58) * 0.018, 0, 0.7);
    const presenceNeed = MvpSoundModesProcessor.clamp((50 - p.presenceBalance) * 0.010, -0.25, 0.25) - harshCut * 0.45;
    const airNeed = MvpSoundModesProcessor.clamp((p.hfRolloff - 60) * 0.006, 0, 0.15) - harshCut * 0.20;

    return {
      low: bassNeed * strength,
      body: bodyNeed * strength,
      mud: MvpSoundModesProcessor.clamp(p.lowMidDb, -0.5, 0.1) * strength,
      mid: 0,
      presence: (presenceNeed + MvpSoundModesProcessor.clamp(p.presenceDb, -0.2, 0.2)) * strength,
      air: airNeed * strength,
    };
  }

  createToneBank(mode) {
    const a = this.profileToneAdjustments(mode);

    const make = () => {
      const f = {
        low: this.createBiquad(),
        body: this.createBiquad(),
        mud: this.createBiquad(),
        mid: this.createBiquad(),
        presence: this.createBiquad(),
        air: this.createBiquad(),
      };

      const shape = mode === "power"
        ? { low: 2.8 + a.low, body: 1.7 + a.body, mud: -0.12 + a.mud, mid: 0.9, presence: 0.50 + a.presence, air: 0.20 + a.air }
        : { low: 1.5 + a.low, body: 0.95 + a.body, mud: -0.08 + a.mud, mid: 0.45, presence: 0.28 + a.presence, air: 0.10 + a.air };

      this.setLowShelf(f.low, 72, shape.low);
      this.setPeaking(f.body, 175, 0.74, shape.body);
      this.setPeaking(f.mud, 470, 0.90, shape.mud);
      this.setPeaking(f.mid, 1050, 0.85, shape.mid);
      this.setPeaking(f.presence, 3300, 0.95, shape.presence);
      this.setHighShelf(f.air, 10500, shape.air);
      return f;
    };

    return [make(), make()];
  }

  rebuildToneBanks() {
    this.tone = {
      adaptive: this.createToneBank("adaptive"),
      power: this.createToneBank("power"),
    };
  }

  resetToneBank(bank) {
    for (const channel of bank) {
      for (const f of Object.values(channel)) this.resetFilter(f);
    }
  }

  resetToneBanks() {
    this.resetToneBank(this.tone.adaptive);
    this.resetToneBank(this.tone.power);
  }

  processTone(bank, channel, x) {
    const f = bank[channel];
    x = this.processBiquad(f.low, x);
    x = this.processBiquad(f.body, x);
    x = this.processBiquad(f.mud, x);
    x = this.processBiquad(f.mid, x);
    x = this.processBiquad(f.presence, x);
    x = this.processBiquad(f.air, x);
    return x;
  }

  modeSettings(mode) {
    const c = this.profileClass;
    const p = this.profile;
    const sourceGain = MvpSoundModesProcessor.clamp(p?.sourceGainDb ?? 0, -0.4, 0.8);

    const baseGainDb = mode === "power"
      ? { dynamic: 7.5, normal: 7.0, hot: 6.5, brick: 6.0, fallback: 7.0 }
      : { dynamic: 4.0, normal: 3.6, hot: 3.3, brick: 3.0, fallback: 3.6 };

    const extra = Math.max(0, sourceGain) * (mode === "power" ? 0.45 : 0.25);
    const gainDb = (baseGainDb[c] ?? baseGainDb.fallback) + extra;

    return {
      gainDb,
      gain: MvpSoundModesProcessor.dbToGain(gainDb),
    };
  }

  rebuildSettings() {
    this.settings = {
      adaptive: this.modeSettings("adaptive"),
      power: this.modeSettings("power"),
    };
  }

  resetDimensionState() {
    for (const state of Object.values(this.dimensionState)) {
      state.lowSide1 = 0;
      state.lowSide2 = 0;
      state.midLow = 0;
      state.hpLow = 0;
      state.ap1X = 0;
      state.ap1Y = 0;
      state.ap2X = 0;
      state.ap2Y = 0;
    }
  }

  processDimension(mode, l, r) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const sideAlpha = 1 - Math.exp(-2 * Math.PI * 1000 / sr);
    const spatialAlpha = 1 - Math.exp(-2 * Math.PI * 800 / sr);
    const state = this.dimensionState[mode];

    // R22 MVP DIMENSION ULTRA:
    // wider than MAX, but still protects the center and deep bass.
    // Existing stereo is pushed harder and center-heavy upper mids/highs create more side space.
    const width = mode === "power" ? 2.90 : 2.00;
    const lowWidth = mode === "power" ? 0.02 : 0.12;
    const centerFocus = mode === "power" ? 1.06 : 1.03;
    const spatialMix = mode === "power" ? 1.10 : 0.68;
    const ap1Coeff = mode === "power" ? 0.80 : 0.65;
    const ap2Coeff = mode === "power" ? -0.66 : -0.52;

    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;

    state.lowSide1 += (side - state.lowSide1) * sideAlpha;
    state.lowSide2 += (state.lowSide1 - state.lowSide2) * sideAlpha;
    const highSide = side - state.lowSide2;

    state.midLow += (mid - state.midLow) * spatialAlpha;
    const hp1 = mid - state.midLow;
    state.hpLow += (hp1 - state.hpLow) * spatialAlpha;
    const spatialSource = hp1 - state.hpLow;

    const ap1 = ap1Coeff * spatialSource + state.ap1X - ap1Coeff * state.ap1Y;
    state.ap1X = spatialSource;
    state.ap1Y = ap1;

    const ap2 = ap2Coeff * ap1 + state.ap2X - ap2Coeff * state.ap2Y;
    state.ap2X = ap1;
    state.ap2Y = ap2;

    // State stays warm while OFF for an immediate A/B toggle.
    if (!this.user.dimensionEnabled) return { l, r };

    const generatedSide = ap2 * spatialMix;
    const shapedSide = state.lowSide2 * lowWidth + highSide * width + generatedSide;
    const focusedMid = mid * centerFocus;

    return {
      l: focusedMid + shapedSide,
      r: focusedMid - shapedSide,
    };
  }

  createUserEqBank() {
    const make = () => ({
      bass: this.createBiquad(),
      mids: this.createBiquad(),
      treble: this.createBiquad(),
    });
    return [make(), make()];
  }

  configureUserEqBank(bank) {
    for (const channel of bank) {
      this.setLowShelf(channel.bass, 105, this.user.eqBassDb);
      this.setPeaking(channel.mids, 1200, 0.72, this.user.eqMidsDb);
      this.setHighShelf(channel.treble, 8200, this.user.eqTrebleDb);
    }
  }

  configureUserEq() {
    this.configureUserEqBank(this.userEq.pure);
    this.configureUserEqBank(this.userEq.adaptive);
    this.configureUserEqBank(this.userEq.power);
  }

  resetUserEqState() {
    for (const bank of Object.values(this.userEq)) {
      for (const channel of bank) {
        this.resetFilter(channel.bass);
        this.resetFilter(channel.mids);
        this.resetFilter(channel.treble);
      }
    }
  }

  userEqIsFlat() {
    return Math.abs(this.user.eqBassDb) < 1e-9 &&
      Math.abs(this.user.eqMidsDb) < 1e-9 &&
      Math.abs(this.user.eqTrebleDb) < 1e-9;
  }

  processUserEq(mode, l, r) {
    if (this.userEqIsFlat()) return { l, r };
    const bank = this.userEq[mode];
    const process = (channel, x) => {
      x = this.processBiquad(channel.bass, x);
      x = this.processBiquad(channel.mids, x);
      x = this.processBiquad(channel.treble, x);
      return x;
    };
    return {
      l: process(bank[0], l),
      r: process(bank[1], r),
    };
  }

  processBranch(mode, iL, iR) {
    const bank = this.tone[mode];
    const settings = this.settings[mode];

    let l = this.processTone(bank, 0, iL);
    let r = this.processTone(bank, 1, iR);

    l *= settings.gain;
    r *= settings.gain;

    const dimension = this.processDimension(mode, l, r);
    return {
      l: dimension.l,
      r: dimension.r,
      requestedGainDb: settings.gainDb,
      limiterReductionDb: 0,
    };
  }

  resetTelemetry() {
    this.telemetryFrames = 0;
    this.telemetryInputSq = 0;
    this.telemetryOutputSq = 0;
    this.telemetrySamples = 0;
    this.telemetryPeak = 0;
    this.telemetryRequestedGainDb = 0;
  }

  addTelemetry(iL, iR, oL, oR, requestedGainDb) {
    this.telemetryInputSq += iL * iL + iR * iR;
    this.telemetryOutputSq += oL * oL + oR * oR;
    this.telemetrySamples += 2;
    this.telemetryPeak = Math.max(this.telemetryPeak, Math.abs(oL), Math.abs(oR));
    this.telemetryRequestedGainDb = Math.max(this.telemetryRequestedGainDb, requestedGainDb);
    this.telemetryFrames++;

    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    if (this.telemetryFrames < Math.floor(sr * 0.5)) return;

    const inRms = Math.sqrt(this.telemetryInputSq / Math.max(1, this.telemetrySamples));
    const outRms = Math.sqrt(this.telemetryOutputSq / Math.max(1, this.telemetrySamples));
    const inDb = MvpSoundModesProcessor.gainToDb(inRms);
    const outDb = MvpSoundModesProcessor.gainToDb(outRms);

    this.port.postMessage({
      type: "telemetry",
      engine: "r22",
      mode: this.mode,
      generation: this.generation,
      inputRmsDb: inDb,
      outputRmsDb: outDb,
      deltaDb: outDb - inDb,
      outputPeakDb: MvpSoundModesProcessor.gainToDb(this.telemetryPeak),
      requestedGainDb: this.telemetryRequestedGainDb,
      limiterReductionDb: 0,
      dimensionEnabled: this.user.dimensionEnabled,
      eqBassDb: this.user.eqBassDb,
      eqMidsDb: this.user.eqMidsDb,
      eqTrebleDb: this.user.eqTrebleDb,
      trackProfileApplied: Boolean(this.profile),
      trackId: this.profileTrackId,
      profileClass: this.profileClass,
    });

    this.resetTelemetry();
  }

  static hasAudibleSignal(input, frames) {
    for (const src of input) {
      if (!src) continue;
      for (let i = 0; i < frames; i++) {
        if (Math.abs(src[i] ?? 0) > 1e-5) return true;
      }
    }
    return false;
  }

  confirmModeIfAudible(input, frames) {
    if (!this.pendingModeConfirmation || !MvpSoundModesProcessor.hasAudibleSignal(input, frames)) return;
    this.pendingModeConfirmation = false;
    this.port.postMessage({
      type: "mode-active",
      engine: "r22",
      mode: this.mode,
      generation: this.generation,
    });
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    if (!output.length) return true;

    const frames = output[0]?.length ?? 0;

    for (let i = 0; i < frames; i++) {
      const iL = input[0]?.[i] ?? 0;
      const iR = input[1]?.[i] ?? iL;

      // All three EQ paths and both enhanced mode branches stay warm continuously.
      const pureEq = this.processUserEq("pure", iL, iR);
      const adaptiveBase = this.processBranch("adaptive", iL, iR);
      const powerBase = this.processBranch("power", iL, iR);
      const adaptive = this.processUserEq("adaptive", adaptiveBase.l, adaptiveBase.r);
      const power = this.processUserEq("power", powerBase.l, powerBase.r);

      let oL = pureEq.l;
      let oR = pureEq.r;
      let requested = 0;

      if (this.mode === "adaptive") {
        oL = adaptive.l;
        oR = adaptive.r;
        requested = adaptiveBase.requestedGainDb;
      } else if (this.mode === "power") {
        oL = power.l;
        oR = power.r;
        requested = powerBase.requestedGainDb;
      }

      if (output[0]) output[0][i] = oL;
      if (output[1]) output[1][i] = oR;

      for (let channel = 2; channel < output.length; channel++) {
        if (output[channel]) output[channel][i] = channel % 2 === 0 ? oL : oR;
      }

      this.addTelemetry(iL, iR, oL, oR, requested);
    }

    this.confirmModeIfAudible(input, frames);
    return true;
  }
}

registerProcessor("mvp-sound-modes", MvpSoundModesProcessor);
