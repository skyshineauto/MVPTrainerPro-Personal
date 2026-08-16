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
if (dsp.mvp_init(48000) !== 1) throw new Error("mvp_init failed");
const maxFrames = dsp.mvp_max_frames();
const inL = new Float32Array(memory.buffer, dsp.mvp_input_l(), maxFrames);
const inR = new Float32Array(memory.buffer, dsp.mvp_input_r(), maxFrames);
const outL = new Float32Array(memory.buffer, dsp.mvp_output_l(), maxFrames);
const outR = new Float32Array(memory.buffer, dsp.mvp_output_r(), maxFrames);

dsp.mvp_set_eq_enabled(1);
dsp.mvp_set_eq_band(21, 3.5);
dsp.mvp_set_preamp_db(-2);
dsp.mvp_set_headroom_db(0.7);
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

// Deliberate overload: limiter must stay at or below its -1 dB ceiling.
dsp.mvp_reset();
dsp.mvp_set_eq_enabled(0);
dsp.mvp_set_preamp_db(9);
dsp.mvp_set_headroom_db(0);
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

console.log("MVP Studio WASM V1: PASS");
console.log({
  wasmBytes: bytes.length,
  maxFrames,
  outputPeak,
  ceiling,
  gainReductionDb: dsp.mvp_meter_gain_reduction_db(),
});
