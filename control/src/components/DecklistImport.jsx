import React, { useState } from 'react'
import { api } from '../store.js'
import { ManaCost } from '../mtg.jsx'

const PLACEHOLDER = `Paste a decklist — Arena, MTGO, or plain text:

4 Lightning Bolt
4 Chain Lightning
20 Mountain

Sideboard
2 Pyroblast`

export default function DecklistImport({ onDone, onCancel }) {
  const [text, setText]       = useState('')
  const [result, setResult]   = useState(null)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')

  async function resolve() {
    if (!text.trim()) return
    setBusy(true)
    setError('')
    try {
      setResult(await api.resolveDeck(text))
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  const mainCount = result ? result.main.reduce((n, r) => n + r.count, 0) : 0
  const sideCount = result ? result.side.reduce((n, r) => n + r.count, 0) : 0
  const illegal   = result ? [...result.main, ...result.side].filter(r => r.legal === false) : []

  return (
    <div className="import">
      {!result && (
        <>
          <textarea
            className="import-ta"
            placeholder={PLACEHOLDER}
            value={text}
            onChange={e => setText(e.target.value)}
            rows={10}
            autoFocus
          />
          <div className="row">
            <button className="btn primary" onClick={resolve} disabled={busy || !text.trim()}>
              {busy ? 'Resolving with Scryfall…' : 'Resolve'}
            </button>
            <button className="btn" onClick={onCancel}>Cancel</button>
            {error && <span className="err">{error}</span>}
          </div>
        </>
      )}

      {result && (
        <>
          {/* Review before committing. Scryfall's fuzzy matcher is forgiving,
              which is what makes messy player-submitted lists importable — but
              it also means a typo can resolve to the WRONG card rather than
              failing. Showing every resolved name is how that gets caught
              before it hits the deck reveal on air. */}
          <div className="import-summary">
            <b>{mainCount}</b> mainboard · <b>{sideCount}</b> sideboard
            {result.unresolved.length > 0 && (
              <span className="warn"> · {result.unresolved.length} unresolved</span>
            )}
            {illegal.length > 0 && (
              <span className="warn"> · {illegal.length} not format-legal</span>
            )}
          </div>

          <div className="import-review">
            {result.unresolved.length > 0 && (
              <div className="rev-section bad">
                <div className="rev-title">Unresolved — these will be missing</div>
                {result.unresolved.map((u, i) => (
                  <div key={i} className="rev-row">
                    <span className="rev-count">{u.count}</span>
                    <span className="rev-name">{u.rawName}</span>
                    <span className="rev-sugg">
                      {u.suggestions.length ? `Did you mean: ${u.suggestions.join(', ')}` : 'No match'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {[['Mainboard', result.main], ['Sideboard', result.side]].map(([label, rows]) =>
              rows.length > 0 && (
                <div key={label} className="rev-section">
                  <div className="rev-title">{label}</div>
                  {rows.map((r, i) => (
                    <div key={i} className={`rev-row${r.legal === false ? ' illegal' : ''}`}>
                      <span className="rev-count">{r.count}</span>
                      <span className="rev-name">{r.name}</span>
                      <ManaCost cost={r.manaCost} size={13} />
                      <span className="rev-type">{r.typeLine}</span>
                      {r.legal === false && <span className="rev-flag">not legal</span>}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>

          <div className="row">
            <button className="btn primary" onClick={() => onDone(result)}>
              Use this decklist
            </button>
            <button className="btn" onClick={() => setResult(null)}>Back to paste</button>
            <button className="btn" onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}
