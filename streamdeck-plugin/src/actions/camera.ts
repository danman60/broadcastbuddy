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

// ── Camera POSITION hotkeys: recall saved OBSBOT presets (positions) 1-6 ──────
// Each maps to wsHub 'cameraPreset' {id} -> recallCameraPreset(id) (same path as
// the in-app preset grid). Operator saves a position to a preset slot, deck recalls it.
class CameraPosBase extends SingletonAction {
  protected n = 0
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async () => {
      const img = svg.cameraPos(this.n, conn.isConnected())
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('cameraPreset', { id: this.n })
    await ev.action.showOk()
  }
}
@action({ UUID: 'com.broadcastbuddy.streamdeck.camera-pos-1' })
export class CameraPos1Action extends CameraPosBase { protected n = 1 }
@action({ UUID: 'com.broadcastbuddy.streamdeck.camera-pos-2' })
export class CameraPos2Action extends CameraPosBase { protected n = 2 }
@action({ UUID: 'com.broadcastbuddy.streamdeck.camera-pos-3' })
export class CameraPos3Action extends CameraPosBase { protected n = 3 }
@action({ UUID: 'com.broadcastbuddy.streamdeck.camera-pos-4' })
export class CameraPos4Action extends CameraPosBase { protected n = 4 }
@action({ UUID: 'com.broadcastbuddy.streamdeck.camera-pos-5' })
export class CameraPos5Action extends CameraPosBase { protected n = 5 }
@action({ UUID: 'com.broadcastbuddy.streamdeck.camera-pos-6' })
export class CameraPos6Action extends CameraPosBase { protected n = 6 }

// ── Custom choreographed MOVES (sweep preset A -> B over ~6s) ─────────────────
@action({ UUID: 'com.broadcastbuddy.streamdeck.audience-sweep' })
export class AudienceSweepAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async () => {
      const img = svg.cameraSweep('AUDIENCE', conn.isConnected())
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('cameraSweep', { from: 2, to: 3, ms: 6000 })
    await ev.action.showOk()
  }
}
@action({ UUID: 'com.broadcastbuddy.streamdeck.stage-sweep' })
export class StageSweepAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async () => {
      const img = svg.cameraSweep('STAGE', conn.isConnected())
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('cameraSweep', { from: 4, to: 5, ms: 6000 })
    await ev.action.showOk()
  }
}
