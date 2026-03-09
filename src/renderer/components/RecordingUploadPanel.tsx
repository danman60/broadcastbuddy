import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'

interface UploadState {
  eventId: string
  eventName: string
  driveFolderUrl: string | null
}

export function RecordingUploadPanel() {
  const settings = useStore((s) => s.settings)
  const [uploadState, setUploadState] = useState<UploadState | null>(null)
  const [filePath, setFilePath] = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [resultLink, setResultLink] = useState('')

  // Store receives upload context when a broadcast package is applied
  useEffect(() => {
    window.api.on('cc:recording-context', (...args: unknown[]) => {
      setUploadState({
        eventId: args[0] as string,
        eventName: args[1] as string,
        driveFolderUrl: (args[2] as string) || null,
      })
    })
    return () => window.api.removeAllListeners('cc:recording-context')
  }, [])

  async function browseFile() {
    const path = await window.api.recordingBrowse()
    if (path) setFilePath(path)
  }

  async function detectFromOBS() {
    setError('')
    const result = await window.api.obsGetLastRecording()
    if (result.success && result.path) {
      setFilePath(result.path)
    } else {
      setError(result.error || 'No recording detected')
    }
  }

  async function handleUpload() {
    if (!filePath || !uploadState) return
    const cc = settings?.ccConfig
    if (!cc?.baseUrl || !cc?.apiKey || !cc?.tenantId) {
      setError('Command Center not configured')
      return
    }

    setError('')
    setResultLink('')
    setUploading(true)
    setProgress('Reading file...')

    try {
      setProgress('Uploading to Google Drive via Command Center...')
      const result = await window.api.ccUploadRecording(
        cc.baseUrl,
        cc.apiKey,
        cc.tenantId,
        uploadState.eventId,
        filePath,
      )

      if (result.success && result.file) {
        setProgress('Upload complete')
        setResultLink(result.file.webViewLink || '')
      } else {
        setError(result.error || 'Upload failed')
        setProgress('')
      }
    } catch (err) {
      setError((err as Error).message)
      setProgress('')
    } finally {
      setUploading(false)
    }
  }

  if (!uploadState) return null

  const hasFolder = !!uploadState.driveFolderUrl

  return (
    <div className="panel collapsible">
      <details>
        <summary className="panel-header">
          <span>Recording Upload</span>
          {hasFolder && (
            <span style={{ fontSize: 9, color: 'var(--success, #4ade80)', marginLeft: 6 }}>
              Drive linked
            </span>
          )}
        </summary>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Upload recording to {uploadState.eventName}'s Google Drive folder
          </div>

          {/* File selection */}
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type="text"
              readOnly
              value={filePath}
              placeholder="No file selected"
              className="input input-sm"
              style={{ flex: 1, fontSize: 10 }}
            />
            <button className="btn btn-sm btn-ghost" onClick={browseFile} disabled={uploading}>
              Browse
            </button>
          </div>

          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="btn btn-sm btn-ghost"
              onClick={detectFromOBS}
              disabled={uploading}
              style={{ fontSize: 10 }}
            >
              Detect from OBS
            </button>
          </div>

          {/* Upload button */}
          <button
            className="btn btn-sm btn-primary"
            onClick={handleUpload}
            disabled={!filePath || uploading || !hasFolder}
          >
            {uploading ? 'Uploading...' : 'Upload to Drive'}
          </button>

          {!hasFolder && (
            <div style={{ color: 'var(--warning, #fbbf24)', fontSize: 10 }}>
              No Drive folder linked to this event or client in CC
            </div>
          )}

          {progress && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{progress}</div>
          )}

          {error && (
            <div style={{ color: 'var(--danger)', fontSize: 11 }}>{error}</div>
          )}

          {resultLink && (
            <div style={{ fontSize: 11 }}>
              <span style={{ color: 'var(--success, #4ade80)' }}>Uploaded! </span>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  // Open in default browser via shell
                  window.open(resultLink, '_blank')
                }}
                style={{ color: 'var(--accent)', textDecoration: 'underline' }}
              >
                View in Drive
              </a>
            </div>
          )}

          {uploadState.driveFolderUrl && (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                window.open(uploadState.driveFolderUrl!, '_blank')
              }}
              style={{ fontSize: 10, color: 'var(--text-dim)', textDecoration: 'underline' }}
            >
              Open Drive folder
            </a>
          )}
        </div>
      </details>
    </div>
  )
}
