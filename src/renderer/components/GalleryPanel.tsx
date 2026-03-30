import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../store/useStore'
import type { RoutineBoundary, PhotoMatch, GalleryProgress } from '../../shared/types'
import '../styles/gallery.css'

type Step = 'idle' | 'transcribing' | 'video' | 'photos' | 'matching' | 'review' | 'uploading-r2' | 'upload' | 'done'

interface MatchSummary {
  total: number
  exact: number
  gap: number
  preShow: number
  intermission: number
  unmatched: number
  byRoutine: Map<number, { name: string; count: number }>
}

export function GalleryPanel() {
  const settings = useStore((s) => s.settings)
  const triggers = useStore((s) => s.triggers)

  const [step, setStep] = useState<Step>('idle')
  const [videoPath, setVideoPath] = useState('')
  const [videoPaths, setVideoPaths] = useState<string[]>([])
  const [photoFolder, setPhotoFolder] = useState('')
  const [boundaries, setBoundaries] = useState<RoutineBoundary[]>([])
  const [matches, setMatches] = useState<PhotoMatch[]>([])
  const [manualOffsetMin, setManualOffsetMin] = useState(-7) // default: camera 7 min ahead
  const [progress, setProgress] = useState<GalleryProgress | null>(null)
  const [error, setError] = useState('')
  const [galleryUrl, setGalleryUrl] = useState('')
  const [galleryTitle, setGalleryTitle] = useState('')
  const [expandedRoutine, setExpandedRoutine] = useState<number | null>(null)

  // Listen for progress events
  useEffect(() => {
    window.api.on('gallery:progress', (...args: unknown[]) => {
      setProgress(args[0] as GalleryProgress)
    })
    return () => window.api.removeAllListeners('gallery:progress')
  }, [])

  // Compute match summary
  const summary: MatchSummary | null = matches.length > 0 ? (() => {
    const exact = matches.filter((m) => m.confidence === 'exact').length
    const gap = matches.filter((m) => m.confidence === 'gap').length
    const preShow = matches.filter((m) => m.confidence === 'pre-show').length
    const intermission = matches.filter((m) => m.confidence === 'intermission').length
    const unmatched = matches.filter((m) => m.confidence === 'unmatched').length
    const byRoutine = new Map<number, { name: string; count: number }>()
    for (const m of matches) {
      if (m.matchedRoutineIndex === undefined) continue
      const b = boundaries[m.matchedRoutineIndex]
      const entry = byRoutine.get(m.matchedRoutineIndex) || { name: b?.name || `Routine ${m.matchedRoutineIndex + 1}`, count: 0 }
      entry.count++
      byRoutine.set(m.matchedRoutineIndex, entry)
    }
    return { total: matches.length, exact, gap, preShow, intermission, unmatched, byRoutine }
  })() : null

  const geminiKey = settings?.geminiApiKey || ''

  async function handleBrowseVideo() {
    const path = await window.api.galleryBrowseVideo()
    if (path) {
      setVideoPath(path)
      setVideoPaths([path])
      setError('')
    }
  }

  async function handleBrowseVideos() {
    const paths = await window.api.galleryBrowseVideos()
    if (paths && paths.length > 0) {
      setVideoPaths(paths)
      setVideoPath(paths[0])
      setError('')
    }
  }

  async function handleTranscribe() {
    if (videoPaths.length === 0) return
    setError('')
    setStep('transcribing')
    const result = await window.api.galleryTranscribe(videoPaths)
    if (result.success) {
      setBoundaries(result.boundaries)
      setStep('photos')
    } else {
      setError(result.error)
      setStep('idle')
    }
  }

  async function handleBrowsePhotos() {
    const path = await window.api.galleryBrowsePhotos()
    if (path) {
      setPhotoFolder(path)
      setError('')
    }
  }

  async function handleAnalyzeVideo() {
    if (!videoPath) return
    if (!geminiKey) {
      setError('Gemini API key not configured. Add geminiApiKey in Settings.')
      return
    }
    setError('')
    setStep('video')
    const result = await window.api.galleryAnalyzeVideo(videoPath, geminiKey)
    if (result.success) {
      setBoundaries(result.boundaries)
      setStep('photos')
    } else {
      setError(result.error)
      setStep('idle')
    }
  }

  async function handleMatchPhotos() {
    if (!photoFolder) return
    setError('')
    setStep('matching')

    // Read EXIF first
    const exifResult = await window.api.galleryReadExif(photoFolder)
    if (!exifResult.success) {
      setError(exifResult.error)
      setStep('photos')
      return
    }

    // Run matching with manual offset
    const offsetMs = Math.round(manualOffsetMin * 60 * 1000)
    const matchResult = await window.api.galleryMatchPhotos(offsetMs)
    if (matchResult.success) {
      setMatches(matchResult.matches)
      setStep('review')
    } else {
      setError(matchResult.error)
      setStep('photos')
    }
  }

  const handleRematch = useCallback(async () => {
    setError('')
    const offsetMs = Math.round(manualOffsetMin * 60 * 1000)
    const result = await window.api.galleryMatchPhotos(offsetMs)
    if (result.success) {
      setMatches(result.matches)
    } else {
      setError(result.error)
    }
  }, [manualOffsetMin])

  async function handleUpload() {
    if (!galleryTitle.trim()) {
      setError('Enter a gallery title')
      return
    }
    setError('')
    setStep('upload')
    const result = await window.api.galleryUploadToCC(galleryTitle)
    if (result.success) {
      setGalleryUrl(result.galleryUrl)
      setStep('done')
    } else {
      setError(result.error)
      setStep('review')
    }
  }

  function formatDuration(startSec: number, endSec: number): string {
    const dur = endSec - startSec
    const m = Math.floor(dur / 60)
    const s = Math.round(dur % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  function formatHMS(sec: number): string {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.round(sec % 60)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const isProcessing = step === 'video' || step === 'transcribing' || step === 'matching' || step === 'upload' || step === 'uploading-r2'

  return (
    <div className="panel collapsible">
      <details>
        <summary className="panel-header">
          <span>Gallery Builder</span>
          {boundaries.length > 0 && (
            <span className="gallery-badge">{boundaries.length} routines</span>
          )}
          {summary && (
            <span className="gallery-badge gallery-badge-success">{summary.exact + summary.gap} matched</span>
          )}
        </summary>
        <div className="panel-body gallery-panel">
          {/* Progress bar */}
          {progress && isProcessing && (
            <div className="gallery-progress">
              <div className="gallery-progress-bar">
                <div
                  className="gallery-progress-fill"
                  style={{ width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '0%' }}
                />
              </div>
              <div className="gallery-progress-text">{progress.message}</div>
            </div>
          )}

          {/* Step 1: Select video + detect routines */}
          <div className="gallery-section">
            <div className="gallery-section-header">
              <span className={`gallery-step-num ${step === 'idle' || step === 'video' || step === 'transcribing' ? 'active' : boundaries.length > 0 ? 'done' : ''}`}>1</span>
              <span>Detect Routines</span>
            </div>
            <div className="gallery-row">
              <input
                type="text"
                readOnly
                value={videoPaths.length > 1 ? `${videoPaths.length} video files selected` : videoPath}
                placeholder="Select OBS recording(s)..."
                className="input input-sm"
                style={{ flex: 1, fontSize: 10 }}
              />
              <button className="btn btn-sm btn-ghost" onClick={handleBrowseVideos} disabled={isProcessing}>
                Browse
              </button>
            </div>
            {videoPaths.length > 1 && (
              <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>
                {videoPaths.map((p, i) => <div key={i}>Act {i + 1}: {p.split(/[/\\]/).pop()}</div>)}
              </div>
            )}
            {videoPaths.length > 0 && boundaries.length === 0 && (
              <div className="gallery-row" style={{ marginTop: 4, gap: 4 }}>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleTranscribe}
                  disabled={isProcessing}
                  style={{ flex: 1 }}
                >
                  {step === 'transcribing' ? 'Transcribing...' : `Transcribe Audio (${triggers.length} triggers)`}
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={handleAnalyzeVideo}
                  disabled={isProcessing || !videoPath}
                  title="Fallback: use Gemini vision to detect routines"
                  style={{ fontSize: 9 }}
                >
                  {step === 'video' ? '...' : 'Gemini'}
                </button>
              </div>
            )}
          </div>

          {/* Boundaries result */}
          {boundaries.length > 0 && (
            <div className="gallery-section">
              <div className="gallery-section-header">
                <span className="gallery-step-num done">&#10003;</span>
                <span>{boundaries.length} Routines Detected</span>
                <button className="btn btn-xs btn-ghost" onClick={() => setExpandedRoutine(expandedRoutine === -1 ? null : -1)} style={{ marginLeft: 'auto', fontSize: 9 }}>
                  {expandedRoutine === -1 ? 'Collapse' : 'Show all'}
                </button>
              </div>
              <div className="gallery-routine-list">
                {boundaries.map((b, i) => {
                  const photoCount = summary?.byRoutine.get(b.index)?.count || 0
                  const isExpanded = expandedRoutine === -1 || expandedRoutine === i
                  return (
                    <div
                      key={b.index}
                      className={`gallery-routine-item ${isExpanded ? 'expanded' : ''}`}
                      onClick={() => setExpandedRoutine(expandedRoutine === i ? null : i)}
                    >
                      <div className="gallery-routine-row">
                        <span className="gallery-routine-num">{b.index + 1}</span>
                        <span className="gallery-routine-name">{b.name}</span>
                        <span className="gallery-routine-time">
                          {formatHMS(b.videoOffsetStartSec)} — {formatDuration(b.videoOffsetStartSec, b.videoOffsetEndSec)}
                        </span>
                        {photoCount > 0 && (
                          <span className="gallery-badge gallery-badge-sm">{photoCount} photos</span>
                        )}
                      </div>
                      {isExpanded && (
                        <div className="gallery-routine-detail">
                          <span>{b.description}</span>
                          <span className="gallery-routine-confidence">
                            {Math.round(b.confidence * 100)}% confidence
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Step 2: Select photos + offset */}
          {boundaries.length > 0 && (
            <div className="gallery-section">
              <div className="gallery-section-header">
                <span className={`gallery-step-num ${step === 'photos' || step === 'matching' ? 'active' : matches.length > 0 ? 'done' : ''}`}>2</span>
                <span>Match Photos</span>
              </div>
              <div className="gallery-row">
                <input
                  type="text"
                  readOnly
                  value={photoFolder}
                  placeholder="Select photo folder (SD card / DCIM)..."
                  className="input input-sm"
                  style={{ flex: 1, fontSize: 10 }}
                />
                <button className="btn btn-sm btn-ghost" onClick={handleBrowsePhotos} disabled={isProcessing}>
                  Browse
                </button>
              </div>
              <div className="gallery-offset-row">
                <label className="gallery-label">Camera offset (minutes):</label>
                <input
                  type="number"
                  value={manualOffsetMin}
                  onChange={(e) => setManualOffsetMin(parseFloat(e.target.value) || 0)}
                  className="input input-sm"
                  style={{ width: 70, fontSize: 11 }}
                  step={0.5}
                  onMouseDown={(e) => e.stopPropagation()}
                />
                <span className="gallery-offset-hint">
                  {manualOffsetMin < 0 ? `Camera is ${Math.abs(manualOffsetMin)} min ahead` : manualOffsetMin > 0 ? `Camera is ${manualOffsetMin} min behind` : 'No offset'}
                </span>
              </div>
              {photoFolder && (
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleMatchPhotos}
                  disabled={isProcessing}
                  style={{ marginTop: 4 }}
                >
                  {step === 'matching' ? 'Matching...' : 'Read EXIF & Match'}
                </button>
              )}
            </div>
          )}

          {/* Step 3: Review matches */}
          {summary && (
            <div className="gallery-section">
              <div className="gallery-section-header">
                <span className={`gallery-step-num ${step === 'review' ? 'active' : step === 'done' ? 'done' : ''}`}>3</span>
                <span>Review & Upload</span>
              </div>

              {/* Summary stats */}
              <div className="gallery-stats">
                <div className="gallery-stat">
                  <span className="gallery-stat-value">{summary.total}</span>
                  <span className="gallery-stat-label">Total</span>
                </div>
                <div className="gallery-stat gallery-stat-success">
                  <span className="gallery-stat-value">{summary.exact}</span>
                  <span className="gallery-stat-label">Exact</span>
                </div>
                <div className="gallery-stat gallery-stat-warning">
                  <span className="gallery-stat-value">{summary.gap}</span>
                  <span className="gallery-stat-label">Gap</span>
                </div>
                <div className="gallery-stat">
                  <span className="gallery-stat-value">{summary.preShow + summary.intermission}</span>
                  <span className="gallery-stat-label">Pre/Inter</span>
                </div>
                <div className="gallery-stat gallery-stat-danger">
                  <span className="gallery-stat-value">{summary.unmatched}</span>
                  <span className="gallery-stat-label">Unmatched</span>
                </div>
              </div>

              {/* Re-match with different offset */}
              <div className="gallery-offset-row" style={{ marginTop: 6 }}>
                <label className="gallery-label">Adjust offset:</label>
                <input
                  type="number"
                  value={manualOffsetMin}
                  onChange={(e) => setManualOffsetMin(parseFloat(e.target.value) || 0)}
                  className="input input-sm"
                  style={{ width: 70, fontSize: 11 }}
                  step={0.5}
                  onMouseDown={(e) => e.stopPropagation()}
                />
                <button className="btn btn-xs btn-ghost" onClick={handleRematch} disabled={isProcessing}>
                  Re-match
                </button>
              </div>

              {/* Per-routine breakdown */}
              <div className="gallery-routine-list" style={{ marginTop: 6 }}>
                {Array.from(summary.byRoutine.entries())
                  .sort(([a], [b]) => a - b)
                  .map(([idx, { name, count }]) => (
                    <div key={idx} className="gallery-routine-item compact">
                      <span className="gallery-routine-num">{idx + 1}</span>
                      <span className="gallery-routine-name">{name}</span>
                      <span className="gallery-badge gallery-badge-sm">{count}</span>
                    </div>
                  ))}
                {summary.unmatched > 0 && (
                  <div className="gallery-routine-item compact unmatched">
                    <span className="gallery-routine-num">?</span>
                    <span className="gallery-routine-name">Unmatched</span>
                    <span className="gallery-badge gallery-badge-sm gallery-badge-danger">{summary.unmatched}</span>
                  </div>
                )}
              </div>

              {/* Upload */}
              <div style={{ marginTop: 8 }}>
                <input
                  type="text"
                  value={galleryTitle}
                  onChange={(e) => setGalleryTitle(e.target.value)}
                  placeholder="Gallery title (e.g. Spring Recital 2026)"
                  className="input input-sm"
                  style={{ width: '100%', fontSize: 11, marginBottom: 6 }}
                />
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleUpload}
                  disabled={isProcessing || !galleryTitle.trim()}
                  style={{ width: '100%' }}
                >
                  {step === 'upload' ? 'Uploading...' : `Upload ${summary.exact + summary.gap} photos to Gallery`}
                </button>
              </div>
            </div>
          )}

          {/* Done state */}
          {step === 'done' && galleryUrl && (
            <div className="gallery-done">
              <span className="gallery-done-check">&#10003;</span>
              <span>Gallery published!</span>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  window.open(galleryUrl, '_blank')
                }}
                className="gallery-done-link"
              >
                {galleryUrl}
              </a>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="gallery-error">{error}</div>
          )}
        </div>
      </details>
    </div>
  )
}
