// MVP Trainer Pro Broadcast Engine V3 R4 live-state fix
// Coordinated adaptive broadcast mastering for Headphones, Bluetooth Speaker and Car/Hi-Fi.
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
constexpr int kLookaheadMax = 256;
constexpr int kSpatialDelayMax = 2048;
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

struct LR4Split {
  Biquad lp1, lp2, hp1, hp2;

  void configure(double sr, double freq) {
    lp1.lowpass(sr, freq); lp2.lowpass(sr, freq);
    hp1.highpass(sr, freq); hp2.highpass(sr, freq);
  }
  void reset() { lp1.reset(); lp2.reset(); hp1.reset(); hp2.reset(); }

  inline void process(float x, float &low, float &high) {
    low = lp2.process(lp1.process(x));
    high = hp2.process(hp1.process(x));
  }
};

struct BandDynamics {
  float env = 0.0f;
  float gain = 1.0f;

  void reset() { env = 0.0f; gain = 1.0f; }

  inline float update(float detector, float threshold, float ratio, float attackCoeff, float releaseCoeff) {
    const float envCoeff = detector > env ? attackCoeff : releaseCoeff;
    env += (detector - env) * envCoeff;

    float target = 1.0f;
    if (env > threshold && env > 0.000001f) {
      const float over = env / threshold;
      target = static_cast<float>(pow(over, (1.0f / ratio) - 1.0f));
    }
    const float gainCoeff = target < gain ? attackCoeff : releaseCoeff;
    gain += (target - gain) * gainCoeff;
    return clampf(gain, 0.12f, 1.0f);
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
float gBassCharacterTarget = 0.50f; // 0 Tight, 1 Deep
float gBassCharacter = 0.50f;
int gImpactEnabled = 0;
int gClarityEnabled = 0;
int gSpatialEnabled = 0;
int gSpaceMode = 0; // 0 Studio, 1 Live, 2 Arena
int gPersonalEnabled = 0;
float gPersonalBass = 0.0f;
float gPersonalPresence = 0.0f;
float gPersonalBrightness = 0.0f;

// Optional Advanced EQ.
int gEqEnabled = 0;
float gEqGainDb[kEqBands] = {};
Biquad gEqL[kEqBands];
Biquad gEqR[kEqBands];

// Four-band broadcast dynamics.
LR4Split gSplit120L, gSplit120R;
LR4Split gSplit600L, gSplit600R;
LR4Split gSplit4500L, gSplit4500R;
BandDynamics gBandDynamics[4];
float gBandAttackCoeff = 0.0f;
float gBandReleaseCoeff = 0.0f;
float gBandGainReductionDb = 0.0f;

// Bass engine.
Biquad gBassDeepL, gBassDeepR;
Biquad gBassBodyL, gBassBodyR;
float gBassActivityDb = 0.0f;

// Clarity / deharsh.
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

// Intelligent maximizer.
float gMasterEnv = 0.0f;
float gMasterAttack = 0.0f;
float gMasterRelease = 0.0f;
float gMasterDrive = 1.0f;
float gSmoothCoeff = 0.001f;

// Lookahead true-peak limiter.
float gLookL[kLookaheadMax] = {};
float gLookR[kLookaheadMax] = {};
float gLookPeak[kLookaheadMax] = {};
int gLookaheadSamples = 96;
int gLookIndex = 0;
float gLimiterGain = 1.0f;
float gLimiterReleaseCoeff = 0.00025f;
const float gLimiterCeiling = 0.9500f;

// True-peak history and meters.
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
}

// V3 R4: mode/profile switches must not inherit compressor, maximizer or limiter memory
// from the previous experience mode. Keep the lookahead audio buffers intact so playback
// stays continuous, but start the new mastering decision from neutral gain.
void resetTransitionMemory() {
  for (int i = 0; i < 4; ++i) gBandDynamics[i].reset();
  gHarshEnv = 0.0f;
  gImpactFast = 0.0f;
  gImpactSlow = 0.0f;
  gMasterEnv = 0.0f;
  gMasterDrive = 1.0f;
  gLimiterGain = 1.0f;
  for (int i = 0; i < 3; ++i) gTpHistL[i] = gTpHistR[i] = 0.0f;
  resetLiveActivityMeters();
}

void resetState() {
  for (int i = 0; i < kEqBands; ++i) { gEqL[i].reset(); gEqR[i].reset(); }
  gSplit120L.reset(); gSplit120R.reset();
  gSplit600L.reset(); gSplit600R.reset();
  gSplit4500L.reset(); gSplit4500R.reset();
  for (int i = 0; i < 4; ++i) gBandDynamics[i].reset();

  gBassDeepL.reset(); gBassDeepR.reset();
  gBassBodyL.reset(); gBassBodyR.reset();
  gPresenceHpL.reset(); gPresenceHpR.reset();
  gAirHpL.reset(); gAirHpR.reset();
  gSpatialLowL.reset(); gSpatialLowR.reset();

  for (int i = 0; i < kSpatialDelayMax; ++i) gSpatialDelay[i] = 0.0f;
  for (int i = 0; i < kLookaheadMax; ++i) { gLookL[i] = 0.0f; gLookR[i] = 0.0f; gLookPeak[i] = 0.0f; }

  gSpatialIndex = 0;
  gLookIndex = 0;
  gHarshEnv = 0.0f;
  gImpactFast = 0.0f;
  gImpactSlow = 0.0f;
  gMasterEnv = 0.0f;
  gMasterDrive = 1.0f;
  gLimiterGain = 1.0f;
  gIntensity = gIntensityTarget;
  gBassCharacter = gBassCharacterTarget;

  for (int i = 0; i < 3; ++i) {
    gTpHistL[i] = gTpHistR[i] = gOutTpHistL[i] = gOutTpHistR[i] = 0.0f;
  }
  resetMeters();
}

inline float softBassHarmonics(float low, float amount) {
  const float drive = 1.0f + 2.2f * amount;
  const float x = clampf(low * drive, -1.15f, 1.15f);
  const float shaped = x - (x*x*x) * 0.16f;
  return (shaped / drive) - low;
}

inline void splitBands(float l, float r, float *bl, float *br) {
  float lowL, restL, lowR, restR;
  gSplit120L.process(l, lowL, restL);
  gSplit120R.process(r, lowR, restR);

  float lowMidL, upperL, lowMidR, upperR;
  gSplit600L.process(restL, lowMidL, upperL);
  gSplit600R.process(restR, lowMidR, upperR);

  float highMidL, highL, highMidR, highR;
  gSplit4500L.process(upperL, highMidL, highL);
  gSplit4500R.process(upperR, highMidR, highR);

  bl[0] = lowL; bl[1] = lowMidL; bl[2] = highMidL; bl[3] = highL;
  br[0] = lowR; br[1] = lowMidR; br[2] = highMidR; br[3] = highR;
}

inline void applyBroadcastDynamics(float &l, float &r) {
  float bl[4], br[4];
  splitBands(l, r, bl, br);

  const float intensity = gIntensity;
  const bool power = gMode == 2;

  // Device-aware thresholds keep small Bluetooth speakers dense while preserving
  // more crest factor on headphones and car/hi-fi.
  const float profileBias =
    gOutputProfile == 2 ? -0.025f :
    gOutputProfile == 1 ? 0.012f : 0.0f;

  const float adaptiveThresholds[4] = {0.28f, 0.24f, 0.20f, 0.16f};
  const float powerThresholds[4]    = {0.22f, 0.19f, 0.16f, 0.13f};
  const float adaptiveRatios[4] = {1.55f, 1.65f, 1.72f, 1.78f};
  const float powerRatios[4]    = {2.35f, 2.55f, 2.75f, 2.90f};

  float maxGr = 0.0f;
  for (int band = 0; band < 4; ++band) {
    const float detector = absf(bl[band]) > absf(br[band]) ? absf(bl[band]) : absf(br[band]);
    const float baseThreshold = power ? powerThresholds[band] : adaptiveThresholds[band];
    const float threshold = clampf(baseThreshold + profileBias - intensity * (power ? 0.030f : 0.012f), 0.08f, 0.45f);
    const float ratioBase = power ? powerRatios[band] : adaptiveRatios[band];
    const float ratio = 1.0f + (ratioBase - 1.0f) * (0.45f + 0.55f * intensity);
    const float gain = gBandDynamics[band].update(detector, threshold, ratio, gBandAttackCoeff, gBandReleaseCoeff);

    const float gr = -gainToDb(gain);
    if (gr > maxGr) maxGr = gr;

    // Small device/personal target correction inside the coordinated band stage.
    float deviceDb = 0.0f;
    if (gOutputProfile == 1) { // headphones
      const float d[4] = {0.35f, -0.15f, 0.20f, 0.45f};
      deviceDb = d[band];
    } else if (gOutputProfile == 2) { // Bluetooth speaker
      const float d[4] = {0.80f, 0.15f, 0.35f, 0.55f};
      deviceDb = d[band];
    } else { // car/hifi
      const float d[4] = {0.10f, 0.0f, 0.15f, 0.18f};
      deviceDb = d[band];
    }

    float personalDb = 0.0f;
    if (gPersonalEnabled) {
      if (band == 0) personalDb += gPersonalBass * 2.5f;
      if (band == 2) personalDb += gPersonalPresence * 2.0f;
      if (band == 3) personalDb += gPersonalBrightness * 2.4f;
    }

    const float targetGain = dbToGain(deviceDb + personalDb);
    bl[band] *= gain * targetGain;
    br[band] *= gain * targetGain;
  }

  if (maxGr > gBandGainReductionDb) gBandGainReductionDb = maxGr;

  l = bl[0] + bl[1] + bl[2] + bl[3];
  r = br[0] + br[1] + br[2] + br[3];
}

inline void applyBassEngine(float &l, float &r) {
  if (!gBassEnabled) return;

  const float deepL = gBassDeepL.process(l);
  const float deepR = gBassDeepR.process(r);
  const float broadL = gBassBodyL.process(l);
  const float broadR = gBassBodyR.process(r);
  const float bodyL = broadL - deepL;
  const float bodyR = broadR - deepR;

  const float c = gBassCharacter;
  const float amount = (0.62f + 0.58f * gIntensity) * (gMode == 2 ? 1.12f : 1.0f);
  const float deepGain = amount * (0.38f + 0.92f * c);
  const float bodyGain = amount * (0.82f - 0.34f * c);
  const float harmonicMix = amount * (0.22f + 0.30f * c);

  const float harmL = softBassHarmonics(deepL, amount);
  const float harmR = softBassHarmonics(deepR, amount);
  const float addL = deepL * deepGain + bodyL * bodyGain + harmL * harmonicMix;
  const float addR = deepR * deepGain + bodyR * bodyGain + harmR * harmonicMix;

  l += addL;
  r += addR;

  const float inPeak = absf(broadL) > absf(broadR) ? absf(broadL) : absf(broadR);
  const float addPeak = absf(addL) > absf(addR) ? absf(addL) : absf(addR);
  if (inPeak > 0.00001f) {
    const float activity = gainToDb(1.0f + addPeak / inPeak);
    if (activity > gBassActivityDb) gBassActivityDb = activity;
  }
}

inline void applyClarityEngine(float &l, float &r) {
  if (!gClarityEnabled) return;

  const float presenceL = gPresenceHpL.process(l);
  const float presenceR = gPresenceHpR.process(r);
  const float airL = gAirHpL.process(l);
  const float airR = gAirHpR.process(r);

  const float highDetector = absf(airL) > absf(airR) ? absf(airL) : absf(airR);
  const float coeff = highDetector > gHarshEnv ? gHarshAttack : gHarshRelease;
  gHarshEnv += (highDetector - gHarshEnv) * coeff;

  // Dynamic de-harsh prevents the clarity control from turning hot masters brittle.
  const float harshReduction = clampf((gHarshEnv - 0.13f) * 2.8f, 0.0f, 0.48f);
  const float scale = 1.0f - harshReduction;
  const float presenceMix = (0.24f + 0.24f * gIntensity) * scale;
  const float airMix = (0.18f + 0.28f * gIntensity) * scale;

  const float addL = presenceL * presenceMix + airL * airMix;
  const float addR = presenceR * presenceMix + airR * airMix;
  l += addL;
  r += addR;

  const float sourcePeak = absf(presenceL) > absf(presenceR) ? absf(presenceL) : absf(presenceR);
  const float addPeak = absf(addL) > absf(addR) ? absf(addL) : absf(addR);
  if (sourcePeak > 0.00001f) {
    const float activity = gainToDb(1.0f + addPeak / sourcePeak);
    if (activity > gClarityActivityDb) gClarityActivityDb = activity;
  }
}

inline void applyImpactEngine(float &l, float &r) {
  if (!gImpactEnabled) return;

  const float detector = absf(l) > absf(r) ? absf(l) : absf(r);
  const float fastCoeff = detector > gImpactFast ? gImpactFastAttack : gImpactFastRelease;
  const float slowCoeff = detector > gImpactSlow ? gImpactSlowAttack : gImpactSlowRelease;
  gImpactFast += (detector - gImpactFast) * fastCoeff;
  gImpactSlow += (detector - gImpactSlow) * slowCoeff;

  const float transient = clampf(gImpactFast - gImpactSlow, 0.0f, 0.38f);
  const float strength = (6.0f + 6.0f * gIntensity) * (gMode == 2 ? 1.08f : 1.0f);
  const float gain = 1.0f + transient * strength;
  l *= gain;
  r *= gain;

  const float boost = gainToDb(gain);
  if (boost > gImpactBoostDb) gImpactBoostDb = boost;
}

inline void applySpatialEngine(float &l, float &r) {
  if (!gSpatialEnabled) {
    gSpatialWidthPercent = 100.0f;
    return;
  }

  const float lowL = gSpatialLowL.process(l);
  const float lowR = gSpatialLowR.process(r);
  const float lowMono = 0.5f * (lowL + lowR);
  const float highL = l - lowL;
  const float highR = r - lowR;
  const float mid = 0.5f * (highL + highR);
  float side = 0.5f * (highL - highR);

  float width = 1.0f;
  float delayMix = 0.0f;
  float delayMs = 8.0f;

  if (gOutputProfile == 1) { // IMMERSION, headphones
    width = 1.18f + 0.25f * gIntensity;
    delayMix = 0.035f + 0.045f * gIntensity;
    delayMs = 7.0f;
  } else if (gOutputProfile == 2) { // STAGE, Bluetooth speaker
    width = 1.34f + 0.34f * gIntensity;
    delayMix = 0.070f + 0.060f * gIntensity;
    delayMs = 10.0f;
  } else { // SPACE, car/hifi
    const float modeWidth = gSpaceMode == 2 ? 0.42f : gSpaceMode == 1 ? 0.28f : 0.12f;
    width = 1.0f + modeWidth * (0.55f + 0.45f * gIntensity);
    delayMix = (gSpaceMode == 2 ? 0.13f : gSpaceMode == 1 ? 0.085f : 0.035f) * (0.60f + 0.40f * gIntensity);
    delayMs = gSpaceMode == 2 ? 18.0f : gSpaceMode == 1 ? 12.0f : 7.0f;
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

  side = side * width + delayedSide * delayMix;

  l = lowMono + mid + side;
  r = lowMono + mid - side;
  gSpatialWidthPercent = width * 100.0f;
}

inline void applyIntelligentMaximizer(float &l, float &r) {
  const float detector = absf(l) > absf(r) ? absf(l) : absf(r);
  const float envCoeff = detector > gMasterEnv ? gMasterAttack : gMasterRelease;
  gMasterEnv += (detector - gMasterEnv) * envCoeff;

  const bool power = gMode == 2;
  const float threshold = power
    ? (0.46f - 0.10f * gIntensity)
    : (0.62f - 0.07f * gIntensity);
  const float ratio = power
    ? (2.1f + 1.8f * gIntensity)
    : (1.25f + 0.55f * gIntensity);

  float compGain = 1.0f;
  if (gMasterEnv > threshold && gMasterEnv > 0.000001f) {
    const float over = gMasterEnv / threshold;
    compGain = static_cast<float>(pow(over, (1.0f / ratio) - 1.0f));
  }

  const float makeupDb = power
    ? (3.1f + 4.0f * gIntensity)
    : (0.9f + 1.1f * gIntensity);
  const float driveTarget = dbToGain(makeupDb);
  gMasterDrive += (driveTarget - gMasterDrive) * gSmoothCoeff;

  const float gain = compGain * gMasterDrive;
  l *= gain;
  r *= gain;
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

  float futurePeak = delayedPeak;
  for (int i = 0; i < gLookaheadSamples; ++i) {
    if (gLookPeak[i] > futurePeak) futurePeak = gLookPeak[i];
  }

  float required = 1.0f;
  if (futurePeak > gLimiterCeiling && futurePeak > 0.000001f) required = gLimiterCeiling / futurePeak;
  if (required < gLimiterGain) gLimiterGain = required;
  else gLimiterGain += (1.0f - gLimiterGain) * gLimiterReleaseCoeff;
  gLimiterGain = clampf(gLimiterGain, 0.025f, 1.0f);

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

  gLookaheadSamples = static_cast<int>(sampleRate * 0.002f + 0.5f);
  if (gLookaheadSamples < 32) gLookaheadSamples = 32;
  if (gLookaheadSamples > kLookaheadMax) gLookaheadSamples = kLookaheadMax;

  gSmoothCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.020)));
  gBandAttackCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.004)));
  gBandReleaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.120)));
  gHarshAttack = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.010)));
  gHarshRelease = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.220)));

  gImpactFastAttack = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.0012)));
  gImpactFastRelease = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.010)));
  gImpactSlowAttack = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.025)));
  gImpactSlowRelease = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.180)));

  gMasterAttack = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.002)));
  gMasterRelease = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.100)));
  gLimiterReleaseCoeff = static_cast<float>(1.0 - exp(-1.0 / (sampleRate * 0.006)));

  gSplit120L.configure(sampleRate, 120.0); gSplit120R.configure(sampleRate, 120.0);
  gSplit600L.configure(sampleRate, 600.0); gSplit600R.configure(sampleRate, 600.0);
  gSplit4500L.configure(sampleRate, 4500.0); gSplit4500R.configure(sampleRate, 4500.0);

  gBassDeepL.lowpass(sampleRate, 85.0); gBassDeepR.lowpass(sampleRate, 85.0);
  gBassBodyL.lowpass(sampleRate, 180.0); gBassBodyR.lowpass(sampleRate, 180.0);

  gPresenceHpL.highpass(sampleRate, 3200.0); gPresenceHpR.highpass(sampleRate, 3200.0);
  gAirHpL.highpass(sampleRate, 8200.0); gAirHpR.highpass(sampleRate, 8200.0);

  gSpatialLowL.lowpass(sampleRate, 120.0); gSpatialLowR.lowpass(sampleRate, 120.0);

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
  resetTransitionMemory();
}
void mvp_v2_set_output_profile(int profile) {
  const int next = profile < 0 ? 0 : (profile > 2 ? 2 : profile);
  if (next == gOutputProfile) return;
  gOutputProfile = next;
  resetTransitionMemory();
  gSpatialLowL.reset(); gSpatialLowR.reset();
  for (int i = 0; i < kSpatialDelayMax; ++i) gSpatialDelay[i] = 0.0f;
  gSpatialIndex = 0;
}
void mvp_v2_set_intensity(float amount) { gIntensityTarget = clampf(amount, 0.0f, 1.0f); }
void mvp_v2_set_bass_enabled(int enabled) {
  const int next = enabled ? 1 : 0;
  if (next == gBassEnabled) return;
  gBassEnabled = next;
  gBassDeepL.reset(); gBassDeepR.reset();
  gBassBodyL.reset(); gBassBodyR.reset();
  gBassActivityDb = 0.0f;
}
void mvp_v2_set_bass_character(float amount) { gBassCharacterTarget = clampf(amount, 0.0f, 1.0f); }
void mvp_v2_set_impact_enabled(int enabled) {
  const int next = enabled ? 1 : 0;
  if (next == gImpactEnabled) return;
  gImpactEnabled = next;
  gImpactFast = 0.0f;
  gImpactSlow = 0.0f;
  gImpactBoostDb = 0.0f;
}
void mvp_v2_set_clarity_enabled(int enabled) {
  const int next = enabled ? 1 : 0;
  if (next == gClarityEnabled) return;
  gClarityEnabled = next;
  gPresenceHpL.reset(); gPresenceHpR.reset();
  gAirHpL.reset(); gAirHpR.reset();
  gHarshEnv = 0.0f;
  gClarityActivityDb = 0.0f;
}
void mvp_v2_set_spatial_enabled(int enabled) {
  const int next = enabled ? 1 : 0;
  if (next == gSpatialEnabled) return;
  gSpatialEnabled = next;
  gSpatialLowL.reset(); gSpatialLowR.reset();
  for (int i = 0; i < kSpatialDelayMax; ++i) gSpatialDelay[i] = 0.0f;
  gSpatialIndex = 0;
  gSpatialWidthPercent = 100.0f;
}
void mvp_v2_set_space_mode(int mode) {
  const int next = mode < 0 ? 0 : (mode > 2 ? 2 : mode);
  if (next == gSpaceMode) return;
  gSpaceMode = next;
  for (int i = 0; i < kSpatialDelayMax; ++i) gSpatialDelay[i] = 0.0f;
  gSpatialIndex = 0;
}
void mvp_v2_set_personal_enabled(int enabled) { gPersonalEnabled = enabled ? 1 : 0; }
void mvp_v2_set_personal_bass(float value) { gPersonalBass = clampf(value, -1.0f, 1.0f); }
void mvp_v2_set_personal_presence(float value) { gPersonalPresence = clampf(value, -1.0f, 1.0f); }
void mvp_v2_set_personal_brightness(float value) { gPersonalBrightness = clampf(value, -1.0f, 1.0f); }

void mvp_v2_set_eq_enabled(int enabled) { gEqEnabled = enabled ? 1 : 0; }
void mvp_v2_set_eq_band(int band, float gainDb) {
  if (band < 0 || band >= kEqBands) return;
  gEqGainDb[band] = clampf(gainDb, -12.0f, 12.0f);
  configureEqBand(band);
}

// Backward-compatible Stage 1 ABI. The new UI/adapter uses the explicit V3 controls above.
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
    float l = gInputL[i];
    float r = gInputR[i];

    gIntensity += (gIntensityTarget - gIntensity) * gSmoothCoeff;
    gBassCharacter += (gBassCharacterTarget - gBassCharacter) * gSmoothCoeff;

    const bool processed = gMode != 0;

    if (processed) {
      if (gEqEnabled) {
        for (int band = 0; band < kEqBands; ++band) {
          l = gEqL[band].process(l);
          r = gEqR[band].process(r);
        }
      }

      applyBroadcastDynamics(l, r);
      applyBassEngine(l, r);
      applyClarityEngine(l, r);
      applyImpactEngine(l, r);
      applySpatialEngine(l, r);
      applyIntelligentMaximizer(l, r);
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
