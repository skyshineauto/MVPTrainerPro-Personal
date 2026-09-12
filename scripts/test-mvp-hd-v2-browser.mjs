import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');

const workletPath = path.join(root, 'public', 'audioV2', 'mvpHdV2.worklet.js');
const harnessPath = path.join(root, 'public', 'audioV2', 'test.js');
const htmlPath = path.join(root, 'public', 'audioV2', 'test.html');

const worklet = fs.readFileSync(workletPath, 'utf8');
const harness = fs.readFileSync(harnessPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

for (const required of [
  "type: 'PROOF_MUTE_APPLIED'",
  'inputEnergy',
  'outputEnergy',
  'rmsDeltaDb',
  'state: this.appliedState',
  'proofMute',
  'mvp_v2_process(chunk)',
]) {
  if (!worklet.includes(required)) throw new Error(`R3 Worklet proof requirement missing: ${required}`);
}

for (const required of [
  'RUN AUDIO PROOF',
  'PROOF MUTE',
  'Output / Input',
  'Applied State',
]) {
  if (!html.includes(required)) throw new Error(`R3 harness UI requirement missing: ${required}`);
}

for (const required of [
  'AUDIO PROOF',
  'ROUTE PASS',
  "captureStep('direct')",
  "captureStep('normal')",
  "captureStep('loud'",
  "captureStep('max'",
  'SET_PROOF_MUTE',
]) {
  if (!harness.includes(required)) throw new Error(`R3 harness logic requirement missing: ${required}`);
}

const processStart = worklet.indexOf('process(inputs, outputs)');
if (processStart < 0) throw new Error('Worklet process() missing.');
const processBody = worklet.slice(processStart);

for (const forbidden of ['_malloc', '_free', 'new AudioContext', 'createMediaElementSource']) {
  if (processBody.includes(forbidden)) throw new Error(`Forbidden real-time operation: ${forbidden}`);
}

console.log('MVP HD V2 Stage 2 R3 Windows-safe route-proof validation: PASS');
