import fs from "node:fs";import vm from "node:vm";
const path=process.argv[2]||"public/audio/mvpSoundModes.worklet.js",code=fs.readFileSync(path,"utf8");let P=null;
class A{constructor(){this.port={onmessage:null,postMessage(){}};}}
vm.runInNewContext(code,{AudioWorkletProcessor:A,registerProcessor(n,k){if(n!=="mvp-sound-modes")throw new Error(n);P=k;},sampleRate:48000,Float32Array,Float64Array,Math,Object},{filename:path});
if(!P)throw new Error("no processor");
const sr=48000,skip=sr*2,db=v=>20*Math.log10(Math.max(1e-12,v));
function render(sig,mode){const p=new P();p.port.onmessage?.({data:{type:"mode",mode}});const L=new Float32Array(sig.L.length),R=new Float32Array(sig.R.length);for(let o=0;o<sig.L.length;o+=128){const n=Math.min(128,sig.L.length-o),iL=new Float32Array(128),iR=new Float32Array(128),oL=new Float32Array(128),oR=new Float32Array(128);iL.set(sig.L.subarray(o,o+n));iR.set(sig.R.subarray(o,o+n));p.process([[iL,iR]],[[oL,oR]]);L.set(oL.subarray(0,n),o);R.set(oR.subarray(0,n),o);}return{L,R,lim:Number(p.limiterMaxReductionDb||0)};}
function rms(o){let s=0,n=0;for(let i=skip;i<o.L.length;i++){s+=o.L[i]*o.L[i]+o.R[i]*o.R[i];n+=2;}return Math.sqrt(s/Math.max(1,n));}
function peak(o){let p=0;for(let i=skip;i<o.L.length;i++)p=Math.max(p,Math.abs(o.L[i]),Math.abs(o.R[i]));return p;}
function mag(o,f){let cr=0,ci=0,n=0;for(let i=skip;i<o.L.length;i++){const x=(o.L[i]+o.R[i])*.5,a=2*Math.PI*f*i/sr;cr+=x*Math.cos(a);ci-=x*Math.sin(a);n++;}return 2*Math.hypot(cr,ci)/Math.max(1,n);}
function err(a,b){let e=0;for(let i=0;i<a.L.length;i++)e=Math.max(e,Math.abs(a.L[i]-b.L[i]),Math.abs(a.R[i]-b.R[i]));return e;}
function fin(o){for(let i=0;i<o.L.length;i++)if(!Number.isFinite(o.L[i])||!Number.isFinite(o.R[i]))return false;return true;}
function sig(type="dynamic",sec=6){const n=sr*sec,L=new Float32Array(n),R=new Float32Array(n);let seed=0x2468ace1;const noise=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/0xffffffff*2-1;};for(let i=0;i<n;i++){const t=i/sr,b=t%.5;let env=type==="dynamic"?.40+(b<.03?.78*Math.exp(-b*72):0):type==="hot"?.84:type==="brick"?1.12:.25;let l=.31*Math.sin(2*Math.PI*55*t)+.22*Math.sin(2*Math.PI*120*t)+.16*Math.sin(2*Math.PI*180*t)+.14*Math.sin(2*Math.PI*1000*t)+.10*Math.sin(2*Math.PI*3400*t)+.055*Math.sin(2*Math.PI*9000*t)+.028*noise();let r=.29*Math.sin(2*Math.PI*55*t+.03)+.20*Math.sin(2*Math.PI*120*t+.10)+.15*Math.sin(2*Math.PI*180*t+.07)+.13*Math.sin(2*Math.PI*1000*t+.15)+.09*Math.sin(2*Math.PI*3400*t+.40)+.05*Math.sin(2*Math.PI*9000*t+.70)+.028*noise();l*=env;r*=env;if(type==="brick"){l=Math.max(-.93,Math.min(.93,l*1.5));r=Math.max(-.93,Math.min(.93,r*1.5));}L[i]=l;R[i]=r;}return{L,R};}
const rows=[];function ck(n,p,d){rows.push({n,p:!!p,d});console.log(p?"PASS":"FAIL",n,d);}
for(const type of ["dynamic","hot","brick","quiet"]){const s=sig(type),pu=render(s,"pure"),a=render(s,"adaptive"),p=render(s,"power");if(type==="dynamic")ck("PURE exact",err(pu,s)<1e-7,{error:err(pu,s)});const av=db(rms(a)/rms(pu)),pv=db(rms(p)/rms(pu)),pva=db(rms(p)/rms(a));const bass=db((mag(p,55)+mag(p,120))/Math.max(1e-12,mag(pu,55)+mag(pu,120))),body=db(mag(p,180)/Math.max(1e-12,mag(pu,180))),mid=db(mag(p,1000)/Math.max(1e-12,mag(pu,1000))),pr=db(mag(p,3400)/Math.max(1e-12,mag(pu,3400))),air=db(mag(p,9000)/Math.max(1e-12,mag(pu,9000)));
if(type==="dynamic"){ck("dynamic ADAPTIVE audible",av>1.5,{av});ck("dynamic POWER above ADAPTIVE",pva>1.0&&pv>3.0,{pv,pva});ck("dynamic POWER full not tinny",bass>3&&body>2.5&&mid>1.5&&bass>pr+1.0&&body>air+1.0,{bass,body,mid,pr,air});}
else if(type==="hot"){ck("hot modes distinct",Math.abs(av)>.2&&Math.abs(pva)>.35,{av,pva,pv});ck("hot POWER low/body priority",bass>air+.5&&body>air+.5,{bass,body,mid,pr,air});}
else if(type==="brick"){ck("brick POWER changes sound",Math.abs(pva)>.15||Math.abs(bass)>.5||Math.abs(body)>.5,{pva,bass,body,mid,pr,air});}
else{ck("quiet ADAPTIVE lift",av>2,{av});ck("quiet POWER above ADAPTIVE",pva>1.5&&pv>5,{pv,pva});}
ck(type+" safe",fin(a)&&fin(p)&&peak(p)<=.895&&p.lim<16,{peak:peak(p),peakDb:db(peak(p)),lim:p.lim});}
{
 const gains={};for(const f of [60,165,500,1000,3400,9000]){const n=sr*6,L=new Float32Array(n),R=new Float32Array(n);for(let i=0;i<n;i++){const x=.03*Math.sin(2*Math.PI*f*i/sr);L[i]=x;R[i]=x;}const s={L,R},pu=render(s,"pure"),p=render(s,"power");gains[f]=db(mag(p,f)/Math.max(1e-12,mag(pu,f)));}ck("no crossover holes",Math.min(...Object.values(gains))>-2&&gains[60]>gains[9000]+2&&gains[165]>gains[9000]+1.5,gains);
}
{
 const n=sr*8,L=new Float32Array(n),R=new Float32Array(n);for(let i=0;i<n;i++){const x=.4*Math.sin(2*Math.PI*60*i/sr);L[i]=x;R[i]=x;}const o=render({L,R},"power"),start=sr*5;let sd=0,cd=0,ss=0,cs=0;for(let i=start;i<n;i++){const a=2*Math.PI*60*i/sr,s=Math.sin(a),c=Math.cos(a);sd+=o.L[i]*s;cd+=o.L[i]*c;ss+=s*s;cs+=c*c;}const A=sd/ss,B=cd/cs;let sig2=0,res2=0;for(let i=start;i<n;i++){const a=2*Math.PI*60*i/sr,fit=A*Math.sin(a)+B*Math.cos(a),r=o.L[i]-fit;sig2+=fit*fit;res2+=r*r;}const rd=db(Math.sqrt(res2)/Math.max(1e-12,Math.sqrt(sig2)));ck("60 Hz clean",rd<-40&&peak(o)<=.895&&fin(o),{rd,peak:peak(o),lim:o.lim});
}
const failed=rows.filter(x=>!x.p);console.log(`\n${rows.length-failed.length}/${rows.length} PASS`);if(failed.length){console.error("FAILED:",failed.map(x=>x.n).join(", "));process.exit(1);}
