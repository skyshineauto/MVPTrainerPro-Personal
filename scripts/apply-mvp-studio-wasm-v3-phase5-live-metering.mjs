#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const PHASE_MARKER = "MVP_STUDIO_WASM_V3_PHASE5_LIVE_METERING";
const BACKUP_SUFFIX = ".pre-studio-v3-phase5-live-metering.bak";
const INSTALLER_REVISION = "v3-phase5-live-metering-r2-scoped-ui";
const paths = {
  player: path.join(root, "src/lib/musicPlayer.ts"),
  mini: path.join(root, "src/features/music/MusicMiniPlayer.tsx"),
};
const payload = {"type": ["  outputCorrectionReductionDb: number;\n  loudnessGainDb: number;\n  loudnessMomentaryLufs: number;\n  limiterEnabled: boolean;", "  outputCorrectionReductionDb: number;\n  loudnessGainDb: number;\n  loudnessMomentaryLufs: number;\n  // MVP_STUDIO_WASM_V3_PHASE5_LIVE_METERING\n  truePeakDbtp: number;\n  limiterGainReductionDb: number;\n  transientBoostDb: number;\n  multibandGainReductionDb: number;\n  limiterEnabled: boolean;"], "initial": ["  outputCorrectionReductionDb: 0,\n  loudnessGainDb: 0,\n  loudnessMomentaryLufs: -70,\n  limiterEnabled: readBoolean(STORAGE_KEYS.limiterEnabled, true),", "  outputCorrectionReductionDb: 0,\n  loudnessGainDb: 0,\n  loudnessMomentaryLufs: -70,\n  truePeakDbtp: -120,\n  limiterGainReductionDb: 0,\n  transientBoostDb: 0,\n  multibandGainReductionDb: 0,\n  limiterEnabled: readBoolean(STORAGE_KEYS.limiterEnabled, true),"], "ready": ["    emit({\n      dspEngineMode: \"studio_wasm\",\n      loudnessGainDb: 0,\n      loudnessMomentaryLufs: -70,\n    });", "    emit({\n      dspEngineMode: \"studio_wasm\",\n      loudnessGainDb: 0,\n      loudnessMomentaryLufs: -70,\n      truePeakDbtp: -120,\n      limiterGainReductionDb: 0,\n      transientBoostDb: 0,\n      multibandGainReductionDb: 0,\n    });"], "meterNew": "    if (state.dspEngineMode === \"studio_wasm\") {\n      const telemetry = getMvpStudioTelemetry();\n      const loudnessActive = state.normalizationEnabled && state.outputProfile !== \"reference\" && !state.dspBypass;\n      const gainDb = loudnessActive && Number.isFinite(telemetry.loudnessGainDb)\n        ? Math.round(telemetry.loudnessGainDb * 10) / 10\n        : 0;\n      const programLufs = loudnessActive && Number.isFinite(telemetry.loudnessProgramLufs) && telemetry.loudnessProgramLufs > -69.5\n        ? Math.round(telemetry.loudnessProgramLufs * 10) / 10\n        : -70;\n      const dynamicEqActive = state.dynamicEqEnabled && state.outputProfile !== \"reference\" && !state.dspBypass;\n      const dynamicEqGainReductionDb = dynamicEqActive && Number.isFinite(telemetry.dynamicEqGainReductionDb)\n        ? Math.round(telemetry.dynamicEqGainReductionDb * 10) / 10\n        : 0;\n      const dynamicEqBandReductionDb = (dynamicEqActive\n        ? [0, 1, 2, 3].map((index) => Math.round((Number(telemetry.dynamicEqBandReductionDb?.[index]) || 0) * 10) / 10)\n        : [0, 0, 0, 0]) as [number, number, number, number];\n      const dynamicEqChanged = dynamicEqGainReductionDb !== state.dynamicEqGainReductionDb\n        || dynamicEqBandReductionDb.some((value, index) => value !== state.dynamicEqBandReductionDb[index]);\n      const outputCorrectionActive = state.outputProfile !== \"reference\" && !state.dspBypass;\n      const outputCorrectionReductionDb = outputCorrectionActive && Number.isFinite(telemetry.outputCorrectionReductionDb)\n        ? Math.round(telemetry.outputCorrectionReductionDb * 10) / 10\n        : 0;\n      const outputCorrectionChanged = outputCorrectionReductionDb !== state.outputCorrectionReductionDb;\n      const truePeakDbtp = Number.isFinite(telemetry.truePeakDbtp)\n        ? Math.round(telemetry.truePeakDbtp * 10) / 10\n        : -120;\n      const limiterGainReductionDb = state.limiterEnabled && Number.isFinite(telemetry.gainReductionDb)\n        ? Math.round(Math.max(0, telemetry.gainReductionDb) * 10) / 10\n        : 0;\n      const transientActive = state.outputProfile !== \"reference\" && state.eqEnabled && !state.dspBypass;\n      const transientBoostDb = transientActive && Number.isFinite(telemetry.transientBoostDb)\n        ? Math.round(Math.max(0, telemetry.transientBoostDb) * 10) / 10\n        : 0;\n      const multibandActive = state.multibandEnabled && state.outputProfile !== \"reference\" && !state.dspBypass;\n      const multibandGainReductionDb = multibandActive && Number.isFinite(telemetry.multibandGainReductionDb)\n        ? Math.round(Math.max(0, telemetry.multibandGainReductionDb) * 10) / 10\n        : 0;\n      const coreMeterChanged = truePeakDbtp !== state.truePeakDbtp\n        || limiterGainReductionDb !== state.limiterGainReductionDb\n        || transientBoostDb !== state.transientBoostDb\n        || multibandGainReductionDb !== state.multibandGainReductionDb;\n      if (gainDb !== state.loudnessGainDb || programLufs !== state.loudnessMomentaryLufs || dynamicEqChanged || outputCorrectionChanged || coreMeterChanged) {\n        emit({\n          loudnessGainDb: gainDb,\n          loudnessMomentaryLufs: programLufs,\n          dynamicEqGainReductionDb,\n          dynamicEqBandReductionDb,\n          outputCorrectionReductionDb,\n          truePeakDbtp,\n          limiterGainReductionDb,\n          transientBoostDb,\n          multibandGainReductionDb,\n        });\n      }\n    }", "ui": ["          </section>\n          <section className=\"tr-studioProcessingPanel\" aria-label=\"Studio dynamics processing\">", "          </section>\n          <section className=\"tr-studioMeterPanel\" aria-label=\"Live Studio DSP metering\">\n            <header>\n              <div><span>LIVE DSP METERING</span><strong>REAL-TIME ENGINE TELEMETRY</strong></div>\n              <small>{player.dspEngineMode === \"studio_wasm\" ? \"DIRECT FROM WASM CORE\" : \"AVAILABLE IN MVP STUDIO\"}</small>\n            </header>\n            <div className=\"tr-studioMeterGrid\">\n              <article data-meter=\"peak\">\n                <span>TRUE PEAK</span>\n                <strong>{player.dspEngineMode === \"studio_wasm\" && player.truePeakDbtp > -119 ? `${player.truePeakDbtp.toFixed(1)} dBTP` : \"—\"}</strong>\n                <i><b style={{ width: `${player.dspEngineMode === \"studio_wasm\" && player.truePeakDbtp > -119 ? Math.max(0, Math.min(100, ((player.truePeakDbtp + 18) / 18) * 100)) : 0}%` }} /></i>\n                <small>BS.1770 reconstructed peak</small>\n              </article>\n              <article data-meter=\"limiter\">\n                <span>LIMITER GR</span>\n                <strong>{player.dspEngineMode === \"studio_wasm\" ? `${player.limiterGainReductionDb.toFixed(1)} dB` : \"—\"}</strong>\n                <i><b style={{ width: `${player.dspEngineMode === \"studio_wasm\" ? Math.max(0, Math.min(100, (player.limiterGainReductionDb / 6) * 100)) : 0}%` }} /></i>\n                <small>True-peak gain reduction</small>\n              </article>\n              <article data-meter=\"multiband\">\n                <span>MULTIBAND GR</span>\n                <strong>{player.dspEngineMode === \"studio_wasm\" && player.multibandEnabled ? `${player.multibandGainReductionDb.toFixed(1)} dB` : \"OFF\"}</strong>\n                <i><b style={{ width: `${player.dspEngineMode === \"studio_wasm\" && player.multibandEnabled ? Math.max(0, Math.min(100, (player.multibandGainReductionDb / 6) * 100)) : 0}%` }} /></i>\n                <small>Maximum 4-band reduction</small>\n              </article>\n              <article data-meter=\"dynamic\">\n                <span>DYNAMIC EQ</span>\n                <strong>{player.dspEngineMode === \"studio_wasm\" && player.dynamicEqEnabled ? `${player.dynamicEqGainReductionDb.toFixed(1)} dB` : \"OFF\"}</strong>\n                <i><b style={{ width: `${player.dspEngineMode === \"studio_wasm\" && player.dynamicEqEnabled ? Math.max(0, Math.min(100, (player.dynamicEqGainReductionDb / 3) * 100)) : 0}%` }} /></i>\n                <small>Maximum adaptive cut</small>\n              </article>\n              <article data-meter=\"output\">\n                <span>OUTPUT CORR</span>\n                <strong>{player.dspEngineMode === \"studio_wasm\" && player.outputProfile !== \"reference\" ? `${player.outputCorrectionReductionDb.toFixed(1)} dB` : \"OFF\"}</strong>\n                <i><b style={{ width: `${player.dspEngineMode === \"studio_wasm\" && player.outputProfile !== \"reference\" ? Math.max(0, Math.min(100, (player.outputCorrectionReductionDb / 3) * 100)) : 0}%` }} /></i>\n                <small>{player.outputProfile === \"speaker\" ? \"Bluetooth correction\" : player.outputProfile === \"headphones\" ? \"Headphone correction\" : player.outputProfile === \"car_hifi\" ? \"Car / Hi-Fi correction\" : \"Reference path\"}</small>\n              </article>\n              <article data-meter=\"transient\">\n                <span>TRANSIENT</span>\n                <strong>{player.dspEngineMode === \"studio_wasm\" && player.outputProfile !== \"reference\" && player.eqEnabled && !player.dspBypass ? `+${player.transientBoostDb.toFixed(1)} dB` : \"OFF\"}</strong>\n                <i><b style={{ width: `${player.dspEngineMode === \"studio_wasm\" ? Math.max(0, Math.min(100, (player.transientBoostDb / 2.5) * 100)) : 0}%` }} /></i>\n                <small>Adaptive attack enhancement</small>\n              </article>\n              <article data-meter=\"level\">\n                <span>TRACK LEVEL</span>\n                <strong>{player.normalizationEnabled && player.loudnessMomentaryLufs > -60 ? `${player.loudnessMomentaryLufs.toFixed(1)} LUFS` : player.normalizationEnabled ? \"ANALYZING\" : \"RAW\"}</strong>\n                <i><b style={{ width: `${player.normalizationEnabled ? Math.max(0, Math.min(100, (Math.abs(player.loudnessGainDb) / 3) * 100)) : 0}%` }} /></i>\n                <small>{player.normalizationEnabled ? `Volume Match trim ${player.loudnessGainDb > 0 ? \"+\" : \"\"}${player.loudnessGainDb.toFixed(1)} dB` : \"Volume Match off\"}</small>\n              </article>\n            </div>\n          </section>\n          <section className=\"tr-studioProcessingPanel\" aria-label=\"Studio dynamics processing\">"], "css": ["        @media(max-width:700px){.tr-dspProofPanel{grid-template-columns:1fr!important}", "        .tr-studioMeterPanel{margin:10px 0 12px;padding:12px;border:1px solid rgba(102,190,219,.16);border-radius:12px;background:linear-gradient(180deg,rgba(7,22,30,.91),rgba(2,10,14,.96));box-shadow:inset 0 1px 0 rgba(255,255,255,.025)}.tr-studioMeterPanel>header{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:9px}.tr-studioMeterPanel>header>div{display:grid;gap:2px}.tr-studioMeterPanel>header span{color:#6fbdd7;font-size:6.5px;font-weight:1000;letter-spacing:.13em}.tr-studioMeterPanel>header strong{color:#edf7fa;font-size:10px;letter-spacing:.035em}.tr-studioMeterPanel>header small{color:#72919d;font-size:6.5px;font-weight:900;letter-spacing:.08em}.tr-studioMeterGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.tr-studioMeterGrid article{min-width:0;padding:9px 9px 8px;border:1px solid rgba(112,182,205,.10);border-radius:9px;background:linear-gradient(180deg,rgba(13,31,40,.72),rgba(2,9,13,.78));box-shadow:inset 0 1px 0 rgba(255,255,255,.02)}.tr-studioMeterGrid article>span{display:block;color:#718d98;font-size:6px;font-weight:1000;letter-spacing:.09em;white-space:nowrap}.tr-studioMeterGrid article>strong{display:block;margin-top:4px;color:#f2f8fa;font-size:12px;line-height:1;font-variant-numeric:tabular-nums}.tr-studioMeterGrid article>i{display:block;height:3px;margin:8px 0 6px;border-radius:999px;background:rgba(121,165,179,.12);overflow:hidden}.tr-studioMeterGrid article>i>b{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#29c7e8,#83e5d0);transition:width .16s linear}.tr-studioMeterGrid article[data-meter=\"peak\"]>i>b,.tr-studioMeterGrid article[data-meter=\"limiter\"]>i>b{background:linear-gradient(90deg,#f1cf55,#ff914d)}.tr-studioMeterGrid article>small{display:block;min-height:18px;color:#63808b;font-size:6.3px;line-height:1.35;font-weight:750}.tr-studioMeterGrid article[data-meter=\"peak\"]>strong{color:#ffd36a}.tr-studioMeterGrid article[data-meter=\"limiter\"]>strong{color:#ffb57d}\n        @media(max-width:700px){.tr-studioMeterPanel>header{align-items:flex-start;flex-direction:column;gap:4px}.tr-studioMeterGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.tr-dspProofPanel{grid-template-columns:1fr!important}"]};

function fail(message) {
  console.error(`MVP Studio V3 Phase 5 installer stopped: ${message}`);
  console.error("Nothing was committed. Fix the reported baseline mismatch and run the installer again.");
  process.exit(1);
}
function readText(file) {
  if (!fs.existsSync(file)) fail(`Missing ${path.relative(root, file)}.`);
  const text = fs.readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { text: text.replace(/\r\n/g, "\n"), eol };
}
function restoreEol(text, eol) {
  return eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}
function countExact(text, needle) {
  return text.split(needle).length - 1;
}
function replaceExact(text, oldText, newText, label) {
  const count = countExact(text, oldText);
  if (count !== 1) fail(`${label} expected exactly once but matched ${count}.`);
  return text.replace(oldText, newText);
}
function writeBackup(file) {
  const backup = `${file}${BACKUP_SUFFIX}`;
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
}

const playerRead = readText(paths.player);
const miniRead = readText(paths.mini);
let player = playerRead.text;
let mini = miniRead.text;

if (player.includes(PHASE_MARKER) || mini.includes("LIVE DSP METERING")) {
  console.log(`MVP Studio V3 Phase 5 Live Metering is already installed. (${INSTALLER_REVISION})`);
  process.exit(0);
}
if (!player.includes("MVP_STUDIO_WASM_V3_PHASE4_TRUE_PEAK_LIMITER")) fail("V3 Phase 4 True-Peak baseline was not found in musicPlayer.ts.");
if (!mini.includes("WASM • BS.1770 TRUE PEAK") || !mini.includes("LINEAR PHASE • STUDIO WASM")) fail("Current Studio True-Peak / Linear-Phase UI baseline was not found.");
if (!player.includes("dynamicEqGainReductionDb") || !player.includes("outputCorrectionReductionDb")) fail("Dynamic EQ / Output Correction telemetry baseline was not found.");

for (const [key, label] of [["type","MusicPlayerState telemetry fields"],["initial","initial telemetry state"],["ready","Studio ready telemetry reset"]]) {
  const [oldText] = payload[key];
  const count = countExact(player, oldText);
  if (count !== 1) fail(`${label} expected exactly once but matched ${count}.`);
}
const processingPanelAnchor = '          <section className="tr-studioProcessingPanel" aria-label="Studio dynamics processing">';
if (countExact(mini, processingPanelAnchor) !== 1) {
  fail(`Studio processing panel anchor expected exactly once but matched ${countExact(mini, processingPanelAnchor)}.`);
}
const processingCssAnchor = '        .tr-studioProcessingPanel{display:grid!important;';
if (countExact(mini, processingCssAnchor) !== 1) {
  fail(`Studio processing CSS anchor expected exactly once but matched ${countExact(mini, processingCssAnchor)}.`);
}

const meterFunctionStart = player.indexOf("function startLevelMeter()");
if (meterFunctionStart < 0) fail("startLevelMeter() was not found.");
const studioBlockStart = player.indexOf('    if (state.dspEngineMode === "studio_wasm") {', meterFunctionStart);
const studioBlockEndMarker = "    const referenceDb = rmsDbFromAnalyser(referenceLevelAnalyser);";
const studioBlockEnd = player.indexOf(studioBlockEndMarker, studioBlockStart);
if (studioBlockStart < 0 || studioBlockEnd < 0) fail("Studio telemetry polling block could not be scoped.");
const existingStudioBlock = player.slice(studioBlockStart, studioBlockEnd);
if (!existingStudioBlock.includes("getMvpStudioTelemetry()") || !existingStudioBlock.includes("outputCorrectionReductionDb")) fail("Scoped Studio telemetry block did not match the expected baseline.");

player = replaceExact(player, payload.type[0], payload.type[1], "MusicPlayerState telemetry fields");
player = replaceExact(player, payload.initial[0], payload.initial[1], "initial telemetry state");
player = replaceExact(player, payload.ready[0], payload.ready[1], "Studio ready telemetry reset");

const meterFunctionStart2 = player.indexOf("function startLevelMeter()");
const studioBlockStart2 = player.indexOf('    if (state.dspEngineMode === "studio_wasm") {', meterFunctionStart2);
const studioBlockEnd2 = player.indexOf(studioBlockEndMarker, studioBlockStart2);
player = player.slice(0, studioBlockStart2) + payload.meterNew + "\n" + player.slice(studioBlockEnd2);

const meterFunctionStart3 = player.indexOf("function startLevelMeter()");
const meterFunctionEnd3 = player.indexOf("async function unlockMusicAudio()", meterFunctionStart3);
if (meterFunctionEnd3 < 0) fail("Meter function end was not found.");
let meterFunction = player.slice(meterFunctionStart3, meterFunctionEnd3);
if (countExact(meterFunction, "  }, 350);") !== 1) fail("350 ms meter cadence expected exactly once.");
meterFunction = meterFunction.replace("  }, 350);", "  }, 200);");
player = player.slice(0, meterFunctionStart3) + meterFunction + player.slice(meterFunctionEnd3);

const meterPanelMarkup = payload.ui[1].slice(payload.ui[1].indexOf('          <section className="tr-studioMeterPanel"'), payload.ui[1].lastIndexOf(processingPanelAnchor));
mini = mini.replace(processingPanelAnchor, meterPanelMarkup + processingPanelAnchor);

const meterCssDesktop = payload.css[1].split('\n        @media(max-width:700px){')[0];
const meterCssMobile = '        @media(max-width:700px){.tr-studioMeterPanel>header{align-items:flex-start;flex-direction:column;gap:4px}.tr-studioMeterGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}';
mini = mini.replace(processingCssAnchor, meterCssDesktop + "\n" + meterCssMobile + "\n" + processingCssAnchor);

writeBackup(paths.player);
writeBackup(paths.mini);
fs.writeFileSync(paths.player, restoreEol(player, playerRead.eol), "utf8");
fs.writeFileSync(paths.mini, restoreEol(mini, miniRead.eol), "utf8");

console.log(`MVP Studio WASM V3 Phase 5 Live Metering applied successfully. (${INSTALLER_REVISION})`);
console.log("Updated: src/lib/musicPlayer.ts");
console.log("Updated: src/features/music/MusicMiniPlayer.tsx");
console.log("Meters: True Peak / Limiter GR / Multiband GR / Dynamic EQ / Output Correction / Transient / Track Level");
console.log(`Backups: *${BACKUP_SUFFIX}`);
console.log("NEXT: run npm run build");
