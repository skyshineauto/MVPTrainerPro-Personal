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
  "mvp_meter_final_compressor_reduction_db","mvp_meter_true_peak_dbtp"
]) {
  if (typeof dsp[name] !== "function") throw new Error("Missing WASM export: " + name);
}

if (dsp.mvp_init(48000) !== 1) throw new Error("mvp_init failed");
const frames = 128;
const maxFrames = Number(dsp.mvp_max_frames());
const inL = new Float32Array(memory.buffer, Number(dsp.mvp_input_l()), maxFrames);
const inR = new Float32Array(memory.buffer, Number(dsp.mvp_input_r()), maxFrames);

function configure(profile, reserveDb, autoMakeup, preampDb) {
  dsp.mvp_reset();
  dsp.mvp_set_bypass(0);
  dsp.mvp_set_eq_enabled(1);
  for (let band = 0; band < 31; band += 1) dsp.mvp_set_eq_band(band, 0);
  dsp.mvp_set_preamp_db(preampDb);
  dsp.mvp_set_headroom_db(0);
  dsp.mvp_set_transient(1, 0.90);
  dsp.mvp_set_multiband(0, 1);
  dsp.mvp_set_dynamic_eq(0, 0.5);
  dsp.mvp_set_output_correction(0, 1);
  dsp.mvp_set_stereo_integrity(0, 1);
  dsp.mvp_set_loudness(0, -11);
  dsp.mvp_set_limiter(1, -0.30);
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
    }
  }
  return { maxGuard, maxMaster, maxTruePeak };
}

const rows = [];
for (const profile of [0, 1, 2]) {
  for (const highOutput of [false, true]) {
    const result = runCase(profile, highOutput ? 8 : 0, highOutput, highOutput ? 8 : 2);
    rows.push({ profile, highOutput, ...result });

    if (result.maxGuard > 0.40) {
      throw new Error("Peak Guard became routine processing: profile=" + profile +
        " highOutput=" + highOutput + " GR=" + result.maxGuard.toFixed(2) + " dB");
    }
    if (result.maxMaster < 0.5) {
      throw new Error("Mastering stage did not engage: profile=" + profile +
        " highOutput=" + highOutput);
    }
    if (result.maxTruePeak > -0.10) {
      throw new Error("True peak exceeded safety ceiling: " + result.maxTruePeak.toFixed(2) + " dBTP");
    }
  }
}

console.table(rows.map((row) => ({
  profile: row.profile === 0 ? "Car/Hi-Fi" : row.profile === 1 ? "Headphones" : "Bluetooth",
  output: row.highOutput ? "HIGH/MAX" : "NORMAL",
  "Mastering GR": row.maxMaster.toFixed(2) + " dB",
  "Peak Guard GR": row.maxGuard.toFixed(2) + " dB",
  "True Peak": row.maxTruePeak.toFixed(2) + " dBTP",
})));

console.log("R80 mastering test: PASS");
