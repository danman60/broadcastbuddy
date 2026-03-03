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

    // Update local state
    switch (field) {
      case 'name': setName(value); break
      case 'title': setTitle(value); break
      case 'subtitle': setSubtitle(value); break
      case 'category': setCategory(value); break
    }

    // Push to main process
    await window.api.triggerUpdate(selected.id, { [field]: value })
  }

  if (!selected) {
    return (
      <div className="panel-section">
        <div className="panel-section-title">Edit Trigger</div>
        <div className="trigger-editor-empty">Select a trigger to edit</div>
      </div>
    )
  }

  return (
    <div className="panel-section">
      <div className="panel-section-title">Edit Trigger</div>
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
          <label>Title (main line)</label>
          <input
            value={title}
            onChange={(e) => handleChange('title', e.target.value)}
            placeholder="Main text on overlay..."
          />
        </div>
        <div className="field-row">
          <label>Subtitle (secondary line)</label>
          <input
            value={subtitle}
            onChange={(e) => handleChange('subtitle', e.target.value)}
            placeholder="Secondary text..."
          />
        </div>
      </div>
    </div>
  )
}
