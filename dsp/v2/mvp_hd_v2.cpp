// MVP Trainer Pro Broadcast Engine V5.7 PERCEPTUAL AUDIBILITY
// One clean route. Visible controls must change the sound in the intended direction.
// ABI remains mvp_v2_* for the production AudioWorklet bridge.

extern "C" double sin(double) __attribute__((import_module("env"), import_name("sin")));
extern "C" double cos(double) __attribute__((import_module("env"), import_name("cos")));
extern "C" double pow(double, double) __attribute__((import_module("env"), import_name("pow")));
extern "C" double exp(double) __attribute__((import_module("env"), import_name("exp")));
extern "C" double log10(double) __attribute__((import_module("env"), import_name("log10")));

extern "C" void* memset(void* dest, int value, unsigned long count) __attribute__((optnone));
extern "C" void* memset(void* dest, int value, unsigned long count) {
  unsigned char* p = static_cast<unsigned char*>(dest);
  for (unsigned long i=0;i<count;++i) p[i]=static_cast<unsigned char>(value);
  return dest;
}
extern "C" void* memcpy(void* dest, const void* src, unsigned long count) __attribute__((optnone));
extern "C" void* memcpy(void* dest, const void* src, unsigned long count) {
  unsigned char* d=static_cast<unsigned char*>(dest); const unsigned char* s=static_cast<const unsigned char*>(src);
  for (unsigned long i=0;i<count;++i) d[i]=s[i];
  return dest;
}

namespace {
constexpr int kFrames=128;
constexpr int kEqBands=31;
constexpr int kLookaheadMax=384;
constexpr int kTpPhaseTaps=16;
constexpr double kPi=3.1415926535897932384626433832795;
inline float absf(float v){return v<0?-v:v;}
inline float maxf(float a,float b){return a>b?a:b;}
inline float minf(float a,float b){return a<b?a:b;}
inline float clampf(float v,float lo,float hi){return v<lo?lo:(v>hi?hi:v);}
inline double clampd(double v,double lo,double hi){return v<lo?lo:(v>hi?hi:v);}
inline float dbToGain(float db){return static_cast<float>(pow(10.0,static_cast<double>(db)/20.0));}
inline float gainToDb(float g){return g>0.0000001f?static_cast<float>(20.0*log10(g)):-120.0f;}

const double kEqFrequencies[kEqBands]={20,25,31.5,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000};
const float kTpFir[4][kTpPhaseTaps]={
 {0.0000000000f,0.0006967276f,-0.0036114518f,0.0106894409f,-0.0243920034f,0.0473988787f,-0.0853522687f,0.1749621972f,0.9271834644f,-0.0558089374f,0.0065336228f,0.0051465217f,-0.0059139618f,0.0036139880f,-0.0014253083f,0.0002466871f},
 {-0.0000259944f,0.0009306425f,-0.0045142792f,0.0140661965f,-0.0349789143f,0.0763806998f,-0.1630375417f,0.4750888740f,0.7567609472f,-0.1677299103f,0.0663150886f,-0.0261387989f,0.0088488163f,-0.0022472932f,0.0003169478f,-0.0000030777f},
 {-0.0000030777f,0.0003169478f,-0.0022472932f,0.0088488163f,-0.0261387989f,0.0663150886f,-0.1677299103f,0.7567609472f,0.4750888740f,-0.1630375417f,0.0763806998f,-0.0349789143f,0.0140661965f,-0.0045142792f,0.0009306425f,-0.0000259944f},
 {0.0002466871f,-0.0014253083f,0.0036139880f,-0.0059139618f,0.0051465217f,0.0065336228f,-0.0558089374f,0.9271834644f,0.1749621972f,-0.0853522687f,0.0473988787f,-0.0243920034f,0.0106894409f,-0.0036114518f,0.0006967276f,0.0000000000f}
};

struct Biquad{
  double b0=1,b1=0,b2=0,a1=0,a2=0,z1=0,z2=0;
  inline float process(float x){double y=b0*x+z1;z1=b1*x-a1*y+z2;z2=b2*x-a2*y;return static_cast<float>(y);}
  void reset(){z1=z2=0;} void identity(){b0=1;b1=b2=a1=a2=0;}
  static double sqrtA(double A){return pow(A,0.5);}
  void peaking(double sr,double freq,double q,double gainDb){if(gainDb>-0.00001&&gainDb<0.00001){identity();return;}double f=clampd(freq,10,sr*.475),A=pow(10.0,gainDb/40.0),w=2*kPi*f/sr,c=cos(w),s=sin(w),alpha=s/(2*q),aa=1+alpha/A;b0=(1+alpha*A)/aa;b1=(-2*c)/aa;b2=(1-alpha*A)/aa;a1=(-2*c)/aa;a2=(1-alpha/A)/aa;}
  void lowshelf(double sr,double freq,double gainDb){if(gainDb>-0.00001&&gainDb<0.00001){identity();return;}double f=clampd(freq,10,sr*.475),A=pow(10.0,gainDb/40.0),w=2*kPi*f/sr,c=cos(w),s=sin(w),beta=2*sqrtA(A)*s,aa=(A+1)+(A-1)*c+beta;b0=A*((A+1)-(A-1)*c+beta)/aa;b1=2*A*((A-1)-(A+1)*c)/aa;b2=A*((A+1)-(A-1)*c-beta)/aa;a1=-2*((A-1)+(A+1)*c)/aa;a2=((A+1)+(A-1)*c-beta)/aa;}
  void highshelf(double sr,double freq,double gainDb){if(gainDb>-0.00001&&gainDb<0.00001){identity();return;}double f=clampd(freq,10,sr*.475),A=pow(10.0,gainDb/40.0),w=2*kPi*f/sr,c=cos(w),s=sin(w),beta=2*sqrtA(A)*s,aa=(A+1)-(A-1)*c+beta;b0=A*((A+1)+(A-1)*c+beta)/aa;b1=-2*A*((A-1)+(A+1)*c)/aa;b2=A*((A+1)+(A-1)*c-beta)/aa;a1=2*((A-1)-(A+1)*c)/aa;a2=((A+1)-(A-1)*c-beta)/aa;}
  void highpass(double sr,double freq,double q=.70710678118){double f=clampd(freq,10,sr*.475),w=2*kPi*f/sr,c=cos(w),s=sin(w),alpha=s/(2*q),aa=1+alpha;b0=((1+c)*.5)/aa;b1=(-(1+c))/aa;b2=((1+c)*.5)/aa;a1=(-2*c)/aa;a2=(1-alpha)/aa;}
};
struct TruePeak4x{float hist[kTpPhaseTaps]={};void reset(){for(int i=0;i<kTpPhaseTaps;++i)hist[i]=0;}inline float update(float x){for(int i=kTpPhaseTaps-1;i>0;--i)hist[i]=hist[i-1];hist[0]=x;float p=absf(x);for(int ph=0;ph<4;++ph){float y=0;for(int k=0;k<kTpPhaseTaps;++k)y+=hist[k]*kTpFir[ph][k];p=maxf(p,absf(y));}return p;}};

alignas(16) float gInputL[kFrames]={},gInputR[kFrames]={},gOutputL[kFrames]={},gOutputR[kFrames]={};
float gSampleRate=48000;
int gMode=0,gProfile=1,gBassEnabled=0,gImpactEnabled=0,gClarityEnabled=0,gSpatialEnabled=0,gSpaceMode=0,gPersonalEnabled=0,gMasterPrepEnabled=0,gEqEnabled=0;
float gIntensityTarget=.72f,gIntensity=.72f,gBassCharacterTarget=.5f,gBassCharacter=.5f,gPersonalBass=0,gPersonalPresence=0,gPersonalBrightness=0;
float gMasterSourceGainDb=0,gMasterHighpassHz=18,gMasterLowMidDb=0,gMasterPresenceDb=0,gMasterHarshnessDb=0,gMasterBalanceDb=0,gMasterWidthScale=1,gEqGainDb[kEqBands]={};
Biquad gEqL[kEqBands],gEqR[kEqBands],gModeBassL,gModeBassR,gModeBodyL,gModeBodyR,gModeMudL,gModeMudR,gModePresenceL,gModePresenceR,gModeAirL,gModeAirR;
Biquad gBassShelfL,gBassShelfR,gBassPunchL,gBassPunchR,gImpactToneL,gImpactToneR,gClarityPresenceL,gClarityPresenceR,gClarityAirL,gClarityAirR;
Biquad gSpatialDecorHp,gPersonalBassL,gPersonalBassR,gPersonalPresenceL,gPersonalPresenceR,gPersonalBrightL,gPersonalBrightR,gMasterHpL,gMasterHpR,gMasterLowMidL,gMasterLowMidR,gMasterPresenceL,gMasterPresenceR,gMasterHarshL,gMasterHarshR;
float gSpatialDelay[4096]={};int gSpatialIndex=0;
float gProgramPeak=0,gProgramAvg=0,gProgramDensity=0;unsigned int gProgramSamples=0;
float gPeakAttack=0,gPeakRelease=0,gAvgAttack=0,gAvgRelease=0,gCompEnv=0,gCompGain=1,gCompAttack=0,gCompRelease=0;
float gImpactFast=0,gImpactSlow=0,gImpactFastAttack=0,gImpactFastRelease=0,gImpactSlowAttack=0,gImpactSlowRelease=0,gSmoothIntensity=0,gSmoothBass=0;
float gLookL[kLookaheadMax]={},gLookR[kLookaheadMax]={},gLookPeak[kLookaheadMax]={};int gLookahead=144,gLookIndex=0,gPureFlushRemaining=0;
float gLimiterGain=1,gLimiterRelease=0;const float gCeiling=.925f;TruePeak4x gLimiterTpL,gLimiterTpR,gMeterTpL,gMeterTpR;
float gMeterTruePeak=0,gMeterLimiterGrDb=0,gMeterImpactBoostDb=0,gMeterBassActivityDb=0,gMeterClarityActivityDb=0,gMeterWidthPercent=100;unsigned int gMeterClipCount=0,gMeterNanCount=0;

void configureEqBand(int i){if(i<0||i>=kEqBands)return;gEqL[i].peaking(gSampleRate,kEqFrequencies[i],4.3184730469,gEqGainDb[i]);gEqR[i].peaking(gSampleRate,kEqFrequencies[i],4.3184730469,gEqGainDb[i]);}
void configureModeTone(){
  float i=clampf(gIntensityTarget,0,1);
  float bass=0,body=0,mud=0,pres=0,air=0;

  if(gMode==1){
    // Adaptive is deliberately obvious, but still balanced.
    bass=.95f+1.55f*i;
    body=.55f+1.05f*i;
    mud=-.35f-.45f*i;
    pres=.90f+1.80f*i;
    air=.55f+1.25f*i;
  }else if(gMode==2){
    // Power has a clearly different tonal signature.
    bass=2.00f+3.20f*i;
    body=1.20f+2.20f*i;
    mud=-.90f-1.30f*i;
    pres=2.00f+3.40f*i;
    air=1.10f+2.50f*i;
  }

  if(gProfile==1){
    bass*=1.05f;
    pres*=1.06f;
    air*=1.10f;
  }else if(gProfile==2){
    bass*=1.10f;
    body*=1.08f;
    pres*=1.03f;
  }else{
    bass*=.96f;
    air*=.94f;
  }

  gModeBassL.lowshelf(gSampleRate,78,bass);
  gModeBassR.lowshelf(gSampleRate,78,bass);

  gModeBodyL.peaking(gSampleRate,155,.75,body);
  gModeBodyR.peaking(gSampleRate,155,.75,body);

  gModeMudL.peaking(gSampleRate,520,.72,mud);
  gModeMudR.peaking(gSampleRate,520,.72,mud);

  gModePresenceL.peaking(gSampleRate,2800,.85,pres);
  gModePresenceR.peaking(gSampleRate,2800,.85,pres);

  gModeAirL.highshelf(gSampleRate,8500,air);
  gModeAirR.highshelf(gSampleRate,8500,air);
}
void configureBass(){
  float c=
    clampf(
      gBassCharacterTarget,
      0,
      1
    );

  float i=
    clampf(
      gIntensityTarget,
      0,
      1
    );

  float profile=
    gProfile==1
      ? 1.12f
      : (
          gProfile==2
            ? 1.08f
            : 1.00f
        );

  float strength=
    .70f+.55f*i;

  float deepDb=
    (2.60f+4.60f*c)*
    strength*
    profile;

  float punchDb=
    (6.00f-3.80f*c)*
    strength*
    profile;

  float deepHz=
    60-15*c;

  float punchHz=
    135-32*c;

  gBassShelfL.lowshelf(
    gSampleRate,
    deepHz,
    deepDb
  );

  gBassShelfR.lowshelf(
    gSampleRate,
    deepHz,
    deepDb
  );

  gBassPunchL.peaking(
    gSampleRate,
    punchHz,
    .82,
    punchDb
  );

  gBassPunchR.peaking(
    gSampleRate,
    punchHz,
    .82,
    punchDb
  );
}
void configureImpact(){
  float i=
    clampf(
      gIntensityTarget,
      0,
      1
    );

  float profile=
    gProfile==1
      ? 1.10f
      : (
          gProfile==2
            ? 1.06f
            : 1.00f
        );

  float db=
    (2.00f+2.80f*i)*
    profile;

  gImpactToneL.peaking(
    gSampleRate,
    1950,
    .92,
    db
  );

  gImpactToneR.peaking(
    gSampleRate,
    1950,
    .92,
    db
  );
}
void configureClarity(){
  float i=
    clampf(
      gIntensityTarget,
      0,
      1
    );

  float p=
    gProfile==1
      ? 1.12f
      : (
          gProfile==2
            ? 1.06f
            : 1.00f
        );

  float presence=
    (2.20f+3.20f*i)*p;

  float air=
    (1.80f+3.30f*i)*p;

  gClarityPresenceL.peaking(
    gSampleRate,
    3400,
    .82,
    presence
  );

  gClarityPresenceR.peaking(
    gSampleRate,
    3400,
    .82,
    presence
  );

  gClarityAirL.highshelf(
    gSampleRate,
    9000,
    air
  );

  gClarityAirR.highshelf(
    gSampleRate,
    9000,
    air
  );
}
void configurePersonal(){
  float pb=
    gPersonalBass*
    (
      gProfile==1
        ? 8.2f
        : (
            gProfile==2
              ? 7.8f
              : 7.2f
          )
    );

  float pp=
    gPersonalPresence*
    (
      gProfile==1
        ? 7.6f
        : 7.2f
    );

  float br=
    gPersonalBrightness*
    (
      gProfile==1
        ? 8.0f
        : (
            gProfile==2
              ? 7.5f
              : 7.0f
          )
    );

  gPersonalBassL.lowshelf(
    gSampleRate,
    95,
    pb
  );

  gPersonalBassR.lowshelf(
    gSampleRate,
    95,
    pb
  );

  gPersonalPresenceL.peaking(
    gSampleRate,
    3100,
    .78,
    pp
  );

  gPersonalPresenceR.peaking(
    gSampleRate,
    3100,
    .78,
    pp
  );

  gPersonalBrightL.highshelf(
    gSampleRate,
    8500,
    br
  );

  gPersonalBrightR.highshelf(
    gSampleRate,
    8500,
    br
  );
}
void configureMaster(){gMasterHpL.highpass(gSampleRate,gMasterHighpassHz);gMasterHpR.highpass(gSampleRate,gMasterHighpassHz);gMasterLowMidL.peaking(gSampleRate,260,.72,gMasterLowMidDb);gMasterLowMidR.peaking(gSampleRate,260,.72,gMasterLowMidDb);gMasterPresenceL.peaking(gSampleRate,3000,.85,gMasterPresenceDb);gMasterPresenceR.peaking(gSampleRate,3000,.85,gMasterPresenceDb);gMasterHarshL.peaking(gSampleRate,6200,1,gMasterHarshnessDb);gMasterHarshR.peaking(gSampleRate,6200,1,gMasterHarshnessDb);}
void resetMeters(){gMeterTruePeak=0;gMeterLimiterGrDb=0;gMeterImpactBoostDb=0;gMeterBassActivityDb=0;gMeterClarityActivityDb=0;gMeterWidthPercent=100;gMeterClipCount=0;gMeterNanCount=0;gMeterTpL.reset();gMeterTpR.reset();}
void resetState(){for(int i=0;i<kEqBands;++i){gEqL[i].reset();gEqR[i].reset();}Biquad* fs[]={&gModeBassL,&gModeBassR,&gModeBodyL,&gModeBodyR,&gModeMudL,&gModeMudR,&gModePresenceL,&gModePresenceR,&gModeAirL,&gModeAirR,&gBassShelfL,&gBassShelfR,&gBassPunchL,&gBassPunchR,&gImpactToneL,&gImpactToneR,&gClarityPresenceL,&gClarityPresenceR,&gClarityAirL,&gClarityAirR,&gSpatialDecorHp,&gPersonalBassL,&gPersonalBassR,&gPersonalPresenceL,&gPersonalPresenceR,&gPersonalBrightL,&gPersonalBrightR,&gMasterHpL,&gMasterHpR,&gMasterLowMidL,&gMasterLowMidR,&gMasterPresenceL,&gMasterPresenceR,&gMasterHarshL,&gMasterHarshR};for(unsigned int i=0;i<sizeof(fs)/sizeof(fs[0]);++i)fs[i]->reset();for(int i=0;i<kLookaheadMax;++i){gLookL[i]=gLookR[i]=gLookPeak[i]=0;}for(int i=0;i<4096;++i)gSpatialDelay[i]=0;gSpatialIndex=0;gLookIndex=0;gPureFlushRemaining=0;gLimiterGain=1;gLimiterTpL.reset();gLimiterTpR.reset();gProgramPeak=gProgramAvg=gProgramDensity=0;gProgramSamples=0;gCompEnv=0;gCompGain=1;gImpactFast=gImpactSlow=0;gIntensity=gIntensityTarget;gBassCharacter=gBassCharacterTarget;resetMeters();}
inline void updateAnalysis(float l,float r){float d=maxf(absf(l),absf(r)),pc=d>gProgramPeak?gPeakAttack:gPeakRelease;gProgramPeak+=(d-gProgramPeak)*pc;float ac=d>gProgramAvg?gAvgAttack:gAvgRelease;gProgramAvg+=(d-gProgramAvg)*ac;gProgramDensity=clampf(gProgramAvg/(gProgramPeak>1e-6f?gProgramPeak:1e-6f),0,1);if(gProgramSamples<0x7fffffffu)++gProgramSamples;}
inline float boundedDeltaScale(
  float l,
  float r,
  float dl,
  float dr,
  float cap
){
  float base=
    maxf(
      absf(l),
      absf(r)
    );

  float delta=
    maxf(
      absf(dl),
      absf(dr)
    );

  if(delta<1e-7f)
    return 1;

  // Never silently turn an enabled control into zero effect.
  // At very hot internal levels retain at least 35% of the
  // requested delta; final peak safety is handled downstream.
  if(base>=cap)
    return .35f;

  return clampf(
    (cap-base)/delta,
    .35f,
    1
  );
}
inline void applyEq(float &l,float &r){if(!gEqEnabled){for(int i=0;i<kEqBands;++i){(void)gEqL[i].process(l);(void)gEqR[i].process(r);}return;}for(int i=0;i<kEqBands;++i){l=gEqL[i].process(l);r=gEqR[i].process(r);}}
inline void applyMaster(float &l,float &r){float pl=gMasterHarshL.process(gMasterPresenceL.process(gMasterLowMidL.process(gMasterHpL.process(l)))),pr=gMasterHarshR.process(gMasterPresenceR.process(gMasterLowMidR.process(gMasterHpR.process(r))));if(!gMasterPrepEnabled)return;float warm=clampf((static_cast<float>(gProgramSamples)-gSampleRate*.05f)/(gSampleRate*.20f),0,1),hot=clampf((gProgramPeak-.68f)/.25f,0,1),gainDb=gMasterSourceGainDb*warm*(1-.85f*hot);pl*=dbToGain(gainDb);pr*=dbToGain(gainDb);if(gMasterBalanceDb>0)pr*=dbToGain(gMasterBalanceDb);else if(gMasterBalanceDb<0)pl*=dbToGain(-gMasterBalanceDb);float mid=.5f*(pl+pr),side=.5f*(pl-pr)*gMasterWidthScale;l=mid+side;r=mid-side;}
inline void applyModeCore(float &l,float &r){
  if(gMode==0)return;

  bool power=gMode==2;
  float i=gIntensity;

  float det=maxf(absf(l),absf(r));

  float ec=
    det>gCompEnv
      ? gCompAttack
      : gCompRelease;

  gCompEnv+=(det-gCompEnv)*ec;

  float threshold=
    power
      ? (.40f-.08f*i)
      : (.62f-.08f*i);

  float ratio=
    power
      ? (3.20f+1.80f*i)
      : (1.45f+.55f*i);

  float target=1;

  if(
    gCompEnv>threshold &&
    gCompEnv>1e-6f
  ){
    float over=
      gCompEnv/threshold;

    target=
      static_cast<float>(
        pow(
          over,
          (1.0f/ratio)-1.0f
        )
      );
  }

  float gc=
    target<gCompGain
      ? gCompAttack
      : gCompRelease;

  gCompGain+=
    (target-gCompGain)*gc;

  float blend=
    power
      ? (.78f+.10f*i)
      : (.38f+.10f*i);

  float comp=
    (1-blend)+
    blend*gCompGain;

  // More density without simply smashing peaks into the limiter.
  float makeupDb=
    power
      ? (4.20f+2.30f*i)
      : (1.20f+1.20f*i);

  float densityGuard=
    clampf(
      (gProgramDensity-.76f)/.18f,
      0,
      1
    );

  if(power){
    makeupDb-=
      densityGuard*
      (.45f+.45f*i);
  }else{
    makeupDb-=
      densityGuard*.18f;
  }

  float gain=
    comp*
    dbToGain(makeupDb);

  l*=gain;
  r*=gain;

  l=
    gModeAirL.process(
      gModePresenceL.process(
        gModeMudL.process(
          gModeBodyL.process(
            gModeBassL.process(l)
          )
        )
      )
    );

  r=
    gModeAirR.process(
      gModePresenceR.process(
        gModeMudR.process(
          gModeBodyR.process(
            gModeBassR.process(r)
          )
        )
      )
    );
}
inline void applyBass(float &l,float &r){
  float bl=
    gBassPunchL.process(
      gBassShelfL.process(l)
    );

  float br=
    gBassPunchR.process(
      gBassShelfR.process(r)
    );

  if(!gBassEnabled)
    return;

  float dl=bl-l;
  float dr=br-r;

  float s=
    boundedDeltaScale(
      l,r,
      dl,dr,
      1.38f
    );

  float src=
    maxf(
      absf(l),
      absf(r)
    );

  l+=dl*s;
  r+=dr*s;

  float out=
    maxf(
      absf(l),
      absf(r)
    );

  if(src>1e-5f){
    gMeterBassActivityDb=
      maxf(
        gMeterBassActivityDb,
        gainToDb(out/src)
      );
  }
}
inline void applyImpact(float &l,float &r){
  float toneL=
    gImpactToneL.process(l);

  float toneR=
    gImpactToneR.process(r);

  float d=
    maxf(
      absf(l),
      absf(r)
    );

  float fc=
    d>gImpactFast
      ? gImpactFastAttack
      : gImpactFastRelease;

  gImpactFast+=
    (d-gImpactFast)*fc;

  float sc=
    d>gImpactSlow
      ? gImpactSlowAttack
      : gImpactSlowRelease;

  gImpactSlow+=
    (d-gImpactSlow)*sc;

  if(!gImpactEnabled)
    return;

  // Keep the stable transient detector that avoided steady-state
  // distortion, but make detected attacks substantially stronger.
  float transient=
    clampf(
      (
        gImpactFast-
        gImpactSlow*1.18f
      )/
      (
        gImpactSlow+.050f
      ),
      0,
      1
    );

  float boostDb=
    transient*
    (2.40f+4.80f*gIntensity);

  float dynamic=
    dbToGain(boostDb);

  float mix=
    .76f+
    .18f*gIntensity;

  float candL=
    (
      (1-mix)*l+
      mix*toneL
    )*
    dynamic;

  float candR=
    (
      (1-mix)*r+
      mix*toneR
    )*
    dynamic;

  float dl=
    candL-l;

  float dr=
    candR-r;

  float s=
    boundedDeltaScale(
      l,r,
      dl,dr,
      1.30f
    );

  l+=dl*s;
  r+=dr*s;

  gMeterImpactBoostDb=
    maxf(
      gMeterImpactBoostDb,
      boostDb*s
    );
}
inline void applyClarity(float &l,float &r){
  float cl=
    gClarityAirL.process(
      gClarityPresenceL.process(l)
    );

  float cr=
    gClarityAirR.process(
      gClarityPresenceR.process(r)
    );

  if(!gClarityEnabled)
    return;

  float dl=cl-l;
  float dr=cr-r;

  float s=
    boundedDeltaScale(
      l,r,
      dl,dr,
      1.34f
    );

  float src=
    maxf(
      absf(l),
      absf(r)
    );

  l+=dl*s;
  r+=dr*s;

  float out=
    maxf(
      absf(l),
      absf(r)
    );

  if(src>1e-5f){
    gMeterClarityActivityDb=
      maxf(
        gMeterClarityActivityDb,
        gainToDb(out/src)
      );
  }
}
inline void applySpatial(float &l,float &r){
  float mid=.5f*(l+r);
  float side=.5f*(l-r);

  float delaySec=.007f;
  float width=1;
  float dm=0;

  if(gProfile==1){
    // HEADPHONES
    if(gSpaceMode==2){
      delaySec=.0185f;
      width=1.78f+.45f*gIntensity;
      dm=.110f+.100f*gIntensity;
    }else if(gSpaceMode==1){
      delaySec=.0115f;
      width=1.55f+.38f*gIntensity;
      dm=.070f+.085f*gIntensity;
    }else{
      delaySec=.0065f;
      width=1.35f+.30f*gIntensity;
      dm=.032f+.050f*gIntensity;
    }
  }else if(gProfile==2){
    // BLUETOOTH SPEAKER
    if(gSpaceMode==2){
      delaySec=.0145f;
      width=1.66f+.36f*gIntensity;
      dm=.080f+.080f*gIntensity;
    }else if(gSpaceMode==1){
      delaySec=.0095f;
      width=1.48f+.32f*gIntensity;
      dm=.050f+.065f*gIntensity;
    }else{
      delaySec=.0055f;
      width=1.30f+.24f*gIntensity;
      dm=.025f+.035f*gIntensity;
    }
  }else{
    // CAR / HI-FI
    if(gSpaceMode==2){
      delaySec=.0170f;
      width=1.58f+.42f*gIntensity;
      dm=.095f+.085f*gIntensity;
    }else if(gSpaceMode==1){
      delaySec=.0120f;
      width=1.40f+.32f*gIntensity;
      dm=.060f+.065f*gIntensity;
    }else{
      delaySec=.0070f;
      width=1.22f+.22f*gIntensity;
      dm=.030f+.035f*gIntensity;
    }
  }

  int ds=
    static_cast<int>(
      gSampleRate*
      delaySec
    );

  if(ds<1)ds=1;
  if(ds>4095)ds=4095;

  int ri=
    gSpatialIndex-ds;

  if(ri<0)
    ri+=4096;

  float delayed=
    gSpatialDelay[ri];

  gSpatialDelay[
    gSpatialIndex
  ]=mid;

  gSpatialIndex=
    (gSpatialIndex+1)&4095;

  float decor=
    gSpatialDecorHp.process(
      delayed
    );

  if(!gSpatialEnabled){
    gMeterWidthPercent=100;
    return;
  }

  float sside=
    side*width+
    decor*dm;

  float candL=
    mid+sside;

  float candR=
    mid-sside;

  float dl=
    candL-l;

  float dr=
    candR-r;

  float scale=
    boundedDeltaScale(
      l,r,
      dl,dr,
      1.30f
    );

  l+=dl*scale;
  r+=dr*scale;

  gMeterWidthPercent=
    100+
    (width-1)*
    100*
    scale;
}
inline void applyPersonal(float &l,float &r){
  float pl=
    gPersonalBrightL.process(
      gPersonalPresenceL.process(
        gPersonalBassL.process(l)
      )
    );

  float pr=
    gPersonalBrightR.process(
      gPersonalPresenceR.process(
        gPersonalBassR.process(r)
      )
    );

  if(!gPersonalEnabled)
    return;

  float dl=pl-l;
  float dr=pr-r;

  bool positive=
    gPersonalBass>0 ||
    gPersonalPresence>0 ||
    gPersonalBrightness>0;

  float s=
    positive
      ? boundedDeltaScale(
          l,r,
          dl,dr,
          1.36f
        )
      : 1;

  l+=dl*s;
  r+=dr*s;
}

inline void applyEmergencyPeakGuard(
  float &l,
  float &r
){
  float peak=
    maxf(
      absf(l),
      absf(r)
    );

  // Normal program material should never touch this.
  // 2.20 leaves substantial room for the final true-peak
  // lookahead limiter while allowing the actual effects through.
  if(peak>2.20f){
    float g=
      2.20f/peak;

    l*=g;
    r*=g;
  }
}

inline void limiter(float inL,float inR,float &outL,float &outR,bool enabled){float dL=gLookL[gLookIndex],dR=gLookR[gLookIndex],dP=gLookPeak[gLookIndex],p=maxf(absf(inL),absf(inR));p=maxf(p,gLimiterTpL.update(inL));p=maxf(p,gLimiterTpR.update(inR));gLookL[gLookIndex]=inL;gLookR[gLookIndex]=inR;gLookPeak[gLookIndex]=p;gLookIndex=(gLookIndex+1)%gLookahead;if(!enabled){if(gPureFlushRemaining>0){float safe=1;if(dP>gCeiling&&dP>1e-6f)safe=gCeiling/dP;outL=dL*safe;outR=dR*safe;--gPureFlushRemaining;}else{outL=dL;outR=dR;}gLimiterGain=1;return;}float future=0;for(int i=0;i<gLookahead;++i)future=maxf(future,gLookPeak[i]);float req=future>gCeiling?gCeiling/future:1;if(req<gLimiterGain)gLimiterGain=req;else gLimiterGain+=(1-gLimiterGain)*gLimiterRelease;gLimiterGain=clampf(gLimiterGain,.12f,1);outL=dL*gLimiterGain;outR=dR*gLimiterGain;gMeterLimiterGrDb=maxf(gMeterLimiterGrDb,-gainToDb(gLimiterGain));}
inline void meter(float l,float r){float tp=maxf(gMeterTpL.update(l),gMeterTpR.update(r));gMeterTruePeak=maxf(gMeterTruePeak,tp);if(absf(l)>1||absf(r)>1)++gMeterClipCount;if(l!=l||r!=r||absf(l)>1000000||absf(r)>1000000)++gMeterNanCount;}
}

extern "C" {
unsigned int mvp_v2_build_id(){return 5700u;}
int mvp_v2_get_mode(){return gMode;}
int mvp_v2_get_output_profile(){return gProfile;}
float mvp_v2_get_intensity(){return gIntensityTarget;}
int mvp_v2_get_bass_enabled(){return gBassEnabled;}
float mvp_v2_get_bass_character(){return gBassCharacterTarget;}
int mvp_v2_get_impact_enabled(){return gImpactEnabled;}
int mvp_v2_get_clarity_enabled(){return gClarityEnabled;}
int mvp_v2_get_spatial_enabled(){return gSpatialEnabled;}
int mvp_v2_get_space_mode(){return gSpaceMode;}
int mvp_v2_get_personal_enabled(){return gPersonalEnabled;}
float mvp_v2_get_personal_bass(){return gPersonalBass;}
float mvp_v2_get_personal_presence(){return gPersonalPresence;}
float mvp_v2_get_personal_brightness(){return gPersonalBrightness;}
int mvp_v2_get_eq_enabled(){return gEqEnabled;}
float mvp_v2_get_eq_band(int i){return i>=0&&i<kEqBands?gEqGainDb[i]:0.0f;}
unsigned int mvp_v2_input_l(){return reinterpret_cast<unsigned int>(gInputL);}unsigned int mvp_v2_input_r(){return reinterpret_cast<unsigned int>(gInputR);}unsigned int mvp_v2_output_l(){return reinterpret_cast<unsigned int>(gOutputL);}unsigned int mvp_v2_output_r(){return reinterpret_cast<unsigned int>(gOutputR);}int mvp_v2_max_frames(){return kFrames;}
int mvp_v2_init(float sr){if(sr<32000||sr>96000)return 0;gSampleRate=sr;gLookahead=static_cast<int>(sr*.0025f+.5f);if(gLookahead<64)gLookahead=64;if(gLookahead>kLookaheadMax)gLookahead=kLookaheadMax;gPeakAttack=1-static_cast<float>(exp(-1.0/(sr*.001)));gPeakRelease=1-static_cast<float>(exp(-1.0/(sr*.180)));gAvgAttack=1-static_cast<float>(exp(-1.0/(sr*.025)));gAvgRelease=1-static_cast<float>(exp(-1.0/(sr*.300)));gCompAttack=1-static_cast<float>(exp(-1.0/(sr*.004)));gCompRelease=1-static_cast<float>(exp(-1.0/(sr*.110)));gImpactFastAttack=1-static_cast<float>(exp(-1.0/(sr*.0012)));gImpactFastRelease=1-static_cast<float>(exp(-1.0/(sr*.014)));gImpactSlowAttack=1-static_cast<float>(exp(-1.0/(sr*.030)));gImpactSlowRelease=1-static_cast<float>(exp(-1.0/(sr*.160)));gSmoothIntensity=1-static_cast<float>(exp(-1.0/(sr*.018)));gSmoothBass=1-static_cast<float>(exp(-1.0/(sr*.020)));gLimiterRelease=1-static_cast<float>(exp(-1.0/(sr*.070)));for(int i=0;i<kEqBands;++i)configureEqBand(i);gSpatialDecorHp.highpass(sr,260);configureModeTone();configureBass();configureImpact();configureClarity();configurePersonal();configureMaster();resetState();return 1;}
void mvp_v2_reset(){resetState();}void mvp_v2_reset_meters(){resetMeters();}
void mvp_v2_set_mode(int m){int next=m<0?0:(m>2?2:m);if(next==gMode)return;int prev=gMode;gMode=next;if(next==0&&prev!=0)gPureFlushRemaining=gLookahead;else if(next!=0)gPureFlushRemaining=0;configureModeTone();}
void mvp_v2_set_output_profile(int p){gProfile=p<0?0:(p>2?2:p);configureModeTone();configureBass();configureImpact();configureClarity();configurePersonal();}
void mvp_v2_set_intensity(float x){gIntensityTarget=clampf(x,0,1);configureModeTone();configureBass();configureImpact();configureClarity();}
void mvp_v2_set_bass_enabled(int e){gBassEnabled=e?1:0;}void mvp_v2_set_bass_character(float x){gBassCharacterTarget=clampf(x,0,1);configureBass();}
void mvp_v2_set_impact_enabled(int e){gImpactEnabled=e?1:0;}void mvp_v2_set_clarity_enabled(int e){gClarityEnabled=e?1:0;}void mvp_v2_set_spatial_enabled(int e){gSpatialEnabled=e?1:0;}void mvp_v2_set_space_mode(int m){gSpaceMode=m<0?0:(m>2?2:m);}
void mvp_v2_set_personal_enabled(int e){gPersonalEnabled=e?1:0;}void mvp_v2_set_personal_bass(float x){gPersonalBass=clampf(x,-1,1);configurePersonal();}void mvp_v2_set_personal_presence(float x){gPersonalPresence=clampf(x,-1,1);configurePersonal();}void mvp_v2_set_personal_brightness(float x){gPersonalBrightness=clampf(x,-1,1);configurePersonal();}
void mvp_v2_set_master_prep(int e,float sourceGainDb,float highpassHz,float lowMidDb,float presenceDb,float harshnessDb,float balanceDb,float widthScale){gMasterPrepEnabled=e?1:0;gMasterSourceGainDb=clampf(sourceGainDb,0,3);gMasterHighpassHz=clampf(highpassHz,18,40);gMasterLowMidDb=clampf(lowMidDb,-3,2);gMasterPresenceDb=clampf(presenceDb,-2,2);gMasterHarshnessDb=clampf(harshnessDb,-3,1);gMasterBalanceDb=clampf(balanceDb,-1.5f,1.5f);gMasterWidthScale=clampf(widthScale,.75f,1.10f);configureMaster();}
void mvp_v2_set_eq_enabled(int e){gEqEnabled=e?1:0;}void mvp_v2_set_eq_band(int i,float db){if(i<0||i>=kEqBands)return;gEqGainDb[i]=clampf(db,-12,12);configureEqBand(i);}
void mvp_v2_set_bypass(int e){if(e)mvp_v2_set_mode(0);else if(gMode==0)mvp_v2_set_mode(1);}void mvp_v2_set_loudness_mode(int m){mvp_v2_set_mode(m>=2?2:(m>=0?1:0));}
void mvp_v2_set_bass(float a){mvp_v2_set_bass_enabled(a>.0001f);mvp_v2_set_bass_character(a);}void mvp_v2_set_clarity(float a){mvp_v2_set_clarity_enabled(a>.0001f);}void mvp_v2_set_punch(float a){mvp_v2_set_impact_enabled(a>.0001f);}void mvp_v2_set_wide(float a){mvp_v2_set_spatial_enabled(a>.0001f);}
int mvp_v2_process(int frames){
  if(frames<1||frames>kFrames)return 0;

  for(int i=0;i<frames;++i){
    float l=gInputL[i];
    float r=gInputR[i];

    updateAnalysis(l,r);

    gIntensity+=
      (gIntensityTarget-gIntensity)*gSmoothIntensity;

    gBassCharacter+=
      (gBassCharacterTarget-gBassCharacter)*gSmoothBass;

    /*
     * The visible 31-band EQ works in every musical mode.
     */
    applyEq(l,r);

    /*
     * Master Prep belongs to Adaptive / Power.
     *
     * In Pure we keep its filter state warm on disposable samples,
     * but we do not alter the reference signal.
     */
    if(gMode!=0){
      applyMaster(l,r);
    }else{
      float ml=l;
      float mr=r;
      applyMaster(ml,mr);
    }

    /*
     * Pure = no automatic mode coloration.
     * Adaptive and Power process the live samples.
     */
    applyModeCore(l,r);

    /*
     * These are explicit controls.
     * If the user turns one on, it must affect the actual output
     * regardless of whether the baseline mode is Pure,
     * Adaptive, or Power.
     */
    applyBass(l,r);
    applyImpact(l,r);
    applyClarity(l,r);
    applySpatial(l,r);
    applyPersonal(l,r);

    /*
     * Pure with every control OFF remains reference-clean.
     * Any explicitly selected processing receives limiter safety.
     */
    const bool processed=
      gMode!=0||
      gEqEnabled||
      gBassEnabled||
      gImpactEnabled||
      gClarityEnabled||
      gSpatialEnabled||
      gPersonalEnabled;

    float ol=0;
    float orr=0;

    if(processed)applyEmergencyPeakGuard(l,r);limiter(l,r,ol,orr,processed);

    gOutputL[i]=ol;
    gOutputR[i]=orr;

    meter(ol,orr);
  }

  return 1;
}
float mvp_v2_meter_true_peak_dbtp(){return gainToDb(gMeterTruePeak);}float mvp_v2_meter_limiter_gr_db(){return gMeterLimiterGrDb;}unsigned int mvp_v2_meter_clip_count(){return gMeterClipCount;}unsigned int mvp_v2_meter_nan_count(){return gMeterNanCount;}float mvp_v2_meter_multiband_gr_db(){return gMeterLimiterGrDb;}float mvp_v2_meter_impact_boost_db(){return gMeterImpactBoostDb;}float mvp_v2_meter_bass_activity_db(){return gMeterBassActivityDb;}float mvp_v2_meter_clarity_activity_db(){return gMeterClarityActivityDb;}float mvp_v2_meter_spatial_width_percent(){return gMeterWidthPercent;}
}
