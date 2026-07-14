import React from 'react'
import { api } from '../store.js'
import { ManaCost, groupByType, typeColor, plural, sortDeckRows } from '../mtg.jsx'

// Compact read-only view of a stored decklist. Clicking a card zooms it on the
// card-viewer overlay, which makes this the fastest path from "caster mentions
// a card" to "card is on screen".
export default function DeckSummary({ deck }) {
  if (!deck || (deck.main ?? []).length === 0) {
    return <div className="deck-empty">No decklist imported</div>
  }

  const zoom = (identifier) => api.overlay({ cardZoom: identifier }).catch(() => {})

  const mainCount = deck.main.reduce((n, r) => n + r.count, 0)
  const sideCount = (deck.side ?? []).reduce((n, r) => n + r.count, 0)

  return (
    <div className="deck-summary">
      <div className="ds-counts">
        {mainCount} main{sideCount > 0 && ` · ${sideCount} side`}
        {deck.unresolved?.length > 0 && (
          <span className="warn"> · {deck.unresolved.length} unresolved</span>
        )}
      </div>

      <div className="ds-scroll">
        {groupByType(deck.main).map(([type, rows]) => {
          const total = rows.reduce((n, r) => n + r.count, 0)
          return (
            <div key={type} className="ds-group">
              <div className="ds-group-title" style={{ color: typeColor(type) }}>
                {plural(type, total)} ({total})
              </div>
              {sortDeckRows(rows).map(r => (
                <button key={r.identifier} className="ds-row" onClick={() => zoom(r.identifier)} title="Zoom on stream">
                  <span className="ds-count">{r.count}</span>
                  <span className="ds-name">{r.name}</span>
                  <ManaCost cost={r.manaCost} size={12} />
                </button>
              ))}
            </div>
          )
        })}

        {(deck.side ?? []).length > 0 && (
          <div className="ds-group">
            <div className="ds-group-title" style={{ color: '#d4af37' }}>
              Sideboard ({sideCount})
            </div>
            {sortDeckRows(deck.side).map(r => (
              <button key={r.identifier} className="ds-row" onClick={() => zoom(r.identifier)} title="Zoom on stream">
                <span className="ds-count">{r.count}</span>
                <span className="ds-name">{r.name}</span>
                <ManaCost cost={r.manaCost} size={12} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
