import fs from "node:fs";
import vm from "node:vm";

const workletPath =
  process.argv[2] || "public/audioV2/mvpHdV2.worklet.js";
const wasmPath =
  process.argv[3] || "public/audioV2/mvpHdV2.wasm";

const code = fs.readFileSync(workletPath, "utf8");
const wasm = fs.readFileSync(wasmPath);

class Port {
  constructor() {
    this.onmessage = null;
    this.messages = [];
  }

  postMessage(message) {
    this.messages.push(message);
  }

  send(message) {
    this.onmessage?.({ data: message });
  }
}

class AudioWorkletProcessor {
  constructor() {
    this.port = new Port();
  }
}

let Proc = null;

const ctx = {
  AudioWorkletProcessor,
  registerProcessor: (name, ctor) => {
    if (name === "mvp-hd-v2-processor") Proc = ctor;
  },
  sampleRate: 48000,
  WebAssembly,
  Math,
  Float32Array,
  ArrayBuffer,
  Number,
  Boolean,
  String,
  JSON,
  Error,
  console,
};

vm.createContext(ctx);
vm.runInContext(code, ctx, {
  filename: "mvpHdV2.worklet.js",
});

if (!Proc) throw new Error("processor not registered");

const p = new Proc();
const ab = wasm.buffer.slice(
  wasm.byteOffset,
  wasm.byteOffset + wasm.byteLength,
);

p.port.send({
  type: "INIT_WASM",
  wasmBytes: ab,
});

for (let i = 0; i < 150 && !p.ready; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

if (!p.ready) {
  throw new Error(
    "not ready " + JSON.stringify(p.port.messages),
  );
}

const ready = p.port.messages.find(
  (message) => message.type === "READY",
);

if (!ready) throw new Error("missing READY");

if (Number(ready.engineBuildId) !== 6200) {
  throw new Error(
    "wrong engine build " + ready.engineBuildId,
  );
}

const state = {
  mode: "power",
  outputProfile: "headphones",
  intensity: 0.78,
  bassEnabled: true,
  bassCharacter: 0.6,
  impactEnabled: true,
  clarityEnabled: true,
  spatialEnabled: true,
  spaceMode: "studio",
  personalEnabled: true,
  personalBass: 0.4,
  personalPresence: 0.3,
  personalBrightness: 0.2,
  eqEnabled: true,
  eqGains: new Array(31)
    .fill(0)
    .map((value, index) => (index === 17 ? 4 : value)),
};

p.port.send({
  type: "SET_STATE",
  revision: 42,
  state,
});

const ack = p.port.messages.find(
  (message) =>
    message.type === "STATE_APPLIED" &&
    message.revision === 42,
);

if (!ack) throw new Error("missing native-state ACK");

if (Number(ack.engineBuildId) !== 6200) {
  throw new Error(
    "ACK came from wrong engine build " +
      ack.engineBuildId,
  );
}

const fields = [
  "mode",
  "outputProfile",
  "intensity",
  "bassEnabled",
  "bassCharacter",
  "impactEnabled",
  "clarityEnabled",
  "spatialEnabled",
  "spaceMode",
  "personalEnabled",
  "personalBass",
  "personalPresence",
  "personalBrightness",
  "eqEnabled",
];

for (const key of fields) {
  if (
    JSON.stringify(ack.appliedState[key]) !==
    JSON.stringify(state[key])
  ) {
    throw new Error(
      "ACK mismatch " +
        key +
        ": " +
        ack.appliedState[key] +
        " != " +
        state[key],
    );
  }
}

if (
  typeof ack.signature !== "string" ||
  ack.signature.length < 20
) {
  throw new Error("missing signature");
}

function makeInput() {
  const N = 128;
  const inputL = new Float32Array(N);
  const inputR = new Float32Array(N);

  for (let i = 0; i < N; i += 1) {
    const t = i / 48000;
    inputL[i] =
      0.25 * Math.sin(2 * Math.PI * 110 * t) +
      0.15 * Math.sin(2 * Math.PI * 3400 * t);
    inputR[i] =
      0.24 * Math.sin(2 * Math.PI * 110 * t + 0.1) +
      0.14 * Math.sin(2 * Math.PI * 3400 * t + 0.3);
  }

  return { inputL, inputR };
}

function block() {
  const { inputL, inputR } = makeInput();
  const outL = new Float32Array(128);
  const outR = new Float32Array(128);

  p.process([[inputL, inputR]], [[outL, outR]]);

  return {
    inputL,
    inputR,
    outL,
    outR,
  };
}

let b = block();
let diff = 0;

for (let i = 0; i < 128; i += 1) {
  diff += Math.abs(b.outL[i] - b.inputL[i]);
}

if (diff < 0.01) {
  throw new Error(
    "worklet output did not change",
  );
}

// Authoritative route proof: muting the processor must create complete digital
// silence and then recover.
p.port.send({
  type: "SET_PROOF_MUTE",
  enabled: true,
  requestId: 77,
});

const muteAck = [...p.port.messages]
  .reverse()
  .find(
    (message) =>
      message.type === "PROOF_MUTE_APPLIED" &&
      message.requestId === 77,
  );

if (!muteAck?.enabled) {
  throw new Error(
    "proof mute not acknowledged",
  );
}

if (Number(muteAck.engineBuildId) !== 6200) {
  throw new Error(
    "proof mute ACK came from wrong engine",
  );
}

b = block();

let mutedPeak = 0;

for (let i = 0; i < 128; i += 1) {
  mutedPeak = Math.max(
    mutedPeak,
    Math.abs(b.outL[i]),
    Math.abs(b.outR[i]),
  );
}

if (mutedPeak > 1e-9) {
  throw new Error(
    "proof mute leaked audio " + mutedPeak,
  );
}

p.port.send({
  type: "SET_PROOF_MUTE",
  enabled: false,
  requestId: 78,
});

b = block();

let recovered = 0;

for (let i = 0; i < 128; i += 1) {
  recovered = Math.max(
    recovered,
    Math.abs(b.outL[i]),
    Math.abs(b.outR[i]),
  );
}

if (recovered < 1e-4) {
  throw new Error(
    "route did not recover after proof mute",
  );
}

p.port.send({ type: "PING" });

const pong =
  p.port.messages.findLast?.(
    (message) => message.type === "PONG",
  ) ??
  [...p.port.messages]
    .reverse()
    .find((message) => message.type === "PONG");

if (
  !pong ||
  pong.signature !== ack.signature ||
  Number(pong.engineBuildId) !== 6200
) {
  throw new Error(
    "PING native-state proof mismatch",
  );
}

let checked = 1;

for (const outputProfile of [
  "car_hifi",
  "headphones",
  "speaker",
]) {
  for (const mode of [
    "pure",
    "adaptive",
    "power",
  ]) {
    for (let mask = 0; mask < 16; mask += 1) {
      const st = {
        ...state,
        outputProfile,
        mode,
        bassEnabled: Boolean(mask & 1),
        impactEnabled: Boolean(mask & 2),
        clarityEnabled: Boolean(mask & 4),
        spatialEnabled: Boolean(mask & 8),
        intensity: (mask % 5) / 4,
        spaceMode:
          mask % 3 === 2
            ? "arena"
            : mask % 3 === 1
              ? "live"
              : "studio",
      };

      const revision = 100 + checked;

      p.port.send({
        type: "SET_STATE",
        revision,
        state: st,
      });

      const stateAck = [...p.port.messages]
        .reverse()
        .find(
          (message) =>
            message.type === "STATE_APPLIED" &&
            message.revision === revision,
        );

      if (!stateAck) {
        throw new Error(
          "missing C++ route ACK " + revision,
        );
      }

      if (
        Number(stateAck.engineBuildId) !== 6200 ||
        stateAck.appliedState.mode !== st.mode ||
        stateAck.appliedState.outputProfile !==
          st.outputProfile ||
        stateAck.appliedState.bassEnabled !==
          st.bassEnabled ||
        stateAck.appliedState.impactEnabled !==
          st.impactEnabled ||
        stateAck.appliedState.clarityEnabled !==
          st.clarityEnabled ||
        stateAck.appliedState.spatialEnabled !==
          st.spatialEnabled
      ) {
        throw new Error(
          "native route ACK mismatch " + revision,
        );
      }

      checked += 1;
    }
  }
}

console.log(
  "V5.6 Worklet native-state + proof-mute route: " +
    checked +
    "/" +
    checked +
    " PASS",
);
console.log(
  "Engine build:",
  ready.engineBuildId,
);
console.log(
  "ACK signature:",
  ack.signature.slice(0, 80) + "...",
);
