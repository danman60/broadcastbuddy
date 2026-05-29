import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from '@elgato/streamdeck'
import * as conn from '../connection'
import * as svg from '../svg'

// Toggle OBS streaming via the BB WS hub. The hub reads getStreamStatus() and
// starts/stops accordingly, failing soft when OBS is disconnected.
@action({ UUID: 'com.broadcastbuddy.streamdeck.stream' })
export class StreamAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const img = conn.isConnected() ? svg.stream(false) : svg.offline()
    await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('toggleStream')
    await ev.action.showOk()
  }
}
