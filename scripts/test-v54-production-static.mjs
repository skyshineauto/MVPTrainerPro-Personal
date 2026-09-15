import fs from 'node:fs';
import assert from 'node:assert/strict';
const read=(p)=>fs.readFileSync(p,'utf8');
const cpp=read('dsp/v2/mvp_hd_v2.cpp');
const worklet=read('public/audioV2/mvpHdV2.worklet.js');
const bridge=read('src/lib/audio/mvpStudioEngine.ts');
const player=read('src/lib/musicPlayer.ts');
const workflow=read('.github/workflows/mvp-hd-v2-wasm.yml');
const routeTest=read('scripts/test-v54-worklet-route.mjs');
const browserEntry=read('scripts/test-mvp-hd-v2-browser.mjs');
assert.match(cpp,/V5\.5\.1 STABLE LIVE CONTROLS/);
assert.match(cpp,/boundedDeltaScale/);
assert.match(cpp,/gImpactFast-gImpactSlow\*1\.18f/,'Impact steady-state distortion guard missing');
assert.match(cpp,/gImpactSlow\+\.050f/,'Impact detector floor missing');
assert.doesNotMatch(cpp,/\(gImpactFast-gImpactSlow\)\/\(gImpactSlow\+\.035f\)/,'Old Impact modulation formula returned');
assert.doesNotMatch(cpp,/2\.8f\+1\.2f\*gBassCharacter/);
assert.doesNotMatch(cpp,/impactTrim/);
assert.doesNotMatch(cpp,/clarityTrim/);
assert.doesNotMatch(cpp,/stackTrimDb/);
assert.match(worklet,/broadcast-v5-4/);
assert.match(worklet,/STATE_APPLIED/);
assert.match(worklet,/appliedState:next/);
assert.match(worklet,/signature:this\.appliedSignature/);
assert.match(worklet,/SET_PROOF_MUTE/,'Worklet route proof mute missing');
assert.match(bridge,/10\.0\.7-broadcast-v5-5-4-exact-state-lock/);
assert.match(bridge,/const rawApplied = data\.appliedState/);
assert.match(bridge,/appliedState: actualAppliedState \?\? runtimeInfo\.appliedState/);
assert.match(player,/v26-broadcast-v5-5-live-controls/);
assert.match(player,/String\(applied\.mode\) !== expectedMode/);
assert.match(player,/Boolean\(applied\.bassEnabled\)/);
assert.match(player,/simpleEffectSupportDb/);
assert.match(routeTest,/SET_PROOF_MUTE/,'Route validation must exercise processor mute');
assert.match(routeTest,/proof mute leaked audio/,'Route validation must fail on a dry leak');
assert.match(browserEntry,/test-v54-production-static\.mjs/);
assert.doesNotMatch(browserEntry,/test-v53-production-static\.mjs/,'Stale V5.3 browser wrapper returned');
assert.match(workflow,/MVP Broadcast V5\.4 WASM Build/);
assert.match(workflow,/test-v54-audibility\.mjs/);
assert.match(workflow,/test-v54-distortion\.mjs/,'Distortion gate missing from workflow');
assert.match(workflow,/test-v54-matrix\.mjs/);
assert.match(workflow,/test-v54-worklet-route\.mjs/);
assert.doesNotMatch(
  player,
  /experienceMode === "pure" \? "device_direct" : "mvp_hd"/,
  "Pure profile restore must not switch away from WASM"
);

assert.doesNotMatch(
  player,
  /mode === "pure" \? "device_direct" : "mvp_hd"/,
  "Pure Adaptive Power must use one WASM route"
);

assert.doesNotMatch(
  cpp,
  /float sl=l,sr=r/,
  "Pure must not discard enabled effects"
);

assert.match(
  cpp,
  /gEqEnabled\|\|/,
  "Pure effect safety processing is missing"
);

// V5.5.4 exact-state-lock guards.
assert.match(bridge,/loadedWorkletContexts/,'Per-context Worklet ownership guard missing');
assert.match(bridge,/lastRequestedAtByNode/,'Per-node request timing guard missing');
assert.match(player,/activateMvpStudioNode\(studioProcessorNode\)/,'Initial audible Studio node is not activated');
assert.match(player,/currentStateIsLive/,'Applied-state verification guard missing');
assert.match(player,/broadcastBassEnabled: mode !== "off"|broadcastBassEnabled: true/,'Simple Bass is not mapped to Broadcast state');

console.log('V5.5.4 exact state-lock production static wiring: PASS');
