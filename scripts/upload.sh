#!/usr/bin/env bash
# upload.sh — convert, tag and upload your own songs (masters, demos…) to your library.
#
#   ./scripts/upload.sh -a "First Album" -A "My Band" -n 1 -c cover.jpg masters/*.wav
#   ./scripts/upload.sh -t "October Nights" masters/nights.wav
#
# Needs ffmpeg and rsync. By default it uploads over SSH to a server; for a library on this machine use
#   SERVER=local DEST=./data/music/Originals ./scripts/upload.sh …
set -euo pipefail

SERVER="${SERVER:-user@homelab}"
DEST="${DEST:-/srv/data/music/Originals}"
ARTIST="${ARTIST:-Me}"; ALBUM="Singles"; TITLE=""; TRACK=""; COVER=""; GENRE=""
LOSSLESS=0; YEAR="$(date +%Y)"

usage() {
  cat <<EOF
Usage: $0 [-t title] [-a album] [-A artist] [-n track] [-y year] [-g genre] [-c cover.jpg] [-l] file...
  -t  title (one file only; otherwise the file name is used)
  -a  album (default: Singles)
  -A  artist (default: \$ARTIST, or "Me")
  -n  first track number (counts up for each file)
  -g  genre (optional)
  -c  album cover (saved as cover.jpg)
  -l  keep lossless FLAC (default: AAC 256 kbps)
Environment: SERVER (default user@homelab; "local" copies without SSH), DEST (default /srv/data/music/Originals)
EOF
  exit 1
}

while getopts "t:a:A:n:y:g:c:lh" o; do
  case $o in
    t) TITLE=$OPTARG;; a) ALBUM=$OPTARG;; A) ARTIST=$OPTARG;; n) TRACK=$OPTARG;;
    y) YEAR=$OPTARG;; g) GENRE=$OPTARG;; c) COVER=$OPTARG;; l) LOSSLESS=1;; *) usage;;
  esac
done
shift $((OPTIND - 1))
[ $# -ge 1 ] || usage
[ -z "$TITLE" ] || [ $# -eq 1 ] || { echo "-t only works with a single file"; exit 1; }

if [ "$LOSSLESS" -eq 1 ]; then
  EXT=flac; CODEC=(-c:a flac)
else
  EXT=m4a;  CODEC=(-c:a aac -b:a 256k -movflags +faststart)
fi

safe() { printf '%s' "$1" | tr '/\\:*?"<>|' '-'; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
OUT="$TMP/$(safe "$ARTIST")/$(safe "$ALBUM")"
mkdir -p "$OUT"

n="${TRACK:-0}"
for f in "$@"; do
  title="${TITLE:-$(basename "${f%.*}")}"
  meta=(-metadata "title=$title" -metadata "artist=$ARTIST" -metadata "album_artist=$ARTIST"
        -metadata "album=$ALBUM" -metadata "date=$YEAR")
  [ -z "$GENRE" ] || meta+=(-metadata "genre=$GENRE")
  if [ -n "$TRACK" ]; then meta+=(-metadata "track=$n"); n=$((n + 1)); fi

  ffmpeg -nostdin -y -loglevel error -i "$f" -vn "${CODEC[@]}" "${meta[@]}" \
    "$OUT/$(safe "$title").$EXT"
  echo "✔ converted: $title"
done

[ -z "$COVER" ] || cp "$COVER" "$OUT/cover.jpg"

if [ "$SERVER" = "local" ]; then
  mkdir -p "$DEST"
  rsync -av "$TMP/" "$DEST/"
else
  rsync -av --partial --progress "$TMP/" "$SERVER:$DEST/"
fi
echo "Done. It will show up in your library within a minute."
