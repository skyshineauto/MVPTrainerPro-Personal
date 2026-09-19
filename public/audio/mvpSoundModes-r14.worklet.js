class MvpSoundModesProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "pure";
    this.generation = 0;
    this.pendingModeConfirmation = true;
    this.profile = null;
    this.profileTrackId = null;

    this.tone = {
      adaptive: this.createToneBank("adaptive"),
      power: this.createToneBank("power"),
    };
    this.branch = {
      adaptive: this.createBranchState(),
      power: this.createBranchState(),
    };

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
        this.port.postMessage({ type:"ready", engine:"r14" });
        return;
      }
      if (m.type === "track-profile") {
        this.profileTrackId = typeof m.trackId === "string" ? m.trackId : null;
        this.profile = this.sanitizeProfile(m.profile);
        this.rebuildToneBanks();
        this.resetBranches();
        this.port.postMessage({
          type:"track-profile-active",
          engine:"r14",
          trackId:this.profileTrackId,
          applied:Boolean(this.profile),
        });
        return;
      }
      if (m.type === "mode" && ["pure","adaptive","power"].includes(m.mode)) {
        this.mode = m.mode;
        this.generation = Number.isFinite(Number(m.generation)) ? Number(m.generation) : this.generation + 1;
        // Critical R14 rule: mode switching NEVER resets DSP state.
        // Adaptive and Power stay warm in parallel even while PURE is selected.
        this.pendingModeConfirmation = true;
        this.resetTelemetry();
        this.port.postMessage({
          type:"mode-selected",
          mode:this.mode,
          generation:this.generation,
          engine:"r14",
        });
        return;
      }
      if (m.type === "reset") {
        // Track/source reset is allowed. Mode switching is not.
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
      const x = Number(value[key]);
      return Number.isFinite(x) ? x : fallback;
    };
    return {
      rmsDb:n("rmsDb",-12),
      truePeakDbtp:n("truePeakDbtp",-1),
      crestFactorDb:n("crestFactorDb",8),
      dynamicRangeDb:n("dynamicRangeDb",8),
      bassExtension:n("bassExtension",50),
      lowMidBuildup:n("lowMidBuildup",50),
      presenceBalance:n("presenceBalance",50),
      harshness:n("harshness",50),
      sibilance:n("sibilance",50),
      hfRolloff:n("hfRolloff",50),
      transientStrength:n("transientStrength",50),
      correlation:n("correlation",0.7),
      phaseRisk:Boolean(value.phaseRisk),
      sourceGainDb:n("sourceGainDb",0),
      lowMidDb:n("lowMidDb",0),
      presenceDb:n("presenceDb",0),
      harshnessDb:n("harshnessDb",0),
    };
  }

  createBiquad() { return { b0:1,b1:0,b2:0,a1:0,a2:0,z1:0,z2:0 }; }

  setPeaking(f, frequency, q, gainDb) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const hz = MvpSoundModesProcessor.clamp(frequency,10,sr*0.475);
    const A=Math.pow(10,gainDb/40),w=2*Math.PI*hz/sr,c=Math.cos(w),s=Math.sin(w);
    const alpha=s/(2*q),aa=1+alpha/A;
    f.b0=(1+alpha*A)/aa;f.b1=(-2*c)/aa;f.b2=(1-alpha*A)/aa;
    f.a1=(-2*c)/aa;f.a2=(1-alpha/A)/aa;
  }

  setLowShelf(f, frequency, gainDb) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const hz = MvpSoundModesProcessor.clamp(frequency,10,sr*0.475);
    const A=Math.pow(10,gainDb/40),w=2*Math.PI*hz/sr,c=Math.cos(w),s=Math.sin(w);
    const beta=2*Math.sqrt(A)*s,aa=(A+1)+(A-1)*c+beta;
    f.b0=A*((A+1)-(A-1)*c+beta)/aa;f.b1=2*A*((A-1)-(A+1)*c)/aa;
    f.b2=A*((A+1)-(A-1)*c-beta)/aa;f.a1=-2*((A-1)+(A+1)*c)/aa;
    f.a2=((A+1)+(A-1)*c-beta)/aa;
  }

  setHighShelf(f, frequency, gainDb) {
    const sr = typeof sampleRate === "number" && sampleRate > 0 ? sampleRate : 48000;
    const hz = MvpSoundModesProcessor.clamp(frequency,10,sr*0.475);
    const A=Math.pow(10,gainDb/40),w=2*Math.PI*hz/sr,c=Math.cos(w),s=Math.sin(w);
    const beta=2*Math.sqrt(A)*s,aa=(A+1)-(A-1)*c+beta;
    f.b0=A*((A+1)+(A-1)*c+beta)/aa;f.b1=-2*A*((A-1)+(A+1)*c)/aa;
    f.b2=A*((A+1)+(A-1)*c-beta)/aa;f.a1=2*((A-1)-(A+1)*c)/aa;
    f.a2=((A+1)-(A-1)*c-beta)/aa;
  }

  processBiquad(f,x) {
    const y=f.b0*x+f.z1;
    f.z1=f.b1*x-f.a1*y+f.z2;
    f.z2=f.b2*x-f.a2*y;
    return y;
  }

  profileToneAdjustments(mode) {
    const p=this.profile;
    if(!p) return {low:0,body:0,mud:0,mid:0,presence:0,air:0};
    const strength=mode==="power"?1:0.5;
    const bassNeed=MvpSoundModesProcessor.clamp((54-p.bassExtension)*0.035,-0.8,1.0);
    const bodyNeed=MvpSoundModesProcessor.clamp((54-p.lowMidBuildup)*0.028,-0.7,0.8);
    const harsh=Math.max(p.harshness,p.sibilance);
    const presenceNeed=MvpSoundModesProcessor.clamp((48-p.presenceBalance)*0.014,-0.35,0.35);
    const harshCut=MvpSoundModesProcessor.clamp((harsh-58)*0.018,0,0.65);
    const airNeed=MvpSoundModesProcessor.clamp((p.hfRolloff-58)*0.008,0,0.22)-harshCut*0.3;
    return {
      low:bassNeed*strength,
      body:bodyNeed*strength,
      mud:MvpSoundModesProcessor.clamp(p.lowMidDb,-0.8,0.15)*strength,
      mid:0,
      presence:(presenceNeed+MvpSoundModesProcessor.clamp(p.presenceDb,-0.3,0.3)-harshCut*0.45)*strength,
      air:airNeed*strength,
    };
  }

  createToneBank(mode) {
    const a=this.profileToneAdjustments(mode);
    const make=()=>{
      const f={low:this.createBiquad(),body:this.createBiquad(),mud:this.createBiquad(),mid:this.createBiquad(),presence:this.createBiquad(),air:this.createBiquad()};
      const s=mode==="power"
        ? {low:3.2+a.low,body:1.9+a.body,mud:-0.10+a.mud,mid:0.8,presence:0.22+a.presence,air:0.02+a.air}
        : {low:1.4+a.low,body:0.85+a.body,mud:-0.04+a.mud,mid:0.35,presence:0.10+a.presence,air:0.0+a.air};
      this.setLowShelf(f.low,74,s.low);
      this.setPeaking(f.body,165,0.76,s.body);
      this.setPeaking(f.mud,500,0.9,s.mud);
      this.setPeaking(f.mid,1000,0.8,s.mid);
      this.setPeaking(f.presence,3300,0.95,s.presence);
      this.setHighShelf(f.air,10500,s.air);
      return f;
    };
    return [make(),make()];
  }

  rebuildToneBanks() {
    this.tone={adaptive:this.createToneBank("adaptive"),power:this.createToneBank("power")};
  }

  processTone(bank,ch,x) {
    const f=bank[ch];
    x=this.processBiquad(f.low,x);x=this.processBiquad(f.body,x);x=this.processBiquad(f.mud,x);
    x=this.processBiquad(f.mid,x);x=this.processBiquad(f.presence,x);x=this.processBiquad(f.air,x);
    return x;
  }

  createTruePeakState() { return { hist:new Float32Array(16) }; }
  resetTruePeak(s) { s.hist.fill(0); }
  truePeak4x(s,sample) {
    const h=s.hist;
    for(let i=h.length-1;i>0;i--)h[i]=h[i-1];
    h[0]=sample;
    let p=Math.abs(sample);
    for(const phase of MvpSoundModesProcessor.TRUE_PEAK_TAPS){
      let y=0;
      for(let i=0;i<phase.length;i++)y+=h[i]*phase[i];
      p=Math.max(p,Math.abs(y));
    }
    return p;
  }

  createBranchState() {
    const lookaheadFrames=240;
    return {
      env:0,
      compGain:1,
      limiterGain:1,
      lookaheadFrames,
      lookL:new Float32Array(lookaheadFrames),
      lookR:new Float32Array(lookaheadFrames),
      lookIndex:0,
      tpL:this.createTruePeakState(),
      tpR:this.createTruePeakState(),
      bassLowL:0,
      bassLowR:0,
      prevL:0,
      prevR:0,
      fullEnergy:0,
      bassEnergy:0,
      diffEnergy:0,
      requestedGainDb:0,
      limiterReductionDb:0,
    };
  }

  resetBranchState(state) {
    state.env=0;state.compGain=1;state.limiterGain=1;state.lookIndex=0;
    state.lookL.fill(0);state.lookR.fill(0);this.resetTruePeak(state.tpL);this.resetTruePeak(state.tpR);
    state.bassLowL=0;state.bassLowR=0;state.prevL=0;state.prevR=0;state.fullEnergy=0;state.bassEnergy=0;state.diffEnergy=0;
    state.requestedGainDb=0;state.limiterReductionDb=0;
  }

  resetBranches() {
    this.resetBranchState(this.branch.adaptive);
    this.resetBranchState(this.branch.power);
    this.resetToneBank(this.tone.adaptive);
    this.resetToneBank(this.tone.power);
  }

  resetToneBank(bank) {
    for(const ch of bank)for(const f of Object.values(ch)){f.z1=0;f.z2=0;}
  }

  modeSettings(mode) {
    const p=this.profile;
    const rmsDb=p?.rmsDb??-12;
    const crest=p?.crestFactorDb??8;
    const quiet=MvpSoundModesProcessor.clamp((-10-rmsDb)/5,0,1);
    const hot=MvpSoundModesProcessor.clamp((rmsDb+11)/3,0,1);
    if(mode==="power"){
      return {
        ceiling:0.88,
        thresholdDb:0,
        ratio:1.0,
        attackMs:20,
        releaseMs:120,
        makeupDb:6.8 + quiet*2.2 + MvpSoundModesProcessor.clamp(p?.sourceGainDb??0,0,0.6),
        limiterReleaseMs:15,
      };
    }
    return {
      ceiling:0.91,
      thresholdDb:0,
      ratio:1.0,
      attackMs:25,
      releaseMs:150,
      makeupDb:3.2 + quiet*1.2 + MvpSoundModesProcessor.clamp(p?.sourceGainDb??0,0,0.4),
      limiterReleaseMs:28,
    };
  }

  processBranch(mode,iL,iR) {
    const state=this.branch[mode];
    const bank=this.tone[mode];
    const s=this.modeSettings(mode);
    const sr=typeof sampleRate==="number"&&sampleRate>0?sampleRate:48000;

    let l=this.processTone(bank,0,iL),r=this.processTone(bank,1,iR);

    const detector=Math.max(Math.abs(l),Math.abs(r));
    const attack=1-Math.exp(-1/(sr*s.attackMs/1000));
    const release=1-Math.exp(-1/(sr*s.releaseMs/1000));
    const ec=detector>state.env?attack:release;
    state.env+=(detector-state.env)*ec;

    let grDb=0;
    const envDb=MvpSoundModesProcessor.gainToDb(state.env);
    if(envDb>s.thresholdDb)grDb=(envDb-s.thresholdDb)*(1-1/s.ratio);
    const targetComp=MvpSoundModesProcessor.dbToGain(-grDb);
    const gc=targetComp<state.compGain?attack:release;
    state.compGain+=(targetComp-state.compGain)*gc;

    const makeup=MvpSoundModesProcessor.dbToGain(s.makeupDb);
    state.requestedGainDb=s.makeupDb;
    l*=state.compGain*makeup;
    r*=state.compGain*makeup;

    const bassAlpha=1-Math.exp(-2*Math.PI*145/sr);
    const energyAlpha=1-Math.exp(-1/(sr*.05));
    state.bassLowL+=(iL-state.bassLowL)*bassAlpha;
    state.bassLowR+=(iR-state.bassLowR)*bassAlpha;
    const diffL=iL-state.prevL,diffR=iR-state.prevR;state.prevL=iL;state.prevR=iR;
    const bassSq=(state.bassLowL*state.bassLowL+state.bassLowR*state.bassLowR)*.5;
    const fullSq=(iL*iL+iR*iR)*.5;
    const diffSq=(diffL*diffL+diffR*diffR)*.5;
    state.bassEnergy+=(bassSq-state.bassEnergy)*energyAlpha;
    state.fullEnergy+=(fullSq-state.fullEnergy)*energyAlpha;
    state.diffEnergy+=(diffSq-state.diffEnergy)*energyAlpha;

    const tp=Math.max(Math.abs(l),Math.abs(r));
    const required=tp>s.ceiling?s.ceiling/Math.max(tp,1e-12):1;
    if(required<state.limiterGain)state.limiterGain=required;
    else {
      const bassShare=MvpSoundModesProcessor.clamp(state.bassEnergy/Math.max(1e-12,state.fullEnergy),0,1);
      const diffShare=MvpSoundModesProcessor.clamp(state.diffEnergy/Math.max(1e-12,state.fullEnergy),0,1);
      const bassDominant=MvpSoundModesProcessor.clamp((bassShare-.45)/.3,0,1);
      const narrowband=1-MvpSoundModesProcessor.clamp((diffShare-.00035)/.006,0,1);
      const bassHold=bassDominant*narrowband;
      const releaseMs=s.limiterReleaseMs+(400-s.limiterReleaseMs)*bassHold;
      const releaseCoeff=1-Math.exp(-1/(sr*releaseMs/1000));
      state.limiterGain+=(1-state.limiterGain)*releaseCoeff;
    }
    state.limiterGain=MvpSoundModesProcessor.clamp(state.limiterGain,0.1,1);

    const dL=state.lookL[state.lookIndex],dR=state.lookR[state.lookIndex];
    state.lookL[state.lookIndex]=l;state.lookR[state.lookIndex]=r;
    state.lookIndex++;if(state.lookIndex>=state.lookaheadFrames)state.lookIndex=0;

    const oL=MvpSoundModesProcessor.clamp(dL*state.limiterGain,-s.ceiling,s.ceiling);
    const oR=MvpSoundModesProcessor.clamp(dR*state.limiterGain,-s.ceiling,s.ceiling);
    state.limiterReductionDb=Math.max(0,-MvpSoundModesProcessor.gainToDb(state.limiterGain));
    return {l:oL,r:oR,requestedGainDb:state.requestedGainDb,limiterReductionDb:state.limiterReductionDb};
  }

  resetTelemetry() {
    this.telemetryFrames=0;this.telemetryInputSq=0;this.telemetryOutputSq=0;this.telemetrySamples=0;
    this.telemetryPeak=0;this.telemetryLimiterReductionDb=0;this.telemetryRequestedGainDb=0;
  }

  addTelemetry(iL,iR,oL,oR,requestedGainDb,limiterReductionDb) {
    this.telemetryInputSq+=iL*iL+iR*iR;
    this.telemetryOutputSq+=oL*oL+oR*oR;
    this.telemetrySamples+=2;
    this.telemetryPeak=Math.max(this.telemetryPeak,Math.abs(oL),Math.abs(oR));
    this.telemetryRequestedGainDb=Math.max(this.telemetryRequestedGainDb,requestedGainDb);
    this.telemetryLimiterReductionDb=Math.max(this.telemetryLimiterReductionDb,limiterReductionDb);
    this.telemetryFrames++;
    const sr=typeof sampleRate==="number"&&sampleRate>0?sampleRate:48000;
    if(this.telemetryFrames<Math.floor(sr*.5))return;
    const inRms=Math.sqrt(this.telemetryInputSq/Math.max(1,this.telemetrySamples));
    const outRms=Math.sqrt(this.telemetryOutputSq/Math.max(1,this.telemetrySamples));
    const inDb=MvpSoundModesProcessor.gainToDb(inRms),outDb=MvpSoundModesProcessor.gainToDb(outRms);
    this.port.postMessage({
      type:"telemetry",engine:"r14",mode:this.mode,generation:this.generation,
      inputRmsDb:inDb,outputRmsDb:outDb,deltaDb:outDb-inDb,
      outputPeakDb:MvpSoundModesProcessor.gainToDb(this.telemetryPeak),
      requestedGainDb:this.telemetryRequestedGainDb,
      limiterReductionDb:this.telemetryLimiterReductionDb,
      trackProfileApplied:Boolean(this.profile),trackId:this.profileTrackId,
    });
    this.resetTelemetry();
  }

  static hasAudibleSignal(input,frames) {
    for(const src of input){
      if(!src)continue;
      for(let i=0;i<frames;i++)if(Math.abs(src[i]??0)>1e-5)return true;
    }
    return false;
  }

  confirmModeIfAudible(input,frames) {
    if(!this.pendingModeConfirmation||!MvpSoundModesProcessor.hasAudibleSignal(input,frames))return;
    this.pendingModeConfirmation=false;
    this.port.postMessage({type:"mode-active",engine:"r14",mode:this.mode,generation:this.generation});
  }

  process(inputs,outputs) {
    const input=inputs[0]??[],output=outputs[0]??[];
    if(!output.length)return true;
    const frames=output[0]?.length??0;

    for(let i=0;i<frames;i++){
      const iL=input[0]?.[i]??0,iR=input[1]?.[i]??iL;

      // Both processed branches run continuously. Switching modes only changes
      // which already-warm branch is heard; it never rebuilds or cold-starts DSP.
      const adaptive=this.processBranch("adaptive",iL,iR);
      const power=this.processBranch("power",iL,iR);

      let oL=iL,oR=iR,requested=0,limit=0;
      if(this.mode==="adaptive"){
        oL=adaptive.l;oR=adaptive.r;requested=adaptive.requestedGainDb;limit=adaptive.limiterReductionDb;
      }else if(this.mode==="power"){
        oL=power.l;oR=power.r;requested=power.requestedGainDb;limit=power.limiterReductionDb;
      }

      if(output[0])output[0][i]=oL;
      if(output[1])output[1][i]=oR;
      for(let ch=2;ch<output.length;ch++)if(output[ch])output[ch][i]=ch%2===0?oL:oR;

      this.addTelemetry(iL,iR,oL,oR,requested,limit);
    }

    this.confirmModeIfAudible(input,frames);
    return true;
  }
}

MvpSoundModesProcessor.TRUE_PEAK_TAPS = [
[0.0000000000,0.0006967276,-0.0036114518,0.0106894409,-0.0243920034,0.0473988787,-0.0853522687,0.1749621972,0.9271834644,-0.0558089374,0.0065336228,0.0051465217,-0.0059139618,0.0036139880,-0.0014253083,0.0002466871],
[-0.0000259944,0.0009306425,-0.0045142792,0.0140661965,-0.0349789143,0.0763806998,-0.1630375417,0.4750888740,0.7567609472,-0.1677299103,0.0663150886,-0.0261387989,0.0088488163,-0.0022472932,0.0003169478,-0.0000030777],
[-0.0000030777,0.0003169478,-0.0022472932,0.0088488163,-0.0261387989,0.0663150886,-0.1677299103,0.7567609472,0.4750888740,-0.1630375417,0.0763806998,-0.0349789143,0.0140661965,-0.0045142792,0.0009306425,-0.0000259944],
[0.0002466871,-0.0014253083,0.0036139880,-0.0059139618,0.0051465217,0.0065336228,-0.0558089374,0.9271834644,0.1749621972,-0.0853522687,0.0473988787,-0.0243920034,0.0106894409,-0.0036114518,0.0006967276,0.0000000000]
];

registerProcessor("mvp-sound-modes",MvpSoundModesProcessor);
