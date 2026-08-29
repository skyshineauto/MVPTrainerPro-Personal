import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const VERSION = "r43-ai-today-dense-3d";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(SCRIPT_DIR, "payload", "src", "features", "music", "premium", "MusicTodayAi.css");
const REL = "src/features/music/premium/MusicTodayAi.css";
const R42 = "78b062bd3f49a3b64714c670603ba575ac5995d403fbb45c6a48b2b53b227bdc";
const R43 = "292e02292163474169f43cb20233c977da6fd072ab892a89e738847b0742954a";

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
console.log(`[${VERSION}] AI Today dense 3D visual polish only`);
console.log(`[${VERSION}] Repo: ${root}`);

try {
  if (!fs.existsSync(SOURCE)) throw new Error("Installer payload is incomplete.");
  if (sha256File(SOURCE) !== R43) throw new Error("Installer payload checksum failed.");
  if (!fs.existsSync(target)) throw new Error(`Safety stop: missing ${REL}. R42 must be installed first.`);
  const current = sha256File(target);
  if (current === R43) {
    console.log(`[${VERSION}] Already installed. No files changed.`);
    process.exit(0);
  }
  if (current !== R42) throw new Error(`Safety stop: ${REL} is not the exact R42 file. Current SHA256: ${current}`);
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
  if (sha256File(target) !== R42) throw new Error("Concurrent-change safety stop: AI Today CSS changed after validation.");
  fs.copyFileSync(SOURCE, target);
  if (sha256File(target) !== R43) throw new Error("Post-write checksum failed.");
  console.log(` + ${REL}`);
  console.log(`[${VERSION}] Installed successfully.`);
  console.log(`[${VERSION}] Desktop: fuller typography, smaller Tune, deeper 3D. Mobile: same compact content with matching depth.`);
  console.log(`[${VERSION}] No queue logic, song selection, player controls, DSP/WASM, R2/Supabase, or My Music tabs were changed.`);
  console.log(`[${VERSION}] Backup: ${backupRoot}`);
  console.log(`[${VERSION}] Next: npm run build`);
} catch (error) {
  console.error(`[${VERSION}] ERROR: ${String(error?.message || error)}`);
  if (fs.existsSync(backup)) fs.copyFileSync(backup, target);
  console.error(`[${VERSION}] Rollback complete.`);
  process.exit(1);
}
