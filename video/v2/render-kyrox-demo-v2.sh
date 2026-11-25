#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
v2_dir="$root_dir/video/v2"
music_file="$root_dir/content/kyrox-showcase-vertical/public/showcase-score.wav"
source_video="${1:-$(find "$v2_dir/raw" -maxdepth 1 -type f -name '*.webm' -print | sort | tail -n 1)}"
output_video="$root_dir/video/kyrox-product-demo-v2.mp4"
source_duration="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$source_video")"
music_fade_start="$(awk -v duration="$source_duration" 'BEGIN { printf "%.3f", duration - 3 }')"

if [[ -z "$source_video" || ! -f "$source_video" ]]; then
  echo "No V2 source recording found. Run the Chromium capture first." >&2
  exit 1
fi
ffmpeg -y \
  -stream_loop -1 -i "$music_file" \
  -i "$source_video" \
  -filter_complex "[0:a]volume=0.075,afade=t=in:st=0:d=2.2,afade=t=out:st=${music_fade_start}:d=3[music]" \
  -map 1:v:0 -map "[music]" \
  -shortest -r 30 -c:v libx264 -preset medium -crf 17 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart \
  "$output_video"

echo "FINAL_VIDEO=$output_video"
