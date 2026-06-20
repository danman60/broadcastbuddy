#!/bin/bash
# Continuous OBSBOT frame capture (read-only via OBS) + telemetry tag.
# Frame = what the OBSBOT sees. Paired with the running JSONL telemetry logger.
cd /home/danman60/projects/BroadcastBuddy/docs/research/ptz-telemetry
FR=frames
IDX=$FR/index.jsonl
for i in $(seq 1 3000); do
  ts=$(TZ=America/New_York date +%H%M%S)
  out=$FR/$ts.jpg
  python3 obsshot.py shot "Video Capture Device 2" "$out" >/dev/null 2>&1
  # tag with live camera state
  cam=$(timeout 12 ssh -o BatchMode=yes -o ConnectTimeout=6 dart 'powershell -NoProfile -Command "$b=\"http://192.168.2.91/camera/sdk\"; function g($p){try{Invoke-RestMethod ($b+$p) -TimeoutSec 3}catch{$null}}; (@{wm=(g \"/ai/workmode\").mode; zt=(g \"/ai/human/zoomtype\").type; zoom=(g \"/ptz/zoom\").ratio}|ConvertTo-Json -Compress)"' 2>/dev/null | tr -d '\r')
  echo "{\"t\":\"$ts\",\"frame\":\"$ts.jpg\",\"cam\":${cam:-null}}" >> "$IDX"
  sleep 20
done
