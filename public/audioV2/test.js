const audio = document.querySelector('#audio');
const fileInput = document.querySelector('#file');
const initButton = document.querySelector('#init');
const autoProofButton = document.querySelector('#autoProof');
const proofMuteButton = document.querySelector('#proofMute');
const continuityButton = document.querySelector('#continuity');
const modeButtons = [...document.querySelectorAll('[data-mode]')];
const effectButtons = [...document.querySelectorAll('[data-effect]')];
const logEl = document.querySelector('#log');

const inputRmsEl = document.querySelector('#inputRms');
const outputRmsEl = document.querySelector('#outputRms');
const deltaEl = document.querySelector('#delta');
const outputPeakEl = document.querySelector('#outputPeak');
const tpEl = document.querySelector('#tp');
const grEl = document.querySelector('#gr');
const clipsEl = document.querySelector('#clips');
const nansEl = document.querySelector('#nans');
const stateEl = document.querySelector('#state');
const revisionEl = document.querySelector('#revision');

let objectUrl = '';
let context = null;
let source = null;
let node = null;
let ready = false;
let revision = 0;
let proofMute = false;
let currentMode = 'direct';
let lastTelemetry = null;

const state = {
  bypass: true,
  loudnessMode: 'normal',
  bass: 0,
  clarity: 0,
  punch: 0,
  wide: 0,
  eqEnabled: false,
  eqGains: new Array(31).fill(0),
};

function db(value) {
  if (!Number.isFinite(value) || value <= 0) return '-120.0 dB';
  return `${(20 * Math.log10(value)).toFixed(2)} dB`;
}

function log(message) {
  const stamp = new Date().toLocaleTimeString();
  logEl.textContent = `[${stamp}] ${message}\n${logEl.textContent}`.slice(0, 9000);
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function sendState() {
  if (!node || !ready) return;
  revision += 1;
  node.port.postMessage({
    type: 'SET_STATE',
    revision,
    state: { ...state, eqGains: [...state.eqGains] },
  });
}

function setEffectAvailability() {
  const direct = currentMode === 'direct';
  for (const button of effectButtons) button.disabled = direct;
}

function selectMode(mode) {
  currentMode = mode;
  state.bypass = mode === 'direct';
  state.loudnessMode =
    mode === 'max' ? 'max' :
    mode === 'loud' ? 'loud' : 'normal';

  for (const button of modeButtons) {
    button.classList.toggle('active', button.dataset.mode === mode);
  }

  setEffectAvailability();
  sendState();
}

function setProofMute(enabled) {
  proofMute = Boolean(enabled);
  proofMuteButton.classList.toggle('active', proofMute);
  proofMuteButton.textContent = proofMute ? 'PROOF MUTE • ON' : 'PROOF MUTE';
  if (node && ready) {
    node.port.postMessage({ type: 'SET_PROOF_MUTE', enabled: proofMute });
  }
}

function appliedStateText(applied) {
  if (!applied) return '--';
  return [
    applied.bypass ? 'DIRECT' : String(applied.loudnessMode || 'normal').toUpperCase(),
    `B${Number(applied.bass || 0).toFixed(1)}`,
    `C${Number(applied.clarity || 0).toFixed(1)}`,
    `P${Number(applied.punch || 0).toFixed(1)}`,
    `W${Number(applied.wide || 0).toFixed(1)}`,
  ].join(' ');
}

function updateTelemetry(message) {
  lastTelemetry = message;
  inputRmsEl.textContent = db(Number(message.inputRms));
  outputRmsEl.textContent = db(Number(message.outputRms));
  deltaEl.textContent = `${Number(message.rmsDeltaDb).toFixed(2)} dB`;
  outputPeakEl.textContent = db(Number(message.outputPeak));
  tpEl.textContent = `${Number(message.truePeakDbtp).toFixed(2)} dBTP`;
  grEl.textContent = `${Number(message.limiterGrDbMaxSinceInit).toFixed(2)} dB`;
  clipsEl.textContent = String(message.clipCount);
  nansEl.textContent = String(message.nanCount);
  revisionEl.textContent = String(message.revision);
  stateEl.textContent = `${appliedStateText(message.state)}${message.proofMute ? ' MUTED' : ''}`;
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  audio.src = objectUrl;
  log(`Loaded local file: ${file.name}`);
});

initButton.addEventListener('click', async () => {
  try {
    if (ready) {
      if (context && context.state === 'suspended') await context.resume();
      log('V2 is already initialized.');
      return;
    }
    if (!audio.src) throw new Error('Choose a local audio file first.');

    context = new AudioContext({ latencyHint: 'playback' });
    await context.audioWorklet.addModule('/audioV2/mvpHdV2.worklet.js?v=2.0.0-stage2-r3');

    const wasmResponse = await fetch('/audioV2/mvpHdV2.wasm?v=2.0.0-stage2-r3', { cache: 'no-store' });
    if (!wasmResponse.ok) throw new Error(`WASM load failed (${wasmResponse.status})`);
    const wasmBytes = await wasmResponse.arrayBuffer();

    source = context.createMediaElementSource(audio);
    node = new AudioWorkletNode(context, 'mvp-hd-v2-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });

    source.connect(node);
    node.connect(context.destination);

    const readyPromise = new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Worklet init timeout')), 8000);

      node.port.onmessage = (event) => {
        const message = event.data || {};

        if (message.type === 'READY') {
          window.clearTimeout(timeout);
          ready = true;
          node.port.postMessage({ type: 'SET_TELEMETRY', enabled: true });
          sendState();
          log(`V2 READY • ${message.sampleRate} Hz • ${message.build || 'unknown build'}`);
          resolve();
          return;
        }

        if (message.type === 'STATE_APPLIED') {
          revisionEl.textContent = String(message.revision);
          stateEl.textContent = appliedStateText(message.state);
          return;
        }

        if (message.type === 'PROOF_MUTE_APPLIED') {
          log(`Worklet proof mute applied=${message.enabled}`);
          return;
        }

        if (message.type === 'TELEMETRY') {
          updateTelemetry(message);
          return;
        }

        if (message.type === 'ERROR') {
          window.clearTimeout(timeout);
          reject(new Error(message.message || 'V2 Worklet error'));
        }
      };
    });

    node.port.postMessage({ type: 'INIT_WASM', wasmBytes }, [wasmBytes]);
    await readyPromise;
    await context.resume();
    initButton.textContent = 'V2 READY';
  } catch (error) {
    log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
});

for (const button of modeButtons) {
  button.addEventListener('click', () => selectMode(button.dataset.mode || 'direct'));
}

for (const button of effectButtons) {
  button.addEventListener('click', () => {
    const effect = button.dataset.effect;
    if (!effect || !(effect in state) || currentMode === 'direct') return;

    const next = state[effect] > 0 ? 0 : 1;
    state[effect] = next;
    button.classList.toggle('active', next > 0);
    sendState();
  });
}

proofMuteButton.addEventListener('click', () => {
  if (!ready) {
    log('Initialize V2 before using PROOF MUTE.');
    return;
  }
  setProofMute(!proofMute);
});

async function captureStep(mode, waitMs = 1400) {
  selectMode(mode);
  await sleep(waitMs);
  const t = lastTelemetry;
  if (!t) return `${mode.toUpperCase()}: no telemetry`;
  return `${mode.toUpperCase()}: Out/In ${Number(t.rmsDeltaDb).toFixed(2)} dB • ${appliedStateText(t.state)}`;
}

autoProofButton.addEventListener('click', async () => {
  try {
    if (!ready || !node || !context) throw new Error('Initialize V2 first.');
    if (audio.paused) await audio.play();

    setProofMute(false);

    const results = [];
    results.push(await captureStep('direct'));
    results.push(await captureStep('normal'));
    results.push(await captureStep('loud', 1800));
    results.push(await captureStep('max', 1800));

    setProofMute(true);
    await sleep(700);
    const muted = lastTelemetry;
    const mutedRms = muted ? Number(muted.outputRms) : NaN;
    const mutePass = Number.isFinite(mutedRms) && mutedRms < 0.000001;

    setProofMute(false);
    await sleep(300);
    selectMode('direct');

    log(
      `AUDIO PROOF ${mutePass ? 'ROUTE PASS' : 'ROUTE FAIL'}\n` +
      `${results.join('\n')}\n` +
      `PROOF MUTE output=${Number.isFinite(mutedRms) ? db(mutedRms) : 'no telemetry'} ` +
      `${mutePass ? '(Worklet is audible route)' : '(Worklet route not proven)'}`,
    );
  } catch (error) {
    log(`Audio proof ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
});

continuityButton.addEventListener('click', async () => {
  try {
    if (!ready || !node || !context) throw new Error('Initialize V2 first.');
    if (audio.paused) await audio.play();

    const originalElement = audio;
    const originalSrc = audio.currentSrc || audio.src;
    const startTime = audio.currentTime;
    const startContext = context;
    const wasPaused = audio.paused;

    for (const mode of ['direct','normal','loud','max','loud','normal','direct']) {
      selectMode(mode);
      await sleep(350);
    }

    const endTime = audio.currentTime;
    const identityOk = audio === originalElement;
    const srcOk = (audio.currentSrc || audio.src) === originalSrc;
    const contextOk = context === startContext && context.state !== 'closed';
    const timeAdvanced = endTime > startTime + 1;
    const playbackOk = !wasPaused ? !audio.paused : true;
    const pass = identityOk && srcOk && contextOk && timeAdvanced && playbackOk;

    log(
      `${pass ? 'PASS' : 'FAIL'} continuity • sameElement=${identityOk} sameSrc=${srcOk} ` +
      `sameContext=${contextOk} timeAdvanced=${timeAdvanced} paused=${audio.paused} ` +
      `${startTime.toFixed(3)}s→${endTime.toFixed(3)}s`,
    );
  } catch (error) {
    log(`Continuity test ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
});

setEffectAvailability();

window.addEventListener('beforeunload', () => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});
