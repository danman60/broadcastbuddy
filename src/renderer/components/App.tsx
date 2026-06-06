import { useEffect, useCallback, useRef } from 'react'
import { useStore, initStoreListeners, loadInitialState } from '../store/useStore'
import { Header } from './Header'
import { TriggerList } from './TriggerList'
import { OverlayPreview } from './OverlayPreview'
import { TriggerEditor } from './TriggerEditor'
import { OverlayControls } from './OverlayControls'
import { AdhocPanel } from './AdhocPanel'
import { AnimationPanel } from './AnimationPanel'
import { StylingPanel } from './StylingPanel'
import { LogoManager } from './LogoManager'
import { ImportPanel } from './ImportPanel'
import { TemplateGallery } from './TemplateGallery'
import { TickerControls } from './TickerControls'
import { BrandScraperPanel } from './BrandScraperPanel'
import { StreamInfoPanel } from './StreamInfoPanel'
import { NotesPanel } from './NotesPanel'
import { StartingSoonPanel } from './StartingSoonPanel'
import { BroadcastPackagePanel } from './BroadcastPackagePanel'
import { RecordingUploadPanel } from './RecordingUploadPanel'
import { GalleryPanel } from './GalleryPanel'
import { ChatPanel } from './ChatPanel'
import { EventLogPanel } from './EventLogPanel'
import { RecoveryBanner } from './RecoveryBanner'
import { StartupToast } from './StartupToast'
import { Settings } from './Settings'
import { VisualEditor } from './VisualEditor'
import { StartingSoonEditor } from './StartingSoonEditor'
import { DayChecklist } from './DayChecklist'
import '../styles/app.css'

export function App() {
  const showSettings = useStore((s) => s.showSettings)
  const showBrandKit = useStore((s) => s.showBrandKit)
  const showImport = useStore((s) => s.showImport)
  const compactMode = useStore((s) => s.compactMode)
  const leftPanelWidth = useStore((s) => s.leftPanelWidth)
  const showVisualEditor = useStore((s) => s.showVisualEditor)
  const showStartingSoonEditor = useStore((s) => s.showStartingSoonEditor)
  const draggingRef = useRef(false)

  // Drag the divider to resize the left (playlist) panel. We mutate the DOM
  // width live during the drag for smoothness and commit to the store (which
  // persists + clamps) on mouseup — avoids a store write per mousemove frame.
  const onResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    const startX = e.clientX
    const startWidth = useStore.getState().leftPanelWidth
    const panel = document.querySelector('.left-panel') as HTMLElement | null
    const handle = e.currentTarget as HTMLElement
    handle.classList.add('dragging')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return
      const next = Math.max(220, Math.min(600, startWidth + (ev.clientX - startX)))
      if (panel) panel.style.width = `${next}px`
    }
    const onUp = (ev: MouseEvent) => {
      draggingRef.current = false
      handle.classList.remove('dragging')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      const next = Math.max(220, Math.min(600, startWidth + (ev.clientX - startX)))
      useStore.getState().setLeftPanelWidth(next)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  useEffect(() => {
    initStoreListeners()
    loadInitialState()
    // Auto-show the start-of-day checklist on the first launch of a new
    // calendar day. The main process stamps "last shown" so this fires once.
    window.api.dayChecklistShouldShow().then((r) => {
      if (r?.should) useStore.getState().setShowDayChecklist('start')
    }).catch(() => { /* ignore */ })
  }, [])

  return (
    <div className={`app-layout${compactMode ? ' compact' : ''}`}>
      <Header />
      <div className="app-body">
        <div
          className="left-panel"
          style={{ width: compactMode ? 200 : leftPanelWidth }}
        >
          <TriggerList />
          <OverlayPreview />
        </div>
        {!compactMode && (
          <div
            className="panel-resizer"
            onMouseDown={onResizerMouseDown}
            title="Drag to resize the playlist panel"
          />
        )}
        <div className="right-panel">
          <div className="panel-group-label">Live Control</div>
          <div className="live-control-grid">
            <OverlayControls />
            <div className="live-control-stack">
              <TriggerEditor />
              <AdhocPanel />
            </div>
          </div>
          <div className="panel-group-label">Content &amp; Styling</div>
          <AnimationPanel />
          <StartingSoonPanel />
          <TemplateGallery />
          <StylingPanel />
          <LogoManager />
          <TickerControls />
          <div className="panel-group-label">Broadcast &amp; Delivery</div>
          <StreamInfoPanel />
          <NotesPanel />
          <BroadcastPackagePanel />
          <RecordingUploadPanel />
          <div className="panel-group-label">Monitoring</div>
          <GalleryPanel />
          <ChatPanel />
          <EventLogPanel />
        </div>
      </div>
      <RecoveryBanner />
      <StartupToast />
      {showBrandKit && (
        <div className="settings-overlay">
          <div className="settings-header">
            <h2>Brand Kit</h2>
            <button className="btn btn-ghost" onClick={() => useStore.getState().setShowBrandKit(false)}>Close</button>
          </div>
          <div className="settings-body">
            <BrandScraperPanel />
          </div>
        </div>
      )}
      {showImport && (
        <div className="settings-overlay">
          <div className="settings-header">
            <h2>Import</h2>
            <button className="btn btn-ghost" onClick={() => useStore.getState().setShowImport(false)}>Close</button>
          </div>
          <div className="settings-body">
            <ImportPanel />
          </div>
        </div>
      )}
      {showSettings && <Settings />}
      {showVisualEditor && (
        <VisualEditor onClose={() => useStore.getState().setShowVisualEditor(false)} />
      )}
      {showStartingSoonEditor && (
        <StartingSoonEditor onClose={() => useStore.getState().setShowStartingSoonEditor(false)} />
      )}
      <DayChecklist />
    </div>
  )
}
