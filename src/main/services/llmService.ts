import OpenAI from 'openai'
import { Trigger } from '../../shared/types'
import * as settings from './settings'
import { createLogger } from '../logger'

const logger = createLogger('llmService')

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const SYSTEM_PROMPT = `You are a document parser for a video production overlay system. Given raw text from a document (PDF, DOCX, or TXT), extract a list of overlay triggers.

Each trigger should represent one person, act, routine, or speaker that would appear as a lower-third overlay on a broadcast.

Return ONLY a valid JSON array of objects with these fields:
- "name": A short display label (what shows in the trigger list)
- "title": The main text line for the overlay (person/act name)
- "subtitle": Secondary text (role, description, song title, etc.)
- "category": A grouping label if apparent (e.g., "Solo", "Group", "Panel 1")

Examples of documents you might receive:
- Dance recital programs (extract each routine with dancers/song/category)
- Conference speaker lists (extract each speaker with name/title/company)
- Award ceremony lineups (extract each presenter/recipient)
- Event run-of-show documents (extract each segment/presenter)

Rules:
- Extract ALL entries, don't skip any
- Keep text concise for overlay display (max ~50 chars per field)
- If subtitle info isn't available, use an empty string
- Preserve the original order from the document
- Return raw JSON only, no markdown fences, no explanation`

export async function extractTriggers(documentText: string): Promise<Trigger[]> {
  const apiKey = settings.get('deepseekApiKey')
  if (!apiKey) {
    throw new Error('DeepSeek API key not configured. Set it in Settings.')
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com',
  })

  logger.info(`Sending ${documentText.length} chars to DeepSeek for parsing`)

  const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: documentText },
    ],
    temperature: 0.1,
    max_tokens: 4096,
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error('Empty response from DeepSeek')
  }

  logger.info(`DeepSeek response: ${content.length} chars`)

  // Parse JSON — handle potential markdown fences
  let jsonStr = content.trim()
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  const parsed = JSON.parse(jsonStr)

  if (!Array.isArray(parsed)) {
    throw new Error('DeepSeek response is not an array')
  }

  // Convert to Trigger objects
  const triggers: Trigger[] = parsed.map((item: Record<string, unknown>, i: number) => ({
    id: generateId() + i,
    name: String(item.name || item.title || `Entry ${i + 1}`),
    title: String(item.title || ''),
    subtitle: String(item.subtitle || ''),
    category: String(item.category || ''),
    order: i,
  }))

  logger.info(`Extracted ${triggers.length} triggers`)
  return triggers
}
