import type { FieldMapping } from './types'

// Apply a field mapping's transform to one source row, producing the target
// field's string value. Pure — extracted from FieldMapper.tsx so the transform
// semantics (concat/format/extract/split) are unit-testable.
export function applyFieldMapping(row: Record<string, string>, mapping: FieldMapping): string {
  const values = mapping.sourceIds.map((id) => row[id] || '').filter((v) => v)

  if (values.length === 0) return ''

  switch (mapping.transform.type) {
    case 'concat': {
      const sep = (mapping.transform.params.separator as string) || ' '
      return values.join(sep)
    }
    case 'format': {
      const template = (mapping.transform.params.template as string) || '{0}'
      return template.replace(/\{(\d+)\}/g, (_, i) => values[parseInt(i)] || '')
    }
    case 'extract': {
      const maxLen = (mapping.transform.params.maxLength as number) || 50
      return values[0]?.slice(0, maxLen) || ''
    }
    case 'split': {
      const delimiter = (mapping.transform.params.delimiter as string) || ' '
      const part = (mapping.transform.params.part as number) || 0
      return values[0]?.split(delimiter)[part] || ''
    }
    default:
      return values[0] || ''
  }
}
