
export type MvpStudioState = Record<string, any>;
export type MvpStudioVenueProfile = { enabled:boolean; widthScale:number; reflectionMix:number; delayMsA:number; delayMsB:number; damping:number };
export type MvpStudioTelemetry = {
  inputPeak:number;outputPeak:number;inputRms:number;outputRms:number;gainReductionDb:number;limiterGain:number;truePeakDbtp:number;transientBoostDb:number;
  multibandGainReductionDb:number;multibandBandReductionDb:[number,number,number,number];dynamicEqGainReductionDb:number;dynamicEqBandReductionDb:[number,number,number,number];
  outputCorrectionReductionDb:number;stereoCorrelation:number;stereoWidthPercent:number;stereoGuardReductionDb:number;headphoneOutputDriveDb:number;loudnessGainDb:number;
  loudnessMomentaryLufs:number;loudnessProgramLufs:number;autoMakeupDb:number;outputReserveDb:number;finalCompressorReductionDb:number;maxHdInputTruePeakDbtp:number;
  availableHeadroomDb:number;internalPeak:number;bassActivityDb:number;toneActivityDb:number;exciterActivity:number;deharshReductionDb:number;smartActivity:number;
};
export type MvpStudioRuntimeInfo = { assetVersion:string;processorVersion:string;ready:boolean;faulted:boolean;requestedRevision:number;appliedRevision:number;lastError:string|null;lastRequestedAt:number;lastAppliedAt:number;appliedState:Record<string,unknown>|null };

type MasterPrep = { enabled:boolean;sourceGainDb:number;highpassHz:number;lowMidDb:number;presenceDb:number;harshnessDb:number;balanceDb:number;widthScale:number };
const ASSET_VERSION="7.3.0-song-aware-authority";
const DEFAULT_PREP:MasterPrep={enabled:false,sourceGainDb:0,highpassHz:18,lowMidDb:0,presenceDb:0,harshnessDb:0,balanceDb:0,widthScale:1};
let currentMasterPrep:MasterPrep={...DEFAULT_PREP};

const EMPTY:MvpStudioTelemetry={inputPeak:0,outputPeak:0,inputRms:0,outputRms:0,gainReductionDb:0,limiterGain:1,truePeakDbtp:-120,transientBoostDb:0,multibandGainReductionDb:0,multibandBandReductionDb:[0,0,0,0],dynamicEqGainReductionDb:0,dynamicEqBandReductionDb:[0,0,0,0],outputCorrectionReductionDb:0,stereoCorrelation:1,stereoWidthPercent:100,stereoGuardReductionDb:0,headphoneOutputDriveDb:0,loudnessGainDb:0,loudnessMomentaryLufs:-70,loudnessProgramLufs:-70,autoMakeupDb:0,outputReserveDb:0,finalCompressorReductionDb:0,maxHdInputTruePeakDbtp:-120,availableHeadroomDb:24,internalPeak:0,bassActivityDb:0,toneActivityDb:0,exciterActivity:0,deharshReductionDb:0,smartActivity:0};
let telemetry={...EMPTY};let activeNode:AudioWorkletNode|null=null;let nextRevision=0;
const loadedContexts=new WeakSet<AudioContext>(),requestedByNode=new WeakMap<AudioWorkletNode,number>(),appliedByNode=new WeakMap<AudioWorkletNode,number>(),stateByNode=new WeakMap<AudioWorkletNode,MvpStudioState>(),proofAckByNode=new WeakMap<AudioWorkletNode,{id:number;enabled:boolean}>();
let runtime:MvpStudioRuntimeInfo={assetVersion:ASSET_VERSION,processorVersion:"mvp-sound-v7-3-song-aware-authority",ready:false,faulted:false,requestedRevision:0,appliedRevision:0,lastError:null,lastRequestedAt:0,lastAppliedAt:0,appliedState:null};

function clamp(v:unknown,min:number,max:number,fallback:number){const n=Number(v);return Math.max(min,Math.min(max,Number.isFinite(n)?n:fallback))}
function publicState(state:MvpStudioState){return {mode:state.broadcastModeCode===2?"power":state.broadcastModeCode===1?"adaptive":"pure",outputProfile:state.outputProfileCode===2?"speaker":state.outputProfileCode===1?"headphones":"car_hifi",intensity:clamp(state.broadcastIntensity,0,1,.7),bassEnabled:Boolean(state.broadcastBassEnabled),bassCharacter:clamp(state.broadcastBassCharacter,0,1,.5),impactEnabled:Boolean(state.broadcastImpactEnabled),clarityEnabled:Boolean(state.broadcastClarityEnabled),spatialEnabled:Boolean(state.broadcastSpatialEnabled),spaceMode:state.broadcastSpaceModeCode===2?"arena":state.broadcastSpaceModeCode===1?"live":"studio",personalEnabled:Boolean(state.broadcastPersonalEnabled),personalBass:clamp(state.broadcastPersonalBass,-1,1,0),personalPresence:clamp(state.broadcastPersonalPresence,-1,1,0),personalBrightness:clamp(state.broadcastPersonalBrightness,-1,1,0),eqEnabled:Boolean(state.eqEnabled),eqGains:Array.isArray(state.eqGains)?state.eqGains.slice(0,31):new Array(31).fill(0),masterPrepEnabled:currentMasterPrep.enabled}};
function processorState(state:MvpStudioState){return {mode:state.bypass?0:state.broadcastModeCode===2?2:state.broadcastModeCode===1?1:0,profile:state.outputProfileCode===2?2:state.outputProfileCode===1?1:0,intensity:clamp(state.broadcastIntensity,0,1,.7),bass:Boolean(state.broadcastBassEnabled),bassCharacter:clamp(state.broadcastBassCharacter,0,1,.5),impact:Boolean(state.broadcastImpactEnabled),clarity:Boolean(state.broadcastClarityEnabled),spatial:Boolean(state.broadcastSpatialEnabled),spaceMode:state.broadcastSpaceModeCode===2?2:state.broadcastSpaceModeCode===1?1:0,personal:Boolean(state.broadcastPersonalEnabled),personalBass:clamp(state.broadcastPersonalBass,-1,1,0),personalPresence:clamp(state.broadcastPersonalPresence,-1,1,0),personalBrightness:clamp(state.broadcastPersonalBrightness,-1,1,0),eq:Boolean(state.eqEnabled),eqGains:Array.isArray(state.eqGains)?state.eqGains.slice(0,31).map((v:any)=>clamp(v,-12,12,0)):new Array(31).fill(0),masterPrepEnabled:currentMasterPrep.enabled&&state.broadcastModeCode!==0,masterSourceGainDb:currentMasterPrep.sourceGainDb,masterHighpassHz:currentMasterPrep.highpassHz,masterLowMidDb:currentMasterPrep.lowMidDb,masterPresenceDb:currentMasterPrep.presenceDb,masterHarshnessDb:currentMasterPrep.harshnessDb,masterBalanceDb:currentMasterPrep.balanceDb,masterWidthScale:currentMasterPrep.widthScale};}

export async function createMvpStudioNode(context:AudioContext){
  if(!context.audioWorklet)throw new Error("AudioWorklet unavailable");
  if(!loadedContexts.has(context)){await context.audioWorklet.addModule("/audioV7/mvpSoundV7.worklet.js?v="+ASSET_VERSION);loadedContexts.add(context)}
  const node=new AudioWorkletNode(context,"mvp-sound-v7",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:"explicit",channelInterpretation:"speakers"});
  node.port.onmessage=(event)=>{
    const data=event.data||{};
    if(data.type==="ready"){runtime={...runtime,ready:true,faulted:false,processorVersion:String(data.version||"mvp-sound-v7-3-song-aware-authority"),lastError:null};return}
    if(data.type==="ack"){const revision=Number(data.revision)||0;appliedByNode.set(node,revision);runtime={...runtime,ready:true,appliedRevision:revision,lastAppliedAt:Date.now()};return}
    if(data.type==="proofAck"){proofAckByNode.set(node,{id:Number(data.requestId)||0,enabled:Boolean(data.enabled)});return}
    if(data.type==="telemetry"){
      const limiter=Math.max(0,Number(data.limiterGrDb)||0),delta=Number(data.rmsDeltaDb)||0;
      telemetry={...EMPTY,inputPeak:Number(data.inputPeak)||0,outputPeak:Number(data.outputPeak)||0,inputRms:Number(data.inputRms)||0,outputRms:Number(data.outputRms)||0,gainReductionDb:limiter,limiterGain:Math.pow(10,-limiter/20),truePeakDbtp:Number(data.truePeakDbtp)||-120,transientBoostDb:Number(data.impactBoostDb)||0,stereoWidthPercent:Number(data.spatialWidthPercent)||100,headphoneOutputDriveDb:delta,loudnessGainDb:delta,finalCompressorReductionDb:limiter,maxHdInputTruePeakDbtp:Number(data.truePeakDbtp)||-120,availableHeadroomDb:Math.max(0,-(Number(data.truePeakDbtp)||-24)),internalPeak:Number(data.outputPeak)||0};
    }
  };
  runtime={...runtime,ready:true,faulted:false,lastError:null};return node;
}

export function activateMvpStudioNode(node:AudioWorkletNode|null){activeNode=node;runtime={...runtime,ready:Boolean(node),faulted:false}}
export function disposeMvpStudioNode(node:AudioWorkletNode|null){if(!node)return;try{node.disconnect()}catch{}try{node.port.close()}catch{}if(activeNode===node)activeNode=null}
export function setMvpStudioState(node:AudioWorkletNode|null,state:MvpStudioState){if(!node)return 0;const revision=++nextRevision;requestedByNode.set(node,revision);stateByNode.set(node,{...state});const view=publicState(state);runtime={...runtime,ready:true,requestedRevision:revision,lastRequestedAt:Date.now(),appliedState:view};node.port.postMessage({type:"state",revision,state:processorState(state)});return revision}
export function repostMvpStudioState(node:AudioWorkletNode|null=activeNode){if(!node)return 0;const state=stateByNode.get(node);return state?setMvpStudioState(node,state):0}
export async function waitForMvpStudioRevision(node:AudioWorkletNode|null,revision:number,timeoutMs=500){if(!node||revision<=0)return false;const start=Date.now();while(Date.now()-start<timeoutMs){if((appliedByNode.get(node)||0)>=revision)return true;await new Promise(r=>setTimeout(r,12))}return false}
let proofRequest=0;
export async function setMvpStudioProofMute(node:AudioWorkletNode|null,enabled:boolean,timeoutMs=700){if(!node)return false;const requestId=++proofRequest;node.port.postMessage({type:"proofMute",requestId,enabled:Boolean(enabled)});const start=Date.now();while(Date.now()-start<timeoutMs){const ack=proofAckByNode.get(node);if(ack&&ack.id===requestId&&ack.enabled===Boolean(enabled))return true;await new Promise(r=>setTimeout(r,12))}return false}
export function resetMvpStudioLoudness(node:AudioWorkletNode|null=activeNode){node?.port.postMessage({type:"reset"})}
export function getMvpStudioTelemetry():MvpStudioTelemetry{return telemetry}
export function getMvpStudioRuntimeInfo():MvpStudioRuntimeInfo{return {...runtime}}
export function setMvpStudioMasterPrep(profile:unknown){
  const raw=profile&&typeof profile==="object"?profile as Record<string,unknown>:null;
  currentMasterPrep=raw?{enabled:Boolean(raw.enabled),sourceGainDb:clamp(raw.sourceGainDb,0,3,0),highpassHz:clamp(raw.highpassHz,18,40,18),lowMidDb:clamp(raw.lowMidDb,-3,2,0),presenceDb:clamp(raw.presenceDb,-2,2,0),harshnessDb:clamp(raw.harshnessDb,-3,1,0),balanceDb:clamp(raw.channelBalanceDb??raw.balanceDb,-1.5,1.5,0),widthScale:clamp(raw.widthScale,.75,1.10,1)}:{...DEFAULT_PREP};
  if(activeNode)repostMvpStudioState(activeNode);
}
export function setMvpStudioVenue(_profile:MvpStudioVenueProfile|null){}
