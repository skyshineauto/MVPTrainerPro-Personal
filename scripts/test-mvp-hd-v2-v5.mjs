import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __filename=fileURLToPath(import.meta.url), __dirname=path.dirname(__filename);
const root=path.resolve(__dirname,'..');
const bytes=fs.readFileSync(path.join(root,'public','audioV2','mvpHdV2.wasm'));
const imports={env:{sin:Math.sin,cos:Math.cos,pow:Math.pow,exp:Math.exp,log10:Math.log10}};
const {instance}=await WebAssembly.instantiate(bytes,imports);
const dsp=instance.exports;
const SR=48000;
const results=[];
function gate(name, fn){ try{ fn(); results.push({name,ok:true}); console.log(`PASS ${String(results.length).padStart(2,'0')} ${name}`);}catch(e){results.push({name,ok:false,error:e.message}); console.error(`FAIL ${String(results.length).padStart(2,'0')} ${name}: ${e.message}`);} }

gate('WASM initializes at 48 kHz',()=>assert.equal(dsp.mvp_v2_init(SR),1));
const required=['memory','mvp_v2_input_l','mvp_v2_input_r','mvp_v2_output_l','mvp_v2_output_r','mvp_v2_max_frames','mvp_v2_init','mvp_v2_reset','mvp_v2_reset_meters','mvp_v2_set_mode','mvp_v2_set_output_profile','mvp_v2_set_intensity','mvp_v2_set_bass_enabled','mvp_v2_set_bass_character','mvp_v2_set_impact_enabled','mvp_v2_set_clarity_enabled','mvp_v2_set_spatial_enabled','mvp_v2_set_space_mode','mvp_v2_set_eq_enabled','mvp_v2_set_eq_band','mvp_v2_process','mvp_v2_meter_true_peak_dbtp','mvp_v2_meter_clip_count','mvp_v2_meter_nan_count'];
gate('Production mvp_v2 ABI is complete',()=>{for(const k of required) assert.ok(k in dsp,`missing ${k}`)});

const frames=Number(dsp.mvp_v2_max_frames()), mem=dsp.memory;
const inL=new Float32Array(mem.buffer,Number(dsp.mvp_v2_input_l()),frames);
const inR=new Float32Array(mem.buffer,Number(dsp.mvp_v2_input_r()),frames);
const outL=new Float32Array(mem.buffer,Number(dsp.mvp_v2_output_l()),frames);
const outR=new Float32Array(mem.buffer,Number(dsp.mvp_v2_output_r()),frames);
const LOOKAHEAD=120; // 2.5 ms at 48 kHz, by V5 contract.
const WARM=12000;

function setControls(c={}){
  dsp.mvp_v2_set_mode(c.mode ?? 1);
  dsp.mvp_v2_set_output_profile(c.profile ?? 1);
  dsp.mvp_v2_set_intensity(c.intensity ?? .72);
  dsp.mvp_v2_set_bass_enabled(c.bass?1:0);
  dsp.mvp_v2_set_bass_character(c.bassCharacter ?? .5);
  dsp.mvp_v2_set_impact_enabled(c.impact?1:0);
  dsp.mvp_v2_set_clarity_enabled(c.clarity?1:0);
  dsp.mvp_v2_set_spatial_enabled(c.spatial?1:0);
  dsp.mvp_v2_set_space_mode(c.spaceMode ?? 0);
  if(dsp.mvp_v2_set_personal_enabled) dsp.mvp_v2_set_personal_enabled(c.personal?1:0);
  if(dsp.mvp_v2_set_personal_bass) dsp.mvp_v2_set_personal_bass(c.personalBass ?? 0);
  if(dsp.mvp_v2_set_personal_presence) dsp.mvp_v2_set_personal_presence(c.personalPresence ?? 0);
  if(dsp.mvp_v2_set_personal_brightness) dsp.mvp_v2_set_personal_brightness(c.personalBrightness ?? 0);
  if(dsp.mvp_v2_set_master_prep){
    const m=c.masterPrep || {};
    dsp.mvp_v2_set_master_prep(c.masterPrep?1:0,m.sourceGainDb??0,m.highpassHz??18,m.lowMidDb??0,m.presenceDb??0,m.harshnessDb??0,m.balanceDb??0,m.widthScale??1);
  }
  dsp.mvp_v2_set_eq_enabled(c.eq?1:0);
  for(let i=0;i<31;i++) dsp.mvp_v2_set_eq_band(i,0);
  if(c.eqBands) for(const [i,g] of c.eqBands) dsp.mvp_v2_set_eq_band(i,g);
}
function configure(c={}){dsp.mvp_v2_reset(); setControls(c); dsp.mvp_v2_reset_meters();}
function meters(){return{tp:Number(dsp.mvp_v2_meter_true_peak_dbtp()),limiter:Number(dsp.mvp_v2_meter_limiter_gr_db()),clips:Number(dsp.mvp_v2_meter_clip_count()),nans:Number(dsp.mvp_v2_meter_nan_count()),mb:Number(dsp.mvp_v2_meter_multiband_gr_db()),impact:Number(dsp.mvp_v2_meter_impact_boost_db()),bass:Number(dsp.mvp_v2_meter_bass_activity_db()),clarity:Number(dsp.mvp_v2_meter_clarity_activity_db()),width:Number(dsp.mvp_v2_meter_spatial_width_percent())}}
function renderCurrent(generator,seconds=1.6){
  const total=Math.ceil(seconds*SR/frames)*frames; const L=new Float32Array(total),R=new Float32Array(total);
  for(let pos=0;pos<total;pos+=frames){for(let i=0;i<frames;i++){const [l,r]=generator(pos+i,SR);inL[i]=l;inR[i]=r;} assert.equal(dsp.mvp_v2_process(frames),1);L.set(outL,pos);R.set(outR,pos);} return{L,R,...meters()};
}
function render(c,generator,seconds=1.6){configure(c); return renderCurrent(generator,seconds)}
function rms(x,start=WARM){let e=0,n=0;for(let i=Math.min(start,x.length-1);i<x.length;i++){e+=x[i]*x[i];n++;}return Math.sqrt(e/Math.max(1,n));}
function rmsStereo(o,start=WARM){return Math.sqrt((rms(o.L,start)**2+rms(o.R,start)**2)/2)}
function dbRatio(a,b){return 20*Math.log10(Math.max(a,1e-12)/Math.max(b,1e-12))}
function goertzel(ch,f,start=WARM,count=50000){const n=Math.min(count,ch.length-start),w=2*Math.PI*f/SR,co=2*Math.cos(w);let s0=0,s1=0,s2=0;for(let i=0;i<n;i++){s0=ch[start+i]+co*s1-s2;s2=s1;s1=s0;}return Math.sqrt(Math.max(0,s1*s1+s2*s2-co*s1*s2))/Math.max(1,n)}
function sideMid(o,start=WARM){let me=0,se=0,n=0;for(let i=start;i<o.L.length;i++){const m=.5*(o.L[i]+o.R[i]),s=.5*(o.L[i]-o.R[i]);me+=m*m;se+=s*s;n++;}return Math.sqrt(se/Math.max(1,n))/Math.max(1e-12,Math.sqrt(me/Math.max(1,n)))}
function onsetRatio(o,period=4800,on=220){let oe=0,se=0,onN=0,seN=0;for(let i=WARM;i<o.L.length;i++){const p=((i-LOOKAHEAD)%period+period)%period,x=.5*(o.L[i]+o.R[i]);if(p<on){oe+=x*x;onN++;}else if(p>1500&&p<3800){se+=x*x;seN++;}}return Math.sqrt(oe/Math.max(1,onN))/Math.max(1e-12,Math.sqrt(se/Math.max(1,seN)))}

// Deterministic music-like sources. Levels differ in both RMS and crest, not only gain.
function baseGenre(genre,i,sr){
  const t=i/sr;
  const beat=i%24000, eighth=i%6000, sixteenth=i%3000;
  const kick=Math.exp(-beat/650)*Math.sin(2*Math.PI*(58+24*Math.exp(-beat/500))*t);
  const snare=(Math.exp(-Math.abs(beat-12000)/520))*((i*1103515245+12345>>>8)%2000/1000-1);
  const hat=Math.exp(-sixteenth/210)*Math.sin(2*Math.PI*9000*t);
  if(genre==='rock'){
    const drum=((eighth<240)?1:.38)*(.28*Math.sin(2*Math.PI*92*t)+.14*Math.sin(2*Math.PI*184*t));
    const guitar=.34*Math.sin(2*Math.PI*165*t)+.22*Math.sin(2*Math.PI*330*t)+.19*Math.sin(2*Math.PI*1320*t)+.12*Math.sin(2*Math.PI*3600*t);
    const vocal=.18*Math.sin(2*Math.PI*740*t)+.09*Math.sin(2*Math.PI*2220*t);
    return [drum+guitar+vocal+.10*hat, drum+.96*guitar+.92*vocal-.09*hat];
  }
  if(genre==='hardrock'){
    const riff=.40*Math.sin(2*Math.PI*110*t)+.28*Math.sin(2*Math.PI*220*t)+.22*Math.sin(2*Math.PI*880*t)+.18*Math.sin(2*Math.PI*2850*t)+.12*Math.sin(2*Math.PI*6100*t);
    const thump=(eighth<180?.34:.05)*Math.sin(2*Math.PI*74*t);
    return [riff+thump+.10*hat, .97*riff+thump-.08*hat];
  }
  if(genre==='electronic'){
    const saw=.22*(Math.sin(2*Math.PI*220*t)+.5*Math.sin(2*Math.PI*440*t)+.33*Math.sin(2*Math.PI*660*t)+.25*Math.sin(2*Math.PI*880*t));
    return [.48*kick+saw+.13*hat, .48*kick+.95*saw-.12*hat];
  }
  if(genre==='hiphop'){
    const sub=.48*Math.sin(2*Math.PI*52*t)+.14*Math.sin(2*Math.PI*104*t);
    const keys=.18*Math.sin(2*Math.PI*440*t)+.10*Math.sin(2*Math.PI*1320*t);
    return [sub+.32*kick+keys+.12*snare+.08*hat, sub+.32*kick+.94*keys+.11*snare-.07*hat];
  }
  const chords=.22*Math.sin(2*Math.PI*196*t)+.18*Math.sin(2*Math.PI*294*t)+.13*Math.sin(2*Math.PI*392*t)+.12*Math.sin(2*Math.PI*1760*t);
  const melody=.18*Math.sin(2*Math.PI*660*t)+.10*Math.sin(2*Math.PI*3300*t);
  return [.25*kick+chords+melody+.09*hat,.25*kick+.96*chords+.93*melody-.08*hat];
}
function corpus(genre,level){
  const drive=level==='dynamic'?.48:level==='hot'?1.20:2.75;
  const target=level==='dynamic'?.34:level==='hot'?.62:.88;
  const norm=Math.tanh(drive);
  return (i,sr)=>{const [l,r]=baseGenre(genre,i,sr); return [target*Math.tanh(l*drive)/norm,target*Math.tanh(r*drive)/norm];};
}
const crushedRock=(i,sr)=>{const [l,r]=baseGenre('hardrock',i,sr);return [.91*Math.tanh(5.2*l),.91*Math.tanh(5.2*r)]};

// PURE bit/sample path is exact except the intentional fixed lookahead delay.
{
 configure({mode:0}); const N=frames*30, srcL=new Float32Array(N),srcR=new Float32Array(N); let seed=0x12345678;
 const g=(i)=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const a=((seed>>>0)/4294967296-.5)*.6;seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const b=((seed>>>0)/4294967296-.5)*.6;srcL[i]=a;srcR[i]=b;return[a,b]};
 const o=renderCurrent(g,N/SR); let err=0; for(let i=LOOKAHEAD;i<N;i++){err=Math.max(err,Math.abs(o.L[i]-srcL[i-LOOKAHEAD]),Math.abs(o.R[i]-srcR[i-LOOKAHEAD]));}
 gate('PURE returns exact delayed reference samples',()=>assert.ok(err<1e-7,`max error ${err}`));
 gate('PURE has no clipping or NaN',()=>{assert.equal(o.clips,0);assert.equal(o.nans,0)});
}

const corpusMetrics=[];
for(const genre of ['rock','electronic','hiphop','pop']) for(const level of ['dynamic','hot','brickwall']){
  const g=corpus(genre,level); const p=render({mode:0},g),a=render({mode:1,intensity:.72,profile:1},g),w=render({mode:2,intensity:.72,profile:1},g);
  const al=dbRatio(rmsStereo(a),rmsStereo(p)), pw=dbRatio(rmsStereo(w),rmsStereo(p)), pa=dbRatio(rmsStereo(w),rmsStereo(a));
  corpusMetrics.push({genre,level,adaptive:al,power:pw,powerOverAdaptive:pa,tp:w.tp,limiter:w.limiter,clips:w.clips,nans:w.nans});
  const minA=level==='brickwall'?.35:.55, minPA=level==='brickwall'?.45:.75;
  gate(`${genre} ${level}: ADAPTIVE audibly exceeds PURE`,()=>assert.ok(al>=minA,`${al.toFixed(2)} dB`));
  gate(`${genre} ${level}: POWER audibly exceeds ADAPTIVE`,()=>assert.ok(pa>=minPA,`${pa.toFixed(2)} dB`));
}
{
 const p=render({mode:0},crushedRock),a=render({mode:1,intensity:.72,profile:1},crushedRock),w=render({mode:2,intensity:.72,profile:1},crushedRock);
 const al=dbRatio(rmsStereo(a),rmsStereo(p)),pa=dbRatio(rmsStereo(w),rmsStereo(a));
 corpusMetrics.push({genre:'hardrock',level:'loudness-war',adaptive:al,power:dbRatio(rmsStereo(w),rmsStereo(p)),powerOverAdaptive:pa,tp:w.tp,limiter:w.limiter,clips:w.clips,nans:w.nans});
 gate('crushed hard-rock: ADAPTIVE remains effective',()=>assert.ok(al>=.25,`${al.toFixed(2)} dB`));
 gate('crushed hard-rock: POWER remains stronger',()=>assert.ok(pa>=.30,`${pa.toFixed(2)} dB`));
}

const program=corpus('rock','hot');
const i0=render({mode:2,intensity:0,profile:1},program), i50=render({mode:2,intensity:.5,profile:1},program), i100=render({mode:2,intensity:1,profile:1},program);
gate('Intensity 0 < 50 < 100',()=>{const a=rmsStereo(i0),b=rmsStereo(i50),c=rmsStereo(i100);assert.ok(dbRatio(b,a)>=1.5&&dbRatio(c,b)>=0.8,`${dbRatio(b,a).toFixed(2)}, ${dbRatio(c,b).toFixed(2)} dB`)});

const bassSig=(i,sr)=>{const t=i/sr,x=.035*Math.sin(2*Math.PI*80*t)+.035*Math.sin(2*Math.PI*1000*t);return[x,x]};
const bassOff=render({mode:1,intensity:.8},bassSig),bassOn=render({mode:1,intensity:.8,bass:true,bassCharacter:.5},bassSig);
gate('Bass produces strong low-frequency lift without 1 kHz spill',()=>{const b80=dbRatio(goertzel(bassOn.L,80),goertzel(bassOff.L,80)),b1=dbRatio(goertzel(bassOn.L,1000),goertzel(bassOff.L,1000));assert.ok(b80>=3.5,`${b80.toFixed(2)} dB at 80`);assert.ok(Math.abs(b1)<=1.0,`${b1.toFixed(2)} dB at 1k`)});
const deepSig=(i,sr)=>{const t=i/sr,x=.03*Math.sin(2*Math.PI*50*t)+.03*Math.sin(2*Math.PI*140*t);return[x,x]};
const tight=render({mode:1,intensity:.8,bass:true,bassCharacter:0},deepSig), deep=render({mode:1,intensity:.8,bass:true,bassCharacter:1},deepSig);
gate('TIGHT and DEEP bass are spectrally distinct',()=>{assert.ok(dbRatio(goertzel(deep.L,50),goertzel(tight.L,50))>=2.0);assert.ok(dbRatio(goertzel(tight.L,140),goertzel(deep.L,140))>=2.0)});
const claritySig=(i,sr)=>{const t=i/sr,x=.025*Math.sin(2*Math.PI*1000*t)+.02*Math.sin(2*Math.PI*9000*t);return[x,x]};
const clearOff=render({mode:1,intensity:.8},claritySig),clearOn=render({mode:1,intensity:.8,clarity:true},claritySig);
gate('Clarity restores high detail without broad mid boost',()=>{const c9=dbRatio(goertzel(clearOn.L,9000),goertzel(clearOff.L,9000)),c1=dbRatio(goertzel(clearOn.L,1000),goertzel(clearOff.L,1000));assert.ok(c9>=4.0,`${c9.toFixed(2)} dB`);assert.ok(Math.abs(c1)<=1.0,`${c1.toFixed(2)} dB`)});
const pulse=(i,sr)=>{const t=i/sr,p=i%4800,a=p<220?.22:.065,x=a*Math.sin(2*Math.PI*180*t);return[x,x]};
const impactOff=render({mode:1,intensity:.85},pulse),impactOn=render({mode:1,intensity:.85,impact:true},pulse);
gate('Impact increases transient contrast',()=>assert.ok(onsetRatio(impactOn)/onsetRatio(impactOff)>=1.25));
const stereo=(i,sr)=>{const t=i/sr;return[.07*Math.sin(2*Math.PI*500*t)+.055*Math.sin(2*Math.PI*3200*t),.07*Math.sin(2*Math.PI*500*t+.7)+.055*Math.sin(2*Math.PI*3200*t+1.4)]};
const hpOff=render({mode:1,intensity:.8,profile:1},stereo),hpOn=render({mode:1,intensity:.8,profile:1,spatial:true},stereo);
gate('Headphone IMMERSION is clearly audible',()=>assert.ok(sideMid(hpOn)/sideMid(hpOff)>=1.45));
const btOff=render({mode:1,intensity:.8,profile:2},stereo),btOn=render({mode:1,intensity:.8,profile:2,spatial:true},stereo);
gate('Bluetooth STAGE is clearly audible',()=>assert.ok(sideMid(btOn)/sideMid(btOff)>=1.55));
const carStudio=render({mode:1,intensity:.8,profile:0,spatial:true,spaceMode:0},stereo),carLive=render({mode:1,intensity:.8,profile:0,spatial:true,spaceMode:1},stereo),carArena=render({mode:1,intensity:.8,profile:0,spatial:true,spaceMode:2},stereo);
gate('Car SPACE Studio < Live < Arena',()=>{const a=sideMid(carStudio),b=sideMid(carLive),c=sideMid(carArena);assert.ok(b>a*1.05&&c>b*1.05,`${a.toFixed(3)} ${b.toFixed(3)} ${c.toFixed(3)}`)});
const eqOff=render({mode:1,intensity:.5,eq:true},(i,sr)=>{const x=.012*Math.sin(2*Math.PI*1000*i/sr);return[x,x]}),eqOn=render({mode:1,intensity:.5,eq:true,eqBands:[[17,6]]},(i,sr)=>{const x=.012*Math.sin(2*Math.PI*1000*i/sr);return[x,x]});
gate('31-band EQ remains fully audible',()=>assert.ok(dbRatio(goertzel(eqOn.L,1000),goertzel(eqOff.L,1000))>=4.5));

// V5.1 real-device tuning contracts: controls must be unmistakable, bounded and profile-aware.
for(const profile of [1,2]){
  const label=profile===1?'Headphones':'Bluetooth';
  const pOff=render({mode:1,intensity:.75,profile,personal:true,personalBass:-1},(i,sr)=>{const x=.012*Math.sin(2*Math.PI*65*i/sr);return[x,x]});
  const pOn=render({mode:1,intensity:.75,profile,personal:true,personalBass:1},(i,sr)=>{const x=.012*Math.sin(2*Math.PI*65*i/sr);return[x,x]});
  gate(`${label} Personal Bass has a real range`,()=>assert.ok(dbRatio(goertzel(pOn.L,65),goertzel(pOff.L,65))>=7.0));

  const prOff=render({mode:1,intensity:.75,profile,personal:true,personalPresence:-1},(i,sr)=>{const x=.012*Math.sin(2*Math.PI*3200*i/sr);return[x,x]});
  const prOn=render({mode:1,intensity:.75,profile,personal:true,personalPresence:1},(i,sr)=>{const x=.012*Math.sin(2*Math.PI*3200*i/sr);return[x,x]});
  gate(`${label} Personal Presence has a real range`,()=>assert.ok(dbRatio(goertzel(prOn.L,3200),goertzel(prOff.L,3200))>=7.0));

  const brOff=render({mode:1,intensity:.75,profile,personal:true,personalBrightness:-1},(i,sr)=>{const x=.012*Math.sin(2*Math.PI*10000*i/sr);return[x,x]});
  const brOn=render({mode:1,intensity:.75,profile,personal:true,personalBrightness:1},(i,sr)=>{const x=.012*Math.sin(2*Math.PI*10000*i/sr);return[x,x]});
  gate(`${label} Personal Brightness has a real range`,()=>assert.ok(dbRatio(goertzel(brOn.L,10000),goertzel(brOff.L,10000))>=8.0));

  const safeImpact=render({mode:2,intensity:1,profile,impact:true},pulse);
  gate(`${label} Impact boost is bounded`,()=>assert.ok(safeImpact.impact<=4.5,`${safeImpact.impact.toFixed(2)} dB`));
}

// Existing Enrich Library Master Prep must now be a real part of the V5.1 playback engine.
const prepTone=(i,sr)=>{const t=i/sr;return[.012*Math.sin(2*Math.PI*320*t)+.012*Math.sin(2*Math.PI*3200*t)+.012*Math.sin(2*Math.PI*6500*t),.012*Math.sin(2*Math.PI*320*t+.1)+.012*Math.sin(2*Math.PI*3200*t+.25)+.012*Math.sin(2*Math.PI*6500*t+.4)]};
const prepNeutral=render({mode:1,intensity:.6,profile:1},prepTone);
const prepCorrected=render({mode:1,intensity:.6,profile:1,masterPrep:{sourceGainDb:1.2,highpassHz:26,lowMidDb:-1.5,presenceDb:.55,harshnessDb:-1.4,balanceDb:.8,widthScale:.9}},prepTone);
gate('Master Prep low-mid correction is active',()=>assert.ok(dbRatio(goertzel(prepCorrected.L,320),goertzel(prepNeutral.L,320))<0.5));
gate('Master Prep presence correction is active',()=>{const d=dbRatio(goertzel(prepCorrected.L,3200),goertzel(prepNeutral.L,3200));assert.ok(d>0.3,`${d.toFixed(2)} dB`)});
gate('Master Prep harshness correction is active',()=>{const d=dbRatio(goertzel(prepCorrected.L,6500),goertzel(prepNeutral.L,6500));assert.ok(d<0.2,`${d.toFixed(2)} dB`)});
gate('Master Prep width protection is active',()=>assert.ok(sideMid(prepCorrected)<sideMid(prepNeutral)));
const prepRumbleOff=render({mode:1,intensity:.5,profile:1},(i,sr)=>{const x=.018*Math.sin(2*Math.PI*20*i/sr);return[x,x]});
const prepRumbleOn=render({mode:1,intensity:.5,profile:1,masterPrep:{highpassHz:26}},(i,sr)=>{const x=.018*Math.sin(2*Math.PI*20*i/sr);return[x,x]});
gate('Master Prep rumble high-pass is active',()=>assert.ok(dbRatio(goertzel(prepRumbleOn.L,20),goertzel(prepRumbleOff.L,20))<=-4.0));
const prepGainOff=render({mode:1,intensity:.5,profile:1},(i,sr)=>{const x=.004*Math.sin(2*Math.PI*1000*i/sr);return[x,x]});
const prepGainOn=render({mode:1,intensity:.5,profile:1,masterPrep:{sourceGainDb:1.5}},(i,sr)=>{const x=.004*Math.sin(2*Math.PI*1000*i/sr);return[x,x]});
gate('Master Prep can recover clean source level',()=>assert.ok(dbRatio(rmsStereo(prepGainOn),rmsStereo(prepGainOff))>=0.5));


// Independent 8x windowed-sinc interpolated true peak, separate from the V5 4x FIR meter.
function makePhaseFir(up=8,taps=20){const fc=.475/up,N=up*taps,mid=(N-1)/2,h=new Float64Array(N);let sum=0;for(let n=0;n<N;n++){const x=n-mid;const sinc=Math.abs(x)<1e-12?2*fc:Math.sin(2*Math.PI*fc*x)/(Math.PI*x);const w=.42-.5*Math.cos(2*Math.PI*n/(N-1))+.08*Math.cos(4*Math.PI*n/(N-1));h[n]=sinc*w;sum+=h[n]}const scale=up/sum;for(let n=0;n<N;n++)h[n]*=scale;const ph=[];for(let p=0;p<up;p++){const a=[];for(let k=0;k<taps;k++)a.push(h[p+k*up]);ph.push(a)}return ph}
const fir8=makePhaseFir();
function tp8(ch,start=WARM){let peak=0;const taps=fir8[0].length;for(let i=Math.max(start,taps);i<ch.length;i++){for(let p=0;p<8;p++){let y=0;const f=fir8[p];for(let k=0;k<taps;k++)y+=f[k]*ch[i-k];const a=Math.abs(y);if(a>peak)peak=a}}return peak}
const torture=render({mode:2,intensity:1,profile:2,bass:true,bassCharacter:.85,clarity:true,impact:true,spatial:true},(i,sr)=>{const t=i/sr,imp=(i%4096)<20?.55:0;return[.34*Math.sin(2*Math.PI*83*t)+.24*Math.sin(2*Math.PI*997*t)+.10*Math.sin(2*Math.PI*7000*t)+imp,.33*Math.sin(2*Math.PI*83*t+.1)+.23*Math.sin(2*Math.PI*997*t+.35)+.095*Math.sin(2*Math.PI*7000*t+.8)+imp*.95]},2.0);
const extTp=20*Math.log10(Math.max(1e-12,tp8(torture.L),tp8(torture.R)));
gate('Independent 8x true peak stays at or below -0.35 dBTP',()=>assert.ok(extTp<=-.35,`${extTp.toFixed(3)} dBTP`));
gate('Torture stack has 0 clips / 0 NaNs',()=>{assert.equal(torture.clips,0);assert.equal(torture.nans,0)});

// One continuously initialized instance: 20 complete mode cycles, no reset/recreate.
configure({mode:0,intensity:.82,profile:1});
const cycle=[];
for(let c=0;c<20;c++) for(const mode of [0,1,2]){dsp.mvp_v2_set_mode(mode);dsp.mvp_v2_reset_meters();const o=renderCurrent(program,.72);cycle.push({c,mode,r:rmsStereo(o),...meters()})}
const byMode=m=>cycle.filter(x=>x.mode===m).map(x=>x.r), spreadDb=a=>dbRatio(Math.max(...a),Math.min(...a));
gate('20-cycle continuous PURE state is repeatable',()=>assert.ok(spreadDb(byMode(0))<=.08,`${spreadDb(byMode(0)).toFixed(3)} dB`));
gate('20-cycle continuous ADAPTIVE state is repeatable',()=>assert.ok(spreadDb(byMode(1))<=.25,`${spreadDb(byMode(1)).toFixed(3)} dB`));
gate('20-cycle continuous POWER state is repeatable',()=>assert.ok(spreadDb(byMode(2))<=.25,`${spreadDb(byMode(2)).toFixed(3)} dB`));
gate('Every continuous cycle preserves PURE < ADAPTIVE < POWER',()=>{for(let c=1;c<20;c++){const p=cycle.find(x=>x.c===c&&x.mode===0).r,a=cycle.find(x=>x.c===c&&x.mode===1).r,w=cycle.find(x=>x.c===c&&x.mode===2).r;assert.ok(dbRatio(a,p)>=.3,`cycle ${c} A`);assert.ok(dbRatio(w,a)>=.5,`cycle ${c} P`)}});
gate('Continuous mode stress has 0 clips / 0 NaNs',()=>{for(const x of cycle){assert.equal(x.clips,0);assert.equal(x.nans,0)}});

// Intensity 0→50→100→50→0, repeated five times without resetting the DSP.
dsp.mvp_v2_set_mode(2);const intensityRuns=[];
for(let c=0;c<5;c++) for(const v of [0,.5,1,.5,0]){dsp.mvp_v2_set_intensity(v);dsp.mvp_v2_reset_meters();const o=renderCurrent(program,.85);intensityRuns.push({c,v,r:rmsStereo(o)})}
const avg=v=>{const x=intensityRuns.filter(q=>q.v===v).map(q=>q.r);return x.reduce((a,b)=>a+b,0)/x.length};
gate('Continuous intensity 0 / 50 / 100 stays clearly ordered',()=>{const a=dbRatio(avg(.5),avg(0)),b=dbRatio(avg(1),avg(.5));assert.ok(a>=1.5&&b>=0.8,`${a.toFixed(2)}, ${b.toFixed(2)} dB`)});
gate('Continuous intensity returns to repeatable 0%',()=>{const x=intensityRuns.filter(q=>q.v===0).map(q=>q.r);assert.ok(spreadDb(x)<=.30,`${spreadDb(x).toFixed(3)} dB`)});
gate('Continuous intensity returns to repeatable 50%',()=>{const x=intensityRuns.filter(q=>q.v===.5).map(q=>q.r);assert.ok(spreadDb(x)<=.30,`${spreadDb(x).toFixed(3)} dB`)});

// Repeated effect toggles on one instance.
dsp.mvp_v2_set_mode(1);dsp.mvp_v2_set_intensity(.8);dsp.mvp_v2_set_output_profile(2);const toggle=[];
for(let c=0;c<10;c++){
  for(const on of [0,1]){dsp.mvp_v2_set_bass_enabled(on);dsp.mvp_v2_set_impact_enabled(on);dsp.mvp_v2_set_clarity_enabled(on);dsp.mvp_v2_set_spatial_enabled(on);dsp.mvp_v2_reset_meters();const o=renderCurrent(program,.55);toggle.push({c,on,r:rmsStereo(o),width:o.width,bass:o.bass,impact:o.impact,clarity:o.clarity})}
}
gate('Effects remain active after 10 OFF/ON cycles',()=>{for(const x of toggle.filter(x=>x.on===1)){assert.ok(x.width>125);assert.ok(x.bass>.1);assert.ok(x.impact>.1);assert.ok(x.clarity>.1)}});
gate('Effects return cleanly OFF after 10 cycles',()=>{for(const x of toggle.filter(x=>x.on===0)){assert.ok(x.width<=100.01);assert.ok(x.bass<=.01);assert.ok(x.impact<=.01);assert.ok(x.clarity<=.01)}});

// Profile switching without reset should not invalidate the processor.
dsp.mvp_v2_set_bass_enabled(0);dsp.mvp_v2_set_impact_enabled(0);dsp.mvp_v2_set_clarity_enabled(0);dsp.mvp_v2_set_spatial_enabled(0);const profiles=[];
for(let c=0;c<8;c++) for(const p of [1,2,0,1]){dsp.mvp_v2_set_output_profile(p);dsp.mvp_v2_reset_meters();const o=renderCurrent(program,.5);profiles.push({c,p,r:rmsStereo(o),clips:o.clips,nans:o.nans})}
gate('Repeated Headphones/Bluetooth/Car profile switching is stable',()=>{for(const p of [0,1,2]){const x=profiles.filter(q=>q.p===p).map(q=>q.r);assert.ok(spreadDb(x)<=.20,`profile ${p}: ${spreadDb(x).toFixed(3)} dB`)}});
gate('Profile-switch stress has 0 clips / 0 NaNs',()=>{for(const x of profiles){assert.equal(x.clips,0);assert.equal(x.nans,0)}});

// Release test: hard torture then quiet program, limiter must release rather than stay clamped.
configure({mode:2,intensity:1,profile:2,bass:true,impact:true,clarity:true,spatial:true});renderCurrent((i,sr)=>{const t=i/sr;return[.95*Math.sin(2*Math.PI*90*t)+.75*Math.sin(2*Math.PI*1000*t),.94*Math.sin(2*Math.PI*90*t+.1)+.74*Math.sin(2*Math.PI*1000*t+.3)]},1.2);dsp.mvp_v2_reset_meters();const released=renderCurrent(corpus('rock','dynamic'),1.5);
gate('Limiter releases after overload instead of staying clamped',()=>assert.ok(released.limiter<=2.0,`${released.limiter.toFixed(2)} dB max GR after release window`));

// Performance: process 30 seconds of stereo PCM and require generous >4x real-time headroom on this runner.
configure({mode:2,intensity:1,profile:2,bass:true,impact:true,clarity:true,spatial:true});const blocks=Math.ceil(30*SR/frames),gperf=corpus('hardrock','hot');let sample=0;const t0=performance.now();for(let b=0;b<blocks;b++){for(let i=0;i<frames;i++){const [l,r]=gperf(sample++,SR);inL[i]=l;inR[i]=r}assert.equal(dsp.mvp_v2_process(frames),1)}const elapsed=(performance.now()-t0)/1000,rt=30/elapsed;
gate('WASM performance has >4x real-time headroom',()=>assert.ok(rt>=4,`${rt.toFixed(1)}x`));

const anyBad=corpusMetrics.some(x=>x.clips||x.nans);
gate('Entire 13-case music corpus has 0 clips / 0 NaNs',()=>assert.equal(anyBad,false));

console.log('\n=== V5 CORPUS ===');
for(const x of corpusMetrics) console.log(`${x.genre.padEnd(10)} ${x.level.padEnd(12)} A ${x.adaptive.toFixed(2).padStart(6)} dB  P ${x.power.toFixed(2).padStart(6)} dB  P-A ${x.powerOverAdaptive.toFixed(2).padStart(6)} dB  meter ${x.tp.toFixed(2).padStart(6)} dBTP  lim ${x.limiter.toFixed(2).padStart(5)} dB`);
console.log(`Independent 8x torture peak: ${extTp.toFixed(3)} dBTP`);
console.log(`Performance: ${rt.toFixed(1)}x real time (${elapsed.toFixed(3)} s for 30 s audio)`);
const passed=results.filter(x=>x.ok).length; console.log(`\nMVP Broadcast Engine V5.1 validation: ${passed}/${results.length} PASS`); if(passed!==results.length) process.exitCode=1;
