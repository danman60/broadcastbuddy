import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from '@elgato/streamdeck'
import * as conn from '../connection'
import * as svg from '../svg'

// Toggle the counter overlay. BB's pushed state does not yet carry a counter
// flag, so the button renders the idle face and confirms presses with showOk().
@action({ UUID: 'com.broadcastbuddy.streamdeck.counter' })
export class CounterAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const img = conn.isConnected() ? svg.overlayToggle('CTR', false) : svg.offline()
    await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('toggleCounter')
    await ev.action.showOk()
  }
}
