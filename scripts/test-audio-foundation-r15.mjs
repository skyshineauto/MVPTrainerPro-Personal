import fs from 'node:fs';
import vm from 'node:vm';

const workletPath = process.argv[2] || 'public/audio/mvpSoundModes-r15.worklet.js';
const code = fs.readFileSync(workletPath, 'utf8');
let Processor = null;
class StubProcessor {
  constructor() {
    this.posted = [];
    this.port = { onmessage: null, postMessage: (message) => this.posted.push(message) };
  }
}
const sr = 48000;
vm.runInNewContext(code, {
  AudioWorkletProcessor: StubProcessor,
  registerProcessor: (name, klass) => {
    if (name !== 'mvp-sound-modes') throw new Error(`Unexpected processor ${name}`);
    Processor = klass;
  },
  sampleRate: sr,
  Float32Array,
  Math,
  Object,
});
if (!Processor) throw new Error('R15 worklet did not register');

const db = (value) => 20 * Math.log10(Math.max(1e-12, value));
const profiles = {
  dynamic: { rmsDb:-16,truePeakDbtp:-1.4,crestFactorDb:12,dynamicRangeDb:12,bassExtension:50,lowMidBuildup:50,presenceBalance:50,harshness:40,sibilance:40,hfRolloff:50,transientStrength:70,correlation:.7,phaseRisk:false,sourceGainDb:.2,lowMidDb:0,presenceDb:0,harshnessDb:0 },
  normal: { rmsDb:-12.5,truePeakDbtp:-1,crestFactorDb:8.5,dynamicRangeDb:8.5,bassExtension:54,lowMidBuildup:52,presenceBalance:50,harshness:45,sibilance:45,hfRolloff:50,transientStrength:60,correlation:.75,phaseRisk:false,sourceGainDb:.2,lowMidDb:0,presenceDb:0,harshnessDb:0 },
  hot: { rmsDb:-9.4,truePeakDbtp:-.3,crestFactorDb:7,dynamicRangeDb:6.5,bassExtension:66,lowMidBuildup:62,presenceBalance:52,harshness:54,sibilance:50,hfRolloff:46,transientStrength:50,correlation:.78,phaseRisk:false,sourceGainDb:.1,lowMidDb:0,presenceDb:0,harshnessDb:0 },
  brick: { rmsDb:-7.5,truePeakDbtp:-.1,crestFactorDb:5.3,dynamicRangeDb:4.5,bassExtension:60,lowMidBuildup:58,presenceBalance:50,harshness:52,sibilance:50,hfRolloff:48,transientStrength:35,correlation:.8,phaseRisk:false,sourceGainDb:0,lowMidDb:0,presenceDb:0,harshnessDb:0 },
  bass: { rmsDb:-11.8,truePeakDbtp:-.8,crestFactorDb:8,dynamicRangeDb:8,bassExtension:78,lowMidBuildup:66,presenceBalance:48,harshness:42,sibilance:40,hfRolloff:52,transientStrength:58,correlation:.8,phaseRisk:false,sourceGainDb:.15,lowMidDb:-.2,presenceDb:0,harshnessDb:0 },
};

function program(kind, seconds) {
  let seed = 0x2468ace1;
  const noise = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 0xffffffff * 2 - 1; };
  const n = Math.round(sr * seconds), L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr, beat = t % 0.5;
    let env = 0.5;
    if (kind === 'dynamic') env = 0.28 + (beat < .03 ? .9 * Math.exp(-beat * 65) : 0);
    else if (kind === 'normal') env = 0.48 + (beat < .025 ? .48 * Math.exp(-beat * 70) : 0);
    else if (kind === 'hot') env = 0.72 + (beat < .02 ? .22 * Math.exp(-beat * 90) : 0);
    else if (kind === 'brick') env = 0.90;
    else if (kind === 'bass') env = 0.52 + (beat < .04 ? .35 * Math.exp(-beat * 50) : 0);
    const low = kind === 'bass' ? .44 : .25;
    L[i] = env * (low*Math.sin(2*Math.PI*58*t)+.17*Math.sin(2*Math.PI*125*t)+.13*Math.sin(2*Math.PI*210*t)+.12*Math.sin(2*Math.PI*950*t)+.07*Math.sin(2*Math.PI*3200*t)+.025*noise());
    R[i] = env * (low*.96*Math.sin(2*Math.PI*58*t+.02)+.16*Math.sin(2*Math.PI*125*t+.09)+.12*Math.sin(2*Math.PI*210*t+.04)+.115*Math.sin(2*Math.PI*950*t+.14)+.065*Math.sin(2*Math.PI*3200*t+.3)+.025*noise());
  }
  return { L, R };
}
function processor(profile) {
  const p = new Processor();
  p.port.onmessage?.({ data: { type:'track-profile', trackId:'fixture', profile } });
  return p;
}
function renderRange(p, sig, start, end, mode, generation) {
  p.port.onmessage?.({ data: { type:'mode', mode, generation } });
  const n = end - start, L = new Float32Array(n), R = new Float32Array(n);
  for (let off = start, out = 0; off < end; off += 128, out += 128) {
    const size = Math.min(128, end - off);
    const a = new Float32Array(128), b = new Float32Array(128), c = new Float32Array(128), d = new Float32Array(128);
    a.set(sig.L.subarray(off, off + size)); b.set(sig.R.subarray(off, off + size));
    p.process([[a,b]], [[c,d]]);
    L.set(c.subarray(0,size), out); R.set(d.subarray(0,size), out);
  }
  return { L, R };
}
function slice(sig, start, end = sig.L.length) { return { L: sig.L.subarray(start,end), R: sig.R.subarray(start,end) }; }
function rms(sig) { let sum=0,n=0; for(let i=0;i<sig.L.length;i++){sum+=sig.L[i]*sig.L[i]+sig.R[i]*sig.R[i];n+=2;} return Math.sqrt(sum/Math.max(1,n)); }
function peak(sig) { let p=0; for(let i=0;i<sig.L.length;i++)p=Math.max(p,Math.abs(sig.L[i]),Math.abs(sig.R[i])); return p; }
function maxError(a,b) { let e=0; const n=Math.min(a.L.length,b.L.length); for(let i=0;i<n;i++)e=Math.max(e,Math.abs(a.L[i]-b.L[i]),Math.abs(a.R[i]-b.R[i])); return e; }
const TP = [
[0.0000000000,0.0006967276,-0.0036114518,0.0106894409,-0.0243920034,0.0473988787,-0.0853522687,0.1749621972,0.9271834644,-0.0558089374,0.0065336228,0.0051465217,-0.0059139618,0.0036139880,-0.0014253083,0.0002466871],
[-0.0000259944,0.0009306425,-0.0045142792,0.0140661965,-0.0349789143,0.0763806998,-0.1630375417,0.4750888740,0.7567609472,-0.1677299103,0.0663150886,-0.0261387989,0.0088488163,-0.0022472932,0.0003169478,-0.0000030777],
[-0.0000030777,0.0003169478,-0.0022472932,0.0088488163,-0.0261387989,0.0663150886,-0.1677299103,0.7567609472,0.4750888740,-0.1630375417,0.0763806998,-0.0349789143,0.0140661965,-0.0045142792,0.0009306425,-0.0000259944],
[0.0002466871,-0.0014253083,0.0036139880,-0.0059139618,0.0051465217,0.0065336228,-0.0558089374,0.9271834644,0.1749621972,-0.0853522687,0.0473988787,-0.0243920034,0.0106894409,-0.0036114518,0.0006967276,0.0000000000],
];
function truePeak4x(sig) {
  let best=0;
  for (const data of [sig.L,sig.R]) {
    const h = new Float64Array(16);
    for (let j=0;j<data.length;j++) {
      for(let k=15;k>0;k--)h[k]=h[k-1]; h[0]=data[j]; best=Math.max(best,Math.abs(data[j]));
      for(const phase of TP){let y=0;for(let k=0;k<16;k++)y+=h[k]*phase[k];best=Math.max(best,Math.abs(y));}
    }
  }
  return best;
}
const rows=[];
function check(name, pass, detail) { rows.push({name,pass,detail}); console.log(pass?'PASS':'FAIL',name,detail); }

// Null profile values must not become zero-valued analysis data.
{
  const p=processor({rmsDb:null,truePeakDbtp:null,crestFactorDb:null,dynamicRangeDb:null});
  check('null Song IQ values use sane fallbacks', p.profile.rmsDb === -12 && p.profile.truePeakDbtp === -1 && p.profile.crestFactorDb === 8, p.profile);
}

const targets = {
  dynamic: { a:3.5, p:7.0, step:2.5, lim:1.5 },
  normal:  { a:3.5, p:6.5, step:2.5, lim:1.5 },
  hot:     { a:2.4, p:4.5, step:1.5, lim:1.2 },
  brick:   { a:1.0, p:2.5, step:1.0, lim:.7 },
  bass:    { a:3.0, p:5.3, step:1.8, lim:1.8 },
};
for (const kind of Object.keys(targets)) {
  const t=targets[kind], sig=program(kind,6), p=processor(profiles[kind]), block=sr*2, settle=Math.round(sr*.65);
  renderRange(p,sig,0,block,'pure',1);
  const a=renderRange(p,sig,block,block*2,'adaptive',2);
  const pw=renderRange(p,sig,block*2,block*3,'power',3);
  const aIn=slice(sig,block+settle,block*2), pIn=slice(sig,block*2+settle,block*3);
  const aOut=slice(a,settle), pOut=slice(pw,settle);
  const aDb=db(rms(aOut)/rms(aIn)), pDb=db(rms(pOut)/rms(pIn)), step=pDb-aDb, tp=truePeak4x(pOut);
  const telemetry=p.posted.filter(x=>x.type==='telemetry'&&x.mode==='power');
  const avgLimit=telemetry.length?telemetry.reduce((sum,x)=>sum+Number(x.limiterAverageReductionDb||0),0)/telemetry.length:99;
  check(`${kind} ADAPTIVE sustained lift`,aDb>t.a,{netDb:+aDb.toFixed(2)});
  check(`${kind} POWER sustained lift`,pDb>t.p,{netDb:+pDb.toFixed(2)});
  check(`${kind} POWER clearly exceeds ADAPTIVE`,step>t.step,{stepDb:+step.toFixed(2)});
  check(`${kind} POWER true/inter-sample peak safe`,tp<=.895,{truePeak:tp,truePeakDb:+db(tp).toFixed(2),samplePeakDb:+db(peak(pOut)).toFixed(2)});
  check(`${kind} final limiter remains a safety stage`,avgLimit<t.lim,{averageLimiterReductionDb:+avgLimit.toFixed(2)});
}

// Exact requested switching sequence repeated for 32 seconds. Processed branches must stay warm.
{
  const sig=program('hot',32),p=processor(profiles.hot),block=sr*2,settle=Math.round(sr*.7);
  const sequence=['power','pure','adaptive','power','power','pure','adaptive','power','power','pure','adaptive','power','power','pure','adaptive','power'];
  const powerNet=[];let pureWorst=0,adaptiveWorst=Infinity,g=0;
  for(let j=0;j<sequence.length;j++){
    const mode=sequence[j],start=j*block,end=start+block,out=renderRange(p,sig,start,end,mode,++g);
    const outSteady=slice(out,settle),inSteady=slice(sig,start+settle,end);
    if(mode==='pure')pureWorst=Math.max(pureWorst,maxError(outSteady,inSteady));
    if(mode==='adaptive')adaptiveWorst=Math.min(adaptiveWorst,db(rms(outSteady)/rms(inSteady)));
    if(mode==='power')powerNet.push(db(rms(outSteady)/rms(inSteady)));
  }
  const spread=Math.max(...powerNet)-Math.min(...powerNet);
  check('32s repeated switching keeps PURE sample-identical',pureWorst<1e-7,{maxError:pureWorst});
  check('32s repeated switching keeps ADAPTIVE loud',adaptiveWorst>2.4,{minimumAdaptiveNetDb:+adaptiveWorst.toFixed(2)});
  check('32s repeated switching keeps every POWER loud',Math.min(...powerNet)>4.5,{powerNetDb:powerNet.map(v=>+v.toFixed(2))});
  check('second/later POWER does not collapse',spread<.35,{spreadDb:+spread.toFixed(3),powerNetDb:powerNet.map(v=>+v.toFixed(2))});
  const last=p.posted.filter(x=>x.type==='telemetry'&&x.mode==='power').at(-1);
  check('R15 telemetry carries active generation/profile',Boolean(last&&last.engine==='r15'&&last.generation===16&&last.profileClass==='hot'),last||null);
}

// Bass cleanliness: strong 60 Hz must remain sinusoidal rather than fuzzy.
{
  const n=sr*2,L=new Float32Array(n),R=new Float32Array(n);
  for(let i=0;i<n;i++){const x=.34*Math.sin(2*Math.PI*60*i/sr);L[i]=x;R[i]=x;}
  const sig={L,R},p=processor(profiles.bass),out=renderRange(p,sig,0,n,'power',1),start=Math.floor(sr*.8);
  let sd=0,cd=0,ss=0,cs=0;
  for(let i=start;i<n;i++){const a=2*Math.PI*60*i/sr,s=Math.sin(a),c=Math.cos(a);sd+=out.L[i]*s;cd+=out.L[i]*c;ss+=s*s;cs+=c*c;}
  const A=sd/ss,B=cd/cs;let sigSq=0,resSq=0;
  for(let i=start;i<n;i++){const a=2*Math.PI*60*i/sr,fit=A*Math.sin(a)+B*Math.cos(a),res=out.L[i]-fit;sigSq+=fit*fit;resSq+=res*res;}
  const residualDb=db(Math.sqrt(resSq)/Math.sqrt(sigSq));
  check('POWER 60 Hz stays clean',residualDb<-45,{residualDb:+residualDb.toFixed(2)});
}

if (fs.existsSync('src/lib/musicPlayer.ts')) {
  const source=fs.readFileSync('src/lib/musicPlayer.ts','utf8');
  check('player uses physical R15 Worklet route',source.includes('/audio/mvpSoundModes-r15.worklet.js')&&!source.includes('addModule("/audio/mvpSoundModes-r14.worklet.js")'),{});
  check('Song IQ still wired',source.includes('getMusicTrackIntelligence')&&source.includes('audioAnalysis')&&source.includes('masterPrep'),{});
  check('AudioContext resume still wired',source.includes('await context.resume()'),{});
  check('profileNumber preserves missing values',source.includes('value === null || value === undefined || value === ""'),{});
}
if (fs.existsSync('src/features/music/MusicMiniPlayer.tsx')) {
  const source=fs.readFileSync('src/features/music/MusicMiniPlayer.tsx','utf8');
  check('live telemetry shows active generation',source.includes('GEN ${player.soundModeGeneration}'),{});
}

const failed=rows.filter(row=>!row.pass);
console.log(`\n${rows.length-failed.length}/${rows.length} PASS`);
if(failed.length){console.error('FAILED:',failed.map(row=>row.name).join(', '));process.exit(1);}
