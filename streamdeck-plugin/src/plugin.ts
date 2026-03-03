import streamDeck from '@elgato/streamdeck'
import * as conn from './connection'

import { FireAction } from './actions/fire'
import { HideAction } from './actions/hide'
import { ToggleLTAction } from './actions/toggle-lt'
import { NextAction } from './actions/next'
import { PrevAction } from './actions/prev'
import { NextFullAction } from './actions/next-full'
import { ToggleTickerAction } from './actions/toggle-ticker'

streamDeck.actions.registerAction(new FireAction())
streamDeck.actions.registerAction(new HideAction())
streamDeck.actions.registerAction(new ToggleLTAction())
streamDeck.actions.registerAction(new NextAction())
streamDeck.actions.registerAction(new PrevAction())
streamDeck.actions.registerAction(new NextFullAction())
streamDeck.actions.registerAction(new ToggleTickerAction())

conn.connect()
streamDeck.connect()
