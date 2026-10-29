import { ipcMain } from 'electron'
import { IPC } from '../../shared/types'
import * as overlay from '../services/overlay'
import * as settings from '../services/settings'
import { saveHomeViaCamera, goHomeViaCamera, probeCameraConnection, nudgeCamera, zoomCamera, recenterCamera, recallCameraPreset, saveCameraPreset, deleteCameraPreset, setCameraTrackingSpeed, setCameraImageControl, type CameraImageControl, setCameraControl, type CameraControl, setCameraAutoMode, nudgeCameraXY, zoomCameraVelocity, setCameraAiEnable, getCameraState, discoverCamera, resetCameraConnection, setActiveCamera, nudgeCameraXYFor, zoomCameraVelocityFor, slowZoomPushFor, recallCameraPresetFor, stopAllCameraMotionFor, setCameraAiEnableFor, getCameraPresetIds, sweepWaypoints } from '../services/cameraDirector'
import * as shotRecorder from '../services/shotRecorder'

export function registerCameraConnectionHandlers(): void {

  // ── OBSBOT camera safety (guarded — no-op unless cameraHost is set) ────────
  // Fire-and-forget: the helpers run detached + try/catch and never throw, so
  // these handlers just invoke and acknowledge.
  ipcMain.handle(IPC.CAMERA_SET_HOME, () => {
    saveHomeViaCamera()
    return { ok: true }
  })

  ipcMain.handle(IPC.CAMERA_GO_HOME, () => {
    goHomeViaCamera()
    return { ok: true }
  })

  // ── OBSBOT camera — connection probe + manual control (guarded; no-op unless
  // the camera feature is active). Helpers run detached + try/catch and never
  // throw, so these handlers invoke and acknowledge. NO UI yet (later wave).
  ipcMain.handle(IPC.CAMERA_PROBE, async () => {
    return probeCameraConnection()
  })

  // Auto-discovery: scan local subnets for the OBSBOT. On a hit, persist it as the
  // camera host and drop any stale Director so the next action reconnects to the
  // new IP. Returns the discovery result for the renderer to reflect.
  ipcMain.handle(IPC.CAMERA_DISCOVER, async () => {
    const result = await discoverCamera()
    if (result.found && result.host) {
      settings.set('cameraHost', result.host)
      resetCameraConnection()
    }
    return result
  })

  // Re-apply the current routine's full framing/tracking config (operator flipped
  // AUTO on). Guarded inside applyRoutineForTrigger (no-op unless auto + host).
  ipcMain.handle(IPC.CAMERA_APPLY_CURRENT, () => {
    overlay.applyCurrentRoutineFraming()
    return { ok: true }
  })

  // Multi-cam: select which PTZ (1|2) the manual/Xbox/deck controls drive.
  ipcMain.handle(IPC.CAMERA_SELECT, (_e, args: { id: number }) => {
    const active = setActiveCamera(args?.id)
    return { ok: true, active }
  })
}

export function registerCameraControlHandlers(): void {

  // ── Per-camera PTZ (dual-Xbox: left stick→cam1, right stick→cam2) ───────────
  ipcMain.handle(IPC.CAMERA_NUDGE_XY_FOR, (_e, a: { camera: 1 | 2; yaw: number; pitch: number; stop?: boolean }) => {
    nudgeCameraXYFor(a.camera, a.yaw, a.pitch, a.stop)
    return { ok: true }
  })
  ipcMain.handle(IPC.CAMERA_ZOOM_VELOCITY_FOR, (_e, a: { camera: 1 | 2; dir: 'in' | 'out'; speed: number; stop?: boolean }) => {
    zoomCameraVelocityFor(a.camera, a.dir, a.speed, a.stop)
    return { ok: true }
  })
  ipcMain.handle(IPC.CAMERA_SLOW_ZOOM_FOR, (_e, a: { camera: 1 | 2; ms?: number; factor?: number }) => {
    slowZoomPushFor(a.camera, a.ms && a.ms > 0 ? a.ms : 10000, a.factor && a.factor > 0 ? a.factor : 1.5)
    return { ok: true }
  })
  ipcMain.handle(IPC.CAMERA_RECALL_PRESET_FOR, (_e, a: { camera: 1 | 2; n: number }) => {
    recallCameraPresetFor(a.camera, a.n)
    return { ok: true }
  })
  ipcMain.handle(IPC.CAMERA_STOP_FOR, (_e, a: { camera: 1 | 2 }) => {
    stopAllCameraMotionFor(a.camera)
    return { ok: true }
  })
  ipcMain.handle(IPC.CAMERA_SET_AI_ENABLE_FOR, (_e, a: { camera: 1 | 2; on: boolean }) => {
    setCameraAiEnableFor(a.camera, a.on)
    return { ok: true }
  })
  ipcMain.handle(IPC.CAMERA_PRESET_IDS, async (_e, a: { camera: 1 | 2 }) => {
    return getCameraPresetIds(a?.camera === 2 ? 2 : 1)
  })
  ipcMain.handle(IPC.CAMERA_SWEEP_WAYPOINTS, (_e, a: { ids: number[]; ms?: number }) => {
    sweepWaypoints(a?.ids ?? [], a?.ms && a.ms > 0 ? a.ms : 6000)
    return { ok: true }
  })

  // ── Shot recorder (motion record/replay) ───────────────────────────────────
  ipcMain.handle(IPC.SHOT_RECORD_TOGGLE, (_e, a?: { label?: string }) => {
    if (shotRecorder.getState().recording) return { ok: true, move: shotRecorder.stopRecording(a?.label) }
    shotRecorder.startRecording()
    return { ok: true, move: null }
  })
  ipcMain.handle(IPC.SHOT_REPLAY, (_e, a: { id: number }) => {
    shotRecorder.replayMove(a.id)
    return { ok: true }
  })
  ipcMain.handle(IPC.SHOT_DELETE, (_e, a: { id: number }) => {
    shotRecorder.deleteMove(a.id)
    return { ok: true }
  })
  ipcMain.handle(IPC.SHOT_RENAME, (_e, a: { id: number; label: string }) => {
    shotRecorder.renameMove(a.id, a.label)
    return { ok: true }
  })
  ipcMain.handle(IPC.SHOT_GET, () => {
    return { state: shotRecorder.getState(), moves: shotRecorder.getMoves() }
  })

  ipcMain.handle(
    IPC.CAMERA_NUDGE,
    (_e, args: { dir: 'up' | 'down' | 'left' | 'right'; speed: number; stop?: boolean }) => {
      nudgeCamera(args.dir, args.speed, args.stop)
      return { ok: true }
    },
  )

  ipcMain.handle(IPC.CAMERA_ZOOM, (_e, args: { target: number; speed: number }) => {
    zoomCamera(args.target, args.speed)
    return { ok: true }
  })

  ipcMain.handle(IPC.CAMERA_RECENTER, () => {
    recenterCamera()
    return { ok: true }
  })

  ipcMain.handle(IPC.CAMERA_RECALL_PRESET, (_e, args: { n: number }) => {
    recallCameraPreset(args.n)
    return { ok: true }
  })

  ipcMain.handle(IPC.CAMERA_SAVE_PRESET, (_e, args: { id: number; name?: string }) => {
    saveCameraPreset(args.id, args.name)
    return { ok: true }
  })

  ipcMain.handle(IPC.CAMERA_DELETE_PRESET, (_e, args: { id: number }) => {
    deleteCameraPreset(args.id)
    return { ok: true }
  })

  ipcMain.handle(IPC.CAMERA_SET_AUTO_MODE, async (_e, args: { on: boolean }) => {
    return setCameraAutoMode(args.on)
  })

  ipcMain.handle(IPC.CAMERA_SET_TRACKING_SPEED, (_e, args: { mode: number }) => {
    setCameraTrackingSpeed(args.mode)
    return { ok: true }
  })

  ipcMain.handle(IPC.CAMERA_IMAGE_CONTROL, (_e, args: CameraImageControl) => {
    setCameraImageControl(args)
    return { ok: true }
  })

  ipcMain.handle(IPC.CAMERA_CONTROL, (_e, args: CameraControl) => {
    setCameraControl(args)
    return { ok: true }
  })

  // ── OBSBOT camera — PTZ control panel (Wave 2/3) ──────────────────────────
  // High-rate joystick/gamepad path. nudgeCameraXY fires detached (the helper
  // does NOT await camera I/O), so this handler stays cheap under the ~10Hz
  // invoke loop. All guarded — no-op when the camera feature is inactive.
  ipcMain.handle(
    IPC.CAMERA_NUDGE_XY,
    (_e, args: { yaw: number; pitch: number; stop?: boolean }) => {
      nudgeCameraXY(args.yaw, args.pitch, args.stop)
      return { ok: true }
    },
  )

  ipcMain.handle(
    IPC.CAMERA_ZOOM_VELOCITY,
    (_e, args: { dir: 'in' | 'out'; speed: number; stop?: boolean }) => {
      zoomCameraVelocity(args.dir, args.speed, args.stop)
      return { ok: true }
    },
  )

  ipcMain.handle(IPC.CAMERA_SET_AI_ENABLE, (_e, args: { on: boolean }) => {
    setCameraAiEnable(args.on)
    return { ok: true }
  })

  // Live gimbal/zoom readout for the panel status. Never throws.
  ipcMain.handle(IPC.CAMERA_GET_STATE, async () => {
    return getCameraState()
  })
}
