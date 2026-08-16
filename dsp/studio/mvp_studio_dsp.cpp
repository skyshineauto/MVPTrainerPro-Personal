// MVP Trainer Pro - MVP Studio Engine V1
// Standalone C++ DSP core compiled to WebAssembly.
// Real-time rule: no heap allocation, no locks, no I/O in mvp_process().

extern "C" double sin(double) __attribute__((import_module("env"), import_name("sin")));
extern "C" double cos(double) __attribute__((import_module("env"), import_name("cos")));
extern "C" double pow(double, double) __attribute__((import_module("env"), import_name("pow")));
extern "C" double exp(double) __attribute__((import_module("env"), import_name("exp")));
extern "C" double log10(double) __attribute__((import_module("env"), import_name("log10")));

namespace {
constexpr int kEqBands = 31;
constexpr int kMaxFrames = 2048;
constexpr int kMaxLookahead = 2048;
constexpr int kSpatialDelayMax = 512;
constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kGraphicEqQ = 4.318473046963146; // ~1/3-octave graphic EQ bandwidth.

const double kEqFrequencies[kEqBands] = {
  20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0,
  200.0, 250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0,
  1600.0, 2000.0, 2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0,
  10000.0, 12500.0, 16000.0, 20000.0
};

inline double clampd(double value, double lo, double hi) {
  return value < lo ? lo : (value > hi ? hi : value);
}
inline float clampf(float value, float lo, float hi) {
  return value < lo ? lo : (value > hi ? hi : value);
}
inline double absd(double value) { return value < 0.0 ? -value : value; }
inline float absf(float value) { return value < 0.0f ? -value : value; }
inline double dbToGain(double db) { return pow(10.0, db / 20.0); }

struct Biquad {
  double b0 = 1.0;
  double b1 = 0.0;
  double b2 = 0.0;
  double a1 = 0.0;
  double a2 = 0.0;
  double z1 = 0.0;
  double z2 = 0.0;

  void reset() { z1 = z2 = 0.0; }

  inline float process(float input) {
    const double x = static_cast<double>(input);
    const double y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return static_cast<float>(y);
  }

  void setIdentity() {
    b0 = 1.0; b1 = 0.0; b2 = 0.0; a1 = 0.0; a2 = 0.0;
  }

  void setPeaking(double sampleRate, double frequency, double q, double gainDb) {
    const double nyquistSafe = sampleRate * 0.475;
    const double f = clampd(frequency, 10.0, nyquistSafe);
    if (absd(gainDb) < 0.00001 || f >= sampleRate * 0.49) {
      setIdentity();
      return;
    }
    const double A = pow(10.0, gainDb / 40.0);
    const double w0 = 2.0 * kPi * f / sampleRate;
    const double cw = cos(w0);
    const double sw = sin(w0);
    const double alpha = sw / (2.0 * q);
    const double a0 = 1.0 + alpha / A;
    b0 = (1.0 + alpha * A) / a0;
    b1 = (-2.0 * cw) / a0;
    b2 = (1.0 - alpha * A) / a0;
    a1 = (-2.0 * cw) / a0;
    a2 = (1.0 - alpha / A) / a0;
  }

  void setLowShelf(double sampleRate, double frequency, double gainDb) {
    const double f = clampd(frequency, 10.0, sampleRate * 0.475);
    if (absd(gainDb) < 0.00001) { setIdentity(); return; }
    const double A = pow(10.0, gainDb / 40.0);
    const double w0 = 2.0 * kPi * f / sampleRate;
    const double cw = cos(w0);
    const double sw = sin(w0);
    const double sqrtA = pow(A, 0.5);
    const double alpha = sw * 0.7071067811865476;
    const double twoSqrtAAlpha = 2.0 * sqrtA * alpha;
    const double b0n = A * ((A + 1.0) - (A - 1.0) * cw + twoSqrtAAlpha);
    const double b1n = 2.0 * A * ((A - 1.0) - (A + 1.0) * cw);
    const double b2n = A * ((A + 1.0) - (A - 1.0) * cw - twoSqrtAAlpha);
    const double a0n = (A + 1.0) + (A - 1.0) * cw + twoSqrtAAlpha;
    const double a1n = -2.0 * ((A - 1.0) + (A + 1.0) * cw);
    const double a2n = (A + 1.0) + (A - 1.0) * cw - twoSqrtAAlpha;
    b0 = b0n / a0n; b1 = b1n / a0n; b2 = b2n / a0n; a1 = a1n / a0n; a2 = a2n / a0n;
  }

  void setHighShelf(double sampleRate, double frequency, double gainDb) {
    const double f = clampd(frequency, 10.0, sampleRate * 0.475);
    if (absd(gainDb) < 0.00001) { setIdentity(); return; }
    const double A = pow(10.0, gainDb / 40.0);
    const double w0 = 2.0 * kPi * f / sampleRate;
    const double cw = cos(w0);
    const double sw = sin(w0);
    const double sqrtA = pow(A, 0.5);
    const double alpha = sw * 0.7071067811865476;
    const double twoSqrtAAlpha = 2.0 * sqrtA * alpha;
    const double b0n = A * ((A + 1.0) + (A - 1.0) * cw + twoSqrtAAlpha);
    const double b1n = -2.0 * A * ((A - 1.0) + (A + 1.0) * cw);
    const double b2n = A * ((A + 1.0) + (A - 1.0) * cw - twoSqrtAAlpha);
    const double a0n = (A + 1.0) - (A - 1.0) * cw + twoSqrtAAlpha;
    const double a1n = 2.0 * ((A - 1.0) - (A + 1.0) * cw);
    const double a2n = (A + 1.0) - (A - 1.0) * cw - twoSqrtAAlpha;
    b0 = b0n / a0n; b1 = b1n / a0n; b2 = b2n / a0n; a1 = a1n / a0n; a2 = a2n / a0n;
  }

  void setHighpass(double sampleRate, double frequency, double q = 0.7071067811865476) {
    const double f = clampd(frequency, 10.0, sampleRate * 0.475);
    const double w0 = 2.0 * kPi * f / sampleRate;
    const double cw = cos(w0);
    const double sw = sin(w0);
    const double alpha = sw / (2.0 * q);
    const double a0n = 1.0 + alpha;
    b0 = ((1.0 + cw) * 0.5) / a0n;
    b1 = (-(1.0 + cw)) / a0n;
    b2 = ((1.0 + cw) * 0.5) / a0n;
    a1 = (-2.0 * cw) / a0n;
    a2 = (1.0 - alpha) / a0n;
  }
};

float inputL[kMaxFrames];
float inputR[kMaxFrames];
float outputL[kMaxFrames];
float outputR[kMaxFrames];

Biquad eq[2][kEqBands];
float eqTarget[kEqBands];
float eqCurrent[kEqBands];
Biquad outputHp[2];
Biquad outputLow[2];
Biquad outputPresence[2];
Biquad outputHigh[2];
Biquad headphoneBass[2];

float limiterDelayL[kMaxLookahead];
float limiterDelayR[kMaxLookahead];
int limiterWrite = 0;
int limiterLookahead = 240;
float limiterGain = 1.0f;
float prevDetectorL = 0.0f;
float prevDetectorR = 0.0f;

float spatialDelayL[kSpatialDelayMax];
float spatialDelayR[kSpatialDelayMax];
int spatialWrite = 0;
double crossfeedStateL = 0.0;
double crossfeedStateR = 0.0;

float sampleRateHz = 48000.0f;
int bypassed = 0;
int eqEnabled = 1;
int limiterEnabled = 1;
int outputProfile = 0; // 0 car/hifi, 1 headphones, 2 speaker
int headphoneEnabled = 0;
float headphoneWidth = 0.0f;
float headphoneDepth = 0.0f;
float headphoneCrossfeed = 0.0f;
float headphoneCenter = 0.5f;
float headphoneBassImpact = 0.0f;
float targetPreampDb = 0.0f;
float headroomDb = 0.0f;
float currentPreampGain = 1.0f;
float limiterCeilingDb = -1.0f;
float limiterCeilingGain = 0.89125094f;
float limiterReleaseCoeff = 0.001f;

float meterInputPeak = 0.0f;
float meterOutputPeak = 0.0f;
float meterInputRms = 0.0f;
float meterOutputRms = 0.0f;
float meterGainReductionDb = 0.0f;

void resetBuffers() {
  for (int i = 0; i < kMaxLookahead; ++i) { limiterDelayL[i] = 0.0f; limiterDelayR[i] = 0.0f; }
  for (int i = 0; i < kSpatialDelayMax; ++i) { spatialDelayL[i] = 0.0f; spatialDelayR[i] = 0.0f; }
  limiterWrite = 0; spatialWrite = 0; limiterGain = 1.0f;
  prevDetectorL = prevDetectorR = 0.0f;
  crossfeedStateL = crossfeedStateR = 0.0;
  for (int ch = 0; ch < 2; ++ch) {
    for (int band = 0; band < kEqBands; ++band) eq[ch][band].reset();
    outputHp[ch].reset(); outputLow[ch].reset(); outputPresence[ch].reset(); outputHigh[ch].reset(); headphoneBass[ch].reset();
  }
}

void configureOutputProfile() {
  for (int ch = 0; ch < 2; ++ch) {
    if (outputProfile == 2) {
      outputHp[ch].setHighpass(sampleRateHz, 42.0);
      outputLow[ch].setLowShelf(sampleRateHz, 105.0, 0.7);
      outputPresence[ch].setPeaking(sampleRateHz, 2800.0, 0.85, 0.65);
      outputHigh[ch].setHighShelf(sampleRateHz, 8200.0, 0.55);
    } else if (outputProfile == 1) {
      outputHp[ch].setHighpass(sampleRateHz, 16.0);
      outputLow[ch].setLowShelf(sampleRateHz, 90.0, 0.0);
      outputPresence[ch].setPeaking(sampleRateHz, 3000.0, 0.9, 0.0);
      outputHigh[ch].setHighShelf(sampleRateHz, 10000.0, 0.0);
    } else {
      outputHp[ch].setHighpass(sampleRateHz, 18.0);
      outputLow[ch].setLowShelf(sampleRateHz, 82.0, 0.25);
      outputPresence[ch].setPeaking(sampleRateHz, 2900.0, 0.95, 0.2);
      outputHigh[ch].setHighShelf(sampleRateHz, 10500.0, 0.15);
    }
  }
}

void configureHeadphoneBass() {
  const double boost = headphoneEnabled ? clampd(headphoneBassImpact, 0.0, 1.0) * 3.0 : 0.0;
  headphoneBass[0].setLowShelf(sampleRateHz, 92.0, boost);
  headphoneBass[1].setLowShelf(sampleRateHz, 92.0, boost);
}

void refreshEqForBlock(int frames) {
  const double seconds = static_cast<double>(frames) / sampleRateHz;
  const float alpha = static_cast<float>(1.0 - exp(-seconds / 0.024));
  for (int band = 0; band < kEqBands; ++band) {
    const float previous = eqCurrent[band];
    eqCurrent[band] += (eqTarget[band] - eqCurrent[band]) * alpha;
    if (absf(eqCurrent[band] - previous) > 0.00005f || absf(eqTarget[band] - eqCurrent[band]) > 0.00005f) {
      for (int ch = 0; ch < 2; ++ch) {
        eq[ch][band].setPeaking(sampleRateHz, kEqFrequencies[band], kGraphicEqQ, eqCurrent[band]);
      }
    }
  }
}

inline float processEq(int ch, float sample) {
  if (!eqEnabled) return sample;
  for (int band = 0; band < kEqBands; ++band) sample = eq[ch][band].process(sample);
  return sample;
}

inline float processOutput(int ch, float sample) {
  sample = outputHp[ch].process(sample);
  sample = outputLow[ch].process(sample);
  sample = outputPresence[ch].process(sample);
  sample = outputHigh[ch].process(sample);
  return sample;
}

void processHeadphone(float &left, float &right) {
  if (!headphoneEnabled) return;
  left = headphoneBass[0].process(left);
  right = headphoneBass[1].process(right);

  const float width = clampf(headphoneWidth, 0.0f, 1.0f);
  const float center = clampf(headphoneCenter, 0.0f, 1.0f);
  const float mid = 0.5f * (left + right);
  const float side = 0.5f * (left - right);
  const float sideScale = 1.0f + width * 0.55f;
  const float midScale = 0.92f + center * 0.16f;
  float widenedL = mid * midScale + side * sideScale;
  float widenedR = mid * midScale - side * sideScale;

  const float cf = clampf(headphoneCrossfeed, 0.0f, 1.0f);
  if (cf > 0.0001f) {
    const double cutoff = 1100.0;
    const double alpha = 1.0 - exp(-2.0 * kPi * cutoff / sampleRateHz);
    crossfeedStateL += alpha * (widenedL - crossfeedStateL);
    crossfeedStateR += alpha * (widenedR - crossfeedStateR);
    const float mix = cf * 0.18f;
    const float direct = 1.0f - mix * 0.42f;
    const float cfL = static_cast<float>(crossfeedStateR) * mix;
    const float cfR = static_cast<float>(crossfeedStateL) * mix;
    widenedL = widenedL * direct + cfL;
    widenedR = widenedR * direct + cfR;
  }

  const float depth = clampf(headphoneDepth, 0.0f, 1.0f);
  if (depth > 0.0001f) {
    int delaySamples = static_cast<int>(sampleRateHz * (0.00035f + 0.00105f * depth));
    if (delaySamples < 1) delaySamples = 1;
    if (delaySamples >= kSpatialDelayMax) delaySamples = kSpatialDelayMax - 1;
    const int read = (spatialWrite - delaySamples + kSpatialDelayMax) % kSpatialDelayMax;
    const float delayedL = spatialDelayL[read];
    const float delayedR = spatialDelayR[read];
    spatialDelayL[spatialWrite] = widenedL;
    spatialDelayR[spatialWrite] = widenedR;
    spatialWrite = (spatialWrite + 1) % kSpatialDelayMax;
    const float mix = depth * 0.10f;
    widenedL = widenedL * (1.0f - mix) + delayedR * mix;
    widenedR = widenedR * (1.0f - mix) + delayedL * mix;
  }

  const float compensation = 1.0f / (1.0f + width * 0.10f + depth * 0.06f);
  left = widenedL * compensation;
  right = widenedR * compensation;
}

inline float intersamplePeak(float previous, float current) {
  float peak = absf(previous) > absf(current) ? absf(previous) : absf(current);
  const float step = (current - previous) * 0.25f;
  float value = previous + step;
  for (int i = 0; i < 3; ++i) {
    const float magnitude = absf(value);
    if (magnitude > peak) peak = magnitude;
    value += step;
  }
  return peak;
}

void processLimiter(float inLeft, float inRight, float &outLeft, float &outRight) {
  const float detector = intersamplePeak(prevDetectorL, inLeft) > intersamplePeak(prevDetectorR, inRight)
    ? intersamplePeak(prevDetectorL, inLeft)
    : intersamplePeak(prevDetectorR, inRight);
  prevDetectorL = inLeft;
  prevDetectorR = inRight;

  limiterDelayL[limiterWrite] = inLeft;
  limiterDelayR[limiterWrite] = inRight;
  int read = limiterWrite - limiterLookahead;
  if (read < 0) read += kMaxLookahead;
  float delayedL = limiterDelayL[read];
  float delayedR = limiterDelayR[read];
  limiterWrite = (limiterWrite + 1) % kMaxLookahead;

  float required = 1.0f;
  if (limiterEnabled && detector > limiterCeilingGain && detector > 0.0000001f) {
    required = limiterCeilingGain / detector;
  }
  if (required < limiterGain) limiterGain = required;
  else limiterGain += (1.0f - limiterGain) * limiterReleaseCoeff;
  if (!limiterEnabled) limiterGain += (1.0f - limiterGain) * 0.02f;

  outLeft = delayedL * limiterGain;
  outRight = delayedR * limiterGain;
  if (limiterEnabled) {
    outLeft = clampf(outLeft, -limiterCeilingGain, limiterCeilingGain);
    outRight = clampf(outRight, -limiterCeilingGain, limiterCeilingGain);
  }
}
} // namespace

extern "C" {
__attribute__((visibility("default"))) int mvp_init(float sr) {
  sampleRateHz = clampf(sr, 8000.0f, 192000.0f);
  limiterLookahead = static_cast<int>(sampleRateHz * 0.005f + 0.5f);
  if (limiterLookahead < 1) limiterLookahead = 1;
  if (limiterLookahead >= kMaxLookahead) limiterLookahead = kMaxLookahead - 1;
  limiterReleaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.095)));
  for (int band = 0; band < kEqBands; ++band) {
    eqTarget[band] = 0.0f;
    eqCurrent[band] = 0.0f;
    for (int ch = 0; ch < 2; ++ch) eq[ch][band].setIdentity();
  }
  targetPreampDb = 0.0f;
  headroomDb = 0.0f;
  currentPreampGain = 1.0f;
  configureOutputProfile();
  configureHeadphoneBass();
  resetBuffers();
  return 1;
}

__attribute__((visibility("default"))) int mvp_max_frames() { return kMaxFrames; }
__attribute__((visibility("default"))) float* mvp_input_l() { return inputL; }
__attribute__((visibility("default"))) float* mvp_input_r() { return inputR; }
__attribute__((visibility("default"))) float* mvp_output_l() { return outputL; }
__attribute__((visibility("default"))) float* mvp_output_r() { return outputR; }

__attribute__((visibility("default"))) void mvp_set_bypass(int value) { bypassed = value ? 1 : 0; }
__attribute__((visibility("default"))) void mvp_set_eq_enabled(int value) { eqEnabled = value ? 1 : 0; }
__attribute__((visibility("default"))) void mvp_set_eq_band(int index, float gainDb) {
  if (index < 0 || index >= kEqBands) return;
  eqTarget[index] = clampf(gainDb, -12.0f, 12.0f);
}
__attribute__((visibility("default"))) void mvp_set_preamp_db(float value) { targetPreampDb = clampf(value, -18.0f, 12.0f); }
__attribute__((visibility("default"))) void mvp_set_headroom_db(float value) { headroomDb = clampf(value, 0.0f, 18.0f); }
__attribute__((visibility("default"))) void mvp_set_limiter(int enabled, float ceilingDb) {
  limiterEnabled = enabled ? 1 : 0;
  limiterCeilingDb = clampf(ceilingDb, -6.0f, -0.1f);
  limiterCeilingGain = static_cast<float>(dbToGain(limiterCeilingDb));
}
__attribute__((visibility("default"))) void mvp_set_output_profile(int profile) {
  outputProfile = profile < 0 ? 0 : (profile > 2 ? 2 : profile);
  configureOutputProfile();
}
__attribute__((visibility("default"))) void mvp_set_headphone(
  int enabled, float width, float depth, float crossfeed, float center, float bassImpact
) {
  headphoneEnabled = enabled ? 1 : 0;
  headphoneWidth = clampf(width, 0.0f, 1.0f);
  headphoneDepth = clampf(depth, 0.0f, 1.0f);
  headphoneCrossfeed = clampf(crossfeed, 0.0f, 1.0f);
  headphoneCenter = clampf(center, 0.0f, 1.0f);
  headphoneBassImpact = clampf(bassImpact, 0.0f, 1.0f);
  configureHeadphoneBass();
}
__attribute__((visibility("default"))) void mvp_reset() { resetBuffers(); }

__attribute__((visibility("default"))) int mvp_process(int frames) {
  if (frames <= 0 || frames > kMaxFrames) return 0;
  refreshEqForBlock(frames);
  meterInputPeak = meterOutputPeak = 0.0f;
  double inputEnergy = 0.0;
  double outputEnergy = 0.0;
  const float targetGain = static_cast<float>(dbToGain(targetPreampDb - headroomDb));
  const float preampCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.018)));

  for (int i = 0; i < frames; ++i) {
    const float rawL = inputL[i];
    const float rawR = inputR[i];
    const float inputPeak = absf(rawL) > absf(rawR) ? absf(rawL) : absf(rawR);
    if (inputPeak > meterInputPeak) meterInputPeak = inputPeak;
    inputEnergy += 0.5 * (static_cast<double>(rawL) * rawL + static_cast<double>(rawR) * rawR);

    if (bypassed) {
      outputL[i] = rawL;
      outputR[i] = rawR;
      const float peak = inputPeak;
      if (peak > meterOutputPeak) meterOutputPeak = peak;
      outputEnergy += 0.5 * (static_cast<double>(rawL) * rawL + static_cast<double>(rawR) * rawR);
      continue;
    }

    currentPreampGain += (targetGain - currentPreampGain) * preampCoeff;
    float left = rawL * currentPreampGain;
    float right = rawR * currentPreampGain;
    left = processEq(0, left);
    right = processEq(1, right);
    left = processOutput(0, left);
    right = processOutput(1, right);
    processHeadphone(left, right);

    float limitedL = 0.0f;
    float limitedR = 0.0f;
    processLimiter(left, right, limitedL, limitedR);
    outputL[i] = limitedL;
    outputR[i] = limitedR;

    const float outputPeak = absf(limitedL) > absf(limitedR) ? absf(limitedL) : absf(limitedR);
    if (outputPeak > meterOutputPeak) meterOutputPeak = outputPeak;
    outputEnergy += 0.5 * (static_cast<double>(limitedL) * limitedL + static_cast<double>(limitedR) * limitedR);
  }

  meterInputRms = static_cast<float>(pow(inputEnergy / frames, 0.5));
  meterOutputRms = static_cast<float>(pow(outputEnergy / frames, 0.5));
  meterGainReductionDb = limiterGain < 0.999999f ? static_cast<float>(-20.0 * log10(limiterGain)) : 0.0f;
  return 1;
}

__attribute__((visibility("default"))) float mvp_meter_input_peak() { return meterInputPeak; }
__attribute__((visibility("default"))) float mvp_meter_output_peak() { return meterOutputPeak; }
__attribute__((visibility("default"))) float mvp_meter_input_rms() { return meterInputRms; }
__attribute__((visibility("default"))) float mvp_meter_output_rms() { return meterOutputRms; }
__attribute__((visibility("default"))) float mvp_meter_gain_reduction_db() { return meterGainReductionDb; }
__attribute__((visibility("default"))) float mvp_meter_limiter_gain() { return limiterGain; }
}
