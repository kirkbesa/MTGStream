// server/decklist.js — parse a pasted MTG decklist into resolved main/sideboard.
//
// Decklists arrive from players in whatever format their client exports, so the
// parser accepts all the common ones rather than making the operator reformat
// under time pressure:
//
//   MTGO / plain            Arena                    MTGO .dek
//   ─────────────           ─────────────            ─────────────
//   4 Lightning Bolt        Deck                     4 Lightning Bolt
//   4 Counterspell          4 Lightning Bolt (M10) 146    SB: 2 Pyroblast
//                           2 Counterspell (MH2) 267
//   3 Pyroblast             Sideboard
//   ^ blank line splits     2 Pyroblast (ICE) 213
//
// Sideboard detection, in priority order:
//   1. An explicit section header ("Sideboard", "SB:", "// Sideboard")
//   2. A per-line "SB:" prefix
//   3. Failing both, the first blank line after the mainboard has started
//
// (3) is a heuristic and only fires when no explicit marker exists anywhere —
// otherwise a decklist that merely groups creatures/spells with blank lines
// would have its second group silently read as a sideboard.

import { resolveByDisplayName, getCardsByNames, normalize } from './scryfall.js'

const RE_SIDE_HEADER = /^(\/\/\s*)?side\s*-?\s*board\b\s*:?\s*$/i
const RE_MAIN_HEADER = /^(\/\/\s*)?(deck|main\s*-?\s*board|main)\b\s*:?\s*$/i
// Headers we skip entirely — Arena emits these but they aren't the 60/15.
const RE_SKIP_HEADER = /^(\/\/\s*)?(companion|commander|about|name)\b\s*:?\s*$/i
const RE_SB_PREFIX   = /^SB:\s*/i

// "4 Lightning Bolt (M10) 146" / "4x Lightning Bolt [M10]" / "4 Lightning Bolt"
// Set code and collector number are captured only so they can be discarded —
// we always resolve by name and let Scryfall pick the printing.
const RE_LINE = /^(\d+)\s*x?\s+(.+?)\s*(?:[([][A-Za-z0-9_]{2,6}[)\]]\s*\S*)?\s*$/

export function parseDecklist(text) {
  const lines = String(text ?? '').split(/\r?\n/)

  const hasExplicitSide = lines.some(l => RE_SIDE_HEADER.test(l.trim()) || RE_SB_PREFIX.test(l.trim()))

  const main = []
  const side = []
  let section = 'main'
  let seenMain = false

  for (const raw of lines) {
    const line = raw.trim()

    if (!line) {
      // Blank-line sideboard split — only when the list gave us nothing better.
      if (!hasExplicitSide && seenMain) section = 'side'
      continue
    }

    if (RE_SIDE_HEADER.test(line)) { section = 'side'; continue }
    if (RE_MAIN_HEADER.test(line)) { section = 'main'; continue }
    if (RE_SKIP_HEADER.test(line)) { continue }
    if (line.startsWith('//'))     { continue }   // comment

    // Per-line "SB:" wins over the current section.
    const isSbLine = RE_SB_PREFIX.test(line)
    const body     = isSbLine ? line.replace(RE_SB_PREFIX, '') : line

    const m = body.match(RE_LINE)
    if (!m) continue   // unparseable line — skip rather than fail the import

    const entry = { count: parseInt(m[1], 10), rawName: m[2].trim() }
    if (!entry.rawName || !Number.isFinite(entry.count)) continue

    if (isSbLine || section === 'side') {
      side.push(entry)
    } else {
      main.push(entry)
      seenMain = true
    }
  }

  return { main, side }
}

const toRow = (count, card) => ({
  count,
  identifier: card.identifier,
  name:       card.name,
  manaCost:   card.manaCost,
  cmc:        card.cmc,
  type:       card.type,
  typeLine:   card.typeLine,
  color:      card.color,
  colors:     card.colors,
  rarity:     card.rarity,
  legal:      card.legal,
  imageUrl:   `/cards/${card.identifier}`,
})

// Turn parsed entries into resolved rows using an already-fetched name→card map,
// falling back to a per-card fuzzy lookup for anything the batch missed (a typo,
// or a name only fuzzy matching can rescue).
//
// Cards that still don't resolve are kept in `unresolved` with suggestions
// rather than dropped: a silently-missing card in a deck reveal is worse than a
// visible error.
async function resolveSection(entries, byName) {
  const rows = []
  const unresolved = []

  for (const { count, rawName } of entries) {
    const card = byName.get(normalize(rawName))
    if (card) {
      rows.push(toRow(count, card))
      continue
    }

    const { card: fuzzy, suggestions } = await resolveByDisplayName(rawName)
    if (fuzzy) rows.push(toRow(count, fuzzy))
    else       unresolved.push({ count, rawName, suggestions })
  }

  return { rows, unresolved }
}

// Returns the fully-resolved decklist that gets stored directly in state.
//
// Every name in the list is fetched in ONE batched request (Scryfall's
// /cards/collection takes 75 at a time) before anything is resolved. Doing a
// request per card instead gets a bulk roster import rate-limited, and a
// throttled card is a card missing from the deck reveal.
export async function resolveDecklist(text) {
  const { main, side } = parseDecklist(text)

  const names = [...main, ...side].map(e => e.rawName)
  const byName = await getCardsByNames(names)

  const mainRes = await resolveSection(main, byName)
  const sideRes = await resolveSection(side, byName)

  return {
    main:       mainRes.rows,
    side:       sideRes.rows,
    unresolved: [...mainRes.unresolved, ...sideRes.unresolved],
  }
}
