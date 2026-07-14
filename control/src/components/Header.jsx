import React, { useEffect, useState } from 'react'
import { api } from '../store.js'

export default function Header({ state, connected, clientCount }) {
  const [info, setInfo]   = useState(null)
  const [name, setName]   = useState(state.eventName ?? '')
  const [events, setEvents] = useState([])
  const [busy, setBusy]   = useState('')

  useEffect(() => { api.serverInfo().then(setInfo).catch(() => {}) }, [])
  useEffect(() => { setName(state.eventName ?? '') }, [state.eventName])

  const refreshEvents = () => api.listEvents().then(setEvents).catch(() => {})
  useEffect(() => { refreshEvents() }, [])

  async function save() {
    const n = name.trim() || 'Untitled Event'
    setBusy('Saving…')
    try {
      await api.saveEvent(n)
      await refreshEvents()
      setBusy('Saved')
    } catch (e) {
      setBusy(`Save failed: ${e.message}`)
    }
    setTimeout(() => setBusy(''), 2000)
  }

  async function load(id) {
    if (!id) return
    setBusy('Loading…')
    try {
      await api.loadEvent(id)
      setBusy('Loaded')
    } catch (e) {
      setBusy(`Load failed: ${e.message}`)
    }
    setTimeout(() => setBusy(''), 2000)
  }

  // The commentator and table pages run on other devices over the venue LAN,
  // so surface the machine's actual IP — the operator should never have to go
  // hunting through network settings mid-setup.
  const lan = info ? `http://${info.localIP}:${info.port}` : null

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-name">MTGStream</span>
        {/* The format comes from the server, so the header always shows what
            card search is actually scoped to — not a hardcoded guess. */}
        {info?.format && <span className="brand-tag">{info.format}</span>}
      </div>

      <div className="header-mid">
        <input
          className="event-input"
          placeholder="Event name"
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => api.eventName(name).catch(() => {})}
        />
        <button className="btn" onClick={save}>Save Event</button>
        <select
          className="btn select"
          value=""
          onChange={e => load(e.target.value)}
        >
          <option value="">Load event…</option>
          {events.map(ev => (
            <option key={ev.id} value={ev.id}>
              {ev.name} — {new Date(ev.savedAt).toLocaleString()}
            </option>
          ))}
        </select>
        {busy && <span className="busy">{busy}</span>}
      </div>

      <div className="header-right">
        {lan && (
          <div className="lan">
            <a href={`${lan}/commentator`} target="_blank" rel="noreferrer">Commentator</a>
            <a href={`${lan}/table`}       target="_blank" rel="noreferrer">Table</a>
          </div>
        )}
        <span className={`ws ${connected ? 'live' : 'off'}`}>
          {connected ? `● ${clientCount} connected` : '○ Offline'}
        </span>
      </div>
    </header>
  )
}
