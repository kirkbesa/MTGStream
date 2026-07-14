// overlays/mtg.js — MTG rendering primitives shared by every overlay.
//
// Loaded the same way as ws.js:
//   <script src="/overlays/mtg.js"></script>
//
// Exposes window.MTG with:
//   COLORS       WUBRG → hex, for accents and charts
//   PIP          WUBRG → the pale symbol-background colours cards actually use
//   TYPE_ORDER   the order a decklist groups types in
//   typeColor(t) accent colour for a card type
//   colorOf(c)   accent colour for a resolved card (handles multicolor/colorless)
//   manaPips(s)  "{2}{R}" → DOM nodes rendering the mana symbols
//   curve(rows)  decklist rows → mana-curve buckets
//   colorBreakdown(rows) → WUBRG pip counts across a decklist

;(function () {
  // Official-ish identity colours, saturated enough to read on a dark overlay.
  const COLORS = {
    W: '#f8e7b9', U: '#3b82c4', B: '#6b5b73',
    R: '#d3413a', G: '#3f9b52',
    Multicolor: '#d4af37',   // gold, as on a multicolour card frame
    Colorless:  '#9aa3ab',
  }

  // The pale backgrounds used inside real mana symbols.
  const PIP = {
    W: '#fffbd5', U: '#aae0fa', B: '#cbc2bf',
    R: '#f9aa8f', G: '#9bd3ae', C: '#ccc2c0',
  }

  const TYPE_ORDER = [
    'Creature', 'Planeswalker', 'Instant', 'Sorcery',
    'Artifact', 'Enchantment', 'Battle', 'Land',
  ]

  const TYPE_COLORS = {
    Creature:     '#c9704f',
    Planeswalker: '#a855f7',
    Instant:      '#3b82c4',
    Sorcery:      '#d3413a',
    Artifact:     '#9aa3ab',
    Enchantment:  '#3f9b52',
    Battle:       '#e0a458',
    Land:         '#8b6f47',
  }

  function typeColor(type) {
    return TYPE_COLORS[type] ?? '#9aa3ab'
  }

  // Accent colour for a card. `colors` is the WUBRG array from Scryfall.
  function colorOf(card) {
    const cs = card?.colors ?? []
    if (cs.length === 0) return COLORS.Colorless
    if (cs.length > 1)   return COLORS.Multicolor
    return COLORS[cs[0]] ?? COLORS.Colorless
  }

  // Render "{1}{W}{U}" as a row of mana pips.
  // Hybrid ("{W/U}") and Phyrexian ("{W/P}") are rendered as a single pip taking
  // the first colour — good enough at overlay size, where a split pip would be
  // an unreadable few pixels.
  function manaPips(manaCost, size = 16) {
    const frag = document.createDocumentFragment()
    if (!manaCost) return frag

    const symbols = manaCost.match(/\{[^}]+\}/g) ?? []
    for (const sym of symbols) {
      const inner = sym.slice(1, -1)            // "{2}" → "2", "{W/U}" → "W/U"
      const first = inner.split('/')[0]          // hybrid → leading colour
      const isColor = 'WUBRG'.includes(first)

      const pip = document.createElement('span')
      pip.className = 'mana-pip'
      pip.textContent = isColor ? first : inner
      pip.style.cssText = `
        display:inline-flex; align-items:center; justify-content:center;
        width:${size}px; height:${size}px; border-radius:50%;
        background:${isColor ? PIP[first] : PIP.C};
        color:#0b0b0b; font-weight:800; font-size:${Math.round(size * 0.62)}px;
        line-height:1; margin-right:3px; flex-shrink:0;
        box-shadow:inset 0 -1px 2px rgba(0,0,0,.35);
      `
      frag.appendChild(pip)
    }
    return frag
  }

  // Mana curve. Lands are excluded — they have no cost and would swamp the
  // 0-drop bucket, which is the single most misleading thing a curve can do.
  // 7+ is a single bucket, as every deckbuilding tool renders it.
  function curve(rows) {
    const buckets = [0, 0, 0, 0, 0, 0, 0, 0]   // index = cmc, 7 = "7+"
    for (const r of rows) {
      if (r.type === 'Land') continue
      const cmc = Math.max(0, Math.round(r.cmc ?? 0))
      buckets[Math.min(cmc, 7)] += r.count
    }
    return buckets
  }

  // Count coloured mana pips across the deck — a truer picture of what a deck
  // is actually casting than counting cards by colour, because it weights
  // {R}{R} twice as heavily as {R}.
  function colorBreakdown(rows) {
    const out = { W: 0, U: 0, B: 0, R: 0, G: 0 }
    for (const r of rows) {
      const symbols = (r.manaCost ?? '').match(/\{[^}]+\}/g) ?? []
      for (const sym of symbols) {
        for (const ch of sym.slice(1, -1).split('/')) {
          if (out[ch] !== undefined) out[ch] += r.count
        }
      }
    }
    return out
  }

  // Group decklist rows by primary type, in TYPE_ORDER.
  function groupByType(rows) {
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
    for (const [t, rows] of groups) ordered.push([t, rows])   // anything unexpected, last
    return ordered
  }

  const plural = (type, n) => (n === 1 ? type : type === 'Sorcery' ? 'Sorceries' : `${type}s`)

  window.MTG = {
    COLORS, PIP, TYPE_ORDER, TYPE_COLORS,
    typeColor, colorOf, manaPips, curve, colorBreakdown, groupByType, plural,
  }
})()
