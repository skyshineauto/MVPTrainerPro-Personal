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
  "mvp_set_transient",
  "mvp_set_multiband",
  "mvp_meter_transient_boost_db",
  "mvp_meter_multiband_gain_reduction_db",
  "mvp_meter_multiband_band_reduction_db",
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
  dsp.mvp_set_preamp_db(0);
  dsp.mvp_set_headroom_db(0);
  dsp.mvp_set_transient(0, 0);
  dsp.mvp_set_multiband(0, 1);
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

// 4) Deliberate overload: final limiter still owns the ceiling after multiband.
dsp.mvp_reset();
baseState();
dsp.mvp_set_preamp_db(9);
dsp.mvp_set_transient(1, 1);
dsp.mvp_set_multiband(1, 1);
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

console.log("MVP Studio WASM V2 Phase 2 Multiband: PASS");
console.log({
  wasmBytes: bytes.length,
  maxFrames,
  responseChecks,
  compressionChecks,
  combinedPeak,
  overloadPeak,
  ceiling,
  limiterGainReductionDb: dsp.mvp_meter_gain_reduction_db(),
});
