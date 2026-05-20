import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from '@elgato/streamdeck'
import * as conn from '../connection'
import * as svg from '../svg'

@action({ UUID: 'com.broadcastbuddy.streamdeck.slow-zoom-wide' })
export class SlowZoomWideAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async () => {
      const img = svg.slowZoom('Wide', conn.isConnected())
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('slowZoomWide')
    await ev.action.showOk()
  }
}

@action({ UUID: 'com.broadcastbuddy.streamdeck.slow-zoom-tight' })
export class SlowZoomTightAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    conn.onState(async () => {
      const img = svg.slowZoom('Tight', conn.isConnected())
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(img).toString('base64')}`)
    })
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('slowZoomTight')
    await ev.action.showOk()
  }
}
