import { dialog, BrowserWindow } from 'electron'
import { Trigger } from '../../shared/types'
import { parseDocument, ParsedDocument } from './documentParser'
import { extractTriggers } from './llmService'
import { createLogger } from '../logger'

const logger = createLogger('documentImport')

export interface ImportPreview {
  fileName: string
  pageCount: number
  textPreview: string
  textLength: number
}

export interface ImportResult {
  triggers: Trigger[]
  fileName: string
}

let lastParsedDocument: ParsedDocument | null = null

export async function browseDocument(): Promise<string | null> {
  const windows = BrowserWindow.getAllWindows()
  const win = windows.length > 0 ? windows[0] : null
  if (!win) return null

  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Documents', extensions: ['pdf', 'docx', 'txt'] },
    ],
  })

  return result.canceled ? null : result.filePaths[0]
}

export async function parseAndPreview(filePath: string): Promise<ImportPreview> {
  lastParsedDocument = await parseDocument(filePath)
  return {
    fileName: lastParsedDocument.fileName,
    pageCount: lastParsedDocument.pageCount,
    textPreview: lastParsedDocument.text.slice(0, 500),
    textLength: lastParsedDocument.text.length,
  }
}

export async function importDocument(filePath?: string): Promise<ImportResult> {
  let doc = lastParsedDocument

  if (filePath) {
    doc = await parseDocument(filePath)
    lastParsedDocument = doc
  }

  if (!doc) {
    throw new Error('No document to import. Browse for a file first.')
  }

  logger.info(`Importing triggers from: ${doc.fileName}`)
  const triggers = await extractTriggers(doc.text)

  return {
    triggers,
    fileName: doc.fileName,
  }
}

export function clearLastDocument(): void {
  lastParsedDocument = null
}
