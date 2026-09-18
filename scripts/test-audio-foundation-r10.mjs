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
  Float64Array,
  Math,
  Object,
}, { filename: workletPath });

if (!Processor) throw new Error("Worklet did not register.");

const sr = 48000;
const skip = Math.floor(sr * 0.5);
const TP_TAPS = [
  [0.0000000000,0.0006967276,-0.0036114518,0.0106894409,-0.0243920034,0.0473988787,-0.0853522687,0.1749621972,0.9271834644,-0.0558089374,0.0065336228,0.0051465217,-0.0059139618,0.0036139880,-0.0014253083,0.0002466871],
  [-0.0000259944,0.0009306425,-0.0045142792,0.0140661965,-0.0349789143,0.0763806998,-0.1630375417,0.4750888740,0.7567609472,-0.1677299103,0.0663150886,-0.0261387989,0.0088488163,-0.0022472932,0.0003169478,-0.0000030777],
  [-0.0000030777,0.0003169478,-0.0022472932,0.0088488163,-0.0261387989,0.0663150886,-0.1677299103,0.7567609472,0.4750888740,-0.1630375417,0.0763806998,-0.0349789143,0.0140661965,-0.0045142792,0.0009306425,-0.0000259944],
  [0.0002466871,-0.0014253083,0.0036139880,-0.0059139618,0.0051465217,0.0065336228,-0.0558089374,0.9271834644,0.1749621972,-0.0853522687,0.0473988787,-0.0243920034,0.0106894409,-0.0036114518,0.0006967276,0.0000000000],
];

function signal(type = "dynamic", seconds = 3) {
  const n = sr * seconds;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let seed = 0x1234abcd;
  const noise = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0xffffffff * 2 - 1;
  };

  for (let i = 0; i < n; i += 1) {
    const t = i / sr;
    const beat = t % 0.5;
    let env = 1;
    if (type === "dynamic") env = 0.43 + (beat < 0.032 ? 0.82 * Math.exp(-beat * 70) : 0);
    else if (type === "hot") env = 0.86;
    else if (type === "brick") env = 1.12;
    else if (type === "quiet") env = 0.28;

    let x =
      0.32 * Math.sin(2 * Math.PI * 52 * t) +
      0.23 * Math.sin(2 * Math.PI * 108 * t) +
      0.16 * Math.sin(2 * Math.PI * 220 * t) +
      0.15 * Math.sin(2 * Math.PI * 950 * t) +
      0.11 * Math.sin(2 * Math.PI * 3400 * t) +
      0.065 * Math.sin(2 * Math.PI * 9000 * t) +
      0.035 * noise();

    let y =
      0.30 * Math.sin(2 * Math.PI * 52 * t + 0.03) +
      0.21 * Math.sin(2 * Math.PI * 108 * t + 0.10) +
      0.15 * Math.sin(2 * Math.PI * 220 * t + 0.07) +
      0.14 * Math.sin(2 * Math.PI * 950 * t + 0.15) +
      0.10 * Math.sin(2 * Math.PI * 3400 * t + 0.40) +
      0.060 * Math.sin(2 * Math.PI * 9000 * t + 0.70) +
      0.035 * noise();

    x *= env;
    y *= env;

    if (type === "brick") {
      x = Math.max(-0.93, Math.min(0.93, x * 1.55));
      y = Math.max(-0.93, Math.min(0.93, y * 1.55));
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
    const size = Math.min(block, sig.L.length - off);
    const inL = new Float32Array(block);
    const inR = new Float32Array(block);
    inL.set(sig.L.subarray(off, off + size));
    inR.set(sig.R.subarray(off, off + size));
    const blockL = new Float32Array(block);
    const blockR = new Float32Array(block);
    p.process([[inL, inR]], [[blockL, blockR]]);
    outL.set(blockL.subarray(0, size), off);
    outR.set(blockR.subarray(0, size), off);
  }

  return {
    L: outL,
    R: outR,
    limiterMaxReductionDb: Number(p.limiterMaxReductionDb || 0),
  };
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

function peak(o) {
  let value = 0;
  for (let i = skip; i < o.L.length; i += 1) {
    value = Math.max(value, Math.abs(o.L[i]), Math.abs(o.R[i]));
  }
  return value;
}

function db(value) {
  return 20 * Math.log10(Math.max(1e-12, value));
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

function truePeakChannel(values) {
  const hist = new Float64Array(16);
  let maximum = 0;
  for (let i = skip; i < values.length; i += 1) {
    for (let k = hist.length - 1; k > 0; k -= 1) hist[k] = hist[k - 1];
    hist[0] = values[i];
    maximum = Math.max(maximum, Math.abs(values[i]));
    for (const phase of TP_TAPS) {
      let y = 0;
      for (let k = 0; k < phase.length; k += 1) y += hist[k] * phase[k];
      maximum = Math.max(maximum, Math.abs(y));
    }
  }
  return maximum;
}

function truePeak(o) {
  return Math.max(truePeakChannel(o.L), truePeakChannel(o.R));
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
  rows.push({ name, pass: Boolean(pass), data });
  console.log(pass ? "PASS" : "FAIL", name, data);
}

for (const type of ["dynamic", "hot", "brick", "quiet"]) {
  const sig = signal(type);
  const pure = render(sig, "pure");
  const adaptive = render(sig, "adaptive");
  const power = render(sig, "power");

  if (type === "dynamic") {
    const error = maxError(pure, sig);
    check("PURE sample-identical", error < 1e-7, { maxError: error });
  }

  const adaptiveVsPure = db(rms(adaptive) / rms(pure));
  const powerVsPure = db(rms(power) / rms(pure));
  const powerVsAdaptive = db(rms(power) / rms(adaptive));

  const bassPure = mag(pure, 52) + mag(pure, 108);
  const bassAdaptive = mag(adaptive, 52) + mag(adaptive, 108);
  const bassPower = mag(power, 52) + mag(power, 108);
  const bodyPure = mag(pure, 220);
  const bodyAdaptive = mag(adaptive, 220);
  const bodyPower = mag(power, 220);
  const midPure = mag(pure, 950);
  const midAdaptive = mag(adaptive, 950);
  const midPower = mag(power, 950);
  const presencePure = mag(pure, 3400);
  const presencePower = mag(power, 3400);
  const airPure = mag(pure, 9000);
  const airPower = mag(power, 9000);

  const spectral = {
    bassVsPure: db(bassPower / Math.max(1e-12, bassPure)),
    bodyVsPure: db(bodyPower / Math.max(1e-12, bodyPure)),
    midVsPure: db(midPower / Math.max(1e-12, midPure)),
    presenceVsPure: db(presencePower / Math.max(1e-12, presencePure)),
    airVsPure: db(airPower / Math.max(1e-12, airPure)),
    bassVsAdaptive: db(bassPower / Math.max(1e-12, bassAdaptive)),
    bodyVsAdaptive: db(bodyPower / Math.max(1e-12, bodyAdaptive)),
    midVsAdaptive: db(midPower / Math.max(1e-12, midAdaptive)),
  };

  const samplePeak = peak(power);
  const measuredTruePeak = truePeak(power);

  if (type === "dynamic") {
    check("dynamic ADAPTIVE obvious", adaptiveVsPure > 2.5, { adaptiveVsPure });
    check("dynamic POWER extreme step", powerVsAdaptive > 2.0 && powerVsPure > 5.5, {
      powerVsAdaptive, powerVsPure,
    });
    check("dynamic POWER full-spectrum body", 
      spectral.bassVsPure > 5 &&
      spectral.bodyVsPure > 4.5 &&
      spectral.midVsPure > 4 &&
      spectral.presenceVsPure > 3 &&
      spectral.airVsPure > 2,
      spectral
    );
  } else if (type === "hot") {
    check("hot ADAPTIVE still increases", adaptiveVsPure > 0.5, { adaptiveVsPure });
    check("hot POWER remains distinct", powerVsAdaptive > 0.8 && powerVsPure > 1.5, {
      powerVsAdaptive, powerVsPure,
    });
    check("hot POWER stays full not tinny",
      spectral.bassVsPure > 1.5 &&
      spectral.bodyVsPure > 1.0 &&
      spectral.midVsPure > 0.5 &&
      spectral.presenceVsPure > -0.5 &&
      spectral.airVsPure > -1.2 &&
      spectral.bassVsPure > spectral.presenceVsPure + 1.0,
      spectral
    );
  } else if (type === "brick") {
    // This source is deliberately hard-clipped before the engine. A clean
    // true-peak limiter must reduce absolute level to restore headroom.
    check("brick POWER remains stronger than ADAPTIVE", 
      powerVsAdaptive > 0.4 &&
      spectral.bassVsAdaptive > 0.4 &&
      spectral.bodyVsAdaptive > 0.3 &&
      spectral.midVsAdaptive > -0.1,
      { powerVsAdaptive, ...spectral }
    );
    check("brick true-peak repair does not collapse program", powerVsPure > -3.5, {
      powerVsPure,
    });
  } else {
    check("quiet ADAPTIVE raises low-level material", adaptiveVsPure > 3.0, { adaptiveVsPure });
    check("quiet POWER reaches extreme loudness step", powerVsAdaptive > 4.0 && powerVsPure > 9.0, {
      powerVsAdaptive, powerVsPure,
    });
  }

  check(`${type} safety`, 
    finite(adaptive) &&
    finite(power) &&
    samplePeak <= 0.905 &&
    measuredTruePeak <= 0.965 &&
    power.limiterMaxReductionDb < 10.5,
    {
      samplePeak,
      samplePeakDb: db(samplePeak),
      truePeak: measuredTruePeak,
      truePeakDb: db(measuredTruePeak),
      limiterMaxReductionDb: power.limiterMaxReductionDb,
    }
  );
}

// A pure 60 Hz sine is used to catch fuzz/nonlinear breakup in POWER.
{
  const n = sr * 3;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const value = 0.72 * Math.sin(2 * Math.PI * 60 * i / sr);
    L[i] = value;
    R[i] = value;
  }

  const out = render({ L, R }, "power");
  let sinDot = 0;
  let cosDot = 0;
  let sinSq = 0;
  let cosSq = 0;

  for (let i = skip; i < n; i += 1) {
    const a = 2 * Math.PI * 60 * i / sr;
    const s = Math.sin(a);
    const c = Math.cos(a);
    sinDot += out.L[i] * s;
    cosDot += out.L[i] * c;
    sinSq += s * s;
    cosSq += c * c;
  }

  const A = sinDot / Math.max(1e-12, sinSq);
  const B = cosDot / Math.max(1e-12, cosSq);
  let signalSq = 0;
  let residualSq = 0;

  for (let i = skip; i < n; i += 1) {
    const a = 2 * Math.PI * 60 * i / sr;
    const fitted = A * Math.sin(a) + B * Math.cos(a);
    const residual = out.L[i] - fitted;
    signalSq += fitted * fitted;
    residualSq += residual * residual;
  }

  const residualDb = db(
    Math.sqrt(residualSq / Math.max(1, n - skip)) /
    Math.max(1e-12, Math.sqrt(signalSq / Math.max(1, n - skip)))
  );

  check("POWER 60 Hz bass clean", 
    residualDb < -40 &&
    peak(out) <= 0.905 &&
    truePeak(out) <= 0.965 &&
    finite(out),
    {
      residualDb,
      samplePeak: peak(out),
      truePeak: truePeak(out),
      limiterMaxReductionDb: out.limiterMaxReductionDb,
    }
  );
}

const failed = rows.filter((row) => !row.pass);
console.log(`\n${rows.length - failed.length}/${rows.length} PASS`);
if (failed.length) {
  console.error("FAILED:", failed.map((row) => row.name).join(", "));
  process.exit(1);
}
