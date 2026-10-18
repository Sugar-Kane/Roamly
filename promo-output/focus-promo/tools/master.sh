#!/usr/bin/env bash
# Two-pass loudness master of the rendered mix to −14 LUFS / −1 dBTP; the video stream is copied untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
FF=${FFMPEG:-$(python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")}
IN=out/roamlyflow-focus-promo.mp4; OUT=out/roamlyflow-focus-promo-final.mp4
J=$("$FF" -hide_banner -i "$IN" -af loudnorm=I=-14:TP=-1:LRA=9:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
g() { echo "$J" | python3 -c "import json,sys;print(json.load(sys.stdin)['$1'])"; }
"$FF" -v error -y -i "$IN" -c:v copy -af "loudnorm=I=-14:TP=-1:LRA=9:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true,aresample=48000" -c:a aac -b:a 256k -movflags +faststart "$OUT"
"$FF" -hide_banner -i "$OUT" -af ebur128=peak=true:framelog=quiet -f null - 2>&1 | grep -A20 Summary | grep -E "I:|Peak:|LRA:"
