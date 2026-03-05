import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { Session, Trigger, OverlayStyling, DEFAULT_STYLING, LoopMode } from '../../shared/types'
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
    selectedIndex: 0,
    playedIds: [],
    loopMode: 'none',
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
  selectedIndex?: number,
  playedIds?: string[],
  savedLoopMode?: LoopMode,
): Session | null {
  if (!currentSession) return null

  currentSession.triggers = triggers
  currentSession.styling = styling
  currentSession.companyLogoDataUrl = companyLogoDataUrl
  currentSession.clientLogoDataUrl = clientLogoDataUrl
  if (selectedIndex !== undefined) currentSession.selectedIndex = selectedIndex
  if (playedIds !== undefined) currentSession.playedIds = playedIds
  if (savedLoopMode !== undefined) currentSession.loopMode = savedLoopMode
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

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    return []
  }

  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch (err) {
    logger.error('Failed to read sessions directory:', err)
    return []
  }

  const sessions: Array<{ id: string; name: string; updatedAt: string }> = []

  for (const file of files) {
    try {
      const filePath = path.join(dir, file)
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      sessions.push({
        id: data.id,
        name: data.name,
        updatedAt: data.updatedAt,
      })
    } catch (err) {
      logger.warn(`Skipping corrupt session file: ${file}`)
    }
  }

  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getMostRecentSession(): Session | null {
  const sessions = listSessions()
  if (sessions.length === 0) return null

  const mostRecent = sessions[0]
  return loadSession(mostRecent.id)
}

export function setCurrentSession(session: Session): void {
  currentSession = session
}
