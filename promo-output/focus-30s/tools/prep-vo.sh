#!/usr/bin/env bash
# After tools/gen-vo.py: trim leading/trailing silence and normalize each line to −16 LUFS (in place).
set -euo pipefail
cd "$(dirname "$0")/.."
FF=${FFMPEG:-$(python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")}
for f in public/vo/f0*.wav; do
  "$FF" -v error -y -i "$f" -af "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5:LRA=7" -ar 48000 -ac 1 "$f.tmp.wav"
  mv "$f.tmp.wav" "$f"
done
