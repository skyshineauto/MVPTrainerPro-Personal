import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const root=path.resolve(__dirname,"..");
const worklet=fs.readFileSync(path.join(root,"public","audioV2","mvpHdV2.worklet.js"),"utf8");
const harness=fs.readFileSync(path.join(root,"public","audioV2","test.js"),"utf8");
const html=fs.readFileSync(path.join(root,"public","audioV2","test.html"),"utf8");
const bridge=fs.readFileSync(path.join(root,"src","lib","audio","mvpStudioEngine.ts"),"utf8");
const player=fs.readFileSync(path.join(root,"src","lib","musicPlayer.ts"),"utf8");
const mini=fs.readFileSync(path.join(root,"src","features","music","MusicMiniPlayer.tsx"),"utf8");

for(const value of [
  "mvp_v2_set_mode","mvp_v2_set_output_profile","mvp_v2_set_intensity",
  "mvp_v2_set_bass_enabled","mvp_v2_set_bass_character","mvp_v2_set_impact_enabled",
  "mvp_v2_set_clarity_enabled","mvp_v2_set_spatial_enabled","mvp_v2_set_space_mode",
  "mvp_v2_meter_multiband_gr_db"
]) if(!worklet.includes(value)) throw new Error(`V3 Worklet missing ${value}`);

const processStart=worklet.indexOf("process(inputs, outputs)");
if(processStart<0) throw new Error("V3 Worklet process() missing");
const processBody=worklet.slice(processStart);
for(const forbidden of ["_malloc","_free","new AudioContext","createMediaElementSource"]) {
  if(processBody.includes(forbidden)) throw new Error(`Forbidden render-loop operation ${forbidden}`);
}

for(const value of ["PURE","ADAPTIVE","POWER","BASS","IMPACT","CLARITY","IMMERSION","Intensity"]) {
  if(!html.includes(value)) throw new Error(`V3 harness UI missing ${value}`);
}
for(const value of ["BROADCAST V3 PROOF","SET_PROOF_MUTE","bassCharacter","spaceMode",'"STAGE"','"SPACE"']) {
  if(!harness.includes(value)) throw new Error(`V3 harness logic missing ${value}`);
}

if(bridge.includes("installMusicAiAudioRuntime") || bridge.includes("musicAiAudioRuntime")) {
  throw new Error("AI Audio runtime is still connected to production bridge");
}
for(const value of ["/audioV2/mvpHdV2.worklet.js","/audioV2/mvpHdV2.wasm","mvp-hd-v2-processor"]) {
  if(!bridge.includes(value)) throw new Error(`Production bridge missing V3 asset ${value}`);
}

for(const value of [
  'MusicExperienceMode = "pure" | "adaptive" | "power"',
  "setMusicExperienceMode",
  "setMusicHdIntensity",
  "setMusicBroadcastBassEnabled",
  "setMusicBroadcastImpact",
  "setMusicBroadcastClarity",
  "setMusicBroadcastSpatial",
  "broadcastModeCode",
  "broadcastIntensity"
]) if(!player.includes(value)) throw new Error(`musicPlayer V3 integration missing ${value}`);

for(const value of [
  'MVP_BROADCAST_V3_SIMPLE_UI',
  '["pure","adaptive","power"]',
  'mode.toUpperCase()',
  '>BASS</button>',
  '>IMPACT</button>',
  '>CLARITY</button>',
  '"IMMERSION"',
  '"STAGE"',
  '"SPACE"',
  '>INTENSITY</span>',
  'setMusicExperienceMode',
]) {
  if(!mini.includes(value)) throw new Error(`MusicMiniPlayer V3 UI missing ${value}`);
}
for(const legacy of ["DEVICE DIRECT <span>or</span> MVP HD","BASS STRONG","BASS DEEP"]) {
  if(mini.includes(legacy)) throw new Error(`Legacy R82 UI remains visible: ${legacy}`);
}

console.log("MVP Broadcast Engine V3 browser/production static validation: PASS");
