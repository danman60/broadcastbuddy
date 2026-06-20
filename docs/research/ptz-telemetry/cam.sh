#!/bin/bash
# cam.sh — drive OBSBOT via DART REST. Usage:
#   cam.sh tilt <pitch> <ms>      pitch<0=down >0=up, hold ms then stop
#   cam.sh pan  <yaw> <ms>        yaw<0=left >0=right
#   cam.sh move <yaw> <pitch> <ms>
#   cam.sh zoom <ratio>
#   cam.sh home                   recall preset 1 (wide), AI off
#   cam.sh aioff                  workmode none
#   cam.sh state                  print wm/zt/zoom/exp
B='http://192.168.2.91/camera/sdk'
ssh_ps(){ timeout 25 ssh -o BatchMode=yes -o ConnectTimeout=8 dart "powershell -NoProfile -Command \"$1\"" 2>&1 | tr -d '\r'; }
case "$1" in
  move|tilt|pan)
    if [ "$1" = tilt ]; then yaw=0; pitch=$2; ms=$3; fi
    if [ "$1" = pan ]; then yaw=$2; pitch=0; ms=$3; fi
    if [ "$1" = move ]; then yaw=$2; pitch=$3; ms=$4; fi
    ssh_ps "\$b='$B'; Invoke-RestMethod -Method Post -Uri (\$b+'/ptz/gimbalcontrol') -Body (@{stop=\$false;pitch=$pitch;roll=0;yaw=$yaw}|ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 4|Out-Null; Start-Sleep -Milliseconds $ms; Invoke-RestMethod -Method Post -Uri (\$b+'/ptz/gimbalcontrol') -Body (@{stop=\$true;pitch=0;roll=0;yaw=0}|ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 4|Out-Null; 'moved yaw=$yaw pitch=$pitch ${ms}ms'"
    ;;
  zoom)
    ssh_ps "\$b='$B'; Invoke-RestMethod -Method Put -Uri (\$b+'/ptz/zoom') -Body (@{ratio=$2;speed=8}|ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 4|Out-Null; Start-Sleep -Milliseconds 2000; 'zoom='+((Invoke-RestMethod (\$b+'/ptz/zoom') -TimeoutSec 3).ratio)"
    ;;
  home)
    ssh_ps "\$b='$B'; Invoke-RestMethod -Method Put -Uri (\$b+'/ai/workmode') -Body (@{mode='none'}|ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 4|Out-Null; Start-Sleep -Milliseconds 600; Invoke-RestMethod -Method Put -Uri (\$b+'/ptz/preset') -Body (@{operation='call';id=1}|ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 4|Out-Null; Start-Sleep -Milliseconds 2200; 'home, zoom='+((Invoke-RestMethod (\$b+'/ptz/zoom') -TimeoutSec 3).ratio)"
    ;;
  aioff)
    ssh_ps "\$b='$B'; Invoke-RestMethod -Method Put -Uri (\$b+'/ai/workmode') -Body (@{mode='none'}|ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 4|Out-Null; 'ai off'"
    ;;
  frame)
    # combined: gimbal move (yaw pitch ms) + absolute zoom (ratio,speed) in ONE ssh
    yaw=$2; pitch=$3; ms=$4; ratio=$5; zspeed=${6:-3}
    ssh_ps "\$b='$B'; Invoke-RestMethod -Method Post -Uri (\$b+'/ptz/gimbalcontrol') -Body (@{stop=\$false;pitch=$pitch;roll=0;yaw=$yaw}|ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 4|Out-Null; Invoke-RestMethod -Method Put -Uri (\$b+'/ptz/zoom') -Body (@{ratio=$ratio;speed=$zspeed}|ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 4|Out-Null; Start-Sleep -Milliseconds $ms; Invoke-RestMethod -Method Post -Uri (\$b+'/ptz/gimbalcontrol') -Body (@{stop=\$true;pitch=0;roll=0;yaw=0}|ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 4|Out-Null; 'frame yaw=$yaw pitch=$pitch z=$ratio'"
    ;;
  state)
    ssh_ps "\$b='$B'; function g(\$p){try{Invoke-RestMethod (\$b+\$p) -TimeoutSec 3}catch{\$null}}; 'wm='+(g '/ai/workmode').mode+' zt='+(g '/ai/human/zoomtype').type+' zoom='+(g '/ptz/zoom').ratio+' expmode='+(g '/image/exposure/mode').mode"
    ;;
esac
