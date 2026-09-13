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
const legacyTest=read("scripts","test-mvp-hd-v2.mjs");
const strictTest=read("scripts","test-mvp-hd-v2-v5.mjs");
const enrichment=read("src","lib","musicIntelligenceEnrichment.ts");
const audioIntelligence=read("src","lib","musicAudioIntelligence.ts");
const intelligenceCache=read("src","lib","musicIntelligenceCache.ts");
const audioWorker=read("src","workers","musicAudioIntelligence.worker.ts");

for(const value of [
  "mvp_v2_set_mode","mvp_v2_set_output_profile","mvp_v2_set_intensity",
  "mvp_v2_set_bass_enabled","mvp_v2_set_bass_character","mvp_v2_set_impact_enabled",
  "mvp_v2_set_clarity_enabled","mvp_v2_set_spatial_enabled","mvp_v2_set_space_mode",
  "mvp_v2_set_personal_enabled","mvp_v2_set_personal_bass","mvp_v2_set_personal_presence",
  "mvp_v2_set_personal_brightness","mvp_v2_set_master_prep","mvp_v2_meter_multiband_gr_db"
]) if(!worklet.includes(value)) throw new Error(`V5.1 Worklet ABI missing ${value}`);

const processStart=worklet.indexOf("process(inputs, outputs)");
if(processStart<0) throw new Error("V5.1 Worklet process() missing");
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
  "Broadcast Engine V5.1",
  "struct ExactSplit",
  "struct TruePeak4x",
  "kTpFir",
  "updateProgramAnalysis",
  "applyProgramAgc",
  "applyBroadcastDynamics",
  "applyDensityMaximizer",
  "applyMasterPrep",
  "configureMasterPrep",
  "maxBoostDb",
  "gLimiterCeiling = 0.9380f",
  "V5 deliberately preserves compressor/AGC/limiter memory"
]) if(!cpp.includes(value)) throw new Error(`V5.1 C++ architecture missing ${value}`);

if(cpp.includes("resetTransitionMemory")) throw new Error("V5.1 must not reset mastering state on mode/profile changes");
for(const value of ["if (next == gMode) return;","if (next == gOutputProfile) return;"]) {
  if(!cpp.includes(value)) throw new Error(`V5.1 state guard missing ${value}`);
}

for(const value of [
  "this.exports.mvp_v2_reset_meters();",
  "this.totalClipCount",
  "liveLimiterGrDb",
]) if(!worklet.includes(value)) throw new Error(`V5.1 live telemetry missing ${value}`);

if(!(legacyTest.includes("results.length") && legacyTest.includes("MVP Broadcast Engine V5 validation"))) {
  throw new Error("Legacy 56-gate PCM validation is missing");
}
if(!legacyTest.includes("c<20") || !legacyTest.includes("Independent 8x") || !legacyTest.includes("clips")) {
  throw new Error("Legacy continuous-state/true-peak safety validation is incomplete");
}
for(const value of [
  "MVP Broadcast Engine V5.1 validation",
  "Personal Presence has a real range",
  "Master Prep can recover clean source level",
  "Master Prep",
  "Impact boost is bounded",
]) if(!strictTest.includes(value)) throw new Error(`V5.1 strict PCM validation missing ${value}`);

if(bridge.includes("installMusicAiAudioRuntime") || bridge.includes("musicAiAudioRuntime")) {
  throw new Error("AI Audio runtime is still connected to production bridge");
}
for(const value of [
  "/audioV2/mvpHdV2.worklet.js","/audioV2/mvpHdV2.wasm","mvp-hd-v2-processor",
  "setMvpStudioMasterPrep","masterPrepEnabled","masterSourceGainDb","broadcast-v5-1"
]) if(!bridge.includes(value)) throw new Error(`Production bridge missing V5.1 asset/state ${value}`);

for(const value of [
  'MusicExperienceMode = "pure" | "adaptive" | "power"',
  "setMusicExperienceMode",
  "setMusicHdIntensity",
  "setMusicBroadcastBassEnabled",
  "setMusicBroadcastImpact",
  "setMusicBroadcastClarity",
  "setMusicBroadcastSpatial",
  "broadcastModeCode",
  "broadcastIntensity",
  "getMusicTrackIntelligence",
  "setMvpStudioMasterPrep",
  "analysisVersion >= 5"
]) if(!player.includes(value)) throw new Error(`musicPlayer V5.1 integration missing ${value}`);

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
  '<span className="tr-dspCornerLabel">SOUND</span>',
  '<span>SOUND</span>',
  '<strong>MVP SOUND</strong>',
  '<MusicTodayAi />'
]) if(!mini.includes(value)) throw new Error(`MusicMiniPlayer V5.1 UI missing ${value}`);

for(const value of [
  'aria-pressed={player.broadcastBassEnabled} disabled={player.experienceMode === "pure"}',
  'aria-pressed={player.broadcastImpactEnabled} disabled={player.experienceMode === "pure"}',
  'aria-pressed={player.broadcastClarityEnabled} disabled={player.experienceMode === "pure"}',
  'aria-pressed={player.broadcastSpatialEnabled} disabled={player.experienceMode === "pure"}',
  'value={player.broadcastBassCharacter} disabled={player.experienceMode === "pure"}',
]) if(!mini.includes(value)) throw new Error(`MusicMiniPlayer PURE-disable rule missing ${value}`);

for(const removed of ["data-mvp-ai-audio-trigger","mvp:ai-audio-toggle","Open AI Audio","tr-aiAudioPlayerCornerDock"]) {
  if(mini.includes(removed)) throw new Error(`Removed AI Sound player hook remains: ${removed}`);
}
for(const legacy of ["DEVICE DIRECT <span>or</span> MVP HD","BASS STRONG","BASS DEEP"]) {
  if(mini.includes(legacy)) throw new Error(`Legacy R82 UI remains visible: ${legacy}`);
}

if(!enrichment.includes("MUSIC_INTELLIGENCE_VERSION = 5")) throw new Error("Music Intelligence version was not bumped to V5");
for(const value of ["audio_analysis: facts.technical","master_prep: facts.masterPrep","mvp-master-prep"]) {
  if(!enrichment.includes(value)) throw new Error(`Enrich/Master Prep persistence missing ${value}`);
}
for(const removed of ["aiAutoSound","ai_auto_sound","facts.autoSound"]) {
  if(enrichment.includes(removed)) throw new Error(`AI Auto Sound remains in enrichment: ${removed}`);
}
for(const removed of ["MusicAiAutoSoundRecommendation","MusicAiAutoSoundProfiles","autoSound:"]) {
  if(audioIntelligence.includes(removed)) throw new Error(`AI Auto Sound remains in audio intelligence types: ${removed}`);
}
for(const removed of ["MusicAiAutoSoundProfiles","aiAutoSound"]) {
  if(intelligenceCache.includes(removed)) throw new Error(`AI Auto Sound remains in intelligence cache: ${removed}`);
}
for(const removed of ["MusicAiAutoSoundProfiles","buildAutoSound","const autoSound","autoSound,"]) {
  if(audioWorker.includes(removed)) throw new Error(`AI Auto Sound remains in analysis worker: ${removed}`);
}
for(const kept of ["buildTechnical","buildMasterPrep","technical,","masterPrep,"]) {
  if(!audioWorker.includes(kept)) throw new Error(`Technical/Master Prep analysis regressed: ${kept}`);
}

console.log("MVP Broadcast Engine V5.1 browser/production static validation: PASS");
