// MVP Trainer Pro Broadcast Engine V5.3 AUDIBLE CLEAN POWER
// Single-route, control-audible, clean mastering engine for Headphones, Bluetooth Speaker and Car/Hi-Fi.
// ABI remains mvp_v2_* for the production AudioWorklet bridge.

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
constexpr int kLookaheadMax = 384;
constexpr int kTpPhaseTaps = 16;
constexpr double kPi = 3.1415926535897932384626433832795;

inline float absf(float v) { return v < 0.0f ? -v : v; }
inline float maxf(float a, float b) { return a > b ? a : b; }
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

// 4x inter-sample true-peak FIR, phase-normalized.
const float kTpFir[4][kTpPhaseTaps] = {
  {0.0000000000f, 0.0006967276f, -0.0036114518f, 0.0106894409f, -0.0243920034f, 0.0473988787f, -0.0853522687f, 0.1749621972f, 0.9271834644f, -0.0558089374f, 0.0065336228f, 0.0051465217f, -0.0059139618f, 0.0036139880f, -0.0014253083f, 0.0002466871f},
  {-0.0000259944f, 0.0009306425f, -0.0045142792f, 0.0140661965f, -0.0349789143f, 0.0763806998f, -0.1630375417f, 0.4750888740f, 0.7567609472f, -0.1677299103f, 0.0663150886f, -0.0261387989f, 0.0088488163f, -0.0022472932f, 0.0003169478f, -0.0000030777f},
  {-0.0000030777f, 0.0003169478f, -0.0022472932f, 0.0088488163f, -0.0261387989f, 0.0663150886f, -0.1677299103f, 0.7567609472f, 0.4750888740f, -0.1630375417f, 0.0763806998f, -0.0349789143f, 0.0140661965f, -0.0045142792f, 0.0009306425f, -0.0000259944f},
  {0.0002466871f, -0.0014253083f, 0.0036139880f, -0.0059139618f, 0.0051465217f, 0.0065336228f, -0.0558089374f, 0.9271834644f, 0.1749621972f, -0.0853522687f, 0.0473988787f, -0.0243920034f, 0.0106894409f, -0.0036114518f, 0.0006967276f, 0.0000000000f}
};

struct Biquad {
  double b0=1.0,b1=0.0,b2=0.0,a1=0.0,a2=0.0,z1=0.0,z2=0.0;
  inline float process(float input) {
    const double x=input;
    const double y=b0*x+z1;
    z1=b1*x-a1*y+z2;
    z2=b2*x-a2*y;
    return static_cast<float>(y);
  }
  void reset(){ z1=z2=0.0; }
  void identity(){ b0=1.0;b1=b2=a1=a2=0.0; }
  void peaking(double sr,double freq,double q,double gainDb){
    if (gainDb>-0.00001 && gainDb<0.00001){identity();return;}
    const double f=clampd(freq,10.0,sr*0.475), A=pow(10.0,gainDb/40.0), w=2.0*kPi*f/sr;
    const double c=cos(w),s=sin(w),alpha=s/(2.0*q),a0=1.0+alpha/A;
    b0=(1.0+alpha*A)/a0;b1=(-2.0*c)/a0;b2=(1.0-alpha*A)/a0;a1=(-2.0*c)/a0;a2=(1.0-alpha/A)/a0;
  }
  void lowshelf(double sr,double freq,double gainDb){
    if (gainDb>-0.00001 && gainDb<0.00001){identity();return;}
    const double f=clampd(freq,10.0,sr*0.475),A=pow(10.0,gainDb/40.0),w=2.0*kPi*f/sr;
    const double c=cos(w),s=sin(w),beta=2.0*sqrtA(A)*s;
    const double a0=(A+1.0)+(A-1.0)*c+beta;
    b0=A*((A+1.0)-(A-1.0)*c+beta)/a0;
    b1=2.0*A*((A-1.0)-(A+1.0)*c)/a0;
    b2=A*((A+1.0)-(A-1.0)*c-beta)/a0;
    a1=-2.0*((A-1.0)+(A+1.0)*c)/a0;
    a2=((A+1.0)+(A-1.0)*c-beta)/a0;
  }
  void highshelf(double sr,double freq,double gainDb){
    if (gainDb>-0.00001 && gainDb<0.00001){identity();return;}
    const double f=clampd(freq,10.0,sr*0.475),A=pow(10.0,gainDb/40.0),w=2.0*kPi*f/sr;
    const double c=cos(w),s=sin(w),beta=2.0*sqrtA(A)*s;
    const double a0=(A+1.0)-(A-1.0)*c+beta;
    b0=A*((A+1.0)+(A-1.0)*c+beta)/a0;
    b1=-2.0*A*((A-1.0)+(A+1.0)*c)/a0;
    b2=A*((A+1.0)+(A-1.0)*c-beta)/a0;
    a1=2.0*((A-1.0)-(A+1.0)*c)/a0;
    a2=((A+1.0)-(A-1.0)*c-beta)/a0;
  }
  void highpass(double sr,double freq,double q=0.70710678118){
    const double f=clampd(freq,10.0,sr*0.475),w=2.0*kPi*f/sr,c=cos(w),s=sin(w),alpha=s/(2.0*q),a0=1.0+alpha;
    b0=((1.0+c)*0.5)/a0;b1=(-(1.0+c))/a0;b2=((1.0+c)*0.5)/a0;a1=(-2.0*c)/a0;a2=(1.0-alpha)/a0;
  }
  static double sqrtA(double A){ return pow(A,0.5); }
};

struct TruePeak4x {
  float hist[kTpPhaseTaps] = {};
  void reset(){for(int i=0;i<kTpPhaseTaps;++i)hist[i]=0.0f;}
  inline float update(float x){
    for(int i=kTpPhaseTaps-1;i>0;--i)hist[i]=hist[i-1]; hist[0]=x;
    float p=absf(x);
    for(int ph=0;ph<4;++ph){float y=0;for(int k=0;k<kTpPhaseTaps;++k)y+=hist[k]*kTpFir[ph][k];p=maxf(p,absf(y));}
    return p;
  }
};

alignas(16) float gInputL[kFrames]={},gInputR[kFrames]={},gOutputL[kFrames]={},gOutputR[kFrames]={};
float gSampleRate=48000.0f;

int gMode=0; // 0 PURE, 1 ADAPTIVE, 2 POWER
int gProfile=1; // 0 car, 1 headphones, 2 speaker
float gIntensityTarget=.72f,gIntensity=.72f;
int gBassEnabled=0; float gBassCharacterTarget=.5f,gBassCharacter=.5f;
int gImpactEnabled=0,gClarityEnabled=0,gSpatialEnabled=0,gSpaceMode=0;
int gPersonalEnabled=0; float gPersonalBass=0,gPersonalPresence=0,gPersonalBrightness=0;
int gMasterPrepEnabled=0; float gMasterSourceGainDb=0,gMasterHighpassHz=18,gMasterLowMidDb=0,gMasterPresenceDb=0,gMasterHarshnessDb=0,gMasterBalanceDb=0,gMasterWidthScale=1;
int gEqEnabled=0; float gEqGainDb[kEqBands]={};

Biquad gEqL[kEqBands],gEqR[kEqBands];
Biquad gModeBassL,gModeBassR,gModeBodyL,gModeBodyR,gModeMudL,gModeMudR,gModePresenceL,gModePresenceR,gModeAirL,gModeAirR;
Biquad gBassShelfL,gBassShelfR,gBassPunchL,gBassPunchR;
Biquad gImpactToneL,gImpactToneR;
Biquad gClarityPresenceL,gClarityPresenceR,gClarityAirL,gClarityAirR;
Biquad gSpatialDecorHp; float gSpatialDelay[4096]={}; int gSpatialIndex=0;
Biquad gPersonalBassL,gPersonalBassR,gPersonalPresenceL,gPersonalPresenceR,gPersonalBrightL,gPersonalBrightR;
Biquad gMasterHpL,gMasterHpR,gMasterLowMidL,gMasterLowMidR,gMasterPresenceL,gMasterPresenceR,gMasterHarshL,gMasterHarshR;

float gProgramPeak=0,gProgramAvg=0,gProgramDensity=0; unsigned int gProgramSamples=0;
float gPeakAttack=0,gPeakRelease=0,gAvgAttack=0,gAvgRelease=0;
float gCompEnv=0,gCompGain=1,gCompAttack=0,gCompRelease=0;
float gImpactFast=0,gImpactSlow=0,gImpactFastAttack=0,gImpactFastRelease=0,gImpactSlowAttack=0,gImpactSlowRelease=0;
float gSmoothIntensity=0,gSmoothBass=0;

float gLookL[kLookaheadMax]={},gLookR[kLookaheadMax]={},gLookPeak[kLookaheadMax]={};
int gLookahead=144,gLookIndex=0,gPureFlushRemaining=0,gTransitionSafetyRemaining=0;
float gLimiterGain=1,gLimiterRelease=0; const float gCeiling=.9200f;
TruePeak4x gLimiterTpL,gLimiterTpR,gMeterTpL,gMeterTpR;
float gMeterTruePeak=0,gMeterLimiterGrDb=0,gMeterImpactBoostDb=0,gMeterBassActivityDb=0,gMeterClarityActivityDb=0,gMeterWidthPercent=100;
unsigned int gMeterClipCount=0,gMeterNanCount=0;

void configureEqBand(int i){ if(i<0||i>=kEqBands)return; gEqL[i].peaking(gSampleRate,kEqFrequencies[i],4.3184730469,gEqGainDb[i]); gEqR[i].peaking(gSampleRate,kEqFrequencies[i],4.3184730469,gEqGainDb[i]); }

float eqHeadroomGain(){
  if(!gEqEnabled)return 1.0f;
  float maxBoost=0,sumBoost=0;
  for(int i=0;i<kEqBands;++i)if(gEqGainDb[i]>0){sumBoost+=gEqGainDb[i];maxBoost=maxf(maxBoost,gEqGainDb[i]);}
  const float trim=clampf(maxBoost*.30f + maxf(0.0f,sumBoost-maxBoost)*.10f,0.0f,7.0f);
  return dbToGain(-trim);
}

void configureModeTone(){
  const float i=clampf(gIntensityTarget,0,1);
  float bass=0,body=0,mud=0,pres=0,air=0;
  if(gMode==1){ bass=.30f+.55f*i; body=.18f+.42f*i; mud=-.10f-.18f*i; pres=.25f+.55f*i; air=.12f+.42f*i; }
  else if(gMode==2){ bass=1.20f+2.00f*i; body=.90f+1.45f*i; mud=-.70f-.80f*i; pres=1.10f+1.95f*i; air=.65f+1.55f*i; }
  if(gProfile==2){bass*=1.12f;body*=1.08f;pres*=1.05f;}
  if(gProfile==0){bass*=.94f;air*=.90f;}
  gModeBassL.lowshelf(gSampleRate,78,bass); gModeBassR.lowshelf(gSampleRate,78,bass);
  gModeBodyL.peaking(gSampleRate,155,.75,body); gModeBodyR.peaking(gSampleRate,155,.75,body);
  gModeMudL.peaking(gSampleRate,520,.72,mud); gModeMudR.peaking(gSampleRate,520,.72,mud);
  gModePresenceL.peaking(gSampleRate,2800,.85,pres); gModePresenceR.peaking(gSampleRate,2800,.85,pres);
  gModeAirL.highshelf(gSampleRate,8500,air); gModeAirR.highshelf(gSampleRate,8500,air);
}

void configureBass(){
  const float c=clampf(gBassCharacterTarget,0,1), i=clampf(gIntensityTarget,0,1);
  const float profile=gProfile==1?1.08f:(gProfile==2?1.0f:.94f);
  const float deepDb=(2.0f + 4.2f*c)*(0.72f+.48f*i)*profile;
  const float punchDb=(5.0f - 3.6f*c)*(0.72f+.48f*i)*profile;
  const float deepHz=52.0f+12.0f*(1.0f-c);
  const float punchHz=128.0f-28.0f*c;
  gBassShelfL.lowshelf(gSampleRate,deepHz,deepDb); gBassShelfR.lowshelf(gSampleRate,deepHz,deepDb);
  gBassPunchL.peaking(gSampleRate,punchHz,.82,punchDb); gBassPunchR.peaking(gSampleRate,punchHz,.82,punchDb);
}

void configureImpact(){
  const float i=clampf(gIntensityTarget,0,1);
  const float db=(1.15f+1.65f*i)*(gProfile==2?1.05f:1.0f);
  gImpactToneL.peaking(gSampleRate,1850,.95,db); gImpactToneR.peaking(gSampleRate,1850,.95,db);
}

void configureClarity(){
  const float i=clampf(gIntensityTarget,0,1),p=gProfile==1?1.08f:(gProfile==2?1.02f:.94f);
  const float presence=(1.55f+2.20f*i)*p, air=(1.25f+2.35f*i)*p;
  gClarityPresenceL.peaking(gSampleRate,3400,.82,presence); gClarityPresenceR.peaking(gSampleRate,3400,.82,presence);
  gClarityAirL.highshelf(gSampleRate,9000,air); gClarityAirR.highshelf(gSampleRate,9000,air);
}

void configurePersonal(){
  const float pb=gPersonalBass*(gProfile==1?6.2f:(gProfile==2?6.0f:5.5f));
  const float pp=gPersonalPresence*(gProfile==1?5.6f:5.2f);
  const float br=gPersonalBrightness*(gProfile==1?6.0f:(gProfile==2?5.6f:5.2f));
  gPersonalBassL.lowshelf(gSampleRate,95,pb); gPersonalBassR.lowshelf(gSampleRate,95,pb);
  gPersonalPresenceL.peaking(gSampleRate,3100,.78,pp); gPersonalPresenceR.peaking(gSampleRate,3100,.78,pp);
  gPersonalBrightL.highshelf(gSampleRate,8500,br); gPersonalBrightR.highshelf(gSampleRate,8500,br);
}

void configureMaster(){
  gMasterHpL.highpass(gSampleRate,gMasterHighpassHz); gMasterHpR.highpass(gSampleRate,gMasterHighpassHz);
  gMasterLowMidL.peaking(gSampleRate,260,.72,gMasterLowMidDb); gMasterLowMidR.peaking(gSampleRate,260,.72,gMasterLowMidDb);
  gMasterPresenceL.peaking(gSampleRate,3000,.85,gMasterPresenceDb); gMasterPresenceR.peaking(gSampleRate,3000,.85,gMasterPresenceDb);
  gMasterHarshL.peaking(gSampleRate,6200,1.0,gMasterHarshnessDb); gMasterHarshR.peaking(gSampleRate,6200,1.0,gMasterHarshnessDb);
}

void resetMeters(){gMeterTruePeak=0;gMeterLimiterGrDb=0;gMeterImpactBoostDb=0;gMeterBassActivityDb=0;gMeterClarityActivityDb=0;gMeterWidthPercent=100;gMeterClipCount=0;gMeterNanCount=0;gMeterTpL.reset();gMeterTpR.reset();}

void resetState(){
  for(int i=0;i<kEqBands;++i){gEqL[i].reset();gEqR[i].reset();}
  Biquad* fs[]={&gModeBassL,&gModeBassR,&gModeBodyL,&gModeBodyR,&gModeMudL,&gModeMudR,&gModePresenceL,&gModePresenceR,&gModeAirL,&gModeAirR,&gBassShelfL,&gBassShelfR,&gBassPunchL,&gBassPunchR,&gImpactToneL,&gImpactToneR,&gClarityPresenceL,&gClarityPresenceR,&gClarityAirL,&gClarityAirR,&gSpatialDecorHp,&gPersonalBassL,&gPersonalBassR,&gPersonalPresenceL,&gPersonalPresenceR,&gPersonalBrightL,&gPersonalBrightR,&gMasterHpL,&gMasterHpR,&gMasterLowMidL,&gMasterLowMidR,&gMasterPresenceL,&gMasterPresenceR,&gMasterHarshL,&gMasterHarshR};
  for(unsigned int i=0;i<sizeof(fs)/sizeof(fs[0]);++i)fs[i]->reset();
  for(int i=0;i<kLookaheadMax;++i){gLookL[i]=gLookR[i]=gLookPeak[i]=0;} for(int i=0;i<4096;++i)gSpatialDelay[i]=0; gSpatialIndex=0;
  gLookIndex=0;gPureFlushRemaining=0;gTransitionSafetyRemaining=0;gLimiterGain=1;gLimiterTpL.reset();gLimiterTpR.reset();
  gProgramPeak=gProgramAvg=gProgramDensity=0;gProgramSamples=0;gCompEnv=0;gCompGain=1;gImpactFast=gImpactSlow=0;
  gIntensity=gIntensityTarget;gBassCharacter=gBassCharacterTarget;resetMeters();
}

inline void updateAnalysis(float l,float r){
  const float d=maxf(absf(l),absf(r));
  const float pc=d>gProgramPeak?gPeakAttack:gPeakRelease; gProgramPeak+=(d-gProgramPeak)*pc;
  const float ac=d>gProgramAvg?gAvgAttack:gAvgRelease; gProgramAvg+=(d-gProgramAvg)*ac;
  gProgramDensity=clampf(gProgramAvg/(gProgramPeak>1e-6f?gProgramPeak:1e-6f),0,1);
  if(gProgramSamples<0x7fffffffu)++gProgramSamples;
}

inline void applyEq(float &l,float &r){
  if(!gEqEnabled){ for(int i=0;i<kEqBands;++i){(void)gEqL[i].process(l);(void)gEqR[i].process(r);} return; }
  const float hg=eqHeadroomGain();l*=hg;r*=hg;
  for(int i=0;i<kEqBands;++i){l=gEqL[i].process(l);r=gEqR[i].process(r);}
}

inline void applyMaster(float &l,float &r){
  float pl=gMasterHarshL.process(gMasterPresenceL.process(gMasterLowMidL.process(gMasterHpL.process(l))));
  float pr=gMasterHarshR.process(gMasterPresenceR.process(gMasterLowMidR.process(gMasterHpR.process(r))));
  if(!gMasterPrepEnabled)return;
  const float warm=clampf((static_cast<float>(gProgramSamples)-gSampleRate*.05f)/(gSampleRate*.20f),0,1);
  const float hot=clampf((gProgramPeak-.62f)/.28f,0,1);
  const float gainDb=gMasterSourceGainDb*warm*(1.0f-.75f*hot);
  pl*=dbToGain(gainDb);pr*=dbToGain(gainDb);
  if(gMasterBalanceDb>0)pr*=dbToGain(gMasterBalanceDb);else if(gMasterBalanceDb<0)pl*=dbToGain(-gMasterBalanceDb);
  const float mid=.5f*(pl+pr),side=.5f*(pl-pr)*gMasterWidthScale;l=mid+side;r=mid-side;
}

inline void applyModeCore(float &l,float &r){
  if(gMode==0)return;
  const bool power=gMode==2; const float i=gIntensity;
  const float detector=maxf(absf(l),absf(r));
  const float ec=detector>gCompEnv?gCompAttack:gCompRelease;gCompEnv+=(detector-gCompEnv)*ec;
  const float threshold=power?(.43f-.13f*i):(.60f-.08f*i);
  const float ratio=power?(2.5f+1.5f*i):(1.35f+.45f*i);
  float target=1.0f;
  if(gCompEnv>threshold&&gCompEnv>1e-6f){const float over=gCompEnv/threshold;target=static_cast<float>(pow(over,(1.0f/ratio)-1.0f));}
  const float gc=target<gCompGain?gCompAttack:gCompRelease;gCompGain+=(target-gCompGain)*gc;
  const float blend=power?(.56f+.18f*i):(.24f+.16f*i);
  const float compressedGain=(1.0f-blend)+blend*gCompGain;
  const float desiredMakeupDb=power?(2.15f+2.15f*i):(.60f+.75f*i);
  // Keep the final limiter in a useful 0-4 dB range even on hot masters. This cap never cancels mode tone/effect differences.
  const float peak=maxf(absf(l),absf(r))*compressedGain;
  const float allowed=power?1.30f:1.10f;
  float gain=dbToGain(desiredMakeupDb); if(peak>1e-5f)gain=clampf(gain,1.0f,allowed/peak);
  const float modeTrimDb=power ? (.35f+.55f*i) : (.28f+.12f*i);
  l*=compressedGain*gain*dbToGain(-modeTrimDb);r*=compressedGain*gain*dbToGain(-modeTrimDb);
  l=gModeAirL.process(gModePresenceL.process(gModeMudL.process(gModeBodyL.process(gModeBassL.process(l)))));
  r=gModeAirR.process(gModePresenceR.process(gModeMudR.process(gModeBodyR.process(gModeBassR.process(r)))));
}

inline void applyBass(float &l,float &r){
  const float trim=dbToGain(-(2.8f+1.2f*gBassCharacter));
  const float bl=gBassPunchL.process(gBassShelfL.process(l*trim)), br=gBassPunchR.process(gBassShelfR.process(r*trim));
  if(!gBassEnabled)return;
  const float src=maxf(absf(l),absf(r)),out=maxf(absf(bl),absf(br));
  l=bl;r=br;if(src>1e-5f)gMeterBassActivityDb=maxf(gMeterBassActivityDb,gainToDb(out/src));
}

inline void applyImpact(float &l,float &r){
  const float toneL=gImpactToneL.process(l),toneR=gImpactToneR.process(r);
  const float d=maxf(absf(l),absf(r));
  const float fc=d>gImpactFast?gImpactFastAttack:gImpactFastRelease;gImpactFast+=(d-gImpactFast)*fc;
  const float sc=d>gImpactSlow?gImpactSlowAttack:gImpactSlowRelease;gImpactSlow+=(d-gImpactSlow)*sc;
  if(!gImpactEnabled)return;
  const float transient=clampf((gImpactFast-gImpactSlow)/(gImpactSlow+.035f),0,1);
  const float boostDb=transient*(1.25f+2.30f*gIntensity);
  const float dynamic=dbToGain(boostDb);
  // Blend a guaranteed attack/presence contour with bounded transient lift.
  const float mix=.72f+.18f*gIntensity;
  const float impactTrim=dbToGain(-(1.00f+1.00f*gIntensity));
  l=((1.0f-mix)*l+mix*toneL)*dynamic*impactTrim; r=((1.0f-mix)*r+mix*toneR)*dynamic*impactTrim;
  gMeterImpactBoostDb=maxf(gMeterImpactBoostDb,boostDb);
}

inline void applyClarity(float &l,float &r){
  const float cl=gClarityAirL.process(gClarityPresenceL.process(l)),cr=gClarityAirR.process(gClarityPresenceR.process(r));
  if(!gClarityEnabled)return;
  const float src=maxf(absf(l),absf(r)),out=maxf(absf(cl),absf(cr));const float clarityTrim=dbToGain(-(1.40f+.80f*gIntensity));l=cl*clarityTrim;r=cr*clarityTrim;
  if(src>1e-5f)gMeterClarityActivityDb=maxf(gMeterClarityActivityDb,gainToDb(out/src));
}

inline void applySpatial(float &l,float &r){
  const float mid=.5f*(l+r),side=.5f*(l-r);
  int delaySamples=static_cast<int>(gSampleRate*(gProfile==1?.010f:(gProfile==2?.012f:(gSpaceMode==2?.017f:(gSpaceMode==1?.012f:.008f)))));
  if(delaySamples<1)delaySamples=1;if(delaySamples>4095)delaySamples=4095;int ri=gSpatialIndex-delaySamples;if(ri<0)ri+=4096;
  const float delayed=gSpatialDelay[ri];gSpatialDelay[gSpatialIndex]=mid;gSpatialIndex=(gSpatialIndex+1)&4095;
  const float decor=gSpatialDecorHp.process(delayed);
  if(!gSpatialEnabled){gMeterWidthPercent=100;return;}
  float width=1.0f,decorMix=0;
  if(gProfile==1){width=1.32f+.38f*gIntensity;decorMix=.065f+.075f*gIntensity;}
  else if(gProfile==2){width=1.42f+.42f*gIntensity;decorMix=.075f+.085f*gIntensity;}
  else {const float x=gSpaceMode==2?.64f:(gSpaceMode==1?.42f:.20f);width=1.0f+x*(.55f+.45f*gIntensity);decorMix=(gSpaceMode==2?.13f:(gSpaceMode==1?.09f:.05f))*(.65f+.35f*gIntensity);}
  const float s=side*width+decor*decorMix; l=mid+s;r=mid-s;gMeterWidthPercent=width*100.0f;
}

inline void applyPersonal(float &l,float &r){
  const float pl=gPersonalBrightL.process(gPersonalPresenceL.process(gPersonalBassL.process(l)));
  const float pr=gPersonalBrightR.process(gPersonalPresenceR.process(gPersonalBassR.process(r)));
  if(!gPersonalEnabled)return;
  // Reserve only enough headroom for stacked positive controls; tonal delta remains fully audible.
  const float b=gPersonalBass>0?gPersonalBass:0,p=gPersonalPresence>0?gPersonalPresence:0,br=gPersonalBrightness>0?gPersonalBrightness:0;
  const float pos=b+p+br,maxp=maxf(b,maxf(p,br)),stacked=pos-maxp;
  const float trim=dbToGain(-clampf(maxp*3.5f+stacked*1.0f,0,5.8f));l=pl*trim;r=pr*trim;
}

inline void limiter(float inL,float inR,float &outL,float &outR,bool enabled){
  const float delayedL=gLookL[gLookIndex],delayedR=gLookR[gLookIndex],delayedPeak=gLookPeak[gLookIndex];
  float p=maxf(absf(inL),absf(inR)); if(enabled){p=maxf(p,gLimiterTpL.update(inL));p=maxf(p,gLimiterTpR.update(inR));}else{p=maxf(p,gLimiterTpL.update(inL));p=maxf(p,gLimiterTpR.update(inR));}
  gLookL[gLookIndex]=inL;gLookR[gLookIndex]=inR;gLookPeak[gLookIndex]=p;gLookIndex=(gLookIndex+1)%gLookahead;
  if(!enabled){
    if(gPureFlushRemaining>0){float safe=1.0f;if(delayedPeak>gCeiling&&delayedPeak>1e-6f)safe=gCeiling/delayedPeak;outL=delayedL*safe;outR=delayedR*safe;--gPureFlushRemaining;}else{outL=delayedL;outR=delayedR;}
    gLimiterGain=1;return;
  }
  float future=0;for(int i=0;i<gLookahead;++i)future=maxf(future,gLookPeak[i]);
  float required=future>gCeiling?gCeiling/future:1.0f;
  if(required<gLimiterGain)gLimiterGain=required;else gLimiterGain+=(1.0f-gLimiterGain)*gLimiterRelease;
  gLimiterGain=clampf(gLimiterGain,.1f,1.0f);outL=delayedL*gLimiterGain;outR=delayedR*gLimiterGain;if(gTransitionSafetyRemaining>0){const float tg=dbToGain(-1.5f);outL*=tg;outR*=tg;--gTransitionSafetyRemaining;}
  gMeterLimiterGrDb=maxf(gMeterLimiterGrDb,-gainToDb(gLimiterGain));
}

inline void meter(float l,float r){
  const float tp=maxf(gMeterTpL.update(l),gMeterTpR.update(r));gMeterTruePeak=maxf(gMeterTruePeak,tp);
  if(absf(l)>1||absf(r)>1)++gMeterClipCount;
  if(l!=l||r!=r||absf(l)>1000000||absf(r)>1000000)++gMeterNanCount;
}
} // namespace

extern "C" {
unsigned int mvp_v2_input_l(){return reinterpret_cast<unsigned int>(gInputL);} unsigned int mvp_v2_input_r(){return reinterpret_cast<unsigned int>(gInputR);} unsigned int mvp_v2_output_l(){return reinterpret_cast<unsigned int>(gOutputL);} unsigned int mvp_v2_output_r(){return reinterpret_cast<unsigned int>(gOutputR);} int mvp_v2_max_frames(){return kFrames;}

int mvp_v2_init(float sr){
  if(sr<32000||sr>96000)return 0;gSampleRate=sr;gLookahead=static_cast<int>(sr*.0025f+.5f);if(gLookahead<64)gLookahead=64;if(gLookahead>kLookaheadMax)gLookahead=kLookaheadMax;
  gPeakAttack=1.0f-static_cast<float>(exp(-1.0/(sr*.001)));gPeakRelease=1.0f-static_cast<float>(exp(-1.0/(sr*.180)));gAvgAttack=1.0f-static_cast<float>(exp(-1.0/(sr*.025)));gAvgRelease=1.0f-static_cast<float>(exp(-1.0/(sr*.300)));
  gCompAttack=1.0f-static_cast<float>(exp(-1.0/(sr*.004)));gCompRelease=1.0f-static_cast<float>(exp(-1.0/(sr*.110)));
  gImpactFastAttack=1.0f-static_cast<float>(exp(-1.0/(sr*.0012)));gImpactFastRelease=1.0f-static_cast<float>(exp(-1.0/(sr*.014)));gImpactSlowAttack=1.0f-static_cast<float>(exp(-1.0/(sr*.030)));gImpactSlowRelease=1.0f-static_cast<float>(exp(-1.0/(sr*.160)));
  gSmoothIntensity=1.0f-static_cast<float>(exp(-1.0/(sr*.018)));gSmoothBass=1.0f-static_cast<float>(exp(-1.0/(sr*.020)));gLimiterRelease=1.0f-static_cast<float>(exp(-1.0/(sr*.075)));
  for(int i=0;i<kEqBands;++i)configureEqBand(i);gSpatialDecorHp.highpass(sr,260.0);configureModeTone();configureBass();configureImpact();configureClarity();configurePersonal();configureMaster();resetState();return 1;
}
void mvp_v2_reset(){resetState();} void mvp_v2_reset_meters(){resetMeters();}
void mvp_v2_set_mode(int m){const int next=m<0?0:(m>2?2:m);if(next==gMode)return;const int prev=gMode;gMode=next;if(next==0&&prev!=0)gPureFlushRemaining=gLookahead;else if(next!=0)gPureFlushRemaining=0;if(next!=0&&prev!=next)gTransitionSafetyRemaining=gLookahead*3;configureModeTone();}
void mvp_v2_set_output_profile(int p){gProfile=p<0?0:(p>2?2:p);configureModeTone();configureBass();configureImpact();configureClarity();configurePersonal();}
void mvp_v2_set_intensity(float x){gIntensityTarget=clampf(x,0,1);configureModeTone();configureBass();configureImpact();configureClarity();}
void mvp_v2_set_bass_enabled(int e){gBassEnabled=e?1:0;} void mvp_v2_set_bass_character(float x){gBassCharacterTarget=clampf(x,0,1);configureBass();}
void mvp_v2_set_impact_enabled(int e){gImpactEnabled=e?1:0;} void mvp_v2_set_clarity_enabled(int e){gClarityEnabled=e?1:0;} void mvp_v2_set_spatial_enabled(int e){gSpatialEnabled=e?1:0;} void mvp_v2_set_space_mode(int m){gSpaceMode=m<0?0:(m>2?2:m);}
void mvp_v2_set_personal_enabled(int e){gPersonalEnabled=e?1:0;} void mvp_v2_set_personal_bass(float x){gPersonalBass=clampf(x,-1,1);configurePersonal();} void mvp_v2_set_personal_presence(float x){gPersonalPresence=clampf(x,-1,1);configurePersonal();} void mvp_v2_set_personal_brightness(float x){gPersonalBrightness=clampf(x,-1,1);configurePersonal();}
void mvp_v2_set_master_prep(int e,float sourceGainDb,float highpassHz,float lowMidDb,float presenceDb,float harshnessDb,float balanceDb,float widthScale){gMasterPrepEnabled=e?1:0;gMasterSourceGainDb=clampf(sourceGainDb,0,3);gMasterHighpassHz=clampf(highpassHz,18,40);gMasterLowMidDb=clampf(lowMidDb,-3,2);gMasterPresenceDb=clampf(presenceDb,-2,2);gMasterHarshnessDb=clampf(harshnessDb,-3,1);gMasterBalanceDb=clampf(balanceDb,-1.5f,1.5f);gMasterWidthScale=clampf(widthScale,.75f,1.10f);configureMaster();}
void mvp_v2_set_eq_enabled(int e){gEqEnabled=e?1:0;} void mvp_v2_set_eq_band(int i,float db){if(i<0||i>=kEqBands)return;gEqGainDb[i]=clampf(db,-12,12);configureEqBand(i);}
void mvp_v2_set_bypass(int e){if(e)mvp_v2_set_mode(0);else if(gMode==0)mvp_v2_set_mode(1);} void mvp_v2_set_loudness_mode(int m){mvp_v2_set_mode(m>=2?2:(m>=0?1:0));}
void mvp_v2_set_bass(float a){mvp_v2_set_bass_enabled(a>.0001f);mvp_v2_set_bass_character(a);} void mvp_v2_set_clarity(float a){mvp_v2_set_clarity_enabled(a>.0001f);} void mvp_v2_set_punch(float a){mvp_v2_set_impact_enabled(a>.0001f);} void mvp_v2_set_wide(float a){mvp_v2_set_spatial_enabled(a>.0001f);}

int mvp_v2_process(int frames){
  if(frames<1||frames>kFrames)return 0;
  for(int i=0;i<frames;++i){
    float l=gInputL[i],r=gInputR[i];updateAnalysis(l,r);gIntensity+=(gIntensityTarget-gIntensity)*gSmoothIntensity;gBassCharacter+=(gBassCharacterTarget-gBassCharacter)*gSmoothBass;
    const bool processed=gMode!=0;
    if(processed){applyEq(l,r);applyMaster(l,r);applyModeCore(l,r);applyBass(l,r);applyImpact(l,r);applyClarity(l,r);applySpatial(l,r);applyPersonal(l,r);const float stackTrimDb=(gImpactEnabled?.84f:0.0f)+(gClarityEnabled?.60f:0.0f)+(gBassEnabled?.15f:0.0f)+(gSpatialEnabled?.10f:0.0f);if(stackTrimDb>0){const float sg=dbToGain(-stackTrimDb);l*=sg;r*=sg;}} else {
      // Keep filter/envelope state warm while PURE is selected, but preserve reference audio.
      float sl=l,sr=r;applyEq(sl,sr);applyMaster(sl,sr);applyModeCore(sl,sr);applyBass(sl,sr);applyImpact(sl,sr);applyClarity(sl,sr);applySpatial(sl,sr);applyPersonal(sl,sr);
    }
    float ol=0,orr=0;limiter(l,r,ol,orr,processed);gOutputL[i]=ol;gOutputR[i]=orr;meter(ol,orr);
  }return 1;
}
float mvp_v2_meter_true_peak_dbtp(){return gainToDb(gMeterTruePeak);} float mvp_v2_meter_limiter_gr_db(){return gMeterLimiterGrDb;} unsigned int mvp_v2_meter_clip_count(){return gMeterClipCount;} unsigned int mvp_v2_meter_nan_count(){return gMeterNanCount;} float mvp_v2_meter_multiband_gr_db(){return gMeterLimiterGrDb;} float mvp_v2_meter_impact_boost_db(){return gMeterImpactBoostDb;} float mvp_v2_meter_bass_activity_db(){return gMeterBassActivityDb;} float mvp_v2_meter_clarity_activity_db(){return gMeterClarityActivityDb;} float mvp_v2_meter_spatial_width_percent(){return gMeterWidthPercent;}
}
