#!/bin/bash
# Send files to phone via RayLink daemon
# Used by the Finder Quick Action

DAEMON_URL="http://127.0.0.1:19876"

# Get first connected device
DEVICE_ID=$(curl -s "$DAEMON_URL/devices" | python3 -c "
import json, sys
devices = json.load(sys.stdin)
connected = [d for d in devices if d['connected']]
if connected: print(connected[0]['id'])
" 2>/dev/null)

if [ -z "$DEVICE_ID" ]; then
    osascript -e 'display notification "No phone connected" with title "RayLink"'
    exit 1
fi

for f in "$@"; do
    RESULT=$(curl -s -X POST "$DAEMON_URL/devices/$DEVICE_ID/file/send" \
        -H "Content-Type: application/json" \
        -d "{\"filePath\": \"$f\"}")
    FILENAME=$(basename "$f")
    osascript -e "display notification \"Sending $FILENAME...\" with title \"RayLink\""
done
