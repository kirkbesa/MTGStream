import React, { useState, useCallback, useMemo, useRef } from 'react'
import { api, useServerEvent } from '../store.js'
import DeckSummary from './DeckSummary.jsx'

const FORMAT_LABEL = {
  csv:  'CSV',
  json: 'JSON',
  text: 'text',
}

export default function Roster({ state, editIndex }) {
  const roster = state.roster ?? []

  const [text, setText]       = useState('')
  const [importing, setImp]   = useState(roster.length === 0)
  const [preview, setPreview] = useState(null)
  const [progress, setProg]   = useState(null)
  const [filter, setFilter]   = useState('')
  const [expanded, setExpand] = useState(null)
  const [error, setError]     = useState('')
  const [dragging, setDrag]   = useState(false)
  const fileRef = useRef(null)

  // Import runs server-side and streams progress. A large field is thousands of
  // card lines, so a silent spinner would be indistinguishable from a hang.
  useServerEvent('roster_progress', useCallback((d) => {
    if (d.error) { setError(d.error); setProg(null); return }
    setProg(d)
    if (d.complete) {
      setImp(false)
      setPreview(null)
      setText('')
      setTimeout(() => setProg(null), 5000)
    }
  }, []))

  // Parse-only round trip: shows what the file actually contains before we
  // commit to a multi-minute Scryfall import.
  async function loadContent(content) {
    setError('')
    setText(content)
    setPreview(null)
    try {
      const p = await api.previewRoster(content)
      setPreview(p)
    } catch (e) {
      setError(e.message)
    }
  }

  async function readFile(file) {
    if (!file) return
    try {
      await loadContent(await file.text())
    } catch (e) {
      setError(`Could not read ${file.name}: ${e.message}`)
    }
  }

  function onDrop(e) {
    e.preventDefault()
    setDrag(false)
    readFile(e.dataTransfer.files?.[0])
  }

  async function startImport() {
    if (!text.trim()) return
    setError('')
    setProg({ done: 0, total: preview?.players.length ?? 0 })
    try {
      await api.importRoster(text)
    } catch (e) {
      setError(e.message)
      setProg(null)
    }
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const withIdx = roster.map((p, i) => ({ ...p, _i: i }))
    if (!q) return withIdx
    return withIdx.filter(p =>
      (p.name ?? '').toLowerCase().includes(q) ||
      (p.deckName ?? '').toLowerCase().includes(q)
    )
  }, [roster, filter])

  const unresolvedTotal = roster.reduce((n, p) => n + (p.decklist?.unresolved?.length ?? 0), 0)
  const busy = progress && !progress.complete

  return (
    <section className="card">
      <div className="section-head">
        <h2>Roster {roster.length > 0 && <span className="muted">· {roster.length} players</span>}</h2>
        <div className="row">
          {roster.length > 0 && (
            <>
              <button className="btn" onClick={() => api.seedStandings().catch(() => {})}
                      title="Fill the Standings table from imported placements">
                Seed standings
              </button>
              <button className="btn" onClick={() => setImp(v => !v)}>
                {importing ? 'Cancel' : 'Re-import'}
              </button>
              <button className="btn danger" onClick={() => api.clearRoster().catch(() => {})}>
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {progress && (
        <div className="roster-progress">
          {progress.complete
            ? `Imported ${progress.total} players — ${progress.unresolved
                ? `${progress.unresolved} unresolved card lines`
                : 'all cards resolved'}`
            : `Resolving decklists… ${progress.done}/${progress.total || '?'}${progress.name ? ` — ${progress.name}` : ''}`}
          <div className="bar">
            <div className="bar-fill"
                 style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%' }} />
          </div>
        </div>
      )}

      {error && <div className="err">{error}</div>}

      {importing ? (
        <div className="import">
          {/* Registration platforms export CSV or JSON, so take a file directly
              rather than making the operator paste 64 decklists into a box. */}
          <div
            className={`dropzone${dragging ? ' over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.json,.txt,.tsv,text/csv,application/json,text/plain"
              hidden
              onChange={e => readFile(e.target.files?.[0])}
            />
            <b>Drop a roster file here</b>
            <span className="muted">
              CSV, JSON or text — or click to browse. The format is detected automatically.
            </span>
          </div>

          {preview && (
            <div className="preview">
              <div className="preview-head">
                Detected <b>{FORMAT_LABEL[preview.format] ?? preview.format}</b> ·{' '}
                <b>{preview.players.length}</b> players
                {preview.players.some(p => p.place != null) && ' · placements included'}
              </div>
              <div className="preview-list">
                {preview.players.slice(0, 200).map((p, i) => (
                  <div key={i} className={`preview-row${p.cardLines === 0 ? ' bad' : ''}`}>
                    <span className="pv-place">{p.place ?? '—'}</span>
                    <span className="pv-name">{p.name}</span>
                    <span className="pv-deck">{p.deckName || <i className="muted">no deck name</i>}</span>
                    <span className="pv-lines">
                      {p.cardLines > 0 ? `${p.cardLines} lines` : 'no decklist'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <details className="paste-fallback">
            <summary>…or paste it instead</summary>
            <textarea
              className="import-ta"
              placeholder={'Player: Plachy\nDeck: Jund Wildfire\nPlace: 1\n4 Writhing Chrysalis\n…\nSideboard\n2 Gorilla Shaman'}
              value={text}
              onChange={e => setText(e.target.value)}
              onBlur={() => text.trim() && loadContent(text)}
              rows={10}
            />
          </details>

          <div className="row">
            <button className="btn primary" onClick={startImport} disabled={!text.trim() || busy}>
              {busy
                ? 'Importing…'
                : preview
                  ? `Import ${preview.players.length} players`
                  : 'Import roster'}
            </button>
            {roster.length > 0 && !busy && (
              <button className="btn" onClick={() => setImp(false)}>Cancel</button>
            )}
            <span className="muted">
              Cards are fetched from Scryfall once and cached — do this before you go live.
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="row search-row">
            <input
              className="search"
              placeholder="Filter by player or deck…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            {unresolvedTotal > 0 && (
              <span className="warn">{unresolvedTotal} unresolved card lines</span>
            )}
          </div>

          <div className="roster-list">
            {shown.map(p => (
              <div key={p._i} className="roster-row">
                <span className="rr-place">{p.place ?? '—'}</span>

                <button
                  className="rr-main"
                  onClick={() => setExpand(expanded === p._i ? null : p._i)}
                  title="Show decklist"
                >
                  <span className="rr-name">{p.name}</span>
                  <span className="rr-deck">{p.deckName}</span>
                </button>

                <span className="rr-count">
                  {p.decklist ? p.decklist.main.reduce((n, r) => n + r.count, 0) : '—'}
                  {p.decklist?.unresolved?.length > 0 && (
                    <span className="warn" title={`${p.decklist.unresolved.length} unresolved`}> !</span>
                  )}
                </span>

                {/* Seating copies identity + decklist into the match slot you're
                    currently editing on the Match tab. */}
                <span className="rr-seat">
                  <button className="btn sm" onClick={() => api.seatPlayer(p._i, editIndex, 0).catch(() => {})}>→ P1</button>
                  <button className="btn sm" onClick={() => api.seatPlayer(p._i, editIndex, 1).catch(() => {})}>→ P2</button>
                </span>
              </div>
            ))}

            {shown.length === 0 && <div className="muted">No players match “{filter}”.</div>}
          </div>

          {expanded != null && roster[expanded] && (
            <div className="roster-deck">
              <div className="section-head">
                <h2>{roster[expanded].name} — {roster[expanded].deckName}</h2>
                <button className="btn sm" onClick={() => setExpand(null)}>Close</button>
              </div>
              <DeckSummary deck={roster[expanded].decklist} />
            </div>
          )}
        </>
      )}
    </section>
  )
}
