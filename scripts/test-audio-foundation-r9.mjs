import fs from "node:fs";
import vm from "node:vm";

const workletPath = process.argv[2] || "public/audio/mvpSoundModes.worklet.js";
const code = fs.readFileSync(workletPath, "utf8");
let Processor = null;

class AudioWorkletProcessorStub {
  constructor() {
    this.port = { onmessage: null, postMessage() {} };
  }
}

vm.runInNewContext(code, {
  AudioWorkletProcessor: AudioWorkletProcessorStub,
  registerProcessor(name, klass) {
    if (name !== "mvp-sound-modes") throw new Error(`Unexpected processor ${name}`);
    Processor = klass;
  },
  sampleRate: 48000,
  Float32Array,
  Math,
}, { filename: workletPath });

if (!Processor) throw new Error("Worklet did not register.");

const sr = 48000;
const skip = 8192;

function signal(type = "dynamic", seconds = 4) {
  const n = sr * seconds;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / sr;
    let env = 1;
    if (type === "dynamic") {
      const beat = t % 0.5;
      env = 0.46 + (beat < 0.028 ? Math.exp(-beat * 90) : 0);
    } else if (type === "hot") {
      env = 0.92;
    } else if (type === "brick") {
      env = 1.15;
    }
    let x =
      0.30 * Math.sin(2 * Math.PI * 50 * t) +
      0.22 * Math.sin(2 * Math.PI * 110 * t) +
      0.18 * Math.sin(2 * Math.PI * 1000 * t) +
      0.12 * Math.sin(2 * Math.PI * 3400 * t) +
      0.08 * Math.sin(2 * Math.PI * 9000 * t);
    let y =
      0.28 * Math.sin(2 * Math.PI * 50 * t + 0.03) +
      0.20 * Math.sin(2 * Math.PI * 110 * t + 0.10) +
      0.18 * Math.sin(2 * Math.PI * 1000 * t + 0.15) +
      0.11 * Math.sin(2 * Math.PI * 3400 * t + 0.40) +
      0.07 * Math.sin(2 * Math.PI * 9000 * t + 0.70);
    x *= env;
    y *= env;
    if (type === "brick") {
      x = Math.max(-0.94, Math.min(0.94, x * 1.65));
      y = Math.max(-0.94, Math.min(0.94, y * 1.65));
    }
    L[i] = x;
    R[i] = y;
  }
  return { L, R };
}

function render(sig, mode) {
  const p = new Processor();
  p.port.onmessage?.({ data: { type: "mode", mode } });
  const outL = new Float32Array(sig.L.length);
  const outR = new Float32Array(sig.R.length);
  const block = 128;
  for (let off = 0; off < sig.L.length; off += block) {
    const inL = new Float32Array(block);
    const inR = new Float32Array(block);
    inL.set(sig.L.subarray(off, Math.min(sig.L.length, off + block)));
    inR.set(sig.R.subarray(off, Math.min(sig.R.length, off + block)));
    const blockL = new Float32Array(block);
    const blockR = new Float32Array(block);
    p.process([[inL, inR]], [[blockL, blockR]]);
    const size = Math.min(block, sig.L.length - off);
    outL.set(blockL.subarray(0, size), off);
    outR.set(blockR.subarray(0, size), off);
  }
  return { L: outL, R: outR };
}

function rms(o) {
  let sum = 0;
  let n = 0;
  for (let i = skip; i < o.L.length; i += 1) {
    sum += o.L[i] * o.L[i] + o.R[i] * o.R[i];
    n += 2;
  }
  return Math.sqrt(sum / Math.max(1, n));
}

function db(value) {
  return 20 * Math.log10(Math.max(1e-12, value));
}

function peak(o) {
  let p = 0;
  for (let i = skip; i < o.L.length; i += 1) {
    p = Math.max(p, Math.abs(o.L[i]), Math.abs(o.R[i]));
  }
  return p;
}

function mag(o, frequency) {
  let cr = 0;
  let ci = 0;
  let n = 0;
  for (let i = skip; i < o.L.length; i += 1) {
    const x = (o.L[i] + o.R[i]) * 0.5;
    const a = 2 * Math.PI * frequency * i / sr;
    cr += x * Math.cos(a);
    ci -= x * Math.sin(a);
    n += 1;
  }
  return 2 * Math.hypot(cr, ci) / Math.max(1, n);
}

function maxError(a, b) {
  let e = 0;
  for (let i = 0; i < a.L.length; i += 1) {
    e = Math.max(e, Math.abs(a.L[i] - b.L[i]), Math.abs(a.R[i] - b.R[i]));
  }
  return e;
}

function finite(o) {
  for (let i = 0; i < o.L.length; i += 1) {
    if (!Number.isFinite(o.L[i]) || !Number.isFinite(o.R[i])) return false;
  }
  return true;
}

const rows = [];
function check(name, pass, data) {
  rows.push({ name, pass, data });
  console.log(pass ? "PASS" : "FAIL", name, data);
}

for (const type of ["dynamic", "hot", "brick"]) {
  const sig = signal(type);
  const pure = render(sig, "pure");
  const adaptive = render(sig, "adaptive");
  const power = render(sig, "power");

  if (type === "dynamic") {
    check("PURE sample-identical", maxError(pure, sig) < 1e-7, { maxError: maxError(pure, sig) });
  }

  const adaptiveRms = db(rms(adaptive) / rms(pure));
  const powerRms = db(rms(power) / rms(adaptive));
  const powerPresence = db(mag(power, 3400) / mag(adaptive, 3400));
  const powerAir = db(mag(power, 9000) / mag(adaptive, 9000));
  const powerPeak = peak(power);

  check(`${type} Adaptive differs from Pure`,
    type === "brick"
      ? Math.abs(adaptiveRms) > 0.25
      : adaptiveRms > 0.25,
    { adaptiveRms }
  );

  check(`${type} Power unmistakable`,
    type === "dynamic"
      ? powerRms > 1.5 && powerPresence > 2.0
      : type === "hot"
        ? (powerRms > 0.5 && powerPresence > 2.0)
        : powerPresence > 2.0,
    { powerRms, powerPresence, powerAir }
  );

  check(`${type} safe`,
    finite(adaptive) && finite(power) && powerPeak <= 0.895,
    { powerPeak, powerPeakDb: db(powerPeak) }
  );
}

// Pure bass sine: POWER must not become fuzzy after settling.
{
  const n = sr * 5;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = 0.78 * Math.sin(2 * Math.PI * 60 * i / sr);
    L[i] = x;
    R[i] = x;
  }
  const out = render({ L, R }, "power");
  const start = sr;
  let sinDot = 0, cosDot = 0, sinSq = 0, cosSq = 0;
  for (let i = start; i < n; i += 1) {
    const a = 2 * Math.PI * 60 * i / sr;
    const s = Math.sin(a), c = Math.cos(a);
    sinDot += out.L[i] * s;
    cosDot += out.L[i] * c;
    sinSq += s * s;
    cosSq += c * c;
  }
  const A = sinDot / sinSq;
  const B = cosDot / cosSq;
  let signalSq = 0, residualSq = 0;
  for (let i = start; i < n; i += 1) {
    const a = 2 * Math.PI * 60 * i / sr;
    const fit = A * Math.sin(a) + B * Math.cos(a);
    const residual = out.L[i] - fit;
    signalSq += fit * fit;
    residualSq += residual * residual;
  }
  const residualDb = db(Math.sqrt(residualSq / (n - start)) / Math.sqrt(signalSq / (n - start)));
  check("POWER bass remains clean", residualDb < -35 && peak(out) <= 0.895, {
    residualDb,
    peak: peak(out),
  });
}

const failed = rows.filter((row) => !row.pass);
console.log(`\n${rows.length - failed.length}/${rows.length} PASS`);
if (failed.length) {
  console.error("FAILED:", failed.map((row) => row.name).join(", "));
  process.exit(1);
}
