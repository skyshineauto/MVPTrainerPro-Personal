#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/dsp/studio/mvp_studio_dsp.cpp"
OUT="$ROOT/public/audio/mvpStudioEngine.wasm"

CLANGXX="${CLANGXX:-clang++}"
"$CLANGXX" \
  --target=wasm32 \
  -std=c++20 -O3 -fno-exceptions -fno-rtti -nostdlib \
  "$SRC" \
  -Wl,--no-entry \
  -Wl,--export-memory \
  -Wl,--initial-memory=1048576 \
  -Wl,--max-memory=1048576 \
  -Wl,--export=mvp_init \
  -Wl,--export=mvp_max_frames \
  -Wl,--export=mvp_input_l \
  -Wl,--export=mvp_input_r \
  -Wl,--export=mvp_output_l \
  -Wl,--export=mvp_output_r \
  -Wl,--export=mvp_set_bypass \
  -Wl,--export=mvp_set_eq_enabled \
  -Wl,--export=mvp_set_eq_band \
  -Wl,--export=mvp_set_preamp_db \
  -Wl,--export=mvp_set_headroom_db \
  -Wl,--export=mvp_set_limiter \
  -Wl,--export=mvp_set_output_profile \
  -Wl,--export=mvp_set_headphone \
  -Wl,--export=mvp_reset \
  -Wl,--export=mvp_process \
  -Wl,--export=mvp_meter_input_peak \
  -Wl,--export=mvp_meter_output_peak \
  -Wl,--export=mvp_meter_input_rms \
  -Wl,--export=mvp_meter_output_rms \
  -Wl,--export=mvp_meter_gain_reduction_db \
  -Wl,--export=mvp_meter_limiter_gain \
  -Wl,--allow-undefined \
  -o "$OUT"

echo "Built $OUT"
