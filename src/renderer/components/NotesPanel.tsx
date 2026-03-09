import { useState, useEffect, useRef } from 'react'
import type { Note } from '../../shared/types'
import '../styles/notes.css'

export function NotesPanel() {
  const [notes, setNotes] = useState<Note[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [input, setInput] = useState('')
  const [obsConnected, setObsConnected] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadNotes()
    checkObs()
  }, [])

  async function loadNotes() {
    const list = await window.api.notesList()
    setNotes(list || [])
  }

  async function checkObs() {
    const status = await window.api.obsStatus()
    setObsConnected(status?.connected || false)
  }

  async function addNote() {
    const text = input.trim()
    if (!text) return
    const note = await window.api.notesAdd(text)
    if (note) {
      setNotes((prev) => [note, ...prev])
      setInput('')
      inputRef.current?.focus()
    }
  }

  async function deleteNote(id: string) {
    await window.api.notesDelete(id)
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  function formatTime(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div className={`panel-section${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-section-title" onClick={() => setCollapsed(!collapsed)}>
        Notes
        <span className="notes-count">{notes.length > 0 ? notes.length : ''}</span>
        <span className="chevron">{collapsed ? '\u25B8' : '\u25BE'}</span>
      </div>
      {!collapsed && (
        <div className="notes-panel">
          <div className="notes-input-row">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addNote() }}
              placeholder={obsConnected ? 'Add note (with OBS timecode)...' : 'Add note...'}
            />
            <button className="btn btn-primary btn-sm" onClick={addNote}>
              Add
            </button>
          </div>

          <div className="notes-status-row">
            <span className={`obs-status-dot ${obsConnected ? 'connected' : ''}`} />
            <span className="obs-status-text">
              {obsConnected ? 'OBS Connected' : 'OBS Not Connected'}
            </span>
          </div>

          <div className="notes-list">
            {notes.length === 0 ? (
              <div className="notes-empty">No notes yet</div>
            ) : (
              notes.map((note) => (
                <div key={note.id} className="note-item">
                  <div className="note-header">
                    <span className="note-time">
                      {note.obsTimecode ? (
                        <span className="note-timecode">{note.obsTimecode}</span>
                      ) : (
                        formatTime(note.createdAt)
                      )}
                    </span>
                    <button
                      className="note-delete"
                      onClick={() => deleteNote(note.id)}
                    >
                      x
                    </button>
                  </div>
                  <div className="note-text">{note.text}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
