import { useState, useEffect } from 'react'
import type { StreamConfig } from '../../shared/types'
import '../styles/streamInfo.css'

export function StreamInfoPanel() {
  const [config, setConfig] = useState<StreamConfig>({
    streamKey: '',
    rtmpUrl: '',
    viewingLink: '',
    embedCode: '',
    chatLink: '',
  })
  const [collapsed, setCollapsed] = useState(true)
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState('')
  const [obsStatus, setObsStatus] = useState<'idle' | 'pushing' | 'done' | 'error'>('idle')
  const [obsError, setObsError] = useState('')

  useEffect(() => {
    window.api.streamConfigGet().then((c: StreamConfig | null) => {
      if (c) setConfig(c)
    })
  }, [])

  function handleChange(field: keyof StreamConfig, value: string) {
    const updated = { ...config, [field]: value }
    setConfig(updated)
    window.api.streamConfigSet(updated)
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(''), 1500)
  }

  async function pushToObs() {
    if (!config.rtmpUrl && !config.streamKey) return
    setObsStatus('pushing')
    setObsError('')
    const result = await window.api.obsPushStreamKey(config.rtmpUrl, config.streamKey)
    if (result?.success) {
      setObsStatus('done')
      setTimeout(() => setObsStatus('idle'), 2000)
    } else {
      setObsStatus('error')
      setObsError(result?.error || 'Failed to push to OBS')
      setTimeout(() => setObsStatus('idle'), 3000)
    }
  }

  return (
    <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
        Stream Info
        <span className="chevron">{collapsed ? '\u25B8' : '\u25BE'}</span>
      </div>
      {!collapsed && (
        <div className="stream-info-panel">
          <div className="stream-field">
            <label>RTMP URL</label>
            <input
              type="text"
              value={config.rtmpUrl}
              onChange={(e) => handleChange('rtmpUrl', e.target.value)}
              placeholder="rtmp://..."
            />
          </div>

          <div className="stream-field">
            <label>Stream Key</label>
            <div className="stream-key-row">
              <input
                type={showKey ? 'text' : 'password'}
                value={config.streamKey}
                onChange={(e) => handleChange('streamKey', e.target.value)}
                placeholder="Enter stream key"
              />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* Push to OBS */}
          {(config.rtmpUrl || config.streamKey) && (
            <div className="stream-obs-push">
              <button
                className={`btn btn-sm ${obsStatus === 'done' ? 'btn-success' : obsStatus === 'error' ? 'btn-danger' : 'btn-primary'}`}
                onClick={pushToObs}
                disabled={obsStatus === 'pushing'}
              >
                {obsStatus === 'pushing' ? 'Pushing...'
                  : obsStatus === 'done' ? 'Pushed to OBS'
                  : obsStatus === 'error' ? 'Failed'
                  : 'Push to OBS'}
              </button>
              {obsError && <span className="stream-obs-error">{obsError}</span>}
              <span className="stream-obs-hint">Sets stream service in OBS via WebSocket</span>
            </div>
          )}

          <div className="stream-field">
            <label>Viewing Link</label>
            <div className="stream-copy-row">
              <input
                type="text"
                value={config.viewingLink}
                onChange={(e) => handleChange('viewingLink', e.target.value)}
                placeholder="https://..."
              />
              {config.viewingLink && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => copyToClipboard(config.viewingLink, 'link')}
                >
                  {copied === 'link' ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
          </div>

          <div className="stream-field">
            <label>Embed Code</label>
            <div className="stream-copy-row">
              <textarea
                value={config.embedCode}
                onChange={(e) => handleChange('embedCode', e.target.value)}
                placeholder="<iframe ...>"
                rows={2}
              />
              {config.embedCode && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => copyToClipboard(config.embedCode, 'embed')}
                >
                  {copied === 'embed' ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
          </div>

          <div className="stream-field">
            <label>Chat Link</label>
            <div className="stream-copy-row">
              <input
                type="text"
                value={config.chatLink}
                onChange={(e) => handleChange('chatLink', e.target.value)}
                placeholder="https://..."
              />
              {config.chatLink && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => copyToClipboard(config.chatLink, 'chat')}
                >
                  {copied === 'chat' ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
