import { useState, useMemo } from 'react'
import type { Trigger, LLMExtractedField, FieldMapping, TransformConfig } from '../../shared/types'
import '../styles/fieldMapper.css'

interface FieldMapperProps {
  rawFields: LLMExtractedField[]
  sampleData: Record<string, string>[]
  initialMappings?: FieldMapping[]
  onApply: (mappings: FieldMapping[], triggers: Trigger[]) => void
  onCancel: () => void
}

const TARGET_FIELDS: { id: FieldMapping['targetId']; label: string }[] = [
  { id: 'name', label: 'List Name' },
  { id: 'title', label: 'Title' },
  { id: 'subtitle', label: 'Subtitle' },
  { id: 'category', label: 'Category' },
]

export function FieldMapper({ rawFields, sampleData, initialMappings, onApply, onCancel }: FieldMapperProps) {
  const [mappings, setMappings] = useState<FieldMapping[]>(initialMappings || [])
  const [draggedSourceId, setDraggedSourceId] = useState<string | null>(null)
  const [editingCell, setEditingCell] = useState<{ row: number; field: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [showMappingPanel, setShowMappingPanel] = useState(true)

  // Get source fields from sampleData keys
  const sourceFields = useMemo(() => {
    const keys = new Set<string>()
    sampleData.forEach(row => Object.keys(row).forEach(k => keys.add(k)))
    return Array.from(keys)
  }, [sampleData])

  // Generate preview triggers based on current mappings
  const previewTriggers = useMemo((): Trigger[] => {
    return sampleData.slice(0, 20).map((row, i) => {
      const trigger: Trigger = {
        id: `preview-${i}`,
        name: '',
        title: '',
        subtitle: '',
        category: '',
        order: i,
        logoDataUrl: '',
      }

      for (const mapping of mappings) {
        const value = applyMapping(row, mapping)
        trigger[mapping.targetId] = value
      }

      // Fallback if no mappings
      if (!trigger.name && !trigger.title) {
        trigger.name = Object.values(row)[0] || `Entry ${i + 1}`
        trigger.title = trigger.name
      }

      return trigger
    })
  }, [sampleData, mappings])

  function applyMapping(row: Record<string, string>, mapping: FieldMapping): string {
    const values = mapping.sourceIds.map(id => row[id] || '').filter(v => v)

    if (values.length === 0) return ''

    switch (mapping.transform.type) {
      case 'concat':
        const sep = (mapping.transform.params.separator as string) || ' '
        return values.join(sep)
      case 'format':
        const template = (mapping.transform.params.template as string) || '{0}'
        return template.replace(/\{(\d+)\}/g, (_, i) => values[parseInt(i)] || '')
      case 'extract':
        const maxLen = (mapping.transform.params.maxLength as number) || 50
        return values[0]?.slice(0, maxLen) || ''
      case 'split':
        const delimiter = (mapping.transform.params.delimiter as string) || ' '
        const part = (mapping.transform.params.part as number) || 0
        return values[0]?.split(delimiter)[part] || ''
      default:
        return values[0] || ''
    }
  }

  function handleDragStart(sourceId: string) {
    setDraggedSourceId(sourceId)
  }

  function handleDragEnd() {
    setDraggedSourceId(null)
  }

  function handleDropOnTarget(targetId: FieldMapping['targetId']) {
    if (!draggedSourceId) return

    setMappings(prev => {
      const existing = prev.find(m => m.targetId === targetId)
      if (existing) {
        // Add to existing mapping
        if (!existing.sourceIds.includes(draggedSourceId)) {
          return [
            ...prev.filter(m => m.targetId !== targetId),
            {
              ...existing,
              sourceIds: [...existing.sourceIds, draggedSourceId],
              transform: existing.sourceIds.length > 0
                ? { type: 'concat', params: { separator: ' ' } }
                : existing.transform
            }
          ]
        }
        return prev
      }
      // Create new mapping
      return [...prev, {
        sourceIds: [draggedSourceId],
        targetId,
        transform: { type: 'none', params: {} },
      }]
    })
    setDraggedSourceId(null)
  }

  function removeMapping(targetId: FieldMapping['targetId'], sourceId: string) {
    setMappings(prev =>
      prev.map(m =>
        m.targetId === targetId
          ? { ...m, sourceIds: m.sourceIds.filter(s => s !== sourceId) }
          : m
      ).filter(m => m.sourceIds.length > 0)
    )
  }

  function clearMapping(targetId: FieldMapping['targetId']) {
    setMappings(prev => prev.filter(m => m.targetId !== targetId))
  }

  function setTransform(targetId: FieldMapping['targetId'], transform: TransformConfig) {
    setMappings(prev =>
      prev.map(m => m.targetId === targetId ? { ...m, transform } : m)
    )
  }

  function startEditingCell(row: number, field: string, currentValue: string) {
    setEditingCell({ row, field })
    setEditValue(currentValue)
  }

  function commitEdit() {
    setEditingCell(null)
    setEditValue('')
  }

  function cancelEdit() {
    setEditingCell(null)
    setEditValue('')
  }

  function getMappingForTarget(targetId: FieldMapping['targetId']) {
    return mappings.find(m => m.targetId === targetId)
  }

  function getSampleValue(fieldName: string): string {
    return sampleData[0]?.[fieldName] || ''
  }

  return (
    <div className="field-mapper">
      <div className="field-mapper-header">
        <div>
          <h3>Field Mapping</h3>
          <p className="field-mapper-subtitle">
            Drag source fields to target fields to map them
          </p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowMappingPanel(!showMappingPanel)}
        >
          {showMappingPanel ? 'Hide Mapping' : 'Show Mapping'}
        </button>
      </div>

      <div className="field-mapper-content">
        {showMappingPanel && (
          <div className="mapping-panel">
            <div className="source-fields-section">
              <h4>Source Fields</h4>
              <p className="section-hint">Drag these to target fields</p>
              <div className="source-fields-list">
                {sourceFields.map(fieldName => {
                  const sampleValue = getSampleValue(fieldName)
                  return (
                    <div
                      key={fieldName}
                      className="source-field-chip"
                      draggable
                      onDragStart={() => handleDragStart(fieldName)}
                      onDragEnd={handleDragEnd}
                      title={sampleValue}
                    >
                      <span className="field-name">{fieldName}</span>
                      <span className="field-preview">{sampleValue.slice(0, 30)}{sampleValue.length > 30 ? '...' : ''}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="transform-section">
              <h4>Transforms</h4>
              <div className="transform-chips">
                <div className="transform-chip" title="Combine multiple fields">
                  Concatenate
                </div>
                <div className="transform-chip" title="Extract part of text">
                  Extract
                </div>
                <div className="transform-chip" title="Split by delimiter">
                  Split
                </div>
              </div>
            </div>

            <div className="target-fields-section">
              <h4>Target Fields</h4>
              <p className="section-hint">Drop source fields here</p>
              <div className="target-fields-list">
                {TARGET_FIELDS.map(target => {
                  const mapping = getMappingForTarget(target.id)
                  return (
                    <div
                      key={target.id}
                      className={`target-field-row ${mapping ? 'has-mapping' : ''}`}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDropOnTarget(target.id)}
                    >
                      <div className="target-field-label">{target.label}</div>
                      <div className="target-field-mapping">
                        {mapping ? (
                          <div className="mapping-chips">
                            {mapping.sourceIds.map((sourceId, i) => (
                              <span key={sourceId} className="mapping-chip">
                                {sourceId}
                                <button
                                  className="mapping-chip-remove"
                                  onClick={() => removeMapping(target.id, sourceId)}
                                >
                                  ×
                                </button>
                                {i < mapping.sourceIds.length - 1 && mapping.transform.type === 'concat' && (
                                  <span className="mapping-separator">
                                    +{(mapping.transform.params.separator as string) || ' '}
                                  </span>
                                )}
                              </span>
                            ))}
                            {mapping.sourceIds.length > 1 && mapping.transform.type !== 'concat' && (
                              <button
                                className="mapping-action"
                                onClick={() => setTransform(target.id, { type: 'concat', params: { separator: ' ' } })}
                                title="Combine fields"
                              >
                                Concat
                              </button>
                            )}
                            <button
                              className="mapping-action mapping-action-clear"
                              onClick={() => clearMapping(target.id)}
                              title="Clear mapping"
                            >
                              Clear
                            </button>
                          </div>
                        ) : (
                          <span className="mapping-placeholder">Drop field here</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        <div className="preview-panel">
          <div className="preview-header">
            <h4>Preview</h4>
            <span className="preview-count">{previewTriggers.length} entries</span>
          </div>
          <div className="preview-table-wrapper">
            <table className="preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Title</th>
                  <th>Subtitle</th>
                  <th>Category</th>
                </tr>
              </thead>
              <tbody>
                {previewTriggers.map((trigger, i) => (
                  <tr key={trigger.id}>
                    <td className="row-num">{i + 1}</td>
                    {(['name', 'title', 'subtitle', 'category'] as const).map(field => (
                      <td key={field}>
                        {editingCell?.row === i && editingCell?.field === field ? (
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit()
                              if (e.key === 'Escape') cancelEdit()
                            }}
                            autoFocus
                            className="edit-input"
                          />
                        ) : (
                          <span
                            className="editable-cell"
                            onClick={() => startEditingCell(i, field, trigger[field])}
                            title="Click to edit"
                          >
                            {trigger[field] || <span className="empty-cell">—</span>}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editingCell && (
            <div className="edit-hint">
              Press Enter to confirm, Escape to cancel
            </div>
          )}
        </div>
      </div>

      <div className="field-mapper-actions">
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-success"
          onClick={() => onApply(mappings, previewTriggers)}
        >
          Apply & Import {previewTriggers.length} Triggers
        </button>
      </div>
    </div>
  )
}
