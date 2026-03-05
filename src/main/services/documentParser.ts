import fs from 'fs'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
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
  const pdfDoc = await PDFDocument.load(buffer)
  const pageCount = pdfDoc.getPageCount()

  // Extract text from all pages
  const pages = pdfDoc.getPages()
  const textParts: string[] = []

  for (const page of pages) {
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item: any) => item.str || '')
      .join(' ')
    textParts.push(pageText)
  }

  const text = textParts.join('\n')
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
