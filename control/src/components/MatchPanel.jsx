import React, { useState } from 'react'
import { api } from '../store.js'
import PlayerCard from './PlayerCard.jsx'

export default function MatchPanel({ state, mi }) {
  const slot = state.matches[mi]
  const [confirmReset, setConfirmReset] = useState(false)
  if (!slot) return null

  const { match, players } = slot
  const patch = (p) => api.patchMatch(mi, p).catch(() => {})

  async function reset() {
    if (!confirmReset) {
      setConfirmReset(true)
      setTimeout(() => setConfirmReset(false), 3000)
      return
    }
    setConfirmReset(false)
    await api.resetMatch(mi).catch(() => {})
  }

  return (
    <section className="card match-panel">
      <div className="row match-meta">
        <label className="field">
          <span>Round</span>
          <input
            value={match.round ?? ''}
            onChange={e => patch({ round: e.target.value })}
            placeholder="1"
          />
        </label>

        <label className="field">
          <span>Format</span>
          <select
            value={match.format ?? 'swiss'}
            onChange={e => patch({ format: e.target.value })}
          >
            <option value="swiss">Countdown · Swiss</option>
            <option value="topcut">Count-up · Top Cut</option>
          </select>
        </label>

        <div className="field grow">
          <span>On the play</span>
          <div className="seg">
            {[['p1', players[0]?.name || 'P1'], ['p2', players[1]?.name || 'P2']].map(([v, label]) => (
              <button
                key={v}
                className={`seg-btn${match.onThePlay === v ? ' on' : ''}`}
                // Clicking the active side clears it — play/draw is unknown
                // until someone actually wins the roll.
                onClick={() => patch({ onThePlay: match.onThePlay === v ? null : v })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="match-actions">
          <button className="btn" onClick={() => api.newGame(mi).catch(() => {})}>
            New Game
          </button>
          <button className="btn" onClick={() => api.swapPlayers(mi).catch(() => {})}>
            Swap Seats
          </button>
          <button
            className={`btn${confirmReset ? ' danger' : ''}`}
            onClick={reset}
          >
            {confirmReset ? 'Click again to reset' : 'Reset Match'}
          </button>
        </div>
      </div>

      <div className="players">
        {players.map((p, pi) => (
          <PlayerCard key={pi} player={p} mi={mi} pi={pi} />
        ))}
      </div>
    </section>
  )
}
