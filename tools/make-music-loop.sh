#!/usr/bin/env bash
# Turn the background track into something that can actually loop.
#
#   bash tools/make-music-loop.sh [path/to/sound.mp3]
#
# The delivered master is a piece of music, not a loop, and measuring it says so:
#
#   * it ends with 0.98 s of digital silence (151.238 s -> 152.216 s);
#   * the first 8 s average -20.1 dB, the last 12 s average -10.7 dB and peak -0.1;
#
# so playing it on repeat gives a loud finish, a full second of nothing, then a quiet
# intro. That is not a seam, it is an audible restart every two and a half minutes.
#
# Until a properly written loop arrives (see design/audio-spec.md), this makes the best
# loop available from what we have: trim the dead air, then wrap the tail into the head
# with a crossfade. The join becomes continuous by construction — the output starts on
# the very sample the output ends on — and the level change is spread over four seconds
# instead of happening between two samples.
#
# It also writes two 8-second previews of just the join, before and after, so the seam
# can be judged by ear without sitting through the track.
set -euo pipefail

SRC="${1:-sound.mp3}"
OUT="client/public/audio"
# Deliberately NOT under client/public: the previews are for judging the seam by ear,
# and anything under public/ ships to production.
PREVIEW="${PREVIEW_DIR:-.audio-preview}"

# Where the loop starts. NOT the top of the track: the first 14 s are an intro at
# about -19 dB, while everything from 14 s to the end sits at -10 dB. Looping from the
# top would slide 9 dB down and back up every couple of minutes. Starting at 14 s makes
# both sides of the join the same loudness, at the cost of an intro that would have
# played once. A quiet 14-second intro is not worth a seam heard every two minutes —
# if a real intro is wanted, it is a separate file and a code change (design/audio-spec.md).
LOOP_IN=14.0
TAIL=151.238      # where the trailing silence starts, from silencedetect
XFADE=4           # seconds of crossfade wrapping the tail into the loop-in point
BITRATE=96k       # 3.65 MB of 192 kbps MP3 comes down to about 1.7 MB here

command -v ffmpeg >/dev/null || { echo "ffmpeg not found" >&2; exit 1; }
[ -f "$SRC" ] || { echo "no music at $SRC" >&2; exit 1; }
mkdir -p "$OUT" "$PREVIEW"

BODY_END=$(echo "$TAIL - $XFADE" | bc)
HEAD_END=$(echo "$LOOP_IN + $XFADE" | bc)

# seam = last XFADE seconds fading out over the first XFADE seconds fading in;
# body  = everything between. Output length is (TAIL - HEAD) - XFADE.
loop_fc="[0:a]atrim=start=${BODY_END}:end=${TAIL},asetpts=PTS-STARTPTS,afade=t=out:st=0:d=${XFADE}[tail];\
[0:a]atrim=start=${LOOP_IN}:end=${HEAD_END},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${XFADE}[head];\
[tail][head]amix=inputs=2:normalize=0[seam];\
[0:a]atrim=start=${HEAD_END}:end=${BODY_END},asetpts=PTS-STARTPTS[body];\
[seam][body]concat=n=2:v=0:a=1[out]"

echo "building the looped master"
ffmpeg -nostdin -v error -i "$SRC" -filter_complex "$loop_fc" -map "[out]" \
  -c:a aac -b:a "$BITRATE" -movflags +faststart -y "$OUT/table.m4a"

# --- previews of the join ----------------------------------------------------
# Four seconds either side of the wrap, so the ear hears only what matters.
seam_of () {  # seam_of <file> <out> — end of the file followed by its beginning
  local f="$1" o="$2" dur from
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  from=$(echo "$dur - 4" | bc)
  ffmpeg -nostdin -v error -ss "$from" -i "$f" -t 4 -c:a aac -b:a "$BITRATE" -y "$PREVIEW/.a.m4a"
  ffmpeg -nostdin -v error -t 4 -i "$f" -c:a aac -b:a "$BITRATE" -y "$PREVIEW/.b.m4a"
  ffmpeg -nostdin -v error -i "$PREVIEW/.a.m4a" -i "$PREVIEW/.b.m4a" \
    -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[o]" -map "[o]" \
    -c:a aac -b:a "$BITRATE" -y "$o"
  rm -f "$PREVIEW/.a.m4a" "$PREVIEW/.b.m4a"
}

echo "rendering seam previews"
ffmpeg -nostdin -v error -i "$SRC" -c:a aac -b:a "$BITRATE" -y "$PREVIEW/.src.m4a"
seam_of "$PREVIEW/.src.m4a" "$PREVIEW/seam-before.m4a"
seam_of "$OUT/table.m4a" "$PREVIEW/seam-after.m4a"
rm -f "$PREVIEW/.src.m4a"

echo
ls -la "$OUT" "$PREVIEW"
