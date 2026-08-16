# MVP Studio DSP

This directory is the source of the flagship browser DSP core.

## V1

`mvp_studio_dsp.cpp` is a freestanding C++ WebAssembly core with no heap allocation in the real-time processing function. The browser-side AudioWorklet preallocates views into fixed WASM input/output buffers and copies each render quantum through the core.

The C++ core currently owns the live minimum-phase 31-band EQ, headroom gain, output correction, headphone spatial/crossfeed processing, limiter, and meters.

## Faust integration

The next processing stage should generate the appropriate filters/dynamics algorithms from Faust and link or wrap them behind this same single Studio state/API. The React player should not gain a second DSP state and the AudioWorklet should remain the single real-time execution boundary.

Linear-phase FIR, multiband dynamics, loudness normalization and the more advanced transient algorithms should be migrated one at a time after V1 playback/fallback is proven in production.
