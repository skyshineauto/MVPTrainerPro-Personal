class MvpSoundModesProcessor extends AudioWorkletProcessor {
  constructor(){
    super();
    this.mode="pure";this.generation=0;this.pendingModeConfirmation=true;
    this.profile=null;this.profileTrackId=null;this.profileClass="fallback";
    this.tone={adaptive:this.createToneBank("adaptive"),power:this.createToneBank("power")};
    this.settings={adaptive:this.modeSettings("adaptive"),power:this.modeSettings("power")};
    this.resetTelemetry();
    this.port.onmessage=(event)=>{const m=event?.data??{};
      if(m.type==="ping"){this.port.postMessage({type:"ready",engine:"r17"});return;}
      if(m.type==="track-profile"){
        this.profileTrackId=typeof m.trackId==="string"?m.trackId:null;
        this.profile=this.sanitizeProfile(m.profile);this.profileClass=this.classifyProfile(this.profile);
        this.rebuildToneBanks();this.rebuildSettings();this.resetToneBanks();
        this.port.postMessage({type:"track-profile-active",engine:"r17",trackId:this.profileTrackId,applied:Boolean(this.profile),profileClass:this.profileClass});return;
      }
      if(m.type==="mode"&&["pure","adaptive","power"].includes(m.mode)){
        this.mode=m.mode;this.generation=Number.isFinite(Number(m.generation))?Number(m.generation):this.generation+1;
        this.pendingModeConfirmation=true;this.resetTelemetry();
        this.port.postMessage({type:"mode-selected",engine:"r17",mode:this.mode,generation:this.generation});return;
      }
      if(m.type==="reset"){this.resetToneBanks();this.pendingModeConfirmation=true;}
    };
  }
  static clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
  static dbToGain(db){return Math.pow(10,db/20);}
  static gainToDb(g){return 20*Math.log10(Math.max(1e-12,g));}
  sanitizeProfile(value){
    if(!value||typeof value!=="object")return null;
    const n=(key,fallback)=>{const raw=value[key];if(raw===null||raw===undefined||raw==="")return fallback;const x=Number(raw);return Number.isFinite(x)?x:fallback;};
    return {rmsDb:n("rmsDb",-12),truePeakDbtp:n("truePeakDbtp",-1),crestFactorDb:n("crestFactorDb",8),dynamicRangeDb:n("dynamicRangeDb",8),bassExtension:n("bassExtension",50),lowMidBuildup:n("lowMidBuildup",50),presenceBalance:n("presenceBalance",50),harshness:n("harshness",50),sibilance:n("sibilance",50),hfRolloff:n("hfRolloff",50),transientStrength:n("transientStrength",50),correlation:n("correlation",.7),phaseRisk:Boolean(value.phaseRisk),sourceGainDb:n("sourceGainDb",0),lowMidDb:n("lowMidDb",0),presenceDb:n("presenceDb",0),harshnessDb:n("harshnessDb",0)};
  }
  classifyProfile(p){if(!p)return"fallback";if(p.rmsDb>=-8.5||p.crestFactorDb<=6.2||p.dynamicRangeDb<=5.5)return"brick";if(p.rmsDb>=-10.8||p.crestFactorDb<=7.4||p.dynamicRangeDb<=7)return"hot";if(p.rmsDb<=-14||p.crestFactorDb>=10.5||p.dynamicRangeDb>=10.5)return"dynamic";return"normal";}
  createBiquad(){return{b0:1,b1:0,b2:0,a1:0,a2:0,z1:0,z2:0};}
  setPeaking(f,frequency,q,gainDb){const sr=typeof sampleRate==="number"&&sampleRate>0?sampleRate:48000,hz=MvpSoundModesProcessor.clamp(frequency,10,sr*.475),A=Math.pow(10,gainDb/40),w=2*Math.PI*hz/sr,c=Math.cos(w),s=Math.sin(w),alpha=s/(2*q),aa=1+alpha/A;f.b0=(1+alpha*A)/aa;f.b1=(-2*c)/aa;f.b2=(1-alpha*A)/aa;f.a1=(-2*c)/aa;f.a2=(1-alpha/A)/aa;}
  setLowShelf(f,frequency,gainDb){const sr=typeof sampleRate==="number"&&sampleRate>0?sampleRate:48000,hz=MvpSoundModesProcessor.clamp(frequency,10,sr*.475),A=Math.pow(10,gainDb/40),w=2*Math.PI*hz/sr,c=Math.cos(w),s=Math.sin(w),beta=2*Math.sqrt(A)*s,aa=(A+1)+(A-1)*c+beta;f.b0=A*((A+1)-(A-1)*c+beta)/aa;f.b1=2*A*((A-1)-(A+1)*c)/aa;f.b2=A*((A+1)-(A-1)*c-beta)/aa;f.a1=-2*((A-1)+(A+1)*c)/aa;f.a2=((A+1)+(A-1)*c-beta)/aa;}
  setHighShelf(f,frequency,gainDb){const sr=typeof sampleRate==="number"&&sampleRate>0?sampleRate:48000,hz=MvpSoundModesProcessor.clamp(frequency,10,sr*.475),A=Math.pow(10,gainDb/40),w=2*Math.PI*hz/sr,c=Math.cos(w),s=Math.sin(w),beta=2*Math.sqrt(A)*s,aa=(A+1)-(A-1)*c+beta;f.b0=A*((A+1)+(A-1)*c+beta)/aa;f.b1=-2*A*((A-1)+(A+1)*c)/aa;f.b2=A*((A+1)+(A-1)*c-beta)/aa;f.a1=2*((A-1)-(A+1)*c)/aa;f.a2=((A+1)-(A-1)*c-beta)/aa;}
  processBiquad(f,x){const y=f.b0*x+f.z1;f.z1=f.b1*x-f.a1*y+f.z2;f.z2=f.b2*x-f.a2*y;return y;}
  profileToneAdjustments(mode){const p=this.profile;if(!p)return{low:0,body:0,mud:0,presence:0,air:0};const strength=mode==="power"?1:.6,bassNeed=MvpSoundModesProcessor.clamp((55-p.bassExtension)*.022,-.8,.7),bodyNeed=MvpSoundModesProcessor.clamp((54-p.lowMidBuildup)*.020,-.6,.6),harsh=Math.max(p.harshness,p.sibilance),harshCut=MvpSoundModesProcessor.clamp((harsh-58)*.018,0,.7),presenceNeed=MvpSoundModesProcessor.clamp((50-p.presenceBalance)*.010,-.25,.25)-harshCut*.45,airNeed=MvpSoundModesProcessor.clamp((p.hfRolloff-60)*.006,0,.15)-harshCut*.20;return{low:bassNeed*strength,body:bodyNeed*strength,mud:MvpSoundModesProcessor.clamp(p.lowMidDb,-.5,.1)*strength,presence:(presenceNeed+MvpSoundModesProcessor.clamp(p.presenceDb,-.2,.2))*strength,air:airNeed*strength};}
  createToneBank(mode){const a=this.profileToneAdjustments(mode),make=()=>{const f={low:this.createBiquad(),body:this.createBiquad(),mud:this.createBiquad(),mid:this.createBiquad(),presence:this.createBiquad(),air:this.createBiquad()},s=mode==="power"?{low:2.8+a.low,body:1.7+a.body,mud:-.12+a.mud,mid:.9,presence:.50+a.presence,air:.20+a.air}:{low:1.5+a.low,body:.95+a.body,mud:-.08+a.mud,mid:.45,presence:.28+a.presence,air:.10+a.air};this.setLowShelf(f.low,72,s.low);this.setPeaking(f.body,175,.74,s.body);this.setPeaking(f.mud,470,.90,s.mud);this.setPeaking(f.mid,1050,.85,s.mid);this.setPeaking(f.presence,3300,.95,s.presence);this.setHighShelf(f.air,10500,s.air);return f;};return[make(),make()];}
  rebuildToneBanks(){this.tone={adaptive:this.createToneBank("adaptive"),power:this.createToneBank("power")};}
  resetToneBank(bank){for(const ch of bank)for(const f of Object.values(ch)){f.z1=0;f.z2=0;}}
  resetToneBanks(){this.resetToneBank(this.tone.adaptive);this.resetToneBank(this.tone.power);}
  processTone(bank,ch,x){const f=bank[ch];x=this.processBiquad(f.low,x);x=this.processBiquad(f.body,x);x=this.processBiquad(f.mud,x);x=this.processBiquad(f.mid,x);x=this.processBiquad(f.presence,x);x=this.processBiquad(f.air,x);return x;}
  modeSettings(mode){const c=this.profileClass,p=this.profile,sourceGain=MvpSoundModesProcessor.clamp(p?.sourceGainDb??0,-.4,.8),base=mode==="power"?{dynamic:7.5,normal:7.0,hot:6.5,brick:6.0,fallback:7.0}:{dynamic:4.0,normal:3.6,hot:3.3,brick:3.0,fallback:3.6},extra=Math.max(0,sourceGain)*(mode==="power"?.45:.25),gainDb=(base[c]??base.fallback)+extra;return{gainDb,gain:MvpSoundModesProcessor.dbToGain(gainDb)};}
  rebuildSettings(){this.settings={adaptive:this.modeSettings("adaptive"),power:this.modeSettings("power")};}
  processBranch(mode,iL,iR){const bank=this.tone[mode],s=this.settings[mode];let l=this.processTone(bank,0,iL),r=this.processTone(bank,1,iR);l*=s.gain;r*=s.gain;return{l,r,requestedGainDb:s.gainDb,limiterReductionDb:0};}
  resetTelemetry(){this.telemetryFrames=0;this.telemetryInputSq=0;this.telemetryOutputSq=0;this.telemetrySamples=0;this.telemetryPeak=0;this.telemetryRequestedGainDb=0;}
  addTelemetry(iL,iR,oL,oR,requestedGainDb){this.telemetryInputSq+=iL*iL+iR*iR;this.telemetryOutputSq+=oL*oL+oR*oR;this.telemetrySamples+=2;this.telemetryPeak=Math.max(this.telemetryPeak,Math.abs(oL),Math.abs(oR));this.telemetryRequestedGainDb=Math.max(this.telemetryRequestedGainDb,requestedGainDb);this.telemetryFrames++;const sr=typeof sampleRate==="number"&&sampleRate>0?sampleRate:48000;if(this.telemetryFrames<Math.floor(sr*.5))return;const inRms=Math.sqrt(this.telemetryInputSq/Math.max(1,this.telemetrySamples)),outRms=Math.sqrt(this.telemetryOutputSq/Math.max(1,this.telemetrySamples)),inDb=MvpSoundModesProcessor.gainToDb(inRms),outDb=MvpSoundModesProcessor.gainToDb(outRms);this.port.postMessage({type:"telemetry",engine:"r17",mode:this.mode,generation:this.generation,inputRmsDb:inDb,outputRmsDb:outDb,deltaDb:outDb-inDb,outputPeakDb:MvpSoundModesProcessor.gainToDb(this.telemetryPeak),requestedGainDb:this.telemetryRequestedGainDb,limiterReductionDb:0,trackProfileApplied:Boolean(this.profile),trackId:this.profileTrackId,profileClass:this.profileClass});this.resetTelemetry();}
  static hasAudibleSignal(input,frames){for(const src of input){if(!src)continue;for(let i=0;i<frames;i++)if(Math.abs(src[i]??0)>1e-5)return true;}return false;}
  confirmModeIfAudible(input,frames){if(!this.pendingModeConfirmation||!MvpSoundModesProcessor.hasAudibleSignal(input,frames))return;this.pendingModeConfirmation=false;this.port.postMessage({type:"mode-active",engine:"r17",mode:this.mode,generation:this.generation});}
  process(inputs,outputs){const input=inputs[0]??[],output=outputs[0]??[];if(!output.length)return true;const frames=output[0]?.length??0;for(let i=0;i<frames;i++){const iL=input[0]?.[i]??0,iR=input[1]?.[i]??iL,adaptive=this.processBranch("adaptive",iL,iR),power=this.processBranch("power",iL,iR);let oL=iL,oR=iR,requested=0;if(this.mode==="adaptive"){oL=adaptive.l;oR=adaptive.r;requested=adaptive.requestedGainDb;}else if(this.mode==="power"){oL=power.l;oR=power.r;requested=power.requestedGainDb;}if(output[0])output[0][i]=oL;if(output[1])output[1][i]=oR;for(let ch=2;ch<output.length;ch++)if(output[ch])output[ch][i]=ch%2===0?oL:oR;this.addTelemetry(iL,iR,oL,oR,requested);}this.confirmModeIfAudible(input,frames);return true;}
}
registerProcessor("mvp-sound-modes",MvpSoundModesProcessor);
