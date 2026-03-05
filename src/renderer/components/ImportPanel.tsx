import { useState } from 'react'
import type { Trigger, LLMExtractedField, FieldMapping } from '../../shared/types'
import { FieldMapper } from './FieldMapper'
import '../styles/import.css'

type ImportStage = 'idle' | 'previewing' | 'parsing' | 'mapping' | 'review'
type ImportMode = 'append' | 'replace'

interface PreviewData {
  fileName: string
  pageCount: number
  textPreview: string
  textLength: number
  filePath: string
}

export function ImportPanel() {
  const [stage, setStage] = useState<ImportStage>('idle')
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [parsedTriggers, setParsedTriggers] = useState<Trigger[]>([])
  const [rawFields, setRawFields] = useState<LLMExtractedField[]>([])
  const [sampleData, setSampleData] = useState<Record<string, string>[]>([])
  const [suggestedMappings, setSuggestedMappings] = useState<FieldMapping[]>([])
  const [importMode, setImportMode] = useState<ImportMode>('append')
  const [error, setError] = useState<string | null>(null)

  async function handleBrowse() {
    setError(null)
    const filePath = await window.api.importBrowse()
    if (!filePath) return

    try {
      setStage('previewing')
      const data = await window.api.importPreview(filePath)
      setPreview({ ...data, filePath })
      setStage('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse document')
      setStage('idle')
    }
  }

  async function handleParse() {
    if (!preview) return
    setError(null)

    try {
      setStage('parsing')
      // Parse only — triggers are NOT added to overlay yet
      const result = await window.api.importDocument(preview.filePath)

      // Check if we have raw fields (new API) or just triggers (legacy)
      if (result.rawFields && result.sampleData) {
        // New API with field mapping
        setRawFields(result.rawFields)
        setSampleData(result.sampleData)
        setSuggestedMappings(result.suggestedMappings || [])
        setParsedTriggers(result.triggers || []) // For preview purposes
        setStage('mapping')
      } else {
        // Legacy API - directly to review
        setParsedTriggers(result.triggers || [])
        setStage('review')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract triggers')
      setStage('idle')
    }
  }

  async function handleConfirmImport() {
    if (parsedTriggers.length === 0) return

    try {
      // Clear existing triggers if replacing
      if (importMode === 'replace') {
        await window.api.triggerClearAll()
      }

      // Add parsed triggers one by one
      for (const trigger of parsedTriggers) {
        await window.api.triggerAdd(trigger)
      }

      handleReset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import triggers')
    }
  }

  function handleReset() {
    setStage('idle')
    setPreview(null)
    setParsedTriggers([])
    setRawFields([])
    setSampleData([])
    setSuggestedMappings([])
    setError(null)
  }

  async function handleMappingApply(mappings: FieldMapping[], triggers: Trigger[]) {
    // Convert preview triggers to actual triggers with new IDs
    const finalTriggers = triggers.map((t, i) => ({
      ...t,
      id: `imported-${Date.now()}-${i}`,
      order: i,
    }))
    setParsedTriggers(finalTriggers)
    setStage('review')
  }

  function handleMappingCancel() {
    setStage('idle')
    setRawFields([])
    setSampleData([])
    setSuggestedMappings([])
  }

  return (
    <div className="panel-section">
      <div className="panel-section-title">Document Import</div>
      <div className="import-panel">
        {error && <div className="import-error">{error}</div>}

        {stage === 'parsing' && (
          <div className="import-loading">
            <div className="import-spinner" />
            Parsing document with AI...
          </div>
        )}

        {stage === 'previewing' && (
          <div className="import-loading">
            <div className="import-spinner" />
            Reading document...
          </div>
        )}

        {/* Browse / drop zone */}
        {stage === 'idle' && !preview && (
          <div className="import-dropzone" onClick={handleBrowse}>
            <div className="import-dropzone-label">Browse for a document</div>
            <div className="import-dropzone-hint">Supports PDF, DOCX, TXT</div>
          </div>
        )}

        {/* File preview */}
        {stage === 'idle' && preview && (
          <>
            <div className="import-file-info">
              <span className="import-file-name">{preview.fileName}</span>
              <span className="import-file-meta">
                {preview.pageCount} page{preview.pageCount !== 1 ? 's' : ''} / {preview.textLength.toLocaleString()} chars
              </span>
            </div>
            <div className="import-preview-box">
              {preview.textPreview}
              {preview.textLength > 500 && '...'}
            </div>
            <div className="import-actions">
              <button className="btn btn-ghost btn-sm" onClick={handleReset}>
                Clear
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleBrowse}>
                Different File
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleParse}>
                Extract Triggers with AI
              </button>
            </div>
          </>
        )}

        {/* Review parsed triggers with mode toggle */}
        {stage === 'review' && (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Extracted {parsedTriggers.length} triggers from {preview?.fileName}
            </div>
            <div className="import-triggers-preview">
              {parsedTriggers.map((t, i) => (
                <div key={t.id} className="import-trigger-row">
                  <span className="import-trigger-num">{i + 1}</span>
                  <span className="import-trigger-title">{t.title}</span>
                  <span className="import-trigger-subtitle">{t.subtitle}</span>
                  {t.category && (
                    <span className="import-trigger-category">{t.category}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="import-mode-toggle">
              <button
                className={`btn-sm import-mode-btn ${importMode === 'append' ? 'active' : ''}`}
                onClick={() => setImportMode('append')}
              >
                Append to existing
              </button>
              <button
                className={`btn-sm import-mode-btn ${importMode === 'replace' ? 'active' : ''}`}
                onClick={() => setImportMode('replace')}
              >
                Replace all
              </button>
            </div>
            <div className="import-actions">
              <button className="btn btn-ghost btn-sm" onClick={handleReset}>
                Discard
              </button>
              <button className="btn btn-success btn-sm" onClick={handleConfirmImport}>
                Import {parsedTriggers.length} trigger{parsedTriggers.length !== 1 ? 's' : ''}
              </button>
            </div>
          </>
        )}

        {/* Field Mapping Stage */}
        {stage === 'mapping' && rawFields.length > 0 && (
          <FieldMapper
            rawFields={rawFields}
            sampleData={sampleData}
            initialMappings={suggestedMappings}
            onApply={handleMappingApply}
            onCancel={handleMappingCancel}
          />
        )}
      </div>
    </div>
  )
}
