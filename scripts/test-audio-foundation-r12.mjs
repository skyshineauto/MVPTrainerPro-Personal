import fs from "node:fs";
import vm from "node:vm";

const workletPath = process.argv[2] || "public/audio/mvpSoundModes-r12.worklet.js";
const code = fs.readFileSync(workletPath, "utf8");
let Processor = null;
const posted = [];
class AudioWorkletProcessorStub {
  constructor() {
    this.port = { onmessage: null, postMessage(message) { posted.push(message); } };
  }
}
vm.runInNewContext(code, {
  AudioWorkletProcessor: AudioWorkletProcessorStub,
  registerProcessor(name, klass) {
    if (name !== "mvp-sound-modes") throw new Error(`Unexpected processor ${name}`);
    Processor = klass;
  },
  sampleRate: 48000,
  Float32Array,
  Float64Array,
  Math,
  Object,
  Number,
  Boolean,
}, { filename: workletPath });
if (!Processor) throw new Error("Worklet did not register.");

const sr = 48000;
const skip = Math.floor(sr * 0.8);
const db = (v) => 20 * Math.log10(Math.max(1e-12, v));

function render(sig, mode, profile = null, generation = 7) {
  posted.length = 0;
  const p = new Processor();
  p.port.onmessage?.({ data: { type: "track-profile", trackId: "test-track", profile } });
  p.port.onmessage?.({ data: { type: "mode", mode, generation } });
  const L = new Float32Array(sig.L.length), R = new Float32Array(sig.R.length);
  for (let off = 0; off < sig.L.length; off += 128) {
    const size = Math.min(128, sig.L.length - off);
    const iL = new Float32Array(128), iR = new Float32Array(128);
    iL.set(sig.L.subarray(off, off + size)); iR.set(sig.R.subarray(off, off + size));
    const oL = new Float32Array(128), oR = new Float32Array(128);
    p.process([[iL, iR]], [[oL, oR]]);
    L.set(oL.subarray(0, size), off); R.set(oR.subarray(0, size), off);
  }
  return { L, R, limiterMaxReductionDb: Number(p.limiterMaxReductionDb || 0), posted: [...posted] };
}

function rms(o) { let s=0,n=0; for(let i=skip;i<o.L.length;i++){s+=o.L[i]*o.L[i]+o.R[i]*o.R[i];n+=2;} return Math.sqrt(s/Math.max(1,n)); }
function peak(o){let p=0;for(let i=skip;i<o.L.length;i++)p=Math.max(p,Math.abs(o.L[i]),Math.abs(o.R[i]));return p;}
function mag(o,f){let cr=0,ci=0,n=0;for(let i=skip;i<o.L.length;i++){const x=(o.L[i]+o.R[i])*.5,a=2*Math.PI*f*i/sr;cr+=x*Math.cos(a);ci-=x*Math.sin(a);n++;}return 2*Math.hypot(cr,ci)/Math.max(1,n);}
function finite(o){for(let i=0;i<o.L.length;i++)if(!Number.isFinite(o.L[i])||!Number.isFinite(o.R[i]))return false;return true;}
function maxError(a,b){let e=0;for(let i=0;i<a.L.length;i++)e=Math.max(e,Math.abs(a.L[i]-b.L[i]),Math.abs(a.R[i]-b.R[i]));return e;}

function program(type="dynamic", seconds=3){
  const n=sr*seconds,L=new Float32Array(n),R=new Float32Array(n);
  let seed=0x13579bdf;
  const noise=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/0xffffffff*2-1;};
  for(let i=0;i<n;i++){
    const t=i/sr,beat=t%0.5;
    let env=type==="dynamic"?.40+(beat<.035?.74*Math.exp(-beat*65):0):type==="hot"?.88:type==="brick"?1.14:.23;
    let l=.30*Math.sin(2*Math.PI*55*t)+.22*Math.sin(2*Math.PI*115*t)+.15*Math.sin(2*Math.PI*180*t)+.13*Math.sin(2*Math.PI*1000*t)+.09*Math.sin(2*Math.PI*3300*t)+.045*Math.sin(2*Math.PI*9000*t)+.025*noise();
    let r=.28*Math.sin(2*Math.PI*55*t+.03)+.21*Math.sin(2*Math.PI*115*t+.12)+.14*Math.sin(2*Math.PI*180*t+.08)+.12*Math.sin(2*Math.PI*1000*t+.17)+.085*Math.sin(2*Math.PI*3300*t+.4)+.042*Math.sin(2*Math.PI*9000*t+.7)+.025*noise();
    l*=env;r*=env;
    if(type==="brick"){l=Math.max(-.94,Math.min(.94,l*1.55));r=Math.max(-.94,Math.min(.94,r*1.55));}
    L[i]=l;R[i]=r;
  }
  return {L,R};
}

const balancedProfile = {
  rmsDb:-13.2,truePeakDbtp:-1.1,crestFactorDb:8.5,dynamicRangeDb:8.4,
  bassExtension:54,lowMidBuildup:52,presenceBalance:50,harshness:42,sibilance:38,hfRolloff:46,
  transientStrength:62,correlation:.78,phaseRisk:false,sourceGainDb:.2,lowMidDb:0,presenceDb:0,harshnessDb:0,
};
const hotProfile = { ...balancedProfile, rmsDb:-8.8,truePeakDbtp:-.25,crestFactorDb:5.2,dynamicRangeDb:5.5,bassExtension:72,lowMidBuildup:67,harshness:54,transientStrength:48 };
const thinProfile = { ...balancedProfile, rmsDb:-15.5,truePeakDbtp:-2.2,crestFactorDb:10.5,bassExtension:28,lowMidBuildup:35,presenceBalance:45,harshness:35,hfRolloff:62,sourceGainDb:.8 };
const harshProfile = { ...balancedProfile, harshness:86,sibilance:80,presenceBalance:78,hfRolloff:30,presenceDb:-.3,harshnessDb:-.9 };

const rows=[];
function check(name,pass,data){rows.push({name,pass:Boolean(pass),data});console.log(pass?"PASS":"FAIL",name,data);}

{
  const sig=program("dynamic"), pure=render(sig,"pure",balancedProfile), adaptive=render(sig,"adaptive",balancedProfile), power=render(sig,"power",balancedProfile);
  const e=maxError(pure,sig), a=db(rms(adaptive)/rms(pure)), p=db(rms(power)/rms(pure)), pva=db(rms(power)/rms(adaptive));
  const bass=db((mag(power,55)+mag(power,115))/Math.max(1e-12,mag(pure,55)+mag(pure,115)));
  const body=db(mag(power,180)/Math.max(1e-12,mag(pure,180)));
  const mid=db(mag(power,1000)/Math.max(1e-12,mag(pure,1000)));
  const presence=db(mag(power,3300)/Math.max(1e-12,mag(pure,3300)));
  const air=db(mag(power,9000)/Math.max(1e-12,mag(pure,9000)));
  check("PURE sample-identical even with Song IQ",e<1e-7,{maxError:e});
  check("ADAPTIVE clearly louder",a>2.4,{adaptiveVsPureDb:a});
  check("POWER major step over PURE and ADAPTIVE",p>5.5&&pva>2.0,{powerVsPureDb:p,powerVsAdaptiveDb:pva});
  check("POWER full-range is bottom/body weighted",bass>5&&body>4&&mid>3&&bass>presence+1.2&&body>air+1.2,{bass,body,mid,presence,air});
  check("dynamic safe",finite(power)&&peak(power)<=.895&&power.limiterMaxReductionDb<14,{peak:peak(power),peakDb:db(peak(power)),limiterMaxReductionDb:power.limiterMaxReductionDb});
  check("generation acknowledged by processed frames",power.posted.some(m=>m.type==="mode-active"&&m.generation===7&&m.mode==="power"),power.posted.filter(m=>m.type==="mode-active"));
  const telemetry=power.posted.filter(m=>m.type==="telemetry").at(-1);
  check("telemetry exposes requested gain + limiter GR",Boolean(telemetry&&Number.isFinite(telemetry.requestedGainDb)&&Number.isFinite(telemetry.limiterReductionDb)&&telemetry.trackProfileApplied===true),telemetry||null);
}

{
  const sig=program("hot"), pure=render(sig,"pure",hotProfile), adaptive=render(sig,"adaptive",hotProfile), power=render(sig,"power",hotProfile);
  const a=db(rms(adaptive)/rms(pure)), p=db(rms(power)/rms(pure)), pva=db(rms(power)/rms(adaptive));
  check("hot master still gets audible progression",a>.6&&p>2.0&&pva>.8,{adaptiveVsPureDb:a,powerVsPureDb:p,powerVsAdaptiveDb:pva});
  check("hot master remains safe",finite(power)&&peak(power)<=.895&&power.limiterMaxReductionDb<14,{peak:peak(power),peakDb:db(peak(power)),limiterMaxReductionDb:power.limiterMaxReductionDb});
}

{
  const sig=program("quiet"), pure=render(sig,"pure",thinProfile), adaptive=render(sig,"adaptive",thinProfile), power=render(sig,"power",thinProfile);
  const a=db(rms(adaptive)/rms(pure)), p=db(rms(power)/rms(pure)), pva=db(rms(power)/rms(adaptive));
  check("quiet/thin track receives large clean lift",a>3&&p>8&&pva>3,{adaptiveVsPureDb:a,powerVsPureDb:p,powerVsAdaptiveDb:pva});
}

{
  const sig=program("dynamic"), thin=render(sig,"power",thinProfile), harsh=render(sig,"power",harshProfile);
  const thinBass=db((mag(thin,55)+mag(thin,115))/Math.max(1e-12,mag(sig,55)+mag(sig,115)));
  const harshPresence=db(mag(harsh,3300)/Math.max(1e-12,mag(sig,3300)));
  const thinPresence=db(mag(thin,3300)/Math.max(1e-12,mag(sig,3300)));
  check("Song IQ changes mastering by track",thinBass>6.0&&harshPresence<thinPresence,{thinBass,thinPresence,harshPresence});
}

{
  const n=sr*4,L=new Float32Array(n),R=new Float32Array(n);
  for(let i=0;i<n;i++){const x=.38*Math.sin(2*Math.PI*60*i/sr);L[i]=x;R[i]=x;}
  const out=render({L,R},"power",balancedProfile);
  const start=sr*2;
  let sd=0,cd=0,ss=0,cs=0;
  for(let i=start;i<n;i++){const a=2*Math.PI*60*i/sr,s=Math.sin(a),c=Math.cos(a);sd+=out.L[i]*s;cd+=out.L[i]*c;ss+=s*s;cs+=c*c;}
  const A=sd/ss,B=cd/cs;let sigSq=0,resSq=0;
  for(let i=start;i<n;i++){const a=2*Math.PI*60*i/sr,fit=A*Math.sin(a)+B*Math.cos(a),res=out.L[i]-fit;sigSq+=fit*fit;resSq+=res*res;}
  const residualDb=db(Math.sqrt(resSq)/Math.max(1e-12,Math.sqrt(sigSq)));
  check("POWER bass stays clean",residualDb<-45&&peak(out)<=.895&&finite(out),{residualDb,peak:peak(out),limiterMaxReductionDb:out.limiterMaxReductionDb});
}

const failed=rows.filter(r=>!r.pass);
console.log(`\n${rows.length-failed.length}/${rows.length} PASS`);
if(failed.length){console.error("FAILED:",failed.map(r=>r.name).join(", "));process.exit(1);}

if (fs.existsSync("src/lib/musicPlayer.ts")) {
  const player = fs.readFileSync("src/lib/musicPlayer.ts", "utf8");
  if (!player.includes('/audio/mvpSoundModes-r12.worklet.js')) throw new Error("R12 physical Worklet filename is not wired.");
  if (!player.includes('getMusicTrackIntelligence')) throw new Error("Per-song Enrich intelligence is not wired into playback.");
  if (!player.includes('requestedGainDb')) throw new Error("Requested-gain telemetry is not wired.");
  if (!player.includes('await context.resume()')) throw new Error("Mode/playback AudioContext resume safeguard missing.");
  if (player.includes('/audio/mvpSoundModes.worklet.js?v=foundation-r11')) throw new Error("Old R11 query-string Worklet route still present.");
  console.log("PASS R12 player wiring checks");
}
