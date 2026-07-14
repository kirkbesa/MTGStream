# MTGStream

A local broadcast production tool for Magic: The Gathering tournaments.
Card data and images come live from **[Scryfall](https://scryfall.com)** and are
cached to disk, so no card assets ship with this app.

Currently scoped to **Pauper** — every card search is filtered to format-legal
cards. See *Changing format* below.

---

## Requirements

**Node.js 18 or higher** — download from https://nodejs.org (choose the LTS version).
An internet connection is needed the first time a card is looked up; after that
it's served from the local cache.

---

## Setup (one-time per machine)

1. Make sure Node.js is installed.
2. **Mac**: right-click `start.command` → Open (first time only)
   **Windows**: double-click `start.bat`

On first launch the script installs dependencies (~30 seconds).

---

## Running

- **Mac**: double-click `start.command`
- **Windows**: double-click `start.bat`

The control panel opens at **http://localhost:3001**

OBS Browser Sources (all at 1920×1080, transparent background):

| Overlay            | URL                                         |
|--------------------|---------------------------------------------|
| Nameplate          | http://localhost:3001/overlays/nameplate    |
| Card Viewer        | http://localhost:3001/overlays/cardviewer   |
| Decklist (Sidebar) | http://localhost:3001/overlays/decklist     |
| Deck Reveal        | http://localhost:3001/overlays/deckreveal   |
| Standings          | http://localhost:3001/overlays/standings    |
| Timer              | http://localhost:3001/overlays/timer        |
| Broadcaster        | http://localhost:3001/overlays/broadcaster  |
| Bracket            | http://localhost:3001/overlays/bracket      |

Share these over the venue LAN (the control panel header shows the right IP):

| Page             | Who for                        |
|------------------|--------------------------------|
| `/commentator`   | Casters — decklists, card zoom |
| `/table`         | Players & judge — life totals  |

---

## Decklists

Paste a decklist into the control panel (Match tab → player → **Import**).
Arena, MTGO and plain text all work:

```
Deck
4 Lightning Bolt (M10) 146      ← Arena set/collector suffix is ignored
4 Chain Lightning
19 Mountain

Sideboard
2 Pyroblast
```

Sideboards are detected from a `Sideboard` header, an `SB:` line prefix, or —
failing both — the first blank line.

Every line is resolved against Scryfall and **shown for review before it goes
live**. Scryfall's fuzzy matching is forgiving, which is what makes messy
player-submitted lists importable, but it also means a bad line can resolve to
the *wrong* card rather than failing outright. Check the resolved names.

Cards that don't resolve are listed with suggestions rather than silently dropped.

---

## Importing a whole tournament (Roster)

Don't paste 64 decklists one at a time. **Roster tab → drop in the file your
registration site exported.** CSV, JSON and plain text all work — the format is
detected from the contents, not the file extension.

Before anything is imported you get a preview showing what was detected ("CSV ·
64 players") and every player it found, so a malformed export is caught
immediately rather than halfway through a long import.

### CSV (what most registration platforms export)

One row per player. The decklist lives in a quoted cell — CSV allows newlines
inside quotes, which is exactly what a decklist needs:

```csv
Player Name,Archetype,Placement,Decklist,Sideboard
Plachy,Jund Wildfire,1,"4 Writhing Chrysalis
2 Nyxborn Hydra
19 Mountain","2 Gorilla Shaman
3 Duress"
```

Column names are matched loosely, because no two platforms agree on them:

| Field    | Accepted column names                                  |
|----------|--------------------------------------------------------|
| Player   | `Player`, `Player Name`, `Name`, `Display Name`         |
| Deck     | `Deck`, `Deck Name`, `Archetype`                        |
| Place    | `Place`, `Placement`, `Rank`, `Standing`, `Finish`      |
| Decklist | `Decklist`, `Mainboard`, `Maindeck`, `Main`             |
| Sideboard| `Sideboard`, `Side`, `SB`                               |
| Optional | `Handle`, `Pronouns`                                    |

A single combined `Decklist` column works too — just include a `Sideboard` line
inside it.

### JSON

An array of players (or `{ "players": [...] }`). Decklists may be a string or a
structured array:

```json
[
  { "name": "Plachy", "deck": "Jund Wildfire", "place": 1,
    "mainboard": [{ "count": 4, "name": "Writhing Chrysalis" }],
    "sideboard": [{ "count": 2, "name": "Gorilla Shaman" }] },

  { "name": "Favetta", "archetype": "White Weenie",
    "decklist": "4 Thraben Charm\n20 Plains\nSideboard\n2 Dust to Dust" }
]
```

### Text

Hand-written, or pasted into the box instead of uploading a file:

```
Player: Plachy
Deck: Jund Wildfire
Place: 1
4 Writhing Chrysalis
Sideboard
2 Gorilla Shaman
```

A `1. Jund Wildfire — Plachy` one-liner also works as a header.

### Placements

**`Place` is optional.** At a live event you don't know placements at import time
— leave the column out and edit standings in the panel as the event plays out.
Include it only when re-creating a *finished* tournament; then **Seed standings**
fills the standings table from it.

### Seating players

The roster is a pool — you can't fit 64 players into two seats. Pick the match
slot you're prepping on the Match tab, then in the Roster tab hit **→ P1** /
**→ P2** next to any player to seat them, decklist and all.

Import **before you go live**: every card is fetched from Scryfall once and
cached, and a warm cache is what keeps the overlays working if the venue Wi-Fi
drops.

---

## Running the bracket

**Bracket tab.** With a roster imported and placements present, **Seed Top 8 from
roster** fills the quarterfinals using standard seeding (1v8, 4v5, 3v6, 2v7) so
the top two seeds can only meet in the final.

Each slot autocompletes against the roster. A slot matched to a roster player
shows a **◆** — that means their decklist is attached and will come with them.

Per pairing you get:

- **− / +** on each side to adjust the game score as the match plays out
- **✓** to declare a winner, which **advances them into the next round automatically**
- **Cast to Feature Match** — seats both players into the feature match slot with
  their decklists and current game score, ready to go on air

The champion's name and archetype are written to `OBS/champion.txt` and
`OBS/champion-deck.txt` for OBS text sources.

---

## If something goes wrong: the manual path

Nothing requires an import. The whole app works with no roster at all:

- **Match tab** — type player names, handles, pronouns, records and archetypes
  directly, and paste a single decklist per player.
- **Bracket tab** — type any name into a slot. A name that isn't in the roster is
  accepted as-is; it just carries no decklist (everything else still works).
- **Standings tab** — always hand-editable.

So if a registration export never arrives, or a walk-in replaces a no-show, you
can run the entire broadcast by hand.

---

## Counters

- **Life** is always shown (starts at 20).
- **Poison** and **energy** appear on the overlays *only when non-zero*, so a
  normal match shows a clean life-only nameplate.
- **New Game** resets life/poison/energy and the play/draw marker, but keeps
  names, decklists, records and the game score.

Life can be adjusted from the control panel *or* the `/table` page on a tablet
at the match table.

---

## Changing format

Format legality is set in `server/scryfall.js`:

```js
let FORMAT = 'pauper'
```

Any Scryfall format works — `standard`, `modern`, `pioneer`, `legacy`, `vintage`,
`commander`. Card search is scoped with `f:<format>`, so only legal cards appear.

Note that the app assumes a **2-player, 20-life** match throughout. Commander
(4 players, 40 life) would need structural changes.

---

## Card cache

Card JSON and images are cached in `.cache/` on first lookup. Once a card has
been seen it never needs the network again — so importing decklists *before* the
event warms the cache and makes the broadcast resilient to venue Wi-Fi dropping.

Deleting `.cache/` is always safe; it just re-downloads.

---

## Folder structure

```
mtgstream-release/
├── .cache/         ← Scryfall card + image cache (auto-created)
├── events/         ← Saved event files, .json (auto-created)
├── autosave/       ← Auto-saves: 5 min rolling + 30 min timestamped
├── samples/        ← Example roster imports you can try against the Roster tab
├── server/         ← Server code
│   ├── scryfall.js   Scryfall client, rate limiting, disk cache
│   ├── decklist.js   Arena/MTGO decklist parsing
│   ├── state.js      Broadcast state + event persistence
│   └── index.js      HTTP + WebSocket
├── overlays/       ← OBS overlay pages
├── control/        ← Control panel source (React)
├── dist/control/   ← Built control panel — run `npm run build` after editing
├── start.command   ← Mac launcher
└── start.bat       ← Windows launcher
```

### Editing the control panel

The control panel is a React app. After changing anything in `control/`:

```
npm run build
```

Or for live-reloading development (panel on :5173, server still on :3001):

```
npm start      # terminal 1
npm run dev    # terminal 2
```

Overlays are plain HTML and need no build — the server pushes a reload to OBS
automatically when you save one.

---

## First event checklist

- [ ] Node.js installed
- [ ] Add all OBS browser sources at 1920×1080
- [ ] **Import both players' decklists ahead of time** (warms the card cache)
- [ ] Open `/table` on a tablet at the match table
- [ ] Save an event file before the event starts

---

## Stopping the server

Press **Ctrl+C** in the terminal window, or close it.
