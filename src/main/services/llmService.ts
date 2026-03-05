import OpenAI from 'openai'
import { Trigger, LLMExtractedField, ExtractionResult } from '../../shared/types'
import * as settings from './settings'
import { createLogger } from '../logger'

const logger = createLogger('llmService')

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const SYSTEM_PROMPT = `You are a document parser for a video production overlay system. Given raw text from a document (PDF, DOCX, or TXT), extract a list of overlay triggers.

Each trigger should represent one person, act, routine, or speaker that would appear as a lower-third overlay on a broadcast.

Return ONLY a valid JSON array of objects. Each object should contain these fields extracted from the document:
- "name": A short display label (what shows in the trigger list)
- "title": The main text line for the overlay (person/act name)
- "subtitle": Secondary text (role, description, song title, etc.)
- "category": A grouping label if apparent (e.g., "Solo", "Group", "Panel 1")

Additionally, include any other fields you find in the document that might be useful for mapping. Common field patterns you might encounter:
- FirstName, LastName (or first_name, last_name)
- SongTitle, DanceName, RoutineName
- Studio, School, Company, Organization
- Age, Grade, Level
- Style, Genre, Category
- Time, Duration

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

export async function extractTriggers(documentText: string): Promise<ExtractionResult> {
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

  // Collect unique field names from all objects
  const fieldNames = new Set<string>()
  for (const item of parsed) {
    if (typeof item === 'object' && item !== null) {
      Object.keys(item).forEach(k => fieldNames.add(k))
    }
  }

  // Create raw fields list showing all discovered field names and first values
  const rawFields: LLMExtractedField[] = []
  if (parsed.length > 0) {
    const firstItem = parsed[0] as Record<string, unknown>
    for (const fieldName of fieldNames) {
      const value = String(firstItem[fieldName] ?? '')
      rawFields.push({ name: fieldName, value: value.slice(0, 100) })
    }
  }

  // Create sample data (first 10 rows)
  const sampleData: Record<string, string>[] = parsed.slice(0, 10).map((item: Record<string, unknown>) => {
    const row: Record<string, string> = {}
    for (const fieldName of fieldNames) {
      row[fieldName] = String(item[fieldName] ?? '')
    }
    return row
  })

  // Convert to Trigger objects
  const triggers: Trigger[] = parsed.map((item: Record<string, unknown>, i: number) => ({
    id: generateId() + i,
    name: String(item.name || item.Name || item.displayName || item.label || item.title || `Entry ${i + 1}`),
    title: String(item.title || item.Title || item.name || item.Name || ''),
    subtitle: String(item.subtitle || item.Subtitle || item.description || item.Description || item.role || item.Role || ''),
    category: String(item.category || item.Category || item.group || item.Group || item.type || item.Type || ''),
    order: i,
    logoDataUrl: '',
  }))

  // Generate suggested mappings based on common patterns
  const suggestedMappings = generateSuggestedMappings(Array.from(fieldNames))

  logger.info(`Extracted ${triggers.length} triggers with ${fieldNames.size} unique fields`)

  return {
    rawFields,
    sampleData,
    suggestedMappings,
  }
}

function generateSuggestedMappings(fieldNames: string[]): import('../../shared/types').FieldMapping[] {
  const mappings: import('../../shared/types').FieldMapping[] = []
  const normalizedFields = new Map<string, string>()

  // Normalize field names for matching
  for (const name of fieldNames) {
    normalizedFields.set(name.toLowerCase().replace(/[_\s-]/g, ''), name)
  }

  // Auto-map common patterns to trigger fields
  const patterns: Record<import('../../shared/types').FieldMapping['targetId'], string[]> = {
    name: ['name', 'label', 'displayname', 'display', 'listname'],
    title: ['title', 'titlename', 'headline', 'subject', 'eventname'],
    subtitle: ['subtitle', 'description', 'role', 'position', 'details', 'info'],
    category: ['category', 'group', 'type', 'section', 'division', 'class'],
    logoDataUrl: ['logo', 'image', 'avatar', 'photo'],
  }

  for (const [targetId, searchPatterns] of Object.entries(patterns)) {
    for (const pattern of searchPatterns) {
      const matchedField = normalizedFields.get(pattern)
      if (matchedField) {
        mappings.push({
          sourceIds: [matchedField],
          targetId: targetId as import('../../shared/types').FieldMapping['targetId'],
          transform: { type: 'none', params: {} },
        })
        break
      }
    }
  }

  // Handle FirstName + LastName -> name concatenation
  const firstNames: string[] = []
  const lastNames: string[] = []
  for (const [norm, original] of normalizedFields) {
    if (norm.includes('firstname') || norm === 'fname' || norm === 'first') {
      firstNames.push(original)
    }
    if (norm.includes('lastname') || norm === 'lname' || norm === 'last') {
      lastNames.push(original)
    }
  }

  if (firstNames.length > 0 && lastNames.length > 0) {
    // Check if we already have a name mapping
    const hasNameMapping = mappings.some(m => m.targetId === 'name')
    if (!hasNameMapping) {
      mappings.push({
        sourceIds: [firstNames[0], lastNames[0]],
        targetId: 'name',
        transform: { type: 'concat', params: { separator: ' ' } },
      })
    }

    // Also map to title if not already mapped
    const hasTitleMapping = mappings.some(m => m.targetId === 'title')
    if (!hasTitleMapping) {
      mappings.push({
        sourceIds: [firstNames[0], lastNames[0]],
        targetId: 'title',
        transform: { type: 'concat', params: { separator: ' ' } },
      })
    }
  }

  return mappings
}

// Legacy export for backward compatibility
export async function extractTriggersLegacy(documentText: string): Promise<Trigger[]> {
  const result = await extractTriggers(documentText)
  return result.sampleData.map((row, i) => ({
    id: generateId() + i,
    name: String(row.name || row.title || `Entry ${i + 1}`),
    title: String(row.title || ''),
    subtitle: String(row.subtitle || ''),
    category: String(row.category || ''),
    order: i,
    logoDataUrl: '',
  }))
}
