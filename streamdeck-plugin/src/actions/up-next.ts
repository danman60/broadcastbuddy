import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from '@elgato/streamdeck'
import * as conn from '../connection'
import * as svg from '../svg'

@action({ UUID: 'com.broadcastbuddy.streamdeck.up-next' })
export class UpNextAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async () => {
      const img = svg.upNext(conn.isConnected())
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('upNext')
    await ev.action.showOk()
  }
}
