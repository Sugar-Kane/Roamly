#!/usr/bin/env bash
# Two-pass EBU R128 loudness normalisation → -14 LUFS integrated, true peak ≤ -1.2 dBTP, 48 kHz.
set -euo pipefail
cd "$(dirname "$0")/.."
FF=${FFMPEG:-$(python3 -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')}
M=$($FF -hide_banner -i audio/mix_pre.wav -af loudnorm=I=-14:TP=-1.2:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
g() { echo "$M" | python3 -c "import sys,json;print(json.load(sys.stdin)['$1'])"; }
$FF -hide_banner -y -i audio/mix_pre.wav -af "loudnorm=I=-14:TP=-1.2:LRA=11:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true,aresample=48000" -ar 48000 -c:a pcm_s16le audio/mix.wav 2>/dev/null
echo "== verification (loudnorm analysis of audio/mix.wav) =="
$FF -hide_banner -i audio/mix.wav -af loudnorm=I=-14:TP=-1.2:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p'
