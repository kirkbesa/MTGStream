// control/src/mtg.jsx — MTG display primitives for the control panel.
//
// The overlays get the same primitives from overlays/mtg.js, which is a plain
// <script> global because OBS browser sources have no bundler. This is the ESM
// twin of that file; the values must stay in step so the panel's preview of a
// card matches what actually goes to air.

export const COLORS = {
  W: '#f8e7b9', U: '#3b82c4', B: '#6b5b73',
  R: '#d3413a', G: '#3f9b52',
  Multicolor: '#d4af37',
  Colorless:  '#9aa3ab',
}

// The pale backgrounds used inside real mana symbols.
const PIP = {
  W: '#fffbd5', U: '#aae0fa', B: '#cbc2bf',
  R: '#f9aa8f', G: '#9bd3ae', C: '#ccc2c0',
}

export const TYPE_ORDER = [
  'Creature', 'Planeswalker', 'Instant', 'Sorcery',
  'Artifact', 'Enchantment', 'Battle', 'Land',
]

export const TYPE_COLORS = {
  Creature:     '#c9704f',
  Planeswalker: '#a855f7',
  Instant:      '#3b82c4',
  Sorcery:      '#d3413a',
  Artifact:     '#9aa3ab',
  Enchantment:  '#3f9b52',
  Battle:       '#e0a458',
  Land:         '#8b6f47',
}

export const typeColor = (t) => TYPE_COLORS[t] ?? '#9aa3ab'

export const plural = (type, n) =>
  n === 1 ? type : type === 'Sorcery' ? 'Sorceries' : `${type}s`

// Renders "{1}{W}{U}" as mana pips. Hybrid/Phyrexian collapse to their leading
// colour — a split pip is unreadable at this size.
export function ManaCost({ cost, size = 15 }) {
  if (!cost) return null
  const symbols = cost.match(/\{[^}]+\}/g) ?? []

  return (
    <span className="mana">
      {symbols.map((sym, i) => {
        const inner   = sym.slice(1, -1)
        const first   = inner.split('/')[0]
        const isColor = 'WUBRG'.includes(first)
        return (
          <span
            key={i}
            className="pip"
            style={{
              width: size, height: size,
              fontSize: Math.round(size * 0.62),
              background: isColor ? PIP[first] : PIP.C,
            }}
          >
            {isColor ? first : inner}
          </span>
        )
      })}
    </span>
  )
}

export function groupByType(rows) {
  const groups = new Map()
  for (const r of rows) {
    const t = r.type || 'Other'
    if (!groups.has(t)) groups.set(t, [])
    groups.get(t).push(r)
  }
  const ordered = []
  for (const t of TYPE_ORDER) {
    if (groups.has(t)) { ordered.push([t, groups.get(t)]); groups.delete(t) }
  }
  for (const entry of groups) ordered.push(entry)
  return ordered
}

// Sort a deck section the way a player reads their own list: the 4-ofs that
// define the deck first, then up the curve.
export const sortDeckRows = (rows) =>
  [...rows].sort((a, b) =>
    b.count - a.count || (a.cmc ?? 0) - (b.cmc ?? 0) || a.name.localeCompare(b.name)
  )
