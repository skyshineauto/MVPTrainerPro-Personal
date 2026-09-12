import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const bytes = fs.readFileSync(path.join(root, "public", "audioV2", "mvpHdV2.wasm"));
const imports = { env: { sin: Math.sin, cos: Math.cos, pow: Math.pow, exp: Math.exp, log10: Math.log10 } };
const { instance } = await WebAssembly.instantiate(bytes, imports);
const dsp = instance.exports;
assert.equal(dsp.mvp_v2_init(48000), 1);

const SR=48000;
const frames=Number(dsp.mvp_v2_max_frames());
const mem=dsp.memory;
const inL=new Float32Array(mem.buffer, Number(dsp.mvp_v2_input_l()), frames);
const inR=new Float32Array(mem.buffer, Number(dsp.mvp_v2_input_r()), frames);
const outL=new Float32Array(mem.buffer, Number(dsp.mvp_v2_output_l()), frames);
const outR=new Float32Array(mem.buffer, Number(dsp.mvp_v2_output_r()), frames);
const WARM=8192;

function configure(c={}) {
  dsp.mvp_v2_reset();
  dsp.mvp_v2_set_mode(c.mode ?? 1);
  dsp.mvp_v2_set_output_profile(c.profile ?? 1);
  dsp.mvp_v2_set_intensity(c.intensity ?? .72);
  dsp.mvp_v2_set_bass_enabled(c.bass ? 1:0);
  dsp.mvp_v2_set_bass_character(c.bassCharacter ?? .5);
  dsp.mvp_v2_set_impact_enabled(c.impact ? 1:0);
  dsp.mvp_v2_set_clarity_enabled(c.clarity ? 1:0);
  dsp.mvp_v2_set_spatial_enabled(c.spatial ? 1:0);
  dsp.mvp_v2_set_space_mode(c.spaceMode ?? 0);
  dsp.mvp_v2_set_personal_enabled(c.personal ? 1:0);
  dsp.mvp_v2_set_personal_bass(c.personalBass ?? 0);
  dsp.mvp_v2_set_personal_presence(c.personalPresence ?? 0);
  dsp.mvp_v2_set_personal_brightness(c.personalBrightness ?? 0);
  dsp.mvp_v2_set_eq_enabled(c.eq ? 1:0);
  for(let i=0;i<31;i++) dsp.mvp_v2_set_eq_band(i,0);
  if(c.eqBands) for(const [i,g] of c.eqBands) dsp.mvp_v2_set_eq_band(i,g);
}
function render(c, generator, seconds=3) {
  configure(c);
  const total=Math.ceil(seconds*SR/frames)*frames;
  const L=new Float32Array(total), R=new Float32Array(total);
  for(let pos=0;pos<total;pos+=frames){
    for(let i=0;i<frames;i++){
      const [l,r]=generator(pos+i,SR);
      inL[i]=l;inR[i]=r;
    }
    assert.equal(dsp.mvp_v2_process(frames),1);
    L.set(outL,pos);R.set(outR,pos);
  }
  return {
    L,R,
    tp:Number(dsp.mvp_v2_meter_true_peak_dbtp()),
    limiter:Number(dsp.mvp_v2_meter_limiter_gr_db()),
    clips:Number(dsp.mvp_v2_meter_clip_count()),
    nans:Number(dsp.mvp_v2_meter_nan_count()),
    mb:Number(dsp.mvp_v2_meter_multiband_gr_db()),
    impact:Number(dsp.mvp_v2_meter_impact_boost_db()),
    bass:Number(dsp.mvp_v2_meter_bass_activity_db()),
    clarity:Number(dsp.mvp_v2_meter_clarity_activity_db()),
    width:Number(dsp.mvp_v2_meter_spatial_width_percent()),
  };
}
function rms(x,start=WARM){let e=0,n=0;for(let i=start;i<x.length;i++){e+=x[i]*x[i];n++;}return Math.sqrt(e/Math.max(1,n));}
function rmsStereo(o,start=WARM){return Math.sqrt((rms(o.L,start)**2+rms(o.R,start)**2)/2);}
function dbRatio(a,b){return 20*Math.log10(Math.max(a,1e-12)/Math.max(b,1e-12));}
function goertzel(ch,f,start=WARM,count=65536){const n=Math.min(count,ch.length-start);const w=2*Math.PI*f/SR,co=2*Math.cos(w);let s0=0,s1=0,s2=0;for(let i=0;i<n;i++){s0=ch[start+i]+co*s1-s2;s2=s1;s1=s0;}return Math.sqrt(Math.max(0,s1*s1+s2*s2-co*s1*s2))/Math.max(1,n);}
function sideMid(o,start=WARM){let me=0,se=0,n=0;for(let i=start;i<o.L.length;i++){const m=.5*(o.L[i]+o.R[i]),s=.5*(o.L[i]-o.R[i]);me+=m*m;se+=s*s;n++;}return Math.sqrt(se/Math.max(1,n))/Math.max(1e-12,Math.sqrt(me/Math.max(1,n)));}
function cubic(p0,p1,p2,p3,t){const a0=-.5*p0+1.5*p1-1.5*p2+.5*p3,a1=p0-2.5*p1+2*p2-.5*p3,a2=-.5*p0+.5*p2;return ((a0*t+a1)*t+a2)*t+p1;}
function peak8(ch){let p=0;for(let i=Math.max(WARM,1);i<ch.length-2;i++){const a=ch[i-1],b=ch[i],c=ch[i+1],d=ch[i+2];p=Math.max(p,Math.abs(b));for(let k=1;k<8;k++)p=Math.max(p,Math.abs(cubic(a,b,c,d,k/8)));}return p;}
function tp(o){return 20*Math.log10(Math.max(1e-12,Math.max(peak8(o.L),peak8(o.R))));}

const program=(i,sr)=>{const t=i/sr;const pulse=(i%2400)<220?1:.74;return [
 pulse*(.11*Math.sin(2*Math.PI*83*t)+.105*Math.sin(2*Math.PI*997*t)+.05*Math.sin(2*Math.PI*6500*t)),
 pulse*(.108*Math.sin(2*Math.PI*83*t+.08)+.10*Math.sin(2*Math.PI*997*t+.31)+.048*Math.sin(2*Math.PI*6500*t+.73))
];};

const pure=render({mode:0},program);
const adaptive=render({mode:1,intensity:.72,profile:1},program);
const power=render({mode:2,intensity:.72,profile:1},program);
const pureR=rmsStereo(pure), adaptiveR=rmsStereo(adaptive), powerR=rmsStereo(power);
const adaptiveLift=dbRatio(adaptiveR,pureR), powerOverAdaptive=dbRatio(powerR,adaptiveR), powerLift=dbRatio(powerR,pureR);
console.log({pureR,adaptiveR,powerR,adaptiveLift,powerOverAdaptive,powerLift,powerLimiter:power.limiter});
assert.ok(Math.abs(dbRatio(pureR,pureR))<.001);
assert.ok(adaptiveLift>=0.3,`Adaptive lift ${adaptiveLift.toFixed(2)} dB`);
assert.ok(powerOverAdaptive>=1.5,`Power over Adaptive ${powerOverAdaptive.toFixed(2)} dB`);
assert.equal(power.clips,0);assert.equal(power.nans,0);

const lowIntensity=render({mode:2,intensity:.2},program);
const highIntensity=render({mode:2,intensity:1},program);
const intensityLift=dbRatio(rmsStereo(highIntensity),rmsStereo(lowIntensity));
console.log({intensityLift});
assert.ok(intensityLift>=1.0,`Intensity control only ${intensityLift.toFixed(2)} dB`);

const bassSig=(i,sr)=>{const t=i/sr;const x=.035*Math.sin(2*Math.PI*80*t)+.035*Math.sin(2*Math.PI*1000*t);return[x,x];};
const bassOff=render({mode:1,intensity:.8,bass:false},bassSig);
const bassOn=render({mode:1,intensity:.8,bass:true,bassCharacter:.5},bassSig);
const bass80=dbRatio(goertzel(bassOn.L,80),goertzel(bassOff.L,80));
const bass1k=dbRatio(goertzel(bassOn.L,1000),goertzel(bassOff.L,1000));
console.log({bass80,bass1k,bassActivity:bassOn.bass});
assert.ok(bass80>=4.0,`Bass lift ${bass80.toFixed(2)} dB`);
assert.ok(Math.abs(bass1k)<=1.0,`Bass leaked to 1k ${bass1k.toFixed(2)} dB`);

const deepSig=(i,sr)=>{const t=i/sr;const x=.03*Math.sin(2*Math.PI*50*t)+.03*Math.sin(2*Math.PI*140*t);return[x,x];};
const tight=render({mode:1,intensity:.8,bass:true,bassCharacter:0},deepSig);
const deep=render({mode:1,intensity:.8,bass:true,bassCharacter:1},deepSig);
const deep50=dbRatio(goertzel(deep.L,50),goertzel(tight.L,50));
const tight140=dbRatio(goertzel(tight.L,140),goertzel(deep.L,140));
console.log({deep50,tight140});
assert.ok(deep50>=.7,`Deep character 50Hz delta ${deep50.toFixed(2)} dB`);
assert.ok(tight140>=.3,`Tight character 140Hz delta ${tight140.toFixed(2)} dB`);

const claritySig=(i,sr)=>{const t=i/sr;const x=.025*Math.sin(2*Math.PI*1000*t)+.02*Math.sin(2*Math.PI*9000*t);return[x,x];};
const clearOff=render({mode:1,intensity:.8},claritySig);
const clearOn=render({mode:1,intensity:.8,clarity:true},claritySig);
const clear9=dbRatio(goertzel(clearOn.L,9000),goertzel(clearOff.L,9000));
const clear1=dbRatio(goertzel(clearOn.L,1000),goertzel(clearOff.L,1000));
console.log({clear9,clear1,clarityActivity:clearOn.clarity});
assert.ok(clear9>=3.0,`Clarity 9k lift ${clear9.toFixed(2)} dB`);
assert.ok(Math.abs(clear1)<=1.0,`Clarity leaked 1k ${clear1.toFixed(2)} dB`);

const pulse=(i,sr)=>{const t=i/sr,p=i%4800,a=p<220?.22:.065,x=a*Math.sin(2*Math.PI*180*t);return[x,x];};
const impactOff=render({mode:1,intensity:.85},pulse);
const impactOn=render({mode:1,intensity:.85,impact:true},pulse);
function onsetRatio(o){let oe=0,se=0,on=0,sn=0;for(let i=WARM;i<o.L.length;i++){const p=((i-96)%4800+4800)%4800,x=.5*(o.L[i]+o.R[i]);if(p<220){oe+=x*x;on++;}else if(p>1500&&p<3800){se+=x*x;sn++;}}return Math.sqrt(oe/Math.max(1,on))/Math.max(1e-12,Math.sqrt(se/Math.max(1,sn)));}
const impactOffRatio=onsetRatio(impactOff), impactOnRatio=onsetRatio(impactOn); const impactRatio=impactOnRatio/impactOffRatio;
console.log({impactOffRatio,impactOnRatio,impactRatio,impactMeter:impactOn.impact});
assert.ok(impactRatio>=1.09,`Impact ratio ${impactRatio.toFixed(3)}`);

const stereo=(i,sr)=>{const t=i/sr;return [
 .07*Math.sin(2*Math.PI*500*t)+.055*Math.sin(2*Math.PI*3200*t),
 .07*Math.sin(2*Math.PI*500*t+.7)+.055*Math.sin(2*Math.PI*3200*t+1.4)
];};
const stageOff=render({mode:1,intensity:.8,profile:2},stereo);
const stageOn=render({mode:1,intensity:.8,profile:2,spatial:true},stereo);
const stageRatio=sideMid(stageOn)/sideMid(stageOff);
console.log({stageRatio,width:stageOn.width});
assert.ok(stageRatio>=1.25,`Stage side ratio ${stageRatio.toFixed(3)}`);

const eqOff=render({mode:1,intensity:.5,eq:true},(i,sr)=>{const x=.012*Math.sin(2*Math.PI*1000*i/sr);return[x,x];});
const eqOn=render({mode:1,intensity:.5,eq:true,eqBands:[[17,6]]},(i,sr)=>{const x=.012*Math.sin(2*Math.PI*1000*i/sr);return[x,x];});
const eqLift=dbRatio(goertzel(eqOn.L,1000),goertzel(eqOff.L,1000));
console.log({eqLift});
assert.ok(eqLift>=4.5,`EQ +6 at 1k only ${eqLift.toFixed(2)} dB`);

const all=render({mode:2,intensity:1,profile:2,bass:true,bassCharacter:.8,clarity:true,impact:true,spatial:true},(i,sr)=>{
 const t=i/sr,imp=(i%4096)<20?.55:0;return[
 .34*Math.sin(2*Math.PI*83*t)+.24*Math.sin(2*Math.PI*997*t)+.10*Math.sin(2*Math.PI*7000*t)+imp,
 .33*Math.sin(2*Math.PI*83*t+.1)+.23*Math.sin(2*Math.PI*997*t+.35)+.095*Math.sin(2*Math.PI*7000*t+.8)+imp*.95
 ];},3);
const allTp=tp(all);
console.log({allTp,meterTp:all.tp,limiter:all.limiter,mb:all.mb,clips:all.clips,nans:all.nans});
assert.ok(allTp<=-.05,`True peak too high ${allTp.toFixed(2)} dBTP`);
assert.equal(all.clips,0);assert.equal(all.nans,0);
console.log("MVP Broadcast Engine V3 PCM validation: PASS");
