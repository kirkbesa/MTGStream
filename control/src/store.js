// control/src/store.js — the panel's single connection to server state.
//
// The server is authoritative: every mutation is a REST call, and the new state
// comes back over the WebSocket broadcast that follows. The panel never keeps a
// second copy of the truth, which is what keeps it in sync with the overlays,
// the table page and any other operator's browser.

import { useEffect, useState, useCallback } from 'react'

const WS_URL = `ws://${location.hostname}:3001/ws`

// The server also pushes non-state events (roster import progress, autosaves).
// Components subscribe here rather than each opening its own socket.
const listeners = new Set()

export function useServerEvent(type, handler) {
  useEffect(() => {
    const fn = (msg) => { if (msg.type === type) handler(msg.data) }
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, [type, handler])
}

// The server broadcasts state WITHOUT the roster — a 64-player field with
// resolved decklists is ~0.5 MB, and shipping it on every life tap would drown
// the venue Wi-Fi. The roster arrives on its own channel instead: fetched once
// when we connect, then pushed only when it actually changes.
//
// It's re-attached to `state` here, so components still just read `state.roster`
// and never need to know any of the above.
export function useAppState() {
  const [live, setLive] = useState(null)
  const [roster, setRoster] = useState([])
  const [connected, setConnected] = useState(false)
  const [clientCount, setClientCount] = useState(0)

  useEffect(() => {
    let ws
    let retry

    function connect() {
      ws = new WebSocket(WS_URL)

      ws.onopen = () => {
        setConnected(true)
        // Re-fetch on every (re)connect, not just the first: while we were
        // disconnected the roster could have been imported or cleared, and we'd
        // have missed the push.
        fetch('/api/roster')
          .then(r => r.json())
          .then(r => setRoster(Array.isArray(r) ? r : []))
          .catch(() => {})
      }

      ws.onclose = () => {
        setConnected(false)
        retry = setTimeout(connect, 2000)
      }

      ws.onerror = () => ws.close()

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'state') {
            setLive(msg.data)
            if (msg.clientCount != null) setClientCount(msg.clientCount)
          } else if (msg.type === 'roster') {
            setRoster(Array.isArray(msg.data) ? msg.data : [])
          } else {
            for (const fn of listeners) fn(msg)
          }
        } catch { /* ignore malformed frames */ }
      }
    }

    connect()
    return () => { clearTimeout(retry); ws?.close() }
  }, [])

  const state = live ? { ...live, roster } : null

  return { state, connected, clientCount }
}

// ── REST helpers ─────────────────────────────────────────────────
// None of these set state directly — the WebSocket broadcast does that.

async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? err.details ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  // Per-slot edits — always addressed by explicit match index, so editing
  // Match B never disturbs whatever is live in Match A.
  patchMatch:   (mi, patch)         => req('PATCH', `/api/state/matches/${mi}/match`, patch),
  patchPlayer:  (mi, pi, patch)     => req('PATCH', `/api/state/matches/${mi}/player/${pi}`, patch),
  adjustCounter:(mi, pi, c, delta)  => req('PATCH', `/api/state/matches/${mi}/player/${pi}/counter/${c}`, { delta }),
  setCounter:   (mi, pi, c, value)  => req('PATCH', `/api/state/matches/${mi}/player/${pi}/counter/${c}`, { value }),
  newGame:      (mi)                => req('POST',  `/api/state/matches/${mi}/new-game`),
  resetMatch:   (mi)                => req('POST',  `/api/state/matches/${mi}/reset`),
  swapPlayers:  (mi)                => req('POST',  `/api/state/matches/${mi}/swap-players`),
  timer:        (mi, action, value) => req('PATCH', `/api/state/matches/${mi}/timer`, { action, value }),

  addMatch:     ()                  => req('POST',   '/api/state/matches'),
  removeMatch:  (mi)                => req('DELETE', `/api/state/matches/${mi}`),
  renameMatch:  (mi, label)         => req('PATCH',  `/api/state/matches/${mi}/label`, { label }),
  setActive:    (index)             => req('PATCH',  '/api/state/active-match', { index }),

  overlay:      (patch)             => req('PATCH', '/api/state/overlay', patch),
  eventName:    (eventName)         => req('PATCH', '/api/state/event', { eventName }),
  standings:    (rows)              => req('PATCH', '/api/state/standings', rows),
  bracket:      (bracket)           => req('PATCH', '/api/state/bracket', bracket),
  broadcaster:  (i, patch)          => req('PATCH', `/api/state/broadcaster/${i}`, patch),
  panelist:     (i, patch)          => req('PATCH', `/api/state/panelist/${i}`, patch),

  searchCards:  (q)                 => req('GET', `/api/cards/search?q=${encodeURIComponent(q)}`),
  resolveDeck:  (text)              => req('POST', '/api/decklist/resolve-text', { text }),

  // Roster import returns as soon as it starts; progress arrives over the
  // WebSocket as `roster_progress` events (see useRosterProgress).
  previewRoster:  (text)            => req('POST',   '/api/roster/preview', { text }),
  importRoster:   (text)            => req('POST',   '/api/roster/import', { text }),
  clearRoster:    ()                => req('DELETE', '/api/roster'),
  seatPlayer:     (ri, mi, pi)      => req('POST',   `/api/roster/${ri}/seat/${mi}/${pi}`),
  seedStandings:  ()                => req('POST',   '/api/roster/seed-standings'),
  seedBracket:    ()                => req('POST',   '/api/roster/seed-bracket'),
  castBracket:    (ri, mi, target)  => req('POST',   `/api/bracket/${ri}/${mi}/cast/${target}`),

  listEvents:   ()                  => req('GET',    '/api/events'),
  saveEvent:    (name)              => req('POST',   '/api/events', { name }),
  loadEvent:    (id)                => req('GET',    `/api/events/${id}`),
  deleteEvent:  (id)                => req('DELETE', `/api/events/${id}`),
  serverInfo:   ()                  => req('GET',    '/api/server-info'),
}

// Debounce text inputs so typing a player's name doesn't fire a PATCH (and a
// full state broadcast to every overlay) on every keystroke.
export function useDebouncedCallback(fn, delay = 300) {
  const [timer, setTimer] = useState(null)
  return useCallback((...args) => {
    clearTimeout(timer)
    setTimer(setTimeout(() => fn(...args), delay))
  }, [fn, delay, timer])
}
