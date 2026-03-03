import { useEffect } from 'react'
import { useStore, initStoreListeners, loadInitialState } from '../store/useStore'
import { Header } from './Header'
import { TriggerList } from './TriggerList'
import { TriggerEditor } from './TriggerEditor'
import { OverlayControls } from './OverlayControls'
import { StylingPanel } from './StylingPanel'
import { LogoManager } from './LogoManager'
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
        </div>
        <div className="right-panel">
          <OverlayControls />
          <TriggerEditor />
          <StylingPanel />
          <LogoManager />
        </div>
      </div>
      {showSettings && <Settings />}
    </div>
  )
}
