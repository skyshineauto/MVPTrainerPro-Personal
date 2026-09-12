export type MvpHdV2LoudnessMode = 'normal' | 'loud' | 'max';

export type MvpHdV2State = {
  bypass: boolean;
  loudnessMode: MvpHdV2LoudnessMode;
  bass: number;
  clarity: number;
  punch: number;
  wide: number;
  eqEnabled: boolean;
  eqGains: number[];
};

export type MvpHdV2Telemetry = {
  revision: number;
  truePeakDbtp: number;
  limiterGrDb: number;
  clipCount: number;
  nanCount: number;
};

export const MVP_HD_V2_EQ_BANDS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250,
  1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000,
  10000, 12500, 16000, 20000,
] as const;

export function createDefaultMvpHdV2State(): MvpHdV2State {
  return {
    bypass: true,
    loudnessMode: 'normal',
    bass: 0,
    clarity: 0,
    punch: 0,
    wide: 0,
    eqEnabled: false,
    eqGains: new Array<number>(31).fill(0),
  };
}
