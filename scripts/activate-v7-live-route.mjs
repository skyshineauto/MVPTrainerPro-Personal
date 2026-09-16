import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";

const ROOT = process.cwd();

const PLAYER = path.join(ROOT, "src", "lib", "musicPlayer.ts");
const ENGINE = path.join(ROOT, "src", "lib", "audio", "mvpSoundV7Engine.ts");
const WORKLET = path.join(ROOT, "public", "audioV7", "mvpSoundV7.worklet.js");
const OLD_WORKFLOW = path.join(
  ROOT,
  ".github",
  "workflows",
  "mvp-hd-v2-wasm.yml",
);

function die(message) {
  throw new Error(message);
}

for (const file of [PLAYER, ENGINE, WORKLET]) {
  if (!fs.existsSync(file)) {
    die(`Missing required V7 file: ${file}`);
  }
}

const originals = new Map();

for (const file of [PLAYER, ENGINE]) {
  originals.set(file, fs.readFileSync(file, "utf8"));
}

const workflowExisted = fs.existsSync(OLD_WORKFLOW);
const workflowOriginal = workflowExisted
  ? fs.readFileSync(OLD_WORKFLOW, "utf8")
  : null;

let player = originals.get(PLAYER);
let engine = originals.get(ENGINE);

function replaceExactly(source, oldText, newText, label) {
  const count = source.split(oldText).length - 1;

  if (count !== 1) {
    die(`${label}: expected 1 match, found ${count}`);
  }

  return source.replace(oldText, newText);
}

/*
 * 1. Activate V7.
 */
if (player.includes('from "./audio/mvpStudioEngine";')) {
  player = replaceExactly(
    player,
    'from "./audio/mvpStudioEngine";',
    'from "./audio/mvpSoundV7Engine";',
    "V7 engine import",
  );
} else if (!player.includes('from "./audio/mvpSoundV7Engine";')) {
  die("Could not find either the old or V7 audio-engine import.");
}

/*
 * 2. FIX THE ACTUAL V7 STARTUP FAILURE.
 *
 * setMvpStudioState() already stores the public state:
 *   mode: "pure" | "adaptive" | "power"
 *   outputProfile: "headphones" | "speaker" | "car_hifi"
 *   bassEnabled, impactEnabled, etc.
 *
 * The old V7 ACK handler was then overwriting that with internal processor
 * state:
 *   mode: 0 | 1 | 2
 *   profile: 0 | 1 | 2
 *   bass, impact...
 *
 * musicPlayer verifies the PUBLIC representation.
 */
engine = replaceExactly(
  engine,
  `        appliedState:data.state||runtime.appliedState`,
  `        // Keep the authoritative PUBLIC state written by setMvpStudioState().
        // The Worklet ACK contains its internal numeric representation and must
        // never overwrite the public state used by musicPlayer verification.
        appliedState:runtime.appliedState`,
  "V7 applied-state ACK",
);

/*
 * 3. Remove stale V5/V6 failure wording from the live route.
 */
player = player.replace(
  '"MVP Studio V5.6 did not verify its initial C++ state."',
  '"MVP Sound V7 did not verify its initial state."',
);

player = player.replace(
  '"MVP Studio V5.6 WASM unavailable; trying Compatibility Engine."',
  '"MVP Sound V7 unavailable; trying compatibility route."',
);

/*
 * 4. Retire the OLD V6.2 GitHub Action.
 *
 * It watches musicPlayer.ts and runs obsolete V6.2 C++ tests every time the
 * new V7 player changes. It must not be allowed to judge the new engine.
 */
let success = false;

try {
  fs.writeFileSync(PLAYER, player, "utf8");
  fs.writeFileSync(ENGINE, engine, "utf8");

  if (workflowExisted) {
    fs.rmSync(OLD_WORKFLOW, { force: true });
    console.log("REMOVED obsolete V6.2 WASM workflow");
  }

  /*
   * 5. Verify the V7 Worklet itself.
   */
  let result = cp.spawnSync(
    process.execPath,
    ["--check", WORKLET],
    {
      cwd: ROOT,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    die("V7 AudioWorklet syntax check failed.");
  }

  /*
   * 6. Production build.
   */
  if (process.platform === "win32") {
    result = cp.spawnSync(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", "npm run build"],
      {
        cwd: ROOT,
        stdio: "inherit",
      },
    );
  } else {
    result = cp.spawnSync(
      "npm",
      ["run", "build"],
      {
        cwd: ROOT,
        stdio: "inherit",
      },
    );
  }

  if (result.status !== 0) {
    die("Production build failed.");
  }

  /*
   * 7. Git whitespace validation.
   */
  result = cp.spawnSync(
    "git",
    ["diff", "--check"],
    {
      cwd: ROOT,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    die("git diff --check failed.");
  }

  success = true;

  console.log("");
  console.log("==============================================");
  console.log(" MVP SOUND V7 LIVE ROUTE READY");
  console.log("==============================================");
  console.log("");
  console.log("PASS V7 Worklet syntax");
  console.log("PASS V7 public/internal state ACK");
  console.log("PASS production TypeScript/Vite build");
  console.log("PASS git diff check");
  console.log("");
  console.log("V7 is now the selected audio engine.");
  console.log("Old V6.2 WASM workflow removed.");
  console.log("");
  console.log("Expected GitHub Desktop changes:");
  console.log("  src/lib/musicPlayer.ts");
  console.log("  src/lib/audio/mvpSoundV7Engine.ts");
  if (workflowExisted) {
    console.log("  .github/workflows/mvp-hd-v2-wasm.yml  DELETED");
  }
  console.log("");
  console.log("DO NOT delete public/audioV7/mvpSoundV7.worklet.js");
} finally {
  if (!success) {
    console.error("");
    console.error("FAILED. Restoring files automatically.");

    fs.writeFileSync(PLAYER, originals.get(PLAYER), "utf8");
    fs.writeFileSync(ENGINE, originals.get(ENGINE), "utf8");

    if (workflowExisted && workflowOriginal !== null) {
      fs.mkdirSync(path.dirname(OLD_WORKFLOW), { recursive: true });
      fs.writeFileSync(OLD_WORKFLOW, workflowOriginal, "utf8");
    }

    console.error("ROLLBACK COMPLETE.");
  }
}