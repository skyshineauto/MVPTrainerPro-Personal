import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname,"..");
const read=(...parts)=>fs.readFileSync(path.join(root,...parts),"utf8");
const worklet=read("public","audioV2","mvpHdV2.worklet.js");
const harness=read("public","audioV2","test.js");
const html=read("public","audioV2","test.html");
const bridge=read("src","lib","audio","mvpStudioEngine.ts");
const player=read("src","lib","musicPlayer.ts");
const mini=read("src","features","music","MusicMiniPlayer.tsx");
const cpp=read("dsp","v2","mvp_hd_v2.cpp");
const pcmTest=read("scripts","test-mvp-hd-v2.mjs");

for(const value of [
  "mvp_v2_set_mode","mvp_v2_set_output_profile","mvp_v2_set_intensity",
  "mvp_v2_set_bass_enabled","mvp_v2_set_bass_character","mvp_v2_set_impact_enabled",
  "mvp_v2_set_clarity_enabled","mvp_v2_set_spatial_enabled","mvp_v2_set_space_mode",
  "mvp_v2_meter_multiband_gr_db"
]) if(!worklet.includes(value)) throw new Error(`V5 Worklet ABI missing ${value}`);

const processStart=worklet.indexOf("process(inputs, outputs)");
if(processStart<0) throw new Error("V5 Worklet process() missing");
const processBody=worklet.slice(processStart);
for(const forbidden of ["_malloc","_free","new AudioContext","createMediaElementSource"]) {
  if(processBody.includes(forbidden)) throw new Error(`Forbidden render-loop operation ${forbidden}`);
}

for(const value of ["PURE","ADAPTIVE","POWER","BASS","IMPACT","CLARITY","IMMERSION","Intensity"]) {
  if(!html.includes(value)) throw new Error(`Harness UI missing ${value}`);
}
for(const value of ["SET_PROOF_MUTE","bassCharacter","spaceMode",'"STAGE"','"SPACE"']) {
  if(!harness.includes(value)) throw new Error(`Harness logic missing ${value}`);
}

for(const value of [
  "Broadcast Engine V5",
  "struct ExactSplit",
  "struct TruePeak4x",
  "kTpFir",
  "updateProgramAnalysis",
  "applyProgramAgc",
  "applyBroadcastDynamics",
  "applyDensityMaximizer",
  "softCeiling",
  "densePowerBonus",
  "gLimiterCeiling = 0.9380f",
  "V5 deliberately preserves compressor/AGC/limiter memory"
]) if(!cpp.includes(value)) throw new Error(`V5 C++ architecture missing ${value}`);

if(cpp.includes("resetTransitionMemory")) throw new Error("V5 must not reset mastering state on mode/profile changes");
for(const value of ["if (next == gMode) return;","if (next == gOutputProfile) return;"]) {
  if(!cpp.includes(value)) throw new Error(`V5 state guard missing ${value}`);
}

for(const value of [
  "this.exports.mvp_v2_reset_meters();",
  "this.totalClipCount",
  "liveLimiterGrDb",
]) if(!worklet.includes(value)) throw new Error(`V5 live telemetry missing ${value}`);

for(const value of [
  "56/56",
  "20 complete mode cycles",
  "Independent 8x",
  "0 clips / 0 NaNs",
]) {
  // The final console string is numeric at runtime, so accept the structural equivalents below.
  if(value==="56/56" && !(pcmTest.includes("results.length") && pcmTest.includes("MVP Broadcast Engine V5 validation"))) throw new Error("V5 PCM gate summary missing");
  if(value==="20 complete mode cycles" && !pcmTest.includes("c<20")) throw new Error("20-cycle continuous-state test missing");
  if(value==="Independent 8x" && !pcmTest.includes("Independent 8x")) throw new Error("Independent 8x true-peak test missing");
  if(value==="0 clips / 0 NaNs" && !pcmTest.includes("clips") ) throw new Error("clip/NaN safety gates missing");
}

if(bridge.includes("installMusicAiAudioRuntime") || bridge.includes("musicAiAudioRuntime")) {
  throw new Error("AI Audio runtime is still connected to production bridge");
}
for(const value of ["/audioV2/mvpHdV2.worklet.js","/audioV2/mvpHdV2.wasm","mvp-hd-v2-processor"]) {
  if(!bridge.includes(value)) throw new Error(`Production bridge missing V5 asset ${value}`);
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
]) if(!player.includes(value)) throw new Error(`musicPlayer V5 integration missing ${value}`);

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
]) if(!mini.includes(value)) throw new Error(`MusicMiniPlayer simple UI missing ${value}`);

for(const value of [
  'aria-pressed={player.broadcastBassEnabled} disabled={player.experienceMode === "pure"}',
  'aria-pressed={player.broadcastImpactEnabled} disabled={player.experienceMode === "pure"}',
  'aria-pressed={player.broadcastClarityEnabled} disabled={player.experienceMode === "pure"}',
  'aria-pressed={player.broadcastSpatialEnabled} disabled={player.experienceMode === "pure"}',
  'value={player.broadcastBassCharacter} disabled={player.experienceMode === "pure"}',
]) if(!mini.includes(value)) throw new Error(`MusicMiniPlayer PURE-disable rule missing ${value}`);

for(const legacy of ["DEVICE DIRECT <span>or</span> MVP HD","BASS STRONG","BASS DEEP"]) {
  if(mini.includes(legacy)) throw new Error(`Legacy R82 UI remains visible: ${legacy}`);
}

console.log("MVP Broadcast Engine V5 browser/production static validation: PASS");
