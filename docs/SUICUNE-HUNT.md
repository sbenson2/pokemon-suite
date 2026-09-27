# FireRed shiny Suicune hunt

The Suite uses a Charmander-started, League-complete profile. A Squirtle save releases Raikou and cannot supply this encounter. The existing RED collection and completed trades remain on their own saved profile.

The bot first obtains 60 owned Pokédex entries, unlocks the National Dex, and completes the Ruby/Sapphire prerequisites. Preparation hands control to the roaming mission after recovering the Sapphire and closing the current menus, before delivering it to Celio.

A native save anchors the remaining encounter. The final Celio dialogue is identified through the cartridge script context. Read-only RNG observations and ordinary controller timing calibrate the initial level-50 Suicune generation. Failed generation attempts restore only the unreleased anchor. Once the game generates a shiny, the bot saves that identity before pursuing it. Encountering the roamer again never rerolls its personality.

Pursuit reads the real roamer location and moves between Pallet Town and Route 1 to change its location naturally. It searches Route 1 grass only when Suicune is there. Roaming encounters receive first-ball capture qualification in an isolated emulator; the owning game replays verified inputs, performs the capture, saves, and verifies the identity. Incidental shinies remain protected without replacing the Suicune objective.

Current scope: one shiny Suicune, native level 50, any location, automatic ball selection. Competitive finishing, a required ball, multiple releases from one save, and Raikou/Entei are not advertised by this executor. No starter, quest flag, Pokémon, personality, or IV is written into game memory or the native save by the hunt.

Validation on September 12, 2026: a historical Charmander save cold-booted on the current native RFU core with its SRAM hash unchanged. The preparation test progressed from 51 to 53 owned entries through native gameplay. Regression tests cover wrong starters, already generated non-shinies, native save anchoring, preservation after incidental captures, preparation handoff/restart, read-only evidence, capture timing, and cartridge selection after worker restart. A full shiny release and capture has not yet completed in this test.

Cartridge references: [roamer generation and movement](https://github.com/pret/pokefirered/blob/master/src/roamer.c), [Celio’s Sapphire delivery](https://github.com/pret/pokefirered/blob/master/data/maps/OneIsland_PokemonCenter_1F/scripts.inc), and [native encounter checks](https://github.com/pret/pokefirered/blob/master/src/wild_encounter.c). The local runtime uses the project's pinned FireRed source revision.


## Save-verification repair, September 12, 2026

The live hunt reached 60 owned species and unlocked the National Dex. It then stopped because the postgame transition checkpoint and National Dex milestone both owned a save. The generic checkpoint saved first, then replayed the milestone’s stale unverified objective; further saves advanced the game counter from 10 to 13. The cartridge reported successful saves, while the milestone rejected its old baseline.

Milestone saves now own the complete transaction, including the success dialog. Generic checkpoints do not wrap explicit saves or stop requests, and a completed milestone hands off without another save. A resumed checkpoint with extra successful saves can establish one new baseline in an idle field, then must complete and verify a fresh native save. Error dialogs, unfinished saves, unchanged SRAM, and another displaced baseline still stop. No game memory or quest flags are edited.

An isolated replay of the exact failed checkpoint performed one native save, from counter 13 to 14, verified the changed SRAM, and advanced to the Vermilion harbor objective. Tests reproduce the double ownership, dialog evidence, handoff, restart recovery and failed-save refusal. The complete shiny release and catch still require live qualification.

## Shiny method checked against cartridge behavior

Suicune is the level-50 roamer in a Charmander-started game. Celio’s final Sapphire dialogue calls `InitRoamer`; `CreateInitialRoamerMon` generates and stores the personality once. Subsequent encounters reconstruct that same Pokémon, including retained HP and status. Resetting only a grass encounter does not create another shiny chance. The bot calibrates the Method 1 generation delay at the final message, waits using normal controller timing, then saves a confirmed shiny release before tracking it. It uses the actual trainer identity for the shiny calculation.

The original FRLG roaming IV bug also affects the captured stats. A shiny result is not a promise of perfect IVs, and this request specifies no competitive IV minimum. Catch planning verifies a successful throw before replaying it in the owning emulator, then verifies the captured identity and native save.

References: [generation and persistent roamer data](https://github.com/pret/pokefirered/blob/master/src/roamer.c), [Celio release script](https://github.com/pret/pokefirered/blob/master/data/maps/OneIsland_PokemonCenter_1F/scripts.inc), [native encounter and Repel checks](https://github.com/pret/pokefirered/blob/master/src/wild_encounter.c), and [Pokémon Automation’s FRLG RNG guide](https://github.com/PokemonAutomation/pokemonautomation.github.io/blob/main/docs/Programs/PokemonFRLG/RngManipulationGuide.md). The local pinned cartridge source is authoritative for execution; guides for other releases or arbitrary code execution are not imported as game behavior.
