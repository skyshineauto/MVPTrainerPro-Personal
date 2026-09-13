// MVP Trainer Pro Broadcast Engine V5.1
// One continuous-state broadcast/mastering processor for Headphones, Bluetooth Speaker and Car/Hi-Fi.
// ABI intentionally remains mvp_v2_* so the existing production Worklet/player wiring does not change.
// Real-time contract: no heap allocation, no locks, no I/O in mvp_v2_process().

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
constexpr int kBands = 5;
constexpr int kLookaheadMax = 320;
constexpr int kSpatialDelayMax = 4096;
constexpr int kTpPhaseTaps = 16;
constexpr double kPi = 3.1415926535897932384626433832795;

inline float absf(float v) { return v < 0.0f ? -v : v; }
inline float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline double clampd(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline float dbToGain(float db) { return static_cast<float>(pow(10.0, static_cast<double>(db) / 20.0)); }
inline float gainToDb(float gain) { return gain > 0.0000001f ? static_cast<float>(20.0 * log10(gain)) : -120.0f; }

inline float softCeiling(float x, float knee, float asymptote) {
  const float a = absf(x);
  if (a <= knee) return x;
  const float span = asymptote - knee;
  const float excess = a - knee;
  const float y = knee + excess / (1.0f + excess / span);
  return x < 0.0f ? -y : y;
}

const double kEqFrequencies[kEqBands] = {
  20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0,
  200.0, 250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0,
  1600.0, 2000.0, 2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0,
  10000.0, 12500.0, 16000.0, 20000.0
};

// 64-tap Blackman-windowed sinc interpolation filter, decomposed into four 16-tap phases.
// Passband gain is normalized to unity per reconstructed phase (phase sums are ~1.0).
// This is used for actual 4x inter-sample peak detection, replacing the old cubic estimator.
const float kTpFir[4][kTpPhaseTaps] = {
  {0.0000000000f, 0.0006967276f, -0.0036114518f, 0.0106894409f, -0.0243920034f, 0.0473988787f, -0.0853522687f, 0.1749621972f, 0.9271834644f, -0.0558089374f, 0.0065336228f, 0.0051465217f, -0.0059139618f, 0.0036139880f, -0.0014253083f, 0.0002466871f},
  {-0.0000259944f, 0.0009306425f, -0.0045142792f, 0.0140661965f, -0.0349789143f, 0.0763806998f, -0.1630375417f, 0.4750888740f, 0.7567609472f, -0.1677299103f, 0.0663150886f, -0.0261387989f, 0.0088488163f, -0.0022472932f, 0.0003169478f, -0.0000030777f},
  {-0.0000030777f, 0.0003169478f, -0.0022472932f, 0.0088488163f, -0.0261387989f, 0.0663150886f, -0.1677299103f, 0.7567609472f, 0.4750888740f, -0.1630375417f, 0.0763806998f, -0.0349789143f, 0.0140661965f, -0.0045142792f, 0.0009306425f, -0.0000259944f},
  {0.0002466871f, -0.0014253083f, 0.0036139880f, -0.0059139618f, 0.0051465217f, 0.0065336228f, -0.0558089374f, 0.9271834644f, 0.1749621972f, -0.0853522687f, 0.0473988787f, -0.0243920034f, 0.0106894409f, -0.0036114518f, 0.0006967276f, 0.0000000000f}
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

// Low is a 4th-order low-pass; high is defined as x-low, so every split is an exact
// sample-domain complement. Five bands always sum back to the original sample exactly
// before per-band dynamics/correction.
struct ExactSplit {
  Biquad lp1, lp2;
  void configure(double sr, double freq) { lp1.lowpass(sr, freq); lp2.lowpass(sr, freq); }
  void reset() { lp1.reset(); lp2.reset(); }
  inline void process(float x, float &low, float &high) {
    low = lp2.process(lp1.process(x));
    high = x - low;
  }
};

struct BandDynamics {
  float env = 0.0f;
  float gain = 1.0f;
  void reset() { env = 0.0f; gain = 1.0f; }
  inline float update(float detector, float threshold, float ratio, float attackCoeff, float releaseCoeff) {
    const float ec = detector > env ? attackCoeff : releaseCoeff;
    env += (detector - env) * ec;
    float target = 1.0f;
    if (env > threshold && env > 0.000001f) {
      const float over = env / threshold;
      target = static_cast<float>(pow(over, (1.0f / ratio) - 1.0f));
    }
    const float gc = target < gain ? attackCoeff : releaseCoeff;
    gain += (target - gain) * gc;
    return clampf(gain, 0.10f, 1.0f);
  }
};

struct TruePeak4x {
  float hist[kTpPhaseTaps] = {};
  void reset() { for (int i = 0; i < kTpPhaseTaps; ++i) hist[i] = 0.0f; }
  inline float update(float x) {
    for (int i = kTpPhaseTaps - 1; i > 0; --i) hist[i] = hist[i - 1];
    hist[0] = x;
    float peak = absf(x);
    for (int p = 0; p < 4; ++p) {
      float y = 0.0f;
      for (int k = 0; k < kTpPhaseTaps; ++k) y += hist[k] * kTpFir[p][k];
      const float a = absf(y);
      if (a > peak) peak = a;
    }
    return peak;
  }
};

alignas(16) float gInputL[kFrames] = {};
alignas(16) float gInputR[kFrames] = {};
alignas(16) float gOutputL[kFrames] = {};
alignas(16) float gOutputR[kFrames] = {};

float gSampleRate = 48000.0f;

// Public experience state.
int gMode = 0;          // 0 PURE, 1 ADAPTIVE, 2 POWER
int gOutputProfile = 1; // 0 Car/Hi-Fi, 1 Headphones, 2 Bluetooth Speaker
float gIntensityTarget = 0.72f;
float gIntensity = 0.72f;
int gBassEnabled = 0;
float gBassCharacterTarget = 0.50f;
float gBassCharacter = 0.50f;
int gImpactEnabled = 0;
int gClarityEnabled = 0;
int gSpatialEnabled = 0;
int gSpaceMode = 0; // 0 Studio, 1 Live, 2 Arena
int gPersonalEnabled = 0;
float gPersonalBass = 0.0f;
float gPersonalPresence = 0.0f;
float gPersonalBrightness = 0.0f;

// Per-song Master Prep from Enrich Library / Music Intelligence V5.
int gMasterPrepEnabled = 0;
float gMasterSourceGainDb = 0.0f;
float gMasterHighpassHz = 18.0f;
float gMasterLowMidDb = 0.0f;
float gMasterPresenceDb = 0.0f;
float gMasterHarshnessDb = 0.0f;
float gMasterBalanceDb = 0.0f;
float gMasterWidthScale = 1.0f;
Biquad gMasterHpL, gMasterHpR;
Biquad gMasterLowMidL, gMasterLowMidR;
Biquad gMasterPresenceL, gMasterPresenceR;
Biquad gMasterHarshL, gMasterHarshR;

// Optional Advanced EQ.
int gEqEnabled = 0;
float gEqGainDb[kEqBands] = {};
Biquad gEqL[kEqBands];
Biquad gEqR[kEqBands];

// Program-density / AGC analysis.
float gProgramPeak = 0.0f;
float gProgramAvg = 0.0f;
float gProgramDensity = 0.0f;
float gPeakAttack = 0.0f, gPeakRelease = 0.0f;
float gAvgAttack = 0.0f, gAvgRelease = 0.0f;
float gAgcGain = 1.0f;
float gAgcUpCoeff = 0.0f, gAgcDownCoeff = 0.0f;
float gIntensitySmoothCoeff = 0.0f, gBassSmoothCoeff = 0.0f;

// Five-band exact-complement broadcast dynamics.
ExactSplit gSplit90L, gSplit90R;
ExactSplit gSplit320L, gSplit320R;
ExactSplit gSplit1400L, gSplit1400R;
ExactSplit gSplit5200L, gSplit5200R;
// Dedicated post-master Personal Sound filters. User tone controls live after density so
// their direction and range remain predictable instead of being cancelled by compression.
Biquad gPersonalBassL, gPersonalBassR;
Biquad gPersonalPresenceL, gPersonalPresenceR;
Biquad gPersonalBrightnessL, gPersonalBrightnessR;
BandDynamics gBandDynamics[kBands];
float gBandAttackCoeff = 0.0f;
float gBandReleaseCoeff = 0.0f;
float gBandGainReductionDb = 0.0f;

// Bass engine.
Biquad gBassDeepL, gBassDeepR;
Biquad gBassBodyL, gBassBodyR;
float gBassActivityDb = 0.0f;

// Clarity / de-harsh.
Biquad gPresenceHpL, gPresenceHpR;
Biquad gAirHpL, gAirHpR;
float gHarshEnv = 0.0f;
float gHarshAttack = 0.0f;
float gHarshRelease = 0.0f;
float gClarityActivityDb = 0.0f;

// Impact.
float gImpactFast = 0.0f;
float gImpactSlow = 0.0f;
float gImpactFastAttack = 0.0f;
float gImpactFastRelease = 0.0f;
float gImpactSlowAttack = 0.0f;
float gImpactSlowRelease = 0.0f;
float gImpactBoostDb = 0.0f;

// Spatial stage.
Biquad gSpatialLowL, gSpatialLowR;
float gSpatialDelay[kSpatialDelayMax] = {};
int gSpatialIndex = 0;
int gSpatialDelaySamples = 480;
float gSpatialWidthPercent = 100.0f;

// Final density controller.
float gMasterEnv = 0.0f;
float gMasterAttack = 0.0f;
float gMasterRelease = 0.0f;

// Lookahead limiter.
float gLookL[kLookaheadMax] = {};
float gLookR[kLookaheadMax] = {};
float gLookPeak[kLookaheadMax] = {};
int gLookaheadSamples = 120;
int gLookIndex = 0;
float gLimiterGain = 1.0f;
float gLimiterReleaseCoeff = 0.0004f;
const float gLimiterCeiling = 0.9380f;

// True-peak detectors and meters.
TruePeak4x gLimiterTpL, gLimiterTpR;
TruePeak4x gMeterTpL, gMeterTpR;
float gMeterTruePeak = 0.0f;
float gMeterLimiterGrDb = 0.0f;
unsigned int gMeterClipCount = 0;
unsigned int gMeterNanCount = 0;

void configureEqBand(int band) {
  if (band < 0 || band >= kEqBands) return;
  gEqL[band].peaking(gSampleRate, kEqFrequencies[band], 4.318473046963146, gEqGainDb[band]);
  gEqR[band].peaking(gSampleRate, kEqFrequencies[band], 4.318473046963146, gEqGainDb[band]);
}

void resetLiveActivityMeters() {
  gMeterTruePeak = 0.0f;
  gMeterLimiterGrDb = 0.0f;
  gBandGainReductionDb = 0.0f;
  gBassActivityDb = 0.0f;
  gClarityActivityDb = 0.0f;
  gImpactBoostDb = 0.0f;
  gSpatialWidthPercent = 100.0f;
}

void resetMeters() {
  resetLiveActivityMeters();
  gMeterClipCount = 0;
  gMeterNanCount = 0;
  gMeterTpL.reset(); gMeterTpR.reset();
}

void resetState() {
  for (int i = 0; i < kEqBands; ++i) { gEqL[i].reset(); gEqR[i].reset(); }
  gSplit90L.reset(); gSplit90R.reset();
  gSplit320L.reset(); gSplit320R.reset();
  gSplit1400L.reset(); gSplit1400R.reset();
  gSplit5200L.reset(); gSplit5200R.reset();
  gPersonalBassL.reset(); gPersonalBassR.reset();
  gPersonalPresenceL.reset(); gPersonalPresenceR.reset();
  gPersonalBrightnessL.reset(); gPersonalBrightnessR.reset();
  gMasterHpL.reset(); gMasterHpR.reset();
  gMasterLowMidL.reset(); gMasterLowMidR.reset();
  gMasterPresenceL.reset(); gMasterPresenceR.reset();
  gMasterHarshL.reset(); gMasterHarshR.reset();
  for (int i = 0; i < kBands; ++i) gBandDynamics[i].reset();

  gBassDeepL.reset(); gBassDeepR.reset();
  gBassBodyL.reset(); gBassBodyR.reset();
  gPresenceHpL.reset(); gPresenceHpR.reset();
  gAirHpL.reset(); gAirHpR.reset();
  gSpatialLowL.reset(); gSpatialLowR.reset();

  for (int i = 0; i < kSpatialDelayMax; ++i) gSpatialDelay[i] = 0.0f;
  for (int i = 0; i < kLookaheadMax; ++i) { gLookL[i] = 0.0f; gLookR[i] = 0.0f; gLookPeak[i] = 0.0f; }

  gSpatialIndex = 0;
  gLookIndex = 0;
  gProgramPeak = gProgramAvg = gProgramDensity = 0.0f;
  gAgcGain = 1.0f;
  gHarshEnv = 0.0f;
  gImpactFast = gImpactSlow = 0.0f;
  gMasterEnv = 0.0f;
  gLimiterGain = 1.0f;
  gIntensity = gIntensityTarget;
  gBassCharacter = gBassCharacterTarget;
  gLimiterTpL.reset(); gLimiterTpR.reset();
  gMeterTpL.reset(); gMeterTpR.reset();
  resetMeters();
}

void configureMasterPrep() {
  if (!gMasterPrepEnabled) {
    gMasterHpL.identity(); gMasterHpR.identity();
    gMasterLowMidL.identity(); gMasterLowMidR.identity();
    gMasterPresenceL.identity(); gMasterPresenceR.identity();
    gMasterHarshL.identity(); gMasterHarshR.identity();
    return;
  }
  if (gMasterHighpassHz > 18.5f) {
    gMasterHpL.highpass(gSampleRate, gMasterHighpassHz);
    gMasterHpR.highpass(gSampleRate, gMasterHighpassHz);
  } else {
    gMasterHpL.identity(); gMasterHpR.identity();
  }
  gMasterLowMidL.peaking(gSampleRate, 320.0, 0.72, gMasterLowMidDb);
  gMasterLowMidR.peaking(gSampleRate, 320.0, 0.72, gMasterLowMidDb);
  gMasterPresenceL.peaking(gSampleRate, 3200.0, 0.82, gMasterPresenceDb);
  gMasterPresenceR.peaking(gSampleRate, 3200.0, 0.82, gMasterPresenceDb);
  gMasterHarshL.peaking(gSampleRate, 6500.0, 0.90, gMasterHarshnessDb);
  gMasterHarshR.peaking(gSampleRate, 6500.0, 0.90, gMasterHarshnessDb);
}

inline void applyMasterPrep(float &l, float &r) {
  float pl = gMasterHarshL.process(gMasterPresenceL.process(gMasterLowMidL.process(gMasterHpL.process(l))));
  float pr = gMasterHarshR.process(gMasterPresenceR.process(gMasterLowMidR.process(gMasterHpR.process(r))));
  if (!gMasterPrepEnabled) return;
  const float sourceGain = dbToGain(gMasterSourceGainDb);
  pl *= sourceGain; pr *= sourceGain;
  if (gMasterBalanceDb > 0.0f) pr *= dbToGain(gMasterBalanceDb);
  else if (gMasterBalanceDb < 0.0f) pl *= dbToGain(-gMasterBalanceDb);
  const float mid = 0.5f * (pl + pr);
  const float side = 0.5f * (pl - pr) * gMasterWidthScale;
  l = mid + side; r = mid - side;
}

inline void updateProgramAnalysis(float l, float r) {
  const float detector = absf(l) > absf(r) ? absf(l) : absf(r);
  const float pc = detector > gProgramPeak ? gPeakAttack : gPeakRelease;
  const float ac = detector > gProgramAvg ? gAvgAttack : gAvgRelease;
  gProgramPeak += (detector - gProgramPeak) * pc;
  gProgramAvg += (detector - gProgramAvg) * ac;
  const float denom = gProgramPeak > 0.00001f ? gProgramPeak : 0.00001f;
  gProgramDensity = clampf(gProgramAvg / denom, 0.0f, 1.0f);
}

inline void applyProgramAgc(float &l, float &r) {
  if (gMode == 0) {
    gAgcGain += (1.0f - gAgcGain) * gAgcDownCoeff;
    return;
  }

  const bool power = gMode == 2;
  // V5.1 widens the experience range. ADAPTIVE stays polished/natural while POWER
  // has materially more density and clean upward drive, especially on already-hot masters.
  const float targetAvg = power ? (0.225f + 0.070f * gIntensity) : (0.155f + 0.025f * gIntensity);
  const float maxDb = power ? (4.8f + 2.8f * gIntensity) : (1.6f + 1.2f * gIntensity);
  float targetGain = gProgramAvg > 0.00001f ? targetAvg / gProgramAvg : 1.0f;
  targetGain = clampf(targetGain, 1.0f, dbToGain(maxDb));

  // Do not chase silence/noise upward.
  const float gate = clampf((gProgramAvg - 0.0025f) / 0.018f, 0.0f, 1.0f);
  targetGain = 1.0f + (targetGain - 1.0f) * gate;

  // Dense masters need less raw AGC and more controlled density processing.
  const float denseTrim = 1.0f - clampf((gProgramDensity - 0.70f) * 0.55f, 0.0f, 0.18f);
  targetGain = 1.0f + (targetGain - 1.0f) * denseTrim;

  const float coeff = targetGain > gAgcGain ? gAgcUpCoeff : gAgcDownCoeff;
  gAgcGain += (targetGain - gAgcGain) * coeff;
  l *= gAgcGain;
  r *= gAgcGain;
}

inline void splitBands(float l, float r, float *bl, float *br) {
  float h1L, h1R, h2L, h2R, h3L, h3R, h4L, h4R;
  gSplit90L.process(l, bl[0], h1L); gSplit90R.process(r, br[0], h1R);
  gSplit320L.process(h1L, bl[1], h2L); gSplit320R.process(h1R, br[1], h2R);
  gSplit1400L.process(h2L, bl[2], h3L); gSplit1400R.process(h2R, br[2], h3R);
  gSplit5200L.process(h3L, bl[3], h4L); gSplit5200R.process(h3R, br[3], h4R);
  bl[4] = h4L; br[4] = h4R;
}

inline void applyBroadcastDynamics(float &l, float &r) {
  float bl[kBands], br[kBands];
  splitBands(l, r, bl, br);

  const bool power = gMode == 2;
  const float adaptiveThreshold[kBands] = {0.105f, 0.085f, 0.068f, 0.052f, 0.040f};
  const float powerThreshold[kBands]    = {0.078f, 0.064f, 0.052f, 0.042f, 0.034f};
  const float adaptiveRatio[kBands] = {1.42f, 1.52f, 1.58f, 1.64f, 1.68f};
  const float powerRatio[kBands]    = {2.05f, 2.22f, 2.38f, 2.52f, 2.62f};

  float maxGr = 0.0f;
  for (int band = 0; band < kBands; ++band) {
    const float detector = absf(bl[band]) > absf(br[band]) ? absf(bl[band]) : absf(br[band]);
    const float thresholdBase = power ? powerThreshold[band] : adaptiveThreshold[band];
    const float thresholdScale = power ? (1.04f - 0.24f * gIntensity) : (1.08f - 0.16f * gIntensity);
    const float threshold = clampf(thresholdBase * thresholdScale, 0.018f, 0.20f);
    const float ratioBase = power ? powerRatio[band] : adaptiveRatio[band];
    const float ratioMix = power ? (0.35f + 0.65f * gIntensity) : (0.40f + 0.45f * gIntensity);
    const float ratio = 1.0f + (ratioBase - 1.0f) * ratioMix;
    const float dynGain = gBandDynamics[band].update(detector, threshold, ratio, gBandAttackCoeff, gBandReleaseCoeff);
    const float grDb = -gainToDb(dynGain);
    if (grDb > maxGr) maxGr = grDb;

    float deviceDb = 0.0f;
    if (gOutputProfile == 1) {
      const float d[kBands] = {0.20f, -0.12f, 0.08f, 0.20f, 0.34f};
      deviceDb = d[band];
    } else if (gOutputProfile == 2) {
      const float d[kBands] = {0.68f, 0.28f, -0.08f, 0.32f, 0.52f};
      deviceDb = d[band];
    } else {
      const float d[kBands] = {0.08f, 0.00f, 0.02f, 0.08f, 0.12f};
      deviceDb = d[band];
    }

    // Recover most compression reduction as density, instead of simply slamming a final limiter.
    const float recovery = power ? (0.88f + 0.07f * gIntensity) : (0.93f + 0.03f * gIntensity);
    const float baseMakeupDb = power ? (0.90f + 0.90f * gIntensity) : (0.30f + 0.45f * gIntensity);
    const float bandGain = dynGain * dbToGain(deviceDb + baseMakeupDb + grDb * recovery);
    bl[band] *= bandGain;
    br[band] *= bandGain;
  }

  if (maxGr > gBandGainReductionDb) gBandGainReductionDb = maxGr;
  l = bl[0] + bl[1] + bl[2] + bl[3] + bl[4];
  r = br[0] + br[1] + br[2] + br[3] + br[4];
}

inline float softBassHarmonics(float low, float amount) {
  const float drive = 1.0f + 2.0f * amount;
  const float x = clampf(low * drive, -1.10f, 1.10f);
  const float shaped = x - 0.15f * x * x * x;
  return shaped / drive - low;
}

inline void applyBassEngine(float &l, float &r) {
  // Keep filter memory live even while disabled so repeated toggles do not wake up stale.
  const float deepL = gBassDeepL.process(l);
  const float deepR = gBassDeepR.process(r);
  const float broadL = gBassBodyL.process(l);
  const float broadR = gBassBodyR.process(r);
  if (!gBassEnabled) return;

  const float bodyL = broadL - deepL;
  const float bodyR = broadR - deepR;
  const float c = gBassCharacter;
  const float profileAmount = gOutputProfile == 1 ? 1.10f : (gOutputProfile == 2 ? 0.95f : 1.0f);
  const float amount = (0.72f + 0.78f * gIntensity) * (gMode == 2 ? 1.10f : 1.0f) * profileAmount;
  // End points are intentionally far apart: TIGHT emphasizes 90-190 Hz punch while DEEP
  // moves energy below ~82 Hz. This is meant to be obvious by ear on real hardware.
  const float deepEnd = gOutputProfile == 1 ? 1.66f : (gOutputProfile == 2 ? 1.42f : 1.50f);
  const float deepGain = amount * (0.10f + (deepEnd - 0.10f) * c);
  const float bodyGain = amount * (1.38f - 1.10f * c);
  const float harmonicMix = amount * ((gOutputProfile == 2 ? 0.24f : 0.14f) + 0.18f * c);

  const float harmL = softBassHarmonics(deepL, amount);
  const float harmR = softBassHarmonics(deepR, amount);
  const float addL = deepL * deepGain + bodyL * bodyGain + harmL * harmonicMix;
  const float addR = deepR * deepGain + bodyR * bodyGain + harmR * harmonicMix;
  l += addL; r += addR;

  const float src = absf(broadL) > absf(broadR) ? absf(broadL) : absf(broadR);
  const float add = absf(addL) > absf(addR) ? absf(addL) : absf(addR);
  if (src > 0.00001f) {
    const float activity = gainToDb(1.0f + add / src);
    if (activity > gBassActivityDb) gBassActivityDb = activity;
  }
}

inline void applyClarityEngine(float &l, float &r) {
  const float presenceL = gPresenceHpL.process(l);
  const float presenceR = gPresenceHpR.process(r);
  const float airL = gAirHpL.process(l);
  const float airR = gAirHpR.process(r);

  const float highDetector = absf(airL) > absf(airR) ? absf(airL) : absf(airR);
  const float hc = highDetector > gHarshEnv ? gHarshAttack : gHarshRelease;
  gHarshEnv += (highDetector - gHarshEnv) * hc;
  if (!gClarityEnabled) return;

  const float harshReduction = clampf((gHarshEnv - 0.12f) * 2.5f, 0.0f, 0.42f);
  const float scale = 1.0f - harshReduction;
  const float profileScale = gOutputProfile == 1 ? 1.14f : (gOutputProfile == 2 ? 1.22f : 1.0f);
  const float presenceMix = (0.27f + 0.31f * gIntensity) * scale * profileScale;
  const float airMix = (0.23f + 0.34f * gIntensity) * scale * profileScale;
  const float addL = presenceL * presenceMix + airL * airMix;
  const float addR = presenceR * presenceMix + airR * airMix;
  l += addL; r += addR;

  const float src = absf(presenceL) > absf(presenceR) ? absf(presenceL) : absf(presenceR);
  const float add = absf(addL) > absf(addR) ? absf(addL) : absf(addR);
  if (src > 0.00001f) {
    const float activity = gainToDb(1.0f + add / src);
    if (activity > gClarityActivityDb) gClarityActivityDb = activity;
  }
}

inline void applyImpactEngine(float &l, float &r) {
  const float detector = absf(l) > absf(r) ? absf(l) : absf(r);
  const float fc = detector > gImpactFast ? gImpactFastAttack : gImpactFastRelease;
  const float sc = detector > gImpactSlow ? gImpactSlowAttack : gImpactSlowRelease;
  gImpactFast += (detector - gImpactFast) * fc;
  gImpactSlow += (detector - gImpactSlow) * sc;
  if (!gImpactEnabled) return;

  // V5 could multiply the entire waveform by a very large linear transient factor. On real
  // Bluetooth/headphone material that could sound crunchy before the limiter caught it. V5.1
  // converts the detector to a bounded dB lift and automatically backs off on already-hot peaks.
  const float transient = clampf(gImpactFast - gImpactSlow, 0.0f, 0.30f);
  const float transientNorm = clampf(transient / (gImpactSlow + 0.045f), 0.0f, 1.0f);
  const float profileMaxDb = gOutputProfile == 1 ? 2.8f : (gOutputProfile == 2 ? 2.5f : 2.6f);
  const float maxBoostDb = (profileMaxDb + 1.25f * gIntensity) * (gMode == 2 ? 1.04f : 1.0f);
  const float peakRoom = clampf((0.84f - detector) / 0.48f, 0.18f, 1.0f);
  const float boost = transientNorm * maxBoostDb * peakRoom;
  const float gain = dbToGain(boost);
  l *= gain; r *= gain;
  if (boost > gImpactBoostDb) gImpactBoostDb = boost;
}

inline void applySpatialEngine(float &l, float &r) {
  // State advances regardless of enable state, eliminating stale delay/filter wake-up.
  const float lowL = gSpatialLowL.process(l);
  const float lowR = gSpatialLowR.process(r);
  const float lowMono = 0.5f * (lowL + lowR);
  const float highL = l - lowL;
  const float highR = r - lowR;
  const float mid = 0.5f * (highL + highR);
  float side = 0.5f * (highL - highR);

  float width = 1.0f, delayMix = 0.0f, delayMs = 7.0f;
  if (gOutputProfile == 1) {
    width = 1.28f + 0.42f * gIntensity;
    delayMix = 0.050f + 0.060f * gIntensity;
    delayMs = 7.5f;
  } else if (gOutputProfile == 2) {
    width = 1.48f + 0.50f * gIntensity;
    delayMix = 0.090f + 0.085f * gIntensity;
    delayMs = 10.5f;
  } else {
    const float modeWidth = gSpaceMode == 2 ? 0.48f : (gSpaceMode == 1 ? 0.31f : 0.14f);
    width = 1.0f + modeWidth * (0.55f + 0.45f * gIntensity);
    delayMix = (gSpaceMode == 2 ? 0.135f : (gSpaceMode == 1 ? 0.085f : 0.032f)) * (0.62f + 0.38f * gIntensity);
    delayMs = gSpaceMode == 2 ? 18.0f : (gSpaceMode == 1 ? 12.0f : 7.0f);
  }

  int delaySamples = static_cast<int>(gSampleRate * delayMs * 0.001f + 0.5f);
  if (delaySamples < 1) delaySamples = 1;
  if (delaySamples >= kSpatialDelayMax) delaySamples = kSpatialDelayMax - 1;
  gSpatialDelaySamples = delaySamples;
  int readIndex = gSpatialIndex - gSpatialDelaySamples;
  if (readIndex < 0) readIndex += kSpatialDelayMax;
  const float delayedSide = gSpatialDelay[readIndex];
  gSpatialDelay[gSpatialIndex] = side;
  gSpatialIndex += 1;
  if (gSpatialIndex >= kSpatialDelayMax) gSpatialIndex = 0;

  if (!gSpatialEnabled) { gSpatialWidthPercent = 100.0f; return; }
  side = side * width + delayedSide * delayMix;
  l = lowMono + mid + side;
  r = lowMono + mid - side;
  gSpatialWidthPercent = width * 100.0f;
}

inline void applyDensityMaximizer(float &l, float &r) {
  const float detector = absf(l) > absf(r) ? absf(l) : absf(r);
  const float ec = detector > gMasterEnv ? gMasterAttack : gMasterRelease;
  gMasterEnv += (detector - gMasterEnv) * ec;

  const bool power = gMode == 2;
  const float threshold = power ? (0.320f - 0.120f * gIntensity) : (0.430f - 0.070f * gIntensity);
  const float ratio = power ? (2.00f + 2.20f * gIntensity) : (1.18f + 0.55f * gIntensity);
  float compGain = 1.0f;
  if (gMasterEnv > threshold && gMasterEnv > 0.000001f) {
    const float over = gMasterEnv / threshold;
    compGain = static_cast<float>(pow(over, (1.0f / ratio) - 1.0f));
  }

  const float blend = power ? (0.62f + 0.28f * gIntensity) : (0.36f + 0.22f * gIntensity);
  const float densityL = l * ((1.0f - blend) + blend * compGain);
  const float densityR = r * ((1.0f - blend) + blend * compGain);
  const float densePowerBonus = power ? 1.60f * clampf((gProgramDensity - 0.56f) / 0.27f, 0.0f, 1.0f) : 0.0f;
  const float makeupDb = power
    ? (2.00f + 7.50f * gIntensity + 0.42f * gProgramDensity + densePowerBonus)
    : (0.66f + 1.42f * gIntensity + 0.14f * gProgramDensity);
  const float makeup = dbToGain(makeupDb);
  l = densityL * makeup;
  r = densityR * makeup;

  // A smooth mastering ceiling absorbs only the tallest pre-limiter crests. Its derivative
  // is unity at the knee, so it behaves as a soft peak shaper rather than a hard clipper.
  // This lets POWER add density to already-loud masters without parking the true-peak
  // limiter several dB down for the entire passage.
  if (power) {
    const float knee = 0.86f - 0.12f * gIntensity;
    l = softCeiling(l, knee, 1.08f);
    r = softCeiling(r, knee, 1.08f);
  } else {
    const float knee = 0.93f - 0.03f * gIntensity;
    l = softCeiling(l, knee, 1.085f);
    r = softCeiling(r, knee, 1.085f);
  }
}

void configurePersonalSound() {
  const float bassDb = gOutputProfile == 1 ? 5.8f : (gOutputProfile == 2 ? 5.0f : 4.4f);
  const float presenceDb = gOutputProfile == 1 ? 5.2f : (gOutputProfile == 2 ? 4.7f : 4.2f);
  const float brightnessDb = gOutputProfile == 1 ? 5.8f : (gOutputProfile == 2 ? 5.2f : 4.6f);
  gPersonalBassL.peaking(gSampleRate, 90.0, 0.70, gPersonalBass * bassDb);
  gPersonalBassR.peaking(gSampleRate, 90.0, 0.70, gPersonalBass * bassDb);
  gPersonalPresenceL.peaking(gSampleRate, 3200.0, 0.78, gPersonalPresence * presenceDb);
  gPersonalPresenceR.peaking(gSampleRate, 3200.0, 0.78, gPersonalPresence * presenceDb);
  gPersonalBrightnessL.peaking(gSampleRate, 10000.0, 0.68, gPersonalBrightness * brightnessDb);
  gPersonalBrightnessR.peaking(gSampleRate, 10000.0, 0.68, gPersonalBrightness * brightnessDb);
}

inline void applyPersonalSound(float &l, float &r) {
  // Filter state stays warm while disabled; only the audible assignment is bypassed.
  float pl = gPersonalBrightnessL.process(gPersonalPresenceL.process(gPersonalBassL.process(l)));
  float pr = gPersonalBrightnessR.process(gPersonalPresenceR.process(gPersonalBassR.process(r)));
  if (!gPersonalEnabled) return;
  l = pl; r = pr;
}

inline void applyLimiterAndDelay(float currentL, float currentR, float &outL, float &outR, bool limitingEnabled) {
  const float delayedL = gLookL[gLookIndex];
  const float delayedR = gLookR[gLookIndex];
  const float delayedPeak = gLookPeak[gLookIndex];

  float currentPeak = absf(currentL) > absf(currentR) ? absf(currentL) : absf(currentR);
  if (limitingEnabled) {
    const float tpL = gLimiterTpL.update(currentL);
    const float tpR = gLimiterTpR.update(currentR);
    if (tpL > currentPeak) currentPeak = tpL;
    if (tpR > currentPeak) currentPeak = tpR;
  } else {
    // Keep TP history warm through PURE without applying gain reduction.
    gLimiterTpL.update(currentL);
    gLimiterTpR.update(currentR);
  }

  gLookL[gLookIndex] = currentL;
  gLookR[gLookIndex] = currentR;
  gLookPeak[gLookIndex] = currentPeak;
  gLookIndex += 1;
  if (gLookIndex >= gLookaheadSamples) gLookIndex = 0;

  if (!limitingEnabled) {
    gLimiterGain = 1.0f;
    outL = delayedL; outR = delayedR;
    return;
  }

  float futurePeak = delayedPeak;
  for (int i = 0; i < gLookaheadSamples; ++i) if (gLookPeak[i] > futurePeak) futurePeak = gLookPeak[i];

  float required = 1.0f;
  if (futurePeak > gLimiterCeiling && futurePeak > 0.000001f) required = gLimiterCeiling / futurePeak;
  if (required < gLimiterGain) gLimiterGain = required;
  else gLimiterGain += (1.0f - gLimiterGain) * gLimiterReleaseCoeff;
  gLimiterGain = clampf(gLimiterGain, 0.02f, 1.0f);

  outL = delayedL * gLimiterGain;
  outR = delayedR * gLimiterGain;
  const float gr = -gainToDb(gLimiterGain);
  if (gr > gMeterLimiterGrDb) gMeterLimiterGrDb = gr;
}

inline void trackOutput(float l, float r) {
  const float tpL = gMeterTpL.update(l);
  const float tpR = gMeterTpR.update(r);
  const float tp = tpL > tpR ? tpL : tpR;
  if (tp > gMeterTruePeak) gMeterTruePeak = tp;
  if (absf(l) > 1.0f || absf(r) > 1.0f) gMeterClipCount += 1;
  if (l != l || r != r || absf(l) > 1000000.0f || absf(r) > 1000000.0f) gMeterNanCount += 1;
}
} // namespace

extern "C" {
unsigned int mvp_v2_input_l() { return reinterpret_cast<unsigned int>(gInputL); }
unsigned int mvp_v2_input_r() { return reinterpret_cast<unsigned int>(gInputR); }
unsigned int mvp_v2_output_l() { return reinterpret_cast<unsigned int>(gOutputL); }
unsigned int mvp_v2_output_r() { return reinterpret_cast<unsigned int>(gOutputR); }
int mvp_v2_max_frames() { return kFrames; }

int mvp_v2_init(float sampleRate) {
  if (sampleRate < 32000.0f || sampleRate > 96000.0f) return 0;
  gSampleRate = sampleRate;

  gLookaheadSamples = static_cast<int>(sampleRate * 0.0025f + 0.5f);
  if (gLookaheadSamples < 64) gLookaheadSamples = 64;
  if (gLookaheadSamples > kLookaheadMax) gLookaheadSamples = kLookaheadMax;

  gPeakAttack = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.0007)));
  gPeakRelease = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.180)));
  gAvgAttack = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.030)));
  gAvgRelease = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.380)));
  gAgcUpCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.160)));
  gAgcDownCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.055)));
  gIntensitySmoothCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.020)));
  gBassSmoothCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.025)));

  gBandAttackCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.004)));
  gBandReleaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.130)));
  gHarshAttack = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.010)));
  gHarshRelease = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.220)));

  gImpactFastAttack = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.0012)));
  gImpactFastRelease = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.010)));
  gImpactSlowAttack = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.026)));
  gImpactSlowRelease = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.180)));

  gMasterAttack = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.0025)));
  gMasterRelease = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.120)));
  gLimiterReleaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.022)));

  gSplit90L.configure(sampleRate, 90.0); gSplit90R.configure(sampleRate, 90.0);
  gSplit320L.configure(sampleRate, 320.0); gSplit320R.configure(sampleRate, 320.0);
  gSplit1400L.configure(sampleRate, 1400.0); gSplit1400R.configure(sampleRate, 1400.0);
  gSplit5200L.configure(sampleRate, 5200.0); gSplit5200R.configure(sampleRate, 5200.0);

  gBassDeepL.lowpass(sampleRate, 82.0); gBassDeepR.lowpass(sampleRate, 82.0);
  gBassBodyL.lowpass(sampleRate, 190.0); gBassBodyR.lowpass(sampleRate, 190.0);
  gPresenceHpL.highpass(sampleRate, 3000.0); gPresenceHpR.highpass(sampleRate, 3000.0);
  gAirHpL.highpass(sampleRate, 7600.0); gAirHpR.highpass(sampleRate, 7600.0);
  gSpatialLowL.lowpass(sampleRate, 140.0); gSpatialLowR.lowpass(sampleRate, 140.0);
  configurePersonalSound();
  configureMasterPrep();

  for (int i = 0; i < kEqBands; ++i) configureEqBand(i);
  resetState();
  return 1;
}

void mvp_v2_reset() { resetState(); }
void mvp_v2_reset_meters() { resetMeters(); }

void mvp_v2_set_mode(int mode) {
  const int next = mode < 0 ? 0 : (mode > 2 ? 2 : mode);
  if (next == gMode) return;
  gMode = next;
  // V5 deliberately preserves compressor/AGC/limiter memory. This is one continuous processor.
  resetLiveActivityMeters();
}
void mvp_v2_set_output_profile(int profile) {
  const int next = profile < 0 ? 0 : (profile > 2 ? 2 : profile);
  if (next == gOutputProfile) return;
  gOutputProfile = next;
  configurePersonalSound();
  resetLiveActivityMeters();
}
void mvp_v2_set_intensity(float amount) { gIntensityTarget = clampf(amount, 0.0f, 1.0f); }
void mvp_v2_set_bass_enabled(int enabled) { gBassEnabled = enabled ? 1 : 0; gBassActivityDb = 0.0f; }
void mvp_v2_set_bass_character(float amount) { gBassCharacterTarget = clampf(amount, 0.0f, 1.0f); }
void mvp_v2_set_impact_enabled(int enabled) { gImpactEnabled = enabled ? 1 : 0; gImpactBoostDb = 0.0f; }
void mvp_v2_set_clarity_enabled(int enabled) { gClarityEnabled = enabled ? 1 : 0; gClarityActivityDb = 0.0f; }
void mvp_v2_set_spatial_enabled(int enabled) { gSpatialEnabled = enabled ? 1 : 0; gSpatialWidthPercent = 100.0f; }
void mvp_v2_set_space_mode(int mode) { gSpaceMode = mode < 0 ? 0 : (mode > 2 ? 2 : mode); }
void mvp_v2_set_personal_enabled(int enabled) { gPersonalEnabled = enabled ? 1 : 0; }
void mvp_v2_set_personal_bass(float value) { gPersonalBass = clampf(value, -1.0f, 1.0f); configurePersonalSound(); }
void mvp_v2_set_personal_presence(float value) { gPersonalPresence = clampf(value, -1.0f, 1.0f); configurePersonalSound(); }
void mvp_v2_set_personal_brightness(float value) { gPersonalBrightness = clampf(value, -1.0f, 1.0f); configurePersonalSound(); }

void mvp_v2_set_master_prep(int enabled, float sourceGainDb, float highpassHz, float lowMidDb, float presenceDb, float harshnessDb, float balanceDb, float widthScale) {
  gMasterPrepEnabled = enabled ? 1 : 0;
  gMasterSourceGainDb = clampf(sourceGainDb, 0.0f, 3.0f);
  gMasterHighpassHz = clampf(highpassHz, 18.0f, 40.0f);
  gMasterLowMidDb = clampf(lowMidDb, -3.0f, 2.0f);
  gMasterPresenceDb = clampf(presenceDb, -2.0f, 2.0f);
  gMasterHarshnessDb = clampf(harshnessDb, -3.0f, 1.0f);
  gMasterBalanceDb = clampf(balanceDb, -1.5f, 1.5f);
  gMasterWidthScale = clampf(widthScale, 0.75f, 1.10f);
  configureMasterPrep();
}

void mvp_v2_set_eq_enabled(int enabled) {
  const int next = enabled ? 1 : 0;
  if (next == gEqEnabled) return;
  gEqEnabled = next;
  for (int i = 0; i < kEqBands; ++i) { gEqL[i].reset(); gEqR[i].reset(); }
}
void mvp_v2_set_eq_band(int band, float gainDb) {
  if (band < 0 || band >= kEqBands) return;
  gEqGainDb[band] = clampf(gainDb, -12.0f, 12.0f);
  configureEqBand(band);
}

// Backward-compatible ABI used by older adapters.
void mvp_v2_set_bypass(int enabled) {
  if (enabled) mvp_v2_set_mode(0);
  else if (gMode == 0) mvp_v2_set_mode(1);
}
void mvp_v2_set_loudness_mode(int mode) { mvp_v2_set_mode(mode >= 2 ? 2 : (mode >= 0 ? 1 : 0)); }
void mvp_v2_set_bass(float amount) {
  mvp_v2_set_bass_enabled(amount > 0.0001f ? 1 : 0);
  gBassCharacterTarget = clampf(amount, 0.0f, 1.0f);
}
void mvp_v2_set_clarity(float amount) { mvp_v2_set_clarity_enabled(amount > 0.0001f ? 1 : 0); }
void mvp_v2_set_punch(float amount) { mvp_v2_set_impact_enabled(amount > 0.0001f ? 1 : 0); }
void mvp_v2_set_wide(float amount) { mvp_v2_set_spatial_enabled(amount > 0.0001f ? 1 : 0); }

int mvp_v2_process(int frames) {
  if (frames < 1 || frames > kFrames) return 0;

  for (int i = 0; i < frames; ++i) {
    const float dryL = gInputL[i];
    const float dryR = gInputR[i];
    updateProgramAnalysis(dryL, dryR);

    gIntensity += (gIntensityTarget - gIntensity) * gIntensitySmoothCoeff;
    gBassCharacter += (gBassCharacterTarget - gBassCharacter) * gBassSmoothCoeff;

    float l = dryL, r = dryR;
    const bool processed = gMode != 0;
    if (processed) {
      if (gEqEnabled) {
        for (int band = 0; band < kEqBands; ++band) {
          l = gEqL[band].process(l);
          r = gEqR[band].process(r);
        }
      }

      applyMasterPrep(l, r);
      applyProgramAgc(l, r);
      applyBroadcastDynamics(l, r);
      applyBassEngine(l, r);
      applyClarityEngine(l, r);
      applyImpactEngine(l, r);
      applySpatialEngine(l, r);
      applyDensityMaximizer(l, r);
      applyPersonalSound(l, r);
    } else {
      // Keep effect analysis/state hot while PURE is selected, but output dry/reference audio.
      float shadowL = l, shadowR = r;
      applyMasterPrep(shadowL, shadowR);
      applyProgramAgc(shadowL, shadowR);
      applyBassEngine(shadowL, shadowR);
      applyClarityEngine(shadowL, shadowR);
      applyImpactEngine(shadowL, shadowR);
      applySpatialEngine(shadowL, shadowR);
      applyDensityMaximizer(shadowL, shadowR);
      applyPersonalSound(shadowL, shadowR);
    }

    float outL = 0.0f, outR = 0.0f;
    applyLimiterAndDelay(l, r, outL, outR, processed);
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
float mvp_v2_meter_multiband_gr_db() { return gBandGainReductionDb; }
float mvp_v2_meter_impact_boost_db() { return gImpactBoostDb; }
float mvp_v2_meter_bass_activity_db() { return gBassActivityDb; }
float mvp_v2_meter_clarity_activity_db() { return gClarityActivityDb; }
float mvp_v2_meter_spatial_width_percent() { return gSpatialWidthPercent; }
}
