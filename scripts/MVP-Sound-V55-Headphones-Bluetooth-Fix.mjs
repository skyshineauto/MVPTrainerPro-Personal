import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(start) {
  let current = path.resolve(start);

  for (let i = 0; i < 6; i += 1) {
    const packageFile = path.join(current, "package.json");
    const playerFile = path.join(current, "src", "lib", "musicPlayer.ts");

    if (fs.existsSync(packageFile) && fs.existsSync(playerFile)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    "Could not find MVPTrainerPro-Personal. Put this installer inside the repository scripts folder."
  );
}

const ROOT = findRepoRoot(SCRIPT_DIR);

const FILES = {
  player: "src/lib/musicPlayer.ts",
  bridge: "src/lib/audio/mvpStudioEngine.ts",
  cpp: "dsp/v2/mvp_hd_v2.cpp",
  staticTest: "scripts/test-v54-production-static.mjs",
};

const PLAYER_VERSION = "v26-broadcast-v5-5-live-controls";
const ASSET_VERSION = "10.0.5-broadcast-v5-5-live-controls";

function absolute(rel) {
  return path.join(ROOT, rel);
}

function read(rel) {
  return fs.readFileSync(absolute(rel), "utf8");
}

function write(rel, content) {
  fs.writeFileSync(absolute(rel), content, "utf8");
}

for (const rel of Object.values(FILES)) {
  if (!fs.existsSync(absolute(rel))) {
    throw new Error(`Required project file is missing: ${rel}`);
  }
}

console.log("");
console.log("============================================================");
console.log(" MVP SOUND V5.5 - HEADPHONES + BLUETOOTH FIX");
console.log("============================================================");
console.log("");
console.log(`Repository: ${ROOT}`);
console.log("");

const originals = new Map(
  Object.values(FILES).map((rel) => [rel, read(rel)])
);

const backupDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "mvp-sound-v55-backup-")
);

for (const rel of Object.values(FILES)) {
  const backupName = rel.replace(/[\\/]/g, "__");
  fs.writeFileSync(
    path.join(backupDir, backupName),
    originals.get(rel),
    "utf8"
  );
}

console.log(`Backup: ${backupDir}`);
console.log("");

function restoreOriginals() {
  for (const [rel, content] of originals.entries()) {
    write(rel, content);
  }
}

function replaceExact(rel, before, after, label) {
  const source = read(rel);

  const first = source.indexOf(before);
  const last = source.lastIndexOf(before);

  if (first === -1) {
    throw new Error(
      `${label}\nExpected code was not found in ${rel}.\n` +
      `Your repository may be newer than this installer.`
    );
  }

  if (first !== last) {
    throw new Error(
      `${label}\nExpected exactly one match in ${rel}, but found more than one.`
    );
  }

  const output =
    source.slice(0, first) +
    after +
    source.slice(first + before.length);

  write(rel, output);
  console.log(`✔ ${label}`);
}

function replaceCppFunction(rel, signature, replacement, label) {
  const source = read(rel);
  const start = source.indexOf(signature);

  if (start === -1) {
    throw new Error(
      `${label}\nCould not find C++ function: ${signature}`
    );
  }

  const openBrace = source.indexOf("{", start);

  if (openBrace === -1) {
    throw new Error(`${label}\nCould not find opening brace.`);
  }

  let depth = 0;
  let end = -1;

  for (let i = openBrace; i < source.length; i += 1) {
    const character = source[i];

    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;

    if (depth === 0) {
      end = i + 1;
      break;
    }
  }

  if (end === -1) {
    throw new Error(`${label}\nCould not find closing brace.`);
  }

  const output =
    source.slice(0, start) +
    replacement.trim() +
    source.slice(end);

  write(rel, output);
  console.log(`✔ ${label}`);
}

try {
  const playerAlreadyDone = read(FILES.player).includes(PLAYER_VERSION);
  const bridgeAlreadyDone = read(FILES.bridge).includes(ASSET_VERSION);

  if (playerAlreadyDone && bridgeAlreadyDone) {
    console.log("✔ MVP SOUND V5.5 is already installed.");
    process.exit(0);
  }

  /*
   * ------------------------------------------------------------------------
   * MUSIC PLAYER
   * ------------------------------------------------------------------------
   */

  replaceExact(
    FILES.player,
    'const AUDIO_ENGINE_VERSION = "v25-broadcast-v5-4-live-audible-power";',
    `const AUDIO_ENGINE_VERSION = "${PLAYER_VERSION}";`,
    "Update audio-engine generation"
  );

  /*
   * Old generations could preserve Device Direct when the saved mode was Pure.
   * V5.5 starts the visible MVP SOUND controls on one authoritative WASM path.
   */
  replaceExact(
    FILES.player,
    'savePlayerSetting(STORAGE_KEYS.dspBypass, readPlaybackMode() === "device_direct" ? "true" : "false");',
    `savePlayerSetting(STORAGE_KEYS.playbackMode, "mvp_hd");
  savePlayerSetting(STORAGE_KEYS.dspBypass, "false");`,
    "Migrate saved sound mode onto the WASM route"
  );

  /*
   * Changing Headphones/Bluetooth profiles must not move Pure onto another
   * browser playback architecture.
   */
  replaceExact(
    FILES.player,
    'const playbackMode: MusicPlaybackMode = settings.experienceMode === "pure" ? "device_direct" : "mvp_hd";',
    'const playbackMode: MusicPlaybackMode = "mvp_hd";',
    "Keep profile switching on the live processor"
  );

  /*
   * The old validator stopped checking the effects when Pure was selected.
   * Pure inside MVP HD must still validate the controls selected by the user.
   */
  replaceExact(
    FILES.player,
    'if (expectedMode === "pure") return true;',
    'if (state.playbackMode === "device_direct") return true;',
    "Validate effects and EQ in Pure"
  );

  /*
   * Pure / Adaptive / Power are musical modes inside the same processor.
   * Do not rebuild/switch the browser route when clicking them.
   */
  replaceExact(
    FILES.player,
    'const targetPlayback: MusicPlaybackMode = mode === "pure" ? "device_direct" : "mvp_hd";',
    'const targetPlayback: MusicPlaybackMode = "mvp_hd";',
    "Keep Pure Adaptive Power on one WASM path"
  );

  /*
   * ------------------------------------------------------------------------
   * CACHE / ASSET VERSION
   * ------------------------------------------------------------------------
   */

  replaceExact(
    FILES.bridge,
    'const ASSET_VERSION = "10.0.4-broadcast-v5-4-live-audible-power";',
    `const ASSET_VERSION = "${ASSET_VERSION}";`,
    "Force fresh Worklet and WASM assets"
  );

  /*
   * ------------------------------------------------------------------------
   * C++ DSP
   * ------------------------------------------------------------------------
   */

  replaceExact(
    FILES.cpp,
    "// MVP Trainer Pro Broadcast Engine V5.4 LIVE AUDIBLE POWER",
    "// MVP Trainer Pro Broadcast Engine V5.5 LIVE CONTROLS",
    "Update DSP generation marker"
  );

  /*
   * Power gets stronger AVERAGE loudness through controlled compression +
   * makeup. The existing look-ahead limiter remains the final peak protector.
   *
   * Pure returns immediately from this stage.
   */
  replaceCppFunction(
    FILES.cpp,
    "inline void applyModeCore(float &l,float &r)",
    `
inline void applyModeCore(float &l,float &r){
  if(gMode==0)return;

  const bool power=gMode==2;
  const float i=gIntensity;

  const float det=maxf(absf(l),absf(r));
  const float ec=det>gCompEnv?gCompAttack:gCompRelease;

  gCompEnv+=(det-gCompEnv)*ec;

  const float threshold=
    power
      ? (.47f-.09f*i)
      : (.68f-.06f*i);

  const float ratio=
    power
      ? (2.45f+1.20f*i)
      : (1.30f+.32f*i);

  float target=1;

  if(gCompEnv>threshold&&gCompEnv>1e-6f){
    const float over=gCompEnv/threshold;
    target=static_cast<float>(
      pow(over,(1.0f/ratio)-1.0f)
    );
  }

  const float gc=
    target<gCompGain
      ? gCompAttack
      : gCompRelease;

  gCompGain+=(target-gCompGain)*gc;

  const float blend=
    power
      ? (.66f+.14f*i)
      : (.28f+.10f*i);

  const float comp=
    (1-blend)+blend*gCompGain;

  float makeupDb=
    power
      ? (4.10f+2.65f*i)
      : (1.05f+.90f*i);

  const float densityGuard=
    clampf(
      (gProgramDensity-.70f)/.23f,
      0,
      1
    );

  if(power){
    makeupDb-=
      densityGuard*(1.00f+.80f*i);
  }else{
    makeupDb-=
      densityGuard*.28f;
  }

  const float gain=
    comp*dbToGain(makeupDb);

  l*=gain;
  r*=gain;

  l=gModeAirL.process(
    gModePresenceL.process(
      gModeMudL.process(
        gModeBodyL.process(
          gModeBassL.process(l)
        )
      )
    )
  );

  r=gModeAirR.process(
    gModePresenceR.process(
      gModeMudR.process(
        gModeBodyR.process(
          gModeBassR.process(r)
        )
      )
    )
  );
}
`,
    "Increase Adaptive/Power audible separation"
  );

  /*
   * This is the main functional repair.
   *
   * Old behavior:
   *   Pure processed Bass / Impact / Clarity / Stage / Personal / EQ into
   *   temporary samples and threw those samples away.
   *
   * V5.5:
   *   Pure with everything OFF remains clean/reference.
   *   If the user explicitly turns an effect ON, it affects the real output.
   *
   * Adaptive and Power use the exact same authoritative signal route.
   */
  replaceCppFunction(
    FILES.cpp,
    "int mvp_v2_process(int frames)",
    `
int mvp_v2_process(int frames){
  if(frames<1||frames>kFrames)return 0;

  for(int i=0;i<frames;++i){
    float l=gInputL[i];
    float r=gInputR[i];

    updateAnalysis(l,r);

    gIntensity+=
      (gIntensityTarget-gIntensity)*gSmoothIntensity;

    gBassCharacter+=
      (gBassCharacterTarget-gBassCharacter)*gSmoothBass;

    /*
     * User EQ works in every visible musical mode.
     */
    applyEq(l,r);

    /*
     * Automatic Master Prep remains excluded from the clean Pure baseline.
     * Run it on temporary samples in Pure so its filter state stays warm.
     */
    if(gMode!=0){
      applyMaster(l,r);
    }else{
      float ml=l;
      float mr=r;
      applyMaster(ml,mr);
    }

    /*
     * Pure makes this a no-op.
     * Adaptive and Power process the real output.
     */
    applyModeCore(l,r);

    /*
     * Every visible effect operates on the real output whenever enabled.
     */
    applyBass(l,r);
    applyImpact(l,r);
    applyClarity(l,r);
    applySpatial(l,r);
    applyPersonal(l,r);

    /*
     * Pure with all processing OFF remains the clean reference path.
     * If any visible processor is enabled, true-peak protection is active.
     */
    const bool processed=
      gMode!=0||
      gEqEnabled||
      gBassEnabled||
      gImpactEnabled||
      gClarityEnabled||
      gSpatialEnabled||
      gPersonalEnabled;

    float ol=0;
    float orr=0;

    limiter(
      l,
      r,
      ol,
      orr,
      processed
    );

    gOutputL[i]=ol;
    gOutputR[i]=orr;

    meter(ol,orr);
  }

  return 1;
}
`,
    "Make every visible sound control affect the real output"
  );

  /*
   * ------------------------------------------------------------------------
   * STATIC CI TEST
   * ------------------------------------------------------------------------
   */

  replaceExact(
    FILES.staticTest,
    "assert.match(cpp,/V5\\.4 LIVE AUDIBLE POWER/);",
    "assert.match(cpp,/V5\\.5 LIVE CONTROLS/);",
    "Update DSP generation test"
  );

  replaceExact(
    FILES.staticTest,
    "assert.match(bridge,/10\\.0\\.4-broadcast-v5-4-live-audible-power/);",
    "assert.match(bridge,/10\\.0\\.5-broadcast-v5-5-live-controls/);",
    "Update asset-version test"
  );

  replaceExact(
    FILES.staticTest,
    "assert.match(player,/v25-broadcast-v5-4-live-audible-power/);",
    "assert.match(player,/v26-broadcast-v5-5-live-controls/);",
    "Update player-version test"
  );

  replaceExact(
    FILES.staticTest,
    "console.log('V5.4 production static wiring: PASS');",
    `
assert.doesNotMatch(
  player,
  /experienceMode === "pure" \\? "device_direct" : "mvp_hd"/,
  "Pure profile restore must not switch away from WASM"
);

assert.doesNotMatch(
  player,
  /mode === "pure" \\? "device_direct" : "mvp_hd"/,
  "Pure Adaptive Power must use one WASM route"
);

assert.doesNotMatch(
  cpp,
  /float sl=l,sr=r/,
  "Pure must not discard enabled effects"
);

assert.match(
  cpp,
  /gEqEnabled\\|\\|/,
  "Pure effect safety processing is missing"
);

console.log('V5.5 production static wiring: PASS');`.trim(),
    "Add V5.5 regression protection"
  );

  /*
   * ------------------------------------------------------------------------
   * INSTALL VERIFICATION
   * ------------------------------------------------------------------------
   */

  const player = read(FILES.player);
  const bridge = read(FILES.bridge);
  const cpp = read(FILES.cpp);

  if (!player.includes(PLAYER_VERSION)) {
    throw new Error(
      "Player version verification failed."
    );
  }

  if (!bridge.includes(ASSET_VERSION)) {
    throw new Error(
      "Audio asset version verification failed."
    );
  }

  if (
    player.includes(
      'mode === "pure" ? "device_direct" : "mvp_hd"'
    )
  ) {
    throw new Error(
      "Old Pure route switching still exists."
    );
  }

  if (
    player.includes(
      'experienceMode === "pure" ? "device_direct" : "mvp_hd"'
    )
  ) {
    throw new Error(
      "Old profile Pure route switching still exists."
    );
  }

  if (cpp.includes("float sl=l,sr=r")) {
    throw new Error(
      "Old discarded-effect Pure DSP branch still exists."
    );
  }

  /*
   * Preserve the repaired Impact transient detector from V5.4.
   */
  if (
    !cpp.includes(
      "gImpactFast-gImpactSlow*1.18f"
    )
  ) {
    throw new Error(
      "Impact transient distortion protection is missing."
    );
  }

  if (!cpp.includes("gImpactSlow+.050f")) {
    throw new Error(
      "Impact detector floor protection is missing."
    );
  }

  console.log("");
  console.log("Running production static validation...");
  console.log("");

  const staticResult = spawnSync(
    process.execPath,
    [
      path.join(
        ROOT,
        "scripts",
        "test-v54-production-static.mjs"
      ),
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
    }
  );

  if (staticResult.status !== 0) {
    throw new Error(
      "Production static validation failed."
    );
  }

  /*
   * Do not install dependencies automatically.
   * If node_modules already exists, verify that the React application builds.
   */
  if (fs.existsSync(path.join(ROOT, "node_modules"))) {
    console.log("");
    console.log("Running React production build...");
    console.log("");

    const npmCommand =
      process.platform === "win32"
        ? "npm.cmd"
        : "npm";

    const buildResult = spawnSync(
      npmCommand,
      ["run", "build"],
      {
        cwd: ROOT,
        stdio: "inherit",
      }
    );

    if (buildResult.status !== 0) {
      throw new Error(
        "React production build failed."
      );
    }
  } else {
    console.log("");
    console.log(
      "node_modules not present - local React build skipped."
    );
    console.log(
      "GitHub Actions will run the full production build after push."
    );
  }

  console.log("");
  console.log("============================================================");
  console.log(" MVP SOUND V5.5 INSTALL COMPLETE");
  console.log("============================================================");
  console.log("");
  console.log("Fixed:");
  console.log("  ✔ Pure / Adaptive / Power use one WASM route");
  console.log("  ✔ Pure remains clean when effects are OFF");
  console.log("  ✔ Bass works when explicitly enabled");
  console.log("  ✔ Impact works when explicitly enabled");
  console.log("  ✔ Clarity works when explicitly enabled");
  console.log("  ✔ Stage works when explicitly enabled");
  console.log("  ✔ Personal Sound operates on the real output");
  console.log("  ✔ 31-band EQ operates on the real output");
  console.log("  ✔ Headphones stay on the same processor");
  console.log("  ✔ Bluetooth stays on the same processor");
  console.log("  ✔ Adaptive is stronger than Pure");
  console.log("  ✔ Power receives stronger loudness/density");
  console.log("  ✔ True-peak protection remains active");
  console.log("  ✔ V5.4 Impact distortion repair preserved");
  console.log("  ✔ Browser Worklet/WASM cache version changed");
  console.log("");
  console.log("NO Git commands were run.");
  console.log("NO commit was made.");
  console.log("NO push was made.");
  console.log("");
  console.log("NEXT:");
  console.log("  Open GitHub Desktop");
  console.log("  Review changed files");
  console.log("  Commit to main");
  console.log("  Push origin");
  console.log("");
  console.log(
    "IMPORTANT: wait for the GitHub WASM build/bot commit before testing production."
  );
  console.log("");
  console.log(`Backup: ${backupDir}`);
  console.log("");
  console.log("============================================================");
} catch (error) {
  console.error("");
  console.error("============================================================");
  console.error(" INSTALL FAILED - RESTORING ORIGINAL FILES");
  console.error("============================================================");
  console.error("");

  restoreOriginals();

  console.error(
    error instanceof Error
      ? error.message
      : String(error)
  );

  console.error("");
  console.error("Original project files were restored.");
  console.error(`Backup: ${backupDir}`);
  console.error("");

  process.exit(1);
}