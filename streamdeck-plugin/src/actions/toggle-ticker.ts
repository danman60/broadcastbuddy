import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from '@elgato/streamdeck'
import * as conn from '../connection'
import * as svg from '../svg'

@action({ UUID: 'com.broadcastbuddy.streamdeck.toggle-ticker' })
export class ToggleTickerAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async (state) => {
      if (!conn.isConnected()) {
        await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(svg.offline()).toString('base64')}`)
        return
      }
      const img = svg.ticker(state.overlay.ticker.visible)
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('toggleTicker')
    await ev.action.showOk()
  }
}
