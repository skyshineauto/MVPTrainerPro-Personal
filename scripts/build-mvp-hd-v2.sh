#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/dsp/v2/mvp_hd_v2.cpp"
OUT="$ROOT/public/audioV2/mvpHdV2.wasm"
CXX="${CXX:-clang++}"

mkdir -p "$(dirname "$OUT")"

"$CXX" \
  --target=wasm32 \
  -std=c++20 -O3 -fno-exceptions -fno-rtti -fno-builtin -nostdlib \
  "$SRC" \
  -Wl,--no-entry \
  -Wl,--export-memory \
  -Wl,--initial-memory=8388608 \
  -Wl,--max-memory=8388608 \
  -Wl,--export=mvp_v2_input_l \
  -Wl,--export=mvp_v2_input_r \
  -Wl,--export=mvp_v2_output_l \
  -Wl,--export=mvp_v2_output_r \
  -Wl,--export=mvp_v2_max_frames \
  -Wl,--export=mvp_v2_init \
  -Wl,--export=mvp_v2_reset \
  -Wl,--export=mvp_v2_reset_meters \
  -Wl,--export=mvp_v2_set_mode \
  -Wl,--export=mvp_v2_set_output_profile \
  -Wl,--export=mvp_v2_set_intensity \
  -Wl,--export=mvp_v2_set_bass_enabled \
  -Wl,--export=mvp_v2_set_bass_character \
  -Wl,--export=mvp_v2_set_impact_enabled \
  -Wl,--export=mvp_v2_set_clarity_enabled \
  -Wl,--export=mvp_v2_set_spatial_enabled \
  -Wl,--export=mvp_v2_set_space_mode \
  -Wl,--export=mvp_v2_set_personal_enabled \
  -Wl,--export=mvp_v2_set_personal_bass \
  -Wl,--export=mvp_v2_set_personal_presence \
  -Wl,--export=mvp_v2_set_personal_brightness \
  -Wl,--export=mvp_v2_set_bypass \
  -Wl,--export=mvp_v2_set_loudness_mode \
  -Wl,--export=mvp_v2_set_bass \
  -Wl,--export=mvp_v2_set_clarity \
  -Wl,--export=mvp_v2_set_punch \
  -Wl,--export=mvp_v2_set_wide \
  -Wl,--export=mvp_v2_set_eq_enabled \
  -Wl,--export=mvp_v2_set_eq_band \
  -Wl,--export=mvp_v2_process \
  -Wl,--export=mvp_v2_meter_true_peak_dbtp \
  -Wl,--export=mvp_v2_meter_limiter_gr_db \
  -Wl,--export=mvp_v2_meter_clip_count \
  -Wl,--export=mvp_v2_meter_nan_count \
  -Wl,--export=mvp_v2_meter_multiband_gr_db \
  -Wl,--export=mvp_v2_meter_impact_boost_db \
  -Wl,--export=mvp_v2_meter_bass_activity_db \
  -Wl,--export=mvp_v2_meter_clarity_activity_db \
  -Wl,--export=mvp_v2_meter_spatial_width_percent \
  -Wl,--allow-undefined \
  -o "$OUT"

echo "Built $OUT"
