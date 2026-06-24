import { action, KeyDownEvent, KeyUpEvent, SingletonAction, WillAppearEvent } from '@elgato/streamdeck'
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

// ── PTZ slow optical PUSH IN (10s, from current zoom, keeps AI tracking) ───────
// cameraSlowZoom -> slowZoomPush(ms): closed-loop optical zoom ramp on the OBSBOT.
// This is the PTZ camera zoom, NOT the OBS Move-Transition slow-zoom. Press again
// to cancel an in-flight push.
@action({ UUID: 'com.broadcastbuddy.streamdeck.camera-slow-zoom' })
export class CameraSlowZoomAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async () => {
      const img = svg.cameraPush(conn.isConnected())
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('cameraSlowZoom', { ms: 10000, factor: 1.5 })
    await ev.action.showOk()
  }
}

// ── Multi-camera: select which PTZ the controls/Xbox drive (1 or 2) ────────────
@action({ UUID: 'com.broadcastbuddy.streamdeck.camera-select-1' })
export class CameraSelect1Action extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async () => {
      const img = svg.cameraSelect(1, conn.isConnected())
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('cameraSelect', { id: 1 })
    await ev.action.showOk()
  }
}
@action({ UUID: 'com.broadcastbuddy.streamdeck.camera-select-2' })
export class CameraSelect2Action extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async () => {
      const img = svg.cameraSelect(2, conn.isConnected())
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('cameraSelect', { id: 2 })
    await ev.action.showOk()
  }
}

// ── Voice PUSH-TO-TALK: hold to open the mic, release to run the command ───────
// Unlike every other action here this overrides BOTH onKeyDown and onKeyUp:
//   keyDown -> voicePttDown (wsHub opens the BB voice mic and starts listening)
//   keyUp   -> voicePttUp   (wsHub stops listening and runs the recognized PTZ cmd)
// The deck always delivers a keyUp for any key that received a keyDown, so the
// mic can never be left open. The face redraws held/idle on each transition.
@action({ UUID: 'com.broadcastbuddy.streamdeck.voice-hold' })
export class VoiceHoldAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async () => {
      const img = svg.voiceHold(conn.isConnected())
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('voicePttDown')
    const img = svg.voiceHold(conn.isConnected(), true)
    await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
  }
  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    conn.sendCommand('voicePttUp')
    const img = svg.voiceHold(conn.isConnected())
    await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    await ev.action.showOk()
  }
}
