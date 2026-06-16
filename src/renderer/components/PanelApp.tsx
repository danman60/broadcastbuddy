import React from 'react'
import { PanelChrome } from './PanelChrome'
import { ErrorBoundary } from './ErrorBoundary'
import { OverlayControls } from './OverlayControls'
import { AdhocPanel } from './AdhocPanel'
import { ChatPanel } from './ChatPanel'
import { CameraPanel } from './CameraPanel'
import { SystemStats } from './SystemStats'

interface PanelAppProps {
  panelId: string
}

const TITLES: Record<string, string> = {
  overlays: 'Overlay Controls',
  adhoc: 'Ad-hoc Lower Third',
  chat: 'Operator Chat',
  camera: 'Camera',
  system: 'System',
}

export function PanelApp({ panelId }: PanelAppProps): React.ReactElement {
  const title = TITLES[panelId] ?? 'Panel'

  // Per spec: only the System panel carries the Exit Overlay button.
  const showExit = panelId === 'system'

  let content: React.ReactElement
  switch (panelId) {
    case 'overlays':
      content = <OverlayControls />
      break
    case 'adhoc':
      content = <AdhocPanel />
      break
    case 'chat':
      content = <ChatPanel />
      break
    case 'camera':
      content = <CameraPanel />
      break
    case 'system':
      content = <SystemStats />
      break
    default:
      content = <div style={{ padding: 12, color: 'var(--text-dim)' }}>Unknown panel: {panelId}</div>
  }

  return (
    <PanelChrome title={title} panelId={panelId} showExit={showExit}>
      <ErrorBoundary>
        {content}
      </ErrorBoundary>
    </PanelChrome>
  )
}
