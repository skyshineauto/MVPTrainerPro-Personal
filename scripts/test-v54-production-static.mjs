import fs from "node:fs";
import assert from "node:assert/strict";

const read = (p) => fs.readFileSync(p, "utf8");

const cpp = read("dsp/v2/mvp_hd_v2.cpp");
const buildScript = read("scripts/build-mvp-hd-v2.sh");
const worklet = read("public/audioV2/mvpHdV2.worklet.js");
const bridge = read("src/lib/audio/mvpStudioEngine.ts");
const player = read("src/lib/musicPlayer.ts");
const ui = read("src/features/music/MusicMiniPlayer.tsx");
const workflow = read(".github/workflows/mvp-hd-v2-wasm.yml");
const routeTest = read("scripts/test-v54-worklet-route.mjs");
const browserEntry = read("scripts/test-mvp-hd-v2-browser.mjs");

assert.match(cpp, /V5\.6 AUDIBLE CONTRACT/);
assert.match(cpp, /mvp_v2_build_id\(\)\{return 5600u;\}/);
assert.match(cpp, /mvp_v2_get_mode/);
assert.match(cpp, /mvp_v2_get_intensity/);
assert.match(cpp, /mvp_v2_get_bass_enabled/);
assert.match(cpp, /mvp_v2_get_personal_brightness/);
assert.match(cpp, /mvp_v2_get_eq_band/);

assert.match(cpp, /boundedDeltaScale/);
assert.match(
  cpp,
  /gImpactFast-gImpactSlow\*1\.18f/,
  "Impact steady-state distortion guard missing",
);
assert.match(
  cpp,
  /gImpactSlow\+\.050f/,
  "Impact detector floor missing",
);
assert.doesNotMatch(
  cpp,
  /\(gImpactFast-gImpactSlow\)\/\(gImpactSlow\+\.035f\)/,
);
assert.doesNotMatch(cpp, /2\.8f\+1\.2f\*gBassCharacter/);
assert.doesNotMatch(cpp, /impactTrim/);
assert.doesNotMatch(cpp, /clarityTrim/);
assert.doesNotMatch(cpp, /stackTrimDb/);

assert.match(buildScript, /--export=mvp_v2_build_id/);
assert.match(buildScript, /--export=mvp_v2_get_mode/);
assert.match(buildScript, /--export=mvp_v2_get_eq_band/);

assert.match(worklet, /broadcast-v5-6-audible-contract/);
assert.match(worklet, /MVP_V56_ENGINE_BUILD_ID = 5600/);
assert.match(worklet, /nativeStateMismatch/);
assert.match(worklet, /mvp_v2_get_mode/);
assert.match(worklet, /mvp_v2_get_eq_band/);
assert.match(worklet, /STATE_APPLIED/);
assert.match(worklet, /engineBuildId: MVP_V56_ENGINE_BUILD_ID/);
assert.match(worklet, /SET_PROOF_MUTE/);
assert.match(worklet, /requestId/);

assert.match(
  bridge,
  /10\.0\.8-broadcast-v5-6-audible-contract/,
);
assert.match(bridge, /EXPECTED_ENGINE_BUILD_ID = 5600/);
assert.match(bridge, /setMvpStudioProofMute/);
assert.match(bridge, /PROOF_MUTE_APPLIED/);
assert.match(bridge, /proofAckByNode/);
assert.match(bridge, /const rawApplied = data\.appliedState/);
assert.doesNotMatch(
  bridge,
  /broadcastBassEnabled \?\? state\.bassEngineEnabled/,
  "Legacy Bass state can still override Broadcast state",
);

assert.match(player, /MVP_V56_AUDIBLE_ROUTE_CONTRACT/);
assert.match(player, /runStudioAudibleRouteProof/);
assert.match(player, /studioAudibleRouteVerified/);
assert.match(player, /setMvpStudioProofMute/);
assert.match(player, /WASM|studio_wasm/);

const graphStart = player.indexOf(
  "async function tryConnectStudioGraph",
);
const graphEnd = player.indexOf(
  "async function loadAdvancedDspModule",
  graphStart,
);

assert.ok(graphStart >= 0 && graphEnd > graphStart);
const graph = player.slice(graphStart, graphEnd);

assert.match(graph, /mediaSource\.connect\(masterVolumeGain\)/);
assert.match(
  graph,
  /studioDirectInputGain\.connect\(studioInputBus\)/,
);
assert.match(
  graph,
  /studioInputBus\.connect\(studioProcessorNode\)/,
);
assert.match(
  graph,
  /studioProcessorNode\.connect\(studioProcessorRouteGain\)/,
);
assert.match(
  graph,
  /studioProcessorRouteGain\.connect\(standardRouteGain\)/,
);
assert.match(
  graph,
  /standardRouteGain\.connect\(analyserNode\)/,
);
assert.match(graph, /musicGain\.connect\(context\.destination\)/);

assert.doesNotMatch(
  graph,
  /masterVolumeGain\.connect\(studioHrtfSplitter\)/,
  "Flagship route still contains parallel HRTF feed",
);
assert.doesNotMatch(
  graph,
  /standardRouteGain\.connect\(mixBus\)/,
  "Flagship route still contains unnecessary parallel mix bus",
);

assert.match(player, /currentStateIsLive/);
assert.match(player, /broadcastBassEnabled: true/);
assert.match(player, /Boolean\(applied\.bassEnabled\)/);

assert.match(
  ui,
  /WASM VERIFYING/,
  "UI still claims WASM ACTIVE before route verification",
);

assert.match(routeTest, /engineBuildId/);
assert.match(routeTest, /SET_PROOF_MUTE/);
assert.match(
  routeTest,
  /proof mute leaked audio/,
  "Route validation must fail on a dry leak",
);

assert.match(
  browserEntry,
  /test-v54-production-static\.mjs/,
);
assert.doesNotMatch(
  browserEntry,
  /test-v53-production-static\.mjs/,
);

assert.match(workflow, /test-v54-audibility\.mjs/);
assert.match(workflow, /test-v54-distortion\.mjs/);
assert.match(workflow, /test-v54-matrix\.mjs/);
assert.match(workflow, /test-v54-worklet-route\.mjs/);

assert.doesNotMatch(
  player,
  /experienceMode === "pure" \? "device_direct" : "mvp_hd"/,
);
assert.doesNotMatch(
  player,
  /mode === "pure" \? "device_direct" : "mvp_hd"/,
);

console.log(
  "V5.6 audible-route + native-state production static wiring: PASS",
);
