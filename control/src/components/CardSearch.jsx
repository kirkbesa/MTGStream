import React, { useEffect, useState, useRef } from 'react'
import { api } from '../store.js'
import { ManaCost, typeColor } from '../mtg.jsx'

export default function CardSearch({ state }) {
  const [q, setQ]             = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')

  const zoomed = state.overlay?.cardZoom ?? null

  // Debounced so typing "lightning bolt" is one Scryfall call, not thirteen —
  // the server serialises requests at 100ms each, so an undebounced search
  // would queue up behind itself and feel broken.
  const timer = useRef(null)
  useEffect(() => {
    clearTimeout(timer.current)
    if (!q.trim()) { setResults([]); setError(''); return }

    timer.current = setTimeout(async () => {
      setBusy(true)
      setError('')
      try {
        setResults(await api.searchCards(q))
      } catch (e) {
        setError(e.message)
        setResults([])
      }
      setBusy(false)
    }, 250)

    return () => clearTimeout(timer.current)
  }, [q])

  const zoom = (id) => api.overlay({ cardZoom: zoomed === id ? null : id }).catch(() => {})

  return (
    <section className="card">
      <div className="row search-row">
        <input
          className="search"
          placeholder="Search a card to put on stream…"
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
        />
        {zoomed && (
          <button className="btn" onClick={() => api.overlay({ cardZoom: null })}>
            Clear zoom
          </button>
        )}
      </div>

      {busy   && <div className="muted">Searching…</div>}
      {error  && <div className="err">{error}</div>}
      {!busy && !error && q.trim() && results.length === 0 && (
        <div className="muted">No format-legal cards match “{q}”.</div>
      )}

      <div className="results">
        {results.map(c => (
          <button
            key={c.identifier}
            className={`result${zoomed === c.identifier ? ' active' : ''}`}
            onClick={() => zoom(c.identifier)}
            title={c.oracleText}
          >
            {c.imageUrl
              ? <img src={c.imageUrl} alt={c.name} loading="lazy" />
              : <div className="result-ph">◆</div>}
            <div className="result-bar" style={{ background: typeColor(c.type) }} />
            <div className="result-meta">
              <span className="result-name">{c.name}</span>
              <ManaCost cost={c.manaCost} size={12} />
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
