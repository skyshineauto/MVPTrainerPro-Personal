import fs from "node:fs";
import vm from "node:vm";

const workletPath = process.argv[2] || "public/audio/mvpSoundModes-r21.worklet.js";
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
if (!Processor) throw new Error("R21 worklet did not register");

const db = (value) => 20 * Math.log10(Math.max(1e-12, value));

const normalProfile = {
  rmsDb:-12.5,truePeakDbtp:-1,crestFactorDb:8.5,dynamicRangeDb:8.5,
  bassExtension:54,lowMidBuildup:52,presenceBalance:50,harshness:45,
  sibilance:45,hfRolloff:50,transientStrength:60,correlation:.75,
  phaseRisk:false,sourceGainDb:.2,lowMidDb:0,presenceDb:0,harshnessDb:0
};

function processor(profile = normalProfile) {
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

function program(seconds) {
  return signal(seconds, (t) => {
    const center =
      .033*Math.sin(2*Math.PI*180*t) +
      .028*Math.sin(2*Math.PI*900*t) +
      .024*Math.sin(2*Math.PI*2200*t);
    const side =
      .014*Math.sin(2*Math.PI*1250*t) +
      .011*Math.sin(2*Math.PI*3600*t);
    return [center + side, center - side];
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
  rows.push({name, pass, detail});
  console.log(pass ? "PASS" : "FAIL", name, detail);
}

check("R21 has no compressor", !/\b(compGain|compressionDb|thresholdDb|ratio)\b/.test(code), {});
check("R21 has no limiter", !/\b(limiterGain|lookaheadFrames|limiterReleaseCoeff)\b/.test(code), {});
check("R21 keeps direct gain", code.includes("l *= settings.gain") && code.includes("r *= settings.gain"), {});
check(
  "R21 DIMENSION MAX constants installed",
  code.includes('const width = mode === "power" ? 2.45 : 1.75') &&
  code.includes('const spatialMix = mode === "power" ? 0.74 : 0.42') &&
  code.includes('const lowWidth = mode === "power" ? 0.03 : 0.15') &&
  code.includes('const centerFocus = mode === "power" ? 1.05 : 1.025'),
  {}
);

{
  const p = processor();
  controls(p, { dimensionEnabled:true });
  const sig = program(2);
  const out = render(p, sig, 0, sig.L.length, "pure", 1);
  check("PURE stays exact with flat EQ", maxError(out, sig) < 1e-7, { maxError:maxError(out,sig) });
}

{
  const sig = signal(2, (t) => {
    const x = .04*Math.sin(2*Math.PI*2200*t);
    return [x, -x];
  });
  const off = processor(); controls(off, { dimensionEnabled:false });
  const on = processor(); controls(on, { dimensionEnabled:true });
  const offOut = render(off, sig, 0, sig.L.length, "power", 1);
  const onOut = render(on, sig, 0, sig.L.length, "power", 1);
  const start = Math.round(sr*.5);
  const ratio = sideRms(slice(onOut,start)) / sideRms(slice(offOut,start));
  check("DIMENSION MAX makes existing sides enormous", ratio > 2.40 && ratio < 2.80, { sideRatio:+ratio.toFixed(3) });
}

{
  const sig = signal(2, (t) => {
    const x = .04*Math.sin(2*Math.PI*2200*t);
    return [x, x];
  });
  const off = processor(); controls(off, { dimensionEnabled:false });
  const on = processor(); controls(on, { dimensionEnabled:true });
  const offOut = render(off, sig, 0, sig.L.length, "power", 1);
  const onOut = render(on, sig, 0, sig.L.length, "power", 1);
  const start = Math.round(sr*.5);
  const offSteady = slice(offOut,start);
  const onSteady = slice(onOut,start);
  const sideToMid = sideRms(onSteady) / Math.max(1e-12, midRms(onSteady));
  const centerChangeDb = db(midRms(onSteady) / Math.max(1e-12, midRms(offSteady)));
  check("DIMENSION MAX creates huge side space from center-heavy material", sideToMid > 0.50, { sideToMid:+sideToMid.toFixed(3) });
  check("DIMENSION MAX keeps the center strong", centerChangeDb > 0 && centerChangeDb < 0.6, { centerChangeDb:+centerChangeDb.toFixed(3) });
}

{
  const sig = signal(2, (t) => {
    const x = .04*Math.sin(2*Math.PI*60*t);
    return [x, x];
  });
  const p = processor(); controls(p, { dimensionEnabled:true });
  const out = render(p, sig, 0, sig.L.length, "power", 1);
  const steady = slice(out, Math.round(sr*.5));
  const sideToMid = sideRms(steady) / Math.max(1e-12, midRms(steady));
  check("DIMENSION MAX does not synthesize stereo bass", sideToMid < 0.01, { bassSideToMid:+sideToMid.toFixed(4) });
}

{
  const sig = signal(2, (t) => {
    const x = .04*Math.sin(2*Math.PI*60*t);
    return [x, -x];
  });
  const off = processor(); controls(off, { dimensionEnabled:false });
  const on = processor(); controls(on, { dimensionEnabled:true });
  const offOut = render(off, sig, 0, sig.L.length, "power", 1);
  const onOut = render(on, sig, 0, sig.L.length, "power", 1);
  const start = Math.round(sr*.5);
  const ratio = sideRms(slice(onOut,start)) / sideRms(slice(offOut,start));
  check("DIMENSION MAX keeps deep bass width controlled", ratio < 0.46, { lowSideRatio:+ratio.toFixed(3) });
}

function eqLift(frequency, key) {
  const sig = signal(2, (t) => {
    const x = .03*Math.sin(2*Math.PI*frequency*t);
    return [x,x];
  });
  const flat = processor(); controls(flat, { dimensionEnabled:false });
  const boosted = processor(); controls(boosted, { dimensionEnabled:false, [key]:6 });
  const a = render(flat, sig, 0, sig.L.length, "pure", 1);
  const b = render(boosted, sig, 0, sig.L.length, "pure", 1);
  const start = Math.round(sr*.5);
  return db(rms(slice(b,start)) / rms(slice(a,start)));
}

check("BASS EQ unchanged", eqLift(50,"eqBassDb") > 4.7, { liftDb:+eqLift(50,"eqBassDb").toFixed(2) });
check("MIDS EQ unchanged", eqLift(1200,"eqMidsDb") > 5.5, { liftDb:+eqLift(1200,"eqMidsDb").toFixed(2) });
check("TREBLE EQ unchanged", eqLift(14000,"eqTrebleDb") > 4.7, { liftDb:+eqLift(14000,"eqTrebleDb").toFixed(2) });

{
  const sig = program(32);
  const p = processor();
  controls(p,{dimensionEnabled:true});
  const block = sr*2;
  const settle = Math.round(sr*.5);
  const sequence = ["power","pure","adaptive","power","power","pure","adaptive","power","power","pure","adaptive","power","power","pure","adaptive","power"];
  let generation = 0;
  let pureWorst = 0;
  let adaptiveMin = Infinity;
  const powers = [];

  for (let i = 0; i < sequence.length; i++) {
    const mode = sequence[i];
    const start = i*block;
    const end = start+block;
    const out = render(p,sig,start,end,mode,++generation);
    const steadyOut = slice(out,settle);
    const steadyIn = slice(sig,start+settle,end);
    if (mode === "pure") pureWorst = Math.max(pureWorst,maxError(steadyOut,steadyIn));
    if (mode === "adaptive") adaptiveMin = Math.min(adaptiveMin,db(rms(steadyOut)/rms(steadyIn)));
    if (mode === "power") powers.push(db(rms(steadyOut)/rms(steadyIn)));
  }

  check("32s switching keeps PURE exact", pureWorst < 1e-7, { pureWorst });
  check("32s switching keeps ADAPTIVE clearly louder", adaptiveMin > 3.2, { adaptiveMin:+adaptiveMin.toFixed(2) });
  check("32s switching keeps POWER clearly louder", Math.min(...powers) > 6.2, { powers:powers.map(v=>+v.toFixed(2)) });
  check("later POWER never collapses", Math.max(...powers)-Math.min(...powers) < .10, { spreadDb:+(Math.max(...powers)-Math.min(...powers)).toFixed(3) });
}

if (fs.existsSync("src/lib/musicPlayer.ts")) {
  const source = fs.readFileSync("src/lib/musicPlayer.ts","utf8");
  check("player uses R21 Worklet route", source.includes("/audio/mvpSoundModes-r21.worklet.js"), {});
  check("Dimension and EQ controls remain wired", source.includes("soundDimensionEnabled") && source.includes("setMusicEqBand"), {});
  check("Song IQ remains wired", source.includes("getMusicTrackIntelligence") && source.includes("audioAnalysis") && source.includes("masterPrep"), {});
}

if (fs.existsSync("src/features/music/MusicMiniPlayer.tsx")) {
  const source = fs.readFileSync("src/features/music/MusicMiniPlayer.tsx","utf8");
  check("UI identifies MVP DIMENSION MAX", source.includes("MVP DIMENSION MAX"), {});
  check("UI keeps BASS MIDS TREBLE EQ", source.includes("BASS") && source.includes("MIDS") && source.includes("TREBLE") && source.includes("FLAT"), {});
}

const failed = rows.filter(row => !row.pass);
console.log(`\n${rows.length-failed.length}/${rows.length} PASS`);
if (failed.length) {
  console.error("FAILED:", failed.map(row=>row.name).join(", "));
  process.exit(1);
}
