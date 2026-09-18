class MvpSoundModesProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "pure";
    this.pendingModeConfirmation = true;
    this.compEnv = 0;
    this.compGain = 1;
    this.limiterGain = 1;
    this.limiterMaxReductionDb = 0;
    this.lookaheadFrames = 192;
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

    this.port.onmessage = (event) => {
      const m = event?.data ?? {};
      if (m.type === "ping") {
        this.port.postMessage({ type: "ready", engine: "r11" });
        return;
      }
      if (m.type === "mode" && ["pure", "adaptive", "power"].includes(m.mode)) {
        const changed = this.mode !== m.mode;
        this.mode = m.mode;
        if (changed) this.resetForModeChange();
        this.pendingModeConfirmation = true;
        this.port.postMessage({ type: "mode-selected", mode: this.mode, engine: "r11" });
        return;
      }
      if (m.type === "reset") {
        this.resetForModeChange();
        this.pendingModeConfirmation = true;
      }
    };
  }

  static clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  static dbToGain(db) { return Math.pow(10, db / 20); }
  static gainToDb(g) { return 20 * Math.log10(Math.max(1e-12, g)); }

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

  createToneBank(mode) {
    const make = () => {
      const f = {
        low:this.createBiquad(),
        body:this.createBiquad(),
        mud:this.createBiquad(),
        mid:this.createBiquad(),
        presence:this.createBiquad(),
        air:this.createBiquad(),
      };
      const s = mode === "power"
        ? { low:5.5, body:3.6, mud:-0.35, mid:2.0, presence:0.8, air:0.35 }
        : { low:1.7, body:1.0, mud:-0.10, mid:0.55, presence:0.25, air:0.15 };
      this.setLowShelf(f.low, 72, s.low);
      this.setPeaking(f.body, 165, 0.74, s.body);
      this.setPeaking(f.mud, 500, 0.90, s.mud);
      this.setPeaking(f.mid, 1000, 0.78, s.mid);
      this.setPeaking(f.presence, 3300, 0.95, s.presence);
      this.setHighShelf(f.air, 10500, s.air);
      return f;
    };
    return [make(), make()];
  }

  processTone(bank, ch, x) {
    const f=bank[ch];
    x=this.processBiquad(f.low,x);
    x=this.processBiquad(f.body,x);
    x=this.processBiquad(f.mud,x);
    x=this.processBiquad(f.mid,x);
    x=this.processBiquad(f.presence,x);
    x=this.processBiquad(f.air,x);
    return x;
  }

  resetToneBank(bank) {
    for (const ch of bank) for (const f of Object.values(ch)) { f.z1=0; f.z2=0; }
  }

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

  resetForModeChange() {
    this.compEnv=0;
    this.compGain=1;
    this.limiterGain=1;
    this.limiterMaxReductionDb=0;
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
    for(const src of input){
      if(!src) continue;
      for(let i=0;i<frames;i++) if(Math.abs(src[i]??0)>1e-5) return true;
    }
    return false;
  }

  confirmModeIfAudible(input, frames) {
    if(!this.pendingModeConfirmation) return;
    if(!MvpSoundModesProcessor.hasAudibleSignal(input, frames)) return;
    this.pendingModeConfirmation=false;
    this.port.postMessage({type:"mode-active",mode:this.mode,engine:"r11"});
  }

  addTelemetry(iL,iR,oL,oR,gr) {
    this.telemetryInputSq+=iL*iL+iR*iR;
    this.telemetryOutputSq+=oL*oL+oR*oR;
    this.telemetrySamples+=2;
    this.telemetryPeak=Math.max(this.telemetryPeak,Math.abs(oL),Math.abs(oR));
    this.telemetryLimiterReductionDb=Math.max(this.telemetryLimiterReductionDb,gr);
    this.telemetryFrames++;
    const sr=typeof sampleRate==="number"&&sampleRate>0?sampleRate:48000;
    if(this.telemetryFrames<Math.floor(sr*.5)) return;
    const inRms=Math.sqrt(this.telemetryInputSq/Math.max(1,this.telemetrySamples));
    const outRms=Math.sqrt(this.telemetryOutputSq/Math.max(1,this.telemetrySamples));
    const inDb=MvpSoundModesProcessor.gainToDb(inRms), outDb=MvpSoundModesProcessor.gainToDb(outRms);
    this.port.postMessage({
      type:"telemetry",mode:this.mode,engine:"r11",
      inputRmsDb:inDb,outputRmsDb:outDb,deltaDb:outDb-inDb,
      outputPeakDb:MvpSoundModesProcessor.gainToDb(this.telemetryPeak),
      limiterReductionDb:this.telemetryLimiterReductionDb
    });
    this.telemetryFrames=0; this.telemetryInputSq=0; this.telemetryOutputSq=0;
    this.telemetrySamples=0; this.telemetryPeak=0; this.telemetryLimiterReductionDb=0;
  }

  process(inputs, outputs) {
    const input=inputs[0]??[], output=outputs[0]??[];
    if(!output.length) return true;
    const frames=output[0]?.length??0;

    if(this.mode==="pure"){
      MvpSoundModesProcessor.copyInput(input,output);
      for(let i=0;i<frames;i++){
        const l=input[0]?.[i]??0,r=input[1]?.[i]??l;
        this.addTelemetry(l,r,l,r,0);
      }
      this.confirmModeIfAudible(input,frames);
      return true;
    }

    const power=this.mode==="power";
    const bank=power?this.tone.power:this.tone.adaptive;
    const sr=typeof sampleRate==="number"&&sampleRate>0?sampleRate:48000;
    const s=power
      ? { ceiling:.89, thresholdDb:-18.0, ratio:3.2, attackMs:4, releaseMs:65, wet:.72, makeupDb:7.5, limiterReleaseMs:85 }
      : { ceiling:.91, thresholdDb:-14.0, ratio:1.8, attackMs:8, releaseMs:120, wet:.35, makeupDb:3.0, limiterReleaseMs:120 };

    const attack=1-Math.exp(-1/(sr*s.attackMs/1000));
    const release=1-Math.exp(-1/(sr*s.releaseMs/1000));
    const limiterRelease=1-Math.exp(-1/(sr*s.limiterReleaseMs/1000));
    const threshold=MvpSoundModesProcessor.dbToGain(s.thresholdDb);
    const makeup=MvpSoundModesProcessor.dbToGain(s.makeupDb);

    for(let i=0;i<frames;i++){
      const iL=input[0]?.[i]??0,iR=input[1]?.[i]??iL;

      // One full-range path. No crossover split/recombine = no crossover cancellation.
      let l=this.processTone(bank,0,iL), r=this.processTone(bank,1,iR);

      const detector=Math.max(Math.abs(l),Math.abs(r));
      const ec=detector>this.compEnv?attack:release;
      this.compEnv+=(detector-this.compEnv)*ec;

      let target=1;
      if(this.compEnv>threshold) target=Math.pow(this.compEnv/threshold,(1/s.ratio)-1);
      const gc=target<this.compGain?attack:release;
      this.compGain+=(target-this.compGain)*gc;

      const density=(1-s.wet)+s.wet*this.compGain;
      l*=density*makeup;
      r*=density*makeup;

      // 4x inter-sample detector drives a stereo-linked lookahead limiter.
      const tp=Math.max(this.truePeak4x(this.tpL,l),this.truePeak4x(this.tpR,r));
      const required=tp>s.ceiling?s.ceiling/Math.max(tp,1e-12):1;
      if(required<this.limiterGain) this.limiterGain=required;
      else this.limiterGain+=(1-this.limiterGain)*limiterRelease;
      this.limiterGain=MvpSoundModesProcessor.clamp(this.limiterGain,.10,1);

      const dL=this.lookL[this.lookIndex],dR=this.lookR[this.lookIndex];
      this.lookL[this.lookIndex]=l; this.lookR[this.lookIndex]=r;
      this.lookIndex++; if(this.lookIndex>=this.lookaheadFrames)this.lookIndex=0;

      const oL=MvpSoundModesProcessor.clamp(dL*this.limiterGain,-s.ceiling,s.ceiling);
      const oR=MvpSoundModesProcessor.clamp(dR*this.limiterGain,-s.ceiling,s.ceiling);
      const gr=Math.max(0,-MvpSoundModesProcessor.gainToDb(this.limiterGain));
      this.limiterMaxReductionDb=Math.max(this.limiterMaxReductionDb,gr);

      if(output[0])output[0][i]=oL;
      if(output[1])output[1][i]=oR;
      for(let ch=2;ch<output.length;ch++)if(output[ch])output[ch][i]=ch%2===0?oL:oR;
      this.addTelemetry(iL,iR,oL,oR,gr);
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
