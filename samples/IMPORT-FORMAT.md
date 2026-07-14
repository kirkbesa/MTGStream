# Roster import format

The spec for a registration site exporting its field to the broadcast tool.

**CSV or JSON — either works.** The format is detected from the file's contents,
not its extension. Pick whichever is easier to produce; there is no advantage to
one over the other.

Working examples sit next to this file — both import cleanly, so they're a good
thing to diff an export against:

- `registration-template.csv`
- `registration-template.json` — its three players deliberately use the three
  different decklist shapes, so you can see which one best fits your data.

---

## The fields

The same four fields in both formats. Only the player's name is required.

| Field       | Required | Contents                                   |
|-------------|----------|--------------------------------------------|
| Player      | **yes**  | Player's name. A row with no name is skipped. |
| Deck        | no       | Archetype — "Jund Wildfire", "Familiars".  |
| Decklist    | no       | Mainboard. One card per line.              |
| Sideboard   | no       | Sideboard. One card per line.              |
| Pronouns    | no       | Shown on the nameplate.                    |

**Leave placement out.** There is a `Place` field, but it's only for re-importing
an already-finished tournament. At a live event nobody has a placement yet, and
standings are edited in the panel as the event plays out.

---

## CSV

Standard CSV. **Header row required.** One row per player.

```csv
Player,Deck,Decklist,Sideboard
Plachy,Jund Wildfire,"4 Writhing Chrysalis
4 Kuldotha Rebirth
19 Mountain","2 Gorilla Shaman
3 Duress"
Favetta,White Weenie,"4 Thraben Charm
20 Plains","2 Dust to Dust"
```

The decklist is a normal multi-line cell: wrapped in double quotes, real
newlines inside. This is standard CSV — any serializer does it correctly, and no
special handling is needed. A literal double quote inside a cell is escaped by
doubling it (`""`), per spec.

### Column names

Matched loosely — case, spaces and punctuation are ignored, and each column
accepts several spellings:

| Column      | Also accepted                                      |
|-------------|----------------------------------------------------|
| `Player`    | `Player Name`, `Name`, `Full Name`, `Display Name` |
| `Deck`      | `Deck Name`, `Archetype`                           |
| `Decklist`  | `Mainboard`, `Maindeck`, `Main`                    |
| `Sideboard` | `Side`, `SB`                                       |
| `Pronouns`  | `Pronoun`                                          |

**Do not put the decklist in a column called `Deck`.** That's the archetype
column; a decklist there is read as a deck *name*. Use `Decklist`.

---

## JSON

An array of players — or an object wrapping one under `players`, `roster` or
`data`.

The decklist may be **a string** (exactly the text a CSV cell would hold):

```json
[
  {
    "name": "Plachy",
    "deck": "Jund Wildfire",
    "decklist": "4 Writhing Chrysalis\n19 Mountain",
    "sideboard": "2 Gorilla Shaman\n3 Duress"
  }
]
```

...**or a structured array**, which is usually the natural shape if the site
already stores decks as records:

```json
[
  {
    "name": "Favetta",
    "deck": "White Weenie",
    "mainboard": [
      { "count": 4, "name": "Thraben Charm" },
      { "count": 20, "name": "Plains" }
    ],
    "sideboard": [
      { "count": 2, "name": "Dust to Dust" }
    ]
  }
]
```

A plain array of strings (`["4 Thraben Charm", "20 Plains"]`) works too.

### Key names

Matched with the same loose rules as CSV columns, so `playerName`, `player_name`
and `Player Name` are all the player.

| Field     | Keys accepted                                          |
|-----------|--------------------------------------------------------|
| Player    | `name`, `player`, `playerName`, `fullName`, `displayName` |
| Deck      | `deck`, `deckName`, `archetype`                        |
| Decklist  | `decklist`, `mainboard`, `maindeck`, `main`, `cards`   |
| Sideboard | `sideboard`, `side`, `sb`                              |
| Pronouns  | `pronouns`, `pronoun`                                  |

In a structured decklist, each card's count may be `count`, `quantity`, `qty` or
`n`, and its name may be `name`, `card` or `cardName`.

---

## Card lines

Each line of a decklist is `<count> <name>`:

```
4 Lightning Bolt
19 Mountain
```

Also accepted, so an Arena or MTGO export can be passed through untouched:

- `4x Lightning Bolt` — the `x` is optional
- `4 Lightning Bolt (M10) 146` — set code and collector number are ignored
- `SB: 2 Pyroblast` — per-line sideboard prefix
- `// comment` and blank lines — ignored

### Sideboard

Either give it its own `Sideboard` field, **or** put it inside the decklist under
a `Sideboard` line:

```
4 Lightning Bolt
19 Mountain
Sideboard
2 Pyroblast
```

Both work. Don't do both at once.

### Card names

Names are resolved against [Scryfall](https://scryfall.com), which is forgiving
about punctuation, accents and casing. Two notes:

- **Split cards**: `Fire // Ice` (either half alone also resolves).
- **Double-faced cards**: the front face name is enough — `Delver of Secrets`.

Matching is fuzzy, which is what makes messy player-submitted lists importable —
but it also means a badly mangled line can resolve to the *wrong* card rather
than failing outright. **Export the decklist exactly as the player submitted it.**
A well-meaning cleanup pass (stripping punctuation, title-casing) is more likely
to turn a good name into a subtly wrong one than to help. Anything that can't be
resolved at all is reported with suggestions, not silently dropped.

---

## Encoding

**UTF-8.** Card names contain accents (`Jötun Grunt`, `Séance`) and so do player
names; Latin-1 will mangle them into names that can't be resolved. Either line
ending (LF or CRLF) is fine.