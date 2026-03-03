import { useState, useMemo } from 'react'
import { useStore } from '../store/useStore'
import type { Trigger } from '../../shared/types'
import '../styles/triggerlist.css'

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

interface CategoryGroup {
  category: string
  items: Array<{ trigger: Trigger; originalIndex: number }>
}

function groupByCategory(triggers: Trigger[]): CategoryGroup[] {
  const groups: CategoryGroup[] = []
  const map = new Map<string, CategoryGroup>()

  for (let i = 0; i < triggers.length; i++) {
    const t = triggers[i]
    const cat = t.category || ''
    let group = map.get(cat)
    if (!group) {
      group = { category: cat, items: [] }
      map.set(cat, group)
      groups.push(group)
    }
    group.items.push({ trigger: t, originalIndex: i })
  }

  return groups
}

export function TriggerList() {
  const { triggers, selectedIndex, playedIds } = useStore()
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const playedSet = useMemo(() => new Set(playedIds), [playedIds])

  const groups = useMemo(() => groupByCategory(triggers), [triggers])
  const hasMultipleCategories = groups.length > 1 || (groups.length === 1 && groups[0].category !== '')

  async function handleAdd() {
    const newTrigger: Trigger = {
      id: generateId(),
      name: `Trigger ${triggers.length + 1}`,
      title: '',
      subtitle: '',
      category: '',
      order: triggers.length,
      logoDataUrl: '',
    }
    await window.api.triggerAdd(newTrigger)
  }

  async function handleSelect(index: number) {
    await window.api.triggerSelect(index)
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await window.api.triggerDelete(id)
  }

  // ── Drag and drop ──────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent, id: string) {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id !== dragId) {
      setDragOverId(id)
    }
  }

  function handleDragLeave() {
    setDragOverId(null)
  }

  async function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    setDragOverId(null)

    if (!dragId || dragId === targetId) return

    const ids = triggers.map((t) => t.id)
    const fromIdx = ids.indexOf(dragId)
    const toIdx = ids.indexOf(targetId)
    if (fromIdx === -1 || toIdx === -1) return

    // Reorder: remove from old pos, insert at new pos
    ids.splice(fromIdx, 1)
    ids.splice(toIdx, 0, dragId)

    await window.api.triggerReorder(ids)
  }

  function handleDragEnd() {
    setDragId(null)
    setDragOverId(null)
  }

  // ── Render helpers ─────────────────────────────────────────────

  function renderTriggerItem(t: Trigger, originalIndex: number) {
    const isPlayed = playedSet.has(t.id)
    const isDragging = dragId === t.id
    const isDragOver = dragOverId === t.id

    const classes = [
      'trigger-item',
      originalIndex === selectedIndex ? 'selected' : '',
      isPlayed ? 'played' : '',
      isDragging ? 'dragging' : '',
      isDragOver ? 'drag-over' : '',
    ].filter(Boolean).join(' ')

    return (
      <div
        key={t.id}
        className={classes}
        onClick={() => handleSelect(originalIndex)}
        draggable
        onDragStart={(e) => handleDragStart(e, t.id)}
        onDragOver={(e) => handleDragOver(e, t.id)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, t.id)}
        onDragEnd={handleDragEnd}
      >
        <span className="trigger-item-grip" title="Drag to reorder">&#x2801;&#x2801;</span>
        <span className="trigger-item-number">
          {isPlayed && <span className="trigger-item-check">&#x2713;</span>}
          {originalIndex + 1}
        </span>
        <div className="trigger-item-info">
          <div className="trigger-item-name">{t.name || t.title || 'Untitled'}</div>
          {t.subtitle && (
            <div className="trigger-item-subtitle">{t.subtitle}</div>
          )}
        </div>
        <button
          className="trigger-item-delete"
          onClick={(e) => handleDelete(e, t.id)}
          title="Delete trigger"
        >
          x
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="trigger-list-header">
        <h3>Playlist</h3>
        <button className="btn btn-primary btn-sm" onClick={handleAdd}>+ Add</button>
      </div>
      <div className="trigger-list-scroll">
        {triggers.length === 0 ? (
          <div className="trigger-list-empty">No entries yet</div>
        ) : hasMultipleCategories ? (
          groups.map((group) => (
            <div key={group.category || '__uncategorized'} className="trigger-category-group">
              <div className="trigger-category-header">
                {group.category || 'Uncategorized'}
              </div>
              {group.items.map(({ trigger, originalIndex }) =>
                renderTriggerItem(trigger, originalIndex)
              )}
            </div>
          ))
        ) : (
          triggers.map((t, i) => renderTriggerItem(t, i))
        )}
      </div>
    </>
  )
}
