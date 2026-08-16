// MVP Trainer Pro - MVP Studio Engine V2 Phase 2 Multiband
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

  void setLowpass(double sampleRate, double frequency, double q = 0.7071067811865476) {
    const double f = clampd(frequency, 10.0, sampleRate * 0.475);
    const double w0 = 2.0 * kPi * f / sampleRate;
    const double cw = cos(w0);
    const double sw = sin(w0);
    const double alpha = sw / (2.0 * q);
    const double a0n = 1.0 + alpha;
    b0 = ((1.0 - cw) * 0.5) / a0n;
    b1 = (1.0 - cw) / a0n;
    b2 = ((1.0 - cw) * 0.5) / a0n;
    a1 = (-2.0 * cw) / a0n;
    a2 = (1.0 - alpha) / a0n;
  }
};

struct LR4Split {
  Biquad low1;
  Biquad low2;
  Biquad high1;
  Biquad high2;

  void configure(double sampleRate, double frequency) {
    constexpr double q = 0.7071067811865476;
    low1.setLowpass(sampleRate, frequency, q);
    low2.setLowpass(sampleRate, frequency, q);
    high1.setHighpass(sampleRate, frequency, q);
    high2.setHighpass(sampleRate, frequency, q);
  }

  void reset() {
    low1.reset(); low2.reset(); high1.reset(); high2.reset();
  }

  inline void split(float input, float &low, float &high) {
    low = low2.process(low1.process(input));
    high = high2.process(high1.process(input));
  }

  inline float allpass(float input) {
    float low = 0.0f;
    float high = 0.0f;
    split(input, low, high);
    return low + high;
  }
};

struct MultibandCompressor {
  float envelope = 0.0f;
  float gain = 1.0f;
  float thresholdDb = -18.0f;
  float ratio = 1.25f;
  float maxReductionDb = 3.0f;
  float envelopeAttack = 0.01f;
  float envelopeRelease = 0.001f;
  float gainAttack = 0.01f;
  float gainRelease = 0.001f;
  float reductionDb = 0.0f;

  void configure(
    float sampleRate, float threshold, float ratioValue, float maxReduction,
    float envelopeAttackMs, float envelopeReleaseMs, float gainAttackMs, float gainReleaseMs
  ) {
    thresholdDb = threshold;
    ratio = ratioValue;
    maxReductionDb = maxReduction;
    envelopeAttack = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * envelopeAttackMs * 0.001)));
    envelopeRelease = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * envelopeReleaseMs * 0.001)));
    gainAttack = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * gainAttackMs * 0.001)));
    gainRelease = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * gainReleaseMs * 0.001)));
  }

  void reset() {
    envelope = 0.0f;
    gain = 1.0f;
    reductionDb = 0.0f;
  }

  inline float step(float detector, float amount) {
    const float envCoeff = detector > envelope ? envelopeAttack : envelopeRelease;
    envelope += (detector - envelope) * envCoeff;

    float targetReductionDb = 0.0f;
    if (amount > 0.0001f && envelope > 0.000001f) {
      const float levelDb = static_cast<float>(20.0 * log10(envelope));
      const float kneeDb = 6.0f;
      const float kneeStart = thresholdDb - kneeDb * 0.5f;
      const float kneeEnd = thresholdDb + kneeDb * 0.5f;
      float compressedOverDb = 0.0f;

      if (levelDb >= kneeEnd) {
        compressedOverDb = levelDb - thresholdDb;
      } else if (levelDb > kneeStart) {
        const float x = levelDb - kneeStart;
        compressedOverDb = (x * x) / (2.0f * kneeDb);
      }

      if (compressedOverDb > 0.0f) {
        const float ratioReduction = compressedOverDb * (1.0f - 1.0f / ratio);
        targetReductionDb = clampf(ratioReduction * amount, 0.0f, maxReductionDb * amount);
      }
    }

    const float targetGain = static_cast<float>(dbToGain(-targetReductionDb));
    const float gainCoeff = targetGain < gain ? gainAttack : gainRelease;
    gain += (targetGain - gain) * gainCoeff;
    reductionDb = gain < 0.999999f ? static_cast<float>(-20.0 * log10(gain)) : 0.0f;
    return gain;
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

// Studio V2 transient shaper. Stereo-linked detector keeps the image stable.
int transientEnabled = 0;
float transientAmount = 0.0f;
float transientFastEnvelope = 0.0f;
float transientSlowEnvelope = 0.0f;
float transientGain = 1.0f;
float transientFastAttackCoeff = 0.02f;
float transientFastReleaseCoeff = 0.001f;
float transientSlowAttackCoeff = 0.002f;
float transientSlowReleaseCoeff = 0.0002f;
float transientGainAttackCoeff = 0.03f;
float transientGainReleaseCoeff = 0.001f;
float meterTransientBoostDb = 0.0f;

// Studio V2 Phase 2 multiband dynamics.
// Binary-tree LR4 crossover: 500 Hz first, then 120 Hz / 4 kHz.
// Phase-compensation allpasses keep the two halves aligned at the 500 Hz join.
int multibandEnabled = 0;
float multibandAmount = 1.0f;
LR4Split multibandSplit500[2];
LR4Split multibandSplit120[2];
LR4Split multibandSplit4000[2];
LR4Split multibandLowComp4000[2];
LR4Split multibandHighComp120[2];
MultibandCompressor multibandCompressor[4];
float meterMultibandGainReductionDb = 0.0f;
float meterMultibandBandReductionDb[4] = {0.0f, 0.0f, 0.0f, 0.0f};

void resetBuffers() {
  for (int i = 0; i < kMaxLookahead; ++i) { limiterDelayL[i] = 0.0f; limiterDelayR[i] = 0.0f; }
  for (int i = 0; i < kSpatialDelayMax; ++i) { spatialDelayL[i] = 0.0f; spatialDelayR[i] = 0.0f; }
  limiterWrite = 0; spatialWrite = 0; limiterGain = 1.0f;
  prevDetectorL = prevDetectorR = 0.0f;
  crossfeedStateL = crossfeedStateR = 0.0;
  transientFastEnvelope = 0.0f;
  transientSlowEnvelope = 0.0f;
  transientGain = 1.0f;
  meterTransientBoostDb = 0.0f;
  meterMultibandGainReductionDb = 0.0f;
  for (int band = 0; band < 4; ++band) {
    meterMultibandBandReductionDb[band] = 0.0f;
    multibandCompressor[band].reset();
  }
  for (int ch = 0; ch < 2; ++ch) {
    for (int band = 0; band < kEqBands; ++band) eq[ch][band].reset();
    outputHp[ch].reset(); outputLow[ch].reset(); outputPresence[ch].reset(); outputHigh[ch].reset(); headphoneBass[ch].reset();
    multibandSplit500[ch].reset();
    multibandSplit120[ch].reset();
    multibandSplit4000[ch].reset();
    multibandLowComp4000[ch].reset();
    multibandHighComp120[ch].reset();
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

void configureMultiband() {
  for (int ch = 0; ch < 2; ++ch) {
    multibandSplit500[ch].configure(sampleRateHz, 500.0);
    multibandSplit120[ch].configure(sampleRateHz, 120.0);
    multibandSplit4000[ch].configure(sampleRateHz, 4000.0);
    multibandLowComp4000[ch].configure(sampleRateHz, 4000.0);
    multibandHighComp120[ch].configure(sampleRateHz, 120.0);
  }

  // Transparent mastering-style control. No automatic makeup gain is used, so the
  // V1.1 truthful gain staging remains intact and the limiter only handles real peaks.
  multibandCompressor[0].configure(sampleRateHz, -14.5f, 1.34f, 3.0f, 28.0f, 190.0f, 24.0f, 170.0f);
  multibandCompressor[1].configure(sampleRateHz, -17.0f, 1.28f, 2.6f, 22.0f, 165.0f, 18.0f, 145.0f);
  multibandCompressor[2].configure(sampleRateHz, -18.5f, 1.24f, 2.4f, 12.0f, 125.0f, 10.0f, 110.0f);
  multibandCompressor[3].configure(sampleRateHz, -20.0f, 1.20f, 2.0f, 7.0f, 95.0f, 6.0f, 85.0f);
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

inline float envelopeStep(float current, float detector, float attackCoeff, float releaseCoeff) {
  const float coeff = detector > current ? attackCoeff : releaseCoeff;
  return current + (detector - current) * coeff;
}

void processTransient(float &left, float &right) {
  if (!transientEnabled || transientAmount <= 0.0001f) {
    transientGain += (1.0f - transientGain) * transientGainReleaseCoeff;
    return;
  }

  // One detector for both channels prevents image shifts on asymmetric attacks.
  const float absL = absf(left);
  const float absR = absf(right);
  const float detector = absL > absR ? absL : absR;
  transientFastEnvelope = envelopeStep(
    transientFastEnvelope, detector, transientFastAttackCoeff, transientFastReleaseCoeff
  );
  transientSlowEnvelope = envelopeStep(
    transientSlowEnvelope, detector, transientSlowAttackCoeff, transientSlowReleaseCoeff
  );

  // Positive fast-vs-slow separation identifies onsets. Normalize by the program
  // envelope so quiet passages do not receive absurd gain. Maximum boost is 2.2 dB.
  const float floor = 0.025f;
  const float separation = transientFastEnvelope - transientSlowEnvelope;
  const float normalized = separation > 0.0f
    ? clampf(separation / (transientSlowEnvelope + floor), 0.0f, 1.0f)
    : 0.0f;
  const float boostDb = transientAmount * normalized * 2.2f;
  const float targetGain = static_cast<float>(dbToGain(boostDb));
  const float coeff = targetGain > transientGain ? transientGainAttackCoeff : transientGainReleaseCoeff;
  transientGain += (targetGain - transientGain) * coeff;

  left *= transientGain;
  right *= transientGain;
  const float actualBoostDb = transientGain > 1.000001f
    ? static_cast<float>(20.0 * log10(transientGain))
    : 0.0f;
  if (actualBoostDb > meterTransientBoostDb) meterTransientBoostDb = actualBoostDb;
}

void processMultiband(float &left, float &right) {
  if (!multibandEnabled || multibandAmount <= 0.0001f) return;

  float low500L = 0.0f, high500L = 0.0f;
  float low500R = 0.0f, high500R = 0.0f;
  multibandSplit500[0].split(left, low500L, high500L);
  multibandSplit500[1].split(right, low500R, high500R);

  float band0L = 0.0f, band1L = 0.0f;
  float band0R = 0.0f, band1R = 0.0f;
  multibandSplit120[0].split(low500L, band0L, band1L);
  multibandSplit120[1].split(low500R, band0R, band1R);

  float band2L = 0.0f, band3L = 0.0f;
  float band2R = 0.0f, band3R = 0.0f;
  multibandSplit4000[0].split(high500L, band2L, band3L);
  multibandSplit4000[1].split(high500R, band2R, band3R);

  const float detector0 = absf(band0L) > absf(band0R) ? absf(band0L) : absf(band0R);
  const float detector1 = absf(band1L) > absf(band1R) ? absf(band1L) : absf(band1R);
  const float detector2 = absf(band2L) > absf(band2R) ? absf(band2L) : absf(band2R);
  const float detector3 = absf(band3L) > absf(band3R) ? absf(band3L) : absf(band3R);

  const float gain0 = multibandCompressor[0].step(detector0, multibandAmount);
  const float gain1 = multibandCompressor[1].step(detector1, multibandAmount);
  const float gain2 = multibandCompressor[2].step(detector2, multibandAmount);
  const float gain3 = multibandCompressor[3].step(detector3, multibandAmount);

  float lowSumL = band0L * gain0 + band1L * gain1;
  float lowSumR = band0R * gain0 + band1R * gain1;
  float highSumL = band2L * gain2 + band3L * gain3;
  float highSumR = band2R * gain2 + band3R * gain3;

  // Each half gets the opposite branch's split phase before the final recombination.
  // That keeps the 500 Hz binary-tree join phase matched while retaining four
  // independent stereo-linked gain controls.
  lowSumL = multibandLowComp4000[0].allpass(lowSumL);
  lowSumR = multibandLowComp4000[1].allpass(lowSumR);
  highSumL = multibandHighComp120[0].allpass(highSumL);
  highSumR = multibandHighComp120[1].allpass(highSumR);

  left = lowSumL + highSumL;
  right = lowSumR + highSumR;

  meterMultibandGainReductionDb = 0.0f;
  for (int band = 0; band < 4; ++band) {
    meterMultibandBandReductionDb[band] = multibandCompressor[band].reductionDb;
    if (meterMultibandBandReductionDb[band] > meterMultibandGainReductionDb) {
      meterMultibandGainReductionDb = meterMultibandBandReductionDb[band];
    }
  }
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
  // Envelope constants are intentionally conservative for mastered rock/pop material.
  transientFastAttackCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.0012)));
  transientFastReleaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.028)));
  transientSlowAttackCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.020)));
  transientSlowReleaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.180)));
  transientGainAttackCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.0008)));
  transientGainReleaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.026)));
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
  configureMultiband();
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
__attribute__((visibility("default"))) void mvp_set_transient(int enabled, float amount) {
  transientEnabled = enabled ? 1 : 0;
  transientAmount = clampf(amount, 0.0f, 1.0f);
}
__attribute__((visibility("default"))) void mvp_set_multiband(int enabled, float amount) {
  const int nextEnabled = enabled ? 1 : 0;
  if (nextEnabled && !multibandEnabled) {
    for (int band = 0; band < 4; ++band) multibandCompressor[band].reset();
    for (int ch = 0; ch < 2; ++ch) {
      multibandSplit500[ch].reset();
      multibandSplit120[ch].reset();
      multibandSplit4000[ch].reset();
      multibandLowComp4000[ch].reset();
      multibandHighComp120[ch].reset();
    }
  }
  multibandEnabled = nextEnabled;
  multibandAmount = clampf(amount, 0.0f, 1.0f);
}
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
  meterTransientBoostDb = 0.0f;
  meterMultibandGainReductionDb = 0.0f;
  for (int band = 0; band < 4; ++band) meterMultibandBandReductionDb[band] = multibandCompressor[band].reductionDb;
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
    processTransient(left, right);
    processMultiband(left, right);
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
__attribute__((visibility("default"))) float mvp_meter_transient_boost_db() { return meterTransientBoostDb; }
__attribute__((visibility("default"))) float mvp_meter_multiband_gain_reduction_db() { return meterMultibandGainReductionDb; }
__attribute__((visibility("default"))) float mvp_meter_multiband_band_reduction_db(int band) {
  if (band < 0 || band >= 4) return 0.0f;
  return meterMultibandBandReductionDb[band];
}
}
