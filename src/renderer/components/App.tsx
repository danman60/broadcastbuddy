import { useEffect } from 'react'
import { useStore, initStoreListeners, loadInitialState } from '../store/useStore'
import { Header } from './Header'
import { TriggerList } from './TriggerList'
import { OverlayPreview } from './OverlayPreview'
import { TriggerEditor } from './TriggerEditor'
import { OverlayControls } from './OverlayControls'
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
import { Settings } from './Settings'
import '../styles/app.css'

export function App() {
  const showSettings = useStore((s) => s.showSettings)
  const showBrandKit = useStore((s) => s.showBrandKit)
  const showImport = useStore((s) => s.showImport)
  const compactMode = useStore((s) => s.compactMode)

  useEffect(() => {
    initStoreListeners()
    loadInitialState()
  }, [])

  return (
    <div className={`app-layout${compactMode ? ' compact' : ''}`}>
      <Header />
      <div className="app-body">
        <div className="left-panel">
          <TriggerList />
          <OverlayPreview />
        </div>
        <div className="right-panel">
          <OverlayControls />
          <TriggerEditor />
          <AnimationPanel />
          <StartingSoonPanel />
          <TemplateGallery />
          <StylingPanel />
          <LogoManager />
          <TickerControls />
          <StreamInfoPanel />
          <NotesPanel />
        </div>
      </div>
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
    </div>
  )
}
