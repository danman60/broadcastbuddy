import { useState } from 'react'
import type { Trigger } from '../../shared/types'
import '../styles/import.css'

type ImportStage = 'idle' | 'previewing' | 'parsing' | 'review'

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
      const result = await window.api.importDocument(preview.filePath)
      setParsedTriggers(result.triggers)
      setStage('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract triggers')
      setStage('idle')
    }
  }

  function handleReset() {
    setStage('idle')
    setPreview(null)
    setParsedTriggers([])
    setError(null)
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

        {/* Review parsed triggers */}
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
            <div className="import-actions">
              <button className="btn btn-ghost btn-sm" onClick={handleReset}>
                Discard
              </button>
              <button className="btn btn-success btn-sm" onClick={handleReset}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
