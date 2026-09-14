import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(start) {
  let current = path.resolve(start);

  for (let i = 0; i < 8; i += 1) {
    if (
      fs.existsSync(path.join(current, "package.json")) &&
      fs.existsSync(path.join(current, "src", "lib", "musicPlayer.ts")) &&
      fs.existsSync(path.join(current, "dsp", "v2", "mvp_hd_v2.cpp"))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    "Could not find MVPTrainerPro-Personal. Put this file inside the repository scripts folder."
  );
}

const ROOT = findRepoRoot(SCRIPT_DIR);

const FILES = {
  player: "src/lib/musicPlayer.ts",
  bridge: "src/lib/audio/mvpStudioEngine.ts",
  cpp: "dsp/v2/mvp_hd_v2.cpp",
  staticTest: "scripts/test-v54-production-static.mjs",
  matrix: "scripts/test-v54-matrix.mjs",
};

const MUTABLE_FILES = [
  FILES.bridge,
  FILES.cpp,
  FILES.staticTest,
  FILES.matrix,
];

const NEW_ASSET_VERSION =
  "10.0.6-broadcast-v5-5-1-stable-live-controls";

const NEW_CPP_MARKER =
  "// MVP Trainer Pro Broadcast Engine V5.5.1 STABLE LIVE CONTROLS";

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
    throw new Error(`Required file missing: ${rel}`);
  }
}

console.log("");
console.log("============================================================");
console.log(" MVP SOUND V5.5.1 - STABLE MATRIX FIX");
console.log("============================================================");
console.log("");
console.log(`Repository: ${ROOT}`);
console.log("");

const originals = new Map(
  MUTABLE_FILES.map((rel) => [rel, read(rel)])
);

const backupDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "mvp-sound-v551-backup-")
);

for (const rel of MUTABLE_FILES) {
  fs.writeFileSync(
    path.join(
      backupDir,
      rel.replace(/[\\/]/g, "__")
    ),
    originals.get(rel),
    "utf8"
  );
}

console.log(`Backup: ${backupDir}`);
console.log("");

function restore() {
  for (const [rel, content] of originals.entries()) {
    write(rel, content);
  }
}

function replaceOneOf(rel, candidates, replacement, label) {
  const source = read(rel);

  if (source.includes(replacement)) {
    console.log(`✔ ${label} (already correct)`);
    return;
  }

  const found = candidates.filter((candidate) =>
    source.includes(candidate)
  );

  if (found.length !== 1) {
    throw new Error(
      `${label}: expected exactly one known source pattern in ${rel}, found ${found.length}.`
    );
  }

  write(rel, source.replace(found[0], replacement));
  console.log(`✔ ${label}`);
}

function replaceCppFunction(rel, signature, replacement, label) {
  const source = read(rel);
  const start = source.indexOf(signature);

  if (start < 0) {
    throw new Error(`${label}: ${signature} was not found.`);
  }

  const open = source.indexOf("{", start);

  if (open < 0) {
    throw new Error(`${label}: opening brace not found.`);
  }

  let depth = 0;
  let end = -1;

  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;

    if (depth === 0) {
      end = index + 1;
      break;
    }
  }

  if (end < 0) {
    throw new Error(`${label}: closing brace not found.`);
  }

  write(
    rel,
    source.slice(0, start) +
      replacement.trim() +
      source.slice(end)
  );

  console.log(`✔ ${label}`);
}

function runNodeScript(rel) {
  const result = spawnSync(
    process.execPath,
    [absolute(rel)],
    {
      cwd: ROOT,
      stdio: "inherit",
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${rel} failed.`);
  }
}

function runAppBuild() {
  if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
    console.log("");
    console.log(
      "node_modules not present — local React build skipped."
    );
    return;
  }

  console.log("");
  console.log("Running React production build...");
  console.log("");

  let result;

  if (process.platform === "win32") {
    const command =
      process.env.ComSpec ||
      "C:\\Windows\\System32\\cmd.exe";

    result = spawnSync(
      command,
      ["/d", "/s", "/c", "npm run build"],
      {
        cwd: ROOT,
        stdio: "inherit",
      }
    );
  } else {
    result = spawnSync(
      "npm",
      ["run", "build"],
      {
        cwd: ROOT,
        stdio: "inherit",
      }
    );
  }

  if (result.error) {
    throw new Error(
      `Could not launch production build: ${result.error.message}`
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `React production build failed with exit code ${result.status}.`
    );
  }
}

const SAFE_MODE_CORE = `
inline void applyModeCore(float &l,float &r){
  if(gMode==0)return;

  bool power=gMode==2;

  float i=gIntensity;
  float det=maxf(absf(l),absf(r));
  float ec=det>gCompEnv?gCompAttack:gCompRelease;

  gCompEnv+=(det-gCompEnv)*ec;

  float threshold=
    power
      ? (.50f-.10f*i)
      : (.70f-.06f*i);

  float ratio=
    power
      ? (2.25f+1.25f*i)
      : (1.22f+.28f*i);

  float target=1;

  if(gCompEnv>threshold&&gCompEnv>1e-6f){
    float over=gCompEnv/threshold;

    target=static_cast<float>(
      pow(over,(1.0f/ratio)-1.0f)
    );
  }

  float gc=
    target<gCompGain
      ? gCompAttack
      : gCompRelease;

  gCompGain+=(target-gCompGain)*gc;

  float blend=
    power
      ? (.62f+.14f*i)
      : (.25f+.10f*i);

  float comp=
    (1-blend)+blend*gCompGain;

  /*
   * This is the proven V5.4 loudness core.
   *
   * It already passed the exhaustive 1194-case matrix.
   * Do NOT push Power harder here and make the limiter do
   * 9.5+ dB of gain reduction.
   */
  float makeupDb=
    power
      ? (3.0f+2.35f*i)
      : (.80f+.75f*i);

  float densityGuard=
    clampf(
      (gProgramDensity-.72f)/.22f,
      0,
      1
    );

  if(power){
    makeupDb-=
      densityGuard*(.85f+.65f*i);
  }else{
    makeupDb-=
      densityGuard*.25f;
  }

  float gain=
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
`;

const LIVE_PROCESS = `
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
     * The visible 31-band EQ works in every musical mode.
     */
    applyEq(l,r);

    /*
     * Master Prep belongs to Adaptive / Power.
     *
     * In Pure we keep its filter state warm on disposable samples,
     * but we do not alter the reference signal.
     */
    if(gMode!=0){
      applyMaster(l,r);
    }else{
      float ml=l;
      float mr=r;
      applyMaster(ml,mr);
    }

    /*
     * Pure = no automatic mode coloration.
     * Adaptive and Power process the live samples.
     */
    applyModeCore(l,r);

    /*
     * These are explicit controls.
     * If the user turns one on, it must affect the actual output
     * regardless of whether the baseline mode is Pure,
     * Adaptive, or Power.
     */
    applyBass(l,r);
    applyImpact(l,r);
    applyClarity(l,r);
    applySpatial(l,r);
    applyPersonal(l,r);

    /*
     * Pure with every control OFF remains reference-clean.
     * Any explicitly selected processing receives limiter safety.
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
`;

const MATRIX_SOURCE = `import fs from 'node:fs';

const wasmPath =
  process.argv[2] ||
  'public/audioV2/mvpHdV2.wasm';

const bytes =
  fs.readFileSync(wasmPath);

const imports = {
  env: {
    sin: Math.sin,
    cos: Math.cos,
    pow: Math.pow,
    exp: Math.exp,
    log10: Math.log10,
  },
};

const sr = 48000;

function makeSig(kind,n=8192){
  const L=new Float32Array(n);
  const R=new Float32Array(n);

  for(let i=0;i<n;i++){
    const t=i/sr;

    const env=
      kind==='dynamic'
        ? (.45+(((t%.25)<.018)
            ? Math.exp(-(t%.25)*120)
            : 0))
        : kind==='hot'
          ? .90
          : 1.15;

    let x=(
      .30*Math.sin(2*Math.PI*50*t)+
      .22*Math.sin(2*Math.PI*110*t)+
      .18*Math.sin(2*Math.PI*1000*t)+
      .12*Math.sin(2*Math.PI*3400*t)+
      .08*Math.sin(2*Math.PI*9000*t)
    )*env;

    let y=(
      .28*Math.sin(2*Math.PI*50*t+.03)+
      .20*Math.sin(2*Math.PI*110*t+.1)+
      .18*Math.sin(2*Math.PI*1000*t+.15)+
      .11*Math.sin(2*Math.PI*3400*t+.4)+
      .07*Math.sin(2*Math.PI*9000*t+.7)
    )*env;

    if(kind==='brick'){
      x=Math.max(-.94,Math.min(.94,x*1.65));
      y=Math.max(-.94,Math.min(.94,y*1.65));
    }

    L[i]=x;
    R[i]=y;
  }

  return {L,R};
}

const sigs={
  dynamic:makeSig('dynamic'),
  hot:makeSig('hot'),
  brick:makeSig('brick'),
};

async function run(c){
  const {instance}=
    await WebAssembly.instantiate(bytes,imports);

  const e=instance.exports;

  if(e.mvp_v2_init(sr)!==1){
    throw Error(
      'init case='+JSON.stringify(c)
    );
  }

  e.mvp_v2_set_output_profile(c.p);
  e.mvp_v2_set_mode(c.m);
  e.mvp_v2_set_intensity(c.i);

  e.mvp_v2_set_bass_enabled(
    c.mask&1 ? 1 : 0
  );

  e.mvp_v2_set_bass_character(
    c.bc??.5
  );

  e.mvp_v2_set_impact_enabled(
    c.mask&2 ? 1 : 0
  );

  e.mvp_v2_set_clarity_enabled(
    c.mask&4 ? 1 : 0
  );

  e.mvp_v2_set_spatial_enabled(
    c.mask&8 ? 1 : 0
  );

  e.mvp_v2_set_space_mode(
    c.sm??0
  );

  if(c.personal){
    e.mvp_v2_set_personal_enabled(1);
    e.mvp_v2_set_personal_bass(c.pb||0);
    e.mvp_v2_set_personal_presence(c.pp||0);
    e.mvp_v2_set_personal_brightness(c.pbr||0);
  }

  if(c.eq){
    e.mvp_v2_set_eq_enabled(1);
    e.mvp_v2_set_eq_band(
      c.eq[0],
      c.eq[1]
    );
  }

  if(c.master){
    e.mvp_v2_set_master_prep(
      1,
      1.2,
      22,
      -.7,
      1.0,
      -1.0,
      .2,
      1.04
    );
  }

  const s=sigs[c.sig];

  const max=
    e.mvp_v2_max_frames();

  const mem=e.memory;

  const li=new Float32Array(
    mem.buffer,
    e.mvp_v2_input_l(),
    max
  );

  const ri=new Float32Array(
    mem.buffer,
    e.mvp_v2_input_r(),
    max
  );

  const lo=new Float32Array(
    mem.buffer,
    e.mvp_v2_output_l(),
    max
  );

  const ro=new Float32Array(
    mem.buffer,
    e.mvp_v2_output_r(),
    max
  );

  let sum=0;
  let n=0;

  for(
    let off=0;
    off<s.L.length;
    off+=max
  ){
    const z=
      Math.min(
        max,
        s.L.length-off
      );

    li.fill(0);
    ri.fill(0);

    li.set(
      s.L.subarray(off,off+z)
    );

    ri.set(
      s.R.subarray(off,off+z)
    );

    if(e.mvp_v2_process(z)!==1){
      throw Error(
        'process case='+JSON.stringify(c)
      );
    }

    for(let j=0;j<z;j++){
      const a=lo[j];
      const b=ro[j];

      if(
        !Number.isFinite(a)||
        !Number.isFinite(b)
      ){
        throw Error(
          'nan case='+JSON.stringify(c)
        );
      }

      if(
        Math.abs(a)>1.0001||
        Math.abs(b)>1.0001
      ){
        throw Error(
          'clip case='+JSON.stringify(c)
        );
      }

      if(off+j>1024){
        sum+=a*a+b*b;
        n+=2;
      }
    }
  }

  const tp=
    e.mvp_v2_meter_true_peak_dbtp();

  const lim=
    e.mvp_v2_meter_limiter_gr_db();

  /*
   * IMPORTANT:
   * These are the original safety limits.
   * They are NOT loosened by V5.5.1.
   */
  if(c.m!==0&&tp>-.30){
    throw Error(
      'tp '+tp+
      ' case='+JSON.stringify(c)
    );
  }

  if(c.m!==0&&lim>9.5){
    throw Error(
      'lim '+lim+
      ' case='+JSON.stringify(c)
    );
  }

  return Math.sqrt(
    sum/Math.max(1,n)
  );
}

let count=0;

for(const p of [0,1,2])
for(const m of [1,2])
for(const i of [0,.5,1])
for(const sig of ['dynamic','hot','brick'])
for(let mask=0;mask<16;mask++){
  await run({
    p,
    m,
    i,
    sig,
    mask,
    sm:p===0?mask%3:0,
  });

  count++;
}

for(const p of [0,1,2])
for(const m of [1,2])
for(const sig of ['dynamic','hot','brick'])
for(const bc of [0,.5,1]){
  await run({
    p,
    m,
    i:.78,
    sig,
    mask:1,
    bc,
  });

  count++;
}

for(const p of [0,1,2])
for(const m of [1,2])
for(const axis of ['pb','pp','pbr'])
for(const v of [-1,-.5,.5,1]){
  await run({
    p,
    m,
    i:.78,
    sig:'dynamic',
    mask:0,
    personal:true,
    [axis]:v,
  });

  count++;
}

for(const p of [0,1,2])
for(
  const idx of
  Array.from(
    {length:31},
    (_,i)=>i
  )
)
for(const db of [-6,6]){
  await run({
    p,
    m:1,
    i:.72,
    sig:'dynamic',
    mask:0,
    eq:[idx,db],
  });

  count++;
}

for(const p of [0,1,2])
for(const m of [1,2])
for(const sig of ['dynamic','hot','brick']){
  await run({
    p,
    m,
    i:.72,
    sig,
    mask:0,
    master:true,
  });

  count++;
}

console.log(
  'V5.5.1 matrix: '+
  count+'/'+count+
  ' PASS'
);
`;

try {
  const player = read(FILES.player);

  /*
   * Do not reinstall the broken routing patch.
   * Verify that the good V5.5 route changes are already present.
   */
  if (
    !player.includes(
      'const playbackMode: MusicPlaybackMode = "mvp_hd";'
    )
  ) {
    throw new Error(
      "Current V5.5 profile routing fix is missing."
    );
  }

  if (
    !player.includes(
      'const targetPlayback: MusicPlaybackMode = "mvp_hd";'
    )
  ) {
    throw new Error(
      "Current V5.5 mode routing fix is missing."
    );
  }

  if (
    player.includes(
      'experienceMode === "pure" ? "device_direct" : "mvp_hd"'
    )
  ) {
    throw new Error(
      "Old Pure profile bypass routing is still present."
    );
  }

  if (
    player.includes(
      'mode === "pure" ? "device_direct" : "mvp_hd"'
    )
  ) {
    throw new Error(
      "Old Pure mode bypass routing is still present."
    );
  }

  /*
   * Fresh browser/CDN asset identity.
   */
  replaceOneOf(
    FILES.bridge,
    [
      'const ASSET_VERSION = "10.0.5-broadcast-v5-5-live-controls";',
      'const ASSET_VERSION = "10.0.4-broadcast-v5-4-live-audible-power";',
    ],
    `const ASSET_VERSION = "${NEW_ASSET_VERSION}";`,
    "Update Worklet/WASM asset version"
  );

  /*
   * V5.5.1 marker.
   */
  replaceOneOf(
    FILES.cpp,
    [
      "// MVP Trainer Pro Broadcast Engine V5.5 LIVE CONTROLS",
      "// MVP Trainer Pro Broadcast Engine V5.4 LIVE AUDIBLE POWER",
    ],
    NEW_CPP_MARKER,
    "Update DSP version marker"
  );

  /*
   * Restore the exact Power/Adaptive core that previously passed
   * the entire 1194-case matrix.
   *
   * This keeps the V5.5 routing/effect-output repair but removes
   * the over-aggressive V5.5 loudness drive that caused CI failure.
   */
  replaceCppFunction(
    FILES.cpp,
    "inline void applyModeCore(float &l,float &r)",
    SAFE_MODE_CORE,
    "Restore matrix-safe Power loudness core"
  );

  /*
   * Reapply the GOOD part of V5.5:
   * visible controls operate on the real signal, including Pure.
   */
  replaceCppFunction(
    FILES.cpp,
    "int mvp_v2_process(int frames)",
    LIVE_PROCESS,
    "Keep all visible controls on the real output"
  );

  /*
   * Improve the matrix diagnostics without changing one safety limit.
   */
  write(
    FILES.matrix,
    MATRIX_SOURCE
  );

  console.log(
    "✔ Rewrite exhaustive matrix with exact failing-case diagnostics"
  );

  /*
   * Update source-level static validation.
   */
  replaceOneOf(
    FILES.staticTest,
    [
      "assert.match(cpp,/V5\\.5 LIVE CONTROLS/);",
      "assert.match(cpp,/V5\\.4 LIVE AUDIBLE POWER/);",
    ],
    "assert.match(cpp,/V5\\.5\\.1 STABLE LIVE CONTROLS/);",
    "Update DSP static assertion"
  );

  replaceOneOf(
    FILES.staticTest,
    [
      "assert.match(bridge,/10\\.0\\.5-broadcast-v5-5-live-controls/);",
      "assert.match(bridge,/10\\.0\\.4-broadcast-v5-4-live-audible-power/);",
    ],
    "assert.match(bridge,/10\\.0\\.6-broadcast-v5-5-1-stable-live-controls/);",
    "Update asset-version static assertion"
  );

  replaceOneOf(
    FILES.staticTest,
    [
      "console.log('V5.5 production static wiring: PASS');",
      "console.log('V5.4 production static wiring: PASS');",
    ],
    "console.log('V5.5.1 production static wiring: PASS');",
    "Update static validation label"
  );

  /*
   * Final source verification.
   */
  const cpp = read(FILES.cpp);
  const bridge = read(FILES.bridge);
  const matrix = read(FILES.matrix);

  if (
    !cpp.includes(
      "3.0f+2.35f*i"
    )
  ) {
    throw new Error(
      "Safe Power makeup core was not installed."
    );
  }

  if (
    cpp.includes(
      "4.10f+2.65f*i"
    ) ||
    cpp.includes(
      "4.00f+2.50f*i"
    )
  ) {
    throw new Error(
      "Over-aggressive V5.5 Power makeup is still present."
    );
  }

  if (
    cpp.includes(
      "float sl=l,sr=r"
    )
  ) {
    throw new Error(
      "Old Pure discarded-effect path is still present."
    );
  }

  if (
    !cpp.includes(
      "gImpactFast-gImpactSlow*1.18f"
    ) ||
    !cpp.includes(
      "gImpactSlow+.050f"
    )
  ) {
    throw new Error(
      "V5.4 Impact distortion protection is missing."
    );
  }

  if (
    !bridge.includes(
      NEW_ASSET_VERSION
    )
  ) {
    throw new Error(
      "New Worklet/WASM asset version was not installed."
    );
  }

  if (
    !matrix.includes(
      "lim>9.5"
    )
  ) {
    throw new Error(
      "Matrix limiter safety limit was changed or lost."
    );
  }

  if (
    !matrix.includes(
      "tp>-.30"
    )
  ) {
    throw new Error(
      "Matrix true-peak safety limit was changed or lost."
    );
  }

  console.log("");
  console.log(
    "Running production static validation..."
  );
  console.log("");

  runNodeScript(
    FILES.staticTest
  );

  console.log("");
  console.log(
    "Checking matrix script syntax..."
  );
  console.log("");

  const matrixCheck = spawnSync(
    process.execPath,
    [
      "--check",
      absolute(FILES.matrix),
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
    }
  );

  if (
    matrixCheck.error ||
    matrixCheck.status !== 0
  ) {
    throw new Error(
      "Matrix script syntax validation failed."
    );
  }

  /*
   * This now works properly on Windows instead of directly spawning
   * npm.cmd under the Node version on your machine.
   */
  runAppBuild();

  console.log("");
  console.log("============================================================");
  console.log(" MVP SOUND V5.5.1 INSTALL COMPLETE");
  console.log("============================================================");
  console.log("");
  console.log("✔ V5.5 one-WASM-route fix preserved");
  console.log("✔ Pure explicit effects remain live");
  console.log("✔ Headphones remain on WASM");
  console.log("✔ Bluetooth remains on WASM");
  console.log("✔ Bass / Impact / Clarity / Stage remain live");
  console.log("✔ Personal Sound remains live");
  console.log("✔ 31-band EQ remains live");
  console.log("✔ Proven matrix-safe Power core restored");
  console.log("✔ 9.5 dB limiter matrix guard NOT weakened");
  console.log("✔ -0.30 dBTP matrix guard NOT weakened");
  console.log("✔ Impact distortion repair preserved");
  console.log("✔ Fresh Worklet/WASM cache version installed");
  console.log("✔ Windows React build launcher repaired");
  console.log("✔ Matrix now reports the exact failing case if anything fails");
  console.log("");
  console.log("NO Git commands were run.");
  console.log("NO commit was made.");
  console.log("NO push was made.");
  console.log("");
  console.log("NEXT:");
  console.log("  GitHub Desktop");
  console.log("  Review changed files");
  console.log("  Commit to main");
  console.log("  Push origin");
  console.log("");
  console.log(
    "GitHub Actions will compile the new C++ into WASM and run the full 1194-case matrix."
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

  restore();

  console.error(
    error instanceof Error
      ? error.message
      : String(error)
  );

  console.error("");
  console.error(
    "Original project files were restored."
  );
  console.error(`Backup: ${backupDir}`);
  console.error("");

  process.exit(1);
}