import React from 'react'
import { api } from '../store.js'

// The always-visible strip of what's currently on air. These are the controls
// the operator hits mid-match without looking, so they never move between tabs.
const TOGGLES = [
  ['nameplateVisible',   'Nameplate'],
  ['standingsVisible',   'Standings'],
  ['timerVisible',       'Timer'],
  ['broadcasterVisible', 'Broadcaster'],
  ['panelistVisible',    'Panelists'],
]

export default function OverlayBar({ state }) {
  const o = state.overlay ?? {}
  const players = state.matches[state.activeMatchIndex ?? 0]?.players ?? []

  const set = (patch) => api.overlay(patch).catch(() => {})

  // Decklist and deck-reveal are per-player, and only one can be up at a time —
  // clicking the active one again pulls it down.
  const togglePlayerOverlay = (key, idx) =>
    set({ [key]: o[key] === idx ? null : idx })

  return (
    <div className="overlay-bar">
      <span className="ob-label">On air</span>

      {TOGGLES.map(([key, label]) => (
        <button
          key={key}
          className={`ob-btn${o[key] ? ' on' : ''}`}
          onClick={() => set({ [key]: !o[key] })}
        >
          {label}
        </button>
      ))}

      <span className="ob-sep" />

      {[0, 1].map(i => (
        <button
          key={`dl${i}`}
          className={`ob-btn${o.decklistActive === i ? ' on' : ''}`}
          onClick={() => togglePlayerOverlay('decklistActive', i)}
          title="Decklist sidebar"
        >
          Decklist: {players[i]?.name || `P${i + 1}`}
        </button>
      ))}

      {[0, 1].map(i => (
        <button
          key={`dr${i}`}
          className={`ob-btn${o.deckRevealActive === i ? ' on' : ''}`}
          onClick={() => togglePlayerOverlay('deckRevealActive', i)}
          title="Full-screen deck reveal"
        >
          Reveal: {players[i]?.name || `P${i + 1}`}
        </button>
      ))}

      {o.cardZoom && (
        <button className="ob-btn zoom" onClick={() => set({ cardZoom: null })}>
          Clear card zoom ×
        </button>
      )}
    </div>
  )
}
