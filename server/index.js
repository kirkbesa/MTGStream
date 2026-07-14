import express from 'express'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import cors from 'cors'
import { join, dirname } from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import { watch } from 'fs'
import {
  loadCards, searchCards, getCard,
  resolveImagePath, getCachedImagePath, getRemoteImageUrl, getFormat,
} from './scryfall.js'
import { resolveDecklist } from './decklist.js'
import { resolveRoster, parseRoster, detectFormat } from './roster.js'
import {
  getState, getLiveState, getRoster, setState,
  patchOverlay, setStandings, setBracket, patchEventName, patchBroadcaster, patchPanelist,
  patchMatchAt, patchPlayerAt, patchTimerAt, resetMatchAt, swapPlayersAt,
  adjustCounterAt, setCounterAt, newGameAt,
  setActiveMatchIndex, addMatch, removeMatch, renameMatch,
  setRoster, clearRoster, seatPlayer, seedStandingsFromRoster,
  seedBracketFromRoster, castBracketMatch,
  addClient, removeClient,
  saveEvent, listEvents, loadEvent, deleteEvent, broadcastEvent,
  autoSave,
} from './state.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001

const app = express()
app.use(cors())
app.use(express.json())

// Card images, keyed by Scryfall id. Served from the local disk cache when we
// have the file (the normal case — anything looked up once is cached), and
// otherwise redirected to Scryfall's image CDN so the card still renders on a
// cold cache. Card art is immutable, so it can be cached hard by the browser.
app.get('/cards/:id', (req, res) => {
  const { id } = req.params
  const local = getCachedImagePath(id)
  if (local) return res.sendFile(local, { maxAge: '30d', immutable: true })

  const remote = getRemoteImageUrl(id)
  if (remote) return res.redirect(302, remote)

  res.status(404).end()
})

// ── Overlay pages ────────────────────────────────────────────────
// Serve every overlay at its exact documented URL, with NO redirect.
//
// express.static would answer /overlays/nameplate with a 301 to
// /overlays/nameplate/ and only then serve index.html. OBS browser sources
// don't always follow that redirect cleanly, which shows up as a blank source.
// These routes MUST be registered before the static mount — the previous build
// declared a few of them after it, so static redirected first and they never ran.
const OVERLAYS = [
  'nameplate', 'cardviewer', 'decklist', 'deckreveal',
  'standings', 'timer', 'broadcaster', 'panelists', 'bracket',
]

for (const name of OVERLAYS) {
  app.get(`/overlays/${name}`, (_req, res) =>
    res.sendFile(join(ROOT, 'overlays', name, 'index.html')))
}

// Shared assets (ws.js, mtg.js) and anything else under overlays/
app.use('/overlays', express.static(join(ROOT, 'overlays')))

// Commentator dashboard — accessible from any device on the local network
app.get('/commentator', (_req, res) => res.sendFile(join(ROOT, 'commentator', 'index.html')))

// Table page — for players and judge at the match table
app.get('/table', (_req, res) => res.sendFile(join(ROOT, 'table', 'index.html')))

// serve built control panel (production)
app.use('/', express.static(join(ROOT, 'dist', 'control')))

// ── Card endpoints ───────────────────────────────────────────────
app.get('/api/cards/search', async (req, res) => {
  try {
    const results = await searchCards(req.query.q ?? '', 40)
    res.json(results.map(c => ({ ...c, imageUrl: resolveImagePath(c.identifier) })))
  } catch (err) {
    console.error('[api] card search failed:', err.message)
    res.status(502).json({ error: 'Card search failed', details: err.message })
  }
})

app.get('/api/cards/:identifier', async (req, res) => {
  try {
    const card = await getCard(req.params.identifier)
    if (!card) return res.status(404).json({ error: 'Card not found' })
    res.json({ ...card, imageUrl: resolveImagePath(card.identifier) })
  } catch (err) {
    console.error('[api] getCard failed:', err.message)
    res.status(502).json({ error: 'Card lookup failed', details: err.message })
  }
})

// ── Decklist import ──────────────────────────────────────────────
// Takes raw pasted text (Arena / MTGO / plain), resolves every line against
// Scryfall, and returns a fully-resolved decklist ready to store in state.
// Resolving here rather than in the overlays means each card is fetched once,
// at import time, instead of on every render.
app.post('/api/decklist/resolve-text', async (req, res) => {
  const { text } = req.body ?? {}
  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'Expected { text: "..." }' })
  }

  try {
    const deck = await resolveDecklist(text)
    const mainCount = deck.main.reduce((n, r) => n + r.count, 0)
    const sideCount = deck.side.reduce((n, r) => n + r.count, 0)
    console.log(`[decklist] resolved ${mainCount} main / ${sideCount} side` +
                `${deck.unresolved.length ? ` — ${deck.unresolved.length} unresolved` : ''}`)
    res.json(deck)
  } catch (err) {
    console.error('[decklist] resolve failed:', err.message)
    res.status(502).json({ error: 'Decklist resolve failed', details: err.message })
  }
})

// ── Roster (bulk tournament import) ──────────────────────────────
// Importing a 64-player field means resolving ~1600 card lines through a
// rate-limited API, which takes a while. So we respond immediately and stream
// progress over the WebSocket instead of holding the request open — a silent
// two-minute spinner is indistinguishable from a hang.
// Parse-only, no Scryfall calls. Lets the panel show "detected CSV — 64 players"
// and surface a bad file BEFORE committing to a multi-minute import.
app.post('/api/roster/preview', (req, res) => {
  const { text } = req.body ?? {}
  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'Expected { text: "..." }' })
  }
  try {
    const entries = parseRoster(text)
    res.json({
      format:  detectFormat(text),
      players: entries.map(e => ({
        name:      e.name,
        deckName:  e.deckName,
        place:     e.place,
        cardLines: e.deckText.split(/\r?\n/).filter(l => /^\s*\d+\s+\S/.test(l)).length,
      })),
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/roster/import', (req, res) => {
  const { text } = req.body ?? {}
  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'Expected { text: "..." }' })
  }

  res.json({ ok: true, started: true })

  resolveRoster(text, ({ done, total, name }) => {
    broadcastEvent('roster_progress', { done, total, name })
    if (done === 1 || done === total || done % 8 === 0) {
      console.log(`[roster] ${done}/${total} — ${name}`)
    }
  })
    .then(players => {
      setRoster(players)
      const unresolved = players.reduce((n, p) => n + (p.decklist?.unresolved?.length ?? 0), 0)
      console.log(`[roster] imported ${players.length} players` +
                  `${unresolved ? ` — ${unresolved} unresolved card lines` : ''}`)
      broadcastEvent('roster_progress', {
        done: players.length, total: players.length, complete: true, unresolved,
      })
    })
    .catch(err => {
      console.error('[roster] import failed:', err.message)
      broadcastEvent('roster_progress', { error: err.message, complete: true })
    })
})

// The roster is NOT part of the state broadcast (see getLiveState in state.js).
// The control panel fetches it here when it connects, and the server pushes a
// { type: 'roster' } message whenever it changes.
app.get('/api/roster', (_req, res) => res.json(getRoster()))

app.delete('/api/roster', (_req, res) => {
  clearRoster()
  res.json(getLiveState())
})

// Seat a roster player into a match slot.
app.post('/api/roster/:ri/seat/:mi/:pi', (req, res) => {
  const { ri, mi, pi } = req.params
  seatPlayer(Number(mi), Number(pi), Number(ri))
  res.json(getLiveState())
})

// Fill the standings table from roster placements (best first).
app.post('/api/roster/seed-standings', (_req, res) => {
  seedStandingsFromRoster()
  res.json(getLiveState())
})

// Seed the Top 8 bracket from roster placements (1v8, 4v5, 3v6, 2v7).
app.post('/api/roster/seed-bracket', (_req, res) => {
  seedBracketFromRoster()
  res.json(getLiveState())
})

// Put a bracket pairing on air — seats both players into a feature match slot.
app.post('/api/bracket/:ri/:mi/cast/:target', (req, res) => {
  const { ri, mi, target } = req.params
  castBracketMatch(Number(ri), Number(mi), Number(target))
  res.json(getLiveState())
})

// ── Server info ──────────────────────────────────────────────────
// Returns the host machine's LAN IP so the control panel can display
// share-ready URLs for Commentator / Table pages without the operator
// having to look up their IP manually.
function getLocalIP() {
  const ifaces = os.networkInterfaces()
  const candidates = []
  for (const name of Object.keys(ifaces)) {
    // Skip known virtual/loopback adapter names
    if (/vmware|vbox|docker|virtual|utun|awdl|llw|anpi|bridge/i.test(name)) continue
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push(iface.address)
      }
    }
  }
  // Prefer private LAN ranges (192.168.x, 10.x, 172.16-31.x)
  const lan = candidates.find(a =>
    a.startsWith('192.168.') || a.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(a)
  )
  return lan ?? candidates[0] ?? 'localhost'
}

app.get('/api/server-info', (_req, res) => {
  res.json({ localIP: getLocalIP(), port: PORT, format: getFormat() })
})

// ── State endpoints ──────────────────────────────────────────────
app.get('/api/state', (_req, res) => res.json(getLiveState()))

app.post('/api/state', (req, res) => {
  setState(req.body)
  res.json(getLiveState())
})

app.patch('/api/state/overlay', (req, res) => {
  patchOverlay(req.body)
  res.json(getLiveState())
})

app.patch('/api/state/standings', (req, res) => {
  setStandings(req.body)
  res.json(getLiveState())
})

app.patch('/api/state/bracket', (req, res) => {
  setBracket(req.body)
  res.json(getLiveState())
})

// ── Per-slot endpoints ───────────────────────────────────────────
// Every mutation addresses its match slot by explicit index, so editing Match B
// never disturbs whatever is live in Match A. There is deliberately no
// "current slot" shorthand — that was a second way to say the same thing, and
// a route that implicitly targets whatever is on air is a route that edits the
// wrong match the moment the operator switches slots mid-call.
app.patch('/api/state/matches/:mi/match', (req, res) => {
  patchMatchAt(Number(req.params.mi), req.body)
  res.json(getLiveState())
})

app.patch('/api/state/matches/:mi/player/:pi', (req, res) => {
  patchPlayerAt(Number(req.params.mi), Number(req.params.pi), req.body)
  res.json(getLiveState())
})

app.patch('/api/state/matches/:mi/timer', (req, res) => {
  const { action, value } = req.body ?? {}
  if (!action) return res.status(400).json({ error: 'action required' })
  patchTimerAt(Number(req.params.mi), action, value)
  res.json(getLiveState())
})

app.post('/api/state/matches/:mi/reset', (req, res) => {
  const mi = Number(req.params.mi)
  resetMatchAt(mi)
  // Clear match-specific overlay only when resetting the live slot
  if (mi === getState().activeMatchIndex) {
    patchOverlay({ decklistActive: [], deckRevealActive: null, cardZoom: null })
  }
  res.json(getLiveState())
})

app.post('/api/state/matches/:mi/swap-players', (req, res) => {
  swapPlayersAt(Number(req.params.mi))
  res.json(getLiveState())
})

// ── Counters (life / poison / energy) ────────────────────────────
// Accepts EITHER { delta: -3 } or { value: 17 }. The table page always sends
// `delta`, because a life tap is inherently relative: two rapid taps that each
// sent an absolute total computed from the same stale base would lose one.
app.patch('/api/state/matches/:mi/player/:pi/counter/:counter', (req, res) => {
  const mi      = Number(req.params.mi)
  const pi      = Number(req.params.pi)
  const counter = req.params.counter
  const { delta, value } = req.body ?? {}

  if (delta != null)      adjustCounterAt(mi, pi, counter, delta)
  else if (value != null) setCounterAt(mi, pi, counter, value)
  else return res.status(400).json({ error: 'delta or value required' })

  res.json(getLiveState())
})

// Next game of a Bo3 — resets life/poison/energy and the play/draw marker,
// keeping names, decklists, records and the game score.
app.post('/api/state/matches/:mi/new-game', (req, res) => {
  newGameAt(Number(req.params.mi))
  res.json(getLiveState())
})

// ── Multi-match management ───────────────────────────────────────
app.patch('/api/state/active-match', (req, res) => {
  const { index } = req.body ?? {}
  if (index == null) return res.status(400).json({ error: 'index required' })
  setActiveMatchIndex(Number(index))
  res.json(getLiveState())
})

app.post('/api/state/matches', (_req, res) => {
  addMatch()
  res.json(getLiveState())
})

app.delete('/api/state/matches/:index', (req, res) => {
  removeMatch(Number(req.params.index))
  res.json(getLiveState())
})

app.patch('/api/state/matches/:index/label', (req, res) => {
  const { label } = req.body ?? {}
  renameMatch(Number(req.params.index), label ?? '')
  res.json(getLiveState())
})

app.patch('/api/state/event', (req, res) => {
  const { eventName } = req.body ?? {}
  patchEventName(eventName ?? '')
  res.json(getLiveState())
})

app.patch('/api/state/broadcaster/:index', (req, res) => {
  patchBroadcaster(Number(req.params.index), req.body)
  res.json(getLiveState())
})

app.patch('/api/state/panelist/:index', (req, res) => {
  patchPanelist(Number(req.params.index), req.body)
  res.json(getLiveState())
})

// ── Event file endpoints ─────────────────────────────────────────
app.get('/api/events', (_req, res) => res.json(listEvents()))

app.post('/api/events', (req, res) => {
  const { name } = req.body ?? {}
  if (!name) return res.status(400).json({ error: 'name required' })
  res.json(saveEvent(name))
})

app.get('/api/events/:id', (req, res) => {
  const ev = loadEvent(req.params.id)
  if (!ev) return res.status(404).json({ error: 'Event not found' })
  res.json(ev)
})

app.delete('/api/events/:id', (req, res) => {
  deleteEvent(req.params.id)
  res.json({ ok: true })
})

// ── HTTP + WebSocket server ──────────────────────────────────────
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  addClient(ws)
  // 'close' always fires after 'error', so handle removal only in 'close'
  // to avoid a double removeClient + double broadcast on errored connections.
  ws.on('close', () => removeClient(ws))
  ws.on('error', (err) => console.warn('[ws] client error:', err.message))
})

// ── Overlay hot-reload watcher ───────────────────────────────────
// Watches overlays/ for file changes and broadcasts { type: 'reload' } so
// OBS browser sources refresh automatically — no manual refresh needed.
// Debounced 250 ms so rapid saves (e.g. editor autosave) only fire once.
// Note: recursive watch works on macOS + Windows; on Linux use nodemon instead.
{
  let _reloadTimer = null
  try {
    watch(join(ROOT, 'overlays'), { recursive: true }, () => {
      clearTimeout(_reloadTimer)
      _reloadTimer = setTimeout(() => {
        console.log('[hot-reload] overlay file changed — pushing reload to connected clients')
        broadcastEvent('reload', {})
      }, 250)
    })
  } catch (err) {
    console.warn('[hot-reload] fs.watch unavailable on this platform:', err.message)
  }
}

// startup — warm the card cache from disk (no network needed)
loadCards()

server.listen(PORT, () => {
  console.log(`\n🃏 MTGStream (${getFormat()}) running on http://localhost:${PORT}`)
  console.log(`   Overlays: http://localhost:${PORT}/overlays/nameplate`)
  console.log(`             http://localhost:${PORT}/overlays/cardviewer`)
  console.log(`             http://localhost:${PORT}/overlays/decklist`)
  console.log(`             http://localhost:${PORT}/overlays/deckreveal`)
  console.log(`             http://localhost:${PORT}/overlays/standings`)
  console.log(`             http://localhost:${PORT}/overlays/timer`)
  console.log(`             http://localhost:${PORT}/overlays/broadcaster`)
  console.log(`             http://localhost:${PORT}/overlays/bracket`)
  console.log(`\n   Commentator: http://localhost:${PORT}/commentator`)
  console.log(`   (Share your local IP on port ${PORT} with commentators on the same network)\n`)

  // ── Auto-save intervals ─────────────────────────────────────────
  // Short: every 5 min — overwrites AutoSave-MTGBroadcast_latest.json
  // Long:  every 30 min — new timestamped file, never overwritten
  const SHORT_MS = 5  * 60 * 1000
  const LONG_MS  = 30 * 60 * 1000

  setInterval(() => {
    const file = autoSave('short')
    if (file) {
      console.log(`[autosave] short → ${file}`)
      broadcastEvent('autosave', { kind: 'short', savedAt: new Date().toISOString() })
    }
  }, SHORT_MS)

  setInterval(() => {
    const file = autoSave('long')
    if (file) {
      console.log(`[autosave] long  → ${file}`)
      broadcastEvent('autosave', { kind: 'long', savedAt: new Date().toISOString() })
    }
  }, LONG_MS)
})
