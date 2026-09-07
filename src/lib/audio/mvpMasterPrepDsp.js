// MVP Trainer Pro R78f Master Prep DSP.
// Source gain is recovery-only. The r77i core owns all attenuation/headroom/protection.
// Technical source correction only. No limiter, compressor, spatializer or creative effect lives here.

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
}

function dbToGain(db) {
  return 10 ** (clamp(db, -24, 12) / 20);
}

class Biquad {
  constructor(sampleRate) {
    this.sampleRate = Math.max(8000, Number(sampleRate) || 48000);
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.z1 = 0;
    this.z2 = 0;
  }

  reset() {
    this.z1 = 0;
    this.z2 = 0;
  }

  setNormalized(b0, b1, b2, a0, a1, a2) {
    const inv = Math.abs(a0) > 1e-12 ? 1 / a0 : 1;
    this.b0 = b0 * inv;
    this.b1 = b1 * inv;
    this.b2 = b2 * inv;
    this.a1 = a1 * inv;
    this.a2 = a2 * inv;
  }

  setHighpass(frequency, q = 0.70710678) {
    const hz = clamp(frequency, 8, Math.min(180, this.sampleRate * 0.22));
    const omega = 2 * Math.PI * hz / this.sampleRate;
    const cos = Math.cos(omega);
    const sin = Math.sin(omega);
    const alpha = sin / (2 * Math.max(0.15, q));
    this.setNormalized((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
  }

  setPeak(frequency, gainDb, q = 0.9) {
    const hz = clamp(frequency, 20, this.sampleRate * 0.45);
    const gain = clamp(gainDb, -4, 4);
    if (Math.abs(gain) < 0.001) {
      this.setNormalized(1, 0, 0, 1, 0, 0);
      return;
    }
    const A = 10 ** (gain / 40);
    const omega = 2 * Math.PI * hz / this.sampleRate;
    const cos = Math.cos(omega);
    const sin = Math.sin(omega);
    const alpha = sin / (2 * Math.max(0.15, q));
    this.setNormalized(
      1 + alpha * A,
      -2 * cos,
      1 - alpha * A,
      1 + alpha / A,
      -2 * cos,
      1 - alpha / A,
    );
  }

  process(sample) {
    const x = Number.isFinite(sample) ? sample : 0;
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return Number.isFinite(y) ? y : 0;
  }
}

export const MVP_MASTER_PREP_NEUTRAL = Object.freeze({
  enabled: false,
  sourceGainDb: 0,
  highpassHz: 18,
  lowMidDb: 0,
  presenceDb: 0,
  harshnessDb: 0,
  channelBalanceDb: 0,
  widthScale: 1,
  reasons: [],
});

export class MvpMasterPrepProcessor {
  constructor(sampleRate) {
    this.sampleRate = Math.max(8000, Number(sampleRate) || 48000);
    this.hpL = new Biquad(this.sampleRate);
    this.hpR = new Biquad(this.sampleRate);
    this.lowMidL = new Biquad(this.sampleRate);
    this.lowMidR = new Biquad(this.sampleRate);
    this.presenceL = new Biquad(this.sampleRate);
    this.presenceR = new Biquad(this.sampleRate);
    this.harshL = new Biquad(this.sampleRate);
    this.harshR = new Biquad(this.sampleRate);
    this.profile = { ...MVP_MASTER_PREP_NEUTRAL };
    this.sourceGain = 1;
    this.leftGain = 1;
    this.rightGain = 1;
    this.widthScale = 1;
    this.update(this.profile);
  }

  update(profile) {
    const next = profile && typeof profile === "object" ? profile : MVP_MASTER_PREP_NEUTRAL;
    this.profile = {
      enabled: Boolean(next.enabled),
      sourceGainDb: clamp(next.sourceGainDb, 0, 1.5),
      highpassHz: clamp(next.highpassHz, 16, 32),
      lowMidDb: clamp(next.lowMidDb, -1.5, 0.6),
      presenceDb: clamp(next.presenceDb, -0.7, 0.7),
      harshnessDb: clamp(next.harshnessDb, -1.5, 0.3),
      channelBalanceDb: clamp(next.channelBalanceDb, -0.8, 0.8),
      widthScale: clamp(next.widthScale, 0.86, 1.02),
      reasons: Array.isArray(next.reasons) ? next.reasons.slice(0, 8) : [],
    };
    this.sourceGain = dbToGain(this.profile.sourceGainDb);
    const balance = this.profile.channelBalanceDb;
    this.leftGain = balance > 0 ? dbToGain(-balance) : 1;
    this.rightGain = balance < 0 ? dbToGain(balance) : 1;
    this.widthScale = this.profile.widthScale;
    this.hpL.setHighpass(this.profile.highpassHz);
    this.hpR.setHighpass(this.profile.highpassHz);
    this.lowMidL.setPeak(310, this.profile.lowMidDb, 0.85);
    this.lowMidR.setPeak(310, this.profile.lowMidDb, 0.85);
    this.presenceL.setPeak(2800, this.profile.presenceDb, 0.9);
    this.presenceR.setPeak(2800, this.profile.presenceDb, 0.9);
    this.harshL.setPeak(6500, this.profile.harshnessDb, 1.05);
    this.harshR.setPeak(6500, this.profile.harshnessDb, 1.05);
  }

  reset() {
    this.hpL.reset();
    this.hpR.reset();
    this.lowMidL.reset();
    this.lowMidR.reset();
    this.presenceL.reset();
    this.presenceR.reset();
    this.harshL.reset();
    this.harshR.reset();
  }

  processInto(inputL, inputR, outputL, outputR, frames) {
    if (!this.profile.enabled) {
      outputL.set(inputL.subarray(0, frames), 0);
      outputR.set((inputR || inputL).subarray(0, frames), 0);
      return;
    }
    const right = inputR || inputL;
    const sourceGain = this.sourceGain;
    const leftGain = this.leftGain;
    const rightGain = this.rightGain;
    const width = this.widthScale;
    for (let i = 0; i < frames; i += 1) {
      let l = this.hpL.process(inputL[i]);
      let r = this.hpR.process(right[i]);
      l = this.lowMidL.process(l);
      r = this.lowMidR.process(r);
      l = this.presenceL.process(l);
      r = this.presenceR.process(r);
      l = this.harshL.process(l);
      r = this.harshR.process(r);
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5 * width;
      outputL[i] = (mid + side) * leftGain * sourceGain;
      outputR[i] = (mid - side) * rightGain * sourceGain;
    }
  }
}
