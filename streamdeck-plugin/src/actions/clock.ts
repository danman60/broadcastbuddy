import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from '@elgato/streamdeck'
import * as conn from '../connection'
import * as svg from '../svg'

// Toggle the on-air clock overlay. BB's pushed state does not yet carry a clock
// flag, so the button renders the idle face and confirms presses with showOk().
@action({ UUID: 'com.broadcastbuddy.streamdeck.clock' })
export class ClockAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const img = conn.isConnected() ? svg.overlayToggle('CLK', false) : svg.offline()
    await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('toggleClock')
    await ev.action.showOk()
  }
}
