import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from '@elgato/streamdeck'
import * as conn from '../connection'
import * as svg from '../svg'

// Cycle the lower-third entrance animation/transition (parity with CompSync).
// BB's wsHub handles `cycleTransition` by advancing styling.animation.
@action({ UUID: 'com.broadcastbuddy.streamdeck.cycle-transition' })
export class CycleTransitionAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const img = conn.isConnected() ? svg.overlayToggle('TRANS', false) : svg.offline()
    await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('cycleTransition')
    await ev.action.showOk()
  }
}
