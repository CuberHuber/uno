#!/usr/bin/env bash
# Cut the landing-page clips out of the gameplay recording.
#
#   bash tools/cut-landing-clips.sh [path/to/gameplay.mov]
#
# The source is an HDR10 screen capture (BT.2020 primaries, PQ transfer, 10-bit).
# Decoded straight into SDR it comes out grey and desaturated — it reads as a bad
# recording but it is a colour-space mismatch, so every encode tone-maps first.
# Without the chain below the felt goes muddy and the suit colours die.
#
# Each moment produces three files: a VP9 WebM, an H.264 MP4 for Safari, and a
# poster taken from the clip's own first frame, so a paused or not-yet-loaded
# video is indistinguishable from a playing one.
set -euo pipefail

SRC="${1:-gameplay.mov}"
OUT="client/public/clips"
WIDTH=720          # plenty for a card table; the source is a 2294px square
FPS=30             # the capture is 60; half of it is invisible on a landing page

# Trim only the last sliver, which carries the recorder's own status chip. Keep
# everything above it: the player's fanned hand sits low in the frame and is the
# most human thing on screen — an earlier 0.80 crop cut it in half.
CROP="crop=iw:ih*0.93:0:0"

TONEMAP="zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,\
tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"

# Timestamps come from reading the recording, not from guessing. All four sit in
# the first two minutes, while every seat still holds a real hand; the last minute
# is the recorder spectating after finishing, and it shows greyed seats and a
# "watching" chip that have no business on a landing page.
#
# name        start   seconds   what it shows
CLIPS=$(cat <<'TABLE'
turn          35.5    5.0       a plain turn: four full hands, a card chosen and played
slam          41.0    7.0       the +4 arc: pick a colour, the slam, the shockwave, the pot passed on
wild          64.0    7.0       a wild going down and the called-colour wash flooding the table
lastcard      109.5   6.5       UNO called, the catch window, the last card down, the +2 counter
TABLE
)

command -v ffmpeg >/dev/null || { echo "ffmpeg not found" >&2; exit 1; }
# Collect first, then test: `| grep -q` closes the pipe early, and under
# `pipefail` ffmpeg's SIGPIPE would read as "filter missing".
FILTERS=$(ffmpeg -hide_banner -filters 2>/dev/null || true)
case "$FILTERS" in
  *zscale*) ;;
  *) echo "this ffmpeg has no zscale (libzimg); tone-mapping is impossible" >&2; exit 1 ;;
esac
[ -f "$SRC" ] || { echo "no recording at $SRC" >&2; exit 1; }

mkdir -p "$OUT"

while read -r name start dur _rest; do
  [ -z "$name" ] && continue
  vf="${CROP},${TONEMAP},fps=${FPS},scale=${WIDTH}:-2"

  echo "cutting $name (${start}s +${dur}s)"
  ffmpeg -nostdin -v error -ss "$start" -t "$dur" -i "$SRC" -vf "$vf" -an \
    -c:v libvpx-vp9 -crf 34 -b:v 0 -cpu-used 2 -row-mt 1 -y "$OUT/$name.webm"
  ffmpeg -nostdin -v error -ss "$start" -t "$dur" -i "$SRC" -vf "$vf" -an \
    -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart \
    -y "$OUT/$name.mp4"
  ffmpeg -nostdin -v error -ss "$start" -i "$SRC" -vf "${CROP},${TONEMAP},scale=${WIDTH}:-2" \
    -frames:v 1 -q:v 4 -y "$OUT/$name.jpg"
done <<< "$CLIPS"

# --- the hero, widened -------------------------------------------------------
# The hero plays full-bleed, and the source is square: `object-fit: cover` on a
# landscape screen would crop away the player chips at the top, which are the only
# thing saying four people are at this table. So widen the frame instead of
# cropping it — the square sits centred at full height, and the gutters are filled
# with a blurred, scaled-up copy of the same frame. The felt is close to flat, so
# the seam does not read.
HERO_IN=41.0
HERO_DUR=7.0
hero_vf="[0:v]${CROP},${TONEMAP},fps=${FPS},split=2[bg][fg];\
[bg]scale=1600:-2,crop=1600:900,gblur=sigma=42[bgb];\
[fg]scale=-2:900[fgs];\
[bgb][fgs]overlay=(W-w)/2:0"

echo "cutting hero (${HERO_IN}s +${HERO_DUR}s, widened to 16:9)"
ffmpeg -nostdin -v error -ss "$HERO_IN" -t "$HERO_DUR" -i "$SRC" -filter_complex "$hero_vf" -an \
  -c:v libvpx-vp9 -crf 34 -b:v 0 -cpu-used 2 -row-mt 1 -y "$OUT/hero.webm"
ffmpeg -nostdin -v error -ss "$HERO_IN" -t "$HERO_DUR" -i "$SRC" -filter_complex "$hero_vf" -an \
  -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart -y "$OUT/hero.mp4"
ffmpeg -nostdin -v error -ss "$HERO_IN" -i "$SRC" -filter_complex "$hero_vf" \
  -frames:v 1 -q:v 4 -y "$OUT/hero.jpg"

echo
ls -la "$OUT"
