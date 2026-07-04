import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Trigger, TriggerCameraMove } from '../../shared/types'
import '../styles/triggereditor.css'

export function TriggerEditor() {
  const { triggers, selectedIndex } = useStore()
  const selected: Trigger | null =
    selectedIndex >= 0 && selectedIndex < triggers.length ? triggers[selectedIndex] : null

  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [category, setCategory] = useState('')
  const [dancerCount, setDancerCount] = useState('')
  // Camera move attached to this trigger (fires with it). '' = none.
  const [moveKind, setMoveKind] = useState<'' | 'sweep' | 'replay'>('')
  const [moveFrom, setMoveFrom] = useState('')
  const [moveTo, setMoveTo] = useState('')
  const [moveSeconds, setMoveSeconds] = useState('')
  const [moveWaypoints, setMoveWaypoints] = useState('')
  const [moveId, setMoveId] = useState('')
  // Collapse to just the header when nothing is selected (reclaims empty space);
  // auto-expand when an entry is picked.
  const [collapsed, setCollapsed] = useState(true)

  // Sync local state when selection changes
  useEffect(() => {
    if (selected) {
      setName(selected.name)
      setTitle(selected.title)
      setSubtitle(selected.subtitle)
      setCategory(selected.category)
      setDancerCount(selected.dancerCount !== undefined ? String(selected.dancerCount) : '')
      const cm = selected.cameraMove
      setMoveKind(cm?.kind ?? '')
      setMoveFrom(cm?.from !== undefined ? String(cm.from) : '')
      setMoveTo(cm?.to !== undefined ? String(cm.to) : '')
      setMoveSeconds(cm?.ms !== undefined ? String(Math.round(cm.ms / 1000)) : '')
      setMoveWaypoints(cm?.waypoints?.join(',') ?? '')
      setMoveId(cm?.moveId !== undefined ? String(cm.moveId) : '')
      setCollapsed(false)
    } else {
      setCollapsed(true)
    }
  }, [selected?.id, selectedIndex])

  async function handleChange(field: keyof Trigger, value: string) {
    if (!selected) return

    switch (field) {
      case 'name': setName(value); break
      case 'title': setTitle(value); break
      case 'subtitle': setSubtitle(value); break
      case 'category': setCategory(value); break
    }

    await window.api.triggerUpdate(selected.id, { [field]: value })
  }

  // Numeric dancer-count handler — empty / non-numeric clears the field
  // (persists undefined). Drives OBSBOT camera framing on fire when a camera
  // host is configured; otherwise has no effect.
  async function handleDancerCountChange(value: string) {
    if (!selected) return
    setDancerCount(value)
    const n = parseInt(value, 10)
    await window.api.triggerUpdate(selected.id, { dancerCount: Number.isNaN(n) ? undefined : n })
  }

  // Persist the camera-move block from the CURRENT field values (pass overrides
  // for the field being edited — state updates are async).
  async function persistCameraMove(patch: {
    kind?: '' | 'sweep' | 'replay'
    from?: string
    to?: string
    seconds?: string
    waypoints?: string
    moveId?: string
  }) {
    if (!selected) return
    const kind = patch.kind ?? moveKind
    if (!kind) {
      await window.api.triggerUpdate(selected.id, { cameraMove: undefined })
      return
    }
    const num = (v: string): number | undefined => {
      const n = parseInt(v, 10)
      return Number.isNaN(n) ? undefined : n
    }
    const move: TriggerCameraMove =
      kind === 'sweep'
        ? {
            kind,
            from: num(patch.from ?? moveFrom),
            to: num(patch.to ?? moveTo),
            ms: (num(patch.seconds ?? moveSeconds) ?? 0) > 0 ? (num(patch.seconds ?? moveSeconds) as number) * 1000 : undefined,
            waypoints: (patch.waypoints ?? moveWaypoints)
              .split(',')
              .map((t) => parseInt(t.trim(), 10))
              .filter((n) => Number.isInteger(n) && n >= 1 && n <= 254),
          }
        : { kind, moveId: num(patch.moveId ?? moveId) }
    await window.api.triggerUpdate(selected.id, { cameraMove: move })
  }

  async function handleBrowseLogo() {
    if (!selected) return
    await window.api.triggerSetLogo(selected.id)
  }

  async function handleClearLogo() {
    if (!selected) return
    await window.api.triggerUpdate(selected.id, { logoDataUrl: '' })
  }

  if (!selected) {
    return (
      <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
        <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
          Edit Entry
          <span className="chevron">{collapsed ? '\u25B8' : '\u25BE'}</span>
        </div>
        {!collapsed && (
          <div className="trigger-editor-empty">Select an entry to edit</div>
        )}
      </div>
    )
  }

  return (
    <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
        Edit Entry
        <span className="chevron">{collapsed ? '\u25B8' : '\u25BE'}</span>
      </div>
      {!collapsed && (
        <div className="trigger-editor">
          <div className="field-row-inline">
            <div className="field-row">
              <label>Name (list label)</label>
              <input
                value={name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="Display name..."
              />
            </div>
            <div className="field-row">
              <label>Category</label>
              <input
                value={category}
                onChange={(e) => handleChange('category', e.target.value)}
                placeholder="Group..."
              />
            </div>
            <div className="field-row">
              <label>Dancer Count</label>
              <input
                type="number"
                min={0}
                value={dancerCount}
                onChange={(e) => handleDancerCountChange(e.target.value)}
                placeholder="# dancers..."
              />
            </div>
          </div>
          <div className="field-row">
            <label>Primary (main line)</label>
            <input
              value={title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="Song name, speaker name, act title..."
            />
          </div>
          <div className="field-row">
            <label>Secondary (sub line)</label>
            <input
              value={subtitle}
              onChange={(e) => handleChange('subtitle', e.target.value)}
              placeholder="Dancers, company/role, description..."
            />
          </div>
          <div className="field-row">
            <label>Camera Move on Fire (optional — PTZ cue fires with this entry)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <select
                value={moveKind}
                onChange={(e) => {
                  const k = e.target.value as '' | 'sweep' | 'replay'
                  setMoveKind(k)
                  void persistCameraMove({ kind: k })
                }}
              >
                <option value="">None</option>
                <option value="sweep">Sweep preset → preset</option>
                <option value="replay">Replay recorded move</option>
              </select>
              {moveKind === 'sweep' && (
                <>
                  <input
                    type="number" min={1} max={254} value={moveFrom} placeholder="From P"
                    style={{ width: 62 }}
                    onChange={(e) => { setMoveFrom(e.target.value); void persistCameraMove({ from: e.target.value }) }}
                  />
                  <input
                    type="number" min={1} max={254} value={moveTo} placeholder="To P"
                    style={{ width: 62 }}
                    onChange={(e) => { setMoveTo(e.target.value); void persistCameraMove({ to: e.target.value }) }}
                  />
                  <input
                    type="number" min={1} max={120} value={moveSeconds} placeholder="sec"
                    style={{ width: 56 }}
                    onChange={(e) => { setMoveSeconds(e.target.value); void persistCameraMove({ seconds: e.target.value }) }}
                  />
                  <input
                    type="text" value={moveWaypoints} placeholder="waypoints 7,8"
                    style={{ width: 110 }}
                    onChange={(e) => { setMoveWaypoints(e.target.value); void persistCameraMove({ waypoints: e.target.value }) }}
                  />
                </>
              )}
              {moveKind === 'replay' && (
                <input
                  type="number" min={1} value={moveId} placeholder="move id"
                  style={{ width: 80 }}
                  onChange={(e) => { setMoveId(e.target.value); void persistCameraMove({ moveId: e.target.value }) }}
                />
              )}
            </div>
          </div>
          <div className="field-row">
            <label>Entry Logo (optional — overrides client logo when fired)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {selected.logoDataUrl ? (
                <>
                  <img
                    src={selected.logoDataUrl}
                    alt="Entry logo"
                    style={{ maxHeight: 32, maxWidth: 80, borderRadius: 4 }}
                  />
                  <button className="btn btn-ghost btn-sm" onClick={handleClearLogo}>Clear</button>
                </>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={handleBrowseLogo}>Browse...</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
