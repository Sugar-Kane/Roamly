#!/usr/bin/env bash
# Master: measure integrated loudness, apply the exact gain to -14 LUFS, then an oversampled
# peak limiter (4x, ceiling -1.4 dBFS) so true peak stays below -1 dBTP. Verified with loudnorm analysis.
set -euo pipefail
cd "$(dirname "$0")/.."
FF=${FFMPEG:-$(python3 -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')}
measure() { $FF -hide_banner -i "$1" -af loudnorm=I=-14:TP=-1:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p'; }
I0=$(measure audio/mix_pre.wav | python3 -c "import sys,json;print(json.load(sys.stdin)['input_i'])")
G=$(python3 -c "print(round(-14.0 - float('$I0') + 0.04, 2))")   # +0.04 LU pre-compensates the limiter
$FF -hide_banner -y -i audio/mix_pre.wav -af "aresample=192000,volume=${G}dB,alimiter=limit=0.851:attack=1:release=60:level=disabled:asc=1,aresample=48000" -ar 48000 -c:a pcm_s16le audio/mix.wav 2>/dev/null
echo "pre-master: ${I0} LUFS, gain ${G} dB"
echo "== verification (loudnorm analysis of audio/mix.wav) =="
measure audio/mix.wav
