class MvpSoundModesProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "pure";
    this.generation = 0;
    this.pendingModeConfirmation = true;
    this.profile = null;
    this.profileTrackId = null;

    this.levelEnvSq = 0;
    this.levelGain = 1;
    this.crestEnv = 0;
    this.crestGain = 1;
    this.programRmsSq = 0;
    this.programGain = 1;
    this.requestedGainDb = 0;
    this.limiterGain = 1;
    this.limiterMaxReductionDb = 0;

    this.lookaheadFrames = 240;
    this.lookL = new Float32Array(this.lookaheadFrames);
    this.lookR = new Float32Array(this.lookaheadFrames);
    this.lookIndex = 0;
    this.tpL = this.createTruePeakState();
    this.tpR = this.createTruePeakState();

    this.tone = { adaptive: this.createToneBank("adaptive"), power: this.createToneBank("power") };

    this.telemetryFrames = 0;
    this.telemetryInputSq = 0;
    this.telemetryOutputSq = 0;
    this.telemetrySamples = 0;
    this.telemetryPeak = 0;
    this.telemetryLimiterReductionDb = 0;
    this.telemetryRequestedGainDb = 0;

    this.port.onmessage = (event) => {
      const m = event?.data ?? {};
      if (m.type === "ping") {
        this.port.postMessage({ type: "ready", engine: "r12" });
        return;
      }
      if (m.type === "track-profile") {
        this.profileTrackId = typeof m.trackId === "string" ? m.trackId : null;
        this.profile = this.sanitizeProfile(m.profile);
        this.rebuildToneBanks();
        this.resetDynamics();
        this.port.postMessage({
          type: "track-profile-active",
          engine: "r12",
          trackId: this.profileTrackId,
          applied: Boolean(this.profile),
        });
        return;
      }
      if (m.type === "mode" && ["pure", "adaptive", "power"].includes(m.mode)) {
        const changed = this.mode !== m.mode;
        this.mode = m.mode;
        this.generation = Number.isFinite(Number(m.generation)) ? Number(m.generation) : this.generation + 1;
        if (changed) this.resetDynamics();
        this.pendingModeConfirmation = true;
        this.port.postMessage({ type: "mode-selected", mode: this.mode, generation: this.generation, engine: "r12" });
        return;
      }
      if (m.type === "reset") {
        this.resetDynamics();
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
      const x = Number(value[key]);
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

  createBiquad() { return { b0:1,b1:0,b2:0,a1:0,a2:0,z1:0,z2:0 }; }

  setPeaking(f, frequency, q, gainDb) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const hz = MvpSoundModesProcessor.clamp(frequency, 10, sr * 0.475);
    const A = Math.pow(10, gainDb / 40);
    const w = 2 * Math.PI * hz / sr, c = Math.cos(w), s = Math.sin(w);
    const alpha = s / (2 * q), aa = 1 + alpha / A;
    f.b0=(1+alpha*A)/aa; f.b1=(-2*c)/aa; f.b2=(1-alpha*A)/aa;
    f.a1=(-2*c)/aa; f.a2=(1-alpha/A)/aa;
  }

  setLowShelf(f, frequency, gainDb) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const hz = MvpSoundModesProcessor.clamp(frequency, 10, sr * 0.475);
    const A=Math.pow(10,gainDb/40), w=2*Math.PI*hz/sr, c=Math.cos(w), s=Math.sin(w);
    const beta=2*Math.sqrt(A)*s, aa=(A+1)+(A-1)*c+beta;
    f.b0=A*((A+1)-(A-1)*c+beta)/aa; f.b1=2*A*((A-1)-(A+1)*c)/aa;
    f.b2=A*((A+1)-(A-1)*c-beta)/aa; f.a1=-2*((A-1)+(A+1)*c)/aa;
    f.a2=((A+1)+(A-1)*c-beta)/aa;
  }

  setHighShelf(f, frequency, gainDb) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const hz = MvpSoundModesProcessor.clamp(frequency, 10, sr * 0.475);
    const A=Math.pow(10,gainDb/40), w=2*Math.PI*hz/sr, c=Math.cos(w), s=Math.sin(w);
    const beta=2*Math.sqrt(A)*s, aa=(A+1)-(A-1)*c+beta;
    f.b0=A*((A+1)+(A-1)*c+beta)/aa; f.b1=-2*A*((A-1)+(A+1)*c)/aa;
    f.b2=A*((A+1)+(A-1)*c-beta)/aa; f.a1=2*((A-1)-(A+1)*c)/aa;
    f.a2=((A+1)-(A-1)*c-beta)/aa;
  }

  processBiquad(f, x) {
    const y=f.b0*x+f.z1;
    f.z1=f.b1*x-f.a1*y+f.z2;
    f.z2=f.b2*x-f.a2*y;
    return y;
  }

  profileToneAdjustments(mode) {
    const p = this.profile;
    if (!p) return { low:0, body:0, mud:0, mid:0, presence:0, air:0 };
    const strength = mode === "power" ? 1 : 0.46;
    const bassNeed = MvpSoundModesProcessor.clamp((54 - p.bassExtension) * 0.045, -1.2, 1.35);
    const bodyNeed = MvpSoundModesProcessor.clamp((54 - p.lowMidBuildup) * 0.035, -1.0, 1.0);
    const harsh = Math.max(p.harshness, p.sibilance);
    const presenceNeed = MvpSoundModesProcessor.clamp((48 - p.presenceBalance) * 0.018, -0.55, 0.55);
    const harshCut = MvpSoundModesProcessor.clamp((harsh - 58) * 0.022, 0, 0.9);
    const airNeed = MvpSoundModesProcessor.clamp((p.hfRolloff - 58) * 0.012, 0, 0.35) - harshCut * 0.35;
    return {
      low: bassNeed * strength,
      body: bodyNeed * strength,
      mud: MvpSoundModesProcessor.clamp(p.lowMidDb, -1.2, 0.2) * strength,
      mid: 0,
      presence: (presenceNeed + MvpSoundModesProcessor.clamp(p.presenceDb, -0.45, 0.45) - harshCut * 0.45) * strength,
      air: airNeed * strength,
    };
  }

  createToneBank(mode) {
    const a = this.profileToneAdjustments(mode);
    const make = () => {
      const f = { low:this.createBiquad(), body:this.createBiquad(), mud:this.createBiquad(), mid:this.createBiquad(), presence:this.createBiquad(), air:this.createBiquad() };
      const s = mode === "power"
        ? { low:4.9+a.low, body:3.25+a.body, mud:-0.18+a.mud, mid:1.65+a.mid, presence:0.42+a.presence, air:0.12+a.air }
        : { low:1.75+a.low, body:1.15+a.body, mud:-0.06+a.mud, mid:0.62+a.mid, presence:0.18+a.presence, air:0.06+a.air };
      this.setLowShelf(f.low, 74, s.low);
      this.setPeaking(f.body, 165, 0.75, s.body);
      this.setPeaking(f.mud, 500, 0.88, s.mud);
      this.setPeaking(f.mid, 1000, 0.78, s.mid);
      this.setPeaking(f.presence, 3300, 0.95, s.presence);
      this.setHighShelf(f.air, 10500, s.air);
      return f;
    };
    return [make(), make()];
  }

  rebuildToneBanks() {
    this.tone = { adaptive: this.createToneBank("adaptive"), power: this.createToneBank("power") };
  }

  processTone(bank, ch, x) {
    const f=bank[ch];
    x=this.processBiquad(f.low,x); x=this.processBiquad(f.body,x); x=this.processBiquad(f.mud,x);
    x=this.processBiquad(f.mid,x); x=this.processBiquad(f.presence,x); x=this.processBiquad(f.air,x);
    return x;
  }

  resetToneBank(bank) { for (const ch of bank) for (const f of Object.values(ch)) { f.z1=0; f.z2=0; } }
  createTruePeakState(){ return { hist:new Float32Array(16) }; }
  resetTruePeak(s){ s.hist.fill(0); }

  truePeak4x(s, sample) {
    const h=s.hist;
    for(let i=h.length-1;i>0;i--) h[i]=h[i-1];
    h[0]=sample;
    let p=Math.abs(sample);
    for(const phase of MvpSoundModesProcessor.TRUE_PEAK_TAPS){
      let y=0;
      for(let i=0;i<phase.length;i++) y+=h[i]*phase[i];
      p=Math.max(p,Math.abs(y));
    }
    return p;
  }

  resetDynamics() {
    this.levelEnvSq=0; this.levelGain=1; this.crestEnv=0; this.crestGain=1;
    this.programRmsSq=0; this.programGain=1; this.requestedGainDb=0;
    this.limiterGain=1; this.limiterMaxReductionDb=0;
    this.lookL.fill(0); this.lookR.fill(0); this.lookIndex=0;
    this.resetTruePeak(this.tpL); this.resetTruePeak(this.tpR);
    this.resetToneBank(this.tone.adaptive); this.resetToneBank(this.tone.power);
  }

  static copyInput(input, output) {
    const frames=output[0]?.length??0;
    for(let ch=0;ch<output.length;ch++){
      const src=input[ch]??input[0], dst=output[ch];
      if(!dst) continue;
      if(!src){dst.fill(0);continue;}
      for(let i=0;i<frames;i++) dst[i]=src[i]??0;
    }
  }

  static hasAudibleSignal(input, frames) {
    for(const src of input){ if(!src) continue; for(let i=0;i<frames;i++) if(Math.abs(src[i]??0)>1e-5) return true; }
    return false;
  }

  confirmModeIfAudible(input, frames) {
    if(!this.pendingModeConfirmation || !MvpSoundModesProcessor.hasAudibleSignal(input,frames)) return;
    this.pendingModeConfirmation=false;
    this.port.postMessage({type:"mode-active",mode:this.mode,generation:this.generation,engine:"r12"});
  }

  modeSettings(power) {
    const p=this.profile;
    const hot = p ? MvpSoundModesProcessor.clamp((p.rmsDb + 13) / 5, 0, 1) : 0.45;
    const crest = p ? p.crestFactorDb : 8;
    const transient = p ? p.transientStrength : 50;
    if(power){
      return {
        ceiling:.89,
        levelThresholdDb:-20.5 + hot*1.5,
        levelRatio:3.1 + hot*0.8,
        levelAttackMs:28,
        levelReleaseMs:220,
        levelWet:.72,
        crestThresholdDb:-8.0 + MvpSoundModesProcessor.clamp((8-crest)*0.18,-0.6,0.5),
        crestRatio:4.8,
        crestAttackMs:3.2,
        crestReleaseMs:78 + MvpSoundModesProcessor.clamp((transient-50)*0.35,-12,18),
        crestWet:.84,
        targetRmsDb:-5.8 + hot*0.35,
        maxMakeupDb:10.5,
        gainAttackMs:95,
        gainReleaseMs:320,
        limiterReleaseMs:95,
      };
    }
    return {
      ceiling:.91,
      levelThresholdDb:-16.5 + hot*0.8,
      levelRatio:2.0 + hot*0.3,
      levelAttackMs:38,
      levelReleaseMs:270,
      levelWet:.46,
      crestThresholdDb:-6.2,
      crestRatio:2.2,
      crestAttackMs:7,
      crestReleaseMs:125,
      crestWet:.36,
      targetRmsDb:-9.4 + hot*0.2,
      maxMakeupDb:5.4,
      gainAttackMs:170,
      gainReleaseMs:480,
      limiterReleaseMs:130,
    };
  }

  addTelemetry(iL,iR,oL,oR,gr,requestedGainDb) {
    this.telemetryInputSq+=iL*iL+iR*iR; this.telemetryOutputSq+=oL*oL+oR*oR; this.telemetrySamples+=2;
    this.telemetryPeak=Math.max(this.telemetryPeak,Math.abs(oL),Math.abs(oR));
    this.telemetryLimiterReductionDb=Math.max(this.telemetryLimiterReductionDb,gr);
    this.telemetryRequestedGainDb=Math.max(this.telemetryRequestedGainDb,requestedGainDb);
    this.telemetryFrames++;
    const sr=typeof sampleRate==="number"&&sampleRate>0?sampleRate:48000;
    if(this.telemetryFrames<Math.floor(sr*.5)) return;
    const inRms=Math.sqrt(this.telemetryInputSq/Math.max(1,this.telemetrySamples));
    const outRms=Math.sqrt(this.telemetryOutputSq/Math.max(1,this.telemetrySamples));
    const inDb=MvpSoundModesProcessor.gainToDb(inRms),outDb=MvpSoundModesProcessor.gainToDb(outRms);
    this.port.postMessage({
      type:"telemetry",mode:this.mode,generation:this.generation,engine:"r12",
      inputRmsDb:inDb,outputRmsDb:outDb,deltaDb:outDb-inDb,
      outputPeakDb:MvpSoundModesProcessor.gainToDb(this.telemetryPeak),
      requestedGainDb:this.telemetryRequestedGainDb,
      limiterReductionDb:this.telemetryLimiterReductionDb,
      trackProfileApplied:Boolean(this.profile),trackId:this.profileTrackId,
    });
    this.telemetryFrames=0; this.telemetryInputSq=0; this.telemetryOutputSq=0; this.telemetrySamples=0;
    this.telemetryPeak=0; this.telemetryLimiterReductionDb=0; this.telemetryRequestedGainDb=0;
  }

  process(inputs, outputs) {
    const input=inputs[0]??[],output=outputs[0]??[];
    if(!output.length) return true;
    const frames=output[0]?.length??0;

    if(this.mode==="pure"){
      MvpSoundModesProcessor.copyInput(input,output);
      for(let i=0;i<frames;i++){const l=input[0]?.[i]??0,r=input[1]?.[i]??l;this.addTelemetry(l,r,l,r,0,0);}
      this.confirmModeIfAudible(input,frames);
      return true;
    }

    const power=this.mode==="power";
    const bank=power?this.tone.power:this.tone.adaptive;
    const sr=typeof sampleRate==="number"&&sampleRate>0?sampleRate:48000;
    const s=this.modeSettings(power);

    const levelAttack=1-Math.exp(-1/(sr*s.levelAttackMs/1000));
    const levelRelease=1-Math.exp(-1/(sr*s.levelReleaseMs/1000));
    const crestAttack=1-Math.exp(-1/(sr*s.crestAttackMs/1000));
    const crestRelease=1-Math.exp(-1/(sr*s.crestReleaseMs/1000));
    const rmsCoeff=Math.exp(-1/(sr*.42));
    const gainAttack=1-Math.exp(-1/(sr*s.gainAttackMs/1000));
    const gainRelease=1-Math.exp(-1/(sr*s.gainReleaseMs/1000));
    const limiterRelease=1-Math.exp(-1/(sr*s.limiterReleaseMs/1000));
    const levelThreshold=MvpSoundModesProcessor.dbToGain(s.levelThresholdDb);
    const crestThreshold=MvpSoundModesProcessor.dbToGain(s.crestThresholdDb);
    const maxMakeup=MvpSoundModesProcessor.dbToGain(s.maxMakeupDb + MvpSoundModesProcessor.clamp(this.profile?.sourceGainDb??0,0,.8));

    for(let i=0;i<frames;i++){
      const iL=input[0]?.[i]??0,iR=input[1]?.[i]??iL;
      let l=this.processTone(bank,0,iL),r=this.processTone(bank,1,iR);

      const sampleSq=(l*l+r*r)*.5;
      const lc=sampleSq>this.levelEnvSq?levelAttack:levelRelease;
      this.levelEnvSq+=(sampleSq-this.levelEnvSq)*lc;
      const levelEnv=Math.sqrt(Math.max(1e-12,this.levelEnvSq));
      let levelTarget=1;
      if(levelEnv>levelThreshold) levelTarget=Math.pow(levelEnv/levelThreshold,(1/s.levelRatio)-1);
      const lgc=levelTarget<this.levelGain?levelAttack:levelRelease;
      this.levelGain+=(levelTarget-this.levelGain)*lgc;
      const levelDensity=(1-s.levelWet)+s.levelWet*this.levelGain;
      l*=levelDensity;r*=levelDensity;

      const peak=Math.max(Math.abs(l),Math.abs(r));
      const cc=peak>this.crestEnv?crestAttack:crestRelease;
      this.crestEnv+=(peak-this.crestEnv)*cc;
      let crestTarget=1;
      if(this.crestEnv>crestThreshold) crestTarget=Math.pow(this.crestEnv/crestThreshold,(1/s.crestRatio)-1);
      const cgc=crestTarget<this.crestGain?crestAttack:crestRelease;
      this.crestGain+=(crestTarget-this.crestGain)*cgc;
      const crestDensity=(1-s.crestWet)+s.crestWet*this.crestGain;
      l*=crestDensity;r*=crestDensity;

      const postSq=(l*l+r*r)*.5;
      this.programRmsSq=rmsCoeff*this.programRmsSq+(1-rmsCoeff)*postSq;
      const programRms=Math.sqrt(Math.max(1e-12,this.programRmsSq));
      const currentRmsDb=MvpSoundModesProcessor.gainToDb(programRms);
      const desired=MvpSoundModesProcessor.clamp(MvpSoundModesProcessor.dbToGain(s.targetRmsDb-currentRmsDb),1,maxMakeup);
      const pgc=desired<this.programGain?gainAttack:gainRelease;
      this.programGain+=(desired-this.programGain)*pgc;
      this.requestedGainDb=MvpSoundModesProcessor.gainToDb(this.programGain);
      l*=this.programGain;r*=this.programGain;

      const tp=Math.max(this.truePeak4x(this.tpL,l),this.truePeak4x(this.tpR,r));
      const required=tp>s.ceiling?s.ceiling/Math.max(tp,1e-12):1;
      if(required<this.limiterGain)this.limiterGain=required;
      else this.limiterGain+=(1-this.limiterGain)*limiterRelease;
      this.limiterGain=MvpSoundModesProcessor.clamp(this.limiterGain,.10,1);

      const dL=this.lookL[this.lookIndex],dR=this.lookR[this.lookIndex];
      this.lookL[this.lookIndex]=l;this.lookR[this.lookIndex]=r;
      this.lookIndex++;if(this.lookIndex>=this.lookaheadFrames)this.lookIndex=0;

      const oL=MvpSoundModesProcessor.clamp(dL*this.limiterGain,-s.ceiling,s.ceiling);
      const oR=MvpSoundModesProcessor.clamp(dR*this.limiterGain,-s.ceiling,s.ceiling);
      const gr=Math.max(0,-MvpSoundModesProcessor.gainToDb(this.limiterGain));
      this.limiterMaxReductionDb=Math.max(this.limiterMaxReductionDb,gr);

      if(output[0])output[0][i]=oL;if(output[1])output[1][i]=oR;
      for(let ch=2;ch<output.length;ch++)if(output[ch])output[ch][i]=ch%2===0?oL:oR;
      this.addTelemetry(iL,iR,oL,oR,gr,this.requestedGainDb);
    }

    this.confirmModeIfAudible(input,frames);
    return true;
  }
}

MvpSoundModesProcessor.TRUE_PEAK_TAPS=[
[0.0000000000,0.0006967276,-0.0036114518,0.0106894409,-0.0243920034,0.0473988787,-0.0853522687,0.1749621972,0.9271834644,-0.0558089374,0.0065336228,0.0051465217,-0.0059139618,0.0036139880,-0.0014253083,0.0002466871],
[-0.0000259944,0.0009306425,-0.0045142792,0.0140661965,-0.0349789143,0.0763806998,-0.1630375417,0.4750888740,0.7567609472,-0.1677299103,0.0663150886,-0.0261387989,0.0088488163,-0.0022472932,0.0003169478,-0.0000030777],
[-0.0000030777,0.0003169478,-0.0022472932,0.0088488163,-0.0261387989,0.0663150886,-0.1677299103,0.7567609472,0.4750888740,-0.1630375417,0.0763806998,-0.0349789143,0.0140661965,-0.0045142792,0.0009306425,-0.0000259944],
[0.0002466871,-0.0014253083,0.0036139880,-0.0059139618,0.0051465217,0.0065336228,-0.0558089374,0.9271834644,0.1749621972,-0.0853522687,0.0473988787,-0.0243920034,0.0106894409,-0.0036114518,0.0006967276,0.0000000000]
];
registerProcessor("mvp-sound-modes",MvpSoundModesProcessor);
