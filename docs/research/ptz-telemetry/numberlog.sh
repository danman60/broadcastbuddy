#!/bin/bash
# Per-number capture: full-res 1920 OBSBOT frame at detect-zoom + telemetry tag, every 4s.
# Captures EVERY routine for the rest of the show. Read-only via OBS.
cd /home/danman60/projects/BroadcastBuddy/docs/research/ptz-telemetry
DIR=numbers; mkdir -p $DIR
IDX=$DIR/index.jsonl
for i in $(seq 1 5000); do
  ts=$(TZ=America/New_York date +%H%M%S)
  python3 obsshot.py shot "Video Capture Device 2" "$DIR/$ts.jpg" 1920 >/dev/null 2>&1
  cam=$(timeout 10 ssh -o BatchMode=yes -o ConnectTimeout=6 dart 'powershell -NoProfile -Command "$b=\"http://192.168.2.91/camera/sdk\"; function g($p){try{Invoke-RestMethod ($b+$p) -TimeoutSec 3}catch{$null}}; (@{wm=(g \"/ai/workmode\").mode; zoom=(g \"/ptz/zoom\").ratio}|ConvertTo-Json -Compress)"' 2>/dev/null | tr -d '\r')
  echo "{\"t\":\"$ts\",\"frame\":\"$ts.jpg\",\"cam\":${cam:-null}}" >> "$IDX"
  sleep 4
done
