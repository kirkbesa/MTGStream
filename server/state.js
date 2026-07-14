import { writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EVENTS_DIR   = join(__dirname, '..', 'events')
const AUTOSAVE_DIR = join(__dirname, '..', 'autosave')
const OBS_DIR      = join(__dirname, '..', 'OBS')

const wsClients = new Set()

// ── Defaults ────────────────────────────────────────────────────
// MTG counters: life is always shown; poison and energy are "optional" in the
// sense that overlays only render them when non-zero, so a normal Pauper match
// shows a clean life-only nameplate and an Infect match lights up poison
// without the operator toggling anything.
export const STARTING_LIFE = 20

const defaultPlayer = () => ({
  name: '', handle: '', pronouns: '',
  record: { w: 0, l: 0, d: 0 },
  deckName: '', decklist: null,
  gameScore: 0,
  life: STARTING_LIFE, poison: 0, energy: 0,
  notes: '',
})

// 50 minutes — the standard Swiss round length for constructed REL events.
const defaultTimer = () => ({
  duration: 3000, running: false, startedAt: null, accumulated: 0,
})

const defaultStandings = () =>
  Array.from({ length: 8 }, () => ({ name: '', deckName: '', record: { w: 0, l: 0, d: 0 } }))

const defaultOverlay = () => ({
  nameplateVisible: true,
  cardZoom: null,
  // Player indices whose decklist sidebar is up. An ARRAY, not a single index:
  // P1's list renders on the left and P2's on the right, so both can be on air
  // at once — which is what a caster comparing two lists actually wants.
  decklistActive: [],
  deckRevealActive: null,
  standingsVisible: false,
  timerVisible: false,
  broadcasterVisible: false,
  panelistVisible: false,
})

const defaultBroadcaster = () => ({ name: '', handle: '', pronouns: '' })

const defaultBracket = () => ({
  active: false,
  label: 'TOP 8 BRACKET',
  // 3 rounds: QF (4 matches), SF (2 matches), Final (1 match)
  // Standard seeding: QF[0]=1v8, QF[1]=4v5, QF[2]=3v6, QF[3]=2v7
  rounds: [
    [
      { a: null, b: null, winner: null, scoreA: 0, scoreB: 0 },
      { a: null, b: null, winner: null, scoreA: 0, scoreB: 0 },
      { a: null, b: null, winner: null, scoreA: 0, scoreB: 0 },
      { a: null, b: null, winner: null, scoreA: 0, scoreB: 0 },
    ],
    [
      { a: null, b: null, winner: null, scoreA: 0, scoreB: 0 },
      { a: null, b: null, winner: null, scoreA: 0, scoreB: 0 },
    ],
    [
      { a: null, b: null, winner: null, scoreA: 0, scoreB: 0 },
    ],
  ],
})

const MATCH_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

export const defaultMatchSlot = (id = 'A') => ({
  id,
  label: `Feature Match ${id}`,
  // onThePlay: 'p1' | 'p2' | null — who took the play this game.
  match: { round: '1', format: 'swiss', onThePlay: null, notes: '' },
  players: [defaultPlayer(), defaultPlayer()],
  timer: defaultTimer(),
})

// ── Initial state ───────────────────────────────────────────────
// migrate() is called once here so getState() never needs to run it.
let state = migrate({
  activeMatchIndex: 0,
  matches: [defaultMatchSlot('A')],
  eventName: '',
  broadcasters: [defaultBroadcaster(), defaultBroadcaster()],
  panelists: [defaultBroadcaster(), defaultBroadcaster()],
  overlay: defaultOverlay(),
  standings: defaultStandings(),
  bracket: defaultBracket(),
  // The tournament field. Imported in bulk up front, then players are pulled
  // from here into match slots as the broadcast moves through the event —
  // you can't fit 64 players into two seats, so they live in a pool.
  roster: [],
})

// Decklists are stored FULLY RESOLVED — each row already carries the name,
// mana cost, type, colors and image URL. The panel resolves once at import
// time; overlays then render straight from state with no lookups, so a decklist
// that imported successfully keeps rendering even if the venue network dies
// mid-match.
//
//   decklist = { main: Row[], side: Row[], unresolved: [{ count, rawName, suggestions }] }
//   Row      = { count, identifier, name, manaCost, cmc, type, color, colors, rarity, imageUrl }

// ── Migration ───────────────────────────────────────────────────
// Runs on every state that comes in from outside — a saved event file, an
// autosave, a POST /api/state. Its only job is to backfill fields that older
// saves of THIS app predate, so a mid-season event file still loads after an
// update. It is not a general validator: a hand-corrupted file is out of scope.
function migrate(s) {
  if (!Array.isArray(s.matches) || s.matches.length === 0) {
    s.matches = [defaultMatchSlot('A')]
    s.activeMatchIndex = 0
  }

  // ── Per-slot fields ─────────────────────────────────────────────
  for (const slot of s.matches) {
    if (!slot.timer)                           slot.timer         = defaultTimer()
    if (!slot.match)                           slot.match         = defaultMatchSlot(slot.id).match
    if (!slot.match.round)                     slot.match.round   = '1'
    if (slot.match.format       == null)       slot.match.format  = 'swiss'
    if (slot.match.notes        === undefined) slot.match.notes   = ''
    if (slot.match.onThePlay    === undefined) slot.match.onThePlay = null

    // A slot is always exactly two seats.
    if (!Array.isArray(slot.players)) slot.players = [defaultPlayer(), defaultPlayer()]
    while (slot.players.length < 2)   slot.players.push(defaultPlayer())

    for (const p of slot.players) {
      if (p.gameScore == null) p.gameScore = 0
      if (p.notes     == null) p.notes     = ''
      if (p.deckName  == null) p.deckName  = ''
      if (!p.record)           p.record    = { w: 0, l: 0, d: 0 }
      if (p.record.d  == null) p.record.d  = 0

      if (p.life   == null) p.life   = STARTING_LIFE
      if (p.poison == null) p.poison = 0
      if (p.energy == null) p.energy = 0
    }
  }

  // ── Overlay fields ───────────────────────────────────────────────
  // All booleans and nullable references were added at different times;
  // explicitly backfill each one so old exports load correctly.
  if (!s.overlay) s.overlay = defaultOverlay()
  if (s.overlay.nameplateVisible  == null) s.overlay.nameplateVisible  = true
  if (s.overlay.cardZoom          === undefined) s.overlay.cardZoom    = null
  // decklistActive used to be a single index (0 | 1 | null) before both lists
  // could be up at once. Normalise an old save's value into the array form.
  if (Number.isFinite(s.overlay.decklistActive))     s.overlay.decklistActive = [s.overlay.decklistActive]
  else if (!Array.isArray(s.overlay.decklistActive)) s.overlay.decklistActive = []
  if (s.overlay.deckRevealActive  === undefined) s.overlay.deckRevealActive = null
  if (s.overlay.standingsVisible  == null) s.overlay.standingsVisible  = false
  if (s.overlay.timerVisible      == null) s.overlay.timerVisible      = false
  if (s.overlay.broadcasterVisible == null) s.overlay.broadcasterVisible = false
  if (s.overlay.panelistVisible    == null) s.overlay.panelistVisible    = false

  // ── Top-level fields ─────────────────────────────────────────────
  if (!s.broadcasters) s.broadcasters = [defaultBroadcaster(), defaultBroadcaster()]
  while (s.broadcasters.length < 2) s.broadcasters.push(defaultBroadcaster())
  for (const b of s.broadcasters) {
    if (b.name     == null) b.name     = ''
    if (b.handle   == null) b.handle   = ''
    if (b.pronouns == null) b.pronouns = ''
  }

  if (!s.panelists) s.panelists = [defaultBroadcaster(), defaultBroadcaster()]
  while (s.panelists.length < 2) s.panelists.push(defaultBroadcaster())
  for (const p of s.panelists) {
    if (p.name     == null) p.name     = ''
    if (p.handle   == null) p.handle   = ''
    if (p.pronouns == null) p.pronouns = ''
  }

  if (s.eventName === undefined) s.eventName = ''
  if (!Array.isArray(s.roster)) s.roster = []

  // ── Standings rows ───────────────────────────────────────────────
  if (!Array.isArray(s.standings)) s.standings = defaultStandings()
  for (const row of s.standings) {
    if (row.deckName  == null) row.deckName  = ''
    if (!row.record)           row.record    = { w: 0, l: 0, d: 0 }
    if (row.record.d  == null) row.record.d  = 0
  }

  // ── Bracket ──────────────────────────────────────────────────────
  if (!s.bracket) s.bracket = defaultBracket()
  if (s.bracket.label  == null) s.bracket.label  = 'TOP 8 BRACKET'
  if (s.bracket.active == null) s.bracket.active = false
  // Ensure round/match structure is intact
  if (!Array.isArray(s.bracket.rounds) || s.bracket.rounds.length < 3) {
    s.bracket.rounds = defaultBracket().rounds
  }
  // Backfill scoreA/scoreB on every match
  for (const round of s.bracket.rounds) {
    for (const match of round) {
      if (match.scoreA == null) match.scoreA = 0
      if (match.scoreB == null) match.scoreB = 0
    }
  }

  return s
}

// ── Exports ─────────────────────────────────────────────────────
// migrate() runs only when state is loaded or replaced — never on every read.
//
// TWO views of state, and the distinction matters:
//
//   getState()        the whole thing, roster included. For saving to disk.
//   getLiveState()    everything EXCEPT the roster. For sending to clients.
//   getRoster()       the roster on its own.
//
// Why: a 64-player roster with resolved decklists is ~0.5 MB, and it changes
// about twice an event (import, clear). The rest of state is a few KB and
// changes on every life tap. Sending them together means a single −1 life tap
// ships the entire tournament field to every overlay, tablet and laptop on the
// venue Wi-Fi — and it gets worse the more prepared you are, because the cost
// only appears once you've imported the field. So the roster travels on its own
// channel, only when it actually changes, and clients hold on to their copy.
//
// Nothing reads the roster except the control panel: seating a player COPIES
// them into the match slot, so overlays render from the seat and never look at
// the field.
export function getState() {
  return state
}

export function getLiveState() {
  const { roster, ...live } = state
  return live
}

export function getRoster() {
  return state.roster
}

export function setState(newState) {
  state = migrate(newState)
  broadcast()
  broadcastRoster()   // a wholesale state replacement can change the roster too
  writeObsFiles(state.bracket)
}

// ── Per-slot patches (target any slot by explicit index) ────────
// Used by the control panel so editing Match B never affects live Match A.

export function patchMatchAt(matchIndex, patch) {
  const slot = state.matches[matchIndex]
  if (!slot) return
  slot.match = { ...slot.match, ...patch }
  broadcast()
}

export function patchPlayerAt(matchIndex, playerIndex, patch) {
  const slot = state.matches[matchIndex]
  if (!slot || playerIndex < 0 || playerIndex > 1) return
  slot.players[playerIndex] = { ...slot.players[playerIndex], ...patch }
  broadcast()
}

export function patchTimerAt(matchIndex, action, value) {
  const slot = state.matches[matchIndex]
  if (!slot) return
  if (!slot.timer) slot.timer = defaultTimer()
  const t = slot.timer, now = Date.now()
  switch (action) {
    case 'start':    if (!t.running) { t.running = true; t.startedAt = now } break
    case 'pause':    if (t.running)  { t.accumulated += (now - t.startedAt) / 1000; t.running = false; t.startedAt = null } break
    case 'reset':    t.running = false; t.startedAt = null; t.accumulated = 0; break
    case 'setDuration': t.duration = Math.max(60, Math.round(Number(value))); t.running = false; t.startedAt = null; t.accumulated = 0; break
  }
  broadcast()
}

export function resetMatchAt(matchIndex) {
  const slot = state.matches[matchIndex]
  if (!slot) return
  state.matches[matchIndex] = { ...defaultMatchSlot(slot.id), label: slot.label }
  broadcast()
}

export function swapPlayersAt(matchIndex) {
  const slot = state.matches[matchIndex]
  if (!slot) return
  slot.players = [{ ...slot.players[1] }, { ...slot.players[0] }]
  broadcast()
}

// ── Counters (life / poison / energy) ───────────────────────────
const COUNTERS = ['life', 'poison', 'energy']

// Relative adjustment, because life changes arrive as "-3" from a table-side
// tap. Sending an absolute total instead would race: two taps in flight would
// both compute from the same stale base and one would be lost.
export function adjustCounterAt(matchIndex, playerIndex, counter, delta) {
  if (!COUNTERS.includes(counter)) return
  const slot = state.matches[matchIndex]
  if (!slot || playerIndex < 0 || playerIndex > 1) return
  const p = slot.players[playerIndex]

  // Life can legally go negative (and seeing it do so on stream is good TV);
  // poison and energy cannot.
  const next = (p[counter] ?? 0) + Number(delta)
  p[counter] = counter === 'life' ? next : Math.max(0, next)
  broadcast()
}

export function setCounterAt(matchIndex, playerIndex, counter, value) {
  if (!COUNTERS.includes(counter)) return
  const slot = state.matches[matchIndex]
  if (!slot || playerIndex < 0 || playerIndex > 1) return
  const v = Number(value)
  if (!Number.isFinite(v)) return
  slot.players[playerIndex][counter] = counter === 'life' ? v : Math.max(0, v)
  broadcast()
}

// Start the next game of a Bo3: reset life/poison/energy and clear the play/draw
// marker, but keep names, decklists, records and the game score — those persist
// across games within a match.
export function newGameAt(matchIndex) {
  const slot = state.matches[matchIndex]
  if (!slot) return
  for (const p of slot.players) {
    p.life   = STARTING_LIFE
    p.poison = 0
    p.energy = 0
  }
  slot.match.onThePlay = null
  broadcast()
}

export function patchOverlay(patch) {
  state.overlay = { ...state.overlay, ...patch }
  broadcast()
}

export function setStandings(standings) {
  state.standings = standings
  broadcast()
}

export function setBracket(bracket) {
  state.bracket = bracket
  broadcast()
  writeObsFiles(bracket)
}

export function patchEventName(name) {
  state.eventName = name
  broadcast()
}

export function patchBroadcaster(index, patch) {
  if (index < 0 || index > 1) return
  state.broadcasters[index] = { ...state.broadcasters[index], ...patch }
  broadcast()
}

export function patchPanelist(index, patch) {
  if (index < 0 || index > 1) return
  state.panelists[index] = { ...state.panelists[index], ...patch }
  broadcast()
}

// ── Multi-match management ───────────────────────────────────────
export function setActiveMatchIndex(index) {
  if (index < 0 || index >= state.matches.length) return
  state.activeMatchIndex = index
  // Clear overlay match-references so they point to the new slot's players
  state.overlay.decklistActive   = []
  state.overlay.deckRevealActive = null
  state.overlay.cardZoom         = null
  broadcast()
}

export function addMatch() {
  const used    = new Set(state.matches.map(m => m.id))
  const id      = MATCH_IDS.find(x => !used.has(x)) ?? `Match${state.matches.length + 1}`
  state.matches.push(defaultMatchSlot(id))
  broadcast()
  return id
}

export function removeMatch(index) {
  if (state.matches.length <= 1) return  // always keep at least one slot
  state.matches.splice(index, 1)
  if (state.activeMatchIndex >= state.matches.length) {
    state.activeMatchIndex = state.matches.length - 1
  }
  broadcast()
}

export function renameMatch(index, label) {
  if (!state.matches[index]) return
  state.matches[index].label = label
  broadcast()
}

// ── Roster (the tournament field) ────────────────────────────────
export function setRoster(players) {
  state.roster = players
  broadcastRoster()
}

export function clearRoster() {
  state.roster = []
  broadcastRoster()
}

// Seat a roster player into a match slot. Copies their identity and decklist in
// but deliberately leaves live match data (life, game score, play/draw) at its
// defaults — seating someone is the start of a match, not a restore of one.
export function seatPlayer(matchIndex, playerIndex, rosterIndex) {
  const slot = state.matches[matchIndex]
  const r    = state.roster[rosterIndex]
  if (!slot || !r || playerIndex < 0 || playerIndex > 1) return

  slot.players[playerIndex] = playerFromRoster(r)
  broadcast()
}

function playerFromRoster(r) {
  return {
    ...defaultPlayer(),
    name:     r.name     ?? '',
    handle:   r.handle   ?? '',
    pronouns: r.pronouns ?? '',
    deckName: r.deckName ?? '',
    decklist: r.decklist ?? null,
    // Carry the running record across if the roster has one.
    record:   r.record   ?? { w: 0, l: 0, d: 0 },
  }
}

// Put a bracket pairing on air: seat both of its players into a match slot.
//
// A bracket slot filled from the roster carries a rosterIndex, so we can pull
// the player's full decklist across. A slot typed in by hand has no index —
// that still works, it just seats the name and archetype with no decklist,
// which is exactly the manual fallback you want when a list never arrived.
export function castBracketMatch(roundIndex, matchIndex, targetMatchIndex) {
  const m    = state.bracket?.rounds?.[roundIndex]?.[matchIndex]
  const slot = state.matches[targetMatchIndex]
  if (!m || !slot) return

  ;['a', 'b'].forEach((side, pi) => {
    const entry = m[side]
    if (!entry) return

    const r = Number.isFinite(entry.rosterIndex) ? state.roster[entry.rosterIndex] : null
    slot.players[pi] = r
      ? playerFromRoster(r)
      : { ...defaultPlayer(), name: entry.name ?? '', deckName: entry.deckName ?? '' }
  })

  // The game score in the bracket is the source of truth for a cast match —
  // carry it over so the nameplate doesn't reset a 1-0 to 0-0.
  slot.players[0].gameScore = m.scoreA ?? 0
  slot.players[1].gameScore = m.scoreB ?? 0

  broadcast()
}

// Seed the Top 8 bracket from the roster's placements.
//
// Standard single-elimination seeding, which is what every tournament uses:
//   QF1: 1v8   QF2: 4v5   QF3: 3v6   QF4: 2v7
// so the top seed can only meet the second seed in the final. Seeding them in
// listed order (1v2, 3v4…) would knock the two best players out in round one.
const TOP8_PAIRS = [[1, 8], [4, 5], [3, 6], [2, 7]]

export function seedBracketFromRoster() {
  const bySeed = new Map()
  for (let i = 0; i < state.roster.length; i++) {
    const r = state.roster[i]
    if (Number.isFinite(r.place) && r.place >= 1 && r.place <= 8) {
      bySeed.set(r.place, { ...bracketSlot(r), rosterIndex: i })
    }
  }
  if (bySeed.size === 0) return

  const fresh = defaultBracket()
  fresh.label  = state.bracket.label
  fresh.active = state.bracket.active

  TOP8_PAIRS.forEach(([seedA, seedB], i) => {
    fresh.rounds[0][i].a = bySeed.get(seedA) ?? null
    fresh.rounds[0][i].b = bySeed.get(seedB) ?? null
  })

  state.bracket = fresh
  broadcast()
  writeObsFiles(state.bracket)
}

// `seed` is the player's placement going INTO the top 8 — what the overlay shows
// as "#3". A slot typed in by hand has no seed, and the overlay renders no badge
// for it rather than an empty one.
const bracketSlot = (r) => ({
  name:     r.name     ?? '',
  deckName: r.deckName ?? '',
  seed:     Number.isFinite(r.place) ? r.place : null,
})

// Fill the standings table from the roster's placements, best first. Only
// players with a `place` are used — at a live event nobody has one until the
// operator types it, so this is a no-op until placements exist.
export function seedStandingsFromRoster() {
  const placed = state.roster
    .filter(r => Number.isFinite(r.place))
    .sort((a, b) => a.place - b.place)
    .slice(0, state.standings.length)

  if (placed.length === 0) return

  state.standings = state.standings.map((row, i) => {
    const r = placed[i]
    if (!r) return { name: '', deckName: '', record: { w: 0, l: 0, d: 0 } }
    return {
      name:     r.name     ?? '',
      deckName: r.deckName ?? '',
      record:   r.record   ?? { w: 0, l: 0, d: 0 },
    }
  })
  broadcast()
}

// ── WebSocket clients ───────────────────────────────────────────
// A new client gets the live state immediately. It does NOT get the roster —
// overlays and the table page never use it, and the control panel asks for it
// with GET /api/roster once it connects.
export function addClient(ws) {
  wsClients.add(ws)
  ws.send(JSON.stringify({ type: 'state', data: getLiveState(), clientCount: wsClients.size }))
}

export function removeClient(ws) {
  wsClients.delete(ws)
  broadcast()
}

// The hot path: fires on every life tap, timer tick and name edit.
export function broadcast() {
  const msg = JSON.stringify({ type: 'state', data: getLiveState(), clientCount: wsClients.size })
  for (const client of wsClients) {
    if (client.readyState === 1) client.send(msg)
  }
}

// The cold path: fires on import and clear. Only the control panel listens.
export function broadcastRoster() {
  broadcastEvent('roster', getRoster())
}

export function broadcastEvent(type, data) {
  const msg = JSON.stringify({ type, data })
  for (const client of wsClients) {
    if (client.readyState === 1) client.send(msg)
  }
}

// ── Event file persistence ──────────────────────────────────────
export function saveEvent(name) {
  ensureEventsDir()
  const id    = slugify(name) + '-' + Date.now()
  const event = { id, name, savedAt: new Date().toISOString(), state: getState() }
  writeFileSync(join(EVENTS_DIR, `${id}.json`), JSON.stringify(event, null, 2))
  return event
}

export function listEvents() {
  ensureEventsDir()
  return readdirSync(EVENTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const ev = JSON.parse(readFileSync(join(EVENTS_DIR, f), 'utf8'))
        return { id: ev.id, name: ev.name, savedAt: ev.savedAt }
      } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
}

export function loadEvent(id) {
  ensureEventsDir()
  const path = join(EVENTS_DIR, `${id}.json`)
  if (!existsSync(path)) return null
  const ev = JSON.parse(readFileSync(path, 'utf8'))
  state = migrate(ev.state)
  broadcast()
  broadcastRoster()   // the loaded event carries its own field
  writeObsFiles(state.bracket)
  return ev
}

export function deleteEvent(id) {
  const path = join(EVENTS_DIR, `${id}.json`)
  if (existsSync(path)) unlinkSync(path)
}

// ── Auto-save ────────────────────────────────────────────────────
// kind='short' overwrites AutoSave-MTGBroadcast_latest.json
// kind='long'  writes a new timestamped file, never overwriting
export function autoSave(kind) {
  try {
    if (!existsSync(AUTOSAVE_DIR)) mkdirSync(AUTOSAVE_DIR, { recursive: true })
    const now      = new Date()
    const ts       = now.toISOString().replace(/T/, '_').replace(/:/g, '-').slice(0, 19)
    const filename = kind === 'short'
      ? 'AutoSave-MTGBroadcast_latest.json'
      : `AutoSave-MTGBroadcast_${ts}.json`
    const payload  = { name: 'AutoSave', savedAt: now.toISOString(), kind, state: getState() }
    writeFileSync(join(AUTOSAVE_DIR, filename), JSON.stringify(payload, null, 2))
    return filename
  } catch (err) {
    console.error('[autosave] Failed:', err.message)
    return null
  }
}

function ensureEventsDir() {
  if (!existsSync(EVENTS_DIR)) mkdirSync(EVENTS_DIR, { recursive: true })
}

// ── OBS text-file sync ──────────────────────────────────────────
// Writes champion name/deck to OBS/ so OBS text sources stay current.
function writeObsFiles(bracket) {
  try {
    if (!existsSync(OBS_DIR)) mkdirSync(OBS_DIR, { recursive: true })
    const finalMatch = bracket?.rounds?.[2]?.[0]
    const champ      = finalMatch?.winner ? finalMatch[finalMatch.winner] : null
    writeFileSync(join(OBS_DIR, 'champion.txt'),      champ?.name     ?? '', 'utf8')
    writeFileSync(join(OBS_DIR, 'champion-deck.txt'), champ?.deckName ?? '', 'utf8')
  } catch (err) {
    console.error('[OBS] Failed to write champion files:', err.message)
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
