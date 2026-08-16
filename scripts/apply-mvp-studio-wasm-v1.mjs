#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const playerPath = path.join(root, "src/lib/musicPlayer.ts");
const miniPath = path.join(root, "src/features/music/MusicMiniPlayer.tsx");

function fail(message) {
  console.error(`\nMVP Studio installer stopped: ${message}\n`);
  process.exit(1);
}
const eolByFile = new Map();
function read(file) {
  if (!fs.existsSync(file)) fail(`Missing ${path.relative(root, file)}.`);
  const raw = fs.readFileSync(file, "utf8");
  eolByFile.set(file, raw.includes("\r\n") ? "\r\n" : "\n");
  return raw.replace(/\r\n/g, "\n");
}
function write(file, content) {
  const eol = eolByFile.get(file) || "\n";
  const output = eol === "\r\n" ? content.replace(/\n/g, "\r\n") : content;
  fs.writeFileSync(file, output);
}
function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) fail(`Could not find ${label}. The repo may not be on the expected c7bce83 V13.9 baseline.`);
  if (source.indexOf(search, index + search.length) >= 0) fail(`${label} matched more than once; refusing an ambiguous patch.`);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}
function insertBeforeOnce(source, search, insertion, label) {
  return replaceOnce(source, search, `${insertion}${search}`, label);
}
function backup(file) {
  const target = `${file}.pre-studio-wasm-v1.bak`;
  if (!fs.existsSync(target)) fs.copyFileSync(file, target);
}

let player = read(playerPath);
let mini = read(miniPath);

if (player.includes('"studio_wasm" | "advanced_worklet"')) {
  console.log("MVP Studio WASM V1 is already applied. No changes made.");
  process.exit(0);
}
if (!player.includes('const AUDIO_ENGINE_VERSION = "v13-9-studio-dsp";')) {
  fail('Expected AUDIO_ENGINE_VERSION "v13-9-studio-dsp" was not found.');
}

backup(playerPath);
backup(miniPath);

player = insertBeforeOnce(
  player,
  'import {\n  clearMusicUrlCache,',
  'import { createMvpStudioNode, getMvpStudioTelemetry, setMvpStudioState } from "./audio/mvpStudioEngine";\n',
  "musicPlayer import anchor",
);

player = replaceOnce(
  player,
  'export type MusicDspEngineMode = "advanced_worklet" | "native_fallback" | "unavailable";',
  'export type MusicDspEngineMode = "studio_wasm" | "advanced_worklet" | "native_fallback" | "unavailable";',
  "MusicDspEngineMode",
);
player = replaceOnce(
  player,
  'const AUDIO_ENGINE_VERSION = "v13-9-studio-dsp";',
  'const AUDIO_ENGINE_VERSION = "v14-0-studio-wasm-v1";',
  "audio engine version",
);
player = replaceOnce(
  player,
  'let preampGain: GainNode | null = null;\nlet transientProcessorNode: AudioWorkletNode | null = null;',
  'let preampGain: GainNode | null = null;\nlet studioProcessorNode: AudioWorkletNode | null = null;\nlet transientProcessorNode: AudioWorkletNode | null = null;',
  "Studio node declaration",
);

const studioHelpers = `
function studioOutputProfileCode(): 0 | 1 | 2 {
  if (state.outputProfile === "headphones") return 1;
  if (state.outputProfile === "speaker") return 2;
  return 0;
}
function calculateStudioGain() {
  if (state.outputProfile === "reference") {
    return { effectivePreampDb: 0, autoHeadroomDb: 0, referenceMatchDb: 0 };
  }
  const requested = state.eqEnabled ? Math.max(-12, Math.min(12, Number(state.preampDb) || 0)) : 0;
  const maxBoost = state.eqEnabled
    ? Math.max(0, ...state.eqGains.map((value) => Math.max(0, Number(value) || 0)))
    : 0;
  const presetCredit = Math.max(0, -requested);
  const profileSafety = state.outputProfile === "speaker" ? 0.45 : state.outputProfile === "headphones" ? 0.28 : 0.20;
  const headphoneSafety = headphonePeakSafetyDb() * 0.28;
  const limiterCredit = state.limiterEnabled ? 1.5 : 0.5;
  const autoHeadroomDb = Math.max(0, maxBoost + profileSafety + headphoneSafety - presetCredit - limiterCredit);
  const effectivePreampDb = Math.max(-18, requested - autoHeadroomDb);
  const measuredMatch = Number.isFinite(lastReferenceRmsDb) && Number.isFinite(lastProcessedRmsDb)
    ? Math.max(-6, Math.min(3, lastProcessedRmsDb - lastReferenceRmsDb))
    : Math.max(-6, Math.min(3, effectivePreampDb));
  return { effectivePreampDb, autoHeadroomDb, referenceMatchDb: measuredMatch };
}
function applyStudioProcessingSettings(now: number) {
  if (!audioContext || !studioProcessorNode) return;
  const { effectivePreampDb, autoHeadroomDb, referenceMatchDb } = calculateStudioGain();
  const pureReference = state.outputProfile === "reference";
  const abBypass = !pureReference && state.dspBypass;
  const processed = !pureReference && !abBypass;
  if (masterVolumeGain) setAudioParam(masterVolumeGain.gain, volumeToGain(state.volume), now, 0.01);
  if (referenceRouteGain) {
    setAudioParam(referenceRouteGain.gain, pureReference ? 1 : abBypass ? dbToGain(referenceMatchDb) : 0, now, 0.008);
  }
  if (standardRouteGain) setAudioParam(standardRouteGain.gain, processed ? 1 : 0, now, 0.008);
  const proof = state.dspVerificationMode === "spatial" && state.outputProfile === "headphones" && !state.dspBypass;
  const headphoneEnabled = processed && state.outputProfile === "headphones" && (state.headphoneMode !== "off" || proof);
  setMvpStudioState(studioProcessorNode, {
    bypass: !processed,
    eqEnabled: processed && state.eqEnabled,
    eqGains: [...state.eqGains],
    preampDb: state.eqEnabled ? state.preampDb : 0,
    headroomDb: autoHeadroomDb,
    limiterEnabled: processed && state.limiterEnabled,
    limiterCeilingDb: state.outputProfile === "car_hifi" ? -1.2 : state.outputProfile === "speaker" ? -1.15 : -1.0,
    outputProfileCode: studioOutputProfileCode(),
    headphoneEnabled,
    headphoneWidth: headphoneEnabled ? (proof ? 1 : state.headphoneWidth / 100) : 0,
    headphoneDepth: headphoneEnabled ? (proof ? 1 : state.headphoneDepth / 100) : 0,
    headphoneCrossfeed: headphoneEnabled ? (proof ? 0.72 : state.headphoneCrossfeed / 100) : 0,
    headphoneCenter: headphoneEnabled ? (proof ? 0.5 : state.headphoneCenter / 100) : 0.5,
    headphoneBassImpact: headphoneEnabled ? (proof ? 0 : state.headphoneBassImpact / 100) : 0,
  });
  const status: MusicDspStatus = audioContext.state === "running"
    ? (pureReference || abBypass ? "bypassed" : "active")
    : "recovering";
  setDspTelemetry(status, effectivePreampDb, autoHeadroomDb);
  const immersionStatus = currentImmersionStatus();
  if (state.immersionStatus !== immersionStatus) emit({ immersionStatus });
}
async function tryConnectStudioGraph(context: AudioContext, audio: HTMLAudioElement) {
  if (!context.audioWorklet || state.eqTopology !== "minimum_phase") return false;
  let sourceCreated = false;
  try {
    studioProcessorNode = await createMvpStudioNode(context);
  } catch (error) {
    studioProcessorNode = null;
    console.warn("MVP Studio WASM unavailable; trying Compatibility Engine.", error);
    return false;
  }
  try {
    mediaSource = context.createMediaElementSource(audio);
    sourceCreated = true;
    masterVolumeGain = context.createGain();
    referenceRouteGain = context.createGain();
    referenceRouteGain.gain.value = 0;
    standardRouteGain = context.createGain();
    standardRouteGain.gain.value = 0;
    mixBus = context.createGain();
    analyserNode = context.createAnalyser();
    analyserNode.fftSize = 4096;
    analyserNode.smoothingTimeConstant = 0.38;
    analyserNode.minDecibels = -92;
    analyserNode.maxDecibels = -10;
    musicGain = context.createGain();
    musicGain.gain.value = 1;
    referenceLevelAnalyser = context.createAnalyser();
    processedLevelAnalyser = context.createAnalyser();
    referenceLevelAnalyser.fftSize = 2048;
    processedLevelAnalyser.fftSize = 2048;
    levelMeterSink = context.createGain();
    levelMeterSink.gain.value = 0;

    mediaSource.connect(masterVolumeGain);
    masterVolumeGain.connect(referenceRouteGain);
    referenceRouteGain.connect(mixBus);
    masterVolumeGain.connect(studioProcessorNode);
    studioProcessorNode.connect(standardRouteGain);
    standardRouteGain.connect(mixBus);
    mixBus.connect(analyserNode);
    analyserNode.connect(musicGain);
    musicGain.connect(context.destination);

    masterVolumeGain.connect(referenceLevelAnalyser);
    referenceLevelAnalyser.connect(levelMeterSink);
    studioProcessorNode.connect(processedLevelAnalyser);
    processedLevelAnalyser.connect(levelMeterSink);
    levelMeterSink.connect(context.destination);

    mediaSourceConnected = true;
    audio.volume = 1;
    emit({
      dspEngineMode: "studio_wasm",
      loudnessGainDb: 0,
      loudnessMomentaryLufs: -70,
    });
    applyProcessingSettings();
    return true;
  } catch (error) {
    if (sourceCreated) throw error;
    try { studioProcessorNode?.disconnect(); } catch { /* no-op */ }
    studioProcessorNode = null;
    return false;
  }
}
`;
player = insertBeforeOnce(player, 'async function loadAdvancedDspModule(context: AudioContext) {', studioHelpers, "Studio helper insertion");

player = replaceOnce(
  player,
  'function applyProcessingSettings() {\n  if (!audioContext || !mediaSourceConnected) return;\n  const now = audioContext.currentTime;',
  'function applyProcessingSettings() {\n  if (!audioContext || !mediaSourceConnected) return;\n  const now = audioContext.currentTime;\n  if (studioProcessorNode && state.dspEngineMode === "studio_wasm") {\n    applyStudioProcessingSettings(now);\n    return;\n  }',
  "Studio applyProcessingSettings branch",
);

player = replaceOnce(
  player,
  '  const requested = state.headphoneMode !== "off" || state.dspVerificationMode === "spatial";\n  if (!requested) return "bypassed";\n  if (headphoneProcessorNode) return "active";',
  '  const requested = state.headphoneMode !== "off" || state.dspVerificationMode === "spatial";\n  if (!requested) return "bypassed";\n  if (studioProcessorNode && state.dspEngineMode === "studio_wasm") return "active";\n  if (headphoneProcessorNode) return "active";',
  "Studio immersion status",
);

player = replaceOnce(
  player,
  '    preampGain,\n    transientProcessorNode,',
  '    preampGain,\n    studioProcessorNode,\n    transientProcessorNode,',
  "Studio release list",
);
player = replaceOnce(
  player,
  '  preampGain = null;\n  transientProcessorNode = null;',
  '  preampGain = null;\n  try { studioProcessorNode?.port.close(); } catch { /* already closed */ }\n  studioProcessorNode = null;\n  transientProcessorNode = null;',
  "Studio release reset",
);

player = replaceOnce(
  player,
  '    try {\n      const advancedDsp = await loadAdvancedDspModule(context);',
  '    try {\n      if (await tryConnectStudioGraph(context, audio)) return;\n      const advancedDsp = await loadAdvancedDspModule(context);',
  "Studio-first graph startup",
);

player = replaceOnce(
  player,
  'export function setMusicEqTopology(topology: MusicEqTopology) {\n  const next: MusicEqTopology = topology === "linear_phase" ? "linear_phase" : "minimum_phase";\n  savePlayerSetting(STORAGE_KEYS.eqTopology, next);\n  emit({ eqTopology: next });\n  applyProcessingSettings();\n  scheduleProcessingSettle();\n}',
  'export function setMusicEqTopology(topology: MusicEqTopology) {\n  const next: MusicEqTopology = topology === "linear_phase" ? "linear_phase" : "minimum_phase";\n  const previous = state.eqTopology;\n  savePlayerSetting(STORAGE_KEYS.eqTopology, next);\n  emit({ eqTopology: next });\n  const engineSwitch = previous !== next && (state.dspEngineMode === "studio_wasm" || (next === "minimum_phase" && state.dspEngineMode === "advanced_worklet"));\n  if (engineSwitch) {\n    void rebuildMusicAudioEngine();\n    return;\n  }\n  applyProcessingSettings();\n  scheduleProcessingSettle();\n}',
  "topology engine switch",
);

player = replaceOnce(
  player,
  'export function getMusicRtaLevels() {\n  return getMusicVisualizerLevels(10);\n}',
  'export function getMusicRtaLevels() {\n  return getMusicVisualizerLevels(10);\n}\nexport function getMusicStudioTelemetry() {\n  return getMvpStudioTelemetry();\n}',
  "Studio telemetry export",
);

mini = replaceOnce(
  mini,
  '<span>DSP ENGINE <b className={player.dspEngineMode === "advanced_worklet" ? "is-good" : player.dspEngineMode === "native_fallback" ? "is-fallback" : "is-bad"}>{player.dspEngineMode === "advanced_worklet" ? "MVP STUDIO WORKLET" : player.dspEngineMode === "native_fallback" ? "NATIVE BACKUP" : "UNAVAILABLE"}</b></span>',
  '<span>DSP ENGINE <b className={player.dspEngineMode === "studio_wasm" || player.dspEngineMode === "advanced_worklet" ? "is-good" : player.dspEngineMode === "native_fallback" ? "is-fallback" : "is-bad"}>{player.dspEngineMode === "studio_wasm" ? "MVP STUDIO • WASM" : player.dspEngineMode === "advanced_worklet" ? "COMPATIBILITY • WORKLET" : player.dspEngineMode === "native_fallback" ? "COMPATIBILITY • NATIVE" : "UNAVAILABLE"}</b></span>',
  "DSP engine UI label",
);
mini = replaceOnce(
  mini,
  '<span>TRUE-PEAK LIMITER <b className="is-good">4× • -1 dBTP</b></span>',
  '<span>OUTPUT LIMITER <b className="is-good">{player.dspEngineMode === "studio_wasm" ? "WASM • 4× PEAK GUARD" : "4× • -1 dBTP"}</b></span>',
  "limiter UI label",
);
mini = replaceOnce(
  mini,
  '<span>TRANSIENT DETAIL <b className="is-good">AUTO</b></span>',
  '<span>TRANSIENT DETAIL <b className={player.dspEngineMode === "studio_wasm" ? "is-fallback" : "is-good"}>{player.dspEngineMode === "studio_wasm" ? "V2" : "AUTO"}</b></span>',
  "transient UI status",
);
mini = replaceOnce(
  mini,
  'disabled={player.dspEngineMode !== "advanced_worklet"} onClick={() => void runDspMutation(() => setMusicEqTopology("linear_phase"), true)}',
  'disabled={player.dspEngineMode === "native_fallback" || player.dspEngineMode === "unavailable"} onClick={() => void runDspMutation(() => setMusicEqTopology("linear_phase"), true)}',
  "linear phase engine-switch button",
);
mini = replaceOnce(
  mini,
  'className={player.multibandEnabled ? "is-active" : ""} aria-pressed={player.multibandEnabled} disabled={player.outputProfile === "reference" || player.dspEngineMode !== "advanced_worklet"}',
  'className={player.multibandEnabled && player.dspEngineMode === "advanced_worklet" ? "is-active" : ""} aria-pressed={player.multibandEnabled && player.dspEngineMode === "advanced_worklet"} disabled={player.outputProfile === "reference" || player.dspEngineMode !== "advanced_worklet"}',
  "multiband Studio V1 UI state",
);
mini = replaceOnce(
  mini,
  '<span>MULTIBAND DYNAMICS</span><strong>{player.multibandEnabled ? "ON" : "OFF"}</strong>',
  '<span>MULTIBAND DYNAMICS</span><strong>{player.dspEngineMode === "studio_wasm" ? "V2" : player.multibandEnabled ? "ON" : "OFF"}</strong>',
  "multiband Studio V1 label",
);
mini = replaceOnce(
  mini,
  'className={player.normalizationEnabled ? "is-active" : ""} aria-pressed={player.normalizationEnabled} disabled={player.outputProfile === "reference" || player.dspEngineMode !== "advanced_worklet"}',
  'className={player.normalizationEnabled && player.dspEngineMode === "advanced_worklet" ? "is-active" : ""} aria-pressed={player.normalizationEnabled && player.dspEngineMode === "advanced_worklet"} disabled={player.outputProfile === "reference" || player.dspEngineMode !== "advanced_worklet"}',
  "normalizer Studio V1 UI state",
);
mini = replaceOnce(
  mini,
  '<span>LOUDNESS NORMALIZATION</span><strong>{player.normalizationEnabled ? "ON • -14 LUFS" : "OFF"}</strong>',
  '<span>LOUDNESS NORMALIZATION</span><strong>{player.dspEngineMode === "studio_wasm" ? "V2" : player.normalizationEnabled ? "ON • -14 LUFS" : "OFF"}</strong>',
  "normalizer Studio V1 label",
);

write(playerPath, player);
write(miniPath, mini);
console.log("MVP Studio WASM V1 applied successfully.");
console.log("Updated: src/lib/musicPlayer.ts");
console.log("Updated: src/features/music/MusicMiniPlayer.tsx");
console.log("Backups: *.pre-studio-wasm-v1.bak");
