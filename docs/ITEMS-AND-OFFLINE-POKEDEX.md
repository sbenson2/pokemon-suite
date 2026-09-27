# Held items and offline Pokémon reference

FireRed battle decisions share the native type chart, current battler types,
observed abilities and held items. Party forecasts resolve the saved ability
slot; observed abilities take precedence after Trace or Skill Swap. Move
ranking, incoming damage and capture weakening use the same rules. A critical
capture bound includes offensive held items and ignores defensive screens.
Unknown custom Enigma Berry effects prevent a claimed safe weakening hit.

The compiled item catalog contains all 375 native table entries, including
reserved slots, and all 66 nonzero held effects. It records effect, parameter,
species restrictions and activation conditions. Stat boosts, accuracy items,
weather, badge boosts, screens, field sports and relevant abilities participate
in forecasts. Speed and Quick Claw inform turn-order prerequisites; Quick Claw
is probabilistic. Focus Band is never treated as guaranteed survival. Healing,
status/PP restoration and pinch triggers are queryable without assuming a berry
will remain available next turn. This is a decision model, not a complete
multi-turn simulation of every possible move/item combination.

Equipment preparation uses owned items through native Bag and Berry Pouch
menus. FireRed opens the Berry Pouch from Key Items; it is not another Bag tab.
Consumable preparation runs for training, major battles or idle maintenance,
without interrupting supply or other active errands.
It preserves existing held items, observes species restrictions, avoids
disliked/unknown flavor berries and assigns offensive stat berries to Pokémon
with corresponding attacks. White Herb requires a supported self-debuff move.
It does not grant items or change party, ROM, SRAM or battle memory directly.

## Offline database

`pokemon_suite/static/data/pokedex/master.sqlite3` contains 99 factual tables
from [PokéAPI](https://github.com/PokeAPI/pokeapi/tree/d4f9a4af58ade123fbc0558f68b1c69daa97d9e4/data/v2/csv):
1,025 species, 1,351 Pokémon/form records and 638,321 learnset records. It includes
stats and historical changes, types and historical effectiveness, abilities,
items, natures, evolution requirements, encounters, locations and game versions.
The source commit and every imported CSV checksum are stored inside the database.
It contains no sprite, ROM, flavor-text or prose tables. Coverage describes this
pinned snapshot; it is not a promise that future game data is complete.

`Pokedex` opens SQLite read-only, with bound query parameters and indexed search.
`DataSnapshot.resource_path` pins its checksum just like existing JSON facts.
The authenticated `/api/pokemon-suite/pokedex` route exposes queries; `game`
selects historical rules and version data. Without a game/generation, queries
default to generation nine. Records being present does not prove that they can
be obtained in a particular save or that an engine can automate that game.

Examples, run from the Suite source directory:

```sh
python3 -m pokemon_suite.pokedex_database pokemon pikachu --game firered
python3 -m pokemon_suite.pokedex_database item light-ball
python3 -m pokemon_suite.pokedex_database type ghost --defenders steel --game firered
python3 -m pokemon_suite.pokedex_database evolutions umbreon
```

`scripts/build-pokedex.py` validates source hashes, required relationships, row
coverage and SQLite integrity. `scripts/sync-pokedex-profiles.py` compiles the four
existing UI/farming projections from that reference, preserving encounter and
acquisition routes. All 354 main-series Gen III moves are included, along with
native held-effect mappings. Deoxys uses its cartridge-specific form. Existing
saved requests retain their pinned projections. Native move/item catalogs,
derived from the qualified [FireRed source](https://github.com/pret/pokefirered/tree/c75f352304d529f6ba92d4f74b9cf8b5c3810788),
remain the authority for the active bot; general modern metadata cannot override
Gen III mechanics.

The added native regression compares every item effect and parameter against
the approved ROM, checks 5,202 type combinations with and without Foresight,
reads a real boxed Onix with its Hard Stone and completes PC exit. It also equips
owned berries through the native pouch, restarts in the context menu and returns
to the field, checking every held item against the matching Bag decrement while
preserving all other party attributes and saved hunt requirements.
It does not claim an item-bearing native combat replay. The full
existing native campaign corpus also remains mandatory. Unit and replay passes
are distinct from completing a new autonomous campaign or a physical trade.
