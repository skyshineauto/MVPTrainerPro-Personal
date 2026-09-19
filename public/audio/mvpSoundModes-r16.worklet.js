class MvpSoundModesProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "pure";
    this.generation = 0;
    this.pendingModeConfirmation = true;
    this.profile = null;
    this.profileTrackId = null;
    this.profileClass = "fallback";
    this.tone = {
      adaptive: this.createToneBank("adaptive"),
      power: this.createToneBank("power"),
    };
    this.branch = {
      adaptive: this.createBranchState(),
      power: this.createBranchState(),
    };
    this.settings = { adaptive: null, power: null };
    this.rebuildSettings();
    this.resetTelemetry();

    this.port.onmessage = (event) => {
      const m = event?.data ?? {};
      if (m.type === "ping") {
        this.port.postMessage({ type: "ready", engine: "r16" });
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
          engine: "r16",
          trackId: this.profileTrackId,
          applied: Boolean(this.profile),
          profileClass: this.profileClass,
        });
        return;
      }
      if (m.type === "mode" && ["pure", "adaptive", "power"].includes(m.mode)) {
        this.mode = m.mode;
        this.generation = Number.isFinite(Number(m.generation)) ? Number(m.generation) : this.generation + 1;
        // Mode switching never resets either processed branch. Both remain warm.
        this.pendingModeConfirmation = true;
        this.resetTelemetry();
        this.port.postMessage({ type: "mode-selected", engine: "r16", mode: this.mode, generation: this.generation });
        return;
      }
      if (m.type === "reset") {
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

  createBiquad() { return { b0:1, b1:0, b2:0, a1:0, a2:0, z1:0, z2:0 }; }
  setPeaking(f, frequency, q, gainDb) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const hz = MvpSoundModesProcessor.clamp(frequency, 10, sr * 0.475);
    const A = Math.pow(10, gainDb / 40), w = 2 * Math.PI * hz / sr, c = Math.cos(w), s = Math.sin(w);
    const alpha = s / (2 * q), aa = 1 + alpha / A;
    f.b0=(1+alpha*A)/aa; f.b1=(-2*c)/aa; f.b2=(1-alpha*A)/aa; f.a1=(-2*c)/aa; f.a2=(1-alpha/A)/aa;
  }
  setLowShelf(f, frequency, gainDb) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const hz = MvpSoundModesProcessor.clamp(frequency, 10, sr * 0.475);
    const A=Math.pow(10,gainDb/40), w=2*Math.PI*hz/sr, c=Math.cos(w), s=Math.sin(w);
    const beta=2*Math.sqrt(A)*s, aa=(A+1)+(A-1)*c+beta;
    f.b0=A*((A+1)-(A-1)*c+beta)/aa; f.b1=2*A*((A-1)-(A+1)*c)/aa;
    f.b2=A*((A+1)-(A-1)*c-beta)/aa; f.a1=-2*((A-1)+(A+1)*c)/aa; f.a2=((A+1)+(A-1)*c-beta)/aa;
  }
  setHighShelf(f, frequency, gainDb) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const hz = MvpSoundModesProcessor.clamp(frequency, 10, sr * 0.475);
    const A=Math.pow(10,gainDb/40), w=2*Math.PI*hz/sr, c=Math.cos(w), s=Math.sin(w);
    const beta=2*Math.sqrt(A)*s, aa=(A+1)-(A-1)*c+beta;
    f.b0=A*((A+1)+(A-1)*c+beta)/aa; f.b1=-2*A*((A-1)+(A+1)*c)/aa;
    f.b2=A*((A+1)+(A-1)*c-beta)/aa; f.a1=2*((A-1)-(A+1)*c)/aa; f.a2=((A+1)-(A-1)*c-beta)/aa;
  }
  processBiquad(f, x) {
    const y = f.b0*x + f.z1;
    f.z1 = f.b1*x - f.a1*y + f.z2;
    f.z2 = f.b2*x - f.a2*y;
    return y;
  }

  profileToneAdjustments(mode) {
    const p = this.profile;
    if (!p) return { low:0, body:0, mud:0, mid:0, presence:0, air:0 };
    const strength = mode === "power" ? 1 : 0.6;
    const bassNeed = MvpSoundModesProcessor.clamp((55 - p.bassExtension) * 0.026, -1.0, 0.9);
    const bodyNeed = MvpSoundModesProcessor.clamp((54 - p.lowMidBuildup) * 0.022, -0.7, 0.7);
    const harsh = Math.max(p.harshness, p.sibilance);
    const harshCut = MvpSoundModesProcessor.clamp((harsh - 56) * 0.020, 0, 0.8);
    const presenceNeed = MvpSoundModesProcessor.clamp((49 - p.presenceBalance) * 0.012, -0.3, 0.3) - harshCut * 0.45;
    const airNeed = MvpSoundModesProcessor.clamp((p.hfRolloff - 58) * 0.007, 0, 0.18) - harshCut * 0.2;
    return {
      low: bassNeed * strength,
      body: bodyNeed * strength,
      mud: MvpSoundModesProcessor.clamp(p.lowMidDb, -0.6, 0.1) * strength,
      mid: 0,
      presence: (presenceNeed + MvpSoundModesProcessor.clamp(p.presenceDb, -0.2, 0.25)) * strength,
      air: airNeed * strength,
    };
  }

  createToneBank(mode) {
    const a = this.profileToneAdjustments(mode);
    const make = () => {
      const f={low:this.createBiquad(),body:this.createBiquad(),mud:this.createBiquad(),mid:this.createBiquad(),presence:this.createBiquad(),air:this.createBiquad()};
      const s = mode === "power"
        ? { low:2.3+a.low, body:1.55+a.body, mud:-0.12+a.mud, mid:0.70, presence:0.45+a.presence, air:0.18+a.air }
        : { low:1.25+a.low, body:0.85+a.body, mud:-0.08+a.mud, mid:0.38, presence:0.25+a.presence, air:0.10+a.air };
      this.setLowShelf(f.low, 72, s.low);
      this.setPeaking(f.body, 175, 0.74, s.body);
      this.setPeaking(f.mud, 470, 0.9, s.mud);
      this.setPeaking(f.mid, 1050, 0.85, s.mid);
      this.setPeaking(f.presence, 3300, 0.95, s.presence);
      this.setHighShelf(f.air, 10500, s.air);
      return f;
    };
    return [make(), make()];
  }
  rebuildToneBanks() { this.tone={adaptive:this.createToneBank("adaptive"), power:this.createToneBank("power")}; }
  resetToneBank(bank) { for (const ch of bank) for (const f of Object.values(ch)) { f.z1=0; f.z2=0; } }
  processTone(bank, ch, x) {
    const f = bank[ch];
    x=this.processBiquad(f.low,x); x=this.processBiquad(f.body,x); x=this.processBiquad(f.mud,x);
    x=this.processBiquad(f.mid,x); x=this.processBiquad(f.presence,x); x=this.processBiquad(f.air,x);
    return x;
  }

  modeSettings(mode) {
    const c = this.profileClass;
    const p = this.profile;
    const sourceGain = MvpSoundModesProcessor.clamp(p?.sourceGainDb ?? 0, -0.4, 0.8);
    const base = mode === "power" ? {
      dynamic:{thresholdDb:-18.0,ratio:3.4,attackMs:2,releaseMs:120,makeupDb:10.2},
      normal:{thresholdDb:-15.0,ratio:3.0,attackMs:2,releaseMs:120,makeupDb:8.8},
      hot:{thresholdDb:-11.5,ratio:2.7,attackMs:2,releaseMs:110,makeupDb:7.0},
      brick:{thresholdDb:-9.0,ratio:2.35,attackMs:2,releaseMs:100,makeupDb:4.6},
      fallback:{thresholdDb:-14.5,ratio:2.8,attackMs:2,releaseMs:120,makeupDb:8.4},
    } : {
      dynamic:{thresholdDb:-14.5,ratio:2.2,attackMs:3,releaseMs:145,makeupDb:4.9},
      normal:{thresholdDb:-12.0,ratio:2.0,attackMs:3,releaseMs:145,makeupDb:4.3},
      hot:{thresholdDb:-9.5,ratio:1.9,attackMs:3,releaseMs:135,makeupDb:3.8},
      brick:{thresholdDb:-7.5,ratio:1.7,attackMs:3,releaseMs:125,makeupDb:3.0},
      fallback:{thresholdDb:-11.5,ratio:2.0,attackMs:3,releaseMs:140,makeupDb:4.1},
    };
    const b=base[c] ?? base.fallback;
    const sr=typeof sampleRate === "number" && sampleRate>0 ? sampleRate : 48000;
    const extra = Math.max(0, sourceGain) * (mode === "power" ? 0.5 : 0.3);
    const makeupDb=b.makeupDb + extra;
    return {
      ...b,
      makeupDb,
      makeup:MvpSoundModesProcessor.dbToGain(makeupDb),
      attackCoeff:1-Math.exp(-1/(sr*b.attackMs/1000)),
      releaseCoeff:1-Math.exp(-1/(sr*b.releaseMs/1000)),
      detectorLpAlpha:1-Math.exp(-2*Math.PI*105/sr),
    };
  }
  rebuildSettings() { this.settings={adaptive:this.modeSettings("adaptive"), power:this.modeSettings("power")}; }

  createBranchState() {
    return { env:0, compGain:1, detectorLowL:0, detectorLowR:0, requestedGainDb:0, compressionDb:0 };
  }
  resetBranchState(s) { s.env=0; s.compGain=1; s.detectorLowL=0; s.detectorLowR=0; s.requestedGainDb=0; s.compressionDb=0; }
  resetBranches() {
    this.resetBranchState(this.branch.adaptive); this.resetBranchState(this.branch.power);
    this.resetToneBank(this.tone.adaptive); this.resetToneBank(this.tone.power);
  }

  processBranch(mode, iL, iR) {
    const state=this.branch[mode], bank=this.tone[mode], s=this.settings[mode];
    let l=this.processTone(bank,0,iL), r=this.processTone(bank,1,iR);

    state.detectorLowL += (l-state.detectorLowL)*s.detectorLpAlpha;
    state.detectorLowR += (r-state.detectorLowR)*s.detectorLpAlpha;
    const hpL=l-state.detectorLowL, hpR=r-state.detectorLowR;
    const detector=Math.max(Math.abs(hpL)+Math.abs(state.detectorLowL)*0.5, Math.abs(hpR)+Math.abs(state.detectorLowR)*0.5);
    if(detector>state.env) state.env=detector;
    else state.env += (detector-state.env)*s.releaseCoeff;

    const envDb=MvpSoundModesProcessor.gainToDb(state.env);
    const overDb=Math.max(0,envDb-s.thresholdDb);
    const grDb=overDb*(1-1/s.ratio);
    const target=MvpSoundModesProcessor.dbToGain(-grDb);
    if(target<state.compGain) state.compGain=target;
    else state.compGain += (target-state.compGain)*s.releaseCoeff;

    const gain=state.compGain*s.makeup;
    l*=gain; r*=gain;
    state.requestedGainDb=s.makeupDb;
    state.compressionDb=Math.max(0,-MvpSoundModesProcessor.gainToDb(state.compGain));
    return { l, r, requestedGainDb:state.requestedGainDb, compressionDb:state.compressionDb, limiterReductionDb:0 };
  }

  resetTelemetry() {
    this.telemetryFrames=0; this.telemetryInputSq=0; this.telemetryOutputSq=0; this.telemetrySamples=0;
    this.telemetryPeak=0; this.telemetryRequestedGainDb=0; this.telemetryCompressionDb=0;
  }
  addTelemetry(iL,iR,oL,oR,requestedGainDb,compressionDb) {
    this.telemetryInputSq+=iL*iL+iR*iR; this.telemetryOutputSq+=oL*oL+oR*oR; this.telemetrySamples+=2;
    this.telemetryPeak=Math.max(this.telemetryPeak,Math.abs(oL),Math.abs(oR));
    this.telemetryRequestedGainDb=Math.max(this.telemetryRequestedGainDb,requestedGainDb);
    this.telemetryCompressionDb=Math.max(this.telemetryCompressionDb,compressionDb);
    this.telemetryFrames++;
    const sr=typeof sampleRate === "number" && sampleRate>0 ? sampleRate : 48000;
    if(this.telemetryFrames<Math.floor(sr*0.5))return;
    const inRms=Math.sqrt(this.telemetryInputSq/Math.max(1,this.telemetrySamples));
    const outRms=Math.sqrt(this.telemetryOutputSq/Math.max(1,this.telemetrySamples));
    const inDb=MvpSoundModesProcessor.gainToDb(inRms), outDb=MvpSoundModesProcessor.gainToDb(outRms);
    this.port.postMessage({
      type:"telemetry", engine:"r16", mode:this.mode, generation:this.generation,
      inputRmsDb:inDb, outputRmsDb:outDb, deltaDb:outDb-inDb,
      outputPeakDb:MvpSoundModesProcessor.gainToDb(this.telemetryPeak),
      requestedGainDb:this.telemetryRequestedGainDb,
      compressionDb:this.telemetryCompressionDb,
      limiterReductionDb:0,
      trackProfileApplied:Boolean(this.profile), trackId:this.profileTrackId, profileClass:this.profileClass,
    });
    this.resetTelemetry();
  }

  static hasAudibleSignal(input,frames) {
    for(const src of input){if(!src)continue;for(let i=0;i<frames;i++)if(Math.abs(src[i]??0)>1e-5)return true;}
    return false;
  }
  confirmModeIfAudible(input,frames) {
    if(!this.pendingModeConfirmation||!MvpSoundModesProcessor.hasAudibleSignal(input,frames))return;
    this.pendingModeConfirmation=false;
    this.port.postMessage({type:"mode-active",engine:"r16",mode:this.mode,generation:this.generation});
  }

  process(inputs,outputs) {
    const input=inputs[0]??[], output=outputs[0]??[];
    if(!output.length)return true;
    const frames=output[0]?.length??0;
    for(let i=0;i<frames;i++){
      const iL=input[0]?.[i]??0, iR=input[1]?.[i]??iL;
      const adaptive=this.processBranch("adaptive",iL,iR);
      const power=this.processBranch("power",iL,iR);
      let oL=iL,oR=iR,requested=0,compression=0;
      if(this.mode==="adaptive"){oL=adaptive.l;oR=adaptive.r;requested=adaptive.requestedGainDb;compression=adaptive.compressionDb;}
      else if(this.mode==="power"){oL=power.l;oR=power.r;requested=power.requestedGainDb;compression=power.compressionDb;}
      if(output[0])output[0][i]=oL;
      if(output[1])output[1][i]=oR;
      for(let ch=2;ch<output.length;ch++)if(output[ch])output[ch][i]=ch%2===0?oL:oR;
      this.addTelemetry(iL,iR,oL,oR,requested,compression);
    }
    this.confirmModeIfAudible(input,frames);
    return true;
  }
}
registerProcessor("mvp-sound-modes",MvpSoundModesProcessor);
