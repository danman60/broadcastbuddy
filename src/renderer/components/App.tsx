import { useEffect, useCallback, useRef, useState } from 'react'
import { useStore, initStoreListeners, loadInitialState } from '../store/useStore'
import { Header } from './Header'
import { TriggerList } from './TriggerList'
import { OverlayPreview } from './OverlayPreview'
import { TriggerEditor } from './TriggerEditor'
import { OverlayControls } from './OverlayControls'
import { AdhocPanel } from './AdhocPanel'
import { CameraPanel } from './CameraPanel'
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
import { TabbedCard } from './TabbedCard'
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
  // App-level success toast — fires ONLY when the main process VERIFIED (via
  // OBS read-back) that the stream key actually landed in OBS, never on a blind
  // Set. Always mounted so it shows regardless of which panel is open.
  const [obsToast, setObsToast] = useState<string | null>(null)
  // Rail Camera card is collapsed by default — when the camera is off it only
  // shows a "Searching…" placeholder, which is wasted rail height. Operator
  // expands it on demand. Reuses the .panel-section collapse pattern.
  const [cameraCollapsed, setCameraCollapsed] = useState(true)

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

  // Subscribe to the verified stream-key-synced push from main. Mount-once.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    window.api.on('obs:stream-key-synced', (p) => {
      const ev = (p as { event?: string })?.event
      setObsToast(ev ? `Stream key synced to OBS — ${ev}` : 'Stream key synced to OBS')
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setObsToast(null), 3000)
    })
    return () => {
      if (timer) clearTimeout(timer)
      window.api.removeAllListeners('obs:stream-key-synced')
    }
  }, [])

  return (
    <div className={`app-layout${compactMode ? ' compact' : ''}`}>
      {obsToast && <div className="obs-sync-toast">✓ {obsToast}</div>}
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
          {/* CENTER — Live Control: the live-critical stack. Flex:1, scrolls if
              needed. Playlist hero + Graphics card both come from OverlayControls
              (it renders the two sections as siblings). */}
          <div className="center-column">
            <OverlayControls />
            <TriggerEditor />
            <AdhocPanel />
            <GalleryPanel />
            <div className="center-log-fill">
              <EventLogPanel />
            </div>
          </div>
          {/* RIGHT — Show Rail: fixed-width vertical card stack with its own
              scroll. Camera · Content (tabbed) · Broadcast (tabbed) · Chat. */}
          <aside className="show-rail">
            {!(showSettings || showBrandKit || showImport || showVisualEditor || showStartingSoonEditor) && (
              <div className={`panel-section${cameraCollapsed ? ' collapsed' : ''}`}>
                <div className="panel-section-title" onClick={() => setCameraCollapsed(!cameraCollapsed)}>
                  Camera (OBSBOT)
                  <span className="chevron">{cameraCollapsed ? '▸' : '▾'}</span>
                </div>
                {!cameraCollapsed && <CameraPanel />}
              </div>
            )}
            <TabbedCard
              title="Content"
              tabs={[
                {
                  id: 'look',
                  label: 'Look',
                  content: (
                    <>
                      <AnimationPanel />
                      <TemplateGallery />
                      <StylingPanel />
                      <LogoManager />
                      <TickerControls />
                    </>
                  ),
                },
                { id: 'starting-soon', label: 'Starting Soon', content: <StartingSoonPanel /> },
              ]}
            />
            <TabbedCard
              title="Broadcast"
              tabs={[
                { id: 'stream', label: 'Stream', content: <StreamInfoPanel /> },
                { id: 'package', label: 'Package', content: <BroadcastPackagePanel /> },
                { id: 'recording', label: 'Recording', content: <RecordingUploadPanel /> },
                { id: 'notes', label: 'Notes', content: <NotesPanel /> },
              ]}
            />
            <div className="chat-card">
              <ChatPanel />
            </div>
          </aside>
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
