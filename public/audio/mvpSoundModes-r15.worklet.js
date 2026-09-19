class MvpSoundModesProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "pure";
    this.generation = 0;
    this.pendingModeConfirmation = true;
    this.profile = null;
    this.profileTrackId = null;
    this.profileClass = "fallback";
    this.settings = { adaptive: null, power: null };
    this.tone = {
      adaptive: this.createToneBank("adaptive"),
      power: this.createToneBank("power"),
    };
    this.branch = {
      adaptive: this.createBranchState(),
      power: this.createBranchState(),
    };
    this.rebuildSettings();
    this.resetTelemetry();

    this.port.onmessage = (event) => {
      const m = event?.data ?? {};
      if (m.type === "ping") {
        this.port.postMessage({ type: "ready", engine: "r15" });
        return;
      }
      if (m.type === "track-profile") {
        this.profileTrackId = typeof m.trackId === "string" ? m.trackId : null;
        this.profile = this.sanitizeProfile(m.profile);
        this.profileClass = this.classifyProfile(this.profile);
        this.rebuildToneBanks();
        this.rebuildSettings();
        this.resetBranches();
        this.port.postMessage({
          type: "track-profile-active",
          engine: "r15",
          trackId: this.profileTrackId,
          applied: Boolean(this.profile),
          profileClass: this.profileClass,
        });
        return;
      }
      if (m.type === "mode" && ["pure", "adaptive", "power"].includes(m.mode)) {
        this.mode = m.mode;
        this.generation = Number.isFinite(Number(m.generation)) ? Number(m.generation) : this.generation + 1;
        // R15 invariant: mode changes never reset either processed branch.
        this.pendingModeConfirmation = true;
        this.resetTelemetry();
        this.port.postMessage({ type: "mode-selected", engine: "r15", mode: this.mode, generation: this.generation });
        return;
      }
      if (m.type === "reset") {
        // Source/track resets are allowed; mode switches are not resets.
        this.resetBranches();
        this.pendingModeConfirmation = true;
      }
    };
  }

  static clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  static dbToGain(db) { return Math.pow(10, db / 20); }
  static gainToDb(g) { return 20 * Math.log10(Math.max(1e-12, g)); }

  sanitizeProfile(value) {
    if (!value || typeof value !== "object") return null;
    const n = (key, fallback) => {
      const raw = value[key];
      if (raw === null || raw === undefined || raw === "") return fallback;
      const x = Number(raw);
      return Number.isFinite(x) ? x : fallback;
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

  createBiquad() { return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 }; }
  setPeaking(f, frequency, q, gainDb) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const hz = MvpSoundModesProcessor.clamp(frequency, 10, sr * 0.475);
    const A = Math.pow(10, gainDb / 40), w = 2 * Math.PI * hz / sr, c = Math.cos(w), s = Math.sin(w);
    const alpha = s / (2 * q), aa = 1 + alpha / A;
    f.b0 = (1 + alpha * A) / aa; f.b1 = (-2 * c) / aa; f.b2 = (1 - alpha * A) / aa;
    f.a1 = (-2 * c) / aa; f.a2 = (1 - alpha / A) / aa;
  }
  setLowShelf(f, frequency, gainDb) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const hz = MvpSoundModesProcessor.clamp(frequency, 10, sr * 0.475);
    const A = Math.pow(10, gainDb / 40), w = 2 * Math.PI * hz / sr, c = Math.cos(w), s = Math.sin(w);
    const beta = 2 * Math.sqrt(A) * s, aa = (A + 1) + (A - 1) * c + beta;
    f.b0 = A * ((A + 1) - (A - 1) * c + beta) / aa; f.b1 = 2 * A * ((A - 1) - (A + 1) * c) / aa;
    f.b2 = A * ((A + 1) - (A - 1) * c - beta) / aa; f.a1 = -2 * ((A - 1) + (A + 1) * c) / aa;
    f.a2 = ((A + 1) + (A - 1) * c - beta) / aa;
  }
  setHighShelf(f, frequency, gainDb) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const hz = MvpSoundModesProcessor.clamp(frequency, 10, sr * 0.475);
    const A = Math.pow(10, gainDb / 40), w = 2 * Math.PI * hz / sr, c = Math.cos(w), s = Math.sin(w);
    const beta = 2 * Math.sqrt(A) * s, aa = (A + 1) - (A - 1) * c + beta;
    f.b0 = A * ((A + 1) + (A - 1) * c + beta) / aa; f.b1 = -2 * A * ((A - 1) + (A + 1) * c) / aa;
    f.b2 = A * ((A + 1) + (A - 1) * c - beta) / aa; f.a1 = 2 * ((A - 1) - (A + 1) * c) / aa;
    f.a2 = ((A + 1) - (A - 1) * c - beta) / aa;
  }
  processBiquad(f, x) {
    const y = f.b0 * x + f.z1;
    f.z1 = f.b1 * x - f.a1 * y + f.z2;
    f.z2 = f.b2 * x - f.a2 * y;
    return y;
  }

  profileToneAdjustments(mode) {
    const p = this.profile;
    if (!p) return { low: 0, body: 0, mud: 0, presence: 0, air: 0 };
    const strength = mode === "power" ? 1 : 0.55;
    const bassNeed = MvpSoundModesProcessor.clamp((54 - p.bassExtension) * 0.025, -0.9, 0.8);
    const bodyNeed = MvpSoundModesProcessor.clamp((52 - p.lowMidBuildup) * 0.022, -0.65, 0.65);
    const harsh = Math.max(p.harshness, p.sibilance);
    const harshCut = MvpSoundModesProcessor.clamp((harsh - 56) * 0.022, 0, 0.9);
    const presenceNeed = MvpSoundModesProcessor.clamp((48 - p.presenceBalance) * 0.012, -0.28, 0.28) - harshCut * 0.5;
    const airNeed = MvpSoundModesProcessor.clamp((p.hfRolloff - 60) * 0.006, 0, 0.16) - harshCut * 0.25;
    return {
      low: bassNeed * strength,
      body: bodyNeed * strength,
      mud: MvpSoundModesProcessor.clamp(p.lowMidDb, -0.7, 0.1) * strength,
      presence: (presenceNeed + MvpSoundModesProcessor.clamp(p.presenceDb, -0.25, 0.25)) * strength,
      air: airNeed * strength,
    };
  }

  createToneBank(mode) {
    const a = this.profileToneAdjustments(mode);
    const make = () => {
      const f = { low: this.createBiquad(), body: this.createBiquad(), mud: this.createBiquad(), mid: this.createBiquad(), presence: this.createBiquad(), air: this.createBiquad() };
      const s = mode === "power"
        ? { low: 1.85 + a.low, body: 1.15 + a.body, mud: -0.12 + a.mud, mid: 0.48, presence: 0.08 + a.presence, air: 0.00 + a.air }
        : { low: 0.95 + a.low, body: 0.62 + a.body, mud: -0.07 + a.mud, mid: 0.24, presence: 0.04 + a.presence, air: 0.00 + a.air };
      this.setLowShelf(f.low, 72, s.low);
      this.setPeaking(f.body, 175, 0.72, s.body);
      this.setPeaking(f.mud, 470, 0.85, s.mud);
      this.setPeaking(f.mid, 1050, 0.82, s.mid);
      this.setPeaking(f.presence, 3300, 0.95, s.presence);
      this.setHighShelf(f.air, 10800, s.air);
      return f;
    };
    return [make(), make()];
  }
  rebuildToneBanks() { this.tone = { adaptive: this.createToneBank("adaptive"), power: this.createToneBank("power") }; }
  resetToneBank(bank) { for (const ch of bank) for (const f of Object.values(ch)) { f.z1 = 0; f.z2 = 0; } }
  processTone(bank, ch, x) {
    const f = bank[ch];
    x = this.processBiquad(f.low, x); x = this.processBiquad(f.body, x); x = this.processBiquad(f.mud, x);
    x = this.processBiquad(f.mid, x); x = this.processBiquad(f.presence, x); x = this.processBiquad(f.air, x);
    return x;
  }

  modeSettings(mode) {
    const c = this.profileClass;
    const p = this.profile;
    const sourceGain = MvpSoundModesProcessor.clamp(p?.sourceGainDb ?? 0, -0.5, 0.8);
    const transient = MvpSoundModesProcessor.clamp(((p?.transientStrength ?? 55) - 50) / 50, -0.4, 0.6);
    const base = mode === "power" ? {
      dynamic: { thresholdDb: -20.0, ratio: 3.0, parallelMix: 0.46, parallelMakeupDb: 8.0, outputGainDb: 4.4, softener: 0.10 },
      normal:  { thresholdDb: -16.5, ratio: 2.6, parallelMix: 0.42, parallelMakeupDb: 7.5, outputGainDb: 4.0, softener: 0.08 },
      hot:     { thresholdDb: -10.5, ratio: 1.75, parallelMix: 0.24, parallelMakeupDb: 5.2, outputGainDb: 3.1, softener: 0.14 },
      brick:   { thresholdDb: -7.5, ratio: 1.28, parallelMix: 0.10, parallelMakeupDb: 3.0, outputGainDb: 1.75, softener: 0.20 },
      fallback:{ thresholdDb: -15.5, ratio: 2.4, parallelMix: 0.38, parallelMakeupDb: 7.0, outputGainDb: 3.7, softener: 0.10 },
    } : {
      dynamic: { thresholdDb: -15.0, ratio: 2.0, parallelMix: 0.26, parallelMakeupDb: 5.2, outputGainDb: 2.5, softener: 0.03 },
      normal:  { thresholdDb: -12.0, ratio: 1.8, parallelMix: 0.22, parallelMakeupDb: 4.8, outputGainDb: 2.3, softener: 0.03 },
      hot:     { thresholdDb: -8.0, ratio: 1.35, parallelMix: 0.10, parallelMakeupDb: 3.0, outputGainDb: 1.8, softener: 0.04 },
      brick:   { thresholdDb: -6.0, ratio: 1.15, parallelMix: 0.04, parallelMakeupDb: 1.8, outputGainDb: 0.85, softener: 0.06 },
      fallback:{ thresholdDb: -11.5, ratio: 1.75, parallelMix: 0.20, parallelMakeupDb: 4.6, outputGainDb: 2.2, softener: 0.03 },
    };
    const b = base[c] ?? base.fallback;
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const attackMs = mode === "power" ? 9 + transient * 5 : 13 + transient * 5;
    const releaseMs = mode === "power" ? 105 : 125;
    const detectorHpHz = 105;
    const detectorLpAlpha = 1 - Math.exp(-2 * Math.PI * detectorHpHz / sr);
    return {
      ...b,
      attackCoeff: 1 - Math.exp(-1 / (sr * Math.max(3, attackMs) / 1000)),
      releaseCoeff: 1 - Math.exp(-1 / (sr * releaseMs / 1000)),
      detectorLpAlpha,
      parallelMakeup: MvpSoundModesProcessor.dbToGain(b.parallelMakeupDb),
      outputGainDb: b.outputGainDb + Math.max(0, sourceGain) * (mode === "power" ? 0.55 : 0.35),
      outputGain: MvpSoundModesProcessor.dbToGain(b.outputGainDb + Math.max(0, sourceGain) * (mode === "power" ? 0.55 : 0.35)),
      ceiling: mode === "power" ? 0.875 : 0.885,
      limiterReleaseCoeff: 1 - Math.exp(-1 / (sr * (mode === "power" ? 70 : 85) / 1000)),
    };
  }
  rebuildSettings() { this.settings = { adaptive: this.modeSettings("adaptive"), power: this.modeSettings("power") }; }

  createBranchState() {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const lookaheadFrames = Math.max(64, Math.round(sr * 0.005));
    return {
      env: 0,
      compGain: 1,
      limiterGain: 1,
      lookaheadFrames,
      lookL: new Float32Array(lookaheadFrames),
      lookR: new Float32Array(lookaheadFrames),
      lookIndex: 0,
      detectorLowL: 0,
      detectorLowR: 0,
      prevPeakL: 0,
      prevPeakR: 0,
      requestedGainDb: 0,
      crestReductionDb: 0,
      limiterReductionDb: 0,
    };
  }
  resetBranchState(s) {
    s.env = 0; s.compGain = 1; s.limiterGain = 1; s.lookIndex = 0;
    s.lookL.fill(0); s.lookR.fill(0); s.detectorLowL = 0; s.detectorLowR = 0; s.prevPeakL = 0; s.prevPeakR = 0;
    s.requestedGainDb = 0; s.crestReductionDb = 0; s.limiterReductionDb = 0;
  }
  resetBranches() {
    this.resetBranchState(this.branch.adaptive); this.resetBranchState(this.branch.power);
    this.resetToneBank(this.tone.adaptive); this.resetToneBank(this.tone.power);
  }

  // Gentle peak softening used only as a last crest-management step before the limiter.
  // Below the knee it is linear; above it the excess is smoothly compressed.
  softenSample(x, amount) {
    if (amount <= 0) return x;
    const knee = 0.72;
    const a = Math.abs(x);
    if (a <= knee) return x;
    const sign = x < 0 ? -1 : 1;
    const excess = a - knee;
    const compressed = knee + excess / (1 + amount * excess * 7.5);
    return sign * compressed;
  }

  // Four-point cubic interpolation estimate. It is intentionally conservative and cheap enough
  // to keep both processed stereo branches warm continuously.
  estimateInterSamplePeak(prev, curr) {
    const a = Math.abs(prev), b = Math.abs(curr);
    let p = Math.max(a, b);
    const d = curr - prev;
    // Linear quarter points cannot exceed endpoints, but the extra curvature margin catches
    // alternating-polarity/high-frequency cases that sample-peak limiting can miss.
    const curvature = Math.min(Math.abs(d) * 0.085, 0.08 * Math.max(a, b));
    p = Math.max(p, a * 0.75 + b * 0.25 + curvature, a * 0.5 + b * 0.5 + curvature, a * 0.25 + b * 0.75 + curvature);
    return p;
  }

  processBranch(mode, iL, iR) {
    const state = this.branch[mode], bank = this.tone[mode], s = this.settings[mode];
    let dryL = this.processTone(bank, 0, iL), dryR = this.processTone(bank, 1, iR);

    state.detectorLowL += (dryL - state.detectorLowL) * s.detectorLpAlpha;
    state.detectorLowR += (dryR - state.detectorLowR) * s.detectorLpAlpha;
    const hpL = dryL - state.detectorLowL, hpR = dryR - state.detectorLowR;
    // Low frequencies still contribute, but less than mids/highs, preventing kick/bass from
    // making the entire mix audibly pump.
    const detector = Math.max(Math.abs(hpL) + Math.abs(state.detectorLowL) * 0.42, Math.abs(hpR) + Math.abs(state.detectorLowR) * 0.42);
    const envCoeff = detector > state.env ? s.attackCoeff : s.releaseCoeff;
    state.env += (detector - state.env) * envCoeff;

    const envDb = MvpSoundModesProcessor.gainToDb(state.env);
    const overDb = Math.max(0, envDb - s.thresholdDb);
    const grDb = overDb * (1 - 1 / s.ratio);
    const targetComp = MvpSoundModesProcessor.dbToGain(-grDb);
    const gainCoeff = targetComp < state.compGain ? s.attackCoeff : s.releaseCoeff;
    state.compGain += (targetComp - state.compGain) * gainCoeff;

    // Dry path preserves attack; compressed parallel path raises density/body. This is the
    // primary loudness stage. The final limiter is only a safety net.
    const denseL = dryL * state.compGain * s.parallelMakeup;
    const denseR = dryR * state.compGain * s.parallelMakeup;
    let l = (dryL * (1 - s.parallelMix) + denseL * s.parallelMix) * s.outputGain;
    let r = (dryR * (1 - s.parallelMix) + denseR * s.parallelMix) * s.outputGain;
    l = this.softenSample(l, s.softener); r = this.softenSample(r, s.softener);

    state.requestedGainDb = s.outputGainDb;
    state.crestReductionDb = Math.max(0, -MvpSoundModesProcessor.gainToDb(state.compGain));

    const predicted = Math.max(this.estimateInterSamplePeak(state.prevPeakL, l), this.estimateInterSamplePeak(state.prevPeakR, r));
    state.prevPeakL = l; state.prevPeakR = r;
    const required = predicted > s.ceiling ? s.ceiling / Math.max(predicted, 1e-12) : 1;
    if (required < state.limiterGain) state.limiterGain = required;
    else state.limiterGain += (1 - state.limiterGain) * s.limiterReleaseCoeff;
    state.limiterGain = MvpSoundModesProcessor.clamp(state.limiterGain, 0.18, 1);

    const dL = state.lookL[state.lookIndex], dR = state.lookR[state.lookIndex];
    state.lookL[state.lookIndex] = l; state.lookR[state.lookIndex] = r;
    state.lookIndex++; if (state.lookIndex >= state.lookaheadFrames) state.lookIndex = 0;

    const oL = MvpSoundModesProcessor.clamp(dL * state.limiterGain, -s.ceiling, s.ceiling);
    const oR = MvpSoundModesProcessor.clamp(dR * state.limiterGain, -s.ceiling, s.ceiling);
    state.limiterReductionDb = Math.max(0, -MvpSoundModesProcessor.gainToDb(state.limiterGain));
    return { l: oL, r: oR, requestedGainDb: state.requestedGainDb, crestReductionDb: state.crestReductionDb, limiterReductionDb: state.limiterReductionDb };
  }

  resetTelemetry() {
    this.telemetryFrames = 0; this.telemetryInputSq = 0; this.telemetryOutputSq = 0; this.telemetrySamples = 0;
    this.telemetryPeak = 0; this.telemetryLimiterReductionDb = 0; this.telemetryLimiterReductionSumDb = 0;
    this.telemetryCrestReductionDb = 0; this.telemetryRequestedGainDb = 0;
  }
  addTelemetry(iL, iR, oL, oR, requestedGainDb, crestReductionDb, limiterReductionDb) {
    this.telemetryInputSq += iL * iL + iR * iR; this.telemetryOutputSq += oL * oL + oR * oR; this.telemetrySamples += 2;
    this.telemetryPeak = Math.max(this.telemetryPeak, Math.abs(oL), Math.abs(oR));
    this.telemetryRequestedGainDb = Math.max(this.telemetryRequestedGainDb, requestedGainDb);
    this.telemetryCrestReductionDb = Math.max(this.telemetryCrestReductionDb, crestReductionDb);
    this.telemetryLimiterReductionDb = Math.max(this.telemetryLimiterReductionDb, limiterReductionDb);
    this.telemetryLimiterReductionSumDb += limiterReductionDb;
    this.telemetryFrames++;
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    if (this.telemetryFrames < Math.floor(sr * 0.5)) return;
    const inRms = Math.sqrt(this.telemetryInputSq / Math.max(1, this.telemetrySamples));
    const outRms = Math.sqrt(this.telemetryOutputSq / Math.max(1, this.telemetrySamples));
    const inDb = MvpSoundModesProcessor.gainToDb(inRms), outDb = MvpSoundModesProcessor.gainToDb(outRms);
    this.port.postMessage({
      type: "telemetry", engine: "r15", mode: this.mode, generation: this.generation,
      inputRmsDb: inDb, outputRmsDb: outDb, deltaDb: outDb - inDb,
      outputPeakDb: MvpSoundModesProcessor.gainToDb(this.telemetryPeak),
      requestedGainDb: this.telemetryRequestedGainDb,
      crestReductionDb: this.telemetryCrestReductionDb,
      limiterReductionDb: this.telemetryLimiterReductionDb,
      limiterAverageReductionDb: this.telemetryLimiterReductionSumDb / Math.max(1, this.telemetryFrames),
      trackProfileApplied: Boolean(this.profile), trackId: this.profileTrackId, profileClass: this.profileClass,
    });
    this.resetTelemetry();
  }

  static hasAudibleSignal(input, frames) {
    for (const src of input) { if (!src) continue; for (let i = 0; i < frames; i++) if (Math.abs(src[i] ?? 0) > 1e-5) return true; }
    return false;
  }
  confirmModeIfAudible(input, frames) {
    if (!this.pendingModeConfirmation || !MvpSoundModesProcessor.hasAudibleSignal(input, frames)) return;
    this.pendingModeConfirmation = false;
    this.port.postMessage({ type: "mode-active", engine: "r15", mode: this.mode, generation: this.generation });
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [], output = outputs[0] ?? [];
    if (!output.length) return true;
    const frames = output[0]?.length ?? 0;
    for (let i = 0; i < frames; i++) {
      const iL = input[0]?.[i] ?? 0, iR = input[1]?.[i] ?? iL;
      const adaptive = this.processBranch("adaptive", iL, iR);
      const power = this.processBranch("power", iL, iR);
      let oL = iL, oR = iR, requested = 0, crest = 0, limit = 0;
      if (this.mode === "adaptive") { oL = adaptive.l; oR = adaptive.r; requested = adaptive.requestedGainDb; crest = adaptive.crestReductionDb; limit = adaptive.limiterReductionDb; }
      else if (this.mode === "power") { oL = power.l; oR = power.r; requested = power.requestedGainDb; crest = power.crestReductionDb; limit = power.limiterReductionDb; }
      if (output[0]) output[0][i] = oL; if (output[1]) output[1][i] = oR;
      for (let ch = 2; ch < output.length; ch++) if (output[ch]) output[ch][i] = ch % 2 === 0 ? oL : oR;
      this.addTelemetry(iL, iR, oL, oR, requested, crest, limit);
    }
    this.confirmModeIfAudible(input, frames);
    return true;
  }
}

registerProcessor("mvp-sound-modes", MvpSoundModesProcessor);
