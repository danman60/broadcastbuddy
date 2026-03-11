import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../store/useStore'
import type { CCEvent, BroadcastPackage, CCChecklistItem } from '../../shared/types'

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

  // Active package state
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const [activeEventName, setActiveEventName] = useState('')
  const [checklist, setChecklist] = useState<CCChecklistItem[]>([])
  const [checklistSyncing, setChecklistSyncing] = useState(false)
  const [overlayConfigSaving, setOverlayConfigSaving] = useState(false)
  const [overlayConfigStatus, setOverlayConfigStatus] = useState('')

  useEffect(() => {
    if (settings?.ccConfig) {
      setBaseUrl(settings.ccConfig.baseUrl || '')
      setApiKey(settings.ccConfig.apiKey || '')
      setTenantId(settings.ccConfig.tenantId || '')
    }
  }, [settings])

  // Listen for checklist updates from main process
  useEffect(() => {
    window.api.on('cc:checklist-update', (items: unknown) => {
      setChecklist(items as CCChecklistItem[])
    })
    window.api.on('cc:package-applied', (info: unknown) => {
      const data = info as { eventId: string; eventName: string }
      setActiveEventId(data.eventId)
      setActiveEventName(data.eventName)
    })
    // Listen for push from CC via WebSocket — auto-apply
    window.api.on('cc:package-pushed', async (pkg: unknown) => {
      const data = pkg as BroadcastPackage
      try {
        const result = await window.api.ccApplyPackage(data, data.eventId)
        if (result.success) {
          setSuccess(`Auto-applied ${result.triggerCount} triggers from CC push: "${data.event.eventName}"`)
        }
      } catch {
        setSuccess(`Package pushed from CC: "${data.event.eventName}" (manual apply needed)`)
      }
      setActiveEventId(data.eventId)
      setActiveEventName(data.event.eventName)
      setChecklist(data.checklist || [])
    })
    return () => {
      window.api.removeAllListeners('cc:checklist-update')
      window.api.removeAllListeners('cc:package-applied')
      window.api.removeAllListeners('cc:package-pushed')
    }
  }, [])

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
      const applyResult = await window.api.ccApplyPackage(pkg, eventId)
      if (applyResult.success) {
        setSuccess(`Loaded ${applyResult.triggerCount} triggers from "${pkg.event.eventName}"`)
        setActiveEventId(pkg.eventId || eventId)
        setActiveEventName(pkg.event.eventName)
        setChecklist(pkg.checklist || [])
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

  const toggleChecklistItem = useCallback(async (itemId: string) => {
    // Optimistic update
    setChecklist((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, checked: !item.checked } : item
      )
    )
  }, [])

  async function syncChecklist() {
    if (!activeEventId || !baseUrl || !apiKey || !tenantId) return
    setChecklistSyncing(true)
    try {
      const items = checklist.map((c) => ({ id: c.id, checked: c.checked }))
      const result = await window.api.ccSyncChecklist(baseUrl, apiKey, tenantId, activeEventId, items)
      if (!result.success) {
        setError(`Checklist sync failed: ${result.error}`)
      } else {
        setSuccess(`Synced ${result.updated} checklist items to CC`)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setChecklistSyncing(false)
    }
  }

  async function saveOverlayConfig() {
    if (!activeEventId || !baseUrl || !apiKey || !tenantId) return
    setOverlayConfigSaving(true)
    setOverlayConfigStatus('')
    try {
      // Get current styling from overlay state
      const state = await window.api.overlayGetState()
      const config = state?.lowerThird?.styling || {}
      const result = await window.api.ccSaveOverlayConfig(baseUrl, apiKey, tenantId, activeEventId, config)
      if (result.success) {
        setOverlayConfigStatus('Saved')
        setTimeout(() => setOverlayConfigStatus(''), 3000)
      } else {
        setOverlayConfigStatus(`Failed: ${result.error}`)
      }
    } catch (err) {
      setOverlayConfigStatus((err as Error).message)
    } finally {
      setOverlayConfigSaving(false)
    }
  }

  const checkedCount = checklist.filter((c) => c.checked).length

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

          {/* Active package info + actions */}
          {activeEventId && (
            <>
              <div
                style={{
                  borderTop: '1px solid var(--border)',
                  paddingTop: 8,
                  marginTop: 4,
                }}
              >
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>
                  Active: <strong style={{ color: 'var(--text-primary)' }}>{activeEventName}</strong>
                </div>

                {/* Checklist */}
                {checklist.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                        Checklist {checkedCount}/{checklist.length}
                      </span>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={syncChecklist}
                        disabled={checklistSyncing}
                        style={{ fontSize: 9, padding: '2px 6px' }}
                      >
                        {checklistSyncing ? 'Syncing...' : 'Sync to CC'}
                      </button>
                    </div>
                    {/* Progress bar */}
                    <div style={{ height: 3, background: 'var(--bg-input)', borderRadius: 2, marginBottom: 4 }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${checklist.length > 0 ? (checkedCount / checklist.length) * 100 : 0}%`,
                          background: 'var(--success, #4ade80)',
                          borderRadius: 2,
                          transition: 'width 0.3s',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 150, overflowY: 'auto' }}>
                      {checklist.map((item) => (
                        <label
                          key={item.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 10,
                            cursor: 'pointer',
                            padding: '2px 4px',
                            borderRadius: 'var(--radius)',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={item.checked}
                            onChange={() => toggleChecklistItem(item.id)}
                            style={{ width: 12, height: 12 }}
                          />
                          <span
                            style={{
                              color: item.checked ? 'var(--text-dim)' : 'var(--text-primary)',
                              textDecoration: item.checked ? 'line-through' : 'none',
                            }}
                          >
                            {item.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Save overlay config */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={saveOverlayConfig}
                    disabled={overlayConfigSaving}
                    style={{ fontSize: 10 }}
                  >
                    {overlayConfigSaving ? 'Saving...' : 'Save Overlay Config to CC'}
                  </button>
                  {overlayConfigStatus && (
                    <span style={{ fontSize: 9, color: overlayConfigStatus === 'Saved' ? 'var(--success, #4ade80)' : 'var(--danger)' }}>
                      {overlayConfigStatus}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </details>
    </div>
  )
}
