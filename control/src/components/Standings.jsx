import React from 'react'
import { api } from '../store.js'

export default function Standings({ state }) {
  const rows = state.standings ?? []

  function update(i, patch) {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r))
    api.standings(next).catch(() => {})
  }

  function clearAll() {
    api.standings(rows.map(() => ({ name: '', deckName: '', record: { w: 0, l: 0, d: 0 } })))
      .catch(() => {})
  }

  return (
    <section className="card">
      <div className="section-head">
        <h2>Standings</h2>
        <button className="btn" onClick={clearAll}>Clear all</button>
      </div>

      <table className="standings">
        <thead>
          <tr>
            <th className="rank">#</th>
            <th>Player</th>
            <th>Archetype</th>
            <th className="num">W</th>
            <th className="num">L</th>
            <th className="num">D</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const rec = r.record ?? { w: 0, l: 0, d: 0 }
            return (
              <tr key={i}>
                <td className="rank">{i + 1}</td>
                <td>
                  <input
                    value={r.name ?? ''}
                    onChange={e => update(i, { name: e.target.value })}
                    placeholder="—"
                  />
                </td>
                <td>
                  <input
                    value={r.deckName ?? ''}
                    onChange={e => update(i, { deckName: e.target.value })}
                    placeholder="—"
                  />
                </td>
                {['w', 'l', 'd'].map(k => (
                  <td key={k} className="num">
                    <input
                      type="number"
                      value={rec[k] ?? 0}
                      onChange={e => update(i, { record: { ...rec, [k]: +e.target.value } })}
                    />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
