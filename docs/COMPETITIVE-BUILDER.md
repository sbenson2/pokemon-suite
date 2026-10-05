# Competitive builder and legality checker

The builder helps prepare a FireRed Pokémon for competitive play using only
things a player can do in the game. It suggests sets, says which traits of an
owned Pokémon are fixed and which can still change, plans the in-game steps,
and checks whether an owned Pokémon is consistent with how the cartridge makes
Pokémon.

It never edits a save, a Pokémon record or game memory. Everything it shows is
read from the save's party and PC. Steps the bot can already run start through
the existing player-task and request endpoints; everything else is labeled as a
step to do in the game.

## Set guidance

Every species from 1 to 386 gets one to three sets (for example "Physical
sweeper" and "Special wall"). Each choice comes with its reason. The inputs are
the species' own data only:

- base stats, types and abilities;
- the FireRed/LeafGreen movepool: level-up, TM/HM, move tutor, Egg moves and
  pre-evolution moves;
- the Gen III type chart and each move's native power, accuracy and PP.

No community set data is bundled (see [DATA_SOURCES.md](../DATA_SOURCES.md)).

The rules:

- **Physical or special.** In Gen III a move's type decides this. For example,
  Shadow Ball is physical and Crunch is special. The set follows whichever of
  Attack or Sp. Atk, multiplied by its best same-type move, is stronger.
- **Role.**
  - Slow Pokémon (base Speed under 60) put EVs into HP instead of Speed.
  - A bulky species (HP plus its better defense at least 180) also gets a wall
    set. The wall set comes first when its bulk clearly outweighs its offense.
  - When both attacking stats are close and both have good moves, it also gets
    a mixed set.
- **Nature.**
  - Raise Speed for attackers with base Speed 80 or more; otherwise raise the
    attacking stat.
  - Lower the attacking stat the set does not use.
  - Walls raise their main defense.
- **EVs.** 252 / 252 / 4. At level 100 every 4 EVs add one stat point, so this
  spends all useful points of the 510.
- **Moves.**
  - The strongest same-type attack first, then moves that add the most type
    coverage.
  - Walls take recovery, a status move and a utility move.
  - Hidden Power counts as any type at 70 power. It is marked as needing
    particular IVs.
- **Item.** It prefers items FireRed can supply: Leftovers, Lum Berry, and the
  type-boosting items found in the game. An item FireRed has no source for,
  such as Choice Band, is marked as arriving by trade from Ruby, Sapphire or
  Emerald.

Moves learned only as Egg moves or by a pre-evolution are marked as needing a
new individual.

## Fixed and changeable

For an owned Pokémon the builder shows two groups.

**Fixed:**
- species line;
- nature, IVs and the Hidden Power type and power they give;
- ability slot, shininess and gender, all set by the PID;
- original trainer;
- met location, level, ball and game.

**Changeable in the game:**
- EVs: raised by battles and vitamins. FireRed cannot lower them.
- Level.
- Moves: level-up, TMs, tutors, the Move Reminder on Two Island (one Big
  Mushroom or two Tiny Mushrooms), and breeding for Egg moves.
- Held item.
- Evolution.
- Nickname: the Name Rater, for Pokémon whose original trainer is the save's.

Comparing a target set with the Pokémon gives an ordered plan.

**Steps the bot can start:**
- **EV training** (the `ev-training` player task) for Pokémon in the current
  save below level 100. It uses owned vitamins, Macho Brace and Pokérus. Battles
  also add experience, and it cancels evolution.
- **Item collection** (the `item` player task) for vitamins, TMs, evolution
  items and held items that FireRed supplies. It stops if no reachable source is
  known.

**Steps done by hand** (the bot has no task for a chosen Pokémon): teaching
TMs, tutors and the Move Reminder, leveling to a target, evolving, giving a held
item, and renaming.

When a fixed trait does not match the target, the plan offers a new individual
instead. Fixed traits here are nature, IVs, Hidden Power, ability or shininess;
EVs already above the target and Egg-only moves count the same way. The offer is
a Goal v1 request: a farming step with the nature, IV ranges, Hidden Power and
ability, followed by EV training. The builder previews it with
`/api/pokemon-farming/preview` and submits it through
`/api/pokemon-suite/requests/commit`, the same path as typed and spoken
requests. The hunt filters the game's own random outcomes; it never edits the
Pokémon.

## Legality checker

The checker reads each party and PC record and gives a verdict:

| Verdict | Meaning |
|---|---|
| **Legal** | Every check that ran passed. |
| **Suspicious** | Something the game can produce but that usually signals editing. |
| **Illegal** | Something the game cannot produce. |
| **Can’t tell** | A core check (encounter or PID method) could not run. |

The categories and severities (valid, fishy, invalid) follow PKHeX's legality
analysis ([CheckIdentifier](https://github.com/kwsch/PKHeX/blob/master/PKHeX.Core/Legality/Structures/CheckIdentifier.cs),
[Severity](https://github.com/kwsch/PKHeX/blob/master/PKHeX.Core/Legality/Structures/Severity.cs)).
PKHeX is a reference only. It is not bundled, linked or copied. The rules are
clean-room implementations of the cartridge code in
[pret/pokefirered](https://github.com/pret/pokefirered/tree/c75f352304d529f6ba92d4f74b9cf8b5c3810788).

| Category | What is checked |
|---|---|
| Encounter | The species or a pre-evolution appears at the met location and met level: FireRed wild tables slot by slot, gifts, static and event-island encounters, roamers (Routes 1–25, level 50), the in-game trades, and hatched Pokémon (met level 0, a breedable line). LeafGreen uses the PokéAPI tables mapped to the same sections. |
| PID | PID/IV correlation ([Smogon](https://www.smogon.com/ingame/rng/pid_iv_creation), PKHeX `MethodFinder`). Wild: Methods 1, 2, 3, 4. Unown: the high-half-first variants. Gifts and statics: Method 1. Roamers: Method 1 with only the HP IV and three bits of Attack kept. Eggs: no correlation expected. In-game trades: the fixed PID, IVs and trainer ID. |
| Encounter (RNG frame) | For wild catches it walks the RNG back from the PID through rejected PIDs to the nature, level and slot calls, and checks that they reproduce the slot and met level. One interrupting call is tolerated. If no frame matches it is Suspicious, as in PKHeX. |
| Ability | The ability slot equals the PID's lowest bit when the species had two abilities, else slot 1. |
| Nature, Shiny | Recomputed from the PID and trainer ID. |
| Level, Evolution | Level from experience (pret experience tables); level at least the met level; level-up evolutions at or above their level; Wurmple's branch from its PID. |
| EVs | At most 510 in total and 255 each. More than vitamins give (over 100 or not a multiple of 10) needs experience gained since the Pokémon was met. Six equal non-zero EVs are Suspicious (PKHeX `EffortValueVerifier`). |
| Ball | Hatched Pokémon, gifts and in-game trades use a Poké Ball; Safari Balls only in the Safari Zone. Dive and Premier Balls are noted as trade-only in FireRed. |
| CurrentMove | Moves are learnable by the species' line in FireRed, LeafGreen or Emerald at the current level. Egg moves only on hatched Pokémon. Cape Brink moves only on the three final starters. No duplicates or gaps. PP within the PP-Up maximum. |
| Trainer | Caught by the save's trainer or received in a trade; an in-game trade Pokémon never carries the save's trainer ID. |
| Fateful | The fateful-encounter flag is set exactly on the event-island legendaries. |
| Ribbon, Language, HeldItem, Misc | Contest ribbon ranks, the National Ribbon only on Colosseum/XD Pokémon, event-only ribbons as Suspicious, known language, an existing held item, and a consistent Pokérus strain and days. |

Gen III Eggs are a known disagreement. PKHeX marks a hatched Pokémon whose PID
and IVs happen to correlate like a wild one as Invalid
([discussion #3895](https://github.com/kwsch/PKHeX/discussions/3895)). The game
can produce this, so the checker reports it as Suspicious.

### What it cannot check

- Nicknames, original-trainer names and trainer gender. These text fields are
  not decoded.
- Event distributions (met location 255) and Colosseum/XD Pokémon: Can’t tell.
- Ruby, Sapphire and Emerald encounter locations. Emerald is matched by species
  and level only; Ruby and Sapphire are not matched. In-game trades from those
  games are not checked either.
- Whether a once-per-save move tutor was used more than once across Pokémon,
  and the exact level each move was learned at. A level-up move passes when any
  stage of the line learns it at or below the current level.
- Records read by an engine older than the builder update have no met location,
  origin game, ball, fateful flag or ribbons. For those, the encounter is matched
  by species and met level, and the result says so.

A Legal verdict means the record is consistent with these checks. It is not a
guarantee that a tournament will accept the Pokémon. Tournament rules decide
that separately.

## Host API

| Method | Path | Result |
|---|---|---|
| GET | `/api/pokemon-suite/builder/guidance?species=N` | Sets with reasons and a ready `target` each, the movepool, held items, natures and type matchups. |
| GET | `/api/pokemon-suite/builder/individual?game=firered&source=S&pokemon=ID` | Fixed and changeable traits and the legality result for one inventory Pokémon. |
| GET | `/api/pokemon-suite/builder/legality?game=firered&source=S[&pokemon=ID]` | One result, or every Pokémon in the save with counts. |
| POST | `/api/pokemon-suite/builder/plan` `{game, sourceId, pokemonId, target}` | The comparison, the ordered steps, and a new-individual goal when needed. |
| POST | `/api/pokemon-suite/builder/request` `{target}` | A validated target and its new-individual goal, without an owned Pokémon. |

All five are read-only and allowed through the companion relay.

## Data

`pokemon_suite/static/data/pokedex/firered-builder.json` holds the compact facts
the checker and guidance use. `scripts/build-builder-facts.py` derives them from
the pinned FireRed knowledge pack, the Town Map section order and the bundled
Pokédex projections. The facts are:

- met-location numbers;
- the wild tables slot by slot;
- gifts, statics and event encounters;
- growth rates;
- items and Poké Balls FireRed supplies;
- native move data and the Gen III type chart;
- LeafGreen and Emerald encounter summaries.

The in-game trade values and the Tanoby Unown letter table are copied as numbers
from pret source. Rebuild the file with:

```
python3 scripts/build-builder-facts.py --resources <GameResources/firered>
```
