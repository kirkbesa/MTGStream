// server/scryfall.js — MTG card data via the Scryfall API, with a disk cache.
//
//   searchCards(query, limit)   → Card[]
//   getCard(identifier)         → Card | null
//   getCardsByNames(names)      → Map(normalizedName → Card)   (batched)
//   resolveByDisplayName(name)  → { card, suggestions }
//   resolveImagePath(identifier)→ '/cards/<id>' | null
//
// Two things make this safe to run at a live event:
//
//   1. Everything is cached to disk (.cache/cards/*.json, .cache/img/*.jpg).
//      Once a card has been looked up it never needs the network again, so a
//      venue Wi-Fi drop mid-match cannot blank an overlay that was already
//      showing a card. Decklists warm the cache the moment they're imported.
//
//   2. Requests are serialised through a 100 ms queue. Scryfall asks for
//      50–100 ms between calls and will rate-limit (429) otherwise; a burst of
//      75 decklist lookups would trip that instantly without the queue.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname  = dirname(fileURLToPath(import.meta.url))
const ROOT       = join(__dirname, '..')
const CACHE_DIR  = join(ROOT, '.cache')
const CARDS_DIR  = join(CACHE_DIR, 'cards')
const IMG_DIR    = join(CACHE_DIR, 'img')

const API = 'https://api.scryfall.com'

// Scryfall requires a descriptive User-Agent and an explicit Accept header.
const HEADERS = {
  'User-Agent': 'MTGStream/1.0 (broadcast overlay tool)',
  'Accept':     'application/json',
}

// Format scope. Every search is narrowed to this so the operator can only ever
// pick a format-legal card. Pauper legality is per-printing (a card can be
// common in one set and uncommon in another), and `f:pauper` handles that for
// us — checking `rarity == common` on a single printing would not.
//
// Changing format is a source edit, on purpose: it decides what's in the disk
// cache and what a decklist resolves to, so it is not something to flip
// mid-broadcast from a UI.
const FORMAT = 'pauper'
export function getFormat() { return FORMAT }

// ── Rate-limited request queue ───────────────────────────────────
// Serialises every outbound call with a gap between them. Scryfall asks for
// 50-100ms; we use 120ms because they throttle on a rolling window and a
// bulk roster import will otherwise ride the edge of it.
const MIN_GAP_MS = 120
let chain = Promise.resolve()

function enqueue(fn) {
  const run = chain.then(fn)
  // Advance the chain regardless of whether `fn` rejected, so one failed
  // lookup doesn't wedge the queue for every request behind it.
  chain = run.then(
    () => sleep(MIN_GAP_MS),
    () => sleep(MIN_GAP_MS),
  )
  return run
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Retry on 429 and 5xx with exponential backoff.
//
// This matters more than it looks: without it, a single throttled response
// silently drops that card from a decklist for the rest of the event. A 64-deck
// import is exactly the burst that provokes 429s, and "Plains failed to resolve"
// is not something you want to discover on air.
const MAX_RETRIES = 4

async function request(path, init) {
  return enqueue(async () => {
    let wait = 400

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let res
      try {
        res = await fetch(`${API}${path}`, { headers: HEADERS, ...init })
      } catch (err) {
        // Network-level failure (socket reset, DNS blip). Retry it.
        if (attempt === MAX_RETRIES) throw err
        await sleep(wait); wait *= 2
        continue
      }

      if (res.status === 404) return null
      if (res.ok) return res.json()

      const retryable = res.status === 429 || res.status >= 500
      if (!retryable || attempt === MAX_RETRIES) {
        throw new Error(`Scryfall ${res.status} on ${path}`)
      }

      // Honour Retry-After when Scryfall sends it, else back off exponentially.
      const after = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : wait)
      wait *= 2
    }
  })
}

const api = (path) => request(path)

const apiPost = (path, body) => request(path, {
  method: 'POST',
  headers: { ...HEADERS, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// ── Card normalisation ───────────────────────────────────────────
// Scryfall's payload is large and deeply nested. Overlays want a flat shape,
// and the old Vibes card object had `identifier / name / type / color / cost`,
// so we keep those keys meaning the analogous MTG thing and add the rest.

// The order types are CHECKED in when a card has several ("Artifact Creature").
// This is not the display order — see TYPE_ORDER in overlays/mtg.js for that.
//
// Land comes first, and that matters: an artifact land (Drossforge Bridge, Vault
// of Whispers — staples of Pauper affinity) is a LAND. It's played from hand as
// a land drop, not cast, and has no mana cost. Classifying it as an Artifact
// would both undercount the mana base and dump a pile of 0-cost cards into the
// mana curve's 0-drop column, which are excluded precisely because lands have no
// cost. The curve would be nonsense.
//
// Creature comes before Artifact/Enchantment for the opposite reason: an artifact
// creature or enchantment creature IS cast and IS a creature, which is how any
// decklist groups it.
const TYPE_DETECT_ORDER = [
  'Land',
  'Creature', 'Planeswalker', 'Instant', 'Sorcery',
  'Artifact', 'Enchantment', 'Battle',
]

// "Legendary Artifact Creature — Golem" → primary 'Creature', subtype 'Golem'.
function splitTypeLine(typeLine = '') {
  const [left, right] = typeLine.split(/\s+[—–-]\s+/)
  const primary = TYPE_DETECT_ORDER.find(t => new RegExp(`\\b${t}s?\\b`).test(left ?? '')) ?? (left ?? '').trim()
  return { type: primary, subtype: (right ?? '').trim() }
}

// Double-faced cards (transform, MDFC) carry images and mana cost on
// card_faces[] rather than at the top level.
function face(card) {
  if (card.image_uris) return card
  return card.card_faces?.[0] ?? card
}

// Bump when the shape or the meaning of a normalised card changes. Cached JSON
// with an older version is ignored on load and silently refetched, so a fix to
// (say) how types are classified doesn't leave stale cards on disk forever.
// Images are keyed by Scryfall id and unaffected — they're never re-downloaded.
const CACHE_VERSION = 2

function normalizeCard(raw) {
  if (!raw) return null
  const f = face(raw)
  const { type, subtype } = splitTypeLine(raw.type_line ?? f.type_line ?? '')

  return {
    _v:           CACHE_VERSION,
    identifier:   raw.id,                      // Scryfall UUID — stable, unique
    name:         raw.name,
    setName:      raw.set_name,
    setCode:      raw.set,
    number:       raw.collector_number,
    rarity:       raw.rarity,

    manaCost:     f.mana_cost ?? '',
    cost:         raw.cmc ?? 0,                // `cost` kept as the numeric CMC
    cmc:          raw.cmc ?? 0,
    colors:       f.colors ?? raw.colors ?? [],
    colorIdentity: raw.color_identity ?? [],
    color:        colorLabel(f.colors ?? raw.colors ?? []),

    type,
    subtype,
    typeLine:     raw.type_line ?? '',
    oracleText:   f.oracle_text ?? '',
    power:        f.power ?? null,
    toughness:    f.toughness ?? null,
    loyalty:      f.loyalty ?? null,

    legal:        raw.legalities?.[FORMAT] === 'legal',
    scryfallUri:  raw.scryfall_uri,
    // Play-popularity rank (lower = more played). Used to break search ties so
    // the iconic card wins; absent on some cards, hence the Infinity fallback.
    edhrecRank:   raw.edhrec_rank ?? Infinity,

    // Remote URLs — cached to disk lazily by cacheImage()
    _imgNormal:   f.image_uris?.normal ?? null,
    _imgArtCrop:  f.image_uris?.art_crop ?? null,
  }
}

// WUBRG → a single label the overlays can colour by.
function colorLabel(colors) {
  if (!colors || colors.length === 0) return 'Colorless'
  if (colors.length > 1)             return 'Multicolor'
  return { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }[colors[0]] ?? 'Colorless'
}

// ── Disk cache ───────────────────────────────────────────────────
const memCards = new Map()   // id → Card
const memByName = new Map()  // normalized name → Card

export function normalize(str) {
  return String(str ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function cardPath(id) { return join(CARDS_DIR, `${id}.json`) }
function imgPath(id)  { return join(IMG_DIR,   `${id}.jpg`) }

function ensureDirs() {
  for (const d of [CACHE_DIR, CARDS_DIR, IMG_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
  }
}

function remember(card) {
  if (!card) return card
  memCards.set(card.identifier, card)
  memByName.set(normalize(card.name), card)
  try {
    writeFileSync(cardPath(card.identifier), JSON.stringify(card), 'utf8')
  } catch (err) {
    console.warn('[scryfall] cache write failed:', err.message)
  }
  cacheImage(card)   // fire-and-forget; overlays fall back to remote URL meanwhile
  return card
}

// Warm the in-memory maps from whatever is already on disk. Lets the app do
// useful work with no network at all, as long as the cards were seen before.
export function loadCards() {
  ensureDirs()
  let n = 0, stale = 0
  for (const f of readdirSync(CARDS_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const card = JSON.parse(readFileSync(join(CARDS_DIR, f), 'utf8'))
      // Ignore entries written by an older normalisation — they'll be refetched
      // on next use and overwritten.
      if (card._v !== CACHE_VERSION) { stale++; continue }
      memCards.set(card.identifier, card)
      memByName.set(normalize(card.name), card)
      n++
    } catch { /* skip a corrupt cache entry rather than failing startup */ }
  }
  console.log(`[scryfall] ${n} cards warm from cache` +
              `${stale ? ` (${stale} stale, will refetch)` : ''} · format: ${FORMAT}`)
}

// Downloading the card image so the overlay never depends on cards.scryfall.io
// being reachable during a match.
//
// The image CDN is separate from the API and not rate-limited, so these don't go
// through the request queue. They ARE capped at a few in flight though: a bulk
// roster import resolves hundreds of cards in a burst, and firing that many
// concurrent downloads exhausts the socket pool and starts failing the API
// requests sharing it.
const IMG_CONCURRENCY = 4
const imgInFlight = new Set()
const imgQueue = []
let imgActive = 0

function cacheImage(card) {
  const id = card.identifier
  if (!card._imgNormal || existsSync(imgPath(id)) || imgInFlight.has(id)) return
  imgInFlight.add(id)
  imgQueue.push(card)
  pumpImageQueue()
}

function pumpImageQueue() {
  while (imgActive < IMG_CONCURRENCY && imgQueue.length > 0) {
    const card = imgQueue.shift()
    imgActive++
    downloadImage(card).finally(() => {
      imgActive--
      imgInFlight.delete(card.identifier)
      pumpImageQueue()
    })
  }
}

async function downloadImage(card) {
  try {
    const res = await fetch(card._imgNormal, { headers: { 'User-Agent': HEADERS['User-Agent'] } })
    if (!res.ok) return
    writeFileSync(imgPath(card.identifier), Buffer.from(await res.arrayBuffer()))
  } catch (err) {
    console.warn(`[scryfall] image cache failed for ${card.name}:`, err.message)
  }
}

// Called by the /cards/:id route in index.js.
export function getCachedImagePath(id) {
  const p = imgPath(id)
  return existsSync(p) ? p : null
}

export function getRemoteImageUrl(id) {
  return memCards.get(id)?._imgNormal ?? null
}

// ── Public lookup API ────────────────────────────────────────────

export async function searchCards(query, limit = 40) {
  const q = String(query ?? '').trim()
  if (!q) return []

  // Scope to the broadcast format so only legal cards are ever pickable.
  const scoped = `${q} f:${FORMAT}`

  try {
    const data = await api(`/cards/search?q=${encodeURIComponent(scoped)}&unique=cards&order=name`)
    if (!data?.data) return []
    const cards = data.data.map(raw => remember(normalizeCard(raw)))
    return rankByName(cards, q).slice(0, limit)
  } catch (err) {
    console.warn('[scryfall] search failed:', err.message)
    // Offline fallback — substring match over whatever is already cached.
    const nq = normalize(q)
    const hits = [...memCards.values()].filter(c => normalize(c.name).includes(nq))
    return rankByName(hits, q).slice(0, limit)
  }
}

// Scryfall returns matches in alphabetical order, which buries the obvious
// answer: searching "bolt" lists Blastfire Bolt and Bolt of Keranos above
// Lightning Bolt. On a live broadcast the operator types a few letters and
// expects the card they mean to be first, so re-rank before truncating.
//
// Tiers are exact > word-start > substring. Note that a leading-prefix match is
// deliberately NOT its own tier above word-start: "Bolt of Keranos" starts with
// "bolt" but nobody means it, whereas "Lightning Bolt" only matches mid-name.
// Both land in the word-start tier and edhrecRank breaks the tie correctly.
function rankByName(cards, query) {
  const q = normalize(query)
  const wordStart = new RegExp(`\\b${escapeRe(query.trim())}`, 'i')
  const score = card => {
    const n = normalize(card.name)
    if (n === q)                  return 0
    if (wordStart.test(card.name)) return 1
    if (n.includes(q))            return 2
    return 3
  }
  return [...cards].sort((a, b) =>
    score(a) - score(b) ||
    a.edhrecRank - b.edhrecRank ||     // within a tier, the more-played card wins
    a.name.localeCompare(b.name)
  )
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export async function getCard(identifier) {
  if (!identifier) return null

  // Cache first — by Scryfall id, then by name.
  if (memCards.has(identifier)) return memCards.get(identifier)
  const byName = memByName.get(normalize(identifier))
  if (byName) return byName

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)

  try {
    const raw = isUuid
      ? await api(`/cards/${identifier}`)
      : await api(`/cards/named?exact=${encodeURIComponent(identifier)}`)
    return remember(normalizeCard(raw))
  } catch (err) {
    console.warn(`[scryfall] getCard(${identifier}) failed:`, err.message)
    return null
  }
}

// Resolve many card names in one go.
//
// Scryfall's /cards/collection takes up to 75 identifiers per POST, so a
// 60-card decklist is ONE request instead of sixty, and a 64-player roster is a
// handful instead of ~1600. That's the difference between a bulk import that
// finishes in seconds and one that gets rate-limited into dropping cards.
//
// Returns Map(normalizedRequestedName → Card). Names Scryfall couldn't match
// are simply absent; the caller falls back to fuzzy matching for those.
const COLLECTION_MAX = 75

export async function getCardsByNames(names) {
  const found = new Map()
  const missing = []

  // Anything already cached costs nothing.
  for (const name of names) {
    const key = normalize(name)
    if (!key) continue
    const hit = memByName.get(key)
    if (hit) found.set(key, hit)
    else if (!missing.some(n => normalize(n) === key)) missing.push(name)
  }

  for (let i = 0; i < missing.length; i += COLLECTION_MAX) {
    const batch = missing.slice(i, i + COLLECTION_MAX)
    try {
      const data = await apiPost('/cards/collection', {
        identifiers: batch.map(name => ({ name })),
      })

      for (const raw of data?.data ?? []) {
        const card = remember(normalizeCard(raw))
        found.set(normalize(card.name), card)
      }

      // Scryfall matches on exact name here. When a requested name resolved to a
      // card whose printed name differs (split cards, "Fire // Ice"), key it under
      // the requested spelling too so the caller's lookup hits.
      for (const name of batch) {
        const key = normalize(name)
        if (found.has(key)) continue
        for (const card of found.values()) {
          if (normalize(card.name).startsWith(key)) { found.set(key, card); break }
        }
      }
    } catch (err) {
      // A failed batch isn't fatal — those names fall through to the per-card
      // fuzzy path, which is slower but still resolves them.
      console.warn(`[scryfall] collection batch failed: ${err.message}`)
    }
  }

  return found
}

// Resolve a human-typed / pasted card name. Mirrors the old signature so the
// decklist importer keeps working: returns the card, or suggestions when the
// name doesn't resolve cleanly.
export async function resolveByDisplayName(rawName) {
  const name = String(rawName ?? '').trim()
  if (!name) return { card: null, suggestions: [] }

  const cached = memByName.get(normalize(name))
  if (cached) return { card: cached, suggestions: [] }

  try {
    // Fuzzy match handles the usual decklist noise — punctuation, missing
    // accents, split-card halves ("Fire" for "Fire // Ice").
    const raw = await api(`/cards/named?fuzzy=${encodeURIComponent(name)}`)
    if (raw) return { card: remember(normalizeCard(raw)), suggestions: [] }
  } catch (err) {
    console.warn(`[scryfall] fuzzy "${name}" failed:`, err.message)
  }

  // No match — offer autocomplete candidates so the operator can fix it.
  try {
    const ac = await api(`/cards/autocomplete?q=${encodeURIComponent(name)}`)
    return { card: null, suggestions: (ac?.data ?? []).slice(0, 3) }
  } catch {
    return { card: null, suggestions: [] }
  }
}

export function resolveImagePath(identifier) {
  if (!identifier) return null
  const card = memCards.get(identifier)
  if (!card) return null
  return `/cards/${identifier}`
}
