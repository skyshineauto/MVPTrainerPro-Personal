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
  "mvp_set_eq_topology",
  "mvp_commit_eq",
  "mvp_eq_topology",
  "mvp_linear_phase_taps",
  "mvp_linear_phase_latency_samples",
  "mvp_set_transient",
  "mvp_set_multiband",
  "mvp_set_dynamic_eq",
  "mvp_set_output_correction",
  "mvp_set_stereo_integrity",
  "mvp_set_loudness",
  "mvp_reset_loudness",
  "mvp_meter_loudness_gain_db",
  "mvp_meter_loudness_momentary_lufs",
  "mvp_meter_loudness_program_lufs",
  "mvp_meter_transient_boost_db",
  "mvp_meter_multiband_gain_reduction_db",
  "mvp_meter_multiband_band_reduction_db",
  "mvp_meter_dynamic_eq_gain_reduction_db",
  "mvp_meter_dynamic_eq_band_reduction_db",
  "mvp_meter_output_correction_reduction_db",
  "mvp_meter_stereo_correlation",
  "mvp_meter_stereo_width_percent",
  "mvp_meter_stereo_guard_reduction_db",
  "mvp_meter_true_peak_linear",
  "mvp_meter_true_peak_dbtp",
]) {
  if (typeof dsp[name] !== "function") throw new Error(`Missing ${name} export`);
}
if (dsp.mvp_init(48000) !== 1) throw new Error("mvp_init failed");
const maxFrames = dsp.mvp_max_frames();
const inL = new Float32Array(memory.buffer, dsp.mvp_input_l(), maxFrames);
const inR = new Float32Array(memory.buffer, dsp.mvp_input_r(), maxFrames);
const outL = new Float32Array(memory.buffer, dsp.mvp_output_l(), maxFrames);
const outR = new Float32Array(memory.buffer, dsp.mvp_output_r(), maxFrames);

function baseState() {
  dsp.mvp_set_eq_enabled(0);
  dsp.mvp_set_eq_topology(0);
  for (let index = 0; index < 31; index += 1) dsp.mvp_set_eq_band(index, 0);
  dsp.mvp_commit_eq();
  dsp.mvp_set_preamp_db(0);
  dsp.mvp_set_headroom_db(0);
  dsp.mvp_set_transient(0, 0);
  dsp.mvp_set_multiband(0, 1);
  dsp.mvp_set_dynamic_eq(0, 0.72);
  dsp.mvp_set_output_correction(0, 1);
  dsp.mvp_set_stereo_integrity(0, 1);
  dsp.mvp_set_loudness(0, -10);
  dsp.mvp_set_limiter(0, -1.0);
  dsp.mvp_set_output_profile(1); // Headphone profile is neutral in the V2 core.
  dsp.mvp_set_headphone(0, 0, 0, 0, 0.5, 0);
}

function renderSine({ frequency, amplitude, multiband, blocks = 320 }) {
  dsp.mvp_reset();
  baseState();
  dsp.mvp_set_multiband(multiband ? 1 : 0, 1);
  let phase = 0;
  let sumSq = 0;
  let count = 0;
  let peak = 0;
  let maxGr = 0;
  const bandMax = [0, 0, 0, 0];
  for (let block = 0; block < blocks; block += 1) {
    for (let i = 0; i < 128; i += 1) {
      const sample = amplitude * Math.sin(phase);
      phase += (2 * Math.PI * frequency) / 48000;
      inL[i] = sample;
      inR[i] = sample;
    }
    if (dsp.mvp_process(128) !== 1) throw new Error("mvp_process failed");
    if (block > 80) {
      for (let i = 0; i < 128; i += 1) {
        const l = outL[i];
        const r = outR[i];
        if (!Number.isFinite(l) || !Number.isFinite(r)) throw new Error("Non-finite DSP output");
        sumSq += 0.5 * (l * l + r * r);
        count += 1;
        peak = Math.max(peak, Math.abs(l), Math.abs(r));
      }
      maxGr = Math.max(maxGr, Number(dsp.mvp_meter_multiband_gain_reduction_db()));
      for (let band = 0; band < 4; band += 1) {
        bandMax[band] = Math.max(bandMax[band], Number(dsp.mvp_meter_multiband_band_reduction_db(band)));
      }
    }
  }
  return { rms: Math.sqrt(sumSq / Math.max(1, count)), peak, maxGr, bandMax };
}

// 1) Quiet signals should retain essentially flat magnitude through the LR4 network.
const responseChecks = [];
for (const frequency of [60, 120, 250, 500, 1000, 4000, 8000, 14000]) {
  const dry = renderSine({ frequency, amplitude: 0.008, multiband: false, blocks: 260 });
  const wet = renderSine({ frequency, amplitude: 0.008, multiband: true, blocks: 260 });
  const deltaDb = 20 * Math.log10(Math.max(1e-9, wet.rms) / Math.max(1e-9, dry.rms));
  responseChecks.push({ frequency, deltaDb });
  if (Math.abs(deltaDb) > 0.35) {
    throw new Error(`Multiband crossover response not flat enough at ${frequency} Hz: ${deltaDb.toFixed(3)} dB`);
  }
}

// 2) Loud program material should create gentle, bounded gain reduction.
const compressionChecks = [];
for (const frequency of [80, 250, 1200, 7000]) {
  const dry = renderSine({ frequency, amplitude: 0.55, multiband: false });
  const wet = renderSine({ frequency, amplitude: 0.55, multiband: true });
  const deltaDb = 20 * Math.log10(Math.max(1e-9, wet.rms) / Math.max(1e-9, dry.rms));
  compressionChecks.push({ frequency, deltaDb, maxGr: wet.maxGr, bandMax: wet.bandMax });
  if (!(wet.maxGr > 0.05 && wet.maxGr <= 3.05)) {
    throw new Error(`Multiband GR out of range at ${frequency} Hz: ${wet.maxGr}`);
  }
  if (deltaDb > 0.15 || deltaDb < -3.4) {
    throw new Error(`Unexpected multiband level change at ${frequency} Hz: ${deltaDb.toFixed(3)} dB`);
  }
}

// 3) Transient processor and multiband must coexist without non-finite output.
dsp.mvp_reset();
baseState();
dsp.mvp_set_transient(1, 0.72);
dsp.mvp_set_multiband(1, 1);
dsp.mvp_set_dynamic_eq(1, 0.72);
dsp.mvp_set_output_profile(2);
dsp.mvp_set_output_correction(1, 1);
dsp.mvp_set_limiter(1, -1.0);
let phase = 0;
let combinedPeak = 0;
for (let block = 0; block < 420; block += 1) {
  for (let i = 0; i < 128; i += 1) {
    const t = block * 128 + i;
    const burst = t % 2400 < 260 ? 0.78 : 0.36;
    const sample = burst * (0.64 * Math.sin(phase) + 0.28 * Math.sin(phase * 2.73));
    phase += (2 * Math.PI * 997) / 48000;
    inL[i] = sample;
    inR[i] = sample * 0.93;
  }
  dsp.mvp_process(128);
  for (let i = 0; i < 128; i += 1) {
    if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) throw new Error("Non-finite combined DSP output");
    combinedPeak = Math.max(combinedPeak, Math.abs(outL[i]), Math.abs(outR[i]));
  }
}

// 4) Dynamic EQ should be essentially transparent below threshold and apply
// bounded cut-only correction to hot resonant material.
function renderDynamicEq({ frequency, amplitude, enabled, seconds = 4 }) {
  dsp.mvp_reset();
  baseState();
  dsp.mvp_set_dynamic_eq(enabled ? 1 : 0, 0.72);
  dsp.mvp_set_limiter(0, -1.0);
  let phase = 0;
  let sumSq = 0;
  let count = 0;
  let maxGr = 0;
  const bandMax = [0, 0, 0, 0];
  const blocks = Math.ceil((seconds * 48000) / 128);
  for (let block = 0; block < blocks; block += 1) {
    for (let i = 0; i < 128; i += 1) {
      const sample = amplitude * Math.sin(phase);
      phase += (2 * Math.PI * frequency) / 48000;
      inL[i] = sample;
      inR[i] = sample;
    }
    if (dsp.mvp_process(128) !== 1) throw new Error("mvp_process failed in dynamic EQ test");
    if (block > Math.floor(blocks * 0.55)) {
      for (let i = 0; i < 128; i += 1) {
        if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) throw new Error("Non-finite dynamic EQ output");
        sumSq += 0.5 * (outL[i] * outL[i] + outR[i] * outR[i]);
        count += 1;
      }
      maxGr = Math.max(maxGr, Number(dsp.mvp_meter_dynamic_eq_gain_reduction_db()));
      for (let band = 0; band < 4; band += 1) {
        bandMax[band] = Math.max(bandMax[band], Number(dsp.mvp_meter_dynamic_eq_band_reduction_db(band)));
      }
    }
  }
  return { rms: Math.sqrt(sumSq / Math.max(1, count)), maxGr, bandMax };
}

const dynamicQuietDry = renderDynamicEq({ frequency: 3200, amplitude: 0.015, enabled: false });
const dynamicQuietWet = renderDynamicEq({ frequency: 3200, amplitude: 0.015, enabled: true });
const dynamicQuietDeltaDb = 20 * Math.log10(Math.max(1e-9, dynamicQuietWet.rms) / Math.max(1e-9, dynamicQuietDry.rms));
if (Math.abs(dynamicQuietDeltaDb) > 0.25 || dynamicQuietWet.maxGr > 0.2) {
  throw new Error(`Dynamic EQ altered quiet program too much: ${JSON.stringify({ dynamicQuietDeltaDb, dynamicQuietWet })}`);
}

const dynamicHotDry = renderDynamicEq({ frequency: 3200, amplitude: 0.62, enabled: false });
const dynamicHotWet = renderDynamicEq({ frequency: 3200, amplitude: 0.62, enabled: true });
const dynamicHotDeltaDb = 20 * Math.log10(Math.max(1e-9, dynamicHotWet.rms) / Math.max(1e-9, dynamicHotDry.rms));
if (!(dynamicHotWet.maxGr > 0.2 && dynamicHotWet.maxGr <= 2.6)) {
  throw new Error(`Dynamic EQ GR out of range: ${JSON.stringify(dynamicHotWet)}`);
}
if (!(dynamicHotDeltaDb < -0.1 && dynamicHotDeltaDb > -3.0)) {
  throw new Error(`Dynamic EQ hot-band level change is implausible: ${dynamicHotDeltaDb.toFixed(3)} dB`);
}


// 5) Intelligent output correction should be transparent on quiet material and
// apply a bounded cut-only low-frequency guard when the Bluetooth path is stressed.
function renderOutputCorrection({ profile, frequency, amplitude, enabled, seconds = 5 }) {
  dsp.mvp_reset();
  baseState();
  dsp.mvp_set_output_profile(profile);
  dsp.mvp_set_output_correction(enabled ? 1 : 0, 1);
  dsp.mvp_set_limiter(0, -1.0);
  let phase = 0;
  let sumSq = 0;
  let count = 0;
  let maxGr = 0;
  const blocks = Math.ceil((seconds * 48000) / 128);
  for (let block = 0; block < blocks; block += 1) {
    for (let i = 0; i < 128; i += 1) {
      const sample = amplitude * Math.sin(phase);
      phase += (2 * Math.PI * frequency) / 48000;
      inL[i] = sample;
      inR[i] = sample;
    }
    if (dsp.mvp_process(128) !== 1) throw new Error("mvp_process failed in output correction test");
    if (block > Math.floor(blocks * 0.55)) {
      for (let i = 0; i < 128; i += 1) {
        if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) throw new Error("Non-finite output correction output");
        sumSq += 0.5 * (outL[i] * outL[i] + outR[i] * outR[i]);
        count += 1;
      }
      maxGr = Math.max(maxGr, Number(dsp.mvp_meter_output_correction_reduction_db()));
    }
  }
  return { rms: Math.sqrt(sumSq / Math.max(1, count)), maxGr };
}

const speakerQuietDry = renderOutputCorrection({ profile: 2, frequency: 82, amplitude: 0.015, enabled: false });
const speakerQuietWet = renderOutputCorrection({ profile: 2, frequency: 82, amplitude: 0.015, enabled: true });
const speakerQuietDeltaDb = 20 * Math.log10(Math.max(1e-9, speakerQuietWet.rms) / Math.max(1e-9, speakerQuietDry.rms));
if (Math.abs(speakerQuietDeltaDb) > 0.2 || speakerQuietWet.maxGr > 0.15) {
  throw new Error(`Output correction altered quiet Bluetooth material too much: ${JSON.stringify({ speakerQuietDeltaDb, speakerQuietWet })}`);
}

const speakerHotDry = renderOutputCorrection({ profile: 2, frequency: 82, amplitude: 0.62, enabled: false });
const speakerHotWet = renderOutputCorrection({ profile: 2, frequency: 82, amplitude: 0.62, enabled: true });
const speakerHotDeltaDb = 20 * Math.log10(Math.max(1e-9, speakerHotWet.rms) / Math.max(1e-9, speakerHotDry.rms));
if (!(speakerHotWet.maxGr > 0.25 && speakerHotWet.maxGr <= 2.25)) {
  throw new Error(`Bluetooth output guard GR out of range: ${JSON.stringify(speakerHotWet)}`);
}
if (!(speakerHotDeltaDb < -0.1 && speakerHotDeltaDb > -2.7)) {
  throw new Error(`Bluetooth output correction change is implausible: ${speakerHotDeltaDb.toFixed(3)} dB`);
}

// 6) Volume Match should move program gain slowly toward -10 LUFS,
// without becoming a short-term compressor. A loud steady program attenuates;
// a quiet one receives a bounded boost.
function renderLoudness(amplitude, enabled, seconds = 14) {
  dsp.mvp_reset();
  baseState();
  dsp.mvp_set_limiter(1, -1.0);
  dsp.mvp_set_loudness(enabled ? 1 : 0, -10.0);
  let phase = 0;
  let peak = 0;
  const blocks = Math.ceil((seconds * 48000) / 128);
  for (let block = 0; block < blocks; block += 1) {
    for (let i = 0; i < 128; i += 1) {
      const sample = amplitude * Math.sin(phase);
      phase += (2 * Math.PI * 1000) / 48000;
      inL[i] = sample;
      inR[i] = sample;
    }
    if (dsp.mvp_process(128) !== 1) throw new Error("mvp_process failed in loudness test");
    if (block > blocks - 300) {
      for (let i = 0; i < 128; i += 1) {
        if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) throw new Error("Non-finite loudness output");
        peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
      }
    }
  }
  return {
    peak,
    gainDb: Number(dsp.mvp_meter_loudness_gain_db()),
    momentaryLufs: Number(dsp.mvp_meter_loudness_momentary_lufs()),
    programLufs: Number(dsp.mvp_meter_loudness_program_lufs()),
  };
}

const loudProgram = renderLoudness(0.4, true);
if (!(loudProgram.gainDb < -1.0 && loudProgram.gainDb >= -2.2)) {
  throw new Error(`Volume Match did not apply the expected bounded trim: ${JSON.stringify(loudProgram)}`);
}
if (!(loudProgram.programLufs > -16 && loudProgram.programLufs < -5)) {
  throw new Error(`Loud program meter is implausible: ${loudProgram.programLufs}`);
}

const quietProgram = renderLoudness(0.04, true);
if (!(quietProgram.gainDb > 2.0 && quietProgram.gainDb <= 3.1)) {
  throw new Error(`Volume Match did not apply bounded quiet-program gain: ${JSON.stringify(quietProgram)}`);
}

const matchedProgram = renderLoudness(0.31, true, 10);
if (Math.abs(matchedProgram.gainDb) > 0.15) {
  throw new Error(`Volume Match dead zone altered an already-matched program: ${JSON.stringify(matchedProgram)}`);
}

const normalizationOff = renderLoudness(0.4, false, 6);
if (Math.abs(normalizationOff.gainDb) > 0.1) {
  throw new Error(`Disabled Volume Match changed gain: ${normalizationOff.gainDb}`);
}

// 7) Deliberate overload: final limiter still owns the ceiling after the Dynamic EQ chain.
dsp.mvp_reset();
baseState();
dsp.mvp_set_preamp_db(9);
dsp.mvp_set_transient(1, 1);
dsp.mvp_set_multiband(1, 1);
dsp.mvp_set_output_profile(2);
dsp.mvp_set_output_correction(1, 1);
dsp.mvp_set_limiter(1, -1.0);
let overloadPeak = 0;
phase = 0;
for (let block = 0; block < 320; block += 1) {
  for (let i = 0; i < 128; i += 1) {
    const sample = 0.9 * Math.sin(phase);
    phase += (2 * Math.PI * 997) / 48000;
    inL[i] = sample;
    inR[i] = sample;
  }
  dsp.mvp_process(128);
  for (let i = 0; i < 128; i += 1) overloadPeak = Math.max(overloadPeak, Math.abs(outL[i]), Math.abs(outR[i]));
}
const ceiling = 10 ** (-1 / 20);
if (overloadPeak > ceiling + 0.0001) throw new Error(`Limiter exceeded ceiling: ${overloadPeak}`);

console.log("MVP Studio WASM V3 Phase 4 True Peak: PASS");
console.log({
  wasmBytes: bytes.length,
  maxFrames,
  responseChecks,
  compressionChecks,
  combinedPeak,
  dynamicEq: {
    quietDeltaDb: dynamicQuietDeltaDb,
    quietMaxGrDb: dynamicQuietWet.maxGr,
    hotDeltaDb: dynamicHotDeltaDb,
    hotMaxGrDb: dynamicHotWet.maxGr,
    hotBandMaxDb: dynamicHotWet.bandMax,
  },
  outputCorrection: {
    speakerQuietDeltaDb,
    speakerQuietMaxGrDb: speakerQuietWet.maxGr,
    speakerHotDeltaDb,
    speakerHotMaxGrDb: speakerHotWet.maxGr,
  },
  loudProgram,
  quietProgram,
  matchedProgram,
  normalizationOff,
  overloadPeak,
  ceiling,
  limiterGainReductionDb: dsp.mvp_meter_gain_reduction_db(),
});


// 8) Studio Linear Phase must be a real WASM topology with a symmetric FIR,
// correct fixed latency, near-unity flat response, and materially correct band gain.
if (Number(dsp.mvp_linear_phase_taps()) !== 4097) {
  throw new Error(`Unexpected linear phase tap count: ${dsp.mvp_linear_phase_taps()}`);
}
if (Number(dsp.mvp_linear_phase_latency_samples()) !== 2176) {
  throw new Error(`Unexpected linear phase added latency: ${dsp.mvp_linear_phase_latency_samples()}`);
}

function renderLinearPhaseSine({ frequency, boostBand = -1, boostDb = 0, topology = 1, seconds = 2.8 }) {
  dsp.mvp_reset();
  baseState();
  dsp.mvp_set_eq_enabled(1);
  dsp.mvp_set_eq_topology(topology);
  for (let index = 0; index < 31; index += 1) dsp.mvp_set_eq_band(index, index === boostBand ? boostDb : 0);
  dsp.mvp_commit_eq();
  let phase = 0;
  let sumSq = 0;
  let count = 0;
  const blocks = Math.ceil((seconds * 48000) / 128);
  for (let block = 0; block < blocks; block += 1) {
    for (let i = 0; i < 128; i += 1) {
      const sample = 0.018 * Math.sin(phase);
      phase += (2 * Math.PI * frequency) / 48000;
      inL[i] = sample;
      inR[i] = sample;
    }
    if (dsp.mvp_process(128) !== 1) throw new Error("mvp_process failed in linear phase test");
    if (block > Math.floor(blocks * 0.55)) {
      for (let i = 0; i < 128; i += 1) {
        if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) throw new Error("Non-finite linear phase output");
        sumSq += 0.5 * (outL[i] * outL[i] + outR[i] * outR[i]);
        count += 1;
      }
    }
  }
  return Math.sqrt(sumSq / Math.max(1, count));
}

for (const frequency of [63, 250, 1000, 4000, 10000]) {
  const minimum = renderLinearPhaseSine({ frequency, topology: 0 });
  const linearFlat = renderLinearPhaseSine({ frequency, topology: 1 });
  const deltaDb = 20 * Math.log10(Math.max(1e-9, linearFlat) / Math.max(1e-9, minimum));
  if (Math.abs(deltaDb) > 0.18) throw new Error(`Flat linear-phase response drift at ${frequency} Hz: ${deltaDb.toFixed(3)} dB`);
}

const oneKhzFlat = renderLinearPhaseSine({ frequency: 1000, topology: 1 });
const oneKhzBoost = renderLinearPhaseSine({ frequency: 1000, topology: 1, boostBand: 17, boostDb: 6 });
const oneKhzBoostDb = 20 * Math.log10(Math.max(1e-9, oneKhzBoost) / Math.max(1e-9, oneKhzFlat));
if (oneKhzBoostDb < 5.7 || oneKhzBoostDb > 6.25) {
  throw new Error(`Linear-phase 1 kHz +6 dB band is inaccurate: ${oneKhzBoostDb.toFixed(3)} dB`);
}
const sixtyThreeFlat = renderLinearPhaseSine({ frequency: 63, topology: 1 });
const sixtyThreeBoost = renderLinearPhaseSine({ frequency: 63, topology: 1, boostBand: 5, boostDb: 6 });
const sixtyThreeBoostDb = 20 * Math.log10(Math.max(1e-9, sixtyThreeBoost) / Math.max(1e-9, sixtyThreeFlat));
if (sixtyThreeBoostDb < 4.9 || sixtyThreeBoostDb > 6.25) {
  throw new Error(`Linear-phase 63 Hz +6 dB band is inaccurate: ${sixtyThreeBoostDb.toFixed(3)} dB`);
}

// 9) The complete advanced chain must remain finite with Linear Phase enabled.
dsp.mvp_reset();
baseState();
dsp.mvp_set_eq_enabled(1);
dsp.mvp_set_eq_topology(1);
for (let index = 0; index < 31; index += 1) dsp.mvp_set_eq_band(index, index === 17 ? 3.5 : index === 5 ? 3 : 0);
dsp.mvp_commit_eq();
dsp.mvp_set_transient(1, 0.68);
dsp.mvp_set_multiband(1, 1);
dsp.mvp_set_dynamic_eq(1, 0.72);
dsp.mvp_set_output_profile(2);
dsp.mvp_set_output_correction(1, 1);
dsp.mvp_set_loudness(0, -10);
dsp.mvp_set_limiter(1, -1);
let linearCombinedPhase = 0;
let linearCombinedPeak = 0;
for (let block = 0; block < 500; block += 1) {
  for (let i = 0; i < 128; i += 1) {
    const sample = 0.55 * Math.sin(linearCombinedPhase) + 0.17 * Math.sin(linearCombinedPhase * 3.17);
    linearCombinedPhase += (2 * Math.PI * 997) / 48000;
    inL[i] = sample;
    inR[i] = sample * 0.94;
  }
  if (dsp.mvp_process(128) !== 1) throw new Error("mvp_process failed in full linear chain");
  for (let i = 0; i < 128; i += 1) {
    if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) throw new Error("Non-finite full linear chain output");
    linearCombinedPeak = Math.max(linearCombinedPeak, Math.abs(outL[i]), Math.abs(outR[i]));
  }
}
const linearCeiling = 10 ** (-1 / 20);
if (linearCombinedPeak > linearCeiling + 0.00002) {
  throw new Error(`Linear chain exceeded limiter ceiling: ${linearCombinedPeak}`);
}

console.log(JSON.stringify({
  linearPhase: {
    taps: Number(dsp.mvp_linear_phase_taps()),
    addedLatencySamples: Number(dsp.mvp_linear_phase_latency_samples()),
    oneKhzBoostDb,
    sixtyThreeBoostDb,
    fullChainPeak: linearCombinedPeak,
  },
}, null, 2));


// 10) BS.1770-style 4x true-peak detector must catch an inter-sample peak
// that a sample-peak detector misses, and the limiter must hold the rendered
// output below the requested -1 dBTP ceiling with its small safety margin.
const truePeakCoeffs = [
  [0.0017089843750, -0.0291748046875, -0.0189208984375, -0.0083007812500],
  [0.0109863281250, 0.0292968750000, 0.0330810546875, 0.0148925781250],
  [-0.0196533203125, -0.0517578125000, -0.0582275390625, -0.0266113281250],
  [0.0332031250000, 0.0891113281250, 0.1015625000000, 0.0476074218750],
  [-0.0594482421875, -0.1665039062500, -0.2003173828125, -0.1022949218750],
  [0.1373291015625, 0.4650878906250, 0.7797851562500, 0.9721679687500],
  [0.9721679687500, 0.7797851562500, 0.4650878906250, 0.1373291015625],
  [-0.1022949218750, -0.2003173828125, -0.1665039062500, -0.0594482421875],
  [0.0476074218750, 0.1015625000000, 0.0891113281250, 0.0332031250000],
  [-0.0266113281250, -0.0582275390625, -0.0517578125000, -0.0196533203125],
  [0.0148925781250, 0.0330810546875, 0.0292968750000, 0.0109863281250],
  [-0.0083007812500, -0.0189208984375, -0.0291748046875, 0.0017089843750],
];
function measureTruePeak(samples) {
  const history = new Array(12).fill(0);
  let peak = 0;
  for (const sample of samples) {
    for (let tap = 11; tap > 0; tap -= 1) history[tap] = history[tap - 1];
    history[0] = sample;
    peak = Math.max(peak, Math.abs(sample));
    for (let phaseIndex = 0; phaseIndex < 4; phaseIndex += 1) {
      let interpolated = 0;
      for (let tap = 0; tap < 12; tap += 1) interpolated += history[tap] * truePeakCoeffs[tap][phaseIndex];
      peak = Math.max(peak, Math.abs(interpolated));
    }
  }
  return peak;
}
function renderUnluckyQuarterRateTone(limiterEnabled) {
  dsp.mvp_reset();
  baseState();
  dsp.mvp_set_limiter(limiterEnabled ? 1 : 0, -1.0);
  let tonePhase = Math.PI / 4;
  let samplePeak = 0;
  let meterPeakDbtp = -120;
  const rendered = [];
  for (let block = 0; block < 180; block += 1) {
    for (let i = 0; i < 128; i += 1) {
      const sample = 0.95 * Math.sin(tonePhase);
      tonePhase += (2 * Math.PI * 12000) / 48000;
      inL[i] = sample;
      inR[i] = sample;
      samplePeak = Math.max(samplePeak, Math.abs(sample));
    }
    if (dsp.mvp_process(128) !== 1) throw new Error("mvp_process failed in true-peak test");
    meterPeakDbtp = Math.max(meterPeakDbtp, Number(dsp.mvp_meter_true_peak_dbtp()));
    for (let i = 0; i < 128; i += 1) rendered.push(outL[i]);
  }
  const renderedTruePeak = measureTruePeak(rendered);
  return {
    samplePeak,
    meterPeakDbtp,
    renderedTruePeak,
    renderedTruePeakDbtp: 20 * Math.log10(Math.max(1e-12, renderedTruePeak)),
    gainReductionDb: Number(dsp.mvp_meter_gain_reduction_db()),
  };
}
const truePeakUnlim = renderUnluckyQuarterRateTone(false);
if (!(truePeakUnlim.samplePeak < 0.70 && truePeakUnlim.meterPeakDbtp > -0.6 && truePeakUnlim.meterPeakDbtp < -0.1)) {
  throw new Error(`True-peak detector failed to expose an inter-sample peak: ${JSON.stringify(truePeakUnlim)}`);
}
const truePeakLimited = renderUnluckyQuarterRateTone(true);
if (truePeakLimited.renderedTruePeakDbtp > -1.0 + 0.01) {
  throw new Error(`True-peak limiter exceeded -1 dBTP: ${JSON.stringify(truePeakLimited)}`);
}
if (!(truePeakLimited.gainReductionDb > 0.3 && truePeakLimited.gainReductionDb < 1.2)) {
  throw new Error(`True-peak limiter GR is implausible: ${JSON.stringify(truePeakLimited)}`);
}
console.log(JSON.stringify({ truePeak: { unlim: truePeakUnlim, limited: truePeakLimited } }, null, 2));


// V4 Stereo Integrity refinement regression.
function renderStereoIntegrity({ mode, frequency = 1000, profile = 2, enabled = true, blocks = 900 }) {
  dsp.mvp_reset();
  baseState();
  dsp.mvp_set_output_profile(profile);
  dsp.mvp_set_stereo_integrity(enabled ? 1 : 0, 1);
  dsp.mvp_set_limiter(0, -1.0);
  let phase = 0;
  let sumSq = 0;
  let count = 0;
  let maxGuard = 0;
  let corr = 1;
  let width = 100;
  for (let block = 0; block < blocks; block += 1) {
    for (let i = 0; i < 128; i += 1) {
      const left = 0.25 * Math.sin(phase);
      const rightIndependent = 0.22 * Math.sin(phase * 1.173 + 0.4);
      phase += (2 * Math.PI * frequency) / 48000;
      inL[i] = left;
      inR[i] = mode === "mono" ? left : mode === "antiphase" ? -left : rightIndependent;
    }
    if (dsp.mvp_process(128) !== 1) throw new Error("mvp_process failed in Stereo Integrity test");
    if (block > 620) {
      for (let i = 0; i < 128; i += 1) {
        if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) throw new Error("Non-finite Stereo Integrity output");
        sumSq += 0.5 * (outL[i] * outL[i] + outR[i] * outR[i]);
        count += 1;
      }
      maxGuard = Math.max(maxGuard, Number(dsp.mvp_meter_stereo_guard_reduction_db()));
      corr = Number(dsp.mvp_meter_stereo_correlation());
      width = Number(dsp.mvp_meter_stereo_width_percent());
    }
  }
  return { rms: Math.sqrt(sumSq / Math.max(1, count)), maxGuard, corr, width };
}
const stereoMono = renderStereoIntegrity({ mode: "mono", profile: 2 });
if (stereoMono.corr < 0.95 || stereoMono.maxGuard > 0.05) throw new Error(`Stereo Integrity altered mono stability: ${JSON.stringify(stereoMono)}`);
const stereoNormal = renderStereoIntegrity({ mode: "normal", profile: 0 });
if (stereoNormal.maxGuard > 0.15) throw new Error(`Stereo Integrity guard overreacted to normal stereo: ${JSON.stringify(stereoNormal)}`);
const stereoAnti = renderStereoIntegrity({ mode: "antiphase", profile: 2 });
if (!(stereoAnti.corr < -0.9 && stereoAnti.maxGuard > 2.3 && stereoAnti.maxGuard <= 2.6)) throw new Error(`Stereo anti-phase guard failed: ${JSON.stringify(stereoAnti)}`);
const stereoLowDry = renderStereoIntegrity({ mode: "antiphase", frequency: 80, profile: 2, enabled: false });
const stereoLowWet = renderStereoIntegrity({ mode: "antiphase", frequency: 80, profile: 2, enabled: true });
const stereoLowDeltaDb = 20 * Math.log10(Math.max(1e-9, stereoLowWet.rms) / Math.max(1e-9, stereoLowDry.rms));
if (!(stereoLowDeltaDb < -2.2 && stereoLowDeltaDb > -6.0)) throw new Error(`Stereo low-bass anchor out of range: ${stereoLowDeltaDb.toFixed(3)} dB`);
console.log("Stereo Integrity:", { stereoMono, stereoNormal, stereoAnti, stereoLowDeltaDb });
