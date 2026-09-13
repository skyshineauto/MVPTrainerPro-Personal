import fs from 'node:fs';
import assert from 'node:assert/strict';
const wasm=fs.readFileSync(new URL('../public/audioV2/mvpHdV2.wasm',import.meta.url));
const {instance}=await WebAssembly.instantiate(wasm,{env:{sin:Math.sin,cos:Math.cos,pow:Math.pow,exp:Math.exp,log10:Math.log10}});
const d=instance.exports,SR=48000;assert.equal(d.mvp_v2_init(SR),1);const F=d.mvp_v2_max_frames(),mem=d.memory;
const il=new Float32Array(mem.buffer,d.mvp_v2_input_l(),F),ir=new Float32Array(mem.buffer,d.mvp_v2_input_r(),F),ol=new Float32Array(mem.buffer,d.mvp_v2_output_l(),F),orr=new Float32Array(mem.buffer,d.mvp_v2_output_r(),F);
let gates=0;const pass=(name,cond,msg='')=>{gates++;if(!cond)throw new Error(`FAIL ${gates} ${name}${msg?`: ${msg}`:''}`);};
function source(kind,i){const t=i/SR,beat=i%24000,e=i%6000,s=i%3000;const kick=Math.exp(-beat/650)*Math.sin(2*Math.PI*(58+24*Math.exp(-beat/500))*t),hat=Math.exp(-s/210)*Math.sin(2*Math.PI*9000*t);if(kind==='hard'){const riff=.40*Math.sin(2*Math.PI*110*t)+.28*Math.sin(2*Math.PI*220*t)+.22*Math.sin(2*Math.PI*880*t)+.18*Math.sin(2*Math.PI*2850*t)+.12*Math.sin(2*Math.PI*6100*t),th=(e<180?.34:.05)*Math.sin(2*Math.PI*74*t);return[.72*Math.tanh(5.2*(riff+th+.10*hat)),.72*Math.tanh(5.2*(.97*riff+th-.08*hat))]}const drum=(e<240?1:.35)*(.25*Math.sin(2*Math.PI*92*t)+.13*Math.sin(2*Math.PI*184*t)),g=.26*Math.sin(2*Math.PI*165*t)+.18*Math.sin(2*Math.PI*330*t)+.14*Math.sin(2*Math.PI*1320*t)+.08*Math.sin(2*Math.PI*3600*t);return[.55*(drum+g+.08*hat),.55*(drum+.96*g-.07*hat)]}
function set(c={}){d.mvp_v2_set_mode(c.mode??1);d.mvp_v2_set_output_profile(c.profile??1);d.mvp_v2_set_intensity(c.intensity??.72);d.mvp_v2_set_bass_enabled(c.bass?1:0);d.mvp_v2_set_bass_character(c.bc??.5);d.mvp_v2_set_impact_enabled(c.impact?1:0);d.mvp_v2_set_clarity_enabled(c.clarity?1:0);d.mvp_v2_set_spatial_enabled(c.spatial?1:0);d.mvp_v2_set_space_mode(c.space??0);d.mvp_v2_set_personal_enabled(c.personal?1:0);d.mvp_v2_set_personal_bass(c.pb??0);d.mvp_v2_set_personal_presence(c.pp??0);d.mvp_v2_set_personal_brightness(c.pbr??0);const p=c.prep||{};d.mvp_v2_set_master_prep(c.prep?1:0,p.sourceGainDb??0,p.highpassHz??18,p.lowMidDb??0,p.presenceDb??0,p.harshnessDb??0,p.balanceDb??0,p.widthScale??1);d.mvp_v2_set_eq_enabled(c.eq?1:0);for(let i=0;i<31;i++)d.mvp_v2_set_eq_band(i,c.eq?.[i]??0)}
function render(c,kind='hard',sec=.62){set(c);d.mvp_v2_reset();set(c);d.mvp_v2_reset_meters();let idx=0,e=0,n=0,pk=0,near=0,flat=0,last=0;const arr=[];const total=Math.ceil(sec*SR/F)*F,keep=Math.floor(total*.36);for(let pos=0;pos<total;pos+=F){for(let j=0;j<F;j++){const [l,r]=source(kind,idx++);il[j]=l;ir[j]=r}d.mvp_v2_process(F);for(let j=0;j<F;j++){if(pos+j<keep)continue;const x=ol[j];arr.push(x);e+=x*x;n++;pk=Math.max(pk,Math.abs(x));if(Math.abs(x)>.90)near++;if(Math.abs(x)>.60&&Math.abs(x-last)<1e-5)flat++;last=x}}return{arr,rms:Math.sqrt(e/n),rmsdb:20*Math.log10(Math.sqrt(e/n)),pk,tp:+d.mvp_v2_meter_true_peak_dbtp(),lim:+d.mvp_v2_meter_limiter_gr_db(),clips:+d.mvp_v2_meter_clip_count(),nans:+d.mvp_v2_meter_nan_count(),near:near/n,flat:flat/n}}
function deltaDb(a,b){let e=0,r=0,n=Math.min(a.arr.length,b.arr.length);for(let i=0;i<n;i++){const z=a.arr[i]-b.arr[i];e+=z*z;r+=a.arr[i]*a.arr[i]}return 20*Math.log10(Math.max(1e-12,Math.sqrt(e/n))/Math.max(1e-12,Math.sqrt(r/n)))}
function safe(name,o){pass(`${name} no clips`,o.clips===0,`${o.clips}`);pass(`${name} no NaNs`,o.nans===0,`${o.nans}`);pass(`${name} peak <= 1`,o.pk<=1.00001,`${o.pk}`);pass(`${name} true peak <= -0.30`,o.tp<=-.30,`${o.tp.toFixed(2)} dBTP`);pass(`${name} limiter <= 7 dB`,o.lim<=7.0,`${o.lim.toFixed(2)} dB`);pass(`${name} ceiling occupancy`,o.near<.48,`${(o.near*100).toFixed(1)}%`);pass(`${name} flattening`,o.flat<.06,`${(o.flat*100).toFixed(2)}%`)}
for(const profile of [0,1,2]) for(const kind of ['hard','dynamic']){
  const pure=render({profile,mode:0},kind),ad=render({profile,mode:1},kind),power=render({profile,mode:2},kind);safe(`p${profile} ${kind} PURE`,pure);safe(`p${profile} ${kind} ADAPTIVE`,ad);safe(`p${profile} ${kind} POWER`,power);
  pass(`p${profile} ${kind} PURE->ADAPTIVE audible`,deltaDb(pure,ad)>-28,deltaDb(pure,ad).toFixed(1));
  pass(`p${profile} ${kind} ADAPTIVE->POWER audible`,deltaDb(ad,power)>(kind==='hard'?-21:-14),deltaDb(ad,power).toFixed(1));
  if(kind==='dynamic')pass(`p${profile} ${kind} POWER materially louder`,power.rmsdb-ad.rmsdb>1.8,`${(power.rmsdb-ad.rmsdb).toFixed(2)} dB`);
  const checks=[
    ['Intensity 0->100',{profile,mode:2,intensity:0},{profile,mode:2,intensity:1},kind==='hard'?-21:-14],
    ['Bass OFF->ON',{profile,mode:2},{profile,mode:2,bass:true},-18],
    ['Bass Tight->Deep',{profile,mode:2,bass:true,bc:0},{profile,mode:2,bass:true,bc:1},-18],
    ['Impact OFF->ON',{profile,mode:2},{profile,mode:2,impact:true},-25],
    ['Clarity OFF->ON',{profile,mode:2},{profile,mode:2,clarity:true},-20],
    ['Spatial OFF->ON',{profile,mode:2},{profile,mode:2,spatial:true,space:2},-27],
    ['Personal Bass min->max',{profile,mode:2,personal:true,pb:-1},{profile,mode:2,personal:true,pb:1},-18],
    ['Personal Presence min->max',{profile,mode:2,personal:true,pp:-1},{profile,mode:2,personal:true,pp:1},-18],
    ['Personal Brightness min->max',{profile,mode:2,personal:true,pbr:-1},{profile,mode:2,personal:true,pbr:1},-18],
    ['All effects OFF->ON',{profile,mode:2},{profile,mode:2,bass:true,impact:true,clarity:true,spatial:true,personal:true,pb:.6,pp:.5,pbr:.5},-15],
  ];
  for(const [name,aCfg,bCfg,min] of checks){const a=render(aCfg,kind),b=render(bCfg,kind),dd=deltaDb(a,b);safe(`p${profile} ${kind} ${name} A`,a);safe(`p${profile} ${kind} ${name} B`,b);pass(`p${profile} ${kind} ${name} audible`,dd>min,`${dd.toFixed(1)} dB`)}
}

// Every binary effect combination must remain audibly live, not merely safe.
const comboThreshold={1:-20,2:-27,4:-22,8:-30};
for(const profile of [0,1,2]) for(const kind of ['hard','dynamic']) for(const mode of [1,2]) for(const intensity of [0,1]){
  const cache=new Map();
  const get=(mask)=>{if(!cache.has(mask))cache.set(mask,render({profile,mode,intensity,bass:!!(mask&1),impact:!!(mask&2),clarity:!!(mask&4),spatial:!!(mask&8),space:2},kind,.42));return cache.get(mask)};
  const zero=get(0);
  for(let mask=1;mask<16;mask++){
    const out=get(mask); safe(`combo p${profile} ${kind} m${mode} i${intensity} mask${mask}`,out);
    pass(`combo mask${mask} differs from all-off`,deltaDb(zero,out)>-32,deltaDb(zero,out).toFixed(1));
    for(const bit of [1,2,4,8]) if(mask&bit){const without=get(mask&~bit),dd=deltaDb(without,out);pass(`combo mask${mask} bit${bit} remains audible`,dd>comboThreshold[bit],dd.toFixed(1));}
  }
}

// Car SPACE modes must be distinct, not three labels on one effect.
for(const kind of ['hard','dynamic']){
  const studio=render({profile:0,mode:2,intensity:1,spatial:true,space:0},kind);
  const live=render({profile:0,mode:2,intensity:1,spatial:true,space:1},kind);
  const arena=render({profile:0,mode:2,intensity:1,spatial:true,space:2},kind);
  pass(`Car ${kind} Studio->Live audible`,deltaDb(studio,live)>-31,deltaDb(studio,live).toFixed(1));
  pass(`Car ${kind} Live->Arena audible`,deltaDb(live,arena)>-31,deltaDb(live,arena).toFixed(1));
}

// Master Prep must create a real per-song correction when enabled.
for(const profile of [0,1,2]){
  const off=render({profile,mode:1},'dynamic');
  const prep=render({profile,mode:1,prep:{sourceGainDb:2.5,highpassHz:24,lowMidDb:-2.2,presenceDb:1.3,harshnessDb:-1.4,balanceDb:.6,widthScale:.9}},'dynamic');
  safe(`p${profile} Master Prep`,prep);
  pass(`p${profile} Master Prep audible`,deltaDb(off,prep)>-24,deltaDb(off,prep).toFixed(1));
}

// 31-band EQ must be unmistakable on the real engine.
const eqUp=new Array(31).fill(0),eqDown=new Array(31).fill(0);eqUp[14]=9;eqDown[14]=-9;
for(const profile of [0,1,2]){const a=render({profile,mode:2,eq:eqDown},'dynamic'),b=render({profile,mode:2,eq:eqUp},'dynamic');safe(`p${profile} EQ cut`,a);safe(`p${profile} EQ boost`,b);pass(`p${profile} 500Hz EQ audible`,deltaDb(a,b)>-18,deltaDb(a,b).toFixed(1));}
console.log(`MVP Broadcast V5.3 audibility/safety: ${gates}/${gates} PASS`);
