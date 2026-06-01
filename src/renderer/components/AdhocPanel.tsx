import { useState, useEffect, useRef } from 'react'
import { IPC } from '../../shared/types'
import '../styles/adhoc.css'

type LastAdhoc = { title: string; subtitle: string; at: number } | null

// Phase D — Ad-hoc freeform overlay.
// Type anything → fire it live to OBS as a one-off lower-third (no saved
// trigger). The readout reflects ad-hoc fires from BOTH this local box AND ones
// arriving via the CC live relay (main pushes OVERLAY_LAST_ADHOC_UPDATE on each
// fire), and offers a one-click copy for easy testing.
export function AdhocPanel() {
  const [collapsed, setCollapsed] = useState(false)
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [last, setLast] = useState<LastAdhoc>(null)
  const [copied, setCopied] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api.overlayGetLastAdhoc().then((l) => setLast(l)).catch(() => { /* ignore */ })
    const onUpdate = (p: unknown) => setLast((p as LastAdhoc) ?? null)
    window.api.on(IPC.OVERLAY_LAST_ADHOC_UPDATE, onUpdate)
    return () => {
      window.api.removeAllListeners(IPC.OVERLAY_LAST_ADHOC_UPDATE)
    }
  }, [])

  async function send() {
    const t = title.trim()
    if (!t) return
    const result = await window.api.overlayFireAdhoc(t, subtitle.trim())
    if (result) setLast(result)
    // Keep the text so the operator can re-fire / tweak; just refocus.
    titleRef.current?.focus()
  }

  function copyLast() {
    if (!last) return
    const text = last.subtitle ? `${last.title}\n${last.subtitle}` : last.title
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => { /* ignore */ })
  }

  return (
    <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
        Ad-hoc Overlay
        <span className="chevron">{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <div className="adhoc-panel">
          <input
            ref={titleRef}
            className="adhoc-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send() }}
            placeholder="Title (required)"
          />
          <input
            className="adhoc-input"
            type="text"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send() }}
            placeholder="Subtitle (optional)"
          />
          <button
            className="btn btn-primary btn-sm adhoc-send"
            onClick={send}
            disabled={!title.trim()}
          >
            Send to OBS
          </button>

          <div className="adhoc-readout">
            <div className="adhoc-readout-head">
              <span className="adhoc-readout-label">Last sent</span>
              {last && (
                <button className="btn btn-ghost btn-sm adhoc-copy" onClick={copyLast}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
            {last ? (
              <div className="adhoc-readout-body">
                <div className="adhoc-readout-title">{last.title}</div>
                {last.subtitle && <div className="adhoc-readout-subtitle">{last.subtitle}</div>}
              </div>
            ) : (
              <div className="adhoc-readout-empty">Nothing sent yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
