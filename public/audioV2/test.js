const audio=document.querySelector("#audio");
const file=document.querySelector("#file");
const init=document.querySelector("#init");
const proof=document.querySelector("#proof");
const mute=document.querySelector("#mute");
const modeButtons=[...document.querySelectorAll("[data-mode]")];
const profileButtons=[...document.querySelectorAll("[data-profile]")];
const effectButtons=[...document.querySelectorAll("[data-effect]")];
const spaceButtons=[...document.querySelectorAll("[data-space]")];
const intensity=document.querySelector("#intensity");
const intensityValue=document.querySelector("#intensityValue");
const bassCharacter=document.querySelector("#bassCharacter");
const bassCharacterRow=document.querySelector("#bassCharacterRow");
const spaceModes=document.querySelector("#spaceModes");
const spatialLabel=document.querySelector("#spatialLabel");
const logEl=document.querySelector("#log");
const delta=document.querySelector("#delta");
const tp=document.querySelector("#tp");
const gr=document.querySelector("#gr");
const mb=document.querySelector("#mb");
const impactMeter=document.querySelector("#impactMeter");
const width=document.querySelector("#width");
const clips=document.querySelector("#clips");
const nans=document.querySelector("#nans");

let url="",ctx=null,source=null,node=null,ready=false,revision=0,proofMute=false,lastTelemetry=null;
let telemetryHistory=[];
const state={
  mode:"adaptive",outputProfile:"headphones",intensity:.72,
  bassEnabled:false,bassCharacter:.5,impactEnabled:false,clarityEnabled:false,spatialEnabled:false,
  spaceMode:"studio",personalEnabled:false,personalBass:0,personalPresence:0,personalBrightness:0,
  eqEnabled:false,eqGains:new Array(31).fill(0)
};
function log(message){const t=new Date().toLocaleTimeString();logEl.textContent=`[${t}] ${message}\n${logEl.textContent}`.slice(0,9000)}
function send(){if(!node||!ready)return;revision++;node.port.postMessage({type:"SET_STATE",revision,state:{...state,eqGains:[...state.eqGains]}})}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function refresh(){
  const pure=state.mode==="pure";
  modeButtons.forEach(b=>b.classList.toggle("active",b.dataset.mode===state.mode));
  profileButtons.forEach(b=>b.classList.toggle("active",b.dataset.profile===state.outputProfile));
  effectButtons.forEach(b=>{
    b.disabled=pure;
    b.classList.toggle("active",!pure&&Boolean(state[b.dataset.effect]));
  });
  intensity.disabled=pure;
  bassCharacter.disabled=pure;
  bassCharacterRow.hidden=pure||!state.bassEnabled;
  const label=state.outputProfile==="headphones"?"IMMERSION":state.outputProfile==="speaker"?"STAGE":"SPACE";
  spatialLabel.textContent=label;
  spaceModes.hidden=pure||!(state.outputProfile==="car_hifi"&&state.spatialEnabled);
  spaceButtons.forEach(b=>{
    b.disabled=pure;
    b.classList.toggle("active",!pure&&b.dataset.space===state.spaceMode);
  });
  intensityValue.textContent=pure?"PURE":`${Math.round(state.intensity*100)}%`;
}
function update(t){
  lastTelemetry=t;
  telemetryHistory.push(t);
  if(telemetryHistory.length>64)telemetryHistory.shift();
  delta.textContent=`${Number(t.rmsDeltaDb).toFixed(2)} dB`;
  tp.textContent=`${Number(t.truePeakDbtp).toFixed(2)} dBTP`;
  gr.textContent=`${Number(t.limiterGrDb).toFixed(2)} dB`;
  mb.textContent=`${Number(t.multibandGainReductionDb).toFixed(2)} dB`;
  impactMeter.textContent=`${Number(t.impactBoostDb).toFixed(2)} dB`;
  width.textContent=`${Number(t.spatialWidthPercent).toFixed(0)}%`;
  clips.textContent=String(t.clipCount);
  nans.textContent=String(t.nanCount);
}
file.addEventListener("change",()=>{const f=file.files?.[0];if(!f)return;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(f);audio.src=url;log(`Loaded ${f.name}`)});
init.addEventListener("click",async()=>{try{
  if(ready){if(ctx?.state==="suspended")await ctx.resume();return}
  if(!audio.src)throw new Error("Choose a song first.");
  ctx=new AudioContext({latencyHint:"playback"});
  await ctx.audioWorklet.addModule("/audioV2/mvpHdV2.worklet.js?v=broadcast-v3-r4-live-state");
  const response=await fetch("/audioV2/mvpHdV2.wasm?v=broadcast-v3-r4-live-state",{cache:"no-store"});
  if(!response.ok)throw new Error(`WASM ${response.status}`);
  const bytes=await response.arrayBuffer();
  source=ctx.createMediaElementSource(audio);
  node=new AudioWorkletNode(ctx,"mvp-hd-v2-processor",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:"explicit",channelInterpretation:"speakers"});
  source.connect(node);node.connect(ctx.destination);
  const wait=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error("Worklet timeout")),8000);
    node.port.onmessage=(event)=>{const m=event.data||{};
      if(m.type==="READY"){clearTimeout(timeout);ready=true;node.port.postMessage({type:"SET_TELEMETRY",enabled:true});send();log(`READY ${m.version} • ${m.sampleRate} Hz`);resolve();return}
      if(m.type==="TELEMETRY"){update(m);return}
      if(m.type==="ERROR"){clearTimeout(timeout);reject(new Error(m.message||"Worklet error"));return}
      if(m.type==="PROOF_MUTE_APPLIED")log(`Proof mute=${m.enabled}`);
    };
  });
  node.port.postMessage({type:"INIT_WASM",wasmBytes:bytes},[bytes]);await wait;await ctx.resume();init.textContent="V3 READY";
}catch(e){log(`ERROR: ${e instanceof Error?e.message:String(e)}`)}});

modeButtons.forEach(b=>b.addEventListener("click",()=>{
  state.mode=b.dataset.mode;
  telemetryHistory=[];
  if(node&&ready)node.port.postMessage({type:"RESET_METERS"});
  send();refresh();
}));
profileButtons.forEach(b=>b.addEventListener("click",()=>{
  state.outputProfile=b.dataset.profile;
  telemetryHistory=[];
  if(node&&ready)node.port.postMessage({type:"RESET_METERS"});
  send();refresh();
}));
effectButtons.forEach(b=>b.addEventListener("click",()=>{const key=b.dataset.effect;state[key]=!state[key];send();refresh()}));
spaceButtons.forEach(b=>b.addEventListener("click",()=>{state.spaceMode=b.dataset.space;send();refresh()}));
intensity.addEventListener("input",()=>{state.intensity=Number(intensity.value)/100;send();refresh()});
bassCharacter.addEventListener("input",()=>{state.bassCharacter=Number(bassCharacter.value)/100;send();refresh()});
mute.addEventListener("click",()=>{if(!ready)return;proofMute=!proofMute;node.port.postMessage({type:"SET_PROOF_MUTE",enabled:proofMute});mute.classList.toggle("active",proofMute)});

function waitForSeek(target){
  if(Math.abs(audio.currentTime-target)<.015)return Promise.resolve();
  return new Promise((resolve)=>{
    let done=false;
    const finish=()=>{if(done)return;done=true;audio.removeEventListener("seeked",finish);clearTimeout(timer);resolve()};
    const timer=setTimeout(finish,1500);
    audio.addEventListener("seeked",finish,{once:true});
    audio.currentTime=target;
  });
}
function averageDb(samples){
  const valid=samples.map(t=>Number(t.rmsDeltaDb)).filter(Number.isFinite);
  if(!valid.length)return NaN;
  return valid.reduce((sum,value)=>sum+value,0)/valid.length;
}
async function captureSameSection(mode,anchor){
  state.mode=mode;
  telemetryHistory=[];
  node.port.postMessage({type:"RESET_METERS"});
  send();refresh();
  await waitForSeek(anchor);
  if(audio.paused)await audio.play();
  await sleep(650);
  telemetryHistory=[];
  await sleep(1100);
  const avg=averageDb(telemetryHistory.slice(-8));
  const live=lastTelemetry;
  return {
    line:Number.isFinite(avg)?`${mode.toUpperCase()}: ${avg.toFixed(2)} dB`:`${mode.toUpperCase()}: no telemetry`,
    avg,
    clips:Number(live?.clipCount??0),
    nans:Number(live?.nanCount??0),
  };
}
proof.addEventListener("click",async()=>{try{
  if(!ready)throw new Error("Initialize V3 first.");
  const saved={...state};
  const savedTime=audio.currentTime;
  const wasPaused=audio.paused;
  const duration=Number.isFinite(audio.duration)?audio.duration:0;
  const anchor=Math.max(0,Math.min(savedTime,duration>3?duration-2.2:savedTime));
  state.bassEnabled=state.impactEnabled=state.clarityEnabled=state.spatialEnabled=false;
  const pure=await captureSameSection("pure",anchor);
  const adaptive=await captureSameSection("adaptive",anchor);
  const power=await captureSameSection("power",anchor);
  const lines=[pure.line,adaptive.line,power.line];
  node.port.postMessage({type:"SET_PROOF_MUTE",enabled:true});await sleep(700);
  const muteOk=lastTelemetry&&Number(lastTelemetry.outputRms)<.000001;
  node.port.postMessage({type:"SET_PROOF_MUTE",enabled:false});
  Object.assign(state,saved);send();refresh();
  await waitForSeek(savedTime);
  if(wasPaused)audio.pause();else await audio.play();
  const modeOrder=Number.isFinite(pure.avg)&&Number.isFinite(adaptive.avg)&&Number.isFinite(power.avg)
    && adaptive.avg>pure.avg+.20&&power.avg>adaptive.avg+.75;
  const safety=[pure,adaptive,power].every(x=>x.clips===0&&x.nans===0);
  log(`BROADCAST V3 R4 SAME-SECTION PROOF ${muteOk&&modeOrder&&safety?"PASS":"FAIL"}\n${lines.join("\n")}\nSame song section @ ${anchor.toFixed(2)}s • modeOrder=${modeOrder?"PASS":"FAIL"} • mute=${muteOk?"PASS":"FAIL"} • safety=${safety?"PASS":"FAIL"}`);
}catch(e){log(`PROOF ERROR: ${e instanceof Error?e.message:String(e)}`)}});

refresh();
window.addEventListener("beforeunload",()=>{if(url)URL.revokeObjectURL(url)});
