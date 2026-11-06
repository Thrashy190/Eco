#!/bin/sh
# Install a packaged Roku app on a Roku in developer mode and open it: install.sh <roku ip> <rokudev password> <zip>
# Used by `make roku-install`. The installer sometimes drops the first upload, so it tries again before giving up.
set -u
ip=$1
password=$2
zip=$3

answer=$(curl -sS --retry 2 --retry-all-errors --digest -u "rokudev:$password" \
	-F mysubmit=Install -F "archive=@$zip" "http://$ip/plugin_install") || {
	echo "Could not reach the Roku at $ip"
	exit 1
}
result=$(printf '%s' "$answer" | grep -oE 'Install Success|Identical to previous version|Install Failure[^<."]*|Unauthorized' | head -n 1)
echo "${result:-No answer from the Roku's installer}"
case "$result" in
"Install Success" | Identical*) ;;
*) exit 1 ;;
esac

# Opening it needs "Control by mobile apps" to allow it (Settings > System > Advanced system settings)
if curl -sS -f -o /dev/null -d '' "http://$ip:8060/launch/dev"; then
	echo "Eco is open on the TV"
else
	echo "Installed. Open Eco from the TV's home screen"
fi
