import Store from 'electron-store'
import { AppSettings, DEFAULT_STYLING } from '../../shared/types'
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
    deepseekApiKey: '',
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
