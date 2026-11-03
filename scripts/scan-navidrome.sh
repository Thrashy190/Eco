#!/bin/sh
# Lidarr hook (Settings → Connect → Custom Script): ask Navidrome to scan right now.
# startScan needs a Navidrome ADMIN user: set ND_USER and ND_PASS in .env.
[ "$lidarr_eventtype" = "Test" ] && exit 0

salt="$(date +%s)"
token="$(printf '%s%s' "$ND_PASS" "$salt" | md5sum | cut -d' ' -f1)"
curl -fsS "$ND_URL/rest/startScan?u=$ND_USER&t=$token&s=$salt&v=1.16.1&c=lidarr&f=json" >/dev/null
