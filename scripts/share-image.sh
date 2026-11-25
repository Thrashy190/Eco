#!/bin/sh
# Draws web/public/og-image.png, the picture chat apps show when someone shares a link to Eco: the logo's mark from
# web/public/icon.svg, centred on the app's background. 1200x630 is the size WhatsApp, Telegram and iMessage expect, and
# the mark stays inside the middle square, which is what they keep when they show a small square preview.
# Needs rsvg-convert (librsvg2-bin). Run it again after changing icon.svg.
set -eu
cd "$(dirname "$0")/.."
mark=$(sed -n 's/.*<g fill="url(#m)">\(.*\)<\/g>.*/\1/p' web/public/icon.svg)
gradient=$(sed -n 's/.*\(<linearGradient id="m".*<\/linearGradient>\).*/\1/p' web/public/icon.svg)
[ -n "$mark" ] && [ -n "$gradient" ] || { echo "could not find the mark in web/public/icon.svg" >&2; exit 1; }
# The mark spans about 330 of icon.svg's 512 units around its centre (256, 256); scaled 1.25 it is about 415 px tall.
svg=$(mktemp --suffix=.svg)
trap 'rm -f "$svg"' EXIT
cat > "$svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>$gradient</defs>
<rect width="1200" height="630" fill="#0b0b0f"/>
<g transform="translate(280 -5) scale(1.25)"><g fill="url(#m)">$mark</g></g>
</svg>
SVG
rsvg-convert -w 1200 -h 630 "$svg" -o web/public/og-image.png
echo "wrote web/public/og-image.png"
