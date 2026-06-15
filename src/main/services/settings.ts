import Store from 'electron-store'
import { AppSettings, DEFAULT_STYLING, DEFAULT_WIFI_DISPLAY, DEFAULT_SLOW_ZOOM, DEFAULT_CHAT_CONFIG, DEFAULT_HOTKEYS } from '../../shared/types'
import { createLogger } from '../logger'

const logger = createLogger('settings')

const store = new Store<AppSettings>({
  defaults: {
    server: {
      httpPort: 19080,
      wsPort: 19081,
    },
    overlay: { ...DEFAULT_STYLING },
    companyLogoPath: '',
    featureCardLogoPath: '',
    userPresets: [],
    deepseekApiKey: '',
    geminiApiKey: '',
    sessionsDir: '',
    mappingPresets: [],
    compactMode: false,
    streamConfig: {
      streamKey: '',
      rtmpUrl: '',
      viewingLink: '',
      embedCode: '',
      chatLink: '',
    },
    obsConnection: {
      host: '127.0.0.1',
      port: 4455,
      password: '',
    },
    r2Config: {
      endpoint: '',
      accessKeyId: '',
      secretAccessKey: '',
      bucket: 'streamstage-galleries',
    },
    wifiDisplay: { ...DEFAULT_WIFI_DISPLAY },
    slowZoom: { ...DEFAULT_SLOW_ZOOM },
    obsTransitionRevert: false,
    chatConfig: { ...DEFAULT_CHAT_CONFIG },
    dayChecklistLastShown: '',
    hotkeys: { ...DEFAULT_HOTKEYS },
    cameraHost: '',
  },
})

export function getAll(): AppSettings {
  return store.store
}

export function get<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return store.get(key)
}

export function set<K extends keyof AppSettings>(key: K, val: AppSettings[K]): void {
  logger.info(`Setting ${key}`)
  store.set(key, val)
}

export function setAll(settings: Partial<AppSettings>): void {
  for (const [key, val] of Object.entries(settings)) {
    store.set(key as keyof AppSettings, val)
  }
}

// Convenience wrappers matching the CompSyncElectronApp settings API so
// ported services (wifiDisplay, etc.) need no rewrite at the call site.
export function getSettings(): AppSettings {
  return store.store
}

export function setSettings(partial: Partial<AppSettings>): void {
  for (const [key, val] of Object.entries(partial)) {
    store.set(key as keyof AppSettings, val as never)
  }
}
