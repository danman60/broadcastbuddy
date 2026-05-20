import streamDeck from '@elgato/streamdeck'
import * as conn from './connection'

import { FireAction } from './actions/fire'
import { HideAction } from './actions/hide'
import { ToggleLTAction } from './actions/toggle-lt'
import { NextAction } from './actions/next'
import { PrevAction } from './actions/prev'
import { NextFullAction } from './actions/next-full'
import { ToggleTickerAction } from './actions/toggle-ticker'
import { UpNextAction } from './actions/up-next'
import { ThatWasAction } from './actions/that-was'
import { ToggleGridAction } from './actions/toggle-grid'
import { SlowZoomWideAction, SlowZoomTightAction } from './actions/slow-zoom'

streamDeck.actions.registerAction(new FireAction())
streamDeck.actions.registerAction(new HideAction())
streamDeck.actions.registerAction(new ToggleLTAction())
streamDeck.actions.registerAction(new NextAction())
streamDeck.actions.registerAction(new PrevAction())
streamDeck.actions.registerAction(new NextFullAction())
streamDeck.actions.registerAction(new ToggleTickerAction())
streamDeck.actions.registerAction(new UpNextAction())
streamDeck.actions.registerAction(new ThatWasAction())
streamDeck.actions.registerAction(new ToggleGridAction())
streamDeck.actions.registerAction(new SlowZoomWideAction())
streamDeck.actions.registerAction(new SlowZoomTightAction())

// Property inspector saves the BB host/port as global settings. Apply them on
// boot and whenever they change so the operator can point the plugin at a
// remote BB box without re-installing the plugin.
interface BbGlobalSettings { bbHost?: string; bbPort?: number }
streamDeck.settings.onDidReceiveGlobalSettings<BbGlobalSettings>((ev) => {
  const s = ev.settings || {}
  conn.setHostPort(s.bbHost, s.bbPort ? Number(s.bbPort) : undefined)
})

conn.connect()
streamDeck.connect()
// Pull any saved host/port once the SDK link is up.
void streamDeck.settings.getGlobalSettings()
