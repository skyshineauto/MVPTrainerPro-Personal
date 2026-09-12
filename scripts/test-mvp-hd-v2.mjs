import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const wasmPath = path.join(root, 'public', 'audioV2', 'mvpHdV2.wasm');
const bytes = fs.readFileSync(wasmPath);
const imports = {
  env: {
    sin: Math.sin,
    cos: Math.cos,
    pow: Math.pow,
    exp: Math.exp,
    log10: Math.log10,
  },
};
const { instance } = await WebAssembly.instantiate(bytes, imports);
const dsp = instance.exports;
assert.equal(dsp.mvp_v2_init(48000), 1, 'V2 init failed');
assert.equal(dsp.mvp_v2_max_frames(), 128, 'Unexpected render quantum');

const memory = dsp.memory;
const frames = dsp.mvp_v2_max_frames();
const inL = new Float32Array(memory.buffer, Number(dsp.mvp_v2_input_l()), frames);
const inR = new Float32Array(memory.buffer, Number(dsp.mvp_v2_input_r()), frames);
const outL = new Float32Array(memory.buffer, Number(dsp.mvp_v2_output_l()), frames);
const outR = new Float32Array(memory.buffer, Number(dsp.mvp_v2_output_r()), frames);

const SR = 48000;
const WARMUP = 4096;

function resetConfig({ bypass=0, mode=0, bass=0, clarity=0, punch=0, wide=0, eq=false } = {}) {
  dsp.mvp_v2_reset();
  dsp.mvp_v2_set_bypass(bypass ? 1 : 0);
  dsp.mvp_v2_set_loudness_mode(mode);
  dsp.mvp_v2_set_bass(bass);
  dsp.mvp_v2_set_clarity(clarity);
  dsp.mvp_v2_set_punch(punch);
  dsp.mvp_v2_set_wide(wide);
  dsp.mvp_v2_set_eq_enabled(eq ? 1 : 0);
  for (let i = 0; i < 31; i++) dsp.mvp_v2_set_eq_band(i, 0);
}

function render(config, generator, seconds=2.0) {
  resetConfig(config);
  const total = Math.ceil(seconds * SR / frames) * frames;
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  let pos = 0;
  while (pos < total) {
    for (let i = 0; i < frames; i++) {
      const [l, r] = generator(pos + i, SR);
      inL[i] = l;
      inR[i] = r;
    }
    assert.equal(dsp.mvp_v2_process(frames), 1, 'V2 process failed');
    L.set(outL, pos);
    R.set(outR, pos);
    pos += frames;
  }
  return {
    L, R,
    truePeakDbtp: Number(dsp.mvp_v2_meter_true_peak_dbtp()),
    limiterGrDb: Number(dsp.mvp_v2_meter_limiter_gr_db()),
    clipCount: Number(dsp.mvp_v2_meter_clip_count()),
    nanCount: Number(dsp.mvp_v2_meter_nan_count()),
  };
}

function rmsStereo(result, start=WARMUP) {
  let e = 0, n = 0;
  for (let i=start; i<result.L.length; i++) {
    e += 0.5 * (result.L[i]*result.L[i] + result.R[i]*result.R[i]);
    n++;
  }
  return Math.sqrt(e / Math.max(1,n));
}
function dbRatio(a,b) { return 20 * Math.log10(Math.max(a,1e-12)/Math.max(b,1e-12)); }
function maxAbs(result, start=WARMUP) {
  let m=0;
  for (let i=start;i<result.L.length;i++) m=Math.max(m,Math.abs(result.L[i]),Math.abs(result.R[i]));
  return m;
}
function cubic(p0,p1,p2,p3,t) {
  const a0=-0.5*p0+1.5*p1-1.5*p2+0.5*p3;
  const a1=p0-2.5*p1+2*p2-0.5*p3;
  const a2=-0.5*p0+0.5*p2;
  return ((a0*t+a1)*t+a2)*t+p1;
}
function reconstructedPeak8x(ch) {
  let peak=0;
  for (let i=Math.max(1,WARMUP); i<ch.length-2; i++) {
    const p0=ch[i-1], p1=ch[i], p2=ch[i+1], p3=ch[i+2];
    peak=Math.max(peak,Math.abs(p1));
    for (let k=1;k<8;k++) peak=Math.max(peak,Math.abs(cubic(p0,p1,p2,p3,k/8)));
  }
  return peak;
}
function stereoTruePeakDb(result) {
  const p=Math.max(reconstructedPeak8x(result.L),reconstructedPeak8x(result.R));
  return 20*Math.log10(Math.max(p,1e-12));
}
function goertzel(ch, freq, start=WARMUP, count=32768) {
  const n=Math.min(count,ch.length-start);
  const w=2*Math.PI*freq/SR;
  const coeff=2*Math.cos(w);
  let s0=0,s1=0,s2=0;
  for(let i=0;i<n;i++) { s0=ch[start+i]+coeff*s1-s2; s2=s1; s1=s0; }
  const power=s1*s1+s2*s2-coeff*s1*s2;
  return Math.sqrt(Math.max(0,power))/Math.max(1,n);
}
function sideMidRatio(result,start=WARMUP) {
  let me=0,se=0,n=0;
  for(let i=start;i<result.L.length;i++){
    const m=0.5*(result.L[i]+result.R[i]);
    const s=0.5*(result.L[i]-result.R[i]);
    me+=m*m; se+=s*s; n++;
  }
  return Math.sqrt(se/Math.max(1,n))/Math.max(1e-12,Math.sqrt(me/Math.max(1,n)));
}

const program = (i,sr) => {
  const t=i/sr;
  const env=(i%2400)<300?1.0:0.72;
  return [
    env*(0.14*Math.sin(2*Math.PI*83*t)+0.13*Math.sin(2*Math.PI*997*t)+0.055*Math.sin(2*Math.PI*6773*t)),
    env*(0.135*Math.sin(2*Math.PI*83*t+0.04)+0.125*Math.sin(2*Math.PI*997*t+0.21)+0.05*Math.sin(2*Math.PI*6773*t+0.51)),
  ];
};

const direct = render({bypass:1,mode:0}, program);
const normal = render({bypass:0,mode:0}, program);
const loud = render({bypass:0,mode:1}, program);
const maxed = render({bypass:0,mode:2}, program);
const rDirect=rmsStereo(direct), rNormal=rmsStereo(normal), rLoud=rmsStereo(loud), rMax=rmsStereo(maxed);
const normalDelta=dbRatio(rNormal,rDirect);
const loudLift=dbRatio(rLoud,rNormal);
const maxOverLoud=dbRatio(rMax,rLoud);
const maxLift=dbRatio(rMax,rNormal);
console.log({normalDelta,loudLift,maxOverLoud,maxLift, direct:rDirect,normal:rNormal,loud:rLoud,max:rMax});
assert.ok(Math.abs(normalDelta)<=0.15,`NORMAL vs DIRECT ${normalDelta.toFixed(2)} dB`);
assert.ok(loudLift>=1.5,`LOUD lift only ${loudLift.toFixed(2)} dB`);
assert.ok(maxOverLoud>=2.5,`MAX over LOUD only ${maxOverLoud.toFixed(2)} dB`);
assert.ok(maxLift>=4.0,`MAX over NORMAL only ${maxLift.toFixed(2)} dB`);

// Already-mastered program: headroom is smaller, but MAX must still be
// unmistakably above LOUD instead of collapsing to the same output.
const masteredProgram = (i,sr) => {
  const t=i/sr;
  const env=(i%2400)<250?1.0:0.82;
  return [
    env*(0.34*Math.sin(2*Math.PI*83*t)+0.29*Math.sin(2*Math.PI*997*t)+0.12*Math.sin(2*Math.PI*6773*t)),
    env*(0.33*Math.sin(2*Math.PI*83*t+0.04)+0.28*Math.sin(2*Math.PI*997*t+0.21)+0.11*Math.sin(2*Math.PI*6773*t+0.51)),
  ];
};
const masteredNormal=render({bypass:0,mode:0},masteredProgram);
const masteredLoud=render({bypass:0,mode:1},masteredProgram);
const masteredMax=render({bypass:0,mode:2},masteredProgram);
const masteredLoudLift=dbRatio(rmsStereo(masteredLoud),rmsStereo(masteredNormal));
const masteredMaxLift=dbRatio(rmsStereo(masteredMax),rmsStereo(masteredNormal));
const masteredJump=dbRatio(rmsStereo(masteredMax),rmsStereo(masteredLoud));
console.log({masteredLoudLift,masteredMaxLift,masteredJump,masteredMaxLimiterGr:masteredMax.limiterGrDb});
assert.ok(masteredLoudLift>=1.5,`LOUD does not lift an already-mastered program enough: ${masteredLoudLift.toFixed(2)} dB`);
assert.ok(masteredMaxLift>=3.5,`MAX does not materially lift an already-mastered program: ${masteredMaxLift.toFixed(2)} dB`);
assert.ok(masteredJump>=1.25,`MAX collapses toward LOUD on an already-mastered program: ${masteredJump.toFixed(2)} dB`);
assert.equal(masteredMax.clipCount,0,'Mastered-program clipping detected');
assert.equal(masteredMax.nanCount,0,'Mastered-program NaN/Inf detected');

// Hot/crest-heavy safety render.
const hot = render({bypass:0,mode:2}, (i,sr)=>{
  const t=i/sr;
  const impulse=(i%4096)<24?0.98:0;
  return [0.62*Math.sin(2*Math.PI*997*t)+0.22*Math.sin(2*Math.PI*3100*t)+impulse,
          0.60*Math.sin(2*Math.PI*997*t+0.13)+0.20*Math.sin(2*Math.PI*3100*t+0.31)+impulse*0.96];
},2.5);
const hotTp=stereoTruePeakDb(hot);
console.log({hotTp, meterTp:hot.truePeakDbtp, limiterGr:hot.limiterGrDb, clipCount:hot.clipCount,nanCount:hot.nanCount,maxSample:maxAbs(hot)});
assert.ok(hotTp<=-0.10+0.03,`Reconstructed true peak too high ${hotTp.toFixed(2)} dBTP`);
assert.equal(hot.clipCount,0,'Digital clipping detected');
assert.equal(hot.nanCount,0,'NaN/Inf detected');

// 31-band EQ sanity: a +6 dB 1 kHz band must be plainly measurable.
function renderEq1k(gainDb) {
  resetConfig({bypass:0,mode:0,eq:true});
  dsp.mvp_v2_set_eq_band(17,gainDb); // 1000 Hz band.
  const total=Math.ceil(2.0*SR/frames)*frames;
  const L=new Float32Array(total),R=new Float32Array(total);
  let pos=0;
  while(pos<total){
    for(let i=0;i<frames;i++){const t=(pos+i)/SR; const x=0.08*Math.sin(2*Math.PI*1000*t); inL[i]=x; inR[i]=x;}
    assert.equal(dsp.mvp_v2_process(frames),1,'V2 EQ process failed');
    L.set(outL,pos);R.set(outR,pos);pos+=frames;
  }
  return {L,R};
}
const eqFlat=renderEq1k(0);
const eqBoost=renderEq1k(6);
const eq1kLift=dbRatio(goertzel(eqBoost.L,1000),goertzel(eqFlat.L,1000));
console.log({eq1kLift});
assert.ok(eq1kLift>=4.5,`31-band EQ 1 kHz +6 dB produced only ${eq1kLift.toFixed(2)} dB`);

// Bass isolation: 80 Hz rises, 1 kHz stays nearly unchanged.
const bassSignal=(i,sr)=>{const t=i/sr; const x=0.10*Math.sin(2*Math.PI*80*t)+0.10*Math.sin(2*Math.PI*1000*t); return [x,x];};
const bassOff=render({bypass:0,mode:0},bassSignal);
const bassOn=render({bypass:0,mode:0,bass:1},bassSignal);
const bass80=dbRatio(goertzel(bassOn.L,80),goertzel(bassOff.L,80));
const bass1k=dbRatio(goertzel(bassOn.L,1000),goertzel(bassOff.L,1000));
console.log({bass80,bass1k});
assert.ok(bass80>=1.5,`Bass module low-band lift only ${bass80.toFixed(2)} dB`);
assert.ok(Math.abs(bass1k)<=0.45,`Bass module changed 1k by ${bass1k.toFixed(2)} dB`);

// Clarity isolation: 9 kHz rises, 1 kHz stays nearly unchanged.
const claritySignal=(i,sr)=>{const t=i/sr; const x=0.08*Math.sin(2*Math.PI*1000*t)+0.06*Math.sin(2*Math.PI*9000*t); return [x,x];};
const clarityOff=render({bypass:0,mode:0},claritySignal);
const clarityOn=render({bypass:0,mode:0,clarity:1},claritySignal);
const clarity9k=dbRatio(goertzel(clarityOn.L,9000),goertzel(clarityOff.L,9000));
const clarity1k=dbRatio(goertzel(clarityOn.L,1000),goertzel(clarityOff.L,1000));
console.log({clarity9k,clarity1k});
assert.ok(clarity9k>=1.0,`Clarity module 9k lift only ${clarity9k.toFixed(2)} dB`);
assert.ok(Math.abs(clarity1k)<=0.25,`Clarity module changed 1k by ${clarity1k.toFixed(2)} dB`);

// Wide must increase side/mid ratio without destabilizing output.
const stereoSignal=(i,sr)=>{const t=i/sr; return [0.12*Math.sin(2*Math.PI*500*t)+0.08*Math.sin(2*Math.PI*3000*t),0.12*Math.sin(2*Math.PI*500*t+0.45)+0.08*Math.sin(2*Math.PI*3000*t+1.1)];};
const wideOff=render({bypass:0,mode:0},stereoSignal);
const wideOn=render({bypass:0,mode:0,wide:1},stereoSignal);
const wideLift=sideMidRatio(wideOn)/sideMidRatio(wideOff);
console.log({wideOff:sideMidRatio(wideOff),wideOn:sideMidRatio(wideOn),wideLift});
assert.ok(wideLift>=1.12,`WIDE side expansion only ${wideLift.toFixed(3)}x`);

// Punch must raise onset energy relative to sustained energy.
const pulseSignal=(i,sr)=>{const p=i%4800; const a=p<240?0.30:0.10; const x=a*Math.sin(2*Math.PI*180*t(i,sr)); return [x,x];};
function t(i,sr){return i/sr;}
const punchOff=render({bypass:0,mode:0},pulseSignal,2.5);
const punchOn=render({bypass:0,mode:0,punch:1},pulseSignal,2.5);
function onsetRatio(result){let oe=0,se=0,on=0,sn=0; for(let i=WARMUP;i<result.L.length;i++){const p=i%4800; const x=0.5*(result.L[i]+result.R[i]); if(p<240){oe+=x*x;on++;} else if(p>1200&&p<3600){se+=x*x;sn++;}} return Math.sqrt(oe/Math.max(1,on))/Math.max(1e-12,Math.sqrt(se/Math.max(1,sn)));}
const punchLift=onsetRatio(punchOn)/onsetRatio(punchOff);
console.log({punchOff:onsetRatio(punchOff),punchOn:onsetRatio(punchOn),punchLift});
assert.ok(punchLift>=1.03,`Punch onset lift only ${punchLift.toFixed(3)}x`);

// All visible modules together at MAX must stay finite and within the true-peak ceiling.
const allOn=render({bypass:0,mode:2,bass:1,clarity:1,punch:1,wide:1},program,2.5);
const allTp=stereoTruePeakDb(allOn);
console.log({allTp,meterTp:allOn.truePeakDbtp,limiterGr:allOn.limiterGrDb,clipCount:allOn.clipCount,nanCount:allOn.nanCount});
assert.ok(allTp<=-0.10+0.03,`All-effects true peak too high ${allTp.toFixed(2)} dBTP`);
assert.equal(allOn.clipCount,0,'All-effects clipping detected');
assert.equal(allOn.nanCount,0,'All-effects NaN/Inf detected');

console.log('MVP HD V2 raw PCM validation: PASS');
