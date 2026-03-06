import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Trigger } from '../../shared/types'
import '../styles/triggereditor.css'

export function TriggerEditor() {
  const { triggers, selectedIndex } = useStore()
  const selected: Trigger | null =
    selectedIndex >= 0 && selectedIndex < triggers.length ? triggers[selectedIndex] : null

  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [category, setCategory] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  // Sync local state when selection changes
  useEffect(() => {
    if (selected) {
      setName(selected.name)
      setTitle(selected.title)
      setSubtitle(selected.subtitle)
      setCategory(selected.category)
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
