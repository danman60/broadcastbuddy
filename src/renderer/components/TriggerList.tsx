import { useStore } from '../store/useStore'
import type { Trigger } from '../../shared/types'
import '../styles/triggerlist.css'

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function TriggerList() {
  const { triggers, selectedIndex } = useStore()

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

  return (
    <>
      <div className="trigger-list-header">
        <h3>Triggers</h3>
        <button className="btn btn-primary btn-sm" onClick={handleAdd}>+ Add</button>
      </div>
      <div className="trigger-list-scroll">
        {triggers.length === 0 ? (
          <div className="trigger-list-empty">No triggers yet</div>
        ) : (
          triggers.map((t, i) => (
            <div
              key={t.id}
              className={`trigger-item ${i === selectedIndex ? 'selected' : ''}`}
              onClick={() => handleSelect(i)}
            >
              <span className="trigger-item-number">{i + 1}</span>
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
          ))
        )}
      </div>
    </>
  )
}
