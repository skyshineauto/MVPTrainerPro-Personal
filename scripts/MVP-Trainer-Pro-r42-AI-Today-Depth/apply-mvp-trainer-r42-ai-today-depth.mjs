import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const VERSION = "r42-ai-today-depth";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(SCRIPT_DIR, "payload", "src", "features", "music", "premium", "MusicTodayAi.css");
const REL = "src/features/music/premium/MusicTodayAi.css";
const R41 = "23bddb8873d233caa8302ea4b9d9ecb3f4f01d88dab6567de7c7ba6709827202";
const R42 = "78b062bd3f49a3b64714c670603ba575ac5995d403fbb45c6a48b2b53b227bdc";

function sha256Buffer(data) { return crypto.createHash("sha256").update(data).digest("hex"); }
function sha256File(file) { return sha256Buffer(fs.readFileSync(file)); }
function stamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }
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
const target = path.join(root, REL);
console.log(`[${VERSION}] AI Today visual depth only`);
console.log(`[${VERSION}] Repo: ${root}`);

try {
  if (!fs.existsSync(SOURCE)) throw new Error("Installer payload is incomplete.");
  if (sha256File(SOURCE) !== R42) throw new Error("Installer payload checksum failed.");
  if (!fs.existsSync(target)) throw new Error(`Safety stop: missing ${REL}. R41 must be installed first.`);
  const current = sha256File(target);
  if (current === R42) {
    console.log(`[${VERSION}] Already installed. No files changed.`);
    process.exit(0);
  }
  if (current !== R41) throw new Error(`Safety stop: ${REL} is not the exact R41 file. Current SHA256: ${current}`);
} catch (error) {
  console.error(`[${VERSION}] ${String(error?.message || error)}`);
  console.error(`[${VERSION}] No files were changed.`);
  process.exit(2);
}

const backupRoot = path.join(root, ".mvp-backups", `${VERSION}-${stamp()}`);
const backup = path.join(backupRoot, REL);
try {
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(target, backup);
  if (sha256File(target) !== R41) throw new Error("Concurrent-change safety stop: AI Today CSS changed after validation.");
  fs.copyFileSync(SOURCE, target);
  if (sha256File(target) !== R42) throw new Error("Post-write checksum failed.");
  console.log(` + ${REL}`);
  console.log(`[${VERSION}] Installed successfully.`);
  console.log(`[${VERSION}] Only AI Today CSS was changed. No queue logic, song selection, player controls, DSP/WASM, R2/Supabase, or My Music tabs were changed.`);
  console.log(`[${VERSION}] Backup: ${backupRoot}`);
  console.log(`[${VERSION}] Next: npm run build`);
} catch (error) {
  console.error(`[${VERSION}] ERROR: ${String(error?.message || error)}`);
  if (fs.existsSync(backup)) fs.copyFileSync(backup, target);
  console.error(`[${VERSION}] Rollback complete.`);
  process.exit(1);
}
