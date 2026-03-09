import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import type { CCEvent, BroadcastPackage } from '../../shared/types'

export function BroadcastPackagePanel() {
  const settings = useStore((s) => s.settings)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [events, setEvents] = useState<CCEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

  useEffect(() => {
    if (settings?.ccConfig) {
      setBaseUrl(settings.ccConfig.baseUrl || '')
      setApiKey(settings.ccConfig.apiKey || '')
      setTenantId(settings.ccConfig.tenantId || '')
    }
  }, [settings])

  function saveConfig() {
    window.api.settingsSet('ccConfig', { baseUrl, apiKey, tenantId })
  }

  async function fetchEvents() {
    if (!baseUrl || !apiKey || !tenantId) {
      setError('Fill in all connection fields')
      return
    }
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      saveConfig()
      const result = await window.api.ccFetchEvents(baseUrl, apiKey, tenantId)
      if (!result.success) {
        setError(result.error || 'Failed to fetch events')
        return
      }
      setEvents(result.events || [])
      if (result.events?.length === 0) {
        setError('No upcoming events found')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function applyPackage(eventId: string) {
    setError('')
    setSuccess('')
    setApplying(true)
    setSelectedEventId(eventId)
    try {
      const result = await window.api.ccFetchPackage(baseUrl, apiKey, tenantId, eventId)
      if (!result.success) {
        setError(result.error || 'Failed to fetch package')
        return
      }
      const pkg = result.package as BroadcastPackage
      const applyResult = await window.api.ccApplyPackage(pkg)
      if (applyResult.success) {
        setSuccess(`Loaded ${applyResult.triggerCount} triggers from "${pkg.event.eventName}"`)
      } else {
        setError('Failed to apply package')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setApplying(false)
      setSelectedEventId(null)
    }
  }

  return (
    <div className="panel collapsible">
      <details>
        <summary className="panel-header">
          <span>Command Center</span>
        </summary>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <input
              type="text"
              placeholder="CC Base URL (e.g. https://cc.example.com)"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="input input-sm"
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type="password"
                placeholder="API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="input input-sm"
                style={{ flex: 1 }}
              />
              <input
                type="text"
                placeholder="Tenant ID"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                className="input input-sm"
                style={{ flex: 1 }}
              />
            </div>
          </div>

          <button
            className="btn btn-sm btn-primary"
            onClick={fetchEvents}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Fetch Events'}
          </button>

          {error && (
            <div style={{ color: 'var(--danger)', fontSize: 11 }}>{error}</div>
          )}
          {success && (
            <div style={{ color: 'var(--success, #4ade80)', fontSize: 11 }}>{success}</div>
          )}

          {events.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {events.map((ev) => (
                <div
                  key={ev.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    background: 'var(--bg-input)',
                    borderRadius: 'var(--radius)',
                    fontSize: 11,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {ev.eventName}
                    </div>
                    <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>
                      {ev.client.organization} &middot; {ev.venueName}
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => applyPackage(ev.id)}
                    disabled={applying}
                    style={{ fontSize: 10 }}
                  >
                    {applying && selectedEventId === ev.id ? 'Applying...' : 'Load'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  )
}
