import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from '@elgato/streamdeck'
import * as conn from '../connection'
import * as svg from '../svg'

// ── OBSBOT PTZ deck buttons: Wide-safe / AUTO / MANUAL ──────────────────────
// Each maps to a wsHub command consumed by BroadcastBuddy:
//   cameraWide   -> goHomeViaCamera() (recall the safe wide Home preset, AI off)
//   cameraAuto   -> setCameraAutoMode(true)  (AI tracking on)
//   cameraManual -> setCameraAutoMode(false) (AI off, return to wide)

@action({ UUID: 'com.broadcastbuddy.streamdeck.camera-wide' })
export class CameraWideAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async () => {
      const img = svg.cameraWide(conn.isConnected())
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('cameraWide')
    await ev.action.showOk()
  }
}

@action({ UUID: 'com.broadcastbuddy.streamdeck.camera-auto' })
export class CameraAutoAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async () => {
      const img = svg.cameraMode('AUTO', conn.isConnected())
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('cameraAuto')
    await ev.action.showOk()
  }
}

@action({ UUID: 'com.broadcastbuddy.streamdeck.camera-manual' })
export class CameraManualAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async () => {
      const img = svg.cameraMode('MANUAL', conn.isConnected())
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('cameraManual')
    await ev.action.showOk()
  }
}
