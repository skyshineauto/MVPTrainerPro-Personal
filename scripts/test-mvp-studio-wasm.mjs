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
for (const name of ["mvp_set_transient", "mvp_meter_transient_boost_db"]) {
  if (typeof dsp[name] !== "function") throw new Error(`Missing ${name} export`);
}
if (dsp.mvp_init(48000) !== 1) throw new Error("mvp_init failed");
const maxFrames = dsp.mvp_max_frames();
const inL = new Float32Array(memory.buffer, dsp.mvp_input_l(), maxFrames);
const inR = new Float32Array(memory.buffer, dsp.mvp_input_r(), maxFrames);
const outL = new Float32Array(memory.buffer, dsp.mvp_output_l(), maxFrames);
const outR = new Float32Array(memory.buffer, dsp.mvp_output_r(), maxFrames);

// Base EQ / finite-output test.
dsp.mvp_set_eq_enabled(1);
dsp.mvp_set_eq_band(21, 3.5);
dsp.mvp_set_preamp_db(-2);
dsp.mvp_set_headroom_db(0);
dsp.mvp_set_transient(1, 0.68);
dsp.mvp_set_limiter(1, -1.0);
dsp.mvp_set_output_profile(0);
let phase = 0;
for (let block = 0; block < 500; block += 1) {
  for (let index = 0; index < 128; index += 1) {
    const sample = 0.5 * Math.sin(phase);
    phase += (2 * Math.PI * 2500) / 48000;
    inL[index] = sample;
    inR[index] = sample;
  }
  if (dsp.mvp_process(128) !== 1) throw new Error("mvp_process failed");
  for (let index = 0; index < 128; index += 1) {
    if (!Number.isFinite(outL[index]) || !Number.isFinite(outR[index])) throw new Error("Non-finite DSP output");
  }
}

function renderBurst(transientOn) {
  dsp.mvp_reset();
  dsp.mvp_set_eq_enabled(0);
  dsp.mvp_set_preamp_db(0);
  dsp.mvp_set_headroom_db(0);
  dsp.mvp_set_transient(transientOn ? 1 : 0, 0.82);
  dsp.mvp_set_limiter(0, -1.0);
  dsp.mvp_set_output_profile(0);
  let localPhase = 0;
  let peak = 0;
  let maxTransientMeter = 0;
  // Silence primes the envelopes and the fixed lookahead delay.
  for (let block = 0; block < 24; block += 1) {
    inL.fill(0, 0, 128);
    inR.fill(0, 0, 128);
    dsp.mvp_process(128);
  }
  // Abrupt 1 kHz burst, then a quieter tail. This should create a real onset.
  for (let block = 0; block < 36; block += 1) {
    for (let index = 0; index < 128; index += 1) {
      const global = block * 128 + index;
      const amp = global < 768 ? 0.34 : 0.16;
      const sample = amp * Math.sin(localPhase);
      localPhase += (2 * Math.PI * 1000) / 48000;
      inL[index] = sample;
      inR[index] = sample;
    }
    dsp.mvp_process(128);
    maxTransientMeter = Math.max(maxTransientMeter, Number(dsp.mvp_meter_transient_boost_db()));
    for (let index = 0; index < 128; index += 1) {
      peak = Math.max(peak, Math.abs(outL[index]), Math.abs(outR[index]));
    }
  }
  return { peak, maxTransientMeter };
}

const transientOff = renderBurst(false);
const transientOn = renderBurst(true);
if (!(transientOn.peak > transientOff.peak * 1.015)) {
  throw new Error(`Transient shaper did not increase onset detail enough: off=${transientOff.peak}, on=${transientOn.peak}`);
}
if (!(transientOn.maxTransientMeter > 0.05 && transientOn.maxTransientMeter <= 2.25)) {
  throw new Error(`Transient meter out of range: ${transientOn.maxTransientMeter}`);
}

// Deliberate overload: limiter must still hold at/below the -1 dB ceiling with transient active.
dsp.mvp_reset();
dsp.mvp_set_eq_enabled(0);
dsp.mvp_set_preamp_db(9);
dsp.mvp_set_headroom_db(0);
dsp.mvp_set_transient(1, 1);
dsp.mvp_set_limiter(1, -1.0);
let outputPeak = 0;
phase = 0;
for (let block = 0; block < 300; block += 1) {
  for (let index = 0; index < 128; index += 1) {
    const sample = 0.9 * Math.sin(phase);
    phase += (2 * Math.PI * 997) / 48000;
    inL[index] = sample;
    inR[index] = sample;
  }
  dsp.mvp_process(128);
  for (let index = 0; index < 128; index += 1) {
    outputPeak = Math.max(outputPeak, Math.abs(outL[index]), Math.abs(outR[index]));
  }
}
const ceiling = 10 ** (-1 / 20);
if (outputPeak > ceiling + 0.0001) throw new Error(`Limiter exceeded ceiling: ${outputPeak}`);

console.log("MVP Studio WASM V2 Transient: PASS");
console.log({
  wasmBytes: bytes.length,
  maxFrames,
  transientOff,
  transientOn,
  outputPeak,
  ceiling,
  gainReductionDb: dsp.mvp_meter_gain_reduction_db(),
});
