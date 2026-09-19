import fs from 'node:fs';import vm from 'node:vm';
const workletPath=process.argv[2]||'public/audio/mvpSoundModes-r14.worklet.js';const code=fs.readFileSync(workletPath,'utf8');let P=null;
class S{constructor(){this.posted=[];this.port={onmessage:null,postMessage:m=>this.posted.push(m)}}}
const sr=48000;vm.runInNewContext(code,{AudioWorkletProcessor:S,registerProcessor:(n,k)=>{if(n!=='mvp-sound-modes')throw new Error(n);P=k},sampleRate:sr,Float32Array,Float64Array,Math,Object});if(!P)throw new Error('no worklet');
const db=v=>20*Math.log10(Math.max(1e-12,v));
const hotProfile={rmsDb:-8.8,truePeakDbtp:-.25,crestFactorDb:8.55,dynamicRangeDb:6,bassExtension:72,lowMidBuildup:67,presenceBalance:50,harshness:54,sibilance:45,hfRolloff:46,transientStrength:48,correlation:.78,phaseRisk:false,sourceGainDb:.2,lowMidDb:0,presenceDb:0,harshnessDb:0};
const balancedProfile={...hotProfile,rmsDb:-13.2,truePeakDbtp:-1.1,crestFactorDb:8.5,bassExtension:54,lowMidBuildup:52,harshness:42,transientStrength:62};
function program(type,seconds){const n=sr*seconds,L=new Float32Array(n),R=new Float32Array(n);let seed=0x2468ace1;const noise=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/0xffffffff*2-1};for(let i=0;i<n;i++){const t=i/sr,b=t%0.5;let env=type==='hot'?.82+(b<.018?.18*Math.exp(-b*90):0):.40+(b<.03?.78*Math.exp(-b*72):0);L[i]=env*(.31*Math.sin(2*Math.PI*55*t)+.22*Math.sin(2*Math.PI*115*t)+.16*Math.sin(2*Math.PI*180*t)+.14*Math.sin(2*Math.PI*1000*t)+.085*Math.sin(2*Math.PI*3300*t)+.042*Math.sin(2*Math.PI*9000*t)+.025*noise());R[i]=env*(.29*Math.sin(2*Math.PI*55*t+.03)+.20*Math.sin(2*Math.PI*115*t+.10)+.15*Math.sin(2*Math.PI*180*t+.07)+.13*Math.sin(2*Math.PI*1000*t+.17)+.080*Math.sin(2*Math.PI*3300*t+.4)+.040*Math.sin(2*Math.PI*9000*t+.7)+.025*noise());}return{L,R}}
function proc(profile){const p=new P();p.port.onmessage?.({data:{type:'track-profile',trackId:'x',profile}});return p}
function range(p,sig,start,end,mode,g){p.port.onmessage?.({data:{type:'mode',mode,generation:g}});const n=end-start,L=new Float32Array(n),R=new Float32Array(n);for(let off=start,o=0;off<end;off+=128,o+=128){const sz=Math.min(128,end-off),a=new Float32Array(128),b=new Float32Array(128),c=new Float32Array(128),d=new Float32Array(128);a.set(sig.L.subarray(off,off+sz));b.set(sig.R.subarray(off,off+sz));p.process([[a,b]],[[c,d]]);L.set(c.subarray(0,sz),o);R.set(d.subarray(0,sz),o)}return{L,R}}
function rms(o,start=0){let s=0,n=0;for(let i=start;i<o.L.length;i++){s+=o.L[i]*o.L[i]+o.R[i]*o.R[i];n+=2}return Math.sqrt(s/n)}function peak(o,start=0){let p=0;for(let i=start;i<o.L.length;i++)p=Math.max(p,Math.abs(o.L[i]),Math.abs(o.R[i]));return p}function err(a,b,start=0){let e=0;for(let i=start;i<a.L.length;i++)e=Math.max(e,Math.abs(a.L[i]-b.L[i]),Math.abs(a.R[i]-b.R[i]));return e}function seg(sig,a,b){return{L:sig.L.subarray(a,b),R:sig.R.subarray(a,b)}}
const rows=[];function check(n,p,d){rows.push([n,p,d]);console.log(p?'PASS':'FAIL',n,d)}
// Exact reproduction of the reported bug: first POWER, then PURE, then ADAPTIVE, then POWER again.
{
 const segN=sr*2,sig=program('hot',8),p=proc(hotProfile),skip=sr*.7;
 const p1=range(p,sig,0,segN,'power',1),pu=range(p,sig,segN,segN*2,'pure',2),a=range(p,sig,segN*2,segN*3,'adaptive',3),p2=range(p,sig,segN*3,segN*4,'power',4);
 const p1in=seg(sig,skip,segN),puin=seg(sig,segN+skip,segN*2),ain=seg(sig,segN*2+skip,segN*3),p2in=seg(sig,segN*3+skip,segN*4);
 const p1o=seg(p1,skip,p1.L.length),puo=seg(pu,skip,pu.L.length),ao=seg(a,skip,a.L.length),p2o=seg(p2,skip,p2.L.length);
 const p1db=db(rms(p1o)/rms(p1in)),adb=db(rms(ao)/rms(ain)),p2db=db(rms(p2o)/rms(p2in));
 check('PURE stays exact after POWER',err(puo,puin)<1e-7,{maxError:err(puo,puin)});
 check('ADAPTIVE stays loud after PURE',adb>2.4,{adaptiveNetDb:adb});
 check('POWER stays loud after PURE',p2db>4.4,{firstPowerDb:p1db,secondPowerDb:p2db});
 check('POWER does not collapse after switching',Math.abs(p2db-p1db)<.5,{firstPowerDb:p1db,secondPowerDb:p2db});
 check('POWER peak safe',peak(p2o)<=.885,{peak:peak(p2o),peakDb:db(peak(p2o))});
 const tel=p.posted.filter(x=>x.type==='telemetry'&&x.mode==='power').at(-1);check('R14 telemetry generation active',Boolean(tel&&tel.engine==='r14'&&tel.generation===4),tel||null);
}
// Dynamic material must keep an even larger distinction.
{
 const segN=sr*2,sig=program('dynamic',6),p=proc(balancedProfile),skip=sr*.7;
 const pu=range(p,sig,0,segN,'pure',1),a=range(p,sig,segN,segN*2,'adaptive',2),pw=range(p,sig,segN*2,segN*3,'power',3);
 const pureIn=seg(sig,skip,segN),aIn=seg(sig,segN+skip,segN*2),pIn=seg(sig,segN*2+skip,segN*3);
 const ao=seg(a,skip,a.L.length),po=seg(pw,skip,pw.L.length);
 const adb=db(rms(ao)/rms(aIn)),pdb=db(rms(po)/rms(pIn));
 check('dynamic ADAPTIVE obvious',adb>3.0,{adaptiveNetDb:adb});check('dynamic POWER major',pdb>6.0&&pdb-adb>2.0,{powerNetDb:pdb,powerVsAdaptiveDb:pdb-adb});
}
// Bass-cleanliness guard.
{
 const n=sr*2,L=new Float32Array(n),R=new Float32Array(n);for(let i=0;i<n;i++){const x=.38*Math.sin(2*Math.PI*60*i/sr);L[i]=x;R[i]=x}const sig={L,R},p=proc(balancedProfile),out=range(p,sig,0,n,'power',1),start=Math.floor(sr*.8);let sd=0,cd=0,ss=0,cs=0;for(let i=start;i<n;i++){const a=2*Math.PI*60*i/sr,s=Math.sin(a),c=Math.cos(a);sd+=out.L[i]*s;cd+=out.L[i]*c;ss+=s*s;cs+=c*c}const A=sd/ss,B=cd/cs;let sigSq=0,resSq=0;for(let i=start;i<n;i++){const a=2*Math.PI*60*i/sr,fit=A*Math.sin(a)+B*Math.cos(a),res=out.L[i]-fit;sigSq+=fit*fit;resSq+=res*res}const residualDb=db(Math.sqrt(resSq)/Math.sqrt(sigSq));check('POWER 60 Hz clean',residualDb<-43&&peak(out,start)<=.885,{residualDb,peak:peak(out,start)});
}
const failed=rows.filter(x=>!x[1]);console.log(`\n${rows.length-failed.length}/${rows.length} PASS`);if(failed.length){console.error('FAILED:',failed.map(x=>x[0]).join(', '));process.exit(1)}
if(fs.existsSync('src/lib/musicPlayer.ts')){const s=fs.readFileSync('src/lib/musicPlayer.ts','utf8');if(!s.includes('/audio/mvpSoundModes-r14.worklet.js'))throw new Error('R14 physical Worklet route missing');if(s.includes('/audio/mvpSoundModes-r13-1.worklet.js'))throw new Error('Old R13.1 Worklet route remains');if(!s.includes('getMusicTrackIntelligence'))throw new Error('Song IQ missing');if(!s.includes('await context.resume()'))throw new Error('AudioContext resume missing');console.log('PASS R14 player wiring checks')}
