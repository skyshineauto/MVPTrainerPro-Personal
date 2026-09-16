// MVP Trainer Pro Broadcast Engine V5.8 PRO STUDIO SEPARATION
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
Biquad gSpatialDecorHp,gSpatialSideHp,gPersonalBassL,gPersonalBassR,gPersonalPresenceL,gPersonalPresenceR,gPersonalBrightL,gPersonalBrightR,gMasterHpL,gMasterHpR,gMasterLowMidL,gMasterLowMidR,gMasterPresenceL,gMasterPresenceR,gMasterHarshL,gMasterHarshR;
float gSpatialDelay[4096]={};int gSpatialIndex=0;
float gProgramPeak=0,gProgramAvg=0,gProgramDensity=0;unsigned int gProgramSamples=0;
float gPeakAttack=0,gPeakRelease=0,gAvgAttack=0,gAvgRelease=0,gCompEnv=0,gCompGain=1,gCompAttack=0,gCompRelease=0;
float gImpactFast=0,gImpactSlow=0,gImpactFastAttack=0,gImpactFastRelease=0,gImpactSlowAttack=0,gImpactSlowRelease=0,gSmoothIntensity=0,gSmoothBass=0;
float gLookL[kLookaheadMax]={},gLookR[kLookaheadMax]={},gLookPeak[kLookaheadMax]={};int gLookahead=144,gLookIndex=0,gPureFlushRemaining=0;
float gLimiterGain=1,gLimiterRelease=0;const float gCeiling=.912f;TruePeak4x gLimiterTpL,gLimiterTpR,gMeterTpL,gMeterTpR;
float gMeterTruePeak=0,gMeterLimiterGrDb=0,gMeterImpactBoostDb=0,gMeterBassActivityDb=0,gMeterClarityActivityDb=0,gMeterWidthPercent=100;unsigned int gMeterClipCount=0,gMeterNanCount=0;

void configureEqBand(int i){if(i<0||i>=kEqBands)return;gEqL[i].peaking(gSampleRate,kEqFrequencies[i],4.3184730469,gEqGainDb[i]);gEqR[i].peaking(gSampleRate,kEqFrequencies[i],4.3184730469,gEqGainDb[i]);}
void configureModeTone(){
  const float i=clampf(gIntensityTarget,0,1);

  float bass=0;
  float body=0;
  float mud=0;
  float pres=0;
  float air=0;

  if(gMode==1){
    // ADAPTIVE:
    // polished mastering, larger than Pure but still clean.
    bass=1.10f+1.60f*i;
    body=.55f+1.00f*i;
    mud=-.45f-.50f*i;
    pres=1.00f+1.80f*i;
    air=.70f+1.50f*i;
  }else if(gMode==2){
    // POWER:
    // intentionally a different master, not simply "more Adaptive".
    bass=2.40f+3.40f*i;
    body=1.25f+2.15f*i;
    mud=-1.00f-1.35f*i;
    pres=2.20f+3.40f*i;
    air=1.40f+2.60f*i;
  }

  // Explicit controls own their frequency regions.
  // Back the mode voicing away when the user deliberately selects another
  // processor so multiple boosts do not fight each other.
  if(gBassEnabled){
    bass*=.58f;
    body*=.78f;
  }

  if(gClarityEnabled){
    pres*=.60f;
    air*=.64f;
  }

  if(gPersonalEnabled){
    const float pb=maxf(0,gPersonalBass);
    const float pp=maxf(0,gPersonalPresence);
    const float br=maxf(0,gPersonalBrightness);

    bass*=1-.38f*pb;
    pres*=1-.42f*pp;
    air*=1-.42f*br;
  }

  if(gProfile==1){
    // Headphones: full-range, open and detailed.
    bass*=1.04f;
    pres*=1.08f;
    air*=1.12f;
  }else if(gProfile==2){
    // Bluetooth: retain authority without excessive upper-bass buildup.
    bass*=1.08f;
    body*=1.04f;
    pres*=1.04f;
  }else{
    // Car / Hi-Fi.
    bass*=.98f;
    air*=.97f;
  }

  gModeBassL.lowshelf(gSampleRate,76,bass);
  gModeBassR.lowshelf(gSampleRate,76,bass);

  gModeBodyL.peaking(gSampleRate,150,.74,body);
  gModeBodyR.peaking(gSampleRate,150,.74,body);

  gModeMudL.peaking(gSampleRate,500,.72,mud);
  gModeMudR.peaking(gSampleRate,500,.72,mud);

  gModePresenceL.peaking(gSampleRate,2850,.84,pres);
  gModePresenceR.peaking(gSampleRate,2850,.84,pres);

  gModeAirL.highshelf(gSampleRate,8500,air);
  gModeAirR.highshelf(gSampleRate,8500,air);
}
void configureBass(){
  const float c=clampf(gBassCharacterTarget,0,1);
  const float i=clampf(gIntensityTarget,0,1);

  const float profile=
    gProfile==1
      ? 1.10f
      : (
          gProfile==2
            ? 1.06f
            : 1.00f
        );

  const float strength=.82f+.36f*i;

  // Tight -> more punch around 125 Hz.
  // Deep  -> more true sub / low-bass authority.
  float deepDb=(3.00f+4.90f*c)*strength*profile;
  float punchDb=(6.40f-3.70f*c)*strength*profile;

  deepDb=clampf(deepDb,0,9.5f);
  punchDb=clampf(punchDb,0,7.5f);

  const float deepHz=60-16*c;
  const float punchHz=136-34*c;

  gBassShelfL.lowshelf(gSampleRate,deepHz,deepDb);
  gBassShelfR.lowshelf(gSampleRate,deepHz,deepDb);

  gBassPunchL.peaking(gSampleRate,punchHz,.80,punchDb);
  gBassPunchR.peaking(gSampleRate,punchHz,.80,punchDb);
}
void configureImpact(){
  const float i=clampf(gIntensityTarget,0,1);

  const float profile=
    gProfile==1
      ? 1.08f
      : (
          gProfile==2
            ? 1.05f
            : 1.00f
        );

  const float db=(2.40f+3.60f*i)*profile;

  gImpactToneL.peaking(gSampleRate,2050,.92,db);
  gImpactToneR.peaking(gSampleRate,2050,.92,db);
}
void configureClarity(){
  const float i=clampf(gIntensityTarget,0,1);

  const float profile=
    gProfile==1
      ? 1.10f
      : (
          gProfile==2
            ? 1.05f
            : 1.00f
        );

  const float presence=(2.60f+3.20f*i)*profile;
  const float air=(2.20f+3.30f*i)*profile;

  gClarityPresenceL.peaking(gSampleRate,3350,.84,presence);
  gClarityPresenceR.peaking(gSampleRate,3350,.84,presence);

  gClarityAirL.highshelf(gSampleRate,9200,air);
  gClarityAirR.highshelf(gSampleRate,9200,air);
}
void configurePersonal(){
  const float bassRange=
    gProfile==1
      ? 9.0f
      : (
          gProfile==2
            ? 8.4f
            : 8.0f
        );

  const float presenceRange=
    gProfile==1
      ? 8.2f
      : (
          gProfile==2
            ? 7.8f
            : 7.6f
        );

  const float brightRange=
    gProfile==1
      ? 8.8f
      : (
          gProfile==2
            ? 8.0f
            : 7.8f
        );

  const float pb=gPersonalBass*bassRange;
  const float pp=gPersonalPresence*presenceRange;
  const float br=gPersonalBrightness*brightRange;

  gPersonalBassL.lowshelf(gSampleRate,92,pb);
  gPersonalBassR.lowshelf(gSampleRate,92,pb);

  gPersonalPresenceL.peaking(gSampleRate,3050,.78,pp);
  gPersonalPresenceR.peaking(gSampleRate,3050,.78,pp);

  gPersonalBrightL.highshelf(gSampleRate,8600,br);
  gPersonalBrightR.highshelf(gSampleRate,8600,br);
}
void configureMaster(){gMasterHpL.highpass(gSampleRate,gMasterHighpassHz);gMasterHpR.highpass(gSampleRate,gMasterHighpassHz);gMasterLowMidL.peaking(gSampleRate,260,.72,gMasterLowMidDb);gMasterLowMidR.peaking(gSampleRate,260,.72,gMasterLowMidDb);gMasterPresenceL.peaking(gSampleRate,3000,.85,gMasterPresenceDb);gMasterPresenceR.peaking(gSampleRate,3000,.85,gMasterPresenceDb);gMasterHarshL.peaking(gSampleRate,6200,1,gMasterHarshnessDb);gMasterHarshR.peaking(gSampleRate,6200,1,gMasterHarshnessDb);}
void resetMeters(){gMeterTruePeak=0;gMeterLimiterGrDb=0;gMeterImpactBoostDb=0;gMeterBassActivityDb=0;gMeterClarityActivityDb=0;gMeterWidthPercent=100;gMeterClipCount=0;gMeterNanCount=0;gMeterTpL.reset();gMeterTpR.reset();}
void resetState(){for(int i=0;i<kEqBands;++i){gEqL[i].reset();gEqR[i].reset();}Biquad* fs[]={&gModeBassL,&gModeBassR,&gModeBodyL,&gModeBodyR,&gModeMudL,&gModeMudR,&gModePresenceL,&gModePresenceR,&gModeAirL,&gModeAirR,&gBassShelfL,&gBassShelfR,&gBassPunchL,&gBassPunchR,&gImpactToneL,&gImpactToneR,&gClarityPresenceL,&gClarityPresenceR,&gClarityAirL,&gClarityAirR,&gSpatialDecorHp,&gSpatialSideHp,&gPersonalBassL,&gPersonalBassR,&gPersonalPresenceL,&gPersonalPresenceR,&gPersonalBrightL,&gPersonalBrightR,&gMasterHpL,&gMasterHpR,&gMasterLowMidL,&gMasterLowMidR,&gMasterPresenceL,&gMasterPresenceR,&gMasterHarshL,&gMasterHarshR};for(unsigned int i=0;i<sizeof(fs)/sizeof(fs[0]);++i)fs[i]->reset();for(int i=0;i<kLookaheadMax;++i){gLookL[i]=gLookR[i]=gLookPeak[i]=0;}for(int i=0;i<4096;++i)gSpatialDelay[i]=0;gSpatialIndex=0;gLookIndex=0;gPureFlushRemaining=0;gLimiterGain=1;gLimiterTpL.reset();gLimiterTpR.reset();gProgramPeak=gProgramAvg=gProgramDensity=0;gProgramSamples=0;gCompEnv=0;gCompGain=1;gImpactFast=gImpactSlow=0;gIntensity=gIntensityTarget;gBassCharacter=gBassCharacterTarget;resetMeters();}
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

  const bool power=gMode==2;
  const float i=gIntensity;

  const float det=maxf(absf(l),absf(r));

  const float ec=
    det>gCompEnv
      ? gCompAttack
      : gCompRelease;

  gCompEnv+=(det-gCompEnv)*ec;

  const float threshold=
    power
      ? (.38f-.07f*i)
      : (.64f-.08f*i);

  const float ratio=
    power
      ? (3.40f+2.00f*i)
      : (1.55f+.75f*i);

  float target=1;

  if(
    gCompEnv>threshold &&
    gCompEnv>1e-6f
  ){
    const float over=gCompEnv/threshold;

    target=
      static_cast<float>(
        pow(
          over,
          (1.0f/ratio)-1.0f
        )
      );
  }

  const float gc=
    target<gCompGain
      ? gCompAttack
      : gCompRelease;

  gCompGain+=(target-gCompGain)*gc;

  const float blend=
    power
      ? (.80f+.10f*i)
      : (.38f+.12f*i);

  const float comp=
    (1-blend)+
    blend*gCompGain;

  // Perceived loudness ladder:
  // Pure     = reference
  // Adaptive = approximately +1.5..3 dB mastering density
  // Power    = maximum clean density / roughly +5..7 dB drive where source permits
  float makeupDb=
    power
      ? (5.00f+2.00f*i)
      : (1.35f+1.55f*i);

  const float densityGuard=
    clampf(
      (gProgramDensity-.78f)/.16f,
      0,
      1
    );

  if(power){
    makeupDb-=densityGuard*(.45f+.35f*i);
  }else{
    makeupDb-=densityGuard*.16f;
  }

  const float gain=
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
inline void applyMixReserve(float &l,float &r){
  float reserveDb=0;

  if(gBassEnabled)reserveDb+=.55f;
  if(gImpactEnabled)reserveDb+=.20f;
  if(gClarityEnabled)reserveDb+=.42f;

  if(gPersonalEnabled){
    const float personalPositive=
      maxf(
        0,
        maxf(
          gPersonalBass,
          maxf(
            gPersonalPresence,
            gPersonalBrightness
          )
        )
      );

    reserveDb+=.30f+1.30f*personalPositive;
  }

  if(gEqEnabled){
    float eqBoost=0;

    for(int i=0;i<kEqBands;++i){
      eqBoost=maxf(eqBoost,gEqGainDb[i]);
    }

    reserveDb+=clampf(eqBoost*.12f,0,1.35f);
  }

  if(
    gMode==2 &&
    (
      gBassEnabled ||
      gClarityEnabled ||
      gPersonalEnabled
    )
  ){
    reserveDb+=.35f;
  }

  reserveDb=clampf(reserveDb,0,3.20f);

  if(reserveDb>0){
    const float g=dbToGain(-reserveDb);
    l*=g;
    r*=g;
  }
}
inline void applyBass(float &l,float &r){
  const float bl=
    gBassPunchL.process(
      gBassShelfL.process(l)
    );

  const float br=
    gBassPunchR.process(
      gBassShelfR.process(r)
    );

  if(!gBassEnabled)return;

  const float dl=bl-l;
  const float dr=br-r;

  // Explicit Bass must remain unmistakable even on hot mastered material.
  const float s=
    maxf(
      .70f,
      boundedDeltaScale(
        l,r,
        dl,dr,
        1.55f
      )
    );

  const float src=maxf(absf(l),absf(r));

  l+=dl*s;
  r+=dr*s;

  const float out=maxf(absf(l),absf(r));

  if(src>1e-5f){
    gMeterBassActivityDb=
      maxf(
        gMeterBassActivityDb,
        gainToDb(out/src)
      );
  }
}
inline void applyImpact(float &l,float &r){
  const float toneL=gImpactToneL.process(l);
  const float toneR=gImpactToneR.process(r);

  const float d=maxf(absf(l),absf(r));

  const float fc=
    d>gImpactFast
      ? gImpactFastAttack
      : gImpactFastRelease;

  gImpactFast+=(d-gImpactFast)*fc;

  const float sc=
    d>gImpactSlow
      ? gImpactSlowAttack
      : gImpactSlowRelease;

  gImpactSlow+=(d-gImpactSlow)*sc;

  if(!gImpactEnabled)return;

  // Transient-only attack enhancement.
  // Sustained program material is deliberately left much closer to unity.
  const float transient=
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

  const float boostDb=
    transient*
    (3.00f+5.20f*gIntensity);

  const float dynamic=dbToGain(boostDb);

  const float mix=.78f+.18f*gIntensity;

  const float candL=
    (
      (1-mix)*l+
      mix*toneL
    )*
    dynamic;

  const float candR=
    (
      (1-mix)*r+
      mix*toneR
    )*
    dynamic;

  const float dl=candL-l;
  const float dr=candR-r;

  const float s=
    maxf(
      .65f,
      boundedDeltaScale(
        l,r,
        dl,dr,
        1.48f
      )
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
  const float cl=
    gClarityAirL.process(
      gClarityPresenceL.process(l)
    );

  const float cr=
    gClarityAirR.process(
      gClarityPresenceR.process(r)
    );

  if(!gClarityEnabled)return;

  const float dl=cl-l;
  const float dr=cr-r;

  const float s=
    maxf(
      .72f,
      boundedDeltaScale(
        l,r,
        dl,dr,
        1.48f
      )
    );

  const float src=maxf(absf(l),absf(r));

  l+=dl*s;
  r+=dr*s;

  const float out=maxf(absf(l),absf(r));

  if(src>1e-5f){
    gMeterClarityActivityDb=
      maxf(
        gMeterClarityActivityDb,
        gainToDb(out/src)
      );
  }
}
inline void applySpatial(float &l,float &r){
  const float mid=.5f*(l+r);
  const float side=.5f*(l-r);

  if(!gSpatialEnabled){
    // Keep filter/delay state alive without modifying the signal.
    (void)gSpatialSideHp.process(side);
    gSpatialDelay[gSpatialIndex]=mid;
    gSpatialIndex=(gSpatialIndex+1)&4095;
    gMeterWidthPercent=100;
    return;
  }

  float delayA=.0040f;
  float delayB=.0090f;
  float width=1.45f;
  float decorMix=.030f;
  float decorSecond=.48f;
  float lowWidth=1.00f;

  if(gProfile==1){
    // HEADPHONES
    //
    // 0 WIDE    : front-stage width, minimal synthetic depth
    // 1 SPATIAL : larger image + clear externalization cue
    // 2 DEEP    : greater front/back depth
    // 3 3D      : maximum premium externalized presentation
    if(gSpaceMode==3){
      delayA=.0065f;
      delayB=.0170f;
      width=2.20f+.65f*gIntensity;
      decorMix=.170f+.150f*gIntensity;
      decorSecond=.62f;
      lowWidth=1.02f;
    }else if(gSpaceMode==2){
      delayA=.0105f;
      delayB=.0210f;
      width=2.00f+.55f*gIntensity;
      decorMix=.125f+.125f*gIntensity;
      decorSecond=.58f;
      lowWidth=1.015f;
    }else if(gSpaceMode==1){
      delayA=.0068f;
      delayB=.0130f;
      width=1.82f+.46f*gIntensity;
      decorMix=.075f+.105f*gIntensity;
      decorSecond=.54f;
      lowWidth=1.01f;
    }else{
      delayA=.0038f;
      delayB=.0082f;
      width=1.65f+.35f*gIntensity;
      decorMix=.020f+.040f*gIntensity;
      decorSecond=.45f;
      lowWidth=1.00f;
    }
  }else if(gProfile==2){
    // BLUETOOTH SPEAKER:
    // Stage must remain extremely obvious without destroying the center.
    if(gSpaceMode==2){
      delayA=.0090f;
      delayB=.0170f;
      width=1.95f+.45f*gIntensity;
      decorMix=.095f+.090f*gIntensity;
      decorSecond=.56f;
    }else if(gSpaceMode==1){
      delayA=.0065f;
      delayB=.0120f;
      width=1.75f+.40f*gIntensity;
      decorMix=.060f+.070f*gIntensity;
      decorSecond=.52f;
    }else{
      delayA=.0045f;
      delayB=.0090f;
      width=1.55f+.35f*gIntensity;
      decorMix=.035f+.045f*gIntensity;
      decorSecond=.48f;
    }
  }else{
    // CAR / HI-FI:
    // Large stage while keeping center vocals/kick/bass stable.
    if(gSpaceMode==2){
      delayA=.0085f;
      delayB=.0165f;
      width=1.80f+.42f*gIntensity;
      decorMix=.085f+.080f*gIntensity;
      decorSecond=.56f;
    }else if(gSpaceMode==1){
      delayA=.0060f;
      delayB=.0115f;
      width=1.62f+.36f*gIntensity;
      decorMix=.055f+.060f*gIntensity;
      decorSecond=.52f;
    }else{
      delayA=.0040f;
      delayB=.0080f;
      width=1.42f+.28f*gIntensity;
      decorMix=.025f+.040f*gIntensity;
      decorSecond=.46f;
    }
  }

  int dsA=
    static_cast<int>(
      gSampleRate*delayA
    );

  int dsB=
    static_cast<int>(
      gSampleRate*delayB
    );

  if(dsA<1)dsA=1;
  if(dsA>4095)dsA=4095;

  if(dsB<1)dsB=1;
  if(dsB>4095)dsB=4095;

  int riA=gSpatialIndex-dsA;
  int riB=gSpatialIndex-dsB;

  if(riA<0)riA+=4096;
  if(riB<0)riB+=4096;

  const float delayedA=gSpatialDelay[riA];
  const float delayedB=gSpatialDelay[riB];

  gSpatialDelay[gSpatialIndex]=mid;
  gSpatialIndex=(gSpatialIndex+1)&4095;

  // Frequency-dependent widening:
  // bass remains nearly centered while localization/ambience bands spread wide.
  const float sideHi=gSpatialSideHp.process(side);
  const float sideLo=side-sideHi;

  // Two non-identical early cues create depth without replacing the direct feed.
  const float decor=
    gSpatialDecorHp.process(
      delayedA-
      delayedB*decorSecond
    );

  const float sside=
    sideLo*lowWidth+
    sideHi*width+
    decor*decorMix;

  const float candL=mid+sside;
  const float candR=mid-sside;

  const float dl=candL-l;
  const float dr=candR-r;

  float scale=
    boundedDeltaScale(
      l,r,
      dl,dr,
      1.55f
    );

  // Spatial controls are deliberately perceptual, not analyzer-only.
  if(gProfile==1){
    scale=maxf(scale,.72f);
  }else if(gProfile==2){
    scale=maxf(scale,.66f);
  }else{
    scale=maxf(scale,.60f);
  }

  l+=dl*scale;
  r+=dr*scale;

  gMeterWidthPercent=
    100+
    (width-1)*
    100*
    scale;
}
inline void applyPersonal(float &l,float &r){
  const float pl=
    gPersonalBrightL.process(
      gPersonalPresenceL.process(
        gPersonalBassL.process(l)
      )
    );

  const float pr=
    gPersonalBrightR.process(
      gPersonalPresenceR.process(
        gPersonalBassR.process(r)
      )
    );

  if(!gPersonalEnabled)return;

  // Personal Sound is the user's final tonal authority.
  // Do not silently shrink it to 35% on hot masters.
  l=pl;
  r=pr;
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
unsigned int mvp_v2_build_id(){return 5800u;}
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
int mvp_v2_init(float sr){if(sr<32000||sr>96000)return 0;gSampleRate=sr;gLookahead=static_cast<int>(sr*.0025f+.5f);if(gLookahead<64)gLookahead=64;if(gLookahead>kLookaheadMax)gLookahead=kLookaheadMax;gPeakAttack=1-static_cast<float>(exp(-1.0/(sr*.001)));gPeakRelease=1-static_cast<float>(exp(-1.0/(sr*.180)));gAvgAttack=1-static_cast<float>(exp(-1.0/(sr*.025)));gAvgRelease=1-static_cast<float>(exp(-1.0/(sr*.300)));gCompAttack=1-static_cast<float>(exp(-1.0/(sr*.004)));gCompRelease=1-static_cast<float>(exp(-1.0/(sr*.110)));gImpactFastAttack=1-static_cast<float>(exp(-1.0/(sr*.0012)));gImpactFastRelease=1-static_cast<float>(exp(-1.0/(sr*.014)));gImpactSlowAttack=1-static_cast<float>(exp(-1.0/(sr*.030)));gImpactSlowRelease=1-static_cast<float>(exp(-1.0/(sr*.160)));gSmoothIntensity=1-static_cast<float>(exp(-1.0/(sr*.018)));gSmoothBass=1-static_cast<float>(exp(-1.0/(sr*.020)));gLimiterRelease=1-static_cast<float>(exp(-1.0/(sr*.070)));for(int i=0;i<kEqBands;++i)configureEqBand(i);gSpatialDecorHp.highpass(sr,260);gSpatialSideHp.highpass(sr,135);configureModeTone();configureBass();configureImpact();configureClarity();configurePersonal();configureMaster();resetState();return 1;}
void mvp_v2_reset(){resetState();}void mvp_v2_reset_meters(){resetMeters();}
void mvp_v2_set_mode(int m){int next=m<0?0:(m>2?2:m);if(next==gMode)return;int prev=gMode;gMode=next;if(next==0&&prev!=0)gPureFlushRemaining=gLookahead;else if(next!=0)gPureFlushRemaining=0;configureModeTone();}
void mvp_v2_set_output_profile(int p){gProfile=p<0?0:(p>2?2:p);configureModeTone();configureBass();configureImpact();configureClarity();configurePersonal();}
void mvp_v2_set_intensity(float x){gIntensityTarget=clampf(x,0,1);configureModeTone();configureBass();configureImpact();configureClarity();}
void mvp_v2_set_bass_enabled(int e){gBassEnabled=e?1:0;configureModeTone();}void mvp_v2_set_bass_character(float x){gBassCharacterTarget=clampf(x,0,1);configureBass();}
void mvp_v2_set_impact_enabled(int e){gImpactEnabled=e?1:0;}void mvp_v2_set_clarity_enabled(int e){gClarityEnabled=e?1:0;configureModeTone();}void mvp_v2_set_spatial_enabled(int e){gSpatialEnabled=e?1:0;}void mvp_v2_set_space_mode(int m){gSpaceMode=m<0?0:(m>3?3:m);}
void mvp_v2_set_personal_enabled(int e){gPersonalEnabled=e?1:0;configureModeTone();}void mvp_v2_set_personal_bass(float x){gPersonalBass=clampf(x,-1,1);configurePersonal();configureModeTone();}void mvp_v2_set_personal_presence(float x){gPersonalPresence=clampf(x,-1,1);configurePersonal();configureModeTone();}void mvp_v2_set_personal_brightness(float x){gPersonalBrightness=clampf(x,-1,1);configurePersonal();configureModeTone();}
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
      (gIntensityTarget-gIntensity)*
      gSmoothIntensity;

    gBassCharacter+=
      (gBassCharacterTarget-gBassCharacter)*
      gSmoothBass;

    /*
     * Master Prep and automatic mode character first.
     * Pure keeps Master Prep filters warm without coloring the reference.
     */
    if(gMode!=0){
      applyMaster(l,r);
    }else{
      float ml=l;
      float mr=r;
      applyMaster(ml,mr);
    }

    applyModeCore(l,r);

    /*
     * Cooperative reserve prevents Power + Bass + Clarity + Personal + EQ
     * from fighting for the same limiter headroom.
     */
    applyMixReserve(l,r);

    /*
     * Explicit musical controls.
     */
    applyBass(l,r);
    applyImpact(l,r);
    applyClarity(l,r);

    /*
     * Stage / Immersion:
     * width and depth are independent from tonal processing.
     */
    applySpatial(l,r);

    /*
     * Personal Sound is the final broad tonal preference.
     */
    applyPersonal(l,r);

    /*
     * 31-band EQ is final precision correction.
     */
    applyEq(l,r);

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

    if(processed){
      applyEmergencyPeakGuard(l,r);
    }

    limiter(
      l,r,
      ol,orr,
      processed
    );

    gOutputL[i]=ol;
    gOutputR[i]=orr;

    meter(ol,orr);
  }

  return 1;
}
float mvp_v2_meter_true_peak_dbtp(){return gainToDb(gMeterTruePeak);}float mvp_v2_meter_limiter_gr_db(){return gMeterLimiterGrDb;}unsigned int mvp_v2_meter_clip_count(){return gMeterClipCount;}unsigned int mvp_v2_meter_nan_count(){return gMeterNanCount;}float mvp_v2_meter_multiband_gr_db(){return gMeterLimiterGrDb;}float mvp_v2_meter_impact_boost_db(){return gMeterImpactBoostDb;}float mvp_v2_meter_bass_activity_db(){return gMeterBassActivityDb;}float mvp_v2_meter_clarity_activity_db(){return gMeterClarityActivityDb;}float mvp_v2_meter_spatial_width_percent(){return gMeterWidthPercent;}
}
