import React, { useEffect, useState } from 'react'
import { api } from '../store.js'

const pad = n => String(Math.floor(Math.abs(n))).padStart(2, '0')

export default function TimerPanel({ state, mi }) {
  const slot  = state.matches[mi]
  const timer = slot?.timer
  const isSwiss = slot?.match?.format !== 'topcut'

  // The server stores a start timestamp, not a ticking number, so the display
  // has to advance locally. This is the only place the panel derives anything.
  const [, force] = useState(0)
  useEffect(() => {
    if (!timer?.running) return
    const id = setInterval(() => force(n => n + 1), 250)
    return () => clearInterval(id)
  }, [timer?.running])

  if (!timer) return null

  const live = timer.running && timer.startedAt ? (Date.now() - timer.startedAt) / 1000 : 0
  const elapsed = timer.accumulated + live

  let display, cls = ''
  if (isSwiss) {
    const rem = Math.ceil(timer.duration - elapsed)
    if (rem <= 0) { display = 'TURNS'; cls = 'turns' }
    else {
      display = `${pad(rem / 60)}:${pad(rem % 60)}`
      cls = rem <= 60 ? 'critical' : rem <= 180 ? 'warning' : ''
    }
  } else {
    const s = Math.floor(elapsed)
    display = `${pad(s / 60)}:${pad(s % 60)}`
  }

  const act = (action, value) => api.timer(mi, action, value).catch(() => {})

  return (
    <section className="card timer-panel">
      <div className={`timer-display ${cls}`}>{display}</div>

      <div className="row">
        <button className="btn primary" onClick={() => act(timer.running ? 'pause' : 'start')}>
          {timer.running ? 'Pause' : 'Start'}
        </button>
        <button className="btn" onClick={() => act('reset')}>Reset</button>

        <label className="field">
          <span>Round length</span>
          <select
            value={timer.duration}
            onChange={e => act('setDuration', +e.target.value)}
          >
            <option value={1800}>30 min</option>
            <option value={2400}>40 min</option>
            <option value={3000}>50 min — standard</option>
            <option value={3600}>60 min</option>
          </select>
        </label>

        <span className="muted">
          {isSwiss ? 'Counts down; shows TURNS at zero.' : 'Counts up (top cut — untimed).'}
        </span>
      </div>
    </section>
  )
}
