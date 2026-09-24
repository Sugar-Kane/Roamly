#!/usr/bin/env bash
# Contact sheet from a rendered MP4: one frame every 0.5 s, labelled with its timestamp, safe-area lines drawn.
# Usage: tools/video-sheet.sh roamlyflow-promo-vertical.mp4 vertical review/sheet-vertical-pass1.jpg
set -euo pipefail
cd "$(dirname "$0")/.."
FF=${FFMPEG:-$(python3 -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')}
IN=$1; FMT=$2; OUT=$3; D=review/vframes-$FMT
rm -rf "$D"; mkdir -p "$D"
for i in $(seq 0 119); do t=$(python3 -c "print(f'{$i*0.5:.2f}')"); $FF -hide_banner -loglevel error -ss "$t" -i "$IN" -frames:v 1 "$D/$(printf %05.2f $t).png"; done
python3 tools/sheet.py "$D" "$OUT" "$FMT"
