import React, { useState } from 'react'
import { api } from '../store.js'
import DecklistImport from './DecklistImport.jsx'
import DeckSummary from './DeckSummary.jsx'

export default function PlayerCard({ player: p, mi, pi }) {
  const [importing, setImporting] = useState(false)

  const patch  = (patch) => api.patchPlayer(mi, pi, patch).catch(() => {})
  const bump   = (counter, delta) => api.adjustCounter(mi, pi, counter, delta).catch(() => {})
  const setVal = (counter, value) => api.setCounter(mi, pi, counter, value).catch(() => {})

  const rec = p.record ?? { w: 0, l: 0, d: 0 }
  const deck = p.decklist

  return (
    <div className="card player-card">
      <div className="pc-head">
        <span className="pc-role">Player {pi + 1}</span>
        <span className="pc-score">
          Games
          <button className="tiny" onClick={() => patch({ gameScore: Math.max(0, (p.gameScore ?? 0) - 1) })}>−</button>
          <b>{p.gameScore ?? 0}</b>
          <button className="tiny" onClick={() => patch({ gameScore: (p.gameScore ?? 0) + 1 })}>+</button>
        </span>
      </div>

      <input
        className="pc-name"
        placeholder="Player name"
        value={p.name ?? ''}
        onChange={e => patch({ name: e.target.value })}
      />

      <div className="row">
        <label className="field">
          <span>Handle</span>
          <input value={p.handle ?? ''} onChange={e => patch({ handle: e.target.value })} placeholder="@handle" />
        </label>
        <label className="field">
          <span>Pronouns</span>
          <input value={p.pronouns ?? ''} onChange={e => patch({ pronouns: e.target.value })} placeholder="they/them" />
        </label>
      </div>

      <div className="row">
        <label className="field sm">
          <span>W</span>
          <input type="number" value={rec.w} onChange={e => patch({ record: { ...rec, w: +e.target.value } })} />
        </label>
        <label className="field sm">
          <span>L</span>
          <input type="number" value={rec.l} onChange={e => patch({ record: { ...rec, l: +e.target.value } })} />
        </label>
        <label className="field sm">
          <span>D</span>
          <input type="number" value={rec.d ?? 0} onChange={e => patch({ record: { ...rec, d: +e.target.value } })} />
        </label>
        <label className="field grow">
          <span>Archetype</span>
          <input
            value={p.deckName ?? ''}
            onChange={e => patch({ deckName: e.target.value })}
            placeholder="Mono-Red Burn"
          />
        </label>
      </div>

      {/* ── Counters ────────────────────────────────────────────
          Life is the headline number. Poison and energy sit beneath it and
          only reach the overlay when non-zero, so they can stay visible here
          without cluttering the broadcast. */}
      <div className="counters">
        <div className={`life${(p.life ?? 20) <= 5 ? ' low' : ''}`}>
          <button className="life-btn" onClick={() => bump('life', -5)}>−5</button>
          <button className="life-btn" onClick={() => bump('life', -1)}>−1</button>
          <input
            className="life-val"
            type="number"
            value={p.life ?? 20}
            onChange={e => setVal('life', +e.target.value)}
          />
          <button className="life-btn" onClick={() => bump('life', +1)}>+1</button>
          <button className="life-btn" onClick={() => bump('life', +5)}>+5</button>
        </div>

        <div className="minor">
          {[['poison', '☠ Poison'], ['energy', '⚡ Energy']].map(([key, label]) => (
            <div key={key} className={`minor-row ${key}${p[key] > 0 ? ' active' : ''}`}>
              <span>{label}</span>
              <button className="tiny" onClick={() => bump(key, -1)} disabled={(p[key] ?? 0) === 0}>−</button>
              <b>{p[key] ?? 0}</b>
              <button className="tiny" onClick={() => bump(key, +1)}>+</button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Decklist ────────────────────────────────────────── */}
      <div className="deck-block">
        <div className="deck-head">
          <span>Decklist</span>
          <button className="btn sm" onClick={() => setImporting(v => !v)}>
            {importing ? 'Cancel' : deck ? 'Re-import' : 'Import…'}
          </button>
        </div>

        {importing ? (
          <DecklistImport
            onDone={(resolved) => {
              patch({ decklist: resolved })
              setImporting(false)
            }}
            onCancel={() => setImporting(false)}
          />
        ) : (
          <DeckSummary deck={deck} />
        )}
      </div>
    </div>
  )
}
