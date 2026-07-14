import React from 'react'
import { api } from '../store.js'

const ROUND_NAMES = ['Quarterfinals', 'Semifinals', 'Final']

export default function Bracket({ state, editIndex }) {
  const bracket = state.bracket
  const roster  = state.roster ?? []
  if (!bracket) return null

  // The server replaces the bracket wholesale — advancing a winner touches two
  // rounds at once, so partial patches would be fiddlier than they're worth.
  const commit = (next) => api.bracket(next).catch(() => {})
  const clone  = () => JSON.parse(JSON.stringify(bracket))

  // Typing a name that matches a roster player links the two, so the slot
  // carries their decklist. A name that matches nothing is kept as-is — that's
  // the manual path, and it has to keep working when a list never turned up.
  function setName(ri, mi, side, rawName) {
    const next = clone()
    const m = next.rounds[ri][mi]
    const name = rawName.trim()

    if (!name) { m[side] = null; commit(next); return }

    const found = roster.findIndex(p => (p.name ?? '').toLowerCase() === name.toLowerCase())

    m[side] = found >= 0
      ? { name: roster[found].name, deckName: roster[found].deckName ?? '', rosterIndex: found }
      : { ...(m[side] ?? {}), name, rosterIndex: undefined }

    commit(next)
  }

  function setDeck(ri, mi, side, deckName) {
    const next = clone()
    const m = next.rounds[ri][mi]
    m[side] = { ...(m[side] ?? { name: '' }), deckName }
    commit(next)
  }

  function bumpScore(ri, mi, key, delta) {
    const next = clone()
    const m = next.rounds[ri][mi]
    m[key] = Math.max(0, (m[key] ?? 0) + delta)
    commit(next)
  }

  // Declaring a winner also seeds them into the next round's slot — otherwise
  // the operator retypes every name as the bracket progresses.
  function setWinner(ri, mi, side) {
    const next = clone()
    const m = next.rounds[ri][mi]
    m.winner = m.winner === side ? null : side

    const nextRound = next.rounds[ri + 1]
    if (nextRound) {
      const targetMatch = Math.floor(mi / 2)
      const targetSide  = mi % 2 === 0 ? 'a' : 'b'
      nextRound[targetMatch][targetSide] = m.winner ? m[m.winner] : null
    }

    commit(next)
  }

  const hasPlacements = roster.some(p => Number.isFinite(p.place) && p.place <= 8)

  return (
    <section className="card">
      <div className="section-head">
        <h2>Bracket</h2>
        <div className="row">
          {hasPlacements && (
            <button
              className="btn"
              onClick={() => api.seedBracket().catch(() => {})}
              title="Fill the quarterfinals from roster placements — 1v8, 4v5, 3v6, 2v7"
            >
              Seed Top 8 from roster
            </button>
          )}
          <input
            className="event-input"
            value={bracket.label ?? ''}
            onChange={e => commit({ ...bracket, label: e.target.value })}
            placeholder="TOP 8 BRACKET"
          />
          <button
            className={`btn${bracket.active ? ' primary' : ''}`}
            onClick={() => commit({ ...bracket, active: !bracket.active })}
          >
            {bracket.active ? 'On air' : 'Show bracket'}
          </button>
        </div>
      </div>

      {/* Typing into a slot autocompletes against the roster; anything else is
          accepted as a manual entry. */}
      <datalist id="roster-names">
        {roster.map((p, i) => (
          <option key={i} value={p.name}>{p.deckName}</option>
        ))}
      </datalist>

      <div className="bracket">
        {bracket.rounds.map((round, ri) => (
          <div key={ri} className="br-round">
            <div className="br-round-title">{ROUND_NAMES[ri] ?? `Round ${ri + 1}`}</div>

            {round.map((m, mi) => {
              const ready = m.a?.name && m.b?.name
              return (
                <div key={mi} className="br-match">
                  {['a', 'b'].map(side => {
                    const entry    = m[side]
                    const scoreKey = side === 'a' ? 'scoreA' : 'scoreB'
                    const linked   = Number.isFinite(entry?.rosterIndex)

                    return (
                      <div key={side} className={`br-slot${m.winner === side ? ' winner' : ''}`}>
                        <div className="br-who">
                          <input
                            list="roster-names"
                            placeholder={`Seed ${side.toUpperCase()}`}
                            defaultValue={entry?.name ?? ''}
                            key={entry?.name ?? ''}   /* re-sync when advanced from a prior round */
                            onBlur={e => setName(ri, mi, side, e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                          />
                          <input
                            className="br-deck"
                            placeholder="Archetype"
                            value={entry?.deckName ?? ''}
                            onChange={e => setDeck(ri, mi, side, e.target.value)}
                            title={linked ? 'From roster — decklist attached' : 'Manual entry — no decklist'}
                          />
                          {linked && <span className="br-linked" title="Decklist attached from roster">◆</span>}
                        </div>

                        <div className="br-score">
                          <button className="tiny" onClick={() => bumpScore(ri, mi, scoreKey, -1)}>−</button>
                          <b>{m[scoreKey] ?? 0}</b>
                          <button className="tiny" onClick={() => bumpScore(ri, mi, scoreKey, +1)}>+</button>
                        </div>

                        <button
                          className={`br-win${m.winner === side ? ' on' : ''}`}
                          title="Advance this player"
                          onClick={() => setWinner(ri, mi, side)}
                        >
                          ✓
                        </button>
                      </div>
                    )
                  })}

                  {/* Put this pairing on air, decklists and all. */}
                  <button
                    className="btn sm br-cast"
                    disabled={!ready}
                    onClick={() => api.castBracket(ri, mi, editIndex).catch(() => {})}
                    title={ready
                      ? `Seat both players into ${state.matches[editIndex]?.label}`
                      : 'Fill both slots first'}
                  >
                    Cast to {state.matches[editIndex]?.label ?? 'feature match'}
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <p className="muted">
        Marking a winner advances them automatically. Slots matching a roster player
        (◆) carry that player’s decklist when cast; anything typed by hand still works,
        it just has no decklist attached. The champion is written to <code>OBS/champion.txt</code>.
      </p>
    </section>
  )
}
