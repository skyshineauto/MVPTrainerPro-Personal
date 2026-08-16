// MVP Trainer Pro - MVP Studio Engine V3 Phase 3 Linear Phase FIR
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
constexpr int kLinearFirTaps = 4097;
constexpr int kLinearFirHalf = 2048;
constexpr int kLinearFirBlock = 128;
constexpr int kLinearFirFft = 256;
constexpr int kLinearFirPartitions = 33;
constexpr int kLinearFirDesignFft = 8192;
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

  void setBandpass(double sampleRate, double frequency, double q = 1.0) {
    const double f = clampd(frequency, 10.0, sampleRate * 0.475);
    const double safeQ = clampd(q, 0.15, 12.0);
    const double w0 = 2.0 * kPi * f / sampleRate;
    const double cw = cos(w0);
    const double sw = sin(w0);
    const double alpha = sw / (2.0 * safeQ);
    const double a0n = 1.0 + alpha;
    b0 = alpha / a0n;
    b1 = 0.0;
    b2 = -alpha / a0n;
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

struct DynamicEqBand {
  Biquad detector[2];
  Biquad audio[2];
  float frequency = 1000.0f;
  float q = 1.0f;
  float thresholdDb = -18.0f;
  float maxReductionDb = 2.0f;
  float ratio = 2.0f;
  float envelope = 0.0f;
  float reductionDb = 0.0f;
  float attackCoeff = 0.02f;
  float releaseCoeff = 0.002f;

  void configure(float sampleRate, float freq, float qValue, float threshold, float maxReduction, float ratioValue, float attackMs, float releaseMs) {
    frequency = freq;
    q = qValue;
    thresholdDb = threshold;
    maxReductionDb = maxReduction;
    ratio = ratioValue;
    attackCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * attackMs * 0.001)));
    releaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * releaseMs * 0.001)));
    detector[0].setBandpass(sampleRate, frequency, q);
    detector[1].setBandpass(sampleRate, frequency, q);
    audio[0].setIdentity();
    audio[1].setIdentity();
  }

  void reset() {
    envelope = 0.0f;
    reductionDb = 0.0f;
    for (int ch = 0; ch < 2; ++ch) { detector[ch].reset(); audio[ch].reset(); }
  }

  inline void detect(float left, float right) {
    const float dl = absf(detector[0].process(left));
    const float dr = absf(detector[1].process(right));
    const float value = dl > dr ? dl : dr;
    const float coeff = value > envelope ? attackCoeff : releaseCoeff;
    envelope += (value - envelope) * coeff;
  }

  void update(float sampleRate, float amount, float seconds) {
    float targetDb = 0.0f;
    if (amount > 0.0001f && envelope > 0.000001f) {
      const float levelDb = static_cast<float>(20.0 * log10(envelope));
      if (levelDb > thresholdDb) {
        const float over = levelDb - thresholdDb;
        targetDb = clampf(over * (1.0f - 1.0f / ratio) * amount, 0.0f, maxReductionDb * amount);
      }
    }
    const float timeConstant = targetDb > reductionDb ? 0.045f : 0.220f;
    const float alpha = static_cast<float>(1.0 - exp(-seconds / timeConstant));
    reductionDb += (targetDb - reductionDb) * alpha;
    if (reductionDb < 0.001f) reductionDb = 0.0f;
    for (int ch = 0; ch < 2; ++ch) audio[ch].setPeaking(sampleRate, frequency, q, -reductionDb);
  }

  inline void process(float &left, float &right) {
    detect(left, right);
    left = audio[0].process(left);
    right = audio[1].process(right);
  }
};

float inputL[kMaxFrames];
float inputR[kMaxFrames];
float outputL[kMaxFrames];
float outputR[kMaxFrames];

Biquad eq[2][kEqBands];
float eqTarget[kEqBands];
float eqCurrent[kEqBands];

// Studio linear-phase EQ. A 4097-tap symmetric FIR is rendered with
// 128-sample uniform partitioned convolution (256-point FFT). This keeps the
// AudioWorklet real-time cost bounded while providing real low-frequency
// resolution that a tiny FIR cannot.
int eqTopology = 0; // 0 minimum-phase IIR, 1 linear-phase FIR
float linearFirTaps[kLinearFirTaps];
float linearFilterReal[kLinearFirPartitions][kLinearFirFft];
float linearFilterImag[kLinearFirPartitions][kLinearFirFft];
float linearTargetReal[kLinearFirPartitions][kLinearFirFft];
float linearTargetImag[kLinearFirPartitions][kLinearFirFft];
float linearInputSpectrumReal[2][kLinearFirPartitions][kLinearFirFft];
float linearInputSpectrumImag[2][kLinearFirPartitions][kLinearFirFft];
float linearInputBlock[2][kLinearFirBlock];
float linearOutputBlock[2][kLinearFirBlock];
float linearOverlap[2][kLinearFirBlock];
float linearFftReal[kLinearFirDesignFft];
float linearFftImag[kLinearFirDesignFft];
int linearBlockPos = 0;
int linearSpectrumWrite = 0;

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

// Studio V3 Phase 1 adaptive Dynamic EQ. Four cut-only resonance controllers
// reduce boom, low-mid buildup, upper-mid harshness and brittle edge only when
// those regions actually cross their thresholds. Static 31-band EQ remains truthful.
int dynamicEqEnabled = 1;
float dynamicEqAmount = 0.72f;
DynamicEqBand dynamicEqBands[4];
float meterDynamicEqMaxReductionDb = 0.0f;
float meterDynamicEqBandReductionDb[4] = {0.0f, 0.0f, 0.0f, 0.0f};

// Studio V3 Phase 2 intelligent output correction. The musical preset remains
// unchanged; this stage only applies device-path compensation and a conservative
// cut-only low-frequency guard whose threshold/strength follows the selected
// output profile. It never adds adaptive gain.
int outputCorrectionEnabled = 1;
float outputCorrectionAmount = 1.0f;
float outputCorrectionProfileScale = 0.65f;
DynamicEqBand outputGuard;
float meterOutputCorrectionReductionDb = 0.0f;

// Studio V2 Phase 3.1 optional Volume Match utility.
// The detector is K-weighted (BS.1770-style shelf + RLB high-pass), with an exact
// 400 ms energy window and slow gated program accumulation. Gain movement is
// intentionally slow so this behaves as song-to-song matching,
// not a short-term compressor. The final peak-guard limiter remains last.
constexpr int kLoudnessWindowMax = 76800; // 400 ms at 192 kHz.
int loudnessEnabled = 0;
float loudnessTargetLufs = -10.0f;
float loudnessGain = 1.0f;
float loudnessTargetGain = 1.0f;
float loudnessMomentaryLufs = -70.0f;
float loudnessProgramLufs = -70.0f;
float loudnessGainDb = 0.0f;
float loudnessGainDownCoeff = 0.00001f;
float loudnessGainUpCoeff = 0.000004f;
float loudnessBypassReturnCoeff = 0.00008f;
Biquad loudnessHighShelf[2];
Biquad loudnessHighpass[2];
float loudnessEnergyWindow[kLoudnessWindowMax];
int loudnessWindowFrames = 19200;
int loudnessWindowWrite = 0;
int loudnessWindowCount = 0;
double loudnessWindowEnergySum = 0.0;
int loudnessBlockFrames = 4800;
int loudnessBlockCount = 0;
double loudnessBlockEnergySum = 0.0;
double loudnessProgramEnergySum = 0.0;
int loudnessProgramBlockCount = 0;

void resetLinearFir(bool copyTarget);

void resetLoudnessState() {
  loudnessWindowWrite = 0;
  loudnessWindowCount = 0;
  loudnessWindowEnergySum = 0.0;
  loudnessBlockCount = 0;
  loudnessBlockEnergySum = 0.0;
  loudnessProgramEnergySum = 0.0;
  loudnessProgramBlockCount = 0;
  loudnessGain = 1.0f;
  loudnessTargetGain = 1.0f;
  loudnessGainDb = 0.0f;
  loudnessMomentaryLufs = -70.0f;
  loudnessProgramLufs = -70.0f;
  for (int ch = 0; ch < 2; ++ch) {
    loudnessHighShelf[ch].reset();
    loudnessHighpass[ch].reset();
  }
}

void resetBuffers() {
  for (int i = 0; i < kMaxLookahead; ++i) { limiterDelayL[i] = 0.0f; limiterDelayR[i] = 0.0f; }
  for (int i = 0; i < kSpatialDelayMax; ++i) { spatialDelayL[i] = 0.0f; spatialDelayR[i] = 0.0f; }
  limiterWrite = 0; spatialWrite = 0; limiterGain = 1.0f;
  prevDetectorL = prevDetectorR = 0.0f;
  crossfeedStateL = crossfeedStateR = 0.0;
  resetLoudnessState();
  resetLinearFir(false);
  transientFastEnvelope = 0.0f;
  transientSlowEnvelope = 0.0f;
  transientGain = 1.0f;
  meterTransientBoostDb = 0.0f;
  meterMultibandGainReductionDb = 0.0f;
  meterDynamicEqMaxReductionDb = 0.0f;
  meterOutputCorrectionReductionDb = 0.0f;
  outputGuard.reset();
  for (int band = 0; band < 4; ++band) {
    meterMultibandBandReductionDb[band] = 0.0f;
    multibandCompressor[band].reset();
    meterDynamicEqBandReductionDb[band] = 0.0f;
    dynamicEqBands[band].reset();
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


inline void swapf(float &a, float &b) { const float t = a; a = b; b = t; }

void fftInPlace(float *real, float *imag, int size, bool inverse) {
  for (int i = 1, j = 0; i < size; ++i) {
    int bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { swapf(real[i], real[j]); swapf(imag[i], imag[j]); }
  }
  for (int length = 2; length <= size; length <<= 1) {
    const double angle = (inverse ? 2.0 : -2.0) * kPi / static_cast<double>(length);
    const float wlenR = static_cast<float>(cos(angle));
    const float wlenI = static_cast<float>(sin(angle));
    const int half = length >> 1;
    for (int i = 0; i < size; i += length) {
      float wr = 1.0f;
      float wi = 0.0f;
      for (int j = 0; j < half; ++j) {
        const int a = i + j;
        const int b = a + half;
        const float vr = real[b] * wr - imag[b] * wi;
        const float vi = real[b] * wi + imag[b] * wr;
        const float ur = real[a];
        const float ui = imag[a];
        real[a] = ur + vr;
        imag[a] = ui + vi;
        real[b] = ur - vr;
        imag[b] = ui - vi;
        const float nwr = wr * wlenR - wi * wlenI;
        wi = wr * wlenI + wi * wlenR;
        wr = nwr;
      }
    }
  }
  if (inverse) {
    const float scale = 1.0f / static_cast<float>(size);
    for (int i = 0; i < size; ++i) { real[i] *= scale; imag[i] *= scale; }
  }
}

float linearGainAt(const float *gains, float frequency) {
  if (frequency <= static_cast<float>(kEqFrequencies[0])) return gains[0];
  if (frequency >= static_cast<float>(kEqFrequencies[kEqBands - 1])) return gains[kEqBands - 1];
  const double lf = log10(frequency > 1.0f ? frequency : 1.0f);
  for (int band = 0; band < kEqBands - 1; ++band) {
    const double leftHz = kEqFrequencies[band];
    const double rightHz = kEqFrequencies[band + 1];
    if (frequency < leftHz || frequency > rightHz) continue;
    const double denom = log10(rightHz) - log10(leftHz);
    const double amount = denom > 1.0e-12 ? (lf - log10(leftHz)) / denom : 0.0;
    return static_cast<float>(gains[band] + (gains[band + 1] - gains[band]) * amount);
  }
  return 0.0f;
}

void buildLinearFirTarget() {
  bool flat = true;
  for (int band = 0; band < kEqBands; ++band) {
    if (absf(eqTarget[band]) > 0.00001f) { flat = false; break; }
  }
  for (int i = 0; i < kLinearFirTaps; ++i) linearFirTaps[i] = 0.0f;
  if (flat) {
    linearFirTaps[kLinearFirHalf] = 1.0f;
  } else {
    float designGains[kEqBands];
    for (int band = 0; band < kEqBands; ++band) designGains[band] = eqTarget[band];
    const int nyquistBin = kLinearFirDesignFft / 2;
    const double nyquist = sampleRateHz * 0.5;
    for (int iteration = 0; iteration < 2; ++iteration) {
      for (int i = 0; i < kLinearFirDesignFft; ++i) { linearFftReal[i] = 0.0f; linearFftImag[i] = 0.0f; }
      for (int bin = 0; bin <= nyquistBin; ++bin) {
        const float frequency = static_cast<float>((static_cast<double>(bin) / nyquistBin) * nyquist);
        const float gainDb = linearGainAt(designGains, frequency < 10.0f ? 10.0f : frequency);
        const float amplitude = static_cast<float>(dbToGain(gainDb));
        const double omega = 2.0 * kPi * static_cast<double>(bin) / kLinearFirDesignFft;
        const double phase = -omega * kLinearFirHalf;
        const float re = amplitude * static_cast<float>(cos(phase));
        const float im = amplitude * static_cast<float>(sin(phase));
        linearFftReal[bin] = re;
        linearFftImag[bin] = im;
        if (bin > 0 && bin < nyquistBin) {
          const int mirror = kLinearFirDesignFft - bin;
          linearFftReal[mirror] = re;
          linearFftImag[mirror] = -im;
        }
      }
      fftInPlace(linearFftReal, linearFftImag, kLinearFirDesignFft, true);
      for (int tap = 0; tap < kLinearFirTaps; ++tap) linearFirTaps[tap] = linearFftReal[tap];
      if (iteration < 1) {
        for (int i = 0; i < kLinearFirDesignFft; ++i) { linearFftReal[i] = i < kLinearFirTaps ? linearFirTaps[i] : 0.0f; linearFftImag[i] = 0.0f; }
        fftInPlace(linearFftReal, linearFftImag, kLinearFirDesignFft, false);
        for (int band = 0; band < kEqBands; ++band) {
          const double normalized = kEqFrequencies[band] / sampleRateHz;
          int bin = static_cast<int>(normalized * kLinearFirDesignFft + 0.5);
          if (bin < 0) bin = 0;
          if (bin > nyquistBin) bin = nyquistBin;
          const double re = linearFftReal[bin];
          const double im = linearFftImag[bin];
          const double magnitude = pow(re * re + im * im, 0.5);
          const float actualDb = magnitude > 1.0e-9 ? static_cast<float>(20.0 * log10(magnitude)) : -120.0f;
          const float error = clampf(eqTarget[band] - actualDb, -3.0f, 3.0f);
          designGains[band] = clampf(designGains[band] + error * 0.45f, -15.0f, 15.0f);
        }
      }
    }
  }

  for (int partition = 0; partition < kLinearFirPartitions; ++partition) {
    for (int i = 0; i < kLinearFirFft; ++i) { linearFftReal[i] = 0.0f; linearFftImag[i] = 0.0f; }
    for (int i = 0; i < kLinearFirBlock; ++i) {
      const int tap = partition * kLinearFirBlock + i;
      if (tap < kLinearFirTaps) linearFftReal[i] = linearFirTaps[tap];
    }
    fftInPlace(linearFftReal, linearFftImag, kLinearFirFft, false);
    for (int bin = 0; bin < kLinearFirFft; ++bin) {
      linearTargetReal[partition][bin] = linearFftReal[bin];
      linearTargetImag[partition][bin] = linearFftImag[bin];
    }
  }
}

void resetLinearFir(bool copyTarget) {
  linearBlockPos = 0;
  linearSpectrumWrite = 0;
  for (int ch = 0; ch < 2; ++ch) {
    for (int i = 0; i < kLinearFirBlock; ++i) {
      linearInputBlock[ch][i] = 0.0f;
      linearOutputBlock[ch][i] = 0.0f;
      linearOverlap[ch][i] = 0.0f;
    }
    for (int partition = 0; partition < kLinearFirPartitions; ++partition) {
      for (int bin = 0; bin < kLinearFirFft; ++bin) {
        linearInputSpectrumReal[ch][partition][bin] = 0.0f;
        linearInputSpectrumImag[ch][partition][bin] = 0.0f;
      }
    }
  }
  if (copyTarget) {
    for (int partition = 0; partition < kLinearFirPartitions; ++partition) {
      for (int bin = 0; bin < kLinearFirFft; ++bin) {
        linearFilterReal[partition][bin] = linearTargetReal[partition][bin];
        linearFilterImag[partition][bin] = linearTargetImag[partition][bin];
      }
    }
  }
}

void renderLinearFirBlock() {
  const float smoothing = clampf(static_cast<float>(1.0 - exp(-(kLinearFirBlock / sampleRateHz) / 0.030)), 0.01f, 1.0f);
  for (int partition = 0; partition < kLinearFirPartitions; ++partition) {
    for (int bin = 0; bin < kLinearFirFft; ++bin) {
      linearFilterReal[partition][bin] += (linearTargetReal[partition][bin] - linearFilterReal[partition][bin]) * smoothing;
      linearFilterImag[partition][bin] += (linearTargetImag[partition][bin] - linearFilterImag[partition][bin]) * smoothing;
    }
  }

  for (int ch = 0; ch < 2; ++ch) {
    for (int i = 0; i < kLinearFirFft; ++i) { linearFftReal[i] = 0.0f; linearFftImag[i] = 0.0f; }
    for (int i = 0; i < kLinearFirBlock; ++i) linearFftReal[i] = linearInputBlock[ch][i];
    fftInPlace(linearFftReal, linearFftImag, kLinearFirFft, false);
    for (int bin = 0; bin < kLinearFirFft; ++bin) {
      linearInputSpectrumReal[ch][linearSpectrumWrite][bin] = linearFftReal[bin];
      linearInputSpectrumImag[ch][linearSpectrumWrite][bin] = linearFftImag[bin];
      linearFftReal[bin] = 0.0f;
      linearFftImag[bin] = 0.0f;
    }
    for (int partition = 0; partition < kLinearFirPartitions; ++partition) {
      int history = linearSpectrumWrite - partition;
      while (history < 0) history += kLinearFirPartitions;
      const float *xr = linearInputSpectrumReal[ch][history];
      const float *xi = linearInputSpectrumImag[ch][history];
      const float *hr = linearFilterReal[partition];
      const float *hi = linearFilterImag[partition];
      for (int bin = 0; bin < kLinearFirFft; ++bin) {
        linearFftReal[bin] += xr[bin] * hr[bin] - xi[bin] * hi[bin];
        linearFftImag[bin] += xr[bin] * hi[bin] + xi[bin] * hr[bin];
      }
    }
    fftInPlace(linearFftReal, linearFftImag, kLinearFirFft, true);
    for (int i = 0; i < kLinearFirBlock; ++i) {
      linearOutputBlock[ch][i] = linearFftReal[i] + linearOverlap[ch][i];
      linearOverlap[ch][i] = linearFftReal[i + kLinearFirBlock];
    }
  }
  linearSpectrumWrite = (linearSpectrumWrite + 1) % kLinearFirPartitions;
}

inline void processEqStereo(float &left, float &right) {
  // Keep both paths warm so changing topology does not force a graph rebuild.
  float minimumL = left;
  float minimumR = right;
  if (eqEnabled) {
    for (int band = 0; band < kEqBands; ++band) {
      minimumL = eq[0][band].process(minimumL);
      minimumR = eq[1][band].process(minimumR);
    }
  }

  const float linearL = linearOutputBlock[0][linearBlockPos];
  const float linearR = linearOutputBlock[1][linearBlockPos];
  linearInputBlock[0][linearBlockPos] = left;
  linearInputBlock[1][linearBlockPos] = right;
  linearBlockPos += 1;
  if (linearBlockPos >= kLinearFirBlock) {
    linearBlockPos = 0;
    renderLinearFirBlock();
  }

  if (!eqEnabled) return;
  if (eqTopology == 1) {
    left = linearL;
    right = linearR;
  } else {
    left = minimumL;
    right = minimumR;
  }
}

void configureOutputProfile() {
  // Static correction remains intentionally tiny. The adaptive guard below is
  // profile-aware and cut-only, so the same music preset can travel between
  // car/hi-fi, headphones and Bluetooth without becoming a second musical EQ.
  for (int ch = 0; ch < 2; ++ch) {
    if (outputProfile == 2) {
      // Bluetooth / compact speaker: preserve weight, restore a touch of detail.
      outputHp[ch].setHighpass(sampleRateHz, 42.0);
      outputLow[ch].setLowShelf(sampleRateHz, 105.0, 0.7);
      outputPresence[ch].setPeaking(sampleRateHz, 2800.0, 0.85, 0.65);
      outputHigh[ch].setHighShelf(sampleRateHz, 8200.0, 0.55);
    } else if (outputProfile == 1) {
      // Headphones: near-neutral technical path; immersion remains separate.
      outputHp[ch].setHighpass(sampleRateHz, 16.0);
      outputLow[ch].setLowShelf(sampleRateHz, 90.0, 0.0);
      outputPresence[ch].setPeaking(sampleRateHz, 3000.0, 0.9, 0.0);
      outputHigh[ch].setHighShelf(sampleRateHz, 10000.0, 0.0);
    } else {
      // Car / Hi-Fi: full-range, almost neutral, with only tiny system polish.
      outputHp[ch].setHighpass(sampleRateHz, 18.0);
      outputLow[ch].setLowShelf(sampleRateHz, 82.0, 0.25);
      outputPresence[ch].setPeaking(sampleRateHz, 2900.0, 0.95, 0.2);
      outputHigh[ch].setHighShelf(sampleRateHz, 10500.0, 0.15);
    }
  }

  // Adaptive low-frequency guard. It acts only when the selected output path is
  // being over-driven in its vulnerable low-frequency region. Normal material
  // remains untouched; no makeup gain is applied.
  if (outputProfile == 2) {
    outputGuard.configure(sampleRateHz, 82.0f, 0.82f, -14.5f, 2.2f, 2.0f, 12.0f, 220.0f);
    outputCorrectionProfileScale = 1.0f;
  } else if (outputProfile == 1) {
    outputGuard.configure(sampleRateHz, 55.0f, 0.78f, -8.0f, 0.5f, 1.6f, 18.0f, 260.0f);
    outputCorrectionProfileScale = 0.35f;
  } else {
    outputGuard.configure(sampleRateHz, 58.0f, 0.80f, -10.5f, 1.2f, 1.8f, 15.0f, 240.0f);
    outputCorrectionProfileScale = 0.65f;
  }
  outputGuard.reset();
  meterOutputCorrectionReductionDb = 0.0f;
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

void configureDynamicEq() {
  // Broad, mastering-style bands with conservative maximum cuts.
  dynamicEqBands[0].configure(sampleRateHz, 90.0f, 0.85f, -17.0f, 1.8f, 2.0f, 18.0f, 180.0f);
  dynamicEqBands[1].configure(sampleRateHz, 280.0f, 1.00f, -20.0f, 2.2f, 2.2f, 22.0f, 220.0f);
  dynamicEqBands[2].configure(sampleRateHz, 3200.0f, 1.10f, -22.0f, 2.5f, 2.4f, 10.0f, 150.0f);
  dynamicEqBands[3].configure(sampleRateHz, 7600.0f, 1.00f, -24.0f, 1.8f, 2.0f, 7.0f, 125.0f);
}

void refreshDynamicEqForBlock(int frames) {
  const float seconds = static_cast<float>(frames) / sampleRateHz;
  meterDynamicEqMaxReductionDb = 0.0f;
  for (int band = 0; band < 4; ++band) {
    dynamicEqBands[band].update(sampleRateHz, dynamicEqEnabled ? dynamicEqAmount : 0.0f, seconds);
    meterDynamicEqBandReductionDb[band] = dynamicEqBands[band].reductionDb;
    if (meterDynamicEqBandReductionDb[band] > meterDynamicEqMaxReductionDb) {
      meterDynamicEqMaxReductionDb = meterDynamicEqBandReductionDb[band];
    }
  }
}

inline void processDynamicEq(float &left, float &right) {
  if (!dynamicEqEnabled && meterDynamicEqMaxReductionDb <= 0.001f) return;
  for (int band = 0; band < 4; ++band) dynamicEqBands[band].process(left, right);
}

void refreshOutputCorrectionForBlock(int frames) {
  const float seconds = static_cast<float>(frames) / sampleRateHz;
  const float amount = outputCorrectionEnabled
    ? clampf(outputCorrectionAmount * outputCorrectionProfileScale, 0.0f, 1.0f)
    : 0.0f;
  outputGuard.update(sampleRateHz, amount, seconds);
  meterOutputCorrectionReductionDb = outputGuard.reductionDb;
}

inline void processOutputCorrection(float &left, float &right) {
  if (!outputCorrectionEnabled && meterOutputCorrectionReductionDb <= 0.001f) return;
  outputGuard.process(left, right);
}

void configureLoudness() {
  loudnessWindowFrames = static_cast<int>(sampleRateHz * 0.400f + 0.5f);
  if (loudnessWindowFrames < 1) loudnessWindowFrames = 1;
  if (loudnessWindowFrames > kLoudnessWindowMax) loudnessWindowFrames = kLoudnessWindowMax;
  loudnessBlockFrames = static_cast<int>(sampleRateHz * 0.100f + 0.5f);
  if (loudnessBlockFrames < 1) loudnessBlockFrames = 1;

  // BS.1770 K-weighting approximation using the standardized corner frequencies.
  // The existing RBJ biquads keep coefficients sample-rate independent.
  for (int ch = 0; ch < 2; ++ch) {
    loudnessHighShelf[ch].setHighShelf(sampleRateHz, 1681.974450955533, 3.999843853973347);
    loudnessHighpass[ch].setHighpass(sampleRateHz, 38.13547087602444, 0.5003270373238773);
  }

  // ~1.5 s for attenuation, ~4.0 s for upward gain. This is deliberately too slow
  // to chase drums or phrases, but fast enough to settle early in a track.
  loudnessGainDownCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 3.0)));
  loudnessGainUpCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 5.0)));
  loudnessBypassReturnCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.25)));
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

inline float energyToLufs(double energy) {
  if (!(energy > 1.0e-12)) return -70.0f;
  const float value = static_cast<float>(-0.691 + 10.0 * log10(energy));
  return clampf(value, -70.0f, 12.0f);
}

void updateLoudnessTargetFromBlock() {
  if (loudnessBlockCount <= 0) return;
  const double blockMeanEnergy = loudnessBlockEnergySum / loudnessBlockCount;
  const float blockLufs = energyToLufs(blockMeanEnergy);

  // Absolute gate, then a causal approximation of the BS.1770 relative gate.
  // The first few blocks establish the program reference; later blocks must sit
  // within 10 LU of the accumulated program level to affect normalization.
  const bool aboveAbsoluteGate = blockLufs > -70.0f;
  const bool aboveRelativeGate = loudnessProgramBlockCount < 4 || blockLufs > loudnessProgramLufs - 10.0f;
  if (aboveAbsoluteGate && aboveRelativeGate) {
    loudnessProgramEnergySum += blockMeanEnergy;
    loudnessProgramBlockCount += 1;
    loudnessProgramLufs = energyToLufs(loudnessProgramEnergySum / loudnessProgramBlockCount);
  }

  // Volume Match is an optional utility, not an always-on mastering stage.
  // Wait for about two seconds of accepted program so quiet intros do not cause
  // a sudden correction. Tracks already within +/-1 LU of the target are left
  // completely untouched, and total correction is capped to +/-3 dB.
  float desiredDb = 0.0f;
  if (loudnessEnabled && loudnessProgramBlockCount >= 20 && loudnessProgramLufs > -60.0f) {
    const float differenceDb = loudnessTargetLufs - loudnessProgramLufs;
    if (absf(differenceDb) > 1.0f) {
      desiredDb = clampf(differenceDb, -3.0f, 3.0f);
    }
  }
  loudnessTargetGain = static_cast<float>(dbToGain(desiredDb));
  loudnessBlockCount = 0;
  loudnessBlockEnergySum = 0.0;
}

void processLoudness(float &left, float &right) {
  if (!loudnessEnabled) {
    loudnessTargetGain = 1.0f;
    loudnessGain += (1.0f - loudnessGain) * loudnessBypassReturnCoeff;
    loudnessGainDb = loudnessGain > 0.000001f ? static_cast<float>(20.0 * log10(loudnessGain)) : 0.0f;
    return;
  }

  const float weightedL = loudnessHighpass[0].process(loudnessHighShelf[0].process(left));
  const float weightedR = loudnessHighpass[1].process(loudnessHighShelf[1].process(right));
  const float energy = weightedL * weightedL + weightedR * weightedR;

  const float oldEnergy = loudnessEnergyWindow[loudnessWindowWrite];
  loudnessEnergyWindow[loudnessWindowWrite] = energy;
  loudnessWindowWrite += 1;
  if (loudnessWindowWrite >= loudnessWindowFrames) loudnessWindowWrite = 0;
  if (loudnessWindowCount < loudnessWindowFrames) {
    loudnessWindowCount += 1;
    loudnessWindowEnergySum += energy;
  } else {
    loudnessWindowEnergySum += static_cast<double>(energy) - oldEnergy;
  }

  loudnessBlockEnergySum += energy;
  loudnessBlockCount += 1;
  if (loudnessBlockCount >= loudnessBlockFrames) updateLoudnessTargetFromBlock();

  if (loudnessWindowCount > 0) {
    loudnessMomentaryLufs = energyToLufs(loudnessWindowEnergySum / loudnessWindowCount);
  }

  const float coeff = loudnessTargetGain < loudnessGain ? loudnessGainDownCoeff : loudnessGainUpCoeff;
  loudnessGain += (loudnessTargetGain - loudnessGain) * coeff;
  left *= loudnessGain;
  right *= loudnessGain;
  loudnessGainDb = loudnessGain > 0.000001f ? static_cast<float>(20.0 * log10(loudnessGain)) : 0.0f;
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
  eqTopology = 0;
  buildLinearFirTarget();
  resetLinearFir(true);
  targetPreampDb = 0.0f;
  headroomDb = 0.0f;
  currentPreampGain = 1.0f;
  configureOutputProfile();
  configureHeadphoneBass();
  configureMultiband();
  configureDynamicEq();
  configureLoudness();
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
__attribute__((visibility("default"))) void mvp_set_eq_topology(int value) { eqTopology = value == 1 ? 1 : 0; }
__attribute__((visibility("default"))) void mvp_set_eq_band(int index, float gainDb) {
  if (index < 0 || index >= kEqBands) return;
  eqTarget[index] = clampf(gainDb, -12.0f, 12.0f);
}
__attribute__((visibility("default"))) void mvp_commit_eq() { buildLinearFirTarget(); }
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
__attribute__((visibility("default"))) void mvp_set_dynamic_eq(int enabled, float amount) {
  const int nextEnabled = enabled ? 1 : 0;
  if (nextEnabled && !dynamicEqEnabled) {
    for (int band = 0; band < 4; ++band) dynamicEqBands[band].reset();
  }
  dynamicEqEnabled = nextEnabled;
  dynamicEqAmount = clampf(amount, 0.0f, 1.0f);
}

__attribute__((visibility("default"))) void mvp_set_loudness(int enabled, float targetLufs) {
  const int nextEnabled = enabled ? 1 : 0;
  loudnessTargetLufs = clampf(targetLufs, -24.0f, -8.0f);
  if (nextEnabled && !loudnessEnabled) resetLoudnessState();
  loudnessEnabled = nextEnabled;
  if (!loudnessEnabled) loudnessTargetGain = 1.0f;
}
__attribute__((visibility("default"))) void mvp_reset_loudness() { resetLoudnessState(); }
__attribute__((visibility("default"))) void mvp_set_limiter(int enabled, float ceilingDb) {
  limiterEnabled = enabled ? 1 : 0;
  limiterCeilingDb = clampf(ceilingDb, -6.0f, -0.1f);
  limiterCeilingGain = static_cast<float>(dbToGain(limiterCeilingDb));
}
__attribute__((visibility("default"))) void mvp_set_output_profile(int profile) {
  outputProfile = profile < 0 ? 0 : (profile > 2 ? 2 : profile);
  configureOutputProfile();
}
__attribute__((visibility("default"))) void mvp_set_output_correction(int enabled, float amount) {
  const int nextEnabled = enabled ? 1 : 0;
  if (nextEnabled && !outputCorrectionEnabled) outputGuard.reset();
  outputCorrectionEnabled = nextEnabled;
  outputCorrectionAmount = clampf(amount, 0.0f, 1.0f);
  if (!outputCorrectionEnabled) meterOutputCorrectionReductionDb = 0.0f;
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
  refreshDynamicEqForBlock(frames);
  refreshOutputCorrectionForBlock(frames);
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
    processEqStereo(left, right);
    processTransient(left, right);
    processMultiband(left, right);
    processDynamicEq(left, right);
    left = processOutput(0, left);
    right = processOutput(1, right);
    processOutputCorrection(left, right);
    processHeadphone(left, right);
    processLoudness(left, right);

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
__attribute__((visibility("default"))) float mvp_meter_dynamic_eq_gain_reduction_db() { return meterDynamicEqMaxReductionDb; }
__attribute__((visibility("default"))) float mvp_meter_dynamic_eq_band_reduction_db(int band) {
  if (band < 0 || band >= 4) return 0.0f;
  return meterDynamicEqBandReductionDb[band];
}
__attribute__((visibility("default"))) float mvp_meter_output_correction_reduction_db() { return meterOutputCorrectionReductionDb; }
__attribute__((visibility("default"))) float mvp_meter_loudness_gain_db() { return loudnessGainDb; }
__attribute__((visibility("default"))) float mvp_meter_loudness_momentary_lufs() { return loudnessMomentaryLufs; }
__attribute__((visibility("default"))) float mvp_meter_loudness_program_lufs() { return loudnessProgramLufs; }
__attribute__((visibility("default"))) int mvp_eq_topology() { return eqTopology; }
__attribute__((visibility("default"))) int mvp_linear_phase_taps() { return kLinearFirTaps; }
__attribute__((visibility("default"))) int mvp_linear_phase_latency_samples() { return kLinearFirHalf + kLinearFirBlock; }
}
