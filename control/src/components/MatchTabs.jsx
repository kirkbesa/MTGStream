import React, { useState } from 'react'
import { api } from '../store.js'

export default function MatchTabs({ state, editIndex, onSelect }) {
  const [renaming, setRenaming] = useState(null)
  const [draft, setDraft] = useState('')
  const [confirmDel, setConfirmDel] = useState(null)

  const live = state.activeMatchIndex ?? 0

  function startRename(i, label) {
    setRenaming(i)
    setDraft(label)
  }

  async function commitRename(i) {
    await api.renameMatch(i, draft.trim() || `Feature Match ${state.matches[i].id}`).catch(() => {})
    setRenaming(null)
  }

  async function remove(i) {
    // Two-step confirm — deleting a prepped slot mid-event loses its decklists.
    if (confirmDel !== i) {
      setConfirmDel(i)
      setTimeout(() => setConfirmDel(c => (c === i ? null : c)), 3000)
      return
    }
    setConfirmDel(null)
    await api.removeMatch(i).catch(() => {})
    if (editIndex >= state.matches.length - 1) onSelect(Math.max(0, state.matches.length - 2))
  }

  return (
    <div className="match-tabs">
      {state.matches.map((m, i) => (
        <div
          key={m.id}
          className={`mtab${i === editIndex ? ' editing' : ''}${i === live ? ' live' : ''}`}
          onClick={() => onSelect(i)}
        >
          {i === live && <span className="live-dot" title="On air" />}

          {renaming === i ? (
            <input
              autoFocus
              className="mtab-rename"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={() => commitRename(i)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename(i)
                if (e.key === 'Escape') setRenaming(null)
              }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span
              className="mtab-label"
              onDoubleClick={e => { e.stopPropagation(); startRename(i, m.label) }}
              title="Double-click to rename"
            >
              {m.label}
            </span>
          )}

          {state.matches.length > 1 && (
            <button
              className={`mtab-x${confirmDel === i ? ' confirm' : ''}`}
              title={confirmDel === i ? 'Click again to delete' : 'Delete slot'}
              onClick={e => { e.stopPropagation(); remove(i) }}
            >
              {confirmDel === i ? '!' : '×'}
            </button>
          )}
        </div>
      ))}

      <button className="mtab add" onClick={() => api.addMatch().catch(() => {})}>
        + Add
      </button>

      {editIndex !== live && (
        <button
          className="btn primary go-live"
          onClick={() => api.setActive(editIndex).catch(() => {})}
        >
          Take {state.matches[editIndex]?.label} live
        </button>
      )}
    </div>
  )
}
