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

  // Deck reveal is full-screen, so only one player's can be up — clicking the
  // active one again pulls it down.
  const toggleDeckReveal = (idx) =>
    set({ deckRevealActive: o.deckRevealActive === idx ? null : idx })

  // Decklist sidebars are independent: P1's renders on the left and P2's on the
  // right, so either, both, or neither can be on air. Each button toggles its
  // own player in or out of the list.
  const decklistUp = Array.isArray(o.decklistActive) ? o.decklistActive : []

  const toggleDecklist = (idx) =>
    set({
      decklistActive: decklistUp.includes(idx)
        ? decklistUp.filter(i => i !== idx)
        : [...decklistUp, idx],
    })

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
          className={`ob-btn${decklistUp.includes(i) ? ' on' : ''}`}
          onClick={() => toggleDecklist(i)}
          title={`Decklist sidebar — ${i === 0 ? 'left' : 'right'} of screen. Both can be up at once.`}
        >
          Decklist: {players[i]?.name || `P${i + 1}`}
        </button>
      ))}

      {[0, 1].map(i => (
        <button
          key={`dr${i}`}
          className={`ob-btn${o.deckRevealActive === i ? ' on' : ''}`}
          onClick={() => toggleDeckReveal(i)}
          title="Full-screen deck reveal — only one at a time"
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
