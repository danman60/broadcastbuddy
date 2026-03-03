import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from '@elgato/streamdeck'
import * as conn from '../connection'
import * as svg from '../svg'

@action({ UUID: 'com.broadcastbuddy.streamdeck.fire' })
export class FireAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async (state) => {
      if (!conn.isConnected()) {
        await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(svg.offline()).toString('base64')}`)
        return
      }
      const img = svg.fire(state.overlay.lowerThird.visible)
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('fireLT')
    await ev.action.showOk()
  }
}
