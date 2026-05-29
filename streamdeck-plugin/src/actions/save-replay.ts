import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from '@elgato/streamdeck'
import * as conn from '../connection'
import * as svg from '../svg'

// Save the OBS replay-buffer clip. Flashes green on press, then settles back.
@action({ UUID: 'com.broadcastbuddy.streamdeck.save-replay' })
export class SaveReplayAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(svg.replay(false)).toString('base64')}`)
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('saveReplay')
    await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(svg.replay(true)).toString('base64')}`)
    setTimeout(async () => {
      await ev.action.setImage(`data:image/svg+xml;base64,${Buffer.from(svg.replay(false)).toString('base64')}`)
    }, 1500)
  }
}
