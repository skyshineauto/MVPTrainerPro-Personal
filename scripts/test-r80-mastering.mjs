import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const wasmPath = path.join(root, "public/audio/mvpStudioEngine.wasm");
const bytes = fs.readFileSync(wasmPath);

let memory = null;
const imports = {
  env: {
    sin: Math.sin,
    cos: Math.cos,
    exp: Math.exp,
    exp2: (value) => 2 ** value,
    pow: Math.pow,
    log10: Math.log10,
    memset(pointer, value, length) {
      new Uint8Array(memory.buffer).fill(value & 0xff, pointer, pointer + length);
      return pointer;
    },
    memcpy(destination, source, length) {
      new Uint8Array(memory.buffer).copyWithin(destination, source, source + length);
      return destination;
    },
  },
};

const { instance } = await WebAssembly.instantiate(bytes, imports);
memory = instance.exports.memory;
const dsp = instance.exports;

for (const name of [
  "mvp_init","mvp_max_frames","mvp_input_l","mvp_input_r","mvp_output_l","mvp_output_r",
  "mvp_set_bypass","mvp_set_eq_enabled","mvp_set_eq_band","mvp_set_preamp_db",
  "mvp_set_headroom_db","mvp_set_transient","mvp_set_multiband","mvp_set_dynamic_eq",
  "mvp_set_output_correction","mvp_set_stereo_integrity","mvp_set_loudness",
  "mvp_set_limiter","mvp_set_output_profile","mvp_set_headphone","mvp_set_output_gain",
  "mvp_process","mvp_reset","mvp_meter_gain_reduction_db",
  "mvp_meter_final_compressor_reduction_db","mvp_meter_true_peak_dbtp",
  "mvp_set_bass_engine","mvp_set_tone_engine","mvp_set_exciter","mvp_set_stereo_field",
  "mvp_meter_bass_activity_db","mvp_meter_tone_activity_db","mvp_meter_exciter_activity",
  "mvp_meter_transient_boost_db","mvp_meter_stereo_width_percent"
]) {
  if (typeof dsp[name] !== "function") throw new Error("Missing WASM export: " + name);
}

if (dsp.mvp_init(48000) !== 1) throw new Error("mvp_init failed");
const frames = 128;
const maxFrames = Number(dsp.mvp_max_frames());
const inL = new Float32Array(memory.buffer, Number(dsp.mvp_input_l()), maxFrames);
const inR = new Float32Array(memory.buffer, Number(dsp.mvp_input_r()), maxFrames);
const outL = new Float32Array(memory.buffer, Number(dsp.mvp_output_l()), maxFrames);
const outR = new Float32Array(memory.buffer, Number(dsp.mvp_output_r()), maxFrames);

function configure(profile, reserveDb, autoMakeup, preampDb) {
  dsp.mvp_reset();
  dsp.mvp_set_bypass(0);
  dsp.mvp_set_eq_enabled(0);
  for (let band = 0; band < 31; band += 1) dsp.mvp_set_eq_band(band, 0);
  dsp.mvp_set_preamp_db(preampDb);
  dsp.mvp_set_headroom_db(0);
  dsp.mvp_set_transient(0, 0);
  dsp.mvp_set_multiband(0, 1);
  dsp.mvp_set_dynamic_eq(0, 0.5);
  dsp.mvp_set_output_correction(0, 1);
  dsp.mvp_set_stereo_integrity(0, 1);
  dsp.mvp_set_loudness(0, -11);
  dsp.mvp_set_limiter(1, -0.10);
  dsp.mvp_set_output_profile(profile);
  dsp.mvp_set_headphone(0, 0, 0, 0, 0.5, 0);
  dsp.mvp_set_output_gain(autoMakeup ? 1 : 0, reserveDb);
}

function runCase(profile, reserveDb, autoMakeup, preampDb) {
  configure(profile, reserveDb, autoMakeup, preampDb);
  let p1 = 0, p2 = 0;
  let maxGuard = 0;
  let maxMaster = 0;
  let maxTruePeak = -120;
  let energy = 0;
  let sampleCount = 0;

  for (let block = 0; block < 1900; block += 1) {
    for (let i = 0; i < frames; i += 1) {
      const t = block * frames + i;
      const pulse = (t % 2400) < 300 ? 1.0 : 0.68;
      inL[i] = pulse * (0.70 * Math.sin(p1) + 0.20 * Math.sin(p2));
      inR[i] = pulse * (0.67 * Math.sin(p1 + 0.13) + 0.19 * Math.sin(p2 + 0.29));
      p1 += (2 * Math.PI * 997) / 48000;
      p2 += (2 * Math.PI * 2317) / 48000;
    }
    if (dsp.mvp_process(frames) !== 1) throw new Error("mvp_process failed");
    if (block > 150) {
      maxGuard = Math.max(maxGuard, Number(dsp.mvp_meter_gain_reduction_db()) || 0);
      maxMaster = Math.max(maxMaster, Number(dsp.mvp_meter_final_compressor_reduction_db()) || 0);
      maxTruePeak = Math.max(maxTruePeak, Number(dsp.mvp_meter_true_peak_dbtp()) || -120);
      for (let i = 0; i < frames; i += 1) {
        energy += 0.5 * (outL[i] * outL[i] + outR[i] * outR[i]);
        sampleCount += 1;
      }
    }
  }
  return { maxGuard, maxMaster, maxTruePeak, rms: Math.sqrt(energy / Math.max(1, sampleCount)) };
}

// MVP_R83_R3_BIG_GUYS_CLEAN_MASTERING: NORMAL / LOUD / MAX must match the simplified product.
function runBypassCase(profile) {
  configure(profile, 0, false, 0);
  dsp.mvp_set_bypass(1);
  let p1 = 0, p2 = 0, energy = 0, sampleCount = 0;
  for (let block = 0; block < 900; block += 1) {
    for (let i = 0; i < frames; i += 1) {
      const t = block * frames + i;
      const pulse = (t % 2400) < 300 ? 1.0 : 0.68;
      inL[i] = pulse * (0.70 * Math.sin(p1) + 0.20 * Math.sin(p2));
      inR[i] = pulse * (0.67 * Math.sin(p1 + 0.13) + 0.19 * Math.sin(p2 + 0.29));
      p1 += (2 * Math.PI * 997) / 48000;
      p2 += (2 * Math.PI * 2317) / 48000;
    }
    if (dsp.mvp_process(frames) !== 1) throw new Error("mvp_process failed in bypass case");
    if (block > 100) {
      for (let i = 0; i < frames; i += 1) {
        energy += 0.5 * (outL[i] * outL[i] + outR[i] * outR[i]);
        sampleCount += 1;
      }
    }
  }
  return Math.sqrt(energy / Math.max(1, sampleCount));
}

const rows = [];
for (const profile of [0, 1, 2]) {
  const bypassRms = runBypassCase(profile);
  const normal = runCase(profile, 0, false, 0);
  const loud = runCase(profile, 9, true, 0);
  const maxed = runCase(profile, 18, true, 0);

  rows.push({ profile, mode: "NORMAL", ...normal });
  rows.push({ profile, mode: "LOUD", ...loud });
  rows.push({ profile, mode: "MAX", ...maxed });

  const normalVsDirectDb = 20 * Math.log10(Math.max(1e-9, normal.rms) / Math.max(1e-9, bypassRms));
  const loudLiftDb = 20 * Math.log10(Math.max(1e-9, loud.rms) / Math.max(1e-9, normal.rms));
  const maxLiftDb = 20 * Math.log10(Math.max(1e-9, maxed.rms) / Math.max(1e-9, normal.rms));
  const maxOverLoudDb = 20 * Math.log10(Math.max(1e-9, maxed.rms) / Math.max(1e-9, loud.rms));

  if (Math.abs(normalVsDirectDb) > 0.18) {
    throw new Error("NORMAL is not transparent to Device Direct: profile=" + profile +
      " delta=" + normalVsDirectDb.toFixed(2) + " dB");
  }
  if (normal.maxMaster > 0.10) {
    throw new Error("NORMAL has hidden mastering compression: profile=" + profile +
      " GR=" + normal.maxMaster.toFixed(2) + " dB");
  }
  if (loud.maxMaster > 0.10) {
    throw new Error("LOUD is being softened by the crest compressor: profile=" + profile +
      " GR=" + loud.maxMaster.toFixed(2) + " dB");
  }
  if (maxed.maxMaster < 0.25 || maxed.maxMaster > 3.7) {
    throw new Error("MAX crest control is outside the clean range: profile=" + profile +
      " GR=" + maxed.maxMaster.toFixed(2) + " dB");
  }
  if (loudLiftDb < 1.00) {
    throw new Error("LOUD is not clearly above NORMAL: profile=" + profile +
      " lift=" + loudLiftDb.toFixed(2) + " dB");
  }
  if (maxLiftDb < 3.50 || maxOverLoudDb < 2.30) {
    throw new Error("MAX is not a big jump: profile=" + profile +
      " maxLift=" + maxLiftDb.toFixed(2) + " maxOverLoud=" + maxOverLoudDb.toFixed(2) + " dB");
  }

  const guardLimits = [["NORMAL", normal, 0.80], ["LOUD", loud, 0.80], ["MAX", maxed, 1.10]];
  for (const [mode, result, limit] of guardLimits) {
    if (result.maxGuard > limit) {
      throw new Error("Final true-peak limiter is overworking: profile=" + profile +
        " mode=" + mode + " GR=" + result.maxGuard.toFixed(2) + " dB");
    }
    if (result.maxTruePeak > 0.02) {
      throw new Error("True peak exceeded safety ceiling: profile=" + profile +
        " mode=" + mode + " " + result.maxTruePeak.toFixed(2) + " dBTP");
    }
  }
}

// Legacy Extreme loudness compatibility is no longer a release gate. R83 has one
// authoritative NORMAL / LOUD / MAX system.
// MVP_R83_R3_BIG_GUYS_CLEAN_MASTERING: legacy Extreme/Reserve tests removed. The simplified UI has one mastering control.
// MVP_R83_R3_BIG_GUYS_CLEAN_MASTERING: MAX behavior is already enforced by the three-tier test above.
// MVP_R82_R6_CLEAN_MAX: prevent a regression back to the audible R82 MAX overdrive.
const dspSource = fs.readFileSync(path.join(root, "dsp/studio/mvp_studio_dsp.cpp"), "utf8");
if (dspSource.includes("const float drive = 1.0f + amount * 2.20f;")) {
  throw new Error("Old full-waveform MAX overdrive is still present");
}
const cleanMaxOrder = [
  "processHdLoudnessMaximizer(left, right);",
  "processOutputGain(left, right);",
  "processPerceptualDensity(left, right);",
  "processLimiter(left, right, limitedL, limitedR);",
];
let cleanMaxCursor = 0;
for (const token of cleanMaxOrder) {
  const at = dspSource.indexOf(token, cleanMaxCursor);
  if (at < 0) throw new Error("Clean MAX mastering order is missing: " + token);
  cleanMaxCursor = at + token.length;
}

// Prove the advanced effects coexist in the same render instead of cancelling
// each other when several user controls are ON.
configure(2, 0, false, 0);
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
  }
}
// Combination assertions prove every selected DSP stage remains non-zero in the
// same render. They deliberately avoid arbitrary "taste" thresholds that vary
// with the synthetic source while still catching a disconnected/cancelled effect.
if (comboTone < 0.20) throw new Error("Clear + Xpander tone combination did not remain active");
if (comboBass < 0.10) throw new Error("Neural Bass did not remain active in the combination");
if (comboExciter < 0.001) throw new Error("Analog + Xpander harmonic processing did not remain active");
if (comboTransient < 0.02) throw new Error("Punch/Impact + Xpander transient processing did not remain active");
if (comboGuard > 0.40) throw new Error("Combined effects turned Peak Guard into routine processing: " + comboGuard.toFixed(2) + " dB");

// R81-R5: mvp_meter_stereo_width_percent() reports the earlier Stereo Integrity
// stage, not the later user WIDE stage. Prove WIDE from the actual rendered PCM.
// All the other effects remain ON in both renders, so this specifically verifies
// that WIDE survives the real combined-effects chain instead of being cancelled.
function renderCombinedWidth(userWidth) {
  configure(2, 12, true, 0);
  dsp.mvp_set_bass_engine(1, 5.8, 3.4, 2.0, 0.84);
  dsp.mvp_set_tone_engine(1, 5.1, 8.7, 10.5, 0);
  dsp.mvp_set_exciter(1, 0.26, 0.10, 0.16, 0.10);
  dsp.mvp_set_stereo_field(1, userWidth, 1.0, 105);
  dsp.mvp_set_transient(1, 1.0);

  let phaseA = 0;
  let phaseB = 0;
  let midEnergy = 0;
  let sideEnergy = 0;
  let samples = 0;

  for (let block = 0; block < 1200; block += 1) {
    for (let i = 0; i < frames; i += 1) {
      const t = block * frames + i;
      const pulse = (t % 2200) < 240 ? 1.0 : 0.60;
      inL[i] = pulse * (0.58 * Math.sin(phaseA) + 0.19 * Math.sin(phaseB));
      inR[i] = pulse * (0.55 * Math.sin(phaseA + 0.18) + 0.18 * Math.sin(phaseB + 0.37));
      phaseA += (2 * Math.PI * 887) / 48000;
      phaseB += (2 * Math.PI * 2771) / 48000;
    }

    if (dsp.mvp_process(frames) !== 1) {
      throw new Error("mvp_process failed in combined WIDE render");
    }

    if (block > 180) {
      for (let i = 0; i < frames; i += 1) {
        const mid = 0.5 * (outL[i] + outR[i]);
        const side = 0.5 * (outL[i] - outR[i]);
        midEnergy += mid * mid;
        sideEnergy += side * side;
        samples += 1;
      }
    }
  }

  const midRms = Math.sqrt(midEnergy / Math.max(1, samples));
  const sideRms = Math.sqrt(sideEnergy / Math.max(1, samples));
  return {
    midRms,
    sideRms,
    sideToMid: sideRms / Math.max(1e-9, midRms),
  };
}

const combinedWidthOff = renderCombinedWidth(1.0);
const combinedWidthOn = renderCombinedWidth(1.52);
const combinedWideLift = combinedWidthOn.sideToMid / Math.max(1e-9, combinedWidthOff.sideToMid);

if (combinedWideLift < 1.20) {
  throw new Error(
    "WIDE did not produce enough real stereo-side expansion with all effects active: " +
    JSON.stringify({ combinedWidthOff, combinedWidthOn, combinedWideLift })
  );
}

// Also verify the frontend source no longer contains the old cancellation rules.
const playerSource = fs.readFileSync(path.join(root, "src/lib/musicPlayer.ts"), "utf8");
for (const forbidden of ["xpanderToneScale", "xpanderTransientScale", "Math.max(state.exciterAmount / 100, xpander.exciterAmount)"]) {
  if (playerSource.includes(forbidden)) throw new Error("Old effect-cancellation rule still present: " + forbidden);
}
if (!playerSource.includes("extremeLoudnessDb")) throw new Error("Legacy Extreme migration marker is missing from musicPlayer.ts");
if (!playerSource.includes("MusicPlaybackMode")) throw new Error("R82 Device Direct mode is missing from musicPlayer.ts");
if (!playerSource.includes("hdLoudnessMode")) throw new Error("R82 NORMAL/LOUD/MAX state is missing from musicPlayer.ts");
if (!playerSource.includes("MVP_R83_R3_BIG_GUYS_CLEAN_MASTERING")) throw new Error("R83 clean MVP HD architecture is missing");
if (!dspSource.includes("MVP_R83_R3_BIG_GUYS_CLEAN_MASTERING")) throw new Error("R83 clean mastering core is missing");
for (const required of [
  "multibandEnabled: false",
  "dynamicEqEnabled: false",
  "outputCorrectionEnabled: false",
  "stereoIntegrityEnabled: false",
  "normalizationEnabled: false",
  "dynamicsRestoreEnabled: false",
  "smartDspEnabled: false",
]) {
  if (!playerSource.includes(required)) throw new Error("R83 hidden-stage isolation missing: " + required);
}
if (!dspSource.includes("const float amount = maxMode ? 10.0f : 0.70f;")) throw new Error("R83 LOUD/MAX density split is missing");
if (!playerSource.includes("MVP_R82_R9_R3_STABLE_HD_NO_STOP")) throw new Error("R82-R9 persistent mode-switch routing is missing from musicPlayer.ts");

console.table(rows.map((row) => ({
  profile: row.profile === 0 ? "Car/Hi-Fi" : row.profile === 1 ? "Headphones" : "Bluetooth",
  output: row.mode,
  "Mastering GR": row.maxMaster.toFixed(2) + " dB",
  "Peak Guard GR": row.maxGuard.toFixed(2) + " dB",
  "True Peak": row.maxTruePeak.toFixed(2) + " dBTP",
})));
console.table(extremeRows.map((row) => ({
  profile: row.profile === 0 ? "Car/Hi-Fi" : row.profile === 1 ? "Headphones" : "Bluetooth",
  "Extreme Lift": row.liftDb.toFixed(2) + " dB",
  "Peak Guard GR": row.extreme.maxGuard.toFixed(2) + " dB",
})));
console.table(maxRows.map((row) => ({
  profile: row.profile === 0 ? "Car/Hi-Fi" : row.profile === 1 ? "Headphones" : "Bluetooth",
  "MAX Lift": row.liftDb.toFixed(2) + " dB",
  "Peak Guard GR": row.maxed.maxGuard.toFixed(2) + " dB",
})));
console.log("R81 combination meters:", {
  comboTone,
  comboBass,
  comboExciter,
  comboTransient,
  comboGuard,
  combinedWidthOff,
  combinedWidthOn,
  combinedWideLift,
});

console.log("R81 mastering/effects test: PASS");
