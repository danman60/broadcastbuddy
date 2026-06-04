import React from 'react'

interface PanelChromeProps {
  title: string
  panelId: string
  showExit?: boolean
  children: React.ReactNode
}

/**
 * Shared frame for every Overlay Mode panel. Provides the drag region (the
 * titlebar), a per-panel hide button, and an optional Exit Overlay button
 * (only on the System panel per spec) that tears down Overlay Mode and
 * restores the main window. Ported from CompSyncElectronApp PanelChrome.
 */
export function PanelChrome({ title, panelId, showExit = false, children }: PanelChromeProps): React.ReactElement {
  async function handleExit(): Promise<void> {
    try { await window.api.overlayModeClose() } catch { /* ignore */ }
  }

  async function handleHidePanel(): Promise<void> {
    try { await window.api.overlayModeHidePanel(panelId) } catch { /* ignore */ }
  }

  return (
    <div className="panel-root">
      <div className="panel-titlebar">
        <span className="panel-title">{title}</span>
        <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center' }}>
          <button
            className="panel-hide-btn"
            onClick={handleHidePanel}
            title="Hide this panel until Overlay Mode is opened again"
          >
            X
          </button>
          {showExit && (
            <button
              className="panel-exit-btn"
              onClick={handleExit}
              title="Exit Overlay Mode"
            >
              Exit Overlay
            </button>
          )}
        </div>
      </div>
      <div className="panel-body">
        {children}
      </div>
      <div className="panel-resize-corner" />
    </div>
  )
}
