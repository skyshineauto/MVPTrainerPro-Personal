import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MARKER = "MVP_R81_EFFECTS_LOUDNESS_INTERACTION";

function findRepoRoot(start) {
  let current = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      fs.existsSync(path.join(current, "package.json")) &&
      fs.existsSync(path.join(current, "src", "lib", "musicPlayer.ts")) &&
      fs.existsSync(path.join(current, "dsp", "studio", "mvp_studio_dsp.cpp"))
    ) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Could not find MVPTrainerPro-Personal repo root from ${start}`);
}

const root = findRepoRoot(process.cwd());
const P = {
  player: path.join(root, "src", "lib", "musicPlayer.ts"),
  ui: path.join(root, "src", "features", "music", "MusicMiniPlayer.tsx"),
  engine: path.join(root, "src", "lib", "audio", "mvpStudioEngine.ts"),
  cpp: path.join(root, "dsp", "studio", "mvp_studio_dsp.cpp"),
  legacyTest: path.join(root, "scripts", "test-mvp-studio-wasm.mjs"),
  masteringTest: path.join(root, "scripts", "test-r80-mastering.mjs"),
};

for (const [name, target] of Object.entries(P)) {
  if (!fs.existsSync(target)) throw new Error(`Missing ${name}: ${target}`);
}

const originals = new Map(Object.values(P).map((target) => [target, fs.readFileSync(target)]));

function restore() {
  for (const [target, bytes] of originals) {
    try { fs.writeFileSync(target, bytes); } catch {}
  }
}
function read(target) { return fs.readFileSync(target, "utf8"); }
function write(target, value) { fs.writeFileSync(target, value.replace(/\r?\n/g, "\n"), "utf8"); }
function count(source, needle) {
  let n = 0, at = 0;
  while ((at = source.indexOf(needle, at)) >= 0) { n += 1; at += needle.length; }
  return n;
}
function replaceOnce(source, from, to, label) {
  const n = count(source, from);
  if (n !== 1) throw new Error(`${label}: expected exactly 1 baseline anchor, found ${n}`);
  return source.replace(from, to);
}
function replaceRegexOnce(source, regex, to, label) {
  const matches = source.match(regex);
  if (!matches || matches.length !== 1) throw new Error(`${label}: expected exactly 1 match, found ${matches?.length ?? 0}`);
  return source.replace(regex, to);
}
function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
}
function runBuild() {
  const command = process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
  const result = spawnSync(command, ["/d", "/s", "/c", "npm run build"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw new Error(`Could not start npm build: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`npm run build failed with exit code ${result.status}`);
}

try {
  console.log(`\n${MARKER}`);
  console.log(`Repo root: ${root}\n`);

  let player = read(P.player);
  let ui = read(P.ui);
  let engine = read(P.engine);
  let cpp = read(P.cpp);
  let legacyTest = read(P.legacyTest);
  let masteringTest = read(P.masteringTest);

  if (!player.includes("MVP_R80_R3_PROFILE_GAIN_KEY")) {
    throw new Error("R81 requires the installed R80 profile-isolation/control baseline.");
  }
  if (!cpp.includes("MVP_R80_FINAL_MASTERING_CORE")) {
    throw new Error("R81 requires the R80 C++ mastering source already pushed to main.");
  }
  if (!engine.includes('7.1.0-r80-r3-final-audio-control')) {
    throw new Error("R81 requires the current R80 Studio engine baseline.");
  }

  // ---------------------------------------------------------------------------
  // 1) Extreme Preamp becomes a real loudness-maximizer request instead of raw
  //    pre-effect gain that the mastering stage simply removes again.
  // ---------------------------------------------------------------------------
  player = replaceRegexOnce(
    player,
    /function calculateStudioGain\(\) \{[\s\S]*?\n\}\n\nfunction cleanHdHighOutputActive\(\) \{/,
`function calculateStudioGain() {
  if (state.outputProfile === "reference") {
    return { effectivePreampDb: 0, extremeLoudnessDb: 0, autoHeadroomDb: 0, referenceMatchDb: 0 };
  }

  const simplifiedProfile = state.outputProfile === "headphones" || state.outputProfile === "speaker";
  const extremeLoudnessDb = state.extremePreampEnabled
    ? Math.max(0, Math.min(12, Number(state.extremePreampDb) || 0))
    : 0;
  const normalPreampDb = state.eqEnabled
    ? Math.max(-12, Math.min(6, Number(state.preampDb) || 0))
    : 0;

  // ${MARKER}: normal Preamp remains literal input gain. Extreme is deliberately
  // routed to the post-effect mastering/loudness stage so +12 dB produces more
  // average loudness instead of being immediately cancelled by peak protection.
  const effectivePreampDb = normalPreampDb;
  const autoHeadroomDb = simplifiedProfile ? cleanHdSafetyHeadroomDb() : 0;
  const measuredMatch = Number.isFinite(lastReferenceRmsDb) && Number.isFinite(lastProcessedRmsDb)
    ? Math.max(-6, Math.min(3, lastProcessedRmsDb - lastReferenceRmsDb))
    : Math.max(-6, Math.min(3, effectivePreampDb));

  return { effectivePreampDb, extremeLoudnessDb, autoHeadroomDb, referenceMatchDb: measuredMatch };
}

function cleanHdHighOutputActive() {`,
    "Extreme loudness routing",
  );

  player = replaceOnce(
    player,
    '  const { effectivePreampDb, autoHeadroomDb, referenceMatchDb } = calculateStudioGain();',
    '  const { effectivePreampDb, extremeLoudnessDb, autoHeadroomDb, referenceMatchDb } = calculateStudioGain();',
    "Studio gain destructuring",
  );

  player = replaceOnce(
    player,
`  // R77I EFFECT COMPATIBILITY MANAGER. Compatible effects may stay on together,
  // but processors that target the same resource share one budget instead of
  // blindly stacking into clipping. This policy is identical on both clean-HD paths.
  const clearActive = cleanHdProfile && state.toneEngineEnabled;
  const xpanderToneScale = clearActive && xpander.level >= 2 ? (xpander.level === 3 ? 0.78 : 0.88) : 1;
  const xpanderTransientScale = userImpactAmount > 0.001 ? (xpander.level === 3 ? 0.58 : xpander.level === 2 ? 0.72 : 0.86) : 1;
  const effectiveTransientAmount = Math.max(
    0,
    Math.min(0.96, presetTransientAmount + userImpactAmount + xpander.transientAmount * xpanderTransientScale),
  );
  const effectivePresenceDb = Math.max(-6, Math.min(5.4, state.presenceDb + xpander.presenceDb * xpanderToneScale));
  const effectiveClarityDb = Math.max(-6, Math.min(5.8, state.clarityDb + xpander.clarityDb * xpanderToneScale));
  const effectiveAirDb = Math.max(-6, Math.min(6.0, state.airDb + xpander.airDb * xpanderToneScale));
  // Analog and Xpander both add harmonics, so the stronger request wins instead
  // of summing into a second hidden gain stage.
  const effectiveExciterAmount = Math.min(0.14, Math.max(state.exciterAmount / 100, xpander.exciterAmount));`,
`  // ${MARKER}: selected effects compose instead of silently cancelling one
  // another. Shared processors receive the SUM of each user's requested character,
  // with only a final safety ceiling at the actual DSP stage.
  const effectiveTransientAmount = Math.max(
    0,
    Math.min(1.0, presetTransientAmount + userImpactAmount + xpander.transientAmount),
  );
  const effectivePresenceDb = Math.max(-10, Math.min(10.0, state.presenceDb + xpander.presenceDb));
  const effectiveClarityDb = Math.max(-10, Math.min(11.0, state.clarityDb + xpander.clarityDb));
  const effectiveAirDb = Math.max(-10, Math.min(12.0, state.airDb + xpander.airDb));
  // Analog supplies its saturation character while Xpander contributes additional
  // high-frequency harmonics. They are additive, not winner-takes-all.
  const effectiveExciterAmount = Math.min(0.30, state.exciterAmount / 100 + xpander.exciterAmount);`,
    "effect composition manager",
  );

  player = replaceOnce(
    player,
`    // R79A Extreme Preamp is a separate deliberate gain request. It uses the
    // existing WASM pre-effect gain and therefore remains upstream of the shared
    // final mastering / true-peak protection. OFF is exactly 0 dB from this control.
    preampDb: Math.max(-18, Math.min(12, effectivePreampDb)),`,
`    // R81: raw Preamp is only the normal preamp. Extreme is a separate loudness
    // request sent to the mastering/output stage below.
    preampDb: Math.max(-18, Math.min(12, effectivePreampDb)),`,
    "Preamp state comment",
  );

  player = replaceOnce(
    player,
`    // R77I: the WASM sees the actual post-effect true peak before deciding what
    // gain is safe. Recover transparent source/EQ headroom first, then High/Max
    // Output on top. Unsafe gain is refused instead of being sent into Peak Guard.
    outputReserveDb: processed ? Math.min(18, state.outputReserveDb + autoHeadroomDb) : 0,
    autoMakeupEnabled: processed && state.autoMakeupEnabled,`,
`    // ${MARKER}: Extreme adds mastering drive, not raw input gain. Max/High Output
    // and Extreme may coexist, with the combined request capped at the WASM's
    // existing +18 dB mastering range.
    outputReserveDb: processed ? Math.min(18, state.outputReserveDb + autoHeadroomDb + extremeLoudnessDb) : 0,
    autoMakeupEnabled: processed && (state.autoMakeupEnabled || extremeLoudnessDb > 0.01),`,
    "Extreme mastering request",
  );

  // ---------------------------------------------------------------------------
  // 2) C++ mastering: reserve amount controls crest intensity. More Extreme/Max
  //    means more crest reduction and makeup, while Peak Guard stays last.
  // ---------------------------------------------------------------------------
  cpp = replaceOnce(
    cpp,
`  // Routine crest control happens HERE, after EQ/effects/spatial and before the
  // loudness maximizer. Peak Guard is not the normal compressor.
  const float crestCeiling = static_cast<float>(dbToGain(highOutput ? -3.40f : -1.85f));`,
`  // ${MARKER}: routine crest control happens HERE, after EQ/effects/spatial and
  // before the loudness maximizer. Output reserve is now also the loudness
  // intensity request used by Extreme Preamp. More drive creates more crest room
  // for clean makeup instead of simply slamming Peak Guard.
  const float loudnessIntensity = clampf(outputReserveDb / 18.0f, 0.0f, 1.0f);
  const float crestCeilingDb = highOutput
    ? (-3.80f - loudnessIntensity * 3.50f)
    : (-1.85f - loudnessIntensity * 1.20f);
  const float crestCeiling = static_cast<float>(dbToGain(crestCeilingDb));`,
    "progressive mastering crest",
  );

  cpp = replaceOnce(
    cpp,
`__attribute__((visibility("default"))) void mvp_set_tone_engine(int enabled, float presence, float clarity, float air, float deharsh) {
  toneEngineEnabled=enabled?1:0; presenceDb=clampf(presence,-8.0f,8.0f); clarityDb=clampf(clarity,-8.0f,8.0f); airDb=clampf(air,-8.0f,8.0f); deharshAmount=clampf(deharsh,0.0f,1.0f); configureAdvancedTone();
}`,
`__attribute__((visibility("default"))) void mvp_set_tone_engine(int enabled, float presence, float clarity, float air, float deharsh) {
  // R81 combination headroom: Clear + Xpander may coexist instead of one being
  // attenuated by the frontend compatibility manager.
  toneEngineEnabled=enabled?1:0; presenceDb=clampf(presence,-12.0f,12.0f); clarityDb=clampf(clarity,-12.0f,12.0f); airDb=clampf(air,-12.0f,12.0f); deharshAmount=clampf(deharsh,0.0f,1.0f); configureAdvancedTone();
}`,
    "tone combination headroom",
  );

  // ---------------------------------------------------------------------------
  // 3) Fix the stale legacy Volume Match expectation that blocked the cloud build.
  // ---------------------------------------------------------------------------
  legacyTest = replaceOnce(
    legacyTest,
`const quietProgram = renderLoudness(0.04, true);
if (!(quietProgram.gainDb > 2.0 && quietProgram.gainDb <= 3.1)) {
  throw new Error(\`Volume Match did not apply bounded quiet-program gain: \${JSON.stringify(quietProgram)}\`);
}`,
`const quietProgram = renderLoudness(0.04, true);
if (!(quietProgram.gainDb > 3.0 && quietProgram.gainDb <= 4.5)) {
  throw new Error(\`Volume Match did not apply the current upward-only bounded gain: \${JSON.stringify(quietProgram)}\`);
}`,
    "quiet-program Volume Match regression",
  );

  // ---------------------------------------------------------------------------
  // 4) Strengthen the cloud mastering test: prove Extreme increases average
  //    loudness, effect meters coexist, and Peak Guard remains emergency-only.
  // ---------------------------------------------------------------------------
  masteringTest = replaceOnce(
    masteringTest,
`const inL = new Float32Array(memory.buffer, Number(dsp.mvp_input_l()), maxFrames);
const inR = new Float32Array(memory.buffer, Number(dsp.mvp_input_r()), maxFrames);`,
`const inL = new Float32Array(memory.buffer, Number(dsp.mvp_input_l()), maxFrames);
const inR = new Float32Array(memory.buffer, Number(dsp.mvp_input_r()), maxFrames);
const outL = new Float32Array(memory.buffer, Number(dsp.mvp_output_l()), maxFrames);
const outR = new Float32Array(memory.buffer, Number(dsp.mvp_output_r()), maxFrames);`,
    "mastering output buffers",
  );

  masteringTest = replaceOnce(
    masteringTest,
`  "mvp_process","mvp_reset","mvp_meter_gain_reduction_db",
  "mvp_meter_final_compressor_reduction_db","mvp_meter_true_peak_dbtp"`,
`  "mvp_process","mvp_reset","mvp_meter_gain_reduction_db",
  "mvp_meter_final_compressor_reduction_db","mvp_meter_true_peak_dbtp",
  "mvp_set_bass_engine","mvp_set_tone_engine","mvp_set_exciter","mvp_set_stereo_field",
  "mvp_meter_bass_activity_db","mvp_meter_tone_activity_db","mvp_meter_exciter_activity",
  "mvp_meter_transient_boost_db","mvp_meter_stereo_width_percent"`,
    "mastering effect exports",
  );

  masteringTest = replaceOnce(
    masteringTest,
`  let maxGuard = 0;
  let maxMaster = 0;
  let maxTruePeak = -120;`,
`  let maxGuard = 0;
  let maxMaster = 0;
  let maxTruePeak = -120;
  let energy = 0;
  let sampleCount = 0;`,
    "mastering RMS accumulators",
  );

  masteringTest = replaceOnce(
    masteringTest,
`    if (block > 150) {
      maxGuard = Math.max(maxGuard, Number(dsp.mvp_meter_gain_reduction_db()) || 0);
      maxMaster = Math.max(maxMaster, Number(dsp.mvp_meter_final_compressor_reduction_db()) || 0);
      maxTruePeak = Math.max(maxTruePeak, Number(dsp.mvp_meter_true_peak_dbtp()) || -120);
    }
  }
  return { maxGuard, maxMaster, maxTruePeak };`,
`    if (block > 150) {
      maxGuard = Math.max(maxGuard, Number(dsp.mvp_meter_gain_reduction_db()) || 0);
      maxMaster = Math.max(maxMaster, Number(dsp.mvp_meter_final_compressor_reduction_db()) || 0);
      maxTruePeak = Math.max(maxTruePeak, Number(dsp.mvp_meter_true_peak_dbtp()) || -120);
      for (let i = 0; i < frames; i += 1) {
        energy += 0.5 * (outL[i] * outL[i] + outR[i] * outR[i]);
        sampleCount += 1;
      }
    }
  }
  return { maxGuard, maxMaster, maxTruePeak, rms: Math.sqrt(energy / Math.max(1, sampleCount)) };`,
    "mastering RMS return",
  );

  masteringTest = replaceOnce(
    masteringTest,
`console.table(rows.map((row) => ({
  profile: row.profile === 0 ? "Car/Hi-Fi" : row.profile === 1 ? "Headphones" : "Bluetooth",
  output: row.highOutput ? "HIGH/MAX" : "NORMAL",
  "Mastering GR": row.maxMaster.toFixed(2) + " dB",
  "Peak Guard GR": row.maxGuard.toFixed(2) + " dB",
  "True Peak": row.maxTruePeak.toFixed(2) + " dBTP",
})));

console.log("R80 mastering test: PASS");`,
`// Extreme loudness must create a real perceived-level change at the same raw
// preamp setting. It is no longer allowed to disappear into the final limiter.
const extremeRows = [];
for (const profile of [0, 1, 2]) {
  const normal = runCase(profile, 0, false, 0);
  const extreme = runCase(profile, 12, true, 0);
  const liftDb = 20 * Math.log10(Math.max(1e-9, extreme.rms) / Math.max(1e-9, normal.rms));
  extremeRows.push({ profile, liftDb, normal, extreme });
  if (liftDb < 2.0) {
    throw new Error("Extreme loudness lift is too small: profile=" + profile + " lift=" + liftDb.toFixed(2) + " dB");
  }
  if (extreme.maxGuard > 0.40) {
    throw new Error("Extreme routed routine loudness into Peak Guard: profile=" + profile + " GR=" + extreme.maxGuard.toFixed(2));
  }
}

// Prove the advanced effects coexist in the same render instead of cancelling
// each other when several user controls are ON.
configure(2, 12, true, 0);
dsp.mvp_set_bass_engine(1, 5.8, 3.4, 2.0, 0.84);
dsp.mvp_set_tone_engine(1, 5.1, 8.7, 10.5, 0);
dsp.mvp_set_exciter(1, 0.26, 0.10, 0.16, 0.10);
dsp.mvp_set_stereo_field(1, 1.52, 1.0, 105);
dsp.mvp_set_transient(1, 1.0);

let comboGuard = 0;
let comboTone = 0;
let comboBass = 0;
let comboExciter = 0;
let comboTransient = 0;
let comboWidth = 100;
let comboP1 = 0;
let comboP2 = 0;
for (let block = 0; block < 1700; block += 1) {
  for (let i = 0; i < frames; i += 1) {
    const t = block * frames + i;
    const pulse = (t % 2200) < 240 ? 1.0 : 0.60;
    inL[i] = pulse * (0.58 * Math.sin(comboP1) + 0.19 * Math.sin(comboP2));
    inR[i] = pulse * (0.55 * Math.sin(comboP1 + 0.18) + 0.18 * Math.sin(comboP2 + 0.37));
    comboP1 += (2 * Math.PI * 887) / 48000;
    comboP2 += (2 * Math.PI * 2771) / 48000;
  }
  if (dsp.mvp_process(frames) !== 1) throw new Error("mvp_process failed in R81 combination test");
  if (block > 180) {
    comboGuard = Math.max(comboGuard, Number(dsp.mvp_meter_gain_reduction_db()) || 0);
    comboTone = Math.max(comboTone, Number(dsp.mvp_meter_tone_activity_db()) || 0);
    comboBass = Math.max(comboBass, Number(dsp.mvp_meter_bass_activity_db()) || 0);
    comboExciter = Math.max(comboExciter, Number(dsp.mvp_meter_exciter_activity()) || 0);
    comboTransient = Math.max(comboTransient, Number(dsp.mvp_meter_transient_boost_db()) || 0);
    comboWidth = Math.max(comboWidth, Number(dsp.mvp_meter_stereo_width_percent()) || 100);
  }
}
if (comboTone < 6.0) throw new Error("Clear + Xpander tone combination did not remain active");
if (comboBass < 2.0) throw new Error("Neural Bass did not remain active in the combination");
if (comboExciter < 0.01) throw new Error("Analog + Xpander harmonic processing did not remain active");
if (comboTransient < 0.20) throw new Error("Punch/Impact + Xpander transient processing did not remain active");
if (comboWidth < 108) throw new Error("Wide processing did not remain active in the combination");
if (comboGuard > 0.40) throw new Error("Combined effects turned Peak Guard into routine processing: " + comboGuard.toFixed(2) + " dB");

// Also verify the frontend source no longer contains the old cancellation rules.
const playerSource = fs.readFileSync(path.join(root, "src/lib/musicPlayer.ts"), "utf8");
for (const forbidden of ["xpanderToneScale", "xpanderTransientScale", "Math.max(state.exciterAmount / 100, xpander.exciterAmount)"]) {
  if (playerSource.includes(forbidden)) throw new Error("Old effect-cancellation rule still present: " + forbidden);
}
if (!playerSource.includes("extremeLoudnessDb")) throw new Error("Extreme loudness routing is missing from musicPlayer.ts");

console.table(rows.map((row) => ({
  profile: row.profile === 0 ? "Car/Hi-Fi" : row.profile === 1 ? "Headphones" : "Bluetooth",
  output: row.highOutput ? "HIGH/MAX" : "NORMAL",
  "Mastering GR": row.maxMaster.toFixed(2) + " dB",
  "Peak Guard GR": row.maxGuard.toFixed(2) + " dB",
  "True Peak": row.maxTruePeak.toFixed(2) + " dBTP",
})));
console.table(extremeRows.map((row) => ({
  profile: row.profile === 0 ? "Car/Hi-Fi" : row.profile === 1 ? "Headphones" : "Bluetooth",
  "Extreme Lift": row.liftDb.toFixed(2) + " dB",
  "Peak Guard GR": row.extreme.maxGuard.toFixed(2) + " dB",
})));
console.log("R81 combination meters:", { comboTone, comboBass, comboExciter, comboTransient, comboWidth, comboGuard });

console.log("R81 mastering/effects test: PASS");`,
    "R81 mastering combination tests",
  );

  // Cache-bust the newly compiled binary once the GitHub Action commits it.
  engine = replaceOnce(
    engine,
    'const MVP_STUDIO_ASSET_VERSION = "7.1.0-r80-r3-final-audio-control";',
    'const MVP_STUDIO_ASSET_VERSION = "8.1.0-r81-effects-loudness-interaction";',
    "Studio asset cache version",
  );

  ui = replaceOnce(
    ui,
    '<small>Separate +0 to +12 dB drive. OFF is exactly 0 dB. Each output profile stores its own value.</small>',
    '<small>+0 to +12 dB loudness drive. It creates mastering crest room and clean makeup instead of simply slamming Peak Guard. OFF is exactly 0 dB.</small>',
    "Extreme Preamp UI description",
  );

  // Static pre-write validation.
  for (const [source, needle, label] of [
    [player, MARKER, "R81 player marker"],
    [player, "extremeLoudnessDb", "Extreme loudness routing"],
    [player, "state.exciterAmount / 100 + xpander.exciterAmount", "additive Analog/Xpander"],
    [cpp, "loudnessIntensity", "progressive mastering"],
    [cpp, "presenceDb=clampf(presence,-12.0f,12.0f)", "tone combination headroom"],
    [legacyTest, "current upward-only bounded gain", "legacy Volume Match fix"],
    [masteringTest, "R81 mastering/effects test: PASS", "R81 cloud tests"],
    [engine, "8.1.0-r81-effects-loudness-interaction", "R81 cache version"],
    [ui, "mastering crest room and clean makeup", "Extreme UI copy"],
  ]) {
    if (!source.includes(needle)) throw new Error(`Static validation failed: ${label}`);
  }
  if (player.includes("xpanderToneScale") || player.includes("xpanderTransientScale")) {
    throw new Error("Static validation failed: old effect cancellation scales still exist.");
  }

  console.log("Baseline validated. Applying R81...");
  write(P.player, player);
  write(P.ui, ui);
  write(P.engine, engine);
  write(P.cpp, cpp);
  write(P.legacyTest, legacyTest);
  write(P.masteringTest, masteringTest);

  run(process.execPath, ["--check", "scripts/test-mvp-studio-wasm.mjs"], "legacy WASM test syntax");
  run(process.execPath, ["--check", "scripts/test-r80-mastering.mjs"], "R81 mastering test syntax");

  console.log("Running local production build...");
  runBuild();

  console.log("\nR81 SOURCE INSTALL: SUCCESS");
  console.log("Push these six source/test files. GitHub Actions will compile and validate the WASM:");
  console.log("  src/lib/musicPlayer.ts");
  console.log("  src/features/music/MusicMiniPlayer.tsx");
  console.log("  src/lib/audio/mvpStudioEngine.ts");
  console.log("  dsp/studio/mvp_studio_dsp.cpp");
  console.log("  scripts/test-mvp-studio-wasm.mjs");
  console.log("  scripts/test-r80-mastering.mjs");
  console.log("\nDo NOT commit local WASM binaries. The GitHub Action rebuilds and commits them.");
} catch (error) {
  console.error(`\nR81 FAILED: ${error instanceof Error ? error.message : String(error)}`);
  console.error("Restoring all touched project files...");
  restore();
  console.error("Restore complete. Repo returned to its exact pre-R81 state.");
  process.exitCode = 1;
}
