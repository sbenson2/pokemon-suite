# Offline move knowledge

FireRed's battle policy reads local, indexed facts and executable Gen III rules.
It makes no PokéAPI requests during a turn. The active cartridge mechanics table
provides power, accuracy, PP, priority, type, target, effect and interaction flags.
The bundled `move-catalog.js` indexes all 354 native moves and provides source
fingerprints and species weights. Rules live in `player/move-knowledge.js`.

The separate `pokeapi-move-reference.json` stores all 937 move rows and 198
historical move-change rows from the pinned upstream snapshot, along with move
metadata, stat changes, targets and effect changes. These are reference data.
The native FireRed rules take precedence; modern categories, status immunities
and changed move values must not silently enter a Gen III battle.

The Printing Press PokéAPI CLI is independent of the Suite. At this audit its
SQLite store had only 98 actual move resources, despite its sync summary
reporting 100 rows. Installing that CLI or its skill does not make its cache
complete, and the bot does not use it. The Suite's own compiled catalog is
packaged with the engine and works offline on other Macs.

```sh
node scripts/inspect-moves.mjs dream-eater
node scripts/inspect-moves.mjs 138
node scripts/inspect-moves.mjs --coverage
```

## Decision contract

Menu legality and effect applicability are separate checks. PP, Disable, Encore,
Taunt, Torment and Choice Band remain in battle legality. The shared move rules
then check observed target/user status, Substitute, first-turn state, stockpiles,
abilities, stat limits, side effects and move-specific prerequisites. Unknown
sleep or setup state cannot be treated as proof that a dependent move will work.
Checks are repeated as the move cursor advances, after a controller restart and
when the target changes.

Attack ranking, party matchup scoring, capture preparation, support selection,
incoming threat checks and automatic move learning use this shared layer. Dream
Eater requires a sleeping target without a Substitute. A Haunter with no sleep
setup does not treat Dream Eater as an unconditional 100-power upgrade. Existing
copies remain in the native save; ordinary future learning can replace them.

The observer reads native friendship, IVs, Stockpile, Fury Cutter, protection
counts, Substitute HP and side statuses. Context-sensitive damage includes
Return, Frustration, Flail, Eruption, Low Kick, Hidden Power, Stockpile attacks,
Facade and Weather Ball. Fixed/variable damage never falls through to ordinary
one-power calculations. Selection estimates and survival bounds have different
purposes: survival uses maximum rolls where modeled. Capture weakening retains
its stricter bounded-effect allowlist and critical-hit safety checks.

## Coverage and limits

Every native move has an explicit classification: damage, support, or a separate
plan requirement. Unknown effects cannot silently become generic attacks. The
coverage command lists totals and any unclassified move IDs.

This is not a complete battle simulator or proof of optimal play for every move
combination. Retaliation, copying, item exchange, redirection, delayed effects
and several other tactical effects need a dedicated plan. General attack/support
selection excludes those effects; incoming damage can remain unknown rather than
claiming a one-power bound. Learning policy also treats those dependencies
conservatively. Stochastic damage estimates, turn-order assumptions and secondary
effects remain estimates, not predictions of a guaranteed cartridge result.

The regression gate enumerates the native catalog and tests representative
positive/negative conditions, status immunities, generation differences, variable
power, learning prerequisites and observer offsets. A preserved real battle
reproduces Haunter repeatedly selecting Dream Eater against an awake Tentacool.
The replay requires another usable move, controller restart, battle completion,
unchanged native SRAM/party identities and a handoff to the retained badge goal.
Coverage of that failure is stronger than a catalog count; neither establishes
an error-free full campaign or full tactical implementation of all 354 moves.

## Rebuilding

`scripts/build-move-knowledge.py` accepts a local native battle dataset, a pinned
PokéAPI CSV directory with `source.json` fingerprints, and an output directory.
It validates the complete native move-ID range and every upstream input hash.
It performs no network calls. Run the full regression gate after source/data
changes and supply the exact report to engine packaging.

Sources: [PokéAPI schema](https://pokeapi.co/docs/v2#moves),
[pinned PokéAPI data](https://github.com/PokeAPI/pokeapi/tree/d4f9a4af58ade123fbc0558f68b1c69daa97d9e4/data/v2/csv),
[FireRed battle scripts](https://github.com/pret/pokefirered/blob/master/data/battle_scripts_1.s).
The existing PokéAPI license notice applies to the upstream contributions.
No game artwork, game prose, ROMs or saves are included in these catalogs.
