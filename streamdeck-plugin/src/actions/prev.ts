import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from '@elgato/streamdeck'
import * as conn from '../connection'
import * as svg from '../svg'

@action({ UUID: 'com.broadcastbuddy.streamdeck.prev' })
export class PrevAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async (state) => {
      if (!conn.isConnected()) {
        await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(svg.offline()).toString('base64')}`)
        return
      }
      const current = state.playlist?.current ?? 0
      const total = state.playlist?.total ?? 0
      const img = svg.prev(current, total)
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('prevTrigger')
    await ev.action.showOk()
  }
}
