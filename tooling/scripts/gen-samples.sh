#!/usr/bin/env bash
# Generate test clips for the M0 playback spike and the 10-bit precision probe.
# Requires ffmpeg with hevc_videotoolbox (any Homebrew/static macOS build).
set -euo pipefail

OUT_DIR="$(cd "$(dirname "$0")/../.." && pwd)/samples"
mkdir -p "$OUT_DIR"

# 1) Motion test pattern — 4K30, HEVC Main10, hvc1 tag (Safari/WebKit needs it)
ffmpeg -y -f lavfi -i "testsrc2=size=3840x2160:rate=30:duration=6" \
  -pix_fmt p010le -c:v hevc_videotoolbox -profile:v main10 -b:v 60M \
  -tag:v hvc1 -movflags +faststart \
  "$OUT_DIR/testpattern_4k_hevc10.mp4"

# 2) Horizontal luminance ramp — the 10-bit precision probe input.
#    A 3840-px-wide linear ramp has 3840 distinct levels in 10-bit space
#    (1024 representable); an 8-bit-truncated pipeline collapses it to ≤256.
ffmpeg -y -f lavfi -i "nullsrc=size=3840x2160:rate=30:duration=2" \
  -vf "format=yuv420p10le,geq=lum='(X/W)*1023':cb=512:cr=512" \
  -pix_fmt p010le -c:v hevc_videotoolbox -profile:v main10 -b:v 30M \
  -tag:v hvc1 -movflags +faststart \
  "$OUT_DIR/ramp_4k_hevc10.mp4"

# 3) moov-at-end remux of the ramp — DJI in-camera files put moov after
#    mdat; the streaming demuxer test covers this layout.
ffmpeg -y -i "$OUT_DIR/ramp_4k_hevc10.mp4" -c copy "$OUT_DIR/ramp_moov_at_end.mp4"

echo "Samples written to $OUT_DIR"
