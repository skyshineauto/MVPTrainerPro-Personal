import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const VERSION = "r41-ai-today-polish";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PAYLOAD_DIR = path.join(SCRIPT_DIR, "payload");
const FILES = [
  {
    rel: "src/lib/musicToday.ts",
    r40: "83b44c9ab55129e44cc58591eaa52f5015218b685d2bf02bd785593d2558edfc",
    r41: "6b11193fafbb6c84f15c891644f4211677c104fafc59f01764f054e15566488e",
  },
  {
    rel: "src/features/music/premium/MusicTodayAi.tsx",
    r40: "38519e51282edf78edcdc5bce828e0624bc4b059429251aa230d4e34d685e8a9",
    r41: "a31ba31c05a1be460e38069e2785dbed1f755243c5d3c6ac9c4146c3bfbb9411",
  },
  {
    rel: "src/features/music/premium/MusicTodayAi.css",
    r40: "b1daf4c56751cca13722f32c2490aa7e671930eb5806f1a567403a2a93c6bca8",
    r41: "23bddb8873d233caa8302ea4b9d9ecb3f4f01d88dab6567de7c7ba6709827202",
  },
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
  const starts = [process.cwd(), SCRIPT_DIR, path.resolve(process.cwd(), ".."), path.resolve(process.cwd(), "../..")];
  for (const start of starts) {
    let dir = path.resolve(start);
    for (let i = 0; i < 9; i += 1) {
      if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "src", "features", "music"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("Could not find the MVPTrainerPro repo root. Run this installer from inside the repo.");
}

const root = findRepoRoot();
console.log(`[${VERSION}] AI Today only`);
console.log(`[${VERSION}] Repo: ${root}`);

const plan = [];
try {
  for (const item of FILES) {
    const source = path.join(PAYLOAD_DIR, item.rel);
    const target = path.join(root, item.rel);
    if (!fs.existsSync(source)) throw new Error(`Installer payload is incomplete: ${item.rel}`);
    if (sha256File(source) !== item.r41) throw new Error(`Installer payload checksum failed: ${item.rel}`);
    if (!fs.existsSync(target)) throw new Error(`Safety stop: missing ${item.rel}. R40 must be installed first.`);
    const current = sha256File(target);
    if (current === item.r41) {
      plan.push({ ...item, source, target, state: "final" });
      continue;
    }
    if (current !== item.r40) {
      throw new Error(`Safety stop: ${item.rel} is not the exact R40 file. Current SHA256: ${current}`);
    }
    plan.push({ ...item, source, target, state: "replace" });
  }

  const playerPath = path.join(root, "src/features/music/MusicMiniPlayer.tsx");
  if (!fs.existsSync(playerPath)) throw new Error("Safety stop: missing MusicMiniPlayer.tsx.");
  const player = fs.readFileSync(playerPath, "utf8");
  if (!player.includes('import { MusicTodayAi } from "./premium/MusicTodayAi";') || !player.includes("<MusicTodayAi />")) {
    throw new Error("Safety stop: R40 AI Today player integration is not present. No files were changed.");
  }
} catch (error) {
  console.error(`[${VERSION}] ${String(error?.message || error)}`);
  console.error(`[${VERSION}] No files were changed.`);
  process.exit(2);
}

const pending = plan.filter((item) => item.state === "replace");
if (!pending.length) {
  console.log(`[${VERSION}] Already installed. No files changed.`);
  process.exit(0);
}

const backupRoot = path.join(root, ".mvp-backups", `${VERSION}-${stamp()}`);
fs.mkdirSync(backupRoot, { recursive: true });
const written = [];

try {
  for (const item of pending) {
    const backup = path.join(backupRoot, item.rel);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(item.target, backup);
  }

  for (const item of pending) {
    if (sha256File(item.target) !== item.r40) throw new Error(`Concurrent-change safety stop: ${item.rel} changed after validation.`);
    fs.copyFileSync(item.source, item.target);
    written.push(item);
    console.log(` + ${item.rel}`);
  }

  for (const item of FILES) {
    const target = path.join(root, item.rel);
    if (sha256File(target) !== item.r41) throw new Error(`Post-write checksum failed: ${item.rel}`);
  }

  console.log(`[${VERSION}] Installed successfully.`);
  console.log(`[${VERSION}] Only the 3 existing AI Today files were replaced.`);
  console.log(`[${VERSION}] No My Music tabs, DSP/WASM, R2, Supabase, workouts, or player controls were changed.`);
  console.log(`[${VERSION}] Backup: ${backupRoot}`);
  console.log(`[${VERSION}] Next: npm run build`);
} catch (error) {
  console.error(`[${VERSION}] ERROR: ${String(error?.message || error)}`);
  console.error(`[${VERSION}] Rolling back this install...`);
  for (const item of [...written].reverse()) {
    const backup = path.join(backupRoot, item.rel);
    if (fs.existsSync(backup)) fs.copyFileSync(backup, item.target);
  }
  console.error(`[${VERSION}] Rollback complete.`);
  process.exit(1);
}
