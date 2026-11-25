#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
raw_dir="$root_dir/video/raw"
music_file="$root_dir/content/kyrox-showcase-vertical/public/showcase-score.wav"
source_video="${1:-$(find "$raw_dir" -maxdepth 1 -type f -name '*.webm' -print | sort | tail -n 1)}"
output_video="$root_dir/video/kyrox-product-demo.mp4"

if [[ -z "$source_video" || ! -f "$source_video" ]]; then
  echo "No source recording found. Run: node video/record-kyrox-demo.mjs" >&2
  exit 1
fi

duration="$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$source_video")"
fade_start="$(awk -v duration="$duration" 'BEGIN { start = duration - 3.5; if (start < 1) start = 1; printf "%.3f", start }')"

ffmpeg -y \
  -stream_loop -1 -i "$music_file" \
  -i "$source_video" \
  -filter_complex "[0:a]volume=0.15,afade=t=in:st=0:d=1.8,afade=t=out:st=${fade_start}:d=3.5[audio]" \
  -map 1:v:0 -map "[audio]" \
  -t "$duration" \
  -r 30 -c:v libx264 -preset medium -crf 17 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart \
  "$output_video"

echo "FINAL_VIDEO=$output_video"

