// server/roster.js — bulk import of a whole tournament field.
//
// Rosters come out of registration platforms (Melee, EventLink, Companion,
// a Google Form…), and every one of them exports something different. So rather
// than force a bespoke format, the importer sniffs the content and accepts all
// three shapes a roster realistically arrives in:
//
//   • JSON  — an array of player objects
//   • CSV   — one row per player, decklist in a quoted multi-line cell
//   • TEXT  — "Player:" header blocks (what you'd hand-write or scrape)
//
// Everything normalises to the same entry shape, then each decklist goes through
// the same parser used for single-player imports. Field names are matched
// loosely (see FIELD_ALIASES) because no two exports agree on what to call the
// player's name.
//
// `place` is optional throughout. At a live event you don't know placements at
// import time — they're edited in the panel as the event plays out. Supporting
// it anyway means a *finished* tournament can be imported with standings intact.

import Papa from 'papaparse'
import { resolveDecklist } from './decklist.js'

// ── Field aliases ────────────────────────────────────────────────
// Registration exports disagree on column names, so match on a normalised key.
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

const FIELD_ALIASES = {
  name:      ['player', 'playername', 'name', 'fullname', 'displayname', 'handle1'],
  deckName:  ['deck', 'deckname', 'archetype', 'decklistname', 'list'],
  place:     ['place', 'placement', 'rank', 'standing', 'finish', 'position'],
  handle:    ['handle', 'twitter', 'social', 'username', 'discord'],
  pronouns:  ['pronoun', 'pronouns'],
  decklist:  ['decklist', 'deck list', 'cards', 'maindeck', 'main'],
  mainboard: ['mainboard', 'maindeck', 'main', 'decklist'],
  sideboard: ['sideboard', 'side', 'sb'],
}

// Pull the first field on `obj` whose key matches one of the aliases.
function pick(obj, aliases) {
  for (const [k, v] of Object.entries(obj)) {
    if (aliases.includes(norm(k))) {
      if (v != null && String(v).trim() !== '') return v
    }
  }
  return undefined
}

// A decklist field may be a plain string ("4 Lightning Bolt\n…") or a structured
// array ([{count, name}] or ["4 Lightning Bolt"]). Normalise to decklist text so
// there's exactly one downstream parser.
function toDeckText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value

  if (Array.isArray(value)) {
    return value.map(entry => {
      if (typeof entry === 'string') return entry
      if (entry && typeof entry === 'object') {
        const count = entry.count ?? entry.quantity ?? entry.qty ?? entry.n ?? 1
        const name  = entry.name ?? entry.card ?? entry.cardName ?? ''
        return name ? `${count} ${name}` : ''
      }
      return ''
    }).filter(Boolean).join('\n')
  }

  return ''
}

// Build one normalised entry from a plain object (a JSON element or a CSV row).
function entryFromObject(obj) {
  const name = pick(obj, FIELD_ALIASES.name)
  if (!name) return null

  // A row may carry one combined decklist, or separate main/side columns.
  const main = toDeckText(pick(obj, FIELD_ALIASES.mainboard) ?? pick(obj, FIELD_ALIASES.decklist))
  const side = toDeckText(pick(obj, FIELD_ALIASES.sideboard))

  // The decklist parser already understands a "Sideboard" header, so when the
  // two arrive in separate columns we just re-join them with one.
  const deckText = side.trim()
    ? `${main}\nSideboard\n${side}`
    : main

  const placeRaw = pick(obj, FIELD_ALIASES.place)
  const place    = Number.parseInt(placeRaw, 10)

  return {
    name:     String(name).trim(),
    deckName: String(pick(obj, FIELD_ALIASES.deckName) ?? '').trim(),
    handle:   String(pick(obj, FIELD_ALIASES.handle)   ?? '').trim(),
    pronouns: String(pick(obj, FIELD_ALIASES.pronouns) ?? '').trim(),
    place:    Number.isFinite(place) ? place : null,
    deckText,
  }
}

// ── TEXT format ──────────────────────────────────────────────────
//
//   Player: Plachy
//   Deck: Jund Wildfire
//   Place: 1
//   4 Writhing Chrysalis
//   Sideboard
//   2 Gorilla Shaman
//
// Also accepts a "1. Jund Wildfire — Plachy" one-liner as a header.
const RE_PLAYER   = /^(?:player|name)\s*:\s*(.+)$/i
const RE_DECK     = /^(?:deck(?:\s*name)?|archetype)\s*:\s*(.+)$/i
const RE_PLACE    = /^(?:place|placement|rank|standing)\s*:\s*(\d+)/i
const RE_HANDLE   = /^(?:handle|twitter|social)\s*:\s*(.+)$/i
const RE_PRONOUNS = /^pronouns?\s*:\s*(.+)$/i
const RE_ONELINER = /^(\d+)\s*[.)]\s*(.+?)\s+[—–-]\s+(.+)$/

function parseText(text) {
  const entries = []
  let current = null

  const push = () => { if (current?.name) entries.push(current) }
  const start = (fields) => {
    push()
    current = { name: '', deckName: '', place: null, handle: '', pronouns: '', lines: [], ...fields }
  }

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('#')) continue

    const player = line.match(RE_PLAYER)
    if (player) { start({ name: player[1].trim() }); continue }

    // "1. Jund Wildfire — Plachy". A decklist line is "4 Card Name" — no dot
    // after the number — so this can never swallow a card.
    const one = line.match(RE_ONELINER)
    if (one) {
      start({ place: +one[1], deckName: one[2].trim(), name: one[3].trim() })
      continue
    }

    if (!current) continue   // preamble before the first player

    const deck     = line.match(RE_DECK)
    const place    = line.match(RE_PLACE)
    const handle   = line.match(RE_HANDLE)
    const pronouns = line.match(RE_PRONOUNS)

    if (deck)     { current.deckName = deck[1].trim();     continue }
    if (place)    { current.place    = +place[1];          continue }
    if (handle)   { current.handle   = handle[1].trim();   continue }
    if (pronouns) { current.pronouns = pronouns[1].trim(); continue }

    current.lines.push(raw)
  }
  push()

  return entries.map(e => ({
    name: e.name, deckName: e.deckName, handle: e.handle,
    pronouns: e.pronouns, place: e.place,
    deckText: e.lines.join('\n'),
  }))
}

// ── Format detection ─────────────────────────────────────────────
// Content-sniffed rather than trusting a file extension, since a roster may be
// pasted into the textarea with no filename at all.
export function detectFormat(content) {
  const t = String(content ?? '').trim()
  if (!t) return 'empty'
  if (t.startsWith('[') || t.startsWith('{')) return 'json'

  // A "Player:" / "1. Deck — Name" header means the text format. Check this
  // before CSV: a text roster's first line could otherwise look like a CSV row.
  const firstLines = t.split(/\r?\n/).slice(0, 40)
  if (firstLines.some(l => RE_PLAYER.test(l.trim()) || RE_ONELINER.test(l.trim()))) return 'text'

  // A header row naming a player column, plus a comma or tab → CSV.
  const header = firstLines[0] ?? ''
  if (/[,\t;]/.test(header)) {
    const cols = header.split(/[,\t;]/).map(norm)
    if (cols.some(c => FIELD_ALIASES.name.includes(c))) return 'csv'
  }

  return 'text'
}

export function parseRoster(content) {
  const format = detectFormat(content)

  if (format === 'empty') return []

  if (format === 'json') {
    let data
    try {
      data = JSON.parse(content)
    } catch (err) {
      throw new Error(`Invalid JSON: ${err.message}`)
    }
    // Accept a bare array, or an object wrapping one ({ players: [...] }).
    const rows = Array.isArray(data)
      ? data
      : (data.players ?? data.roster ?? data.standings ?? data.data ?? [])
    if (!Array.isArray(rows)) throw new Error('JSON must be an array of players, or an object containing one.')
    return rows.map(entryFromObject).filter(Boolean)
  }

  if (format === 'csv') {
    // Papa handles quoted cells with embedded newlines — which is exactly how a
    // decklist survives a trip through a spreadsheet.
    const { data, errors } = Papa.parse(String(content).trim(), {
      header: true,
      skipEmptyLines: true,
    })
    // Field-count mismatches on trailing blank lines are common and harmless;
    // only a total failure to find rows is worth erroring on.
    if (!data.length) {
      throw new Error(errors[0]?.message ?? 'No rows found in CSV.')
    }
    return data.map(entryFromObject).filter(Boolean)
  }

  return parseText(content)
}

// ── Resolution ───────────────────────────────────────────────────
// Sequential, not parallel: scryfall.js already serialises requests behind a
// 100ms queue, so firing 64 decks at once just builds a long queue with no
// speedup — and would make progress reporting meaningless. onProgress drives
// the import UI, because a large field takes minutes and a silent spinner is
// indistinguishable from a hang.
export async function resolveRoster(content, onProgress) {
  const entries = parseRoster(content)
  const players = []

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const decklist = e.deckText.trim()
      ? await resolveDecklist(e.deckText)
      : null

    players.push({
      name:     e.name,
      deckName: e.deckName,
      handle:   e.handle,
      pronouns: e.pronouns,
      place:    e.place,
      decklist,
    })

    onProgress?.({ done: i + 1, total: entries.length, name: e.name })
  }

  return players
}
