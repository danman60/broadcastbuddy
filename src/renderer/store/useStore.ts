import { create } from 'zustand'
import type { OverlayState, Trigger, AppSettings, Session } from '../../shared/types'

interface AppStore {
  // State
  overlayState: OverlayState | null
  triggers: Trigger[]
  selectedIndex: number
  settings: AppSettings | null
  currentSession: Session | null
  sessionList: Array<{ id: string; name: string; updatedAt: string }>
  showSettings: boolean

  // Setters
  setOverlayState: (s: OverlayState) => void
  setTriggers: (t: Trigger[], selectedIndex: number) => void
  setSettings: (s: AppSettings) => void
  setCurrentSession: (s: Session | null) => void
  setSessionList: (list: Array<{ id: string; name: string; updatedAt: string }>) => void
  setShowSettings: (show: boolean) => void
}

export const useStore = create<AppStore>((set) => ({
  overlayState: null,
  triggers: [],
  selectedIndex: -1,
  settings: null,
  currentSession: null,
  sessionList: [],
  showSettings: false,

  setOverlayState: (s) => set({ overlayState: s }),
  setTriggers: (t, selectedIndex) => set({ triggers: t, selectedIndex }),
  setSettings: (s) => set({ settings: s }),
  setCurrentSession: (s) => set({ currentSession: s }),
  setSessionList: (list) => set({ sessionList: list }),
  setShowSettings: (show) => set({ showSettings: show }),
}))

// Initialize IPC listeners
export function initStoreListeners(): void {
  window.api.on('overlay:state-update', (state) => {
    useStore.getState().setOverlayState(state as OverlayState)
  })

  window.api.on('triggers:updated', (triggers, selectedIndex) => {
    useStore.getState().setTriggers(triggers as Trigger[], selectedIndex as number)
  })

  window.api.on('session:updated', (session) => {
    useStore.getState().setCurrentSession(session as Session | null)
  })
}

// Fetch initial state from main process
export async function loadInitialState(): Promise<void> {
  const [overlayState, triggerData, settings, currentSession, sessionList] = await Promise.all([
    window.api.overlayGetState(),
    window.api.triggerList(),
    window.api.settingsGet(),
    window.api.sessionGetCurrent(),
    window.api.sessionList(),
  ])

  const store = useStore.getState()
  store.setOverlayState(overlayState)
  store.setTriggers(triggerData.triggers, triggerData.selectedIndex)
  store.setSettings(settings)
  store.setCurrentSession(currentSession)
  store.setSessionList(sessionList)
}
