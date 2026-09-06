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
  -Wl,--initial-memory=4194304 \
  -Wl,--max-memory=4194304 \
  -Wl,--export=mvp_init \
  -Wl,--export=mvp_max_frames \
  -Wl,--export=mvp_input_l \
  -Wl,--export=mvp_input_r \
  -Wl,--export=mvp_output_l \
  -Wl,--export=mvp_output_r \
  -Wl,--export=mvp_set_bypass \
  -Wl,--export=mvp_set_eq_enabled \
  -Wl,--export=mvp_set_eq_topology \
  -Wl,--export=mvp_set_eq_band \
  -Wl,--export=mvp_commit_eq \
  -Wl,--export=mvp_set_preamp_db \
  -Wl,--export=mvp_set_headroom_db \
  -Wl,--export=mvp_set_transient \
  -Wl,--export=mvp_set_multiband \
  -Wl,--export=mvp_set_dynamic_eq \
  -Wl,--export=mvp_set_loudness \
  -Wl,--export=mvp_reset_loudness \
  -Wl,--export=mvp_set_limiter \
  -Wl,--export=mvp_set_output_profile \
  -Wl,--export=mvp_set_output_correction \
  -Wl,--export=mvp_set_stereo_integrity \
  -Wl,--export=mvp_set_headphone \
  -Wl,--export=mvp_set_parametric_enabled \
  -Wl,--export=mvp_set_parametric_band \
  -Wl,--export=mvp_set_bass_engine \
  -Wl,--export=mvp_set_tone_engine \
  -Wl,--export=mvp_set_exciter \
  -Wl,--export=mvp_set_stereo_field \
  -Wl,--export=mvp_set_dynamics_restore \
  -Wl,--export=mvp_set_smart_dsp \
  -Wl,--export=mvp_set_output_gain \
  -Wl,--export=mvp_set_headphone_advanced \
  -Wl,--export=mvp_reset \
  -Wl,--export=mvp_process \
  -Wl,--export=mvp_meter_input_peak \
  -Wl,--export=mvp_meter_output_peak \
  -Wl,--export=mvp_meter_input_rms \
  -Wl,--export=mvp_meter_output_rms \
  -Wl,--export=mvp_meter_gain_reduction_db \
  -Wl,--export=mvp_meter_limiter_gain \
  -Wl,--export=mvp_meter_true_peak_linear \
  -Wl,--export=mvp_meter_true_peak_dbtp \
  -Wl,--export=mvp_meter_transient_boost_db \
  -Wl,--export=mvp_meter_multiband_gain_reduction_db \
  -Wl,--export=mvp_meter_multiband_band_reduction_db \
  -Wl,--export=mvp_meter_dynamic_eq_gain_reduction_db \
  -Wl,--export=mvp_meter_dynamic_eq_band_reduction_db \
  -Wl,--export=mvp_meter_output_correction_reduction_db \
  -Wl,--export=mvp_meter_stereo_correlation \
  -Wl,--export=mvp_meter_stereo_width_percent \
  -Wl,--export=mvp_meter_stereo_guard_reduction_db \
  -Wl,--export=mvp_meter_headphone_output_drive_db \
  -Wl,--export=mvp_meter_loudness_gain_db \
  -Wl,--export=mvp_meter_loudness_momentary_lufs \
  -Wl,--export=mvp_meter_loudness_program_lufs \
  -Wl,--export=mvp_meter_auto_makeup_db \
  -Wl,--export=mvp_meter_output_reserve_db \
  -Wl,--export=mvp_meter_final_compressor_reduction_db \
  -Wl,--export=mvp_meter_max_hd_input_true_peak_dbtp \
  -Wl,--export=mvp_meter_available_headroom_db \
  -Wl,--export=mvp_meter_internal_peak \
  -Wl,--export=mvp_meter_bass_activity_db \
  -Wl,--export=mvp_meter_tone_activity_db \
  -Wl,--export=mvp_meter_exciter_activity \
  -Wl,--export=mvp_meter_deharsh_reduction_db \
  -Wl,--export=mvp_meter_smart_activity \
  -Wl,--export=mvp_eq_topology \
  -Wl,--export=mvp_linear_phase_taps \
  -Wl,--export=mvp_linear_phase_latency_samples \
  -Wl,--allow-undefined \
  -o "$OUT"

echo "Built $OUT"
