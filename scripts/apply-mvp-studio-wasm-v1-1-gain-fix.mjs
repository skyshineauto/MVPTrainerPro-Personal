#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const playerPath = path.join(root, "src/lib/musicPlayer.ts");
const miniPath = path.join(root, "src/features/music/MusicMiniPlayer.tsx");
const FIX_MARKER = "MVP_STUDIO_WASM_V1_1_GAIN_STAGING_FIX";

function fail(message) {
  console.error(`\nMVP Studio V1.1 installer stopped: ${message}\n`);
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
  fs.writeFileSync(file, eol === "\r\n" ? content.replace(/\n/g, "\r\n") : content);
}
function backup(file) {
  const target = `${file}.pre-studio-v1-1-gain-fix.bak`;
  if (!fs.existsSync(target)) fs.copyFileSync(file, target);
}
function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) fail(`Could not find ${label}. Make sure MVP Studio WASM V1 is already installed.`);
  if (source.indexOf(search, first + search.length) >= 0) fail(`${label} matched more than once; refusing an ambiguous patch.`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}
function replaceFunction(source, name, replacement) {
  const signature = `function ${name}()`;
  const start = source.indexOf(signature);
  if (start < 0) fail(`Could not find ${name}().`);
  const braceStart = source.indexOf("{", start + signature.length);
  if (braceStart < 0) fail(`Could not parse ${name}().`);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) fail(`Could not find the end of ${name}().`);
  return source.slice(0, start) + replacement + source.slice(end);
}

let player = read(playerPath);
let mini = read(miniPath);

if (player.includes(FIX_MARKER)) {
  console.log("MVP Studio WASM V1.1 gain-staging fix is already applied. No changes made.");
  process.exit(0);
}
if (!player.includes('export type MusicDspEngineMode = "studio_wasm" | "advanced_worklet" | "native_fallback" | "unavailable";')) {
  fail("Studio WASM engine marker was not found.");
}
if (!player.includes('const AUDIO_ENGINE_VERSION = "v14-0-studio-wasm-v1";')) {
  fail('Expected MVP Studio WASM V1 audio-engine version was not found.');
}
if (!player.includes("const maxBoost = state.eqEnabled")) {
  fail("The V1 auto-headroom calculation was not found. The file may already have a different gain-stage implementation.");
}

backup(playerPath);
backup(miniPath);

const gainFunction = `function calculateStudioGain() {
  // ${FIX_MARKER}
  // EQ bands are tonal controls, not a global-volume control. Studio V1 previously
  // derived auto headroom from the largest positive band and then subtracted that
  // value from the entire signal. V1.1 keeps user/preset preamp independent from
  // EQ-band movement and lets the WASM output limiter handle real peak events.
  if (state.outputProfile === "reference") {
    return { effectivePreampDb: 0, autoHeadroomDb: 0, referenceMatchDb: 0 };
  }
  const requested = state.eqEnabled
    ? Math.max(-12, Math.min(12, Number(state.preampDb) || 0))
    : 0;
  const autoHeadroomDb = 0;
  const effectivePreampDb = requested;
  const measuredMatch = Number.isFinite(lastReferenceRmsDb) && Number.isFinite(lastProcessedRmsDb)
    ? Math.max(-6, Math.min(3, lastProcessedRmsDb - lastReferenceRmsDb))
    : Math.max(-6, Math.min(3, effectivePreampDb));
  return { effectivePreampDb, autoHeadroomDb, referenceMatchDb: measuredMatch };
}`;

player = replaceFunction(player, "calculateStudioGain", gainFunction);

mini = replaceOnce(
  mini,
  '<span>AUTO HEADROOM <b>{player.autoHeadroomDb > 0 ? `-${player.autoHeadroomDb.toFixed(1)} dB` : "READY"}</b></span>',
  '<span>SAFETY TRIM <b>{player.autoHeadroomDb > 0 ? `-${player.autoHeadroomDb.toFixed(1)} dB` : "READY"}</b></span>',
  "Studio safety-trim telemetry label",
);
mini = replaceOnce(
  mini,
  '<small>Auto headroom stays active. Use this only for a small output-level correction.</small>',
  '<small>Independent preamp. EQ bands change only their frequencies; the WASM output limiter catches real peaks.</small>',
  "preamp help text",
);

write(playerPath, player);
write(miniPath, mini);

console.log("MVP Studio WASM V1.1 gain-staging fix applied successfully.");
console.log("Updated: src/lib/musicPlayer.ts");
console.log("Updated: src/features/music/MusicMiniPlayer.tsx");
console.log("Behavior: EQ-band changes no longer recalculate global attenuation.");
console.log("Protection: WASM output limiter remains active and unchanged.");
console.log("Backups: *.pre-studio-v1-1-gain-fix.bak");
