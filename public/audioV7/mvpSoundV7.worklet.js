
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const dbGain=db=>Math.pow(10,db/20);
const gainDb=g=>g>1e-9?20*Math.log10(g):-120;
const EQ_FREQS=[20,25,31.5,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000];

class Biquad{
  constructor(){this.b0=1;this.b1=0;this.b2=0;this.a1=0;this.a2=0;this.z1=0;this.z2=0}
  flat(){this.b0=1;this.b1=0;this.b2=0;this.a1=0;this.a2=0}
  reset(){this.z1=0;this.z2=0}
  run(x){const y=this.b0*x+this.z1;this.z1=this.b1*x-this.a1*y+this.z2;this.z2=this.b2*x-this.a2*y;return y}
  peak(freq,q,db){
    if(Math.abs(db)<1e-5){this.flat();return}
    freq=clamp(freq,10,sampleRate*.45);
    const A=Math.pow(10,db/40),w=2*Math.PI*freq/sampleRate,c=Math.cos(w),s=Math.sin(w),alpha=s/(2*q),a0=1+alpha/A;
    this.b0=(1+alpha*A)/a0;this.b1=(-2*c)/a0;this.b2=(1-alpha*A)/a0;this.a1=(-2*c)/a0;this.a2=(1-alpha/A)/a0;
  }
  lowShelf(freq,db){
    if(Math.abs(db)<1e-5){this.flat();return}
    freq=clamp(freq,10,sampleRate*.45);
    const A=Math.pow(10,db/40),w=2*Math.PI*freq/sampleRate,c=Math.cos(w),s=Math.sin(w),beta=2*Math.sqrt(A)*s,a0=(A+1)+(A-1)*c+beta;
    this.b0=A*((A+1)-(A-1)*c+beta)/a0;this.b1=2*A*((A-1)-(A+1)*c)/a0;this.b2=A*((A+1)-(A-1)*c-beta)/a0;this.a1=-2*((A-1)+(A+1)*c)/a0;this.a2=((A+1)+(A-1)*c-beta)/a0;
  }
  highShelf(freq,db){
    if(Math.abs(db)<1e-5){this.flat();return}
    freq=clamp(freq,10,sampleRate*.45);
    const A=Math.pow(10,db/40),w=2*Math.PI*freq/sampleRate,c=Math.cos(w),s=Math.sin(w),beta=2*Math.sqrt(A)*s,a0=(A+1)-(A-1)*c+beta;
    this.b0=A*((A+1)+(A-1)*c+beta)/a0;this.b1=-2*A*((A-1)+(A+1)*c)/a0;this.b2=A*((A+1)+(A-1)*c-beta)/a0;this.a1=2*((A-1)-(A+1)*c)/a0;this.a2=((A+1)-(A-1)*c-beta)/a0;
  }
  highpass(freq,q=.707){
    freq=clamp(freq,10,sampleRate*.45);
    const w=2*Math.PI*freq/sampleRate,c=Math.cos(w),s=Math.sin(w),alpha=s/(2*q),a0=1+alpha;
    this.b0=((1+c)/2)/a0;this.b1=(-(1+c))/a0;this.b2=((1+c)/2)/a0;this.a1=(-2*c)/a0;this.a2=(1-alpha)/a0;
  }
}

class MvpSoundV73Processor extends AudioWorkletProcessor{
  constructor(){
    super();
    this.state={
      mode:0,profile:1,intensity:.7,bass:false,bassCharacter:.5,impact:false,clarity:false,spatial:false,spaceMode:0,
      personal:false,personalBass:0,personalPresence:0,personalBrightness:0,eq:false,eqGains:new Array(31).fill(0),proofMute:false,
      masterPrepEnabled:false,masterSourceGainDb:0,masterHighpassHz:18,masterLowMidDb:0,masterPresenceDb:0,masterHarshnessDb:0,masterBalanceDb:0,masterWidthScale:1
    };

    this.prepHpL=new Biquad();this.prepHpR=new Biquad();this.prepLowMidL=new Biquad();this.prepLowMidR=new Biquad();this.prepPresenceL=new Biquad();this.prepPresenceR=new Biquad();this.prepHarshL=new Biquad();this.prepHarshR=new Biquad();
    this.modeBassL=new Biquad();this.modeBassR=new Biquad();this.modeBodyL=new Biquad();this.modeBodyR=new Biquad();this.modePresenceL=new Biquad();this.modePresenceR=new Biquad();this.modeAirL=new Biquad();this.modeAirR=new Biquad();
    this.bassSubL=new Biquad();this.bassSubR=new Biquad();this.bassPunchL=new Biquad();this.bassPunchR=new Biquad();this.bassBodyL=new Biquad();this.bassBodyR=new Biquad();
    this.clarityMudL=new Biquad();this.clarityMudR=new Biquad();this.clarityPresenceL=new Biquad();this.clarityPresenceR=new Biquad();this.clarityAirL=new Biquad();this.clarityAirR=new Biquad();
    this.personalBassL=new Biquad();this.personalBassR=new Biquad();this.personalPresenceL=new Biquad();this.personalPresenceR=new Biquad();this.personalBrightL=new Biquad();this.personalBrightR=new Biquad();
    this.eqL=EQ_FREQS.map(()=>new Biquad());this.eqR=EQ_FREQS.map(()=>new Biquad());

    this.compEnv=0;this.compGain=1;
    this.impactPunchL=new Biquad();this.impactPunchR=new Biquad();this.impactAttackL=new Biquad();this.impactAttackR=new Biquad();this.impactMudL=new Biquad();this.impactMudR=new Biquad();
    this.spatialBass=0;this.spatialSideBass=0;this.spatialPrevMid=0;
    this.delay=new Float32Array(8192);this.delayIndex=0;

    this.lookaheadSamples=Math.max(128,Math.min(2048,Math.round(sampleRate*.005)));
    this.limitBufL=new Float32Array(this.lookaheadSamples);this.limitBufR=new Float32Array(this.lookaheadSamples);this.limitIndex=0;this.limitEnv=0;this.limitGain=1;

    this.inputPeak=0;this.outputPeak=0;this.inputSq=0;this.outputSq=0;this.meterN=0;this.limiterGr=0;this.impactBoost=0;this.widthPercent=100;this.telemetryCounter=0;

    this.port.onmessage=e=>{
      const m=e.data||{};
      if(m.type==="state"){
        const prevMode=this.state.mode;
        this.state={...this.state,...m.state};
        if(prevMode!==this.state.mode)this.resetDynamics();
        this.configure();
        this.port.postMessage({type:"ack",revision:m.revision,state:m.state});
      }
      if(m.type==="proofMute"){
        this.state.proofMute=Boolean(m.enabled);
        this.port.postMessage({type:"proofAck",requestId:m.requestId,enabled:this.state.proofMute});
      }
      if(m.type==="reset")this.resetDynamics();
    };

    this.configure();
    this.port.postMessage({type:"ready",version:"mvp-sound-v7-3-song-aware-authority"});
  }

  resetDynamics(){
    this.compEnv=0;this.compGain=1;
    this.limitEnv=0;this.limitGain=1;this.limitBufL.fill(0);this.limitBufR.fill(0);this.limitIndex=0;
  }

  configure(){
    const s=this.state,i=clamp(s.intensity,0,1);

    this.prepHpL.highpass(clamp(s.masterHighpassHz,18,40));this.prepHpR.highpass(clamp(s.masterHighpassHz,18,40));
    this.prepLowMidL.peak(315,.80,clamp(s.masterLowMidDb,-3,2));this.prepLowMidR.peak(315,.80,clamp(s.masterLowMidDb,-3,2));
    this.prepPresenceL.peak(3200,.82,clamp(s.masterPresenceDb,-2,2));this.prepPresenceR.peak(3200,.82,clamp(s.masterPresenceDb,-2,2));
    this.prepHarshL.peak(6500,.92,clamp(s.masterHarshnessDb,-3,1));this.prepHarshR.peak(6500,.92,clamp(s.masterHarshnessDb,-3,1));

    let mb=0,body=0,pres=0,air=0;
    if(s.mode===1){mb=2.0+2.8*i;body=1.2+1.8*i;pres=2.2+3.2*i;air=2.5+3.8*i}
    else if(s.mode===2){mb=3.2+4.0*i;body=2.0+2.5*i;pres=3.8+4.6*i;air=4.2+5.2*i}
    if(s.profile===1){pres*=1.08;air*=1.10}else if(s.profile===2){mb*=1.06;body*=1.05}
    this.modeBassL.lowShelf(82,mb);this.modeBassR.lowShelf(82,mb);this.modeBodyL.peak(185,.72,body);this.modeBodyR.peak(185,.72,body);this.modePresenceL.peak(3000,.78,pres);this.modePresenceR.peak(3000,.78,pres);this.modeAirL.highShelf(9000,air);this.modeAirR.highShelf(9000,air);

    const c=clamp(s.bassCharacter,0,1),scale=i*(s.profile===1?1.10:s.profile===2?1.00:1.02);
    const subDb=(3.0+10.0*c)*scale,punchDb=(10.5-6.0*c)*scale,bodyDb=(6.0-4.0*c)*scale;
    this.bassSubL.lowShelf(58-16*c,subDb);this.bassSubR.lowShelf(58-16*c,subDb);this.bassPunchL.peak(115-25*c,.78,punchDb);this.bassPunchR.peak(115-25*c,.78,punchDb);this.bassBodyL.peak(185,.75,bodyDb);this.bassBodyR.peak(185,.75,bodyDb);

    this.impactPunchL.peak(115,.82,(3.5+4.5*i));this.impactPunchR.peak(115,.82,(3.5+4.5*i));
    this.impactAttackL.peak(3800,.88,(3.0+4.0*i));this.impactAttackR.peak(3800,.88,(3.0+4.0*i));
    this.impactMudL.peak(420,.78,-1.8*i);this.impactMudR.peak(420,.78,-1.8*i);

    this.clarityMudL.peak(340,.72,-3.5*i);this.clarityMudR.peak(340,.72,-3.5*i);
    this.clarityPresenceL.peak(3100,.76,(2.2+3.8*i));this.clarityPresenceR.peak(3100,.76,(2.2+3.8*i));
    this.clarityAirL.highShelf(9300,(2.4+4.6*i));this.clarityAirR.highShelf(9300,(2.4+4.6*i));

    const pb=s.profile===1?13:12,pp=s.profile===1?12:11,pbr=s.profile===1?13:12;
    this.personalBassL.lowShelf(90,s.personalBass*pb);this.personalBassR.lowShelf(90,s.personalBass*pb);this.personalPresenceL.peak(2900,.72,s.personalPresence*pp);this.personalPresenceR.peak(2900,.72,s.personalPresence*pp);this.personalBrightL.highShelf(7200,s.personalBrightness*pbr);this.personalBrightR.highShelf(7200,s.personalBrightness*pbr);

    for(let n=0;n<31;n++){
      const g=clamp(Number(s.eqGains[n])||0,-12,12);this.eqL[n].peak(EQ_FREQS[n],4.318,g);this.eqR[n].peak(EQ_FREQS[n],4.318,g);
    }
  }

  masterPrepProcess(l,r){
    const s=this.state;
    if(!s.masterPrepEnabled||s.mode===0)return [l,r];
    const gain=dbGain(clamp(s.masterSourceGainDb,0,3));l*=gain;r*=gain;
    l=this.prepHarshL.run(this.prepPresenceL.run(this.prepLowMidL.run(this.prepHpL.run(l))));
    r=this.prepHarshR.run(this.prepPresenceR.run(this.prepLowMidR.run(this.prepHpR.run(r))));
    const bal=clamp(s.masterBalanceDb,-1.5,1.5);if(bal>0)l*=dbGain(-bal);else if(bal<0)r*=dbGain(bal);
    const mid=(l+r)*.5,side=(l-r)*.5*clamp(s.masterWidthScale,.75,1.10);
    return [mid+side,mid-side];
  }

  modeProcess(l,r){
    const s=this.state;if(s.mode===0)return [l,r];
    const i=clamp(s.intensity,0,1),power=s.mode===2;
    const detector=Math.sqrt((l*l+r*r)*.5),envA=1-Math.exp(-1/(sampleRate*.030)),envR=1-Math.exp(-1/(sampleRate*.350));
    this.compEnv+=(detector-this.compEnv)*(detector>this.compEnv?envA:envR);
    const envDb=gainDb(Math.max(this.compEnv,1e-7));
    const driveDb=power?(8.0+4.5*i):(2.8+2.5*i),thresholdDb=power?-14:-9,ratio=power?2.5:1.55;
    const over=Math.max(0,envDb-thresholdDb),reduction=over*(1-1/ratio),density=power?1.8+1.8*i:.5+.8*i;
    const target=dbGain(driveDb-reduction+density);
    const a=1-Math.exp(-1/(sampleRate*.040)),rel=1-Math.exp(-1/(sampleRate*.090));
    this.compGain+=(target-this.compGain)*(target<this.compGain?a:rel);
    l*=this.compGain;r*=this.compGain;
    l=this.modeAirL.run(this.modePresenceL.run(this.modeBodyL.run(this.modeBassL.run(l))));
    r=this.modeAirR.run(this.modePresenceR.run(this.modeBodyR.run(this.modeBassR.run(r))));
    return [l,r];
  }

  bassProcess(l,r){
    if(!this.state.bass)return [l,r];
    return [this.bassBodyL.run(this.bassPunchL.run(this.bassSubL.run(l))),this.bassBodyR.run(this.bassPunchR.run(this.bassSubR.run(r)))];
  }

  impactProcess(l,r){
    if(!this.state.impact)return [l,r];
    return [
      this.impactAttackL.run(this.impactPunchL.run(this.impactMudL.run(l))),
      this.impactAttackR.run(this.impactPunchR.run(this.impactMudR.run(r)))
    ];
  }

  clarityProcess(l,r){
    if(!this.state.clarity)return [l,r];
    return [this.clarityAirL.run(this.clarityPresenceL.run(this.clarityMudL.run(l))),this.clarityAirR.run(this.clarityPresenceR.run(this.clarityMudR.run(r)))];
  }

  spatialProcess(l,r){
    const s=this.state;if(!s.spatial){this.widthPercent=100;return [l,r]}
    const m=clamp(s.spaceMode,0,2),i=clamp(s.intensity,0,1);
    let width,gen,delayA,delayB;
    if(s.profile===1){width=[1.65,2.35,3.15][m];gen=[.30,.55,.85][m];delayA=[4.7,9.3,15.7][m];delayB=[7.9,15.1,24.2][m]}
    else if(s.profile===2){width=[1.32,1.65,2.02][m];gen=[.16,.31,.48][m];delayA=[3.8,7.7,12.7][m];delayB=[6.6,12.4,19.1][m]}
    else{width=[1.28,1.58,1.90][m];gen=[.14,.27,.43][m];delayA=[3.6,7.4,11.8][m];delayB=[6.2,11.7,17.3][m]}
    width=1+(width-1)*i;gen*=i;
    const mid=(l+r)*.5,side=(l-r)*.5,bassA=1-Math.exp(-2*Math.PI*180/sampleRate);
    this.spatialBass+=bassA*(mid-this.spatialBass);this.spatialSideBass+=bassA*(side-this.spatialSideBass);
    const midWide=mid-this.spatialBass,sideHigh=side-this.spatialSideBass;
    const da=clamp(Math.round(sampleRate*delayA/1000),1,8191),db=clamp(Math.round(sampleRate*delayB/1000),1,8191);
    let ia=this.delayIndex-da,ib=this.delayIndex-db;if(ia<0)ia+=8192;if(ib<0)ib+=8192;
    const a=this.delay[ia],b=this.delay[ib];this.delay[this.delayIndex]=midWide;this.delayIndex=(this.delayIndex+1)&8191;
    const derivative=midWide-this.spatialPrevMid;this.spatialPrevMid=midWide;
    const synthetic=((a-midWide)*.70+(b-midWide)*.45+derivative*2.2)*gen,wideSide=this.spatialSideBass*.18+sideHigh*width+synthetic;
    this.widthPercent=width*100;
    return [mid+wideSide,mid-wideSide];
  }

  personalProcess(l,r){
    if(!this.state.personal)return [l,r];
    return [this.personalBrightL.run(this.personalPresenceL.run(this.personalBassL.run(l))),this.personalBrightR.run(this.personalPresenceR.run(this.personalBassR.run(r)))];
  }

  eqProcess(l,r){
    if(!this.state.eq)return [l,r];
    for(let n=0;n<31;n++){l=this.eqL[n].run(l);r=this.eqR[n].run(r)}
    return [l,r];
  }

  limit(l,r){
    const peak=Math.max(Math.abs(l),Math.abs(r),1e-9),relCoef=Math.exp(-1/(sampleRate*.110));
    this.limitEnv=Math.max(peak,this.limitEnv*relCoef);
    const ceiling=.955,target=this.limitEnv>ceiling?ceiling/this.limitEnv:1,a=1-Math.exp(-1/(sampleRate*.0008)),rel=1-Math.exp(-1/(sampleRate*.075));
    this.limitGain+=(target-this.limitGain)*(target<this.limitGain?a:rel);
    const outL=this.limitBufL[this.limitIndex]*this.limitGain,outR=this.limitBufR[this.limitIndex]*this.limitGain;
    this.limitBufL[this.limitIndex]=l;this.limitBufR[this.limitIndex]=r;this.limitIndex=(this.limitIndex+1)%this.lookaheadSamples;
    this.limiterGr=Math.max(this.limiterGr,-gainDb(Math.max(this.limitGain,1e-9)));
    return [outL,outR];
  }

  process(inputs,outputs){
    const input=inputs[0],output=outputs[0];if(!output||!output.length)return true;
    const left=input&&input[0]?input[0]:null,right=input&&input[1]?input[1]:left,outL=output[0],outR=output[1]||output[0];
    for(let n=0;n<outL.length;n++){
      let l=left?left[n]||0:0,r=right?right[n]||0:l;
      const inPeak=Math.max(Math.abs(l),Math.abs(r));this.inputPeak=Math.max(this.inputPeak,inPeak);this.inputSq+=(l*l+r*r)*.5;
      if(this.state.proofMute){l=0;r=0}
      else if(this.state.mode!==0){
        [l,r]=this.masterPrepProcess(l,r);[l,r]=this.modeProcess(l,r);[l,r]=this.bassProcess(l,r);[l,r]=this.impactProcess(l,r);[l,r]=this.clarityProcess(l,r);[l,r]=this.spatialProcess(l,r);[l,r]=this.personalProcess(l,r);[l,r]=this.eqProcess(l,r);[l,r]=this.limit(l,r);
      }
      outL[n]=l;outR[n]=r;
      const op=Math.max(Math.abs(l),Math.abs(r));this.outputPeak=Math.max(this.outputPeak,op);this.outputSq+=(l*l+r*r)*.5;this.meterN++;this.telemetryCounter++;
    }
    if(this.telemetryCounter>=2048){
      const inputRms=Math.sqrt(this.inputSq/Math.max(1,this.meterN)),outputRms=Math.sqrt(this.outputSq/Math.max(1,this.meterN));
      this.port.postMessage({type:"telemetry",inputPeak:this.inputPeak,outputPeak:this.outputPeak,inputRms,outputRms,truePeakDbtp:gainDb(this.outputPeak),limiterGrDb:this.limiterGr,impactBoostDb:this.impactBoost,spatialWidthPercent:this.widthPercent,rmsDeltaDb:gainDb(outputRms/Math.max(inputRms,1e-9)),masterPrepActive:Boolean(this.state.masterPrepEnabled&&this.state.mode!==0)});
      this.inputPeak=0;this.outputPeak=0;this.inputSq=0;this.outputSq=0;this.meterN=0;this.limiterGr=0;this.impactBoost=0;this.telemetryCounter=0;
    }
    return true;
  }
}

registerProcessor("mvp-sound-v7",MvpSoundV73Processor);
