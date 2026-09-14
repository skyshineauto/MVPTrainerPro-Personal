// V5.4 production-route static validation entry point.
// The executable AudioWorklet/WASM route is validated separately by test-v54-worklet-route.mjs.
import fs from 'node:fs';
import assert from 'node:assert/strict';
await import('./test-v54-production-static.mjs');
const player=fs.readFileSync(new URL('../src/lib/musicPlayer.ts',import.meta.url),'utf8');
assert.match(player,/mediaSource\.connect\(masterVolumeGain\)/,'MediaElement must enter the Web Audio graph');
assert.match(player,/masterVolumeGain\.connect\(studioDirectInputGain\)/,'Studio input route missing');
assert.match(player,/studioDirectInputGain\.connect\(studioInputBus\)/,'Studio input bus missing');
assert.match(player,/studioInputBus\.connect\(studioProcessorNode\)/,'WASM processor is not in the audible route');
assert.match(player,/studioProcessorNode\.connect\(studioProcessorRouteGain\)/,'WASM output route missing');
assert.match(player,/studioProcessorRouteGain\.connect\(standardRouteGain\)/,'Processed route gain missing');
assert.match(player,/standardRouteGain\.connect\(mixBus\)/,'Processed route does not reach the mix bus');
assert.match(player,/musicGain\.connect\(context\.destination\)/,'Final music output is not connected');
assert.match(player,/levelMeterSink\.gain\.value = 0/,'Meter-only branch must remain inaudible');
assert.doesNotMatch(player,/mediaSource\.connect\(context\.destination\)/,'Forbidden dry MediaElement destination bypass');
assert.doesNotMatch(player,/masterVolumeGain\.connect\(mixBus\)/,'Forbidden parallel dry master route');
console.log('MVP Broadcast V5.4 production route static validation: PASS');
