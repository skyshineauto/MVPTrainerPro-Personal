import fs from "node:fs";
import vm from "node:vm";

const workletPath = process.argv[2] || "public/audio/mvpSoundModes-r19.worklet.js";
const code = fs.readFileSync(workletPath, "utf8");
let Processor = null;

class StubProcessor {
  constructor() {
    this.posted = [];
    this.port = {
      onmessage: null,
      postMessage: (message) => this.posted.push(message),
    };
  }
}

const sr = 48000;
vm.runInNewContext(code, {
  AudioWorkletProcessor: StubProcessor,
  registerProcessor: (name, klass) => {
    if (name !== "mvp-sound-modes") throw new Error(`Unexpected processor ${name}`);
    Processor = klass;
  },
  sampleRate: sr,
  Float32Array,
  Math,
  Object,
});
if (!Processor) throw new Error("R19 worklet did not register");

const db = (value) => 20 * Math.log10(Math.max(1e-12, value));
const profiles = {
  dynamic: { rmsDb:-16,truePeakDbtp:-1.4,crestFactorDb:12,dynamicRangeDb:12,bassExtension:50,lowMidBuildup:50,presenceBalance:50,harshness:40,sibilance:40,hfRolloff:50,transientStrength:70,correlation:.7,phaseRisk:false,sourceGainDb:.2,lowMidDb:0,presenceDb:0,harshnessDb:0 },
  normal: { rmsDb:-12.5,truePeakDbtp:-1,crestFactorDb:8.5,dynamicRangeDb:8.5,bassExtension:54,lowMidBuildup:52,presenceBalance:50,harshness:45,sibilance:45,hfRolloff:50,transientStrength:60,correlation:.75,phaseRisk:false,sourceGainDb:.2,lowMidDb:0,presenceDb:0,harshnessDb:0 },
  hot: { rmsDb:-9.4,truePeakDbtp:-.3,crestFactorDb:7,dynamicRangeDb:6.5,bassExtension:66,lowMidBuildup:62,presenceBalance:52,harshness:54,sibilance:50,hfRolloff:46,transientStrength:50,correlation:.78,phaseRisk:false,sourceGainDb:.1,lowMidDb:0,presenceDb:0,harshnessDb:0 },
  brick: { rmsDb:-7.5,truePeakDbtp:-.1,crestFactorDb:5.3,dynamicRangeDb:4.5,bassExtension:60,lowMidBuildup:58,presenceBalance:50,harshness:52,sibilance:50,hfRolloff:48,transientStrength:35,correlation:.8,phaseRisk:false,sourceGainDb:0,lowMidDb:0,presenceDb:0,harshnessDb:0 },
  bass: { rmsDb:-11.8,truePeakDbtp:-.8,crestFactorDb:8,dynamicRangeDb:8,bassExtension:78,lowMidBuildup:66,presenceBalance:48,harshness:42,sibilance:40,hfRolloff:52,transientStrength:58,correlation:.8,phaseRisk:false,sourceGainDb:.15,lowMidDb:-.2,presenceDb:0,harshnessDb:0 },
};

function processor(profile = profiles.normal) {
  const p = new Processor();
  p.port.onmessage?.({ data: { type:"track-profile", trackId:"fixture", profile } });
  return p;
}

function controls(p, patch = {}) {
  p.port.onmessage?.({
    data: {
      type: "user-controls",
      dimensionEnabled: patch.dimensionEnabled ?? true,
      eqBassDb: patch.eqBassDb ?? 0,
      eqMidsDb: patch.eqMidsDb ?? 0,
      eqTrebleDb: patch.eqTrebleDb ?? 0,
    },
  });
}

function signal(seconds, make) {
  const n = Math.round(sr * seconds);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [l, r] = make(i / sr, i);
    L[i] = l;
    R[i] = r;
  }
  return { L, R };
}

function program(kind, seconds) {
  let seed = 0x2468ace1;
  const noise = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0xffffffff * 2 - 1;
  };
  const scale = 0.075;
  return signal(seconds, (t) => {
    const low = kind === "bass" ? 0.46 : 0.25;
    const l = scale * (low*Math.sin(2*Math.PI*58*t)+.17*Math.sin(2*Math.PI*125*t)+.13*Math.sin(2*Math.PI*210*t)+.12*Math.sin(2*Math.PI*950*t)+.07*Math.sin(2*Math.PI*3200*t)+.025*noise());
    const r = scale * (low*.96*Math.sin(2*Math.PI*58*t+.02)+.16*Math.sin(2*Math.PI*125*t+.09)+.12*Math.sin(2*Math.PI*210*t+.04)+.115*Math.sin(2*Math.PI*950*t+.14)+.065*Math.sin(2*Math.PI*3200*t+.3)+.025*noise());
    return [l, r];
  });
}

function render(p, sig, start, end, mode, generation) {
  p.port.onmessage?.({ data: { type:"mode", mode, generation } });
  const n = end - start;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let off = start, out = 0; off < end; off += 128, out += 128) {
    const size = Math.min(128, end - off);
    const a = new Float32Array(128);
    const b = new Float32Array(128);
    const c = new Float32Array(128);
    const d = new Float32Array(128);
    a.set(sig.L.subarray(off, off + size));
    b.set(sig.R.subarray(off, off + size));
    p.process([[a,b]], [[c,d]]);
    L.set(c.subarray(0,size), out);
    R.set(d.subarray(0,size), out);
  }
  return { L, R };
}

function slice(sig, start, end = sig.L.length) {
  return { L:sig.L.subarray(start,end), R:sig.R.subarray(start,end) };
}

function rms(sig) {
  let sum = 0, n = 0;
  for (let i = 0; i < sig.L.length; i++) {
    sum += sig.L[i]*sig.L[i] + sig.R[i]*sig.R[i];
    n += 2;
  }
  return Math.sqrt(sum / Math.max(1,n));
}

function sideRms(sig) {
  let sum = 0;
  for (let i = 0; i < sig.L.length; i++) {
    const side = (sig.L[i] - sig.R[i]) * 0.5;
    sum += side * side;
  }
  return Math.sqrt(sum / Math.max(1,sig.L.length));
}

function midRms(sig) {
  let sum = 0;
  for (let i = 0; i < sig.L.length; i++) {
    const mid = (sig.L[i] + sig.R[i]) * 0.5;
    sum += mid * mid;
  }
  return Math.sqrt(sum / Math.max(1,sig.L.length));
}

function maxError(a,b) {
  let e = 0;
  const n = Math.min(a.L.length,b.L.length);
  for (let i = 0; i < n; i++) {
    e = Math.max(e, Math.abs(a.L[i]-b.L[i]), Math.abs(a.R[i]-b.R[i]));
  }
  return e;
}

const rows = [];
function check(name, pass, detail = {}) {
  rows.push({name,pass,detail});
  console.log(pass ? "PASS" : "FAIL", name, detail);
}

check("R19 has no compressor stage", !code.includes("compGain") && !code.includes("compressionDb") && !code.includes("thresholdDb"), {});
check("R19 has no limiter stage", !code.includes("limiterGain") && !code.includes("lookaheadFrames") && !code.includes("limiterReleaseCoeff"), {});
check("R19 direct gain remains explicit", code.includes("l *= settings.gain") && code.includes("r *= settings.gain"), {});
check("R19 Dimension is Mid/Side without delay", code.includes("const mid = (l + r) * 0.5") && code.includes("const side = (l - r) * 0.5") && !code.includes("delayTime"), {});
check("R19 STRONG Dimension constants are installed", code.includes('const width = mode === "power" ? 1.65 : 1.35') && code.includes('const lowWidth = mode === "power" ? 0.10 : 0.30') && code.includes('const centerFocus = mode === "power" ? 1.06 : 1.03'), {});

{
  const p = processor();
  controls(p, { dimensionEnabled:true });
  const sig = program("normal", 2);
  const out = render(p,sig,0,sig.L.length,"pure",1);
  check("PURE remains sample-exact with flat EQ", maxError(out,sig) < 1e-7, { maxError:maxError(out,sig) });
}

const targets = {
  dynamic:{a:4.0,p:7.2,step:3.0},
  normal:{a:3.6,p:6.7,step:2.9},
  hot:{a:3.1,p:6.1,step:2.8},
  brick:{a:2.8,p:5.6,step:2.6},
  bass:{a:2.9,p:5.7,step:2.6},
};

for (const kind of Object.keys(targets)) {
  const t = targets[kind];
  const sig = program(kind, 6);
  const p = processor(profiles[kind]);
  controls(p,{dimensionEnabled:true});
  const block = sr*2;
  const settle = Math.round(sr*.4);
  render(p,sig,0,block,"pure",1);
  const a = render(p,sig,block,block*2,"adaptive",2);
  const pw = render(p,sig,block*2,block*3,"power",3);
  const ai = slice(sig,block+settle,block*2);
  const pi = slice(sig,block*2+settle,block*3);
  const ao = slice(a,settle);
  const po = slice(pw,settle);
  const adb = db(rms(ao)/rms(ai));
  const pdb = db(rms(po)/rms(pi));
  check(`${kind} ADAPTIVE stays clearly louder`,adb>t.a,{netDb:+adb.toFixed(2)});
  check(`${kind} POWER stays clearly louder`,pdb>t.p,{netDb:+pdb.toFixed(2)});
  check(`${kind} POWER stays above ADAPTIVE`,pdb-adb>t.step,{stepDb:+(pdb-adb).toFixed(2)});
}

{
  const sig = signal(2,(t)=>{
    const x=.04*Math.sin(2*Math.PI*2200*t);
    return [x,-x];
  });
  const off = processor(); controls(off,{dimensionEnabled:false});
  const on = processor(); controls(on,{dimensionEnabled:true});
  const offOut = render(off,sig,0,sig.L.length,"power",1);
  const onOut = render(on,sig,0,sig.L.length,"power",1);
  const start=Math.round(sr*.4);
  const ratio=sideRms(slice(onOut,start))/sideRms(slice(offOut,start));
  check("MVP DIMENSION strongly expands high-frequency sides",ratio>1.52&&ratio<1.74,{sideRatio:+ratio.toFixed(3)});
}

{
  const sig = signal(2,(t)=>{
    const x=.04*Math.sin(2*Math.PI*60*t);
    return [x,-x];
  });
  const off = processor(); controls(off,{dimensionEnabled:false});
  const on = processor(); controls(on,{dimensionEnabled:true});
  const offOut = render(off,sig,0,sig.L.length,"power",1);
  const onOut = render(on,sig,0,sig.L.length,"power",1);
  const start=Math.round(sr*.5);
  const ratio=sideRms(slice(onOut,start))/sideRms(slice(offOut,start));
  check("MVP DIMENSION strongly centers low-end width",ratio<0.50,{lowSideRatio:+ratio.toFixed(3)});
}

{
  const sig = signal(2,(t)=>{
    const x=.04*Math.sin(2*Math.PI*1000*t);
    return [x,x];
  });
  const p=processor(); controls(p,{dimensionEnabled:true});
  const out=render(p,sig,0,sig.L.length,"power",1);
  let difference=0;
  for(let i=Math.round(sr*.4);i<out.L.length;i++) difference=Math.max(difference,Math.abs(out.L[i]-out.R[i]));
  check("MVP DIMENSION keeps centered mono content centered",difference<1e-7,{maxLRDifference:difference,midRms:+midRms(out).toFixed(5)});
}

function toneEqLift(frequency, band) {
  const sig=signal(2,(t)=>{const x=.03*Math.sin(2*Math.PI*frequency*t);return[x,x]});
  const flat=processor(); controls(flat,{dimensionEnabled:false});
  const boosted=processor(); controls(boosted,{dimensionEnabled:false,[band]:6});
  const a=render(flat,sig,0,sig.L.length,"pure",1);
  const b=render(boosted,sig,0,sig.L.length,"pure",1);
  const start=Math.round(sr*.5);
  return db(rms(slice(b,start))/rms(slice(a,start)));
}
check("BASS EQ +6 dB produces strong bass lift",toneEqLift(50,"eqBassDb")>4.7,{liftDb:+toneEqLift(50,"eqBassDb").toFixed(2)});
check("MIDS EQ +6 dB produces strong mid lift",toneEqLift(1200,"eqMidsDb")>5.5,{liftDb:+toneEqLift(1200,"eqMidsDb").toFixed(2)});
check("TREBLE EQ +6 dB produces strong treble lift",toneEqLift(14000,"eqTrebleDb")>4.7,{liftDb:+toneEqLift(14000,"eqTrebleDb").toFixed(2)});

{
  const p=processor();controls(p,{eqBassDb:99,eqMidsDb:-99,eqTrebleDb:99});
  check("EQ controls clamp to ±6 dB",p.user.eqBassDb===6&&p.user.eqMidsDb===-6&&p.user.eqTrebleDb===6,p.user);
}

{
  const sig=program("hot",32),p=processor(profiles.hot);controls(p,{dimensionEnabled:true});
  const block=sr*2,settle=Math.round(sr*.4),sequence=["power","pure","adaptive","power","power","pure","adaptive","power","power","pure","adaptive","power","power","pure","adaptive","power"];
  let g=0,powers=[],pureWorst=0,adaptiveMin=Infinity;
  for(let j=0;j<sequence.length;j++){
    const mode=sequence[j],start=j*block,end=start+block,out=render(p,sig,start,end,mode,++g),os=slice(out,settle),ins=slice(sig,start+settle,end);
    if(mode==="pure")pureWorst=Math.max(pureWorst,maxError(os,ins));
    if(mode==="adaptive")adaptiveMin=Math.min(adaptiveMin,db(rms(os)/rms(ins)));
    if(mode==="power")powers.push(db(rms(os)/rms(ins)));
  }
  check("32s switching keeps PURE exact",pureWorst<1e-7,{pureWorst});
  check("32s switching keeps ADAPTIVE loud",adaptiveMin>3.1,{adaptiveMin:+adaptiveMin.toFixed(2)});
  check("32s switching keeps POWER loud",Math.min(...powers)>6.1,{powers:powers.map(v=>+v.toFixed(2))});
  check("later POWER never collapses",Math.max(...powers)-Math.min(...powers)<.08,{spreadDb:+(Math.max(...powers)-Math.min(...powers)).toFixed(3)});
}

if (fs.existsSync("src/lib/musicPlayer.ts")) {
  const source=fs.readFileSync("src/lib/musicPlayer.ts","utf8");
  check("player uses R19 Worklet route",source.includes("/audio/mvpSoundModes-r19.worklet.js"),{});
  check("player persists Dimension and simple EQ",source.includes("soundDimensionEnabled")&&source.includes("soundEqBassDb")&&source.includes("setMusicEqBand"),{});
  check("Song IQ remains wired",source.includes("getMusicTrackIntelligence")&&source.includes("audioAnalysis")&&source.includes("masterPrep"),{});
}
if (fs.existsSync("src/features/music/MusicMiniPlayer.tsx")) {
  const source=fs.readFileSync("src/features/music/MusicMiniPlayer.tsx","utf8");
  check("UI contains MVP DIMENSION",source.includes("MVP DIMENSION"),{});
  check("UI contains BASS MIDS TREBLE EQ",source.includes("BASS")&&source.includes("MIDS")&&source.includes("TREBLE")&&source.includes("FLAT"),{});
}

const failed=rows.filter(row=>!row.pass);
console.log(`\n${rows.length-failed.length}/${rows.length} PASS`);
if(failed.length){console.error("FAILED:",failed.map(row=>row.name).join(", "));process.exit(1);}
