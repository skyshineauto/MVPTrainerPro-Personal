// MVP Trainer Pro HD V2 - clean standalone real-time DSP core.
// No heap allocation, no locks, no I/O in mvp_v2_process().

extern "C" double sin(double) __attribute__((import_module("env"), import_name("sin")));
extern "C" double cos(double) __attribute__((import_module("env"), import_name("cos")));
extern "C" double pow(double, double) __attribute__((import_module("env"), import_name("pow")));
extern "C" double exp(double) __attribute__((import_module("env"), import_name("exp")));
extern "C" double log10(double) __attribute__((import_module("env"), import_name("log10")));

extern "C" void* memset(void* dest, int value, unsigned long count) __attribute__((optnone));
extern "C" void* memset(void* dest, int value, unsigned long count) {
  unsigned char* p = static_cast<unsigned char*>(dest);
  for (unsigned long i = 0; i < count; ++i) p[i] = static_cast<unsigned char>(value);
  return dest;
}
extern "C" void* memcpy(void* dest, const void* src, unsigned long count) __attribute__((optnone));
extern "C" void* memcpy(void* dest, const void* src, unsigned long count) {
  unsigned char* d = static_cast<unsigned char*>(dest);
  const unsigned char* s = static_cast<const unsigned char*>(src);
  for (unsigned long i = 0; i < count; ++i) d[i] = s[i];
  return dest;
}

namespace {
constexpr int kFrames = 128;
constexpr int kEqBands = 31;
constexpr int kLookaheadMax = 256;   // > 2 ms at 96 kHz.
constexpr int kWideDelayMax = 2048;  // > 15 ms at 96 kHz.
constexpr double kPi = 3.1415926535897932384626433832795;

inline float absf(float v) { return v < 0.0f ? -v : v; }
inline float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline double clampd(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline float dbToGain(float db) { return static_cast<float>(pow(10.0, static_cast<double>(db) / 20.0)); }
inline float gainToDb(float gain) { return gain > 0.0000001f ? static_cast<float>(20.0 * log10(gain)) : -120.0f; }

const double kEqFrequencies[kEqBands] = {
  20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0,
  200.0, 250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0,
  1600.0, 2000.0, 2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0,
  10000.0, 12500.0, 16000.0, 20000.0
};

struct Biquad {
  double b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0;
  double z1 = 0.0, z2 = 0.0;

  inline float process(float input) {
    const double x = static_cast<double>(input);
    const double y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return static_cast<float>(y);
  }
  void reset() { z1 = z2 = 0.0; }
  void identity() { b0 = 1.0; b1 = b2 = a1 = a2 = 0.0; }

  void peaking(double sr, double freq, double q, double gainDb) {
    const double f = clampd(freq, 10.0, sr * 0.475);
    if (gainDb > -0.00001 && gainDb < 0.00001) { identity(); return; }
    const double A = pow(10.0, gainDb / 40.0);
    const double w0 = 2.0 * kPi * f / sr;
    const double cw = cos(w0), sw = sin(w0);
    const double alpha = sw / (2.0 * q);
    const double a0 = 1.0 + alpha / A;
    b0 = (1.0 + alpha * A) / a0;
    b1 = (-2.0 * cw) / a0;
    b2 = (1.0 - alpha * A) / a0;
    a1 = (-2.0 * cw) / a0;
    a2 = (1.0 - alpha / A) / a0;
  }

  void lowpass(double sr, double freq, double q = 0.7071067811865476) {
    const double f = clampd(freq, 10.0, sr * 0.475);
    const double w0 = 2.0 * kPi * f / sr;
    const double cw = cos(w0), sw = sin(w0);
    const double alpha = sw / (2.0 * q);
    const double a0 = 1.0 + alpha;
    b0 = ((1.0 - cw) * 0.5) / a0;
    b1 = (1.0 - cw) / a0;
    b2 = ((1.0 - cw) * 0.5) / a0;
    a1 = (-2.0 * cw) / a0;
    a2 = (1.0 - alpha) / a0;
  }

  void highpass(double sr, double freq, double q = 0.7071067811865476) {
    const double f = clampd(freq, 10.0, sr * 0.475);
    const double w0 = 2.0 * kPi * f / sr;
    const double cw = cos(w0), sw = sin(w0);
    const double alpha = sw / (2.0 * q);
    const double a0 = 1.0 + alpha;
    b0 = ((1.0 + cw) * 0.5) / a0;
    b1 = (-(1.0 + cw)) / a0;
    b2 = ((1.0 + cw) * 0.5) / a0;
    a1 = (-2.0 * cw) / a0;
    a2 = (1.0 - alpha) / a0;
  }
};

alignas(16) float gInputL[kFrames] = {};
alignas(16) float gInputR[kFrames] = {};
alignas(16) float gOutputL[kFrames] = {};
alignas(16) float gOutputR[kFrames] = {};

float gSampleRate = 48000.0f;
int gBypass = 1;
int gLoudnessMode = 0; // 0 normal, 1 loud, 2 max.
int gEqEnabled = 0;
float gEqGainDb[kEqBands] = {};
Biquad gEqL[kEqBands];
Biquad gEqR[kEqBands];

float gBassTarget = 0.0f, gBassCurrent = 0.0f;
float gClarityTarget = 0.0f, gClarityCurrent = 0.0f;
float gPunchTarget = 0.0f, gPunchCurrent = 0.0f;
float gWideTarget = 0.0f, gWideCurrent = 0.0f;
float gSmoothCoeff = 0.001f;

Biquad gBassLpL, gBassLpR;
Biquad gClarityHpL, gClarityHpR;
Biquad gWideLpL, gWideLpR;
float gPunchFast = 0.0f, gPunchSlow = 0.0f;
float gPunchFastAttack = 0.0f, gPunchFastRelease = 0.0f;
float gPunchSlowAttack = 0.0f, gPunchSlowRelease = 0.0f;

float gWideDelay[kWideDelayMax] = {};
int gWideDelaySamples = 720;
int gWideIndex = 0;

float gLookL[kLookaheadMax] = {};
float gLookR[kLookaheadMax] = {};
float gLookPeak[kLookaheadMax] = {};
int gLookaheadSamples = 96;
int gLookIndex = 0;
float gLimiterGain = 1.0f;
float gLimiterReleaseCoeff = 0.00025f;
const float gLimiterCeiling = 0.9500f; // conservative margin for reconstructed peaks (~ -0.35 dBFS).

float gMasterEnv = 0.0f;
float gMasterAttackCoeff = 0.02f;
float gMasterReleaseCoeff = 0.0005f;
float gMasterDriveCurrent = 1.0f;
float gMasterDriveTarget = 1.0f;

float gTpHistL[3] = {};
float gTpHistR[3] = {};
float gOutTpHistL[3] = {};
float gOutTpHistR[3] = {};
float gMeterTruePeak = 0.0f;
float gMeterLimiterGrDb = 0.0f;
unsigned int gMeterClipCount = 0;
unsigned int gMeterNanCount = 0;

inline float cubic(float p0, float p1, float p2, float p3, float t) {
  const float a0 = -0.5f*p0 + 1.5f*p1 - 1.5f*p2 + 0.5f*p3;
  const float a1 = p0 - 2.5f*p1 + 2.0f*p2 - 0.5f*p3;
  const float a2 = -0.5f*p0 + 0.5f*p2;
  return ((a0*t + a1)*t + a2)*t + p1;
}

inline float reconstructedPeak4x(float *h, float x) {
  const float p0 = h[0], p1 = h[1], p2 = h[2], p3 = x;
  float peak = absf(p1);
  const float a = absf(cubic(p0, p1, p2, p3, 0.25f)); if (a > peak) peak = a;
  const float b = absf(cubic(p0, p1, p2, p3, 0.50f)); if (b > peak) peak = b;
  const float c = absf(cubic(p0, p1, p2, p3, 0.75f)); if (c > peak) peak = c;
  const float d = absf(p2); if (d > peak) peak = d;
  h[0] = h[1]; h[1] = h[2]; h[2] = x;
  return peak;
}

void configureEqBand(int band) {
  if (band < 0 || band >= kEqBands) return;
  gEqL[band].peaking(gSampleRate, kEqFrequencies[band], 4.318473046963146, gEqGainDb[band]);
  gEqR[band].peaking(gSampleRate, kEqFrequencies[band], 4.318473046963146, gEqGainDb[band]);
}

void resetState() {
  for (int i = 0; i < kEqBands; ++i) { gEqL[i].reset(); gEqR[i].reset(); }
  gBassLpL.reset(); gBassLpR.reset();
  gClarityHpL.reset(); gClarityHpR.reset();
  gWideLpL.reset(); gWideLpR.reset();
  for (int i = 0; i < kWideDelayMax; ++i) gWideDelay[i] = 0.0f;
  for (int i = 0; i < kLookaheadMax; ++i) { gLookL[i] = 0.0f; gLookR[i] = 0.0f; gLookPeak[i] = 0.0f; }
  gWideIndex = 0; gLookIndex = 0;
  gPunchFast = gPunchSlow = 0.0f;
  gLimiterGain = 1.0f;
  gMasterEnv = 0.0f;
  gMasterDriveCurrent = gMasterDriveTarget;
  for (int i = 0; i < 3; ++i) { gTpHistL[i]=gTpHistR[i]=gOutTpHistL[i]=gOutTpHistR[i]=0.0f; }
  gMeterTruePeak = 0.0f;
  gMeterLimiterGrDb = 0.0f;
  gMeterClipCount = 0;
  gMeterNanCount = 0;
}

inline float softBassHarmonics(float low, float amount) {
  const float drive = 1.0f + 1.8f * amount;
  const float x = clampf(low * drive, -1.2f, 1.2f);
  const float shaped = x - (x*x*x) * 0.18f;
  return (shaped / drive) - low;
}

inline void applyMastering(float &l, float &r) {
  if (gLoudnessMode == 0) {
    gMasterDriveTarget = 1.0f;
    gMasterDriveCurrent += (1.0f - gMasterDriveCurrent) * gSmoothCoeff;
    return;
  }
  const bool maxMode = gLoudnessMode == 2;
  const float threshold = maxMode ? 0.40f : 0.48f;
  const float ratio = maxMode ? 1.80f : 1.80f;
  const float makeupDb = maxMode ? 6.0f : 2.4f;
  gMasterDriveTarget = dbToGain(makeupDb);
  gMasterDriveCurrent += (gMasterDriveTarget - gMasterDriveCurrent) * gSmoothCoeff;
  const float detector = absf(l) > absf(r) ? absf(l) : absf(r);
  const float envCoeff = detector > gMasterEnv ? gMasterAttackCoeff : gMasterReleaseCoeff;
  gMasterEnv += (detector - gMasterEnv) * envCoeff;
  float compGain = 1.0f;
  if (gMasterEnv > threshold && gMasterEnv > 0.000001f) {
    const float over = gMasterEnv / threshold;
    compGain = static_cast<float>(pow(over, (1.0f / ratio) - 1.0f));
  }
  const float totalGain = compGain * gMasterDriveCurrent;
  l *= totalGain;
  r *= totalGain;
}

inline void applyLimiterAndDelay(float currentL, float currentR, float &outL, float &outR, bool limitingEnabled) {
  const float delayedL = gLookL[gLookIndex];
  const float delayedR = gLookR[gLookIndex];
  const float delayedPeak = gLookPeak[gLookIndex];

  float currentPeak = absf(currentL) > absf(currentR) ? absf(currentL) : absf(currentR);
  if (limitingEnabled) {
    const float tpL = reconstructedPeak4x(gTpHistL, currentL);
    const float tpR = reconstructedPeak4x(gTpHistR, currentR);
    if (tpL > currentPeak) currentPeak = tpL;
    if (tpR > currentPeak) currentPeak = tpR;
  }

  gLookL[gLookIndex] = currentL;
  gLookR[gLookIndex] = currentR;
  gLookPeak[gLookIndex] = currentPeak;
  gLookIndex += 1;
  if (gLookIndex >= gLookaheadSamples) gLookIndex = 0;

  if (!limitingEnabled) {
    gLimiterGain = 1.0f;
    outL = delayedL;
    outR = delayedR;
    return;
  }

  // True lookahead: the output sample is the oldest sample in the delay line.
  // Scan the full 2 ms future window and reduce BEFORE an upcoming peak arrives.
  float futurePeak = delayedPeak;
  for (int i = 0; i < gLookaheadSamples; ++i) {
    if (gLookPeak[i] > futurePeak) futurePeak = gLookPeak[i];
  }

  float required = 1.0f;
  if (futurePeak > gLimiterCeiling && futurePeak > 0.000001f) required = gLimiterCeiling / futurePeak;
  if (required < gLimiterGain) gLimiterGain = required;
  else gLimiterGain += (1.0f - gLimiterGain) * gLimiterReleaseCoeff;
  gLimiterGain = clampf(gLimiterGain, 0.03f, 1.0f);

  outL = delayedL * gLimiterGain;
  outR = delayedR * gLimiterGain;
  const float gr = -gainToDb(gLimiterGain);
  if (gr > gMeterLimiterGrDb) gMeterLimiterGrDb = gr;
}

inline void trackOutput(float l, float r) {
  const float tpL = reconstructedPeak4x(gOutTpHistL, l);
  const float tpR = reconstructedPeak4x(gOutTpHistR, r);
  const float tp = tpL > tpR ? tpL : tpR;
  if (tp > gMeterTruePeak) gMeterTruePeak = tp;
  if (absf(l) > 1.0f || absf(r) > 1.0f) gMeterClipCount += 1;
  if (l != l || r != r || absf(l) > 1000000.0f || absf(r) > 1000000.0f) gMeterNanCount += 1;
}
}

extern "C" {
unsigned int mvp_v2_input_l() { return reinterpret_cast<unsigned int>(gInputL); }
unsigned int mvp_v2_input_r() { return reinterpret_cast<unsigned int>(gInputR); }
unsigned int mvp_v2_output_l() { return reinterpret_cast<unsigned int>(gOutputL); }
unsigned int mvp_v2_output_r() { return reinterpret_cast<unsigned int>(gOutputR); }
int mvp_v2_max_frames() { return kFrames; }

int mvp_v2_init(float sampleRate) {
  if (sampleRate < 32000.0f || sampleRate > 96000.0f) return 0;
  gSampleRate = sampleRate;
  gLookaheadSamples = static_cast<int>(sampleRate * 0.002f + 0.5f);
  if (gLookaheadSamples < 32) gLookaheadSamples = 32;
  if (gLookaheadSamples > kLookaheadMax) gLookaheadSamples = kLookaheadMax;
  gWideDelaySamples = static_cast<int>(sampleRate * 0.015f + 0.5f);
  if (gWideDelaySamples < 64) gWideDelaySamples = 64;
  if (gWideDelaySamples > kWideDelayMax) gWideDelaySamples = kWideDelayMax;

  gSmoothCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.020)));
  gPunchFastAttack = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.0015)));
  gPunchFastRelease = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.005)));
  gPunchSlowAttack = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.018)));
  gPunchSlowRelease = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.140)));
  gMasterAttackCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.0015)));
  gMasterReleaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.080)));
  gLimiterReleaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.005)));

  gBassLpL.lowpass(sampleRate, 150.0); gBassLpR.lowpass(sampleRate, 150.0);
  gClarityHpL.highpass(sampleRate, 7500.0); gClarityHpR.highpass(sampleRate, 7500.0);
  gWideLpL.lowpass(sampleRate, 120.0); gWideLpR.lowpass(sampleRate, 120.0);
  for (int i = 0; i < kEqBands; ++i) configureEqBand(i);
  resetState();
  return 1;
}

void mvp_v2_reset() { resetState(); }
void mvp_v2_set_bypass(int enabled) { gBypass = enabled ? 1 : 0; }
void mvp_v2_set_loudness_mode(int mode) { gLoudnessMode = mode < 0 ? 0 : (mode > 2 ? 2 : mode); }
void mvp_v2_set_bass(float amount) { gBassTarget = clampf(amount, 0.0f, 1.0f); }
void mvp_v2_set_clarity(float amount) { gClarityTarget = clampf(amount, 0.0f, 1.0f); }
void mvp_v2_set_punch(float amount) { gPunchTarget = clampf(amount, 0.0f, 1.0f); }
void mvp_v2_set_wide(float amount) { gWideTarget = clampf(amount, 0.0f, 1.0f); }
void mvp_v2_set_eq_enabled(int enabled) { gEqEnabled = enabled ? 1 : 0; }
void mvp_v2_set_eq_band(int band, float gainDb) {
  if (band < 0 || band >= kEqBands) return;
  gEqGainDb[band] = clampf(gainDb, -12.0f, 12.0f);
  configureEqBand(band);
}

int mvp_v2_process(int frames) {
  if (frames < 1 || frames > kFrames) return 0;
  for (int i = 0; i < frames; ++i) {
    float l = gInputL[i];
    float r = gInputR[i];

    gBassCurrent += (gBassTarget - gBassCurrent) * gSmoothCoeff;
    gClarityCurrent += (gClarityTarget - gClarityCurrent) * gSmoothCoeff;
    gPunchCurrent += (gPunchTarget - gPunchCurrent) * gSmoothCoeff;
    gWideCurrent += (gWideTarget - gWideCurrent) * gSmoothCoeff;

    if (!gBypass) {
      if (gEqEnabled) {
        for (int b = 0; b < kEqBands; ++b) { l = gEqL[b].process(l); r = gEqR[b].process(r); }
      }

      if (gBassCurrent > 0.0001f) {
        const float lowL = gBassLpL.process(l);
        const float lowR = gBassLpR.process(r);
        const float harmL = softBassHarmonics(lowL, gBassCurrent);
        const float harmR = softBassHarmonics(lowR, gBassCurrent);
        const float boost = 0.48f * gBassCurrent;
        l += lowL * boost + harmL * (0.55f * gBassCurrent);
        r += lowR * boost + harmR * (0.55f * gBassCurrent);
      }

      if (gClarityCurrent > 0.0001f) {
        const float airL = gClarityHpL.process(l);
        const float airR = gClarityHpR.process(r);
        const float blend = 0.42f * gClarityCurrent;
        l += airL * blend;
        r += airR * blend;
      }

      if (gPunchCurrent > 0.0001f) {
        const float detector = absf(l) > absf(r) ? absf(l) : absf(r);
        const float fastCoeff = detector > gPunchFast ? gPunchFastAttack : gPunchFastRelease;
        const float slowCoeff = detector > gPunchSlow ? gPunchSlowAttack : gPunchSlowRelease;
        gPunchFast += (detector - gPunchFast) * fastCoeff;
        gPunchSlow += (detector - gPunchSlow) * slowCoeff;
        const float transient = clampf(gPunchFast - gPunchSlow, 0.0f, 0.35f);
        const float gain = 1.0f + transient * (0.95f * gPunchCurrent);
        l *= gain; r *= gain;
      }

      if (gWideCurrent > 0.0001f) {
        const float lowL = gWideLpL.process(l);
        const float lowR = gWideLpR.process(r);
        const float lowMono = 0.5f * (lowL + lowR);
        const float highL = l - lowL;
        const float highR = r - lowR;
        const float mid = 0.5f * (highL + highR);
        float side = 0.5f * (highL - highR);
        const float delayedSide = gWideDelay[gWideIndex];
        gWideDelay[gWideIndex] = side;
        gWideIndex += 1;
        if (gWideIndex >= gWideDelaySamples) gWideIndex = 0;
        side *= 1.0f + 0.30f * gWideCurrent;
        side += delayedSide * (0.08f * gWideCurrent);
        l = lowMono + mid + side;
        r = lowMono + mid - side;
      }

      applyMastering(l, r);
    }

    float outL = 0.0f, outR = 0.0f;
    applyLimiterAndDelay(l, r, outL, outR, !gBypass);
    gOutputL[i] = outL;
    gOutputR[i] = outR;
    trackOutput(outL, outR);
  }
  return 1;
}

float mvp_v2_meter_true_peak_dbtp() { return gainToDb(gMeterTruePeak); }
float mvp_v2_meter_limiter_gr_db() { return gMeterLimiterGrDb; }
unsigned int mvp_v2_meter_clip_count() { return gMeterClipCount; }
unsigned int mvp_v2_meter_nan_count() { return gMeterNanCount; }
}
