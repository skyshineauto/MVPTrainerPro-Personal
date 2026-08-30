declare module "essentia.js/dist/essentia.js-core.es.js" {
  export default class Essentia {
    constructor(wasmModule: unknown);
    arrayToVector(value: Float32Array | number[]): unknown;
    Resample(signal: unknown, inputSampleRate?: number, outputSampleRate?: number, quality?: number): { signal: unknown };
    RhythmExtractor2013(signal: unknown, maxTempo?: number, method?: string, minTempo?: number): Record<string, unknown>;
    KeyExtractor(signal: unknown, ...args: unknown[]): Record<string, unknown>;
    Danceability(signal: unknown, maxTau?: number, minTau?: number, sampleRate?: number, tauMultiplier?: number): Record<string, unknown>;
    Intensity(signal: unknown, sampleRate?: number): Record<string, unknown>;
    DynamicComplexity(signal: unknown, frameSize?: number, sampleRate?: number): Record<string, unknown>;
    SpectralCentroidTime(signal: unknown, sampleRate?: number): Record<string, unknown>;
    ZeroCrossingRate(signal: unknown, threshold?: number): Record<string, unknown>;
  }
}

declare module "essentia.js/dist/essentia-wasm.es.js" {
  export const EssentiaWASM: unknown;
}
