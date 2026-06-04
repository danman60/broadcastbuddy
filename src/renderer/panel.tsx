import React from 'react'
import ReactDOM from 'react-dom/client'
import { PanelApp } from './components/PanelApp'
import { initStoreListeners, loadInitialState } from './store/useStore'
import './styles/global.css'
import './styles/panels.css'

const params = new URLSearchParams(window.location.search)
const panelId = params.get('panel') ?? 'overlays'

// Each panel is a full secondary renderer with its own contextBridge `api`.
// Subscribe to the same main→renderer state pushes the main window uses, then
// pull the initial snapshot so the hosted component (OverlayControls, etc.)
// populates immediately instead of waiting for the next change tick.
if (window.api) {
  initStoreListeners()
  loadInitialState().catch(() => { /* ignore — panel still renders */ })
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    <PanelApp panelId={panelId} />
  </React.StrictMode>,
)
