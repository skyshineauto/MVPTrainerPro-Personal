
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const dbGain=db=>Math.pow(10,db/20);
const gainDb=g=>g>1e-9?20*Math.log10(g):-120;

const EQ_FREQS=[
  20,25,31.5,40,50,63,80,100,125,160,200,250,315,400,500,
  630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,
  8000,10000,12500,16000,20000
];

class Biquad {
  constructor(){
    this.b0=1;this.b1=0;this.b2=0;this.a1=0;this.a2=0;
    this.z1=0;this.z2=0;
  }
  reset(){this.z1=0;this.z2=0}
  flat(){this.b0=1;this.b1=0;this.b2=0;this.a1=0;this.a2=0}
  run(x){
    const y=this.b0*x+this.z1;
    this.z1=this.b1*x-this.a1*y+this.z2;
    this.z2=this.b2*x-this.a2*y;
    return y;
  }
  peak(freq,q,db){
    if(Math.abs(db)<0.0001){this.flat();return}
    freq=clamp(freq,10,sampleRate*.45);
    const A=Math.pow(10,db/40);
    const w=2*Math.PI*freq/sampleRate;
    const c=Math.cos(w),s=Math.sin(w);
    const alpha=s/(2*q);
    const a0=1+alpha/A;
    this.b0=(1+alpha*A)/a0;
    this.b1=(-2*c)/a0;
    this.b2=(1-alpha*A)/a0;
    this.a1=(-2*c)/a0;
    this.a2=(1-alpha/A)/a0;
  }
  lowShelf(freq,db){
    if(Math.abs(db)<0.0001){this.flat();return}
    freq=clamp(freq,10,sampleRate*.45);
    const A=Math.pow(10,db/40);
    const w=2*Math.PI*freq/sampleRate;
    const c=Math.cos(w),s=Math.sin(w);
    const beta=2*Math.sqrt(A)*s;
    const a0=(A+1)+(A-1)*c+beta;
    this.b0=A*((A+1)-(A-1)*c+beta)/a0;
    this.b1=2*A*((A-1)-(A+1)*c)/a0;
    this.b2=A*((A+1)-(A-1)*c-beta)/a0;
    this.a1=-2*((A-1)+(A+1)*c)/a0;
    this.a2=((A+1)+(A-1)*c-beta)/a0;
  }
  highShelf(freq,db){
    if(Math.abs(db)<0.0001){this.flat();return}
    freq=clamp(freq,10,sampleRate*.45);
    const A=Math.pow(10,db/40);
    const w=2*Math.PI*freq/sampleRate;
    const c=Math.cos(w),s=Math.sin(w);
    const beta=2*Math.sqrt(A)*s;
    const a0=(A+1)-(A-1)*c+beta;
    this.b0=A*((A+1)+(A-1)*c+beta)/a0;
    this.b1=-2*A*((A-1)+(A+1)*c)/a0;
    this.b2=A*((A+1)+(A-1)*c-beta)/a0;
    this.a1=2*((A-1)-(A+1)*c)/a0;
    this.a2=((A+1)-(A-1)*c-beta)/a0;
  }
}

class MvpSoundV7Processor extends AudioWorkletProcessor {
  constructor(){
    super();

    this.state={
      mode:0,
      profile:1,
      intensity:.7,
      bass:false,
      bassCharacter:.5,
      impact:false,
      clarity:false,
      spatial:false,
      spaceMode:0,
      personal:false,
      personalBass:0,
      personalPresence:0,
      personalBrightness:0,
      eq:false,
      eqGains:new Array(31).fill(0),
      proofMute:false
    };

    this.modeBassL=new Biquad();
    this.modeBassR=new Biquad();
    this.modeBodyL=new Biquad();
    this.modeBodyR=new Biquad();
    this.modePresenceL=new Biquad();
    this.modePresenceR=new Biquad();
    this.modeAirL=new Biquad();
    this.modeAirR=new Biquad();

    this.bassShelfL=new Biquad();
    this.bassShelfR=new Biquad();
    this.bassPunchL=new Biquad();
    this.bassPunchR=new Biquad();

    this.clarityPresenceL=new Biquad();
    this.clarityPresenceR=new Biquad();
    this.clarityAirL=new Biquad();
    this.clarityAirR=new Biquad();

    this.personalBassL=new Biquad();
    this.personalBassR=new Biquad();
    this.personalPresenceL=new Biquad();
    this.personalPresenceR=new Biquad();
    this.personalBrightL=new Biquad();
    this.personalBrightR=new Biquad();

    this.eqL=EQ_FREQS.map(()=>new Biquad());
    this.eqR=EQ_FREQS.map(()=>new Biquad());

    this.delay=new Float32Array(4096);
    this.delayIndex=0;

    this.compEnv=0;
    this.compGain=1;
    this.limitGain=1;

    this.fastEnv=0;
    this.slowEnv=0;

    this.inputPeak=0;
    this.outputPeak=0;
    this.inputSq=0;
    this.outputSq=0;
    this.meterN=0;
    this.limiterGr=0;
    this.impactBoost=0;
    this.widthPercent=100;
    this.telemetryCounter=0;

    this.port.onmessage=e=>{
      const m=e.data||{};

      if(m.type==="state"){
        this.state={...this.state,...m.state};
        this.configure();
        this.port.postMessage({
          type:"ack",
          revision:m.revision,
          state:m.state
        });
      }

      if(m.type==="proofMute"){
        this.state.proofMute=Boolean(m.enabled);
        this.port.postMessage({
          type:"proofAck",
          requestId:m.requestId,
          enabled:this.state.proofMute
        });
      }

      if(m.type==="reset"){
        this.compEnv=0;
        this.compGain=1;
        this.limitGain=1;
        this.fastEnv=0;
        this.slowEnv=0;
      }
    };

    this.configure();

    this.port.postMessage({
      type:"ready",
      version:"mvp-sound-v7-clean"
    });
  }

  configure(){
    const s=this.state;
    const i=clamp(s.intensity,0,1);

    let mb=0,body=0,pres=0,air=0;

    if(s.mode===1){
      mb=1.5+2*i;
      body=.7+1*i;
      pres=1.4+2.2*i;
      air=1.5+2.3*i;
    }else if(s.mode===2){
      mb=2.8+3.2*i;
      body=1.2+1.8*i;
      pres=2.8+3.4*i;
      air=2.8+3.8*i;
    }

    if(s.profile===1){
      pres*=1.08;
      air*=1.12;
    }else if(s.profile===2){
      mb*=1.08;
      body*=1.06;
    }

    this.modeBassL.lowShelf(80,mb);
    this.modeBassR.lowShelf(80,mb);
    this.modeBodyL.peak(170,.72,body);
    this.modeBodyR.peak(170,.72,body);
    this.modePresenceL.peak(3300,.78,pres);
    this.modePresenceR.peak(3300,.78,pres);
    this.modeAirL.highShelf(9500,air);
    this.modeAirR.highShelf(9500,air);

    const c=clamp(s.bassCharacter,0,1);
    const bassProfile=s.profile===1?1.12:s.profile===2?1.08:1;

    const deep=(3+5.5*c)*(0.8+0.4*i)*bassProfile;
    const punch=(7-4*c)*(0.8+0.4*i)*bassProfile;

    this.bassShelfL.lowShelf(58-14*c,deep);
    this.bassShelfR.lowShelf(58-14*c,deep);
    this.bassPunchL.peak(138-35*c,.78,punch);
    this.bassPunchR.peak(138-35*c,.78,punch);

    const clarityProfile=s.profile===1?1.12:s.profile===2?1.04:1;
    this.clarityPresenceL.peak(4200,.68,(3+4*i)*clarityProfile);
    this.clarityPresenceR.peak(4200,.68,(3+4*i)*clarityProfile);
    this.clarityAirL.highShelf(9000,(3.5+4.5*i)*clarityProfile);
    this.clarityAirR.highShelf(9000,(3.5+4.5*i)*clarityProfile);

    const bassRange=s.profile===1?12:11;
    const presenceRange=s.profile===1?11:10;
    const brightRange=s.profile===1?12:11;

    this.personalBassL.lowShelf(90,s.personalBass*bassRange);
    this.personalBassR.lowShelf(90,s.personalBass*bassRange);
    this.personalPresenceL.peak(3000,.72,s.personalPresence*presenceRange);
    this.personalPresenceR.peak(3000,.72,s.personalPresence*presenceRange);
    this.personalBrightL.highShelf(7200,s.personalBrightness*brightRange);
    this.personalBrightR.highShelf(7200,s.personalBrightness*brightRange);

    for(let n=0;n<31;n++){
      const gain=Number(s.eqGains[n])||0;
      this.eqL[n].peak(EQ_FREQS[n],4.318,clamp(gain,-12,12));
      this.eqR[n].peak(EQ_FREQS[n],4.318,clamp(gain,-12,12));
    }
  }

  modeProcess(l,r){
    const s=this.state;
    if(s.mode===0)return [l,r];

    const i=clamp(s.intensity,0,1);

    const preDb=
      s.mode===2
        ? 7+5*i
        : 2.5+3.5*i;

    const pre=dbGain(preDb);
    l*=pre;
    r*=pre;

    const detector=Math.max(Math.abs(l),Math.abs(r));
    const attack=1-Math.exp(-1/(sampleRate*.006));
    const release=1-Math.exp(-1/(sampleRate*.120));

    this.compEnv+=
      (detector-this.compEnv)*
      (detector>this.compEnv?attack:release);

    const threshold=s.mode===2?.42:.68;
    const ratio=s.mode===2?5:2.1;

    let target=1;

    if(this.compEnv>threshold){
      const over=this.compEnv/threshold;
      target=Math.pow(over,(1/ratio)-1);
    }

    this.compGain+=
      (target-this.compGain)*
      (target<this.compGain?attack:release);

    const makeup=
      s.mode===2
        ? dbGain(3.5+2*i)
        : dbGain(1.2+1.6*i);

    l*=this.compGain*makeup;
    r*=this.compGain*makeup;

    l=this.modeAirL.run(
      this.modePresenceL.run(
        this.modeBodyL.run(
          this.modeBassL.run(l)
        )
      )
    );

    r=this.modeAirR.run(
      this.modePresenceR.run(
        this.modeBodyR.run(
          this.modeBassR.run(r)
        )
      )
    );

    return [l,r];
  }

  bassProcess(l,r){
    const bl=this.bassPunchL.run(this.bassShelfL.run(l));
    const br=this.bassPunchR.run(this.bassShelfR.run(r));

    if(!this.state.bass)return [l,r];

    return [bl,br];
  }

  impactProcess(l,r){
    const d=Math.max(Math.abs(l),Math.abs(r));

    const fa=1-Math.exp(-1/(sampleRate*.001));
    const fr=1-Math.exp(-1/(sampleRate*.014));
    const sa=1-Math.exp(-1/(sampleRate*.025));
    const sr=1-Math.exp(-1/(sampleRate*.170));

    this.fastEnv+=(d-this.fastEnv)*(d>this.fastEnv?fa:fr);
    this.slowEnv+=(d-this.slowEnv)*(d>this.slowEnv?sa:sr);

    if(!this.state.impact)return [l,r];

    const transient=clamp(
      (this.fastEnv-this.slowEnv*.91)/(this.slowEnv+.02),
      0,
      1
    );

    const i=clamp(this.state.intensity,0,1);

    const sustainGain=dbGain(
      -(1-transient)*(.6+1.6*i)
    );

    const boostDb=transient*(3+5*i);
    const boost=dbGain(boostDb);

    this.impactBoost=Math.max(this.impactBoost,boostDb);

    return [
      l*sustainGain*boost,
      r*sustainGain*boost
    ];
  }

  clarityProcess(l,r){
    const cl=this.clarityAirL.run(this.clarityPresenceL.run(l));
    const cr=this.clarityAirR.run(this.clarityPresenceR.run(r));

    return this.state.clarity?[cl,cr]:[l,r];
  }

  spatialProcess(l,r){
    const s=this.state;

    if(!s.spatial){
      this.widthPercent=100;
      return [l,r];
    }

    const mode=clamp(s.spaceMode,0,2);
    const intensity=clamp(s.intensity,0,1);

    let width;
    let delayMs;
    let decor;

    if(s.profile===1){
      width=[1.35,1.80,2.35][mode];
      delayMs=[4,10,18][mode];
      decor=[.04,.10,.18][mode];
    }else if(s.profile===2){
      width=[1.18,1.42,1.70][mode];
      delayMs=[3,7,12][mode];
      decor=[.025,.06,.10][mode];
    }else{
      width=[1.16,1.38,1.62][mode];
      delayMs=[3,6,10][mode];
      decor=[.02,.05,.08][mode];
    }

    width=1+(width-1)*intensity;

    const mid=(l+r)*.5;
    const side=(l-r)*.5;

    const delaySamples=clamp(
      Math.round(sampleRate*delayMs/1000),
      1,
      4095
    );

    let read=this.delayIndex-delaySamples;
    if(read<0)read+=4096;

    const delayed=this.delay[read];
    this.delay[this.delayIndex]=mid;
    this.delayIndex=(this.delayIndex+1)&4095;

    const stageCue=(delayed-mid)*decor*intensity;
    const widened=side*width+stageCue;

    this.widthPercent=width*100;

    return [
      mid+widened,
      mid-widened
    ];
  }

  personalProcess(l,r){
    const pl=this.personalBrightL.run(
      this.personalPresenceL.run(
        this.personalBassL.run(l)
      )
    );

    const pr=this.personalBrightR.run(
      this.personalPresenceR.run(
        this.personalBassR.run(r)
      )
    );

    return this.state.personal?[pl,pr]:[l,r];
  }

  eqProcess(l,r){
    if(!this.state.eq)return [l,r];

    for(let n=0;n<31;n++){
      l=this.eqL[n].run(l);
      r=this.eqR[n].run(r);
    }

    return [l,r];
  }

  limit(l,r){
    const peak=Math.max(Math.abs(l),Math.abs(r),1e-9);
    const target=peak>.92?.92/peak:1;

    if(target<this.limitGain){
      this.limitGain=target;
    }else{
      this.limitGain+=(1-this.limitGain)*.0018;
    }

    const gr=-gainDb(this.limitGain);
    this.limiterGr=Math.max(this.limiterGr,gr);

    return [
      l*this.limitGain,
      r*this.limitGain
    ];
  }

  process(inputs,outputs){
    const input=inputs[0];
    const output=outputs[0];

    if(!output||output.length===0)return true;

    const left=input&&input[0]?input[0]:null;
    const right=input&&input[1]?input[1]:left;

    const outL=output[0];
    const outR=output[1]||output[0];

    for(let n=0;n<outL.length;n++){
      let l=left?left[n]||0:0;
      let r=right?right[n]||0:l;

      const inPeak=Math.max(Math.abs(l),Math.abs(r));
      this.inputPeak=Math.max(this.inputPeak,inPeak);
      this.inputSq+=(l*l+r*r)*.5;

      if(this.state.proofMute){
        l=0;
        r=0;
      }else if(this.state.mode!==0){
        [l,r]=this.modeProcess(l,r);
        [l,r]=this.bassProcess(l,r);
        [l,r]=this.impactProcess(l,r);
        [l,r]=this.clarityProcess(l,r);
        [l,r]=this.spatialProcess(l,r);
        [l,r]=this.personalProcess(l,r);
        [l,r]=this.eqProcess(l,r);
        [l,r]=this.limit(l,r);
      }

      outL[n]=l;
      outR[n]=r;

      const outPeak=Math.max(Math.abs(l),Math.abs(r));
      this.outputPeak=Math.max(this.outputPeak,outPeak);
      this.outputSq+=(l*l+r*r)*.5;
      this.meterN++;
      this.telemetryCounter++;
    }

    if(this.telemetryCounter>=2048){
      const inputRms=Math.sqrt(this.inputSq/Math.max(1,this.meterN));
      const outputRms=Math.sqrt(this.outputSq/Math.max(1,this.meterN));

      this.port.postMessage({
        type:"telemetry",
        inputPeak:this.inputPeak,
        outputPeak:this.outputPeak,
        inputRms,
        outputRms,
        truePeakDbtp:gainDb(this.outputPeak),
        limiterGrDb:this.limiterGr,
        impactBoostDb:this.impactBoost,
        spatialWidthPercent:this.widthPercent,
        bassActivityDb:0,
        clarityActivityDb:0,
        rmsDeltaDb:gainDb(outputRms/Math.max(inputRms,1e-9))
      });

      this.inputPeak=0;
      this.outputPeak=0;
      this.inputSq=0;
      this.outputSq=0;
      this.meterN=0;
      this.limiterGr=0;
      this.impactBoost=0;
      this.telemetryCounter=0;
    }

    return true;
  }
}

registerProcessor("mvp-sound-v7",MvpSoundV7Processor);
