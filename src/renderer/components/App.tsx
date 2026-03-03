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
import { Settings } from './Settings'
import '../styles/app.css'

export function App() {
  const showSettings = useStore((s) => s.showSettings)

  useEffect(() => {
    initStoreListeners()
    loadInitialState()
  }, [])

  return (
    <div className="app-layout">
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
          <TemplateGallery />
          <StylingPanel />
          <LogoManager />
          <TickerControls />
          <BrandScraperPanel />
          <ImportPanel />
        </div>
      </div>
      {showSettings && <Settings />}
    </div>
  )
}
