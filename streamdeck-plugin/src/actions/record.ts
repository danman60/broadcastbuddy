import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from '@elgato/streamdeck'
import * as conn from '../connection'
import * as svg from '../svg'

// Toggle OBS recording via the BB WS hub. BB's pushed state does not yet carry
// a recording flag, so the button shows its idle face and confirms presses with
// showOk(). The hub fails soft when OBS is disconnected.
@action({ UUID: 'com.broadcastbuddy.streamdeck.record' })
export class RecordAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const img = conn.isConnected() ? svg.record(false) : svg.offline()
    await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('toggleRecord')
    await ev.action.showOk()
  }
}
