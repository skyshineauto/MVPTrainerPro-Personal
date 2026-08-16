import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILE = path.join(ROOT, "src", "lib", "musicPlayer.ts");
const REVISION = "v4-5-build-repair-r1";
const BACKUP_SUFFIX = ".pre-studio-v4-5-build-repair.bak";
const MARKER = "MVP_STUDIO_V4_5_HEADPHONE_CONTINUITY";

function fail(message) {
  console.error(`MVP Studio V4.5 build repair stopped: ${message}`);
  console.error("Nothing was changed.");
  process.exit(1);
}

if (!fs.existsSync(FILE)) {
  fail("src/lib/musicPlayer.ts was not found. Run this from the repo root.");
}

const original = fs.readFileSync(FILE, "utf8");

if (!original.includes(MARKER)) {
  fail("V4.5 Headphone + Continuity marker was not found in musicPlayer.ts.");
}

const fixes = [
  [
    "export const MUSIC_OUTPUT_PROFILES:export const MUSIC_OUTPUT_PROFILES:",
    "export const MUSIC_OUTPUT_PROFILES:",
    "MUSIC_OUTPUT_PROFILES declaration",
  ],
  [
    "export async function loadMusicLibraryexport async function loadMusicLibrary",
    "export async function loadMusicLibrary",
    "loadMusicLibrary declaration",
  ],
  [
    "export function activateAllMusicTracks()export function activateAllMusicTracks()",
    "export function activateAllMusicTracks()",
    "activateAllMusicTracks declaration",
  ],
  [
    "export async function playMusicAdHocQueueexport async function playMusicAdHocQueue",
    "export async function playMusicAdHocQueue",
    "playMusicAdHocQueue declaration",
  ],
  [
    "export async function playMusicPlaylistexport async function playMusicPlaylist",
    "export async function playMusicPlaylist",
    "playMusicPlaylist declaration",
  ],
];

let updated = original;
let repaired = 0;

for (const [broken, fixed, label] of fixes) {
  const count = updated.split(broken).length - 1;
  if (count > 1) {
    fail(`${label} broken token matched more than once (${count}). Refusing an ambiguous repair.`);
  }
  if (count === 1) {
    updated = updated.replace(broken, fixed);
    repaired += 1;
    console.log(`Repaired: ${label}`);
  }
}

// Verify none of the known broken declarations remain.
for (const [broken, , label] of fixes) {
  if (updated.includes(broken)) {
    fail(`${label} is still malformed after repair.`);
  }
}

// Confirm the intended V4.5 queue/headphone changes are still present.
const required = [
  "activeQueueTrackIds",
  "MVP_STUDIO_V4_5_HEADPHONE_CONTINUITY",
  "mvp_music_active_queue_track_ids_v1",
  "activateMusicAdHocQueue",
  "resolveSavedQueue",
];
for (const token of required) {
  if (!updated.includes(token)) {
    fail(`required V4.5 token is missing after repair: ${token}`);
  }
}

if (repaired === 0) {
  console.log("No known duplicated V4.5 declaration tokens were found.");
  console.log("The file may already be repaired.");
  process.exit(0);
}

const backup = `${FILE}${BACKUP_SUFFIX}`;
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, updated, "utf8");

console.log("");
console.log("MVP Studio V4.5 build repair applied successfully.");
console.log(`(${REVISION})`);
console.log(`Repaired ${repaired} duplicated TypeScript declaration anchors.`);
console.log("V4.5 headphone / queue / workout continuity changes were preserved.");
console.log(`Backup: src/lib/musicPlayer.ts${BACKUP_SUFFIX}`);
console.log("NEXT: run npm run build");
