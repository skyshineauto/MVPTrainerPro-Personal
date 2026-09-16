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

assert.match(cpp,/V5\.7 PERCEPTUAL AUDIBILITY/);
assert.match(cpp, /mvp_v2_build_id\(\)\{return 5700u;\}/);
assert.match(cpp, /mvp_v2_get_mode/);
assert.match(cpp, /mvp_v2_get_intensity/);
assert.match(cpp, /mvp_v2_get_bass_enabled/);
assert.match(cpp, /mvp_v2_get_personal_brightness/);
assert.match(cpp, /mvp_v2_get_eq_band/);

assert.match(cpp, /boundedDeltaScale/);
assert.match(
  cpp,
  /gImpactFast\s*-\s*gImpactSlow\s*\*\s*1\.18f/,
  "Impact steady-state distortion guard missing",
);
assert.match(
  cpp,
  /gImpactSlow\s*\+\s*\.050f/,
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

assert.match(worklet, /broadcast-v5-7-perceptual-audibility/);
assert.match(worklet,/MVP_V57_ENGINE_BUILD_ID = 5700/);
assert.match(worklet,/MVP_V57_SUPPORTED_ENGINE_BUILD_IDS = new Set\(\[5600, 5700\]\)/);
assert.match(worklet, /nativeStateMismatch/);
assert.match(worklet, /mvp_v2_get_mode/);
assert.match(worklet, /mvp_v2_get_eq_band/);
assert.match(worklet, /STATE_APPLIED/);
assert.match(worklet,/engineBuildId: this\.engineBuildId/);
assert.match(worklet, /SET_PROOF_MUTE/);
assert.match(worklet, /requestId/);

assert.match(
  bridge,
  /10\.0\.10-broadcast-v5-7-rollout-compat/,
);
assert.match(bridge,/EXPECTED_ENGINE_BUILD_ID = 5700/);
assert.match(bridge,/SUPPORTED_ENGINE_BUILD_IDS = new Set\(\[5600, 5700\]\)/);
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

assert.match(player, /alreadyLive/);
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

assert.match(
  player,
  /MVP_V561_SINGLE_WRITER_CONTROLS/,
  "V5.6.1 single-writer marker missing",
);

assert.match(
  ui,
  /function runBroadcastMutation/,
  "Broadcast controls do not have an isolated single writer",
);

assert.doesNotMatch(
  ui,
  /if \(player\.dspStatus !== "active"\) void recoverMusicDsp\(\)/,
  "UI still launches asynchronous recovery from stale React state",
);

const broadcastStartV561 =
  ui.indexOf(
    "{/* MVP_BROADCAST_V3_SIMPLE_UI */}",
  );

const broadcastEndV561 =
  ui.indexOf(
    '{player.outputProfile === "headphones" ? (',
    broadcastStartV561,
  );

assert.ok(
  broadcastStartV561 >= 0 &&
  broadcastEndV561 >
    broadcastStartV561,
  "Broadcast panel boundaries missing",
);

const broadcastV561 =
  ui.slice(
    broadcastStartV561,
    broadcastEndV561,
  );

assert.doesNotMatch(
  broadcastV561,
  /runDspMutation\(/,
  "Broadcast controls still share the EQ/recovery mutation wrapper",
);

assert.match(
  broadcastV561,
  /runBroadcastMutation\(/,
  "Broadcast controls are not using the single-writer wrapper",
);

const settleStartV561 =
  player.indexOf(
    "function scheduleProcessingSettle",
  );

const settleEndV561 =
  player.indexOf(
    "function setDspTelemetry",
    settleStartV561,
  );

const settleV561 =
  player.slice(
    settleStartV561,
    settleEndV561,
  );

assert.doesNotMatch(
  settleV561,
  /verifyOrRecoverStudioLiveState/,
  "Normal control settling still starts recovery",
);

const verifyStartV561 =
  player.indexOf(
    "async function verifyOrRecoverStudioLiveState",
  );

const verifyEndV561 =
  player.indexOf(
    "let cleanHdRouteRecoveryTimer",
    verifyStartV561,
  );

const verifyV561 =
  player.slice(
    verifyStartV561,
    verifyEndV561,
  );

assert.doesNotMatch(
  verifyV561,
  /hotSwapStudioProcessor/,
  "State verification can still replace the audible processor",
);

assert.match(
  player,
  /studioAudibleRouteVerified = true;[\s\S]{0,120}studioAudibleRouteProofFailures = 0;/,
  "Initial verified single route is not locked",
);

console.log(
  "V5.6.1 single-writer live-control wiring: PASS",
);


/* V5.7 perceptual DSP guards */
assert.match(cpp,/V5\.7 PERCEPTUAL AUDIBILITY/);
assert.match(cpp,/applyEmergencyPeakGuard/);
assert.match(cpp,/base>=cap\)\s*return \.35f/);
assert.match(cpp,/gSpaceMode==2/);
assert.match(cpp,/1\.78f\+\.45f\*gIntensity/);
assert.match(cpp,/1\.66f\+\.36f\*gIntensity/);
assert.match(cpp,/2\.40f\+4\.80f\*gIntensity/);
console.log("V5.7 perceptual DSP guards: PASS");
