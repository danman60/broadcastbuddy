import * as session from './services/session'
import * as settings from './services/settings'
import * as obsConnection from './services/obsConnection'
import * as events from './services/events'
import { logger } from './ipc/common'
import { registerOverlayHandlers, registerLogoTickerHandlers, registerStartingSoonHandlers, registerOverlayExtrasHandlers } from './ipc/overlay'
import { registerTriggerSessionHandlers, registerStreamConfigNoteHandlers } from './ipc/triggers-session'
import { registerSettingsHandlers, registerPresetHandlers } from './ipc/settings'
import { pushStreamSettingsToObs, registerObsConnectionHandlers, registerObsRecordingHandlers, registerRecordingFileHandlers, registerSlowZoomHandlers, registerTransitionHandlers } from './ipc/obs-record'
import { registerSystemPluginHandlers, registerImportBrandHandlers, registerWindowMediaHandlers, registerChecklistEventHandlers, registerPanelHandlers } from './ipc/misc'
import { registerPackageHandlers, registerChatRelayHandlers } from './ipc/integrations'
import { registerCameraConnectionHandlers, registerCameraControlHandlers } from './ipc/camera'
import { registerVoiceHandlers } from './ipc/voice'
import { registerRecoveryHandlers } from './ipc/recovery'

export { pushState } from './ipc/common'
export { pushStreamSettingsToObs } from './ipc/obs-record'


// Push the saved streamConfig to OBS whenever OBS (re)connects, covering the case
// where an event/package was applied before OBS was up. Registered once at startup.
obsConnection.onConnected(() => {
  try {
    const cfg = settings.get('streamConfig')
    if (cfg?.rtmpUrl && cfg?.streamKey) {
      pushStreamSettingsToObs(cfg.rtmpUrl, cfg.streamKey, {
        event: session.getCurrentSession()?.name || '',
      })
        .then((r) => {
          if (r.success) {
            events.recordEvent(
              'obs',
              r.verified
                ? 'Auto-pushed + verified stream key in OBS on connect'
                : `Auto-pushed stream key on connect but verify failed: ${r.error}`,
            )
          } else {
            events.recordEvent('error', `Auto-push stream key on connect failed: ${r.error}`)
          }
        })
        .catch((err) =>
          events.recordEvent('error', `Auto-push stream key on connect threw: ${(err as Error).message}`),
        )
    }
  } catch (err) {
    events.recordEvent('error', `Auto-push stream key on connect threw: ${(err as Error).message}`)
  }
})

// Keep registration and startup callback order identical to the original entry point.
export function registerIpcHandlers(): void {
  registerOverlayHandlers()
  registerTriggerSessionHandlers()
  registerSettingsHandlers()
  registerLogoTickerHandlers()
  registerStreamConfigNoteHandlers()
  registerObsConnectionHandlers()
  registerSystemPluginHandlers()
  registerObsRecordingHandlers()
  registerStartingSoonHandlers()
  registerPackageHandlers()
  registerRecordingFileHandlers()
  registerImportBrandHandlers()
  registerPresetHandlers()
  registerWindowMediaHandlers()
  registerSlowZoomHandlers()
  registerCameraConnectionHandlers()
  registerVoiceHandlers()
  registerCameraControlHandlers()
  registerTransitionHandlers()
  registerOverlayExtrasHandlers()
  registerChatRelayHandlers()
  registerChecklistEventHandlers()
  registerRecoveryHandlers()
  registerPanelHandlers()

  logger.info('IPC handlers registered')
}
