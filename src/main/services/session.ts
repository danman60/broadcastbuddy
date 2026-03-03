import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { Session, Trigger, OverlayStyling, DEFAULT_STYLING } from '../../shared/types'
import { createLogger } from '../logger'

const logger = createLogger('session')

let currentSession: Session | null = null

function getSessionsDir(): string {
  const dir = path.join(app.getPath('userData'), 'sessions')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function getCurrentSession(): Session | null {
  return currentSession
}

export function newSession(name: string): Session {
  currentSession = {
    id: generateId(),
    name,
    triggers: [],
    styling: { ...DEFAULT_STYLING },
    companyLogoDataUrl: '',
    clientLogoDataUrl: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  logger.info(`New session created: ${name}`)
  return currentSession
}

export function saveSession(
  triggers: Trigger[],
  styling: OverlayStyling,
  companyLogoDataUrl: string,
  clientLogoDataUrl: string,
): Session | null {
  if (!currentSession) return null

  currentSession.triggers = triggers
  currentSession.styling = styling
  currentSession.companyLogoDataUrl = companyLogoDataUrl
  currentSession.clientLogoDataUrl = clientLogoDataUrl
  currentSession.updatedAt = new Date().toISOString()

  const filePath = path.join(getSessionsDir(), `${currentSession.id}.json`)
  fs.writeFileSync(filePath, JSON.stringify(currentSession, null, 2), 'utf-8')
  logger.info(`Session saved: ${currentSession.name} → ${filePath}`)
  return currentSession
}

export function loadSession(id: string): Session | null {
  const filePath = path.join(getSessionsDir(), `${id}.json`)
  if (!fs.existsSync(filePath)) {
    logger.error(`Session file not found: ${filePath}`)
    return null
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    currentSession = data as Session
    logger.info(`Session loaded: ${currentSession.name}`)
    return currentSession
  } catch (err) {
    logger.error('Failed to load session:', err)
    return null
  }
}

export function listSessions(): Array<{ id: string; name: string; updatedAt: string }> {
  const dir = getSessionsDir()
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  const sessions: Array<{ id: string; name: string; updatedAt: string }> = []

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'))
      sessions.push({
        id: data.id,
        name: data.name,
        updatedAt: data.updatedAt,
      })
    } catch {
      // Skip corrupt files
    }
  }

  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function setCurrentSession(session: Session): void {
  currentSession = session
}
