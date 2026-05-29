import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from '@elgato/streamdeck'
import * as conn from '../connection'
import * as svg from '../svg'

// Two full-screen feature-card buttons:
//   - UP NEXT: pre-routine large-format graphic
//   - THAT WAS: post-routine large-format graphic
// BB owns the canonical visible state; we optimistically flip a local label on
// press. The next state push from BB will correct any drift.

let upNextActive = false
let thatWasActive = false

function imgFor(mode: 'upNext' | 'thatWas', active: boolean): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg.featureCard(mode, active)).toString('base64')}`
}

@action({ UUID: 'com.broadcastbuddy.streamdeck.feature-up-next' })
export class FeatureUpNextAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    await ev.action.setImage(imgFor('upNext', upNextActive))
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('featureUpNext')
    upNextActive = true
    thatWasActive = false
    await ev.action.setImage(imgFor('upNext', upNextActive))
  }
}

@action({ UUID: 'com.broadcastbuddy.streamdeck.feature-that-was' })
export class FeatureThatWasAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    await ev.action.setImage(imgFor('thatWas', thatWasActive))
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    conn.sendCommand('featureThatWas')
    thatWasActive = true
    upNextActive = false
    await ev.action.setImage(imgFor('thatWas', thatWasActive))
  }
}
