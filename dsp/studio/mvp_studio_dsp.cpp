// MVP Trainer Pro - MVP Studio V5 Advanced Audio Engine
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

  void setNotch(double sampleRate, double frequency, double q = 1.0) {
    const double f = clampd(frequency, 10.0, sampleRate * 0.475);
    const double safeQ = clampd(q, 0.15, 20.0);
    const double w0 = 2.0 * kPi * f / sampleRate;
    const double cw = cos(w0);
    const double sw = sin(w0);
    const double alpha = sw / (2.0 * safeQ);
    const double a0n = 1.0 + alpha;
    b0 = 1.0 / a0n;
    b1 = (-2.0 * cw) / a0n;
    b2 = 1.0 / a0n;
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
int eqTopologyTarget = 0;
int eqTopologyTransitionPhase = 0; // 0 idle, 1 fade out, 2 fade in
float eqTopologyTransitionGain = 1.0f;
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
Biquad headphoneSideLowpass;
// V3 Phase 6 Stereo Integrity: mono-compatible low bass + adaptive anti-phase guard.
Biquad stereoSideLowpass;

float limiterDelayL[kMaxLookahead];
float limiterDelayR[kMaxLookahead];
int limiterWrite = 0;
int limiterLookahead = 240;
float limiterGain = 1.0f;

// V3 Phase 4 true-peak detector. ITU-R BS.1770 Annex 2 provides a
// 48th-order, 4-phase FIR interpolator for estimating inter-sample peaks.
// The detector runs at an effective 4x rate while the audio path stays at
// the native sample rate. Limiter lookahead is much longer than the FIR
// group delay, so the gain envelope can react before the delayed audio exits.
constexpr int kTruePeakTapsPerPhase = 12;
constexpr int kTruePeakPhases = 4;
const float kTruePeakCoeffs[kTruePeakTapsPerPhase][kTruePeakPhases] = {
  { 0.0017089843750f, -0.0291748046875f, -0.0189208984375f, -0.0083007812500f },
  { 0.0109863281250f,  0.0292968750000f,  0.0330810546875f,  0.0148925781250f },
  {-0.0196533203125f, -0.0517578125000f, -0.0582275390625f, -0.0266113281250f },
  { 0.0332031250000f,  0.0891113281250f,  0.1015625000000f,  0.0476074218750f },
  {-0.0594482421875f, -0.1665039062500f, -0.2003173828125f, -0.1022949218750f },
  { 0.1373291015625f,  0.4650878906250f,  0.7797851562500f,  0.9721679687500f },
  { 0.9721679687500f,  0.7797851562500f,  0.4650878906250f,  0.1373291015625f },
  {-0.1022949218750f, -0.2003173828125f, -0.1665039062500f, -0.0594482421875f },
  { 0.0476074218750f,  0.1015625000000f,  0.0891113281250f,  0.0332031250000f },
  {-0.0266113281250f, -0.0582275390625f, -0.0517578125000f, -0.0196533203125f },
  { 0.0148925781250f,  0.0330810546875f,  0.0292968750000f,  0.0109863281250f },
  {-0.0083007812500f, -0.0189208984375f, -0.0291748046875f,  0.0017089843750f },
};
float truePeakHistoryL[kTruePeakTapsPerPhase] = {};
float truePeakHistoryR[kTruePeakTapsPerPhase] = {};
float truePeakOutputHistoryL[kTruePeakTapsPerPhase] = {};
float truePeakOutputHistoryR[kTruePeakTapsPerPhase] = {};
// R76 Max-HD controller uses the SAME oversampled true-peak model as Peak Guard.
// This removes the sample-peak/true-peak mismatch that caused the old controller
// to repeatedly chase the limiter ceiling on real mastered music.
float maxHdTruePeakHistoryL[kTruePeakTapsPerPhase] = {};
float maxHdTruePeakHistoryR[kTruePeakTapsPerPhase] = {};
float maxHdHeldTruePeak = 0.0f;
float maxHdLimiterFeedbackDb = 0.0f;
float maxHdPeakReleaseCoeff = 0.00002f;
float maxHdGainRiseCoeff = 0.00001f;
float maxHdGainFallCoeff = 0.001f;
float maxHdFeedbackReleaseCoeff = 0.00002f;
float meterMaxHdInputTruePeakDbtp = -120.0f;
float meterTruePeakLinear = 0.0f;

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
// V4.5 headphone-only final drive. This is deliberately separate from the
// upstream preamp so max phone/headphone playback can recover usable loudness
// without changing Car/Hi-Fi or Bluetooth output profiles.
float headphoneOutputDriveGain = 1.0f;
float meterHeadphoneOutputDriveDb = 0.0f;


// MVP Studio V5 Advanced Audio Engine. All processors below are original,
// allocation-free DSP owned by MVP Trainer Pro and run inside this WASM core.
constexpr int kParametricBands = 6;
struct ParametricBandState {
  int enabled = 0;
  float frequency = 1000.0f;
  float gainDb = 0.0f;
  float q = 1.0f;
  int type = 0; // 0 bell, 1 low shelf, 2 high shelf, 3 HPF, 4 LPF, 5 notch approximation
  Biquad filter[2];
};
ParametricBandState parametricBands[kParametricBands];
int parametricEnabled = 0;

int bassEngineEnabled = 0;
float bassSubDb = 0.0f;
float bassPunchDb = 0.0f;
float bassBodyDb = 0.0f;
float bassTightness = 0.5f;
Biquad bassSubFilter[2];
Biquad bassPunchFilter[2];
Biquad bassBodyFilter[2];
Biquad bassTightFilter[2];
// R71 psychoacoustic bass: derive audible upper harmonics from low bass rather
// than forcing smaller drivers to reproduce an even lower octave. The dry bass
// remains untouched; this band-limited harmonic layer only adds perceived depth.
Biquad neuralBassLowpass[2];
Biquad neuralBassHarmonicHighpass[2];
Biquad neuralBassHarmonicLowpass[2];

int toneEngineEnabled = 0;
float presenceDb = 0.0f;
float clarityDb = 0.0f;
float airDb = 0.0f;
float deharshAmount = 0.0f;
Biquad presenceFilter[2];
Biquad clarityFilter[2];
Biquad airFilter[2];
DynamicEqBand deharshBand;

int exciterEnabled = 0;
float exciterAmount = 0.0f;
float saturationLow = 0.0f;
float saturationMid = 0.0f;
float saturationHigh = 0.0f;
Biquad exciterHighpass[2];
Biquad saturationLowpass[2];
Biquad saturationHighpass[2];

int stereoFieldEnabled = 0;
float stereoUserWidth = 1.0f;
float stereoCenterFocus = 1.0f;
float bassMonoHz = 100.0f;
Biquad bassMonoSideLp;

int dynamicsRestoreEnabled = 0;
float dynamicsRestoreAmount = 0.0f;
float restoreFastEnvelope = 0.0f;
float restoreSlowEnvelope = 0.0f;

int smartDspEnabled = 0;
float smartDspAmount = 0.0f;
float smartLowEnvelope = 0.0f;
float smartHighEnvelope = 0.0f;
Biquad smartLowDetector;
Biquad smartHighDetector;

// R75 final linked music compressor for simplified Headphones/Bluetooth paths.
// It runs AFTER EQ/effects/spatial so it manages the sound the listener actually hears.
// It only creates modest crest-factor room for High/Max Output; the adaptive makeup
// stage then fills that room and Peak Guard remains the final emergency catcher.
float finalCompEnvelope = 0.0f;
float finalCompGain = 1.0f;
float finalCompDetectorAttackCoeff = 0.02f;
float finalCompDetectorReleaseCoeff = 0.001f;
float finalCompGainAttackCoeff = 0.02f;
float finalCompGainReleaseCoeff = 0.001f;
float meterFinalCompressorReductionDb = 0.0f;
// R76 hidden Max-HD loudness limiter. It deliberately performs the normal
// crest-factor reduction needed for loud playback BEFORE the visible Peak Guard.
// Peak Guard then remains an emergency true-peak safety net instead of flashing
// continuously as part of the loudness algorithm.
float maxHdCompDelayL[kMaxLookahead] = {};
float maxHdCompDelayR[kMaxLookahead] = {};
int maxHdCompWrite = 0;
int maxHdCompLookahead = 1;
float maxHdCompTruePeakHistoryL[kTruePeakTapsPerPhase] = {};
float maxHdCompTruePeakHistoryR[kTruePeakTapsPerPhase] = {};

int autoMakeupEnabled = 0;
float autoMakeupGain = 1.0f;
float outputReserveDb = 0.0f;
float outputReserveGain = 1.0f;
float cleanOutputDriveGain = 1.0f;
float meterAutoMakeupDb = 0.0f;
float meterOutputReserveDb = 0.0f;
float meterAvailableHeadroomDb = 12.0f;
float meterInternalPeak = 0.0f;
float meterEqActivityDb = 0.0f;
float meterBassActivityDb = 0.0f;
float meterToneActivityDb = 0.0f;
float meterExciterActivity = 0.0f;
float meterDeharshReductionDb = 0.0f;
float meterSmartActivity = 0.0f;

int headphoneAdvancedEnabled = 0;
float headphoneSpeakerAngle = 30.0f;
float headphoneDistance = 0.35f;
float headphoneReflections = 0.06f;
float headphoneWet = 0.24f;
// Studio Stereo Integrity is automatic for every processed non-reference path.
int stereoIntegrityEnabled = 1;
float stereoIntegrityAmount = 1.0f;
float stereoCorrelationEnergy = 0.0f;
float stereoCorrelationCross = 0.0f;
float stereoGuardGain = 1.0f;
float meterStereoCorrelation = 1.0f;
float meterStereoWidthPercent = 100.0f;
float meterStereoGuardReductionDb = 0.0f;
float targetPreampDb = 0.0f;
float headroomDb = 0.0f;
float currentPreampGain = 1.0f;
float limiterCeilingDb = -1.0f;
float limiterCeilingGain = 0.89125094f;
float limiterDetectorCeilingGain = 0.88104887f; // -1.1 dB internal guard for a displayed -1.0 dBTP ceiling.
constexpr float kTruePeakSafetyDb = 0.10f;
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
  for (int i = 0; i < kMaxLookahead; ++i) {
    limiterDelayL[i] = 0.0f; limiterDelayR[i] = 0.0f;
    maxHdCompDelayL[i] = 0.0f; maxHdCompDelayR[i] = 0.0f;
  }
  for (int i = 0; i < kSpatialDelayMax; ++i) { spatialDelayL[i] = 0.0f; spatialDelayR[i] = 0.0f; }
  limiterWrite = 0; maxHdCompWrite = 0; spatialWrite = 0; limiterGain = 1.0f;
  meterTruePeakLinear = 0.0f;
  for (int tap = 0; tap < kTruePeakTapsPerPhase; ++tap) {
    truePeakHistoryL[tap] = 0.0f;
    truePeakHistoryR[tap] = 0.0f;
    truePeakOutputHistoryL[tap] = 0.0f;
    truePeakOutputHistoryR[tap] = 0.0f;
    maxHdTruePeakHistoryL[tap] = 0.0f;
    maxHdTruePeakHistoryR[tap] = 0.0f;
    maxHdCompTruePeakHistoryL[tap] = 0.0f;
    maxHdCompTruePeakHistoryR[tap] = 0.0f;
  }
  maxHdHeldTruePeak = 0.0f;
  maxHdLimiterFeedbackDb = 0.0f;
  meterMaxHdInputTruePeakDbtp = -120.0f;
  crossfeedStateL = crossfeedStateR = 0.0;
  headphoneOutputDriveGain = 1.0f;
  meterHeadphoneOutputDriveDb = 0.0f;
  cleanOutputDriveGain = 1.0f;
  headphoneSideLowpass.reset();
  stereoSideLowpass.reset();
  stereoCorrelationEnergy = 0.0f;
  stereoCorrelationCross = 0.0f;
  stereoGuardGain = 1.0f;
  meterStereoCorrelation = 1.0f;
  meterStereoWidthPercent = 100.0f;
  meterStereoGuardReductionDb = 0.0f;
  resetLoudnessState();
  resetLinearFir(false);
  transientFastEnvelope = 0.0f;
  transientSlowEnvelope = 0.0f;
  transientGain = 1.0f;
  meterTransientBoostDb = 0.0f;
  meterMultibandGainReductionDb = 0.0f;
  meterDynamicEqMaxReductionDb = 0.0f;
  meterOutputCorrectionReductionDb = 0.0f;
  finalCompEnvelope = 0.0f;
  finalCompGain = 1.0f;
  meterFinalCompressorReductionDb = 0.0f;
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
    for (int iteration = 0; iteration < 4; ++iteration) {
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
      if (iteration < 3) {
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
          designGains[band] = clampf(designGains[band] + error * 0.68f, -15.0f, 15.0f);
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


void configureParametricBand(int index) {
  if (index < 0 || index >= kParametricBands) return;
  auto &band = parametricBands[index];
  for (int ch = 0; ch < 2; ++ch) {
    if (!band.enabled) { band.filter[ch].setIdentity(); continue; }
    if (band.type == 3) band.filter[ch].setHighpass(sampleRateHz, band.frequency, band.q);
    else if (band.type == 4) band.filter[ch].setLowpass(sampleRateHz, band.frequency, band.q);
    else if (band.type == 5) band.filter[ch].setNotch(sampleRateHz, band.frequency, band.q);
    else if (absf(band.gainDb) < 0.001f) band.filter[ch].setIdentity();
    else if (band.type == 1) band.filter[ch].setLowShelf(sampleRateHz, band.frequency, band.gainDb);
    else if (band.type == 2) band.filter[ch].setHighShelf(sampleRateHz, band.frequency, band.gainDb);
    else band.filter[ch].setPeaking(sampleRateHz, band.frequency, band.q, band.gainDb);
  }
}

void configureAdvancedTone() {
  for (int ch = 0; ch < 2; ++ch) {
    bassSubFilter[ch].setLowShelf(sampleRateHz, 48.0, bassEngineEnabled ? bassSubDb : 0.0f);
    bassPunchFilter[ch].setPeaking(sampleRateHz, 82.0, 0.82, bassEngineEnabled ? bassPunchDb : 0.0f);
    bassBodyFilter[ch].setPeaking(sampleRateHz, 145.0, 0.72, bassEngineEnabled ? bassBodyDb : 0.0f);
    const float tightHz = 18.0f + clampf(bassTightness, 0.0f, 1.0f) * 18.0f;
    bassTightFilter[ch].setHighpass(sampleRateHz, tightHz, 0.72);
    neuralBassLowpass[ch].setLowpass(sampleRateHz, 118.0, 0.72);
    neuralBassHarmonicHighpass[ch].setHighpass(sampleRateHz, 92.0, 0.72);
    neuralBassHarmonicLowpass[ch].setLowpass(sampleRateHz, 360.0, 0.72);
    presenceFilter[ch].setPeaking(sampleRateHz, 3200.0, 0.78, toneEngineEnabled ? presenceDb : 0.0f);
    clarityFilter[ch].setPeaking(sampleRateHz, 6800.0, 0.72, toneEngineEnabled ? clarityDb : 0.0f);
    airFilter[ch].setHighShelf(sampleRateHz, 11500.0, toneEngineEnabled ? airDb : 0.0f);
    exciterHighpass[ch].setHighpass(sampleRateHz, 3000.0, 0.71);
    saturationLowpass[ch].setLowpass(sampleRateHz, 180.0, 0.71);
    saturationHighpass[ch].setHighpass(sampleRateHz, 3500.0, 0.71);
  }
  deharshBand.configure(sampleRateHz, 3900.0f, 1.05f, -19.0f, 4.5f, 2.2f, 8.0f, 190.0f);
  bassMonoSideLp.setLowpass(sampleRateHz, clampf(bassMonoHz, 60.0f, 160.0f), 0.70710678);
  smartLowDetector.setLowpass(sampleRateHz, 220.0, 0.70710678);
  smartHighDetector.setHighpass(sampleRateHz, 2800.0, 0.70710678);
  for (int i = 0; i < kParametricBands; ++i) configureParametricBand(i);
}

inline float softSaturate(float x, float amount) {
  const float a = clampf(amount, 0.0f, 1.0f);
  if (a <= 0.0001f) return x;
  const float drive = 1.0f + a * 2.8f;
  const float y = x * drive;
  const float ay = absf(y);
  const float shaped = y / (1.0f + ay * (0.45f + a * 0.25f));
  const float normalization = 1.0f + a * 1.15f;
  return shaped * normalization;
}

void processParametric(float &left, float &right) {
  if (!parametricEnabled) return;
  for (int i = 0; i < kParametricBands; ++i) {
    if (!parametricBands[i].enabled) continue;
    left = parametricBands[i].filter[0].process(left);
    right = parametricBands[i].filter[1].process(right);
  }
}

void processBassEngine(float &left, float &right) {
  if (!bassEngineEnabled) { meterBassActivityDb = 0.0f; return; }

  // Keep the real low-frequency content and the user's chosen bass curve.
  left = bassSubFilter[0].process(left);
  right = bassSubFilter[1].process(right);
  left = bassPunchFilter[0].process(left);
  right = bassPunchFilter[1].process(right);
  left = bassBodyFilter[0].process(left);
  right = bassBodyFilter[1].process(right);
  left = bassTightFilter[0].process(left);
  right = bassTightFilter[1].process(right);

  // R71 Neural Bass for the simplified Headphones / Bluetooth Speaker paths.
  // A missing-fundamental style harmonic layer is safer and more audible on
  // small drivers than synthesizing an octave *below* the existing bass. It is
  // deliberately modest, stereo-linked in amount, and band-limited to keep the
  // midrange clean. Car / Hi-Fi keeps its existing bass-engine behavior.
  if (outputProfile == 1 || outputProfile == 2) {
    const float strength = clampf((bassSubDb + 0.55f * bassPunchDb) / 6.0f, 0.0f, 1.0f);
    if (strength > 0.001f) {
      const float lowL = neuralBassLowpass[0].process(left);
      const float lowR = neuralBassLowpass[1].process(right);
      const float drive = 0.22f + strength * 0.34f;
      float harmonicL = softSaturate(lowL, drive) - lowL;
      float harmonicR = softSaturate(lowR, drive) - lowR;
      harmonicL = neuralBassHarmonicHighpass[0].process(harmonicL);
      harmonicR = neuralBassHarmonicHighpass[1].process(harmonicR);
      harmonicL = neuralBassHarmonicLowpass[0].process(harmonicL);
      harmonicR = neuralBassHarmonicLowpass[1].process(harmonicR);
      const float mix = 0.32f * strength;
      left += harmonicL * mix;
      right += harmonicR * mix;
    }
  }

  meterBassActivityDb = (absf(bassSubDb) + absf(bassPunchDb) + absf(bassBodyDb)) / 3.0f;
}

void processToneEngine(float &left, float &right) {
  if (toneEngineEnabled) {
    left = presenceFilter[0].process(left); right = presenceFilter[1].process(right);
    left = clarityFilter[0].process(left); right = clarityFilter[1].process(right);
    left = airFilter[0].process(left); right = airFilter[1].process(right);
    meterToneActivityDb = (absf(presenceDb) + absf(clarityDb) + absf(airDb)) / 3.0f;
  } else meterToneActivityDb = 0.0f;
  if (deharshAmount > 0.0001f) {
    deharshBand.process(left, right);
    const float seconds = 1.0f / sampleRateHz;
    deharshBand.update(sampleRateHz, deharshAmount, seconds);
    meterDeharshReductionDb = deharshBand.reductionDb;
  } else meterDeharshReductionDb = 0.0f;
}

void processExciter(float &left, float &right) {
  const float amount = exciterEnabled ? clampf(exciterAmount, 0.0f, 1.0f) : 0.0f;
  const float originalL = left, originalR = right;
  if (amount > 0.0001f) {
    const float saturatedL = softSaturate(left, amount * 0.75f);
    const float saturatedR = softSaturate(right, amount * 0.75f);
    const float harmonicL = exciterHighpass[0].process(saturatedL - left);
    const float harmonicR = exciterHighpass[1].process(saturatedR - right);
    left += harmonicL * amount * 0.68f;
    right += harmonicR * amount * 0.68f;
  }
  if (saturationLow > 0.0001f || saturationMid > 0.0001f || saturationHigh > 0.0001f) {
    const float lowL = saturationLowpass[0].process(left);
    const float lowR = saturationLowpass[1].process(right);
    const float highL = saturationHighpass[0].process(left);
    const float highR = saturationHighpass[1].process(right);
    const float midL = left - lowL - highL;
    const float midR = right - lowR - highR;
    left = softSaturate(lowL, saturationLow) + softSaturate(midL, saturationMid) + softSaturate(highL, saturationHigh);
    right = softSaturate(lowR, saturationLow) + softSaturate(midR, saturationMid) + softSaturate(highR, saturationHigh);
  }
  meterExciterActivity = clampf((absf(left-originalL)+absf(right-originalR))*8.0f,0.0f,1.0f);
}

void processStereoFieldUser(float &left, float &right) {
  if (!stereoFieldEnabled) return;
  float mid = 0.5f * (left + right);
  float side = 0.5f * (left - right);
  const float lowSide = bassMonoSideLp.process(side);
  const float highSide = side - lowSide;
  const float monoAmount = clampf((bassMonoHz - 60.0f) / 100.0f, 0.0f, 1.0f) * 0.82f;
  side = lowSide * (1.0f - monoAmount) + highSide;
  side *= clampf(stereoUserWidth, 0.5f, 1.65f);
  mid *= clampf(stereoCenterFocus, 0.75f, 1.30f);
  left = mid + side;
  right = mid - side;
}

void processDynamicsRestore(float &left, float &right) {
  if (!dynamicsRestoreEnabled || dynamicsRestoreAmount <= 0.0001f) return;
  const float detector = absf(left) > absf(right) ? absf(left) : absf(right);
  const float fastCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.006)));
  const float slowCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.120)));
  restoreFastEnvelope += (detector - restoreFastEnvelope) * fastCoeff;
  restoreSlowEnvelope += (detector - restoreSlowEnvelope) * slowCoeff;
  const float crest = clampf((restoreFastEnvelope - restoreSlowEnvelope) / (restoreSlowEnvelope + 0.03f), 0.0f, 1.0f);
  const float gain = static_cast<float>(dbToGain(crest * dynamicsRestoreAmount * 1.6f));
  left *= gain; right *= gain;
}

void processSmartDsp(float &left, float &right) {
  if (!smartDspEnabled || smartDspAmount <= 0.0001f) { meterSmartActivity = 0.0f; return; }
  const float low = 0.5f * (absf(smartLowDetector.process(left)) + absf(smartLowDetector.process(right)));
  const float high = 0.5f * (absf(smartHighDetector.process(left)) + absf(smartHighDetector.process(right)));
  const float coeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.180)));
  smartLowEnvelope += (low-smartLowEnvelope)*coeff;
  smartHighEnvelope += (high-smartHighEnvelope)*coeff;
  const float imbalance = clampf((smartLowEnvelope-smartHighEnvelope)*2.4f,-1.0f,1.0f);
  const float mid = 0.5f*(left+right);
  const float side = 0.5f*(left-right);
  const float correction = 1.0f - absf(imbalance)*smartDspAmount*0.055f;
  left = mid + side*correction;
  right = mid - side*correction;
  meterSmartActivity = absf(imbalance)*smartDspAmount;
}

inline float updateTruePeakDetector(float *history, float sample);

void processFinalCompressor(float &left, float &right) {
  const bool simplifiedProfile = outputProfile == 1 || outputProfile == 2;
  const bool simplifiedMaxHd = simplifiedProfile && outputReserveDb > 0.01f;

  if (!simplifiedProfile) {
    finalCompGain = 1.0f;
    meterFinalCompressorReductionDb = 0.0f;
    return;
  }

  // Always keep the tiny lookahead delay warm on Headphones/Bluetooth so toggling
  // High/Max Output does not change timing or force a new graph. The OFF state is
  // bit-level gain neutral apart from this inaudible ~2.5 ms latency.
  const float tpL = updateTruePeakDetector(maxHdCompTruePeakHistoryL, left);
  const float tpR = updateTruePeakDetector(maxHdCompTruePeakHistoryR, right);
  const float detector = tpL > tpR ? tpL : tpR;

  maxHdCompDelayL[maxHdCompWrite] = left;
  maxHdCompDelayR[maxHdCompWrite] = right;
  int read = maxHdCompWrite - maxHdCompLookahead;
  if (read < 0) read += kMaxLookahead;
  const float delayedL = maxHdCompDelayL[read];
  const float delayedR = maxHdCompDelayR[read];
  maxHdCompWrite = (maxHdCompWrite + 1) % kMaxLookahead;

  float required = 1.0f;
  if (simplifiedMaxHd && detector > 0.0000001f) {
    // The hidden loudness limiter controls normal programme peaks around -4 dBTP.
    // The following adaptive makeup stage then raises the denser signal toward the
    // final -1.3 dBTP target. This is the same separation used in commercial
    // loudness playback: loudness control first, safety limiter last.
    const float loudnessCeiling = static_cast<float>(dbToGain(-4.0f));
    if (detector > loudnessCeiling) required = loudnessCeiling / detector;
  }

  if (required < finalCompGain) {
    // Lookahead gives us the attack; make gain reduction essentially immediate.
    finalCompGain = required;
  } else {
    // ~80 ms recovery keeps drums punchy without audible pumping.
    finalCompGain += (1.0f - finalCompGain) * finalCompGainReleaseCoeff;
  }
  if (!simplifiedMaxHd) finalCompGain += (1.0f - finalCompGain) * 0.08f;
  finalCompGain = clampf(finalCompGain, 0.25f, 1.0f);

  left = delayedL * finalCompGain;
  right = delayedR * finalCompGain;
  meterFinalCompressorReductionDb = simplifiedMaxHd && finalCompGain < 0.999999f
    ? static_cast<float>(-20.0 * log10(finalCompGain)) : 0.0f;
}

void processOutputGain(float &left, float &right) {
  const float preLimitPeak = absf(left) > absf(right) ? absf(left) : absf(right);
  if (preLimitPeak > meterInternalPeak) meterInternalPeak = preLimitPeak;

  float makeupTargetDb = 0.0f;
  if (autoMakeupEnabled) {
    makeupTargetDb = clampf(multibandEnabled ? meterMultibandGainReductionDb * 0.35f : 0.0f, 0.0f, 2.0f);
    makeupTargetDb += clampf(deharshAmount * meterDeharshReductionDb * 0.15f, 0.0f, 0.8f);
  }
  const float makeupTarget = static_cast<float>(dbToGain(makeupTargetDb));
  const float makeupCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.350)));
  autoMakeupGain += (makeupTarget-autoMakeupGain)*makeupCoeff;

  const float requestedDrive = static_cast<float>(dbToGain(outputReserveDb));
  if (outputProfile == 1 || outputProfile == 2) {
    // R76 STABLE MAX-HD CONTROLLER
    // Measure the finished, post-compressor signal with the exact same 4x
    // oversampled true-peak detector family used by Peak Guard. Hold/decay the
    // programme peak slowly so makeup gain does not oscillate between every kick
    // and snare. Extra gain may fall to unity, but this stage never attenuates the
    // user's dry source or EQ below unity.
    const float tpL = updateTruePeakDetector(maxHdTruePeakHistoryL, left);
    const float tpR = updateTruePeakDetector(maxHdTruePeakHistoryR, right);
    const float truePeak = tpL > tpR ? tpL : tpR;
    if (truePeak > maxHdHeldTruePeak) maxHdHeldTruePeak = truePeak;
    else maxHdHeldTruePeak += (truePeak - maxHdHeldTruePeak) * maxHdPeakReleaseCoeff;
    if (maxHdHeldTruePeak < 0.0000001f) maxHdHeldTruePeak = 0.0f;
    meterMaxHdInputTruePeakDbtp = maxHdHeldTruePeak > 0.000001f
      ? static_cast<float>(20.0 * log10(maxHdHeldTruePeak)) : -120.0f;

    // Leave a small but real margin between the controller target and the -1.1 dB internal
    // Peak-Guard detector ceiling. Because R76 measures with the same oversampled
    // detector family, it no longer needs the old ~1 dB sample-vs-true-peak cushion.
    const float maxHdTargetTruePeak = static_cast<float>(dbToGain(-1.30f));
    float cleanCap = requestedDrive;
    if (maxHdHeldTruePeak > 0.000001f) cleanCap = maxHdTargetTruePeak / maxHdHeldTruePeak;
    cleanCap = clampf(cleanCap, 1.0f, requestedDrive);

    // If Peak Guard had to work unexpectedly, remember that event and remove only
    // the extra Max-HD makeup. The feedback decays slowly, so the controller cannot
    // immediately climb back into the limiter and flash again on the next transient.
    const float limiterReductionDb = limiterGain < 0.999999f
      ? static_cast<float>(-20.0 * log10(limiterGain)) : 0.0f;
    if (limiterReductionDb > maxHdLimiterFeedbackDb) maxHdLimiterFeedbackDb = limiterReductionDb;
    else maxHdLimiterFeedbackDb += (0.0f - maxHdLimiterFeedbackDb) * maxHdFeedbackReleaseCoeff;

    float driveTarget = cleanCap;
    if (maxHdLimiterFeedbackDb > 0.12f && driveTarget > 1.0f) {
      const float feedbackDb = clampf(maxHdLimiterFeedbackDb + 0.30f, 0.0f, 6.0f);
      driveTarget *= static_cast<float>(dbToGain(-feedbackDb));
      if (driveTarget < 1.0f) driveTarget = 1.0f;
    }

    // Downward response is fast enough to stay clean; upward recovery is deliberately
    // slow and programme-like. This is a mastering envelope, not an AGC riding every beat.
    const float coeff = driveTarget < cleanOutputDriveGain
      ? maxHdGainFallCoeff
      : maxHdGainRiseCoeff;
    cleanOutputDriveGain += (driveTarget - cleanOutputDriveGain) * coeff;
    cleanOutputDriveGain = clampf(cleanOutputDriveGain, 1.0f, requestedDrive);
    outputReserveGain = cleanOutputDriveGain;
  } else {
    // Car / Hi-Fi remains an explicit advanced gain stage.
    maxHdHeldTruePeak = 0.0f;
    maxHdLimiterFeedbackDb = 0.0f;
    meterMaxHdInputTruePeakDbtp = -120.0f;
    cleanOutputDriveGain = requestedDrive;
    outputReserveGain = requestedDrive;
  }

  left *= autoMakeupGain * outputReserveGain;
  right *= autoMakeupGain * outputReserveGain;

  meterAutoMakeupDb = autoMakeupGain > 0.000001f ? static_cast<float>(20.0*log10(autoMakeupGain)) : 0.0f;
  meterOutputReserveDb = outputReserveGain > 0.000001f ? static_cast<float>(20.0*log10(outputReserveGain)) : 0.0f;
  const float after = absf(left)>absf(right)?absf(left):absf(right);
  meterAvailableHeadroomDb = after > 0.000001f ? clampf(static_cast<float>(-20.0*log10(after)), -12.0f, 24.0f) : 24.0f;
}

void configureOutputProfile() {
  // Static correction remains intentionally tiny. The adaptive guard below is
  // profile-aware and cut-only, so the same music preset can travel between
  // car/hi-fi, headphones and Bluetooth without becoming a second musical EQ.
  for (int ch = 0; ch < 2; ++ch) {
    // Every device profile starts tonally neutral. Device choice describes the
    // output path; it must never behave like a hidden EQ preset. Only the
    // sub-audible protection high-pass differs slightly by device family.
    if (outputProfile == 2) {
      outputHp[ch].setHighpass(sampleRateHz, 25.0);
      outputLow[ch].setLowShelf(sampleRateHz, 105.0, 0.0);
      outputPresence[ch].setPeaking(sampleRateHz, 2800.0, 0.85, 0.0);
      outputHigh[ch].setHighShelf(sampleRateHz, 8200.0, 0.0);
    } else if (outputProfile == 1) {
      outputHp[ch].setHighpass(sampleRateHz, 16.0);
      outputLow[ch].setLowShelf(sampleRateHz, 90.0, 0.0);
      outputPresence[ch].setPeaking(sampleRateHz, 3000.0, 0.9, 0.0);
      outputHigh[ch].setHighShelf(sampleRateHz, 10000.0, 0.0);
    } else {
      outputHp[ch].setHighpass(sampleRateHz, 18.0);
      outputLow[ch].setLowShelf(sampleRateHz, 82.0, 0.0);
      outputPresence[ch].setPeaking(sampleRateHz, 2900.0, 0.95, 0.0);
      outputHigh[ch].setHighShelf(sampleRateHz, 10500.0, 0.0);
    }
  }

  // Adaptive low-frequency guard. It acts only when the selected output path is
  // being over-driven in its vulnerable low-frequency region. Normal material
  // remains untouched; no makeup gain is applied.
  if (outputProfile == 2) {
    outputGuard.configure(sampleRateHz, 82.0f, 0.82f, -12.5f, 1.5f, 1.85f, 15.0f, 260.0f);
    outputCorrectionProfileScale = 1.0f;
  } else if (outputProfile == 1) {
    outputGuard.configure(sampleRateHz, 55.0f, 0.78f, -7.0f, 0.35f, 1.45f, 22.0f, 310.0f);
    outputCorrectionProfileScale = 0.35f;
  } else {
    outputGuard.configure(sampleRateHz, 58.0f, 0.80f, -9.5f, 0.8f, 1.65f, 18.0f, 290.0f);
    outputCorrectionProfileScale = 0.65f;
  }
  outputGuard.reset();
  meterOutputCorrectionReductionDb = 0.0f;
}

void configureStereoIntegrity() {
  // Side-channel low-pass isolates bass width so the low end can be centered
  // without narrowing the entire mix. 120 Hz is deliberately below the body
  // region of guitars and vocals.
  stereoSideLowpass.setLowpass(sampleRateHz, 120.0, 0.7071067811865476);
  stereoSideLowpass.reset();
  stereoCorrelationEnergy = 0.0f;
  stereoCorrelationCross = 0.0f;
  stereoGuardGain = 1.0f;
  meterStereoCorrelation = 1.0f;
  meterStereoWidthPercent = 100.0f;
  meterStereoGuardReductionDb = 0.0f;
}

void configureHeadphoneBass() {
  const double boost = headphoneEnabled ? clampd(headphoneBassImpact, 0.0, 1.0) * 4.8 : 0.0;
  headphoneBass[0].setLowShelf(sampleRateHz, 92.0, boost);
  headphoneBass[1].setLowShelf(sampleRateHz, 92.0, boost);

  // WIDE keeps bass/low fundamentals substantially centered while allowing the
  // upper image to expand. This avoids the thin, phasey bass that full-band
  // widening can create on headphones.
  headphoneSideLowpass.setLowpass(sampleRateHz, 180.0, 0.7071067811865476);
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
  multibandCompressor[0].configure(sampleRateHz, -13.0f, 1.25f, 2.4f, 32.0f, 230.0f, 28.0f, 210.0f);
  multibandCompressor[1].configure(sampleRateHz, -15.5f, 1.22f, 2.1f, 26.0f, 210.0f, 22.0f, 190.0f);
  multibandCompressor[2].configure(sampleRateHz, -17.0f, 1.18f, 1.9f, 15.0f, 170.0f, 13.0f, 155.0f);
  multibandCompressor[3].configure(sampleRateHz, -18.5f, 1.16f, 1.6f, 9.0f, 145.0f, 8.0f, 130.0f);
}

void configureDynamicEq() {
  // Broad, mastering-style bands with conservative maximum cuts.
  dynamicEqBands[0].configure(sampleRateHz, 90.0f, 0.85f, -15.5f, 1.4f, 1.8f, 20.0f, 220.0f);
  dynamicEqBands[1].configure(sampleRateHz, 280.0f, 1.00f, -18.5f, 1.7f, 1.9f, 26.0f, 270.0f);
  dynamicEqBands[2].configure(sampleRateHz, 3200.0f, 1.10f, -20.5f, 1.8f, 2.0f, 13.0f, 190.0f);
  dynamicEqBands[3].configure(sampleRateHz, 7600.0f, 1.00f, -22.0f, 1.4f, 1.8f, 9.0f, 165.0f);
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

void processStereoIntegrity(float &left, float &right) {
  if (!stereoIntegrityEnabled || stereoIntegrityAmount <= 0.0001f) {
    meterStereoCorrelation = 1.0f;
    meterStereoWidthPercent = 100.0f;
    meterStereoGuardReductionDb = 0.0f;
    return;
  }

  const float amount = clampf(stereoIntegrityAmount, 0.0f, 1.0f);
  const float mid = 0.5f * (left + right);
  const float side = 0.5f * (left - right);

  // Smooth stereo correlation over roughly 70 ms. A negative correlation means
  // excessive anti-phase energy and is where the safety guard begins to narrow.
  const float energy = left * left + right * right;
  const float cross = 2.0f * left * right;
  const float corrCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.090)));
  stereoCorrelationEnergy += (energy - stereoCorrelationEnergy) * corrCoeff;
  stereoCorrelationCross += (cross - stereoCorrelationCross) * corrCoeff;
  float correlation = stereoCorrelationEnergy > 1.0e-8f
    ? stereoCorrelationCross / stereoCorrelationEnergy
    : 1.0f;
  correlation = clampf(correlation, -1.0f, 1.0f);

  // The guard is transparent above -0.18 correlation. At strongly anti-phase
  // moments it can reduce the high-frequency side channel by at most 3 dB.
  float guardTarget = 1.0f;
  if (correlation < -0.28f) {
    const float severity = clampf((-0.28f - correlation) / 0.58f, 0.0f, 1.0f);
    guardTarget = 1.0f - severity * (1.0f - static_cast<float>(dbToGain(-2.5))) * amount;
  }
  const float guardAttack = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.025)));
  const float guardRelease = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.450)));
  const float guardCoeff = guardTarget < stereoGuardGain ? guardAttack : guardRelease;
  stereoGuardGain += (guardTarget - stereoGuardGain) * guardCoeff;

  // Profile-specific base width is intentionally tiny. This is an integrity stage,
  // not a wow-effect widener. Headphone immersion remains a separate later stage.
  const float baseHighWidth = outputProfile == 0 ? 1.02f : (outputProfile == 2 ? 0.995f : 1.0f);
  const float lowSideScale = outputProfile == 0 ? 0.72f : (outputProfile == 2 ? 0.60f : 0.88f);

  const float lowSide = stereoSideLowpass.process(side);
  const float highSide = side - lowSide;
  const float finalHighScale = 1.0f + (baseHighWidth - 1.0f) * amount;
  const float guardedHigh = highSide * finalHighScale * stereoGuardGain;
  const float centeredLow = lowSide * (1.0f + (lowSideScale - 1.0f) * amount);
  const float finalSide = centeredLow + guardedHigh;

  left = mid + finalSide;
  right = mid - finalSide;

  meterStereoCorrelation = correlation;
  meterStereoWidthPercent = clampf(finalHighScale * stereoGuardGain * 100.0f, 0.0f, 140.0f);
  meterStereoGuardReductionDb = stereoGuardGain < 0.99999f
    ? static_cast<float>(-20.0 * log10(stereoGuardGain))
    : 0.0f;
}

void processHeadphone(float &left, float &right) {
  if (!headphoneEnabled) return;
  const float dryL = left;
  const float dryR = right;
  left = headphoneBass[0].process(left);
  right = headphoneBass[1].process(right);

  // Virtual-speaker presentation. Existing width/depth/center controls remain,
  // while the V5 advanced layer adds speaker angle, distance, early reflections
  // and an explicit wet/dry mix. No reverb tail is generated.
  const float advanced = headphoneAdvancedEnabled ? 1.0f : 0.0f;
  const float angleNorm = clampf((headphoneSpeakerAngle - 15.0f) / 45.0f, 0.0f, 1.0f);
  const float distance = headphoneAdvancedEnabled ? clampf(headphoneDistance, 0.0f, 1.0f) : 0.0f;
  const float width = clampf(headphoneWidth + angleNorm * 0.12f * advanced, 0.0f, 1.0f);
  const float depth = clampf(headphoneDepth + distance * 0.22f * advanced, 0.0f, 1.0f);
  const float center = clampf(headphoneCenter, 0.0f, 1.0f);
  const float mid = 0.5f * (left + right);
  const float side = 0.5f * (left - right);

  // Frequency-dependent M/S width: low-frequency stereo remains nearly intact,
  // while the upper side channel expands. With depth/crossfeed at zero this is
  // a pure width mode, not a short-delay spatial trick.
  const float lowSide = headphoneSideLowpass.process(side);
  const float highSide = side - lowSide;
  const float lowSideScale = 1.0f + width * 0.06f;
  const float highSideScale = 1.0f + width * 0.52f;
  const float widenedSide = lowSide * lowSideScale + highSide * highSideScale;
  const float midScale = 0.98f + center * 0.04f;
  float widenedL = mid * midScale + widenedSide;
  float widenedR = mid * midScale - widenedSide;

  const float cf = clampf(headphoneCrossfeed + angleNorm * 0.05f * advanced, 0.0f, 1.0f);
  if (cf > 0.0001f) {
    const double cutoff = 1200.0;
    const double alpha = 1.0 - exp(-2.0 * kPi * cutoff / sampleRateHz);
    crossfeedStateL += alpha * (widenedL - crossfeedStateL);
    crossfeedStateR += alpha * (widenedR - crossfeedStateR);
    const float mix = cf * 0.20f;
    const float direct = 1.0f - mix * 0.20f;
    const float cfL = static_cast<float>(crossfeedStateR) * mix;
    const float cfR = static_cast<float>(crossfeedStateL) * mix;
    widenedL = widenedL * direct + cfL;
    widenedR = widenedR * direct + cfR;
  }

  if (depth > 0.0001f || (headphoneAdvancedEnabled && headphoneReflections > 0.0001f)) {
    const float reflection = headphoneAdvancedEnabled ? clampf(headphoneReflections, 0.0f, 0.30f) : 0.0f;
    int delaySamples = static_cast<int>(sampleRateHz * (0.00045f + 0.00185f * depth + distance * 0.0011f));
    if (delaySamples < 1) delaySamples = 1;
    if (delaySamples >= kSpatialDelayMax) delaySamples = kSpatialDelayMax - 1;
    const int read = (spatialWrite - delaySamples + kSpatialDelayMax) % kSpatialDelayMax;
    const float delayedL = spatialDelayL[read];
    const float delayedR = spatialDelayR[read];
    spatialDelayL[spatialWrite] = widenedL;
    spatialDelayR[spatialWrite] = widenedR;
    spatialWrite = (spatialWrite + 1) % kSpatialDelayMax;
    const float mix = clampf(depth * 0.13f + reflection * 0.34f, 0.0f, 0.18f);
    widenedL = widenedL * (1.0f - mix * 0.30f) + delayedR * mix;
    widenedR = widenedR * (1.0f - mix * 0.30f) + delayedL * mix;
  }

  // Preserve level. The true-peak limiter downstream owns peak protection, so
  // immersion never gets a blanket volume penalty just for being enabled.
  const float compensation = 1.0f;
  widenedL *= compensation;
  widenedR *= compensation;
  // R71 WIDE never replaces the clean Studio HD foundation. In the normal
  // headphone path blend the frequency-dependent widener in parallel so bass,
  // center image, transients and overall tonal balance remain anchored to dry.
  const float wet = headphoneAdvancedEnabled ? clampf(headphoneWet, 0.0f, 1.0f) : 0.62f;
  left = dryL + (widenedL - dryL) * wet;
  right = dryR + (widenedR - dryR) * wet;
}

void processHeadphoneOutputDrive(float &left, float &right) {
  // V5: no hidden headphone gain. User-controlled Output Reserve owns final drive.
  headphoneOutputDriveGain += (1.0f - headphoneOutputDriveGain) * 0.02f;
  meterHeadphoneOutputDriveDb = 0.0f;
  (void)left; (void)right;
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
  // envelope so quiet passages do not receive absurd gain. R75 raises the user
  // Impact/Punch ceiling to 4 dB so the simple button has an unmistakable A/B
  // without turning the entire song up.
  const float floor = 0.018f;
  const float separation = transientFastEnvelope - transientSlowEnvelope;
  const float normalized = separation > 0.0f
    ? clampf(separation / (transientSlowEnvelope + floor), 0.0f, 1.0f)
    : 0.0f;
  const float boostDb = transientAmount * normalized * 4.0f;
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

  // R71 Clean-HD loudness equalization is upward-biased. Quiet masters can be
  // lifted, while already-loud masters are never blanket-attenuated. Peak safety
  // remains the responsibility of the downstream output-drive + true-peak limiter.
  float desiredDb = 0.0f;
  if (loudnessEnabled && loudnessProgramBlockCount >= 20 && loudnessProgramLufs > -60.0f) {
    const float differenceDb = loudnessTargetLufs - loudnessProgramLufs;
    if (differenceDb > 0.6f) {
      desiredDb = clampf(differenceDb, 0.0f, 4.5f);
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

inline float updateTruePeakDetector(float *history, float sample) {
  for (int tap = kTruePeakTapsPerPhase - 1; tap > 0; --tap) history[tap] = history[tap - 1];
  history[0] = sample;
  float peak = absf(sample);
  for (int phase = 0; phase < kTruePeakPhases; ++phase) {
    float interpolated = 0.0f;
    for (int tap = 0; tap < kTruePeakTapsPerPhase; ++tap) {
      interpolated += history[tap] * kTruePeakCoeffs[tap][phase];
    }
    const float magnitude = absf(interpolated);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

void processLimiter(float inLeft, float inRight, float &outLeft, float &outRight) {
  const float peakL = updateTruePeakDetector(truePeakHistoryL, inLeft);
  const float peakR = updateTruePeakDetector(truePeakHistoryR, inRight);
  const float detector = peakL > peakR ? peakL : peakR;

  limiterDelayL[limiterWrite] = inLeft;
  limiterDelayR[limiterWrite] = inRight;
  int read = limiterWrite - limiterLookahead;
  if (read < 0) read += kMaxLookahead;
  float delayedL = limiterDelayL[read];
  float delayedR = limiterDelayR[read];
  limiterWrite = (limiterWrite + 1) % kMaxLookahead;

  float required = 1.0f;
  if (limiterEnabled && detector > limiterDetectorCeilingGain && detector > 0.0000001f) {
    required = limiterDetectorCeilingGain / detector;
  }
  if (required < limiterGain) limiterGain = required;
  else limiterGain += (1.0f - limiterGain) * limiterReleaseCoeff;
  if (!limiterEnabled) limiterGain += (1.0f - limiterGain) * 0.02f;

  outLeft = delayedL * limiterGain;
  outRight = delayedR * limiterGain;
  // Sample-domain clamp remains a last-resort guard. With normal operation the
  // BS.1770 detector and lookahead envelope prevent this path from engaging.
  if (limiterEnabled) {
    outLeft = clampf(outLeft, -limiterCeilingGain, limiterCeilingGain);
    outRight = clampf(outRight, -limiterCeilingGain, limiterCeilingGain);
  }

  // Meter the FINAL limited signal, not the signal entering the limiter. Earlier
  // builds labeled the pre-limiter detector as dBTP, which made healthy limiting
  // look like clipped output in the UI and hid whether the final device feed was safe.
  const float outPeakL = updateTruePeakDetector(truePeakOutputHistoryL, outLeft);
  const float outPeakR = updateTruePeakDetector(truePeakOutputHistoryR, outRight);
  const float outDetector = outPeakL > outPeakR ? outPeakL : outPeakR;
  if (outDetector > meterTruePeakLinear) meterTruePeakLinear = outDetector;
}
} // namespace

extern "C" {
__attribute__((visibility("default"))) int mvp_init(float sr) {
  sampleRateHz = clampf(sr, 8000.0f, 192000.0f);
  limiterLookahead = static_cast<int>(sampleRateHz * 0.005f + 0.5f);
  if (limiterLookahead < 1) limiterLookahead = 1;
  if (limiterLookahead >= kMaxLookahead) limiterLookahead = kMaxLookahead - 1;
  maxHdCompLookahead = static_cast<int>(sampleRateHz * 0.0025f + 0.5f);
  if (maxHdCompLookahead < 1) maxHdCompLookahead = 1;
  if (maxHdCompLookahead >= kMaxLookahead) maxHdCompLookahead = kMaxLookahead - 1;
  limiterReleaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.095)));
  finalCompDetectorAttackCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.0030)));
  finalCompDetectorReleaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.090)));
  finalCompGainAttackCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.0045)));
  finalCompGainReleaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.080)));
  maxHdPeakReleaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.32)));
  maxHdGainRiseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.60)));
  maxHdGainFallCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.010)));
  maxHdFeedbackReleaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRateHz * 0.55)));
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
  eqTopologyTarget = 0;
  eqTopologyTransitionPhase = 0;
  eqTopologyTransitionGain = 1.0f;
  buildLinearFirTarget();
  resetLinearFir(true);
  targetPreampDb = 0.0f;
  headroomDb = 0.0f;
  currentPreampGain = 1.0f;
  configureOutputProfile();
  configureStereoIntegrity();
  configureHeadphoneBass();
  configureMultiband();
  configureDynamicEq();
  configureLoudness();
  configureAdvancedTone();
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
__attribute__((visibility("default"))) void mvp_set_eq_topology(int value) {
  const int next = value == 1 ? 1 : 0;
  eqTopologyTarget = next;
  if (eqTopologyTarget != eqTopology) {
    // Start or reverse toward a new topology. If we were already fading back in
    // from a previous switch, turn around smoothly from the current gain.
    if (eqTopologyTransitionPhase == 0 || eqTopologyTransitionPhase == 2) {
      eqTopologyTransitionPhase = 1;
    }
  } else if (eqTopologyTransitionPhase == 1) {
    // User changed their mind before the switch point; simply fade back in.
    eqTopologyTransitionPhase = 2;
  }
}
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
  limiterDetectorCeilingGain = static_cast<float>(dbToGain(limiterCeilingDb - kTruePeakSafetyDb));
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
__attribute__((visibility("default"))) void mvp_set_stereo_integrity(int enabled, float amount) {
  const int nextEnabled = enabled ? 1 : 0;
  if (nextEnabled && !stereoIntegrityEnabled) configureStereoIntegrity();
  stereoIntegrityEnabled = nextEnabled;
  stereoIntegrityAmount = clampf(amount, 0.0f, 1.0f);
  if (!stereoIntegrityEnabled) {
    stereoGuardGain = 1.0f;
    meterStereoCorrelation = 1.0f;
    meterStereoWidthPercent = 100.0f;
    meterStereoGuardReductionDb = 0.0f;
  }
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

__attribute__((visibility("default"))) void mvp_set_parametric_enabled(int enabled) { parametricEnabled = enabled ? 1 : 0; }
__attribute__((visibility("default"))) void mvp_set_parametric_band(int index, int enabled, float frequency, float gainDb, float q, int type) {
  if (index < 0 || index >= kParametricBands) return;
  auto &band = parametricBands[index];
  band.enabled = enabled ? 1 : 0;
  band.frequency = clampf(frequency, 20.0f, sampleRateHz * 0.45f);
  band.gainDb = clampf(gainDb, -12.0f, 12.0f);
  band.q = clampf(q, 0.15f, 12.0f);
  band.type = type < 0 ? 0 : (type > 5 ? 5 : type);
  configureParametricBand(index);
}
__attribute__((visibility("default"))) void mvp_set_bass_engine(int enabled, float subDb, float punchDb, float bodyDb, float tightness) {
  bassEngineEnabled = enabled ? 1 : 0;
  bassSubDb = clampf(subDb,-8.0f,8.0f); bassPunchDb=clampf(punchDb,-8.0f,8.0f); bassBodyDb=clampf(bodyDb,-8.0f,8.0f); bassTightness=clampf(tightness,0.0f,1.0f);
  configureAdvancedTone();
}
__attribute__((visibility("default"))) void mvp_set_tone_engine(int enabled, float presence, float clarity, float air, float deharsh) {
  toneEngineEnabled=enabled?1:0; presenceDb=clampf(presence,-8.0f,8.0f); clarityDb=clampf(clarity,-8.0f,8.0f); airDb=clampf(air,-8.0f,8.0f); deharshAmount=clampf(deharsh,0.0f,1.0f); configureAdvancedTone();
}
__attribute__((visibility("default"))) void mvp_set_exciter(int enabled, float amount, float lowSat, float midSat, float highSat) {
  exciterEnabled=enabled?1:0; exciterAmount=clampf(amount,0.0f,1.0f); saturationLow=clampf(lowSat,0.0f,1.0f); saturationMid=clampf(midSat,0.0f,1.0f); saturationHigh=clampf(highSat,0.0f,1.0f);
}
__attribute__((visibility("default"))) void mvp_set_stereo_field(int enabled, float width, float center, float monoHz) {
  stereoFieldEnabled=enabled?1:0; stereoUserWidth=clampf(width,0.5f,1.65f); stereoCenterFocus=clampf(center,0.75f,1.30f); bassMonoHz=clampf(monoHz,60.0f,160.0f); configureAdvancedTone();
}
__attribute__((visibility("default"))) void mvp_set_dynamics_restore(int enabled, float amount) { dynamicsRestoreEnabled=enabled?1:0; dynamicsRestoreAmount=clampf(amount,0.0f,1.0f); }
__attribute__((visibility("default"))) void mvp_set_smart_dsp(int enabled, float amount) { smartDspEnabled=enabled?1:0; smartDspAmount=clampf(amount,0.0f,1.0f); }
__attribute__((visibility("default"))) void mvp_set_output_gain(int autoMakeup, float reserveDb) { autoMakeupEnabled=autoMakeup?1:0; outputReserveDb=clampf(reserveDb,0.0f,12.0f); }
__attribute__((visibility("default"))) void mvp_set_headphone_advanced(int enabled, float angle, float distance, float reflections, float wet) { headphoneAdvancedEnabled=enabled?1:0; headphoneSpeakerAngle=clampf(angle,15.0f,60.0f); headphoneDistance=clampf(distance,0.0f,1.0f); headphoneReflections=clampf(reflections,0.0f,0.30f); headphoneWet=clampf(wet,0.0f,1.0f); }

__attribute__((visibility("default"))) void mvp_reset() { resetBuffers(); }

__attribute__((visibility("default"))) int mvp_process(int frames) {
  if (frames <= 0 || frames > kMaxFrames) return 0;
  refreshEqForBlock(frames);
  refreshDynamicEqForBlock(frames);
  refreshOutputCorrectionForBlock(frames);
  meterInputPeak = meterOutputPeak = 0.0f;
  meterInternalPeak = 0.0f;
  meterEqActivityDb = 0.0f;
  meterTruePeakLinear = 0.0f;
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
    meterEqActivityDb = eqEnabled ? 1.0f : 0.0f;
    processParametric(left, right);
    processBassEngine(left, right);
    processTransient(left, right);
    processMultiband(left, right);
    processDynamicEq(left, right);
    processToneEngine(left, right);
    processExciter(left, right);
    processDynamicsRestore(left, right);
    processSmartDsp(left, right);
    left = processOutput(0, left);
    right = processOutput(1, right);
    processOutputCorrection(left, right);
    processStereoIntegrity(left, right);
    processStereoFieldUser(left, right);
    processHeadphone(left, right);
    processLoudness(left, right);
    processFinalCompressor(left, right);
    processHeadphoneOutputDrive(left, right);
    processOutputGain(left, right);

    float limitedL = 0.0f;
    float limitedR = 0.0f;
    processLimiter(left, right, limitedL, limitedR);

    // V4.3 real-time hardening: Minimum/Linear topology changes are muted through
    // a very short fade-out / fade-in instead of jumping between paths with
    // different phase/latency behavior. Both paths stay warm, so the actual
    // topology flip occurs only at the near-silent transition point.
    if (eqTopologyTransitionPhase == 1) {
      const float step = 1.0f / (sampleRateHz * 0.012f); // ~12 ms down
      eqTopologyTransitionGain -= step;
      if (eqTopologyTransitionGain <= 0.0005f) {
        eqTopologyTransitionGain = 0.0f;
        eqTopology = eqTopologyTarget;
        eqTopologyTransitionPhase = 2;
      }
    } else if (eqTopologyTransitionPhase == 2) {
      const float step = 1.0f / (sampleRateHz * 0.030f); // ~30 ms up
      eqTopologyTransitionGain += step;
      if (eqTopologyTransitionGain >= 1.0f) {
        eqTopologyTransitionGain = 1.0f;
        eqTopologyTransitionPhase = 0;
      }
    }

    limitedL *= eqTopologyTransitionGain;
    limitedR *= eqTopologyTransitionGain;
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
__attribute__((visibility("default"))) float mvp_meter_final_compressor_reduction_db() { return meterFinalCompressorReductionDb; }
__attribute__((visibility("default"))) float mvp_meter_limiter_gain() { return limiterGain; }
__attribute__((visibility("default"))) float mvp_meter_true_peak_linear() { return meterTruePeakLinear; }
__attribute__((visibility("default"))) float mvp_meter_true_peak_dbtp() {
  return meterTruePeakLinear > 0.000000001f ? static_cast<float>(20.0 * log10(meterTruePeakLinear)) : -120.0f;
}
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
__attribute__((visibility("default"))) float mvp_meter_stereo_correlation() { return meterStereoCorrelation; }
__attribute__((visibility("default"))) float mvp_meter_stereo_width_percent() { return meterStereoWidthPercent; }
__attribute__((visibility("default"))) float mvp_meter_stereo_guard_reduction_db() { return meterStereoGuardReductionDb; }
__attribute__((visibility("default"))) float mvp_meter_headphone_output_drive_db() { return meterHeadphoneOutputDriveDb; }
__attribute__((visibility("default"))) float mvp_meter_loudness_gain_db() { return loudnessGainDb; }
__attribute__((visibility("default"))) float mvp_meter_loudness_momentary_lufs() { return loudnessMomentaryLufs; }
__attribute__((visibility("default"))) float mvp_meter_loudness_program_lufs() { return loudnessProgramLufs; }

__attribute__((visibility("default"))) float mvp_meter_auto_makeup_db() { return meterAutoMakeupDb; }
__attribute__((visibility("default"))) float mvp_meter_output_reserve_db() { return meterOutputReserveDb; }
__attribute__((visibility("default"))) float mvp_meter_max_hd_input_true_peak_dbtp() { return meterMaxHdInputTruePeakDbtp; }
__attribute__((visibility("default"))) float mvp_meter_available_headroom_db() { return meterAvailableHeadroomDb; }
__attribute__((visibility("default"))) float mvp_meter_internal_peak() { return meterInternalPeak; }
__attribute__((visibility("default"))) float mvp_meter_bass_activity_db() { return meterBassActivityDb; }
__attribute__((visibility("default"))) float mvp_meter_tone_activity_db() { return meterToneActivityDb; }
__attribute__((visibility("default"))) float mvp_meter_exciter_activity() { return meterExciterActivity; }
__attribute__((visibility("default"))) float mvp_meter_deharsh_reduction_db() { return meterDeharshReductionDb; }
__attribute__((visibility("default"))) float mvp_meter_smart_activity() { return meterSmartActivity; }
__attribute__((visibility("default"))) int mvp_eq_topology() { return eqTopology; }
__attribute__((visibility("default"))) int mvp_linear_phase_taps() { return kLinearFirTaps; }
__attribute__((visibility("default"))) int mvp_linear_phase_latency_samples() { return kLinearFirHalf + kLinearFirBlock; }
}
