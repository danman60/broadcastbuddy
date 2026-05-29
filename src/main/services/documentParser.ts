import fs from 'fs'
import path from 'path'
import mammoth from 'mammoth'
import { createLogger } from '../logger'

const logger = createLogger('documentParser')

export interface ParsedDocument {
  text: string
  fileName: string
  pageCount: number
}

export async function parseDocument(filePath: string): Promise<ParsedDocument> {
  const ext = path.extname(filePath).toLowerCase()
  const fileName = path.basename(filePath)

  logger.info(`Parsing document: ${fileName}`)

  if (ext === '.pdf') {
    return parsePDF(filePath, fileName)
  } else if (ext === '.docx') {
    return parseDOCX(filePath, fileName)
  } else if (ext === '.txt') {
    return parseTXT(filePath, fileName)
  } else {
    throw new Error(`Unsupported file type: ${ext}`)
  }
}

async function parsePDF(filePath: string, fileName: string): Promise<ParsedDocument> {
  const buffer = fs.readFileSync(filePath)
  // pdf-lib has NO text-extraction API. Use pdfjs-dist's legacy build, which
  // runs the parse on the main thread (fake worker) under Node/Electron — no
  // separate worker file needed.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  })
  const pdf = await loadingTask.promise
  const pageCount = pdf.numPages
  const textParts: string[] = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = (content.items as Array<{ str?: string }>)
      .map((it) => it.str || '')
      .join(' ')
    textParts.push(pageText)
  }

  const text = textParts.join('\n')
  await pdf.cleanup()
  logger.info(`PDF parsed: ${pageCount} pages, ${text.length} chars`)

  return {
    text,
    fileName,
    pageCount,
  }
}

async function parseDOCX(filePath: string, fileName: string): Promise<ParsedDocument> {
  const buffer = fs.readFileSync(filePath)
  const result = await mammoth.extractRawText({ buffer })
  logger.info(`DOCX parsed: ${result.value.length} chars`)
  return {
    text: result.value,
    fileName,
    pageCount: 1,
  }
}

function parseTXT(filePath: string, fileName: string): ParsedDocument {
  const text = fs.readFileSync(filePath, 'utf-8')
  logger.info(`TXT parsed: ${text.length} chars`)
  return {
    text,
    fileName,
    pageCount: 1,
  }
}
