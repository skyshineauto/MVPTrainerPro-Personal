#!/usr/bin/env node
/* MVP Trainer Pro R40 - AI Today ONLY
   Surgical installer. Adds three AI Today files and patches only MusicMiniPlayer.tsx.
*/
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const VERSION = "r40-ai-today-only";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PAYLOAD_DIR = path.join(SCRIPT_DIR, "payload");
const PLAYER_FILE = "src/features/music/MusicMiniPlayer.tsx";
const PLAYER_IMPORT_COMPONENT = 'import { MusicTodayAi } from "./premium/MusicTodayAi";';
const PLAYER_IMPORT_ENGINE = 'import { steerMusicToday } from "../../lib/musicToday";';
const PLAYER_RENDER_MARKER = "MVP_MUSIC_TODAY_AI_R40";
const PLAYER_STEER_MARKER = "MVP_MUSIC_TODAY_STEERING_R40";
const LEGACY_R39_MARKER = "MVP_MUSIC_TODAY_AI_R39";
const NEW_FILES = [
  "src/lib/musicToday.ts",
  "src/features/music/premium/MusicTodayAi.tsx",
  "src/features/music/premium/MusicTodayAi.css",
];

function sha256Buffer(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function findRepoRoot() {
  const starts = [
    process.cwd(),
    SCRIPT_DIR,
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "../.."),
  ];
  for (const start of starts) {
    let dir = path.resolve(start);
    for (let i = 0; i < 9; i += 1) {
      if (
        fs.existsSync(path.join(dir, "package.json")) &&
        fs.existsSync(path.join(dir, "src", "features", "music"))
      ) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(
    "Could not find the MVPTrainerPro repo root. Open a terminal in the repo, then run this installer from there.",
  );
}

function replaceOnce(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count !== 1) {
    throw new Error(`Safety stop: expected one ${label} anchor, found ${count}.`);
  }
  return source.replace(search, replacement);
}

function buildPlayerPatch(source) {
  const hasComponentImport = source.includes(PLAYER_IMPORT_COMPONENT);
  const hasEngineImport = source.includes(PLAYER_IMPORT_ENGINE);
  const hasRender = source.includes("<MusicTodayAi />");
  const hasRenderMarker = source.includes(PLAYER_RENDER_MARKER);
  const hasSteerMarker = source.includes(PLAYER_STEER_MARKER);

  if (source.includes(LEGACY_R39_MARKER)) {
    throw new Error(
      "Safety stop: the old R39 Today AI marker is still in MusicMiniPlayer. Run the R39 rollback first, then retry R40.",
    );
  }

  const installedBits = [
    hasComponentImport,
    hasEngineImport,
    hasRender,
    hasRenderMarker,
    hasSteerMarker,
  ];
  if (installedBits.some(Boolean)) {
    if (installedBits.every(Boolean)) return { source, alreadyPatched: true };
    throw new Error(
      "Safety stop: MusicMiniPlayer has a partial Today AI integration. No files were changed.",
    );
  }

  if (!source.includes('className="tr-playerHero"')) {
    throw new Error(
      "Safety stop: current MusicMiniPlayer does not contain the expected tr-playerHero.",
    );
  }
  if (!source.includes("tr-dspPlayerCornerDock")) {
    throw new Error(
      "Safety stop: current MusicMiniPlayer does not contain the approved corner DSP dock. This patch will not guess at an older layout.",
    );
  }
  if (!source.includes("function steerNeuralRadio(mode: MusicRadioMode)")) {
    throw new Error(
      "Safety stop: current MusicMiniPlayer does not contain the expected Neural steering function.",
    );
  }

  const importAnchorMatches = [...source.matchAll(/^const PLAYLISTS_CHANGED_EVENT\s*=.*$/gm)];
  if (importAnchorMatches.length !== 1) {
    throw new Error(
      `Safety stop: expected one PLAYLISTS_CHANGED_EVENT import anchor, found ${importAnchorMatches.length}.`,
    );
  }
  const importIndex = importAnchorMatches[0].index;
  if (typeof importIndex !== "number") {
    throw new Error("Safety stop: could not resolve the player import anchor.");
  }

  let patched =
    source.slice(0, importIndex) +
    PLAYER_IMPORT_COMPONENT +
    "\n" +
    PLAYER_IMPORT_ENGINE +
    "\n\n" +
    source.slice(importIndex);

  const functionAnchor = "function steerNeuralRadio(mode: MusicRadioMode) {";
  const steeringInjection = `function steerNeuralRadio(mode: MusicRadioMode) {
    /* ${PLAYER_STEER_MARKER} */
    if (steerMusicToday(mode)) {
      setNeuralMessage(\`${"${radioModeLabel(mode).toUpperCase()}"} • TODAY\`);
      if (neuralMessageTimerRef.current != null) {
        window.clearTimeout(neuralMessageTimerRef.current);
      }
      neuralMessageTimerRef.current = window.setTimeout(() => {
        setNeuralMessage("");
        neuralMessageTimerRef.current = null;
      }, 2400);
      return;
    }
`;
  patched = replaceOnce(
    patched,
    functionAnchor,
    steeringInjection,
    "steerNeuralRadio",
  );

  const dspClassIndex = patched.indexOf("tr-dspPlayerCornerDock");
  const dspButtonIndex = patched.lastIndexOf("<button", dspClassIndex);
  if (dspClassIndex < 0 || dspButtonIndex < 0) {
    throw new Error("Safety stop: could not isolate the player DSP dock button.");
  }
  const lineStart = patched.lastIndexOf("\n", dspButtonIndex) + 1;
  const indent = (patched.slice(lineStart, dspButtonIndex).match(/^\s*/) || [""])[0];
  const renderInjection = `${indent}{/* ${PLAYER_RENDER_MARKER} */}\n${indent}<MusicTodayAi />\n`;
  patched = patched.slice(0, dspButtonIndex) + renderInjection + patched.slice(dspButtonIndex);

  const checks = [
    PLAYER_IMPORT_COMPONENT,
    PLAYER_IMPORT_ENGINE,
    PLAYER_RENDER_MARKER,
    PLAYER_STEER_MARKER,
    "<MusicTodayAi />",
  ];
  for (const check of checks) {
    if (!patched.includes(check)) {
      throw new Error(`Safety stop: player patch verification failed for ${check}.`);
    }
  }
  if ((patched.match(/MVP_MUSIC_TODAY_AI_R40/g) || []).length !== 1) {
    throw new Error("Safety stop: R40 render marker is not unique.");
  }
  if ((patched.match(/MVP_MUSIC_TODAY_STEERING_R40/g) || []).length !== 1) {
    throw new Error("Safety stop: R40 steering marker is not unique.");
  }

  return { source: patched, alreadyPatched: false };
}

function loadPayload() {
  const files = new Map();
  for (const rel of NEW_FILES) {
    const source = path.join(PAYLOAD_DIR, rel);
    if (!fs.existsSync(source)) {
      throw new Error(`Installer payload is incomplete. Missing: ${rel}`);
    }
    files.set(rel, fs.readFileSync(source));
  }
  return files;
}

const root = findRepoRoot();
console.log(`[${VERSION}] MVP AI Today only`);
console.log(`[${VERSION}] Repo: ${root}`);

let payload;
try {
  payload = loadPayload();
} catch (error) {
  console.error(`[${VERSION}] ${String(error?.message || error)}`);
  console.error(`[${VERSION}] No files were changed.`);
  process.exit(2);
}

const plan = [];
let playerOriginal = "";
let playerPatched = "";
try {
  for (const rel of NEW_FILES) {
    const target = path.join(root, rel);
    const expectedHash = sha256Buffer(payload.get(rel));
    if (!fs.existsSync(target)) {
      plan.push({ rel, target, state: "create", existed: false, expectedHash });
      continue;
    }
    const hash = sha256File(target);
    if (hash === expectedHash) {
      plan.push({ rel, target, state: "final", existed: true, expectedHash });
      continue;
    }
    throw new Error(
      `Safety stop: ${rel} already exists but is not this exact R40 file. Current SHA256: ${hash}`,
    );
  }

  const playerPath = path.join(root, PLAYER_FILE);
  if (!fs.existsSync(playerPath)) {
    throw new Error(`Safety stop: missing ${PLAYER_FILE}.`);
  }
  playerOriginal = fs.readFileSync(playerPath, "utf8");
  const patch = buildPlayerPatch(playerOriginal);
  playerPatched = patch.source;
  plan.push({
    rel: PLAYER_FILE,
    target: playerPath,
    state: patch.alreadyPatched ? "final-player" : "patch-player",
    existed: true,
  });
} catch (error) {
  console.error(`[${VERSION}] ${String(error?.message || error)}`);
  console.error(`[${VERSION}] No files were changed.`);
  process.exit(2);
}

const pending = plan.filter(
  (item) => item.state === "create" || item.state === "patch-player",
);
if (!pending.length) {
  console.log(`[${VERSION}] Already installed. No files changed.`);
  process.exit(0);
}

const backupRoot = path.join(
  root,
  ".mvp-backups",
  `${VERSION}-${stamp()}`,
);
fs.mkdirSync(backupRoot, { recursive: true });
const written = [];

try {
  for (const item of pending) {
    if (!item.existed) continue;
    const backup = path.join(backupRoot, item.rel);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(item.target, backup);
  }

  for (const item of pending) {
    fs.mkdirSync(path.dirname(item.target), { recursive: true });
    if (item.state === "patch-player") {
      if (fs.readFileSync(item.target, "utf8") !== playerOriginal) {
        throw new Error(
          `Concurrent-change safety stop: ${PLAYER_FILE} changed after validation.`,
        );
      }
      fs.writeFileSync(item.target, playerPatched, "utf8");
    } else {
      fs.writeFileSync(item.target, payload.get(item.rel));
    }
    written.push(item);
    console.log(` + ${item.rel}`);
  }

  for (const rel of NEW_FILES) {
    const target = path.join(root, rel);
    const expectedHash = sha256Buffer(payload.get(rel));
    if (!fs.existsSync(target) || sha256File(target) !== expectedHash) {
      throw new Error(`Post-write checksum failed: ${rel}`);
    }
  }

  const verifyPlayer = fs.readFileSync(path.join(root, PLAYER_FILE), "utf8");
  const required = [
    PLAYER_IMPORT_COMPONENT,
    PLAYER_IMPORT_ENGINE,
    PLAYER_RENDER_MARKER,
    PLAYER_STEER_MARKER,
    "<MusicTodayAi />",
  ];
  for (const token of required) {
    if (!verifyPlayer.includes(token)) {
      throw new Error(`Post-write player verification failed: ${token}`);
    }
  }

  console.log(`[${VERSION}] Installed successfully.`);
  console.log(
    `[${VERSION}] Only AI Today files plus one surgical MusicMiniPlayer integration were changed.`,
  );
  console.log(`[${VERSION}] Backup: ${backupRoot}`);
  console.log(`[${VERSION}] Next: npm run build`);
} catch (error) {
  console.error(`[${VERSION}] ERROR: ${String(error?.message || error)}`);
  console.error(`[${VERSION}] Rolling back this install...`);
  for (const item of written.reverse()) {
    try {
      if (item.existed) {
        const backup = path.join(backupRoot, item.rel);
        if (fs.existsSync(backup)) fs.copyFileSync(backup, item.target);
      } else if (fs.existsSync(item.target)) {
        fs.rmSync(item.target, { force: true });
      }
    } catch {}
  }
  console.error(
    `[${VERSION}] Rollback complete. No R40 partial install left behind.`,
  );
  process.exit(2);
}
