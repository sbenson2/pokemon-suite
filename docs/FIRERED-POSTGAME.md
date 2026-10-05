# FireRed postgame

The campaign ends at the verified Hall of Fame save and return to the field.
The adventure continues in a separate durable controller. Its receipt retains
the original run ID, team commitment and League save hash. Campaign benchmarks
are never extended or rewritten to include postgame work.

New runs default to **Continue postgame and National Dex**. **Wait for a
command**, Stop and manual control remain authoritative. An already completed
run waiting for a command needs the explicit Start Postgame Checklist action.
A crash between storing the postgame controller and updating the bot policy
repeats the handoff without resetting a partially completed transaction.
Start Postgame Checklist resumes the campaign's durable agenda: receipts,
record cycles and retry deferrals. It does this after a player task (such as a
Rare Candy supply) or after an app relaunch. It never adopts another
campaign's agenda.

## Checkpoint order

1. Verify the League save; register 60 species using native catches and
   ordinary evolutions; receive Oak's National Dex; acknowledge its native save.
2. Finish Bill's island introduction if necessary. Ask Celio about the Ruby,
   hear the Mt. Ember password, defeat both entrance Rockets, solve the Strength
   route, collect and deliver the Ruby, and receive the Rainbow Pass.
3. Collect Waterfall, use a compatible ordinary utility Pokémon, help Lorelei,
   open Dotted Hole with Cut, witness the Sapphire theft, give both Warehouse
   passwords, defeat the admins and Gideon, deliver the Sapphire, then save.
4. Work through available side quests, encounters, collection and battle goals.
   Failed routes have a persisted cooldown, allowing another available
   objective to run. Five active minutes without meaningful progress triggers
   a different objective. Temporary script variables and incidental battle
   counters do not count as quest progress.
   The same five-minute clock covers National Dex prerequisites and owned
   evolutions. A blocked withdrawal retains the exact Pokémon and task in a
   persisted retry queue while another local objective runs. Transactions that
   have changed an individual or started a native save keep ownership until
   their evidence is resolved. A timeout is never permission to discard them.
5. Stop automated input only after every required checkpoint and a final native
   save verify. The emulator remains visible. Unavailable external requirements
   remain incomplete; exhausting local work is not adventure completion.

This ordering is grounded in the original cartridge's
[Celio and Sevii scripts](https://github.com/pret/pokefirered/tree/c75f352304d529f6ba92d4f74b9cf8b5c3810788/data/maps),
with the island walkthrough used to cross-check optional destinations
([Four and Six Islands](https://bulbapedia.bulbagarden.net/wiki/Walkthrough:Pok%C3%A9mon_FireRed_and_LeafGreen/Part_18),
[Five and Seven Islands](https://bulbapedia.bulbagarden.net/wiki/Walkthrough:Pok%C3%A9mon_FireRed_and_LeafGreen/Part_19)).

## Objective coverage

| Group | Completion evidence | Execution |
| --- | --- | --- |
| National Dex, Ruby, Sapphire, Celio | Native flags, scene variables, inventory and saved SRAM | Prerequisite controller |
| Tanoby Key | Native unlock flag and observed boulder positions | Authored seven-boulder sequence |
| Selphy rescue | Native rescue flag | Lost Cave route and battle |
| Memorial Pillar | Native TM42 reward flag | Buy Lemonade if needed, then interact |
| Lorelei home visit, Three Island tunnel | Native event/reward flags | Cartridge event targets |
| Togepi | Gift flag, original Egg identity, native hatch, completed save | Friendship, party space, Egg withdrawal/walking and hatch acknowledgement |
| Lapras, Eevee, Dojo, fossils | Remaining native gift flags and saved capture | Existing gift and fossil missions; preserve shiny opportunities |
| Snorlax, birds, Mewtwo | Remaining encounter, protected individual and saved capture | Existing reset/RNG-timing missions; no memory writes |
| Roaming legendary | Starter-specific native species and released identity | Raikou, Entei or Suicune; never reroll an already released identity |
| Stronger Elite Four | Observed post-Celio Hall of Fame, native save and playable field | Supply preparation, recovery between rooms, five battles |
| Trainer Tower | Four independent native prize records | Single, Double, Knockout and Mixed floor/roof/lobby workflows |
| Game Corner prizes | New individual, exact coin debit, Dex entry and fresh native save | Native Coin Case, paid slots for the coin-cap remainder, legal purchases and all five FireRed prizes |
| Breeding | Original parent identities, native fees, hatched offspring, restored team and fresh save | Ordinary PC spares, egg-group/gender/incense rules, native daycare menus and walking |
| National Dex | Exact caught bitset, mapped to National IDs | Missing land/Safari targets, water preparation, ordinary local and partner evolutions, breeding |
| Unown | All 28 forms actually present in party/PC | Native chamber distribution and personality-derived form |
| Fame Checker | Six native bits for each of 16 people | Derived map-event catalog; observed bits, not interaction counts |
| Oak's completion response | Native flag | Visit after the original diploma requirement is met |
| Hall of Fame and Egg stickers | Native counters, claimed sticker level and a later native save | Repeat League runs or breeding, claim earned levels on Four Island, preserve the original rematch receipt and all individuals |
| League Exp. Share training | A planned trainee, then a new Hall of Fame entry and native save each round | League rounds with a passive Exp. Share trainee until it reaches its target; one faint in a won round is a strike, and a hold pauses it until the owner resumes it in Bot settings |
| Link Battle sticker | Native sticker level and actual link wins | Requires a compatible independently owned battle partner and a multiplayer executor |
| Wireless minigames | 200 jumps and 200 berries in native records | Requires compatible players and a multiplayer executor |
| Event Pokémon | Actual caught entries | Requires legitimate source/ticket and a qualified route or native trade |

Repeatable services do not have a universal “finished” state. Breeding, daycare,
move reminder/deleter, tutors, Game Corner, item farming, Selphy's repeatable
show-a-Pokémon rewards, training and link battles are task resources. One-use
tutors are not spent merely to tick a checklist. Collecting every hidden item,
buying every item, defeating every rematch forever and exhausting every tutor
are not silently asserted by the completion ledger.

The original game's diploma checks **380**, excluding Mew, Lugia, Ho-Oh,
Celebi, Jirachi and Deoxys. The user's collection goal remains **386**.
Kanto completion checks 150, excluding Mew. These are the exact rules in
[the pinned Pokédex implementation](https://github.com/pret/pokefirered/blob/c75f352304d529f6ba92d4f74b9cf8b5c3810788/src/pokedex.c),
not an assumption that all species occur in FireRed.

Maximum sticker records require 200 League entries, 300 Eggs and 100 actual
link wins. The wireless Trainer Card goal needs both 200-jump and 200-berry
records. These long-running and multiplayer goals stay explicit, rather than
being confused with first-clear postgame objectives. See the original
[game statistics and Trainer Card implementation](https://github.com/pret/pokefirered/blob/c75f352304d529f6ba92d4f74b9cf8b5c3810788/src/trainer_card.c).

The Hall record workflow retains each current run's baseline separately from
the first stronger League receipt. Egg records can breed an already owned
species using compatible ordinary PC spares; the default Dex breeder still
chooses missing species. Generic shopping cannot spend the daycare recovery
reserve. Full storage blocks another hatch without consuming route retries,
while an earned sticker can still be claimed. These workflows preserve every
individual and keep the existing reserve box; completing the full collection
and hundreds of hatches can therefore require additional storage or transfers.

Native qualification covers another five-battle League victory, another Egg
hatch, their first-tier sticker claims, later saves, cold Continue and next-cycle
selection. It does not assert that 200 League entries or 300 hatches have run.
Final-tier thresholds and claim/save ownership have behavioral regression tests.

The checklist step **Train a Pokémon with the League Exp. Share**
(`league-training`) comes right after the Hall of Fame sticker and before the
Egg sticker.
- It runs League rounds only while a real trainee exists: a level-up evolution
  for a missing National Dex species, a battle-team member below level 100, or
  the current trainee until it reaches its target. It never picks a new
  lowest-level party member just to have something to train.
- It waits for the first stronger League victory. It is not a progress
  chapter, so postgame completion does not depend on it. Earlier ready goals
  come first; the pending step names the one it waits for.
- Each round is a native cycle, like the Hall of Fame record: a baseline of the
  Hall of Fame count, save counter and SRAM hash, opened when the round starts
  and closed by a verified native save with a new Hall of Fame entry.
- A lent held item is returned first. A round never buys League supplies or
  starts without a composed trainee; the step stops for review instead and is
  deferred.
- It reuses the League supplies and funding, the intermission heals and saves,
  and the watchdogs. It adds no round cap and no money reserve.
- One fainted battler in a round that is still won is a strike, and training
  continues (owner decision, September 26). A hold (two or more fainted battlers
  in one round, faints in two of the last five rounds, trainee damage, a blocked
  intermission, a lost round and the other conditions in the training guide)
  keeps the trainee protected to the end of that round, then shows the step as
  paused and not runnable, with the reason and the way to resume: turn
  **League training** off in Bot settings and save, then turn it on and save
  again. The setting (`leagueExpShareTraining`) is on by default; with it off,
  the step is complete and no League round uses a trainee.
- Otherwise the step completes once no trainee remains, or when there is no
  Exp. Share or fewer than five sweep-level battlers.

See [Training and competitive preparation](TRAINING-AND-COMPETITIVE-PREPARATION.md)
for trainee choice, strikes, holds and resuming.

Trainer Tower retains its admitted balanced roster on every floor. Its own
lobby nurse restores the team between floor battles without leaving or resetting
the challenge. An obsolete outside-healer task is released only at an unowned
field boundary inside the active Tower. Defeats remain attached to the mode and
team that lost; other unattempted modes remain eligible.
After a retained native save finishes, an active challenge selects its next
objective from current evidence before issuing another field input. This keeps
pre-update pending objectives from restoring an obsolete roster or healer plan.

Fame evidence uses the cartridge's sixteen four-byte records. Empty map-arrival
labels do not stand in for the NPC interactions that award facts. Sources
behind a Cut tree borrow an identified Cut user through the existing PC
workflow, then restore the original six: the Celadon Gym sign, every Celadon Gym
object (Tamia, Lisa, Erika; the yard's only entrance is a Cut tree) and Brock's
Pewter Museum journal (the east annex behind Pewter's back door). The Water Labyrinth comment similarly requires the
player's original-OT Togepi or Togetic. Temporary party changes remain owned
until the original six are restored and a later native save is verified; even
the final fact cannot mark the workflow complete before that save. New facts,
restored parties, cold saves and controller handoffs are checked independently
in native replays. The remaining catalog sources have a bounded static audit;
the native checks do not assert that all 96 facts have been collected.

## Collection and identity

Each of the 386 species has a source/dependency record. The source graph uses
the selected ROM's FireRed encounter tables and the local evolution rules.
It does not borrow LeafGreen encounter slots. Missing entries can require
another starter, version, Hoenn game, breeding, time-of-day/Beauty evolution,
trade evolution, or event source. A source record is a plan, not a claim that
its whole route has been qualified end to end.

A National Dex hunt skips a wild table when navigation reaches none of its
encounter cells; reaching the map is not enough (a map the knowledge cannot
answer for stays eligible). Behind a scripted entrance the cells must be
reached from its authored landing; an entrance without one proves only the map.
Navigation uses the layout a native map script installs, such as the dug-out
Dunsparce Tunnel once the National Dex is enabled. An RNG trial uses Sweet
Scent only on an encounter cell of the hunted map. After 1800 frames without an
executable route it stops with "RNG setup has no executable route to an
encounter cell of <map>" instead of spending its whole menu budget. The shiny
collection retries that stop like the budget stop.

Ordinary National Dex catches accept non-shinies. Every incidental shiny is
protected. Automatic ordinary evolution excludes shinies, Eggs, Everstone
holders and protected request ancestors. Unown form requirements do not
override protection of an incidental shiny. Released roamers retain their
native personality; finding them on a different route cannot change shininess.

This is a **registered National Dex**, not a promise of a living collection of
386 simultaneous individuals. The 420 PC slots and six party slots are read
from the cartridge. Thirty spaces are reserved for unexpected shinies and
transfers. The bot never deletes, releases, exports or copies a Pokémon to
manufacture space. Full storage is an explicit dependency.
Storage forecasts follow the selected goal: ordinary National Dex registration,
shiny collection, or the current capture quantity. Registered ordinary species
are not incorrectly counted as 386 missing shinies.

### The FireRed goal and what one save does alone

"Catch every Pokémon" means every species FireRed itself can register: 189 of
the 386, derived from pret/pokefirered by `scripts/derive-firered-catchable.py`
(`engine/firered/src/suite/firered-catchable.json`, pinned by
`test/firered-catchable.test.js`). It covers the FireRed wild tables (not the
Altering Cave tables a Mystery Event selects), gifts, statics, fossils,
starters, roaming beasts, FireRed in-game trades, and every evolution and Egg
FireRed can make: level, friendship, stones and held items the cartridge
provides, and trade evolutions through a FireRed-to-FireRed trade. Day/night
evolution is compiled out of FireRed (`src/pokemon.c`), so Espeon and Umbreon
are outside the goal. The checklist entry reads "Catch every FireRed Pokémon
(X of 189)" and completes when every goal species is registered except planned
work:

- **Planned: another FireRed save.** The other starters, the other Mt. Moon
  fossil and the other roaming beasts. A save gets one of each.
- **Planned: a partner Pokémon.** Tyrogue, and through it Hitmonchan and
  Hitmontop, needs a Hitmon to breed; a save that no longer holds one borrows
  it from the FireRed partner.
- **Other games and events.** LeafGreen, Ruby, Sapphire, Emerald and event
  species are listed separately and never make the bot wait.

The Pokédex owned flags are National Dex numbers (`decodePokedex`); only party
and PC records carry internal species ids. They are never converted twice.

What the national collection now does alone, in order:

1. Evolve an owned plain individual, including a two-step line through an
   earlier level-up form (a PC Oddish to Gloom to Vileplume or Bellossom). A
   line is ranked by its whole cost (its levels plus the item step), so a
   shorter direct level-up comes first. League Exp. Share trainees stay as
   trained and are never a source.
2. Trade evolutions round-trip through the FireRed partner game when it is
   ready (preferred over Emerald). A held item the save lacks is collected
   first (the Memorial Pillar Metal Coat).

An item evolution starts only when its item is in the Bag or the planner has a
route to the item's own cell. An item ball on another island is measured from
its Seagallop landing with the same exact test: entering the map is not
reaching the ball. Ruin Valley's Sun Stone and Sevault Canyon's King's Rock sit
behind Strength boulders the navigator does not move, so Bellossom and
Politoed wait for that route (gate `gate-verification-124-01` stopped at Six
Island's harbor chasing the Sun Stone). A Dex evolution whose supply stops
verifying is retained for retry with its individual reserved; it never stops
the owner. A supply detour starts from the free field, after the last item's
level-up, move-learning and evolution prompts.
3. Breed a missing Egg. An incense the save lacks (the Lost Cave Lax Incense
   for Wynaut) is collected before either parent leaves the PC.
4. FireRed in-game trades (ZYNX Jynx, MARC Lickitung, ...) with a plain boxed
   spare. The trader's party picker offers the first Pokémon of the species, so
   a teammate of that species is stored first and restored afterwards.
5. Land and fishing catches. A fishing hunt uses the rod whose table slots hold
   the species (Old: slots 0-1, Good: 2-4, Super: 5-9) and collects a missing
   rod from its giver first. Fishing has no land RNG plan or Sweet Scent.
6. A plain spare that a trade or trade evolution still needs (a Super Rod
   Poliwhirl for ZYNX); a spare caught into the party is stored first.
7. Breed-to-evolve: a base form owned only as a shiny (this save's Eevee and
   Omanyte) is bred with a plain PC partner (Ditto) at the Four Island Day Care.
   The shiny is the protected parent: it leaves the PC only early in the
   128-step walking-friendship cycle, the Egg wait ends before its Day Care
   steps reach the next level that teaches a move (the cartridge adds one
   experience point per step on withdrawal, `src/daycare.c`), it returns to the
   PC before the Egg hatches, and the receipt proves its species, moves, item,
   effort values and friendship unchanged. Only the Day Care's own experience is
   added. The hatchling then evolves through step 1.

Item balls on another island are reached through the Seagallop leg. When
nothing is executable and nothing is only waiting out a retry, the entry says
"This save has finished what it can do alone: X of 189 catchable in FireRed",
with the planned and other-game counts, and stays idle without a retry. Any
collection change (a traded-in Pokémon, a new item or flag) makes it runnable at
once; a National Dex cooldown ends early for the same reason.

## Trade evolution and independent owners

The existing FireRed–Emerald workflow reserves both individuals, drives native
trade menus, observes evolution and item consumption, returns the original
individual, verifies both saves and waits for normal link closure. Time-based
Eeveelutions and Beauty evolution use the partner game's mechanics. This does
not create source Pokémon that the partner has not legally acquired.

The Mac host coordinates eligible automatic evolution requests without an open
viewer. Only an enabled, idle partner owner with the required native progress
can be reserved: the Emerald companion or a configured FireRed partner (below). Manual control, Stop, other tasks and updates take priority.
If no partner is available, FireRed retains the requested individual and retries
later while other available objectives continue. Automatic Dex sources are
ordinary PC spares; shinies are excluded. Existing held trade items are equipped
through native menus. Time and Beauty routes retain their original mechanics and
prerequisites.

The checklist step **Evolve teammates through partner trades** comes right after
keeping a Fly user.
- It sends permanent team members with a trade evolution (Machoke, Kadabra,
  Graveler, Haunter, or a held-item trade whose item is in the bag) on the same
  round trip, whether or not the evolved species is registered.
- The evolved species must stay in the member's permanent family. Without a
  campaign plan, the whole party is the team.
- Shinies and Everstone holders stay home.
- The member returns to its party slot as the same individual. FireRed resets a
  traded Pokémon's friendship to 70.
- Without a ready partner the step is deferred, and other work continues.

When the checklist has released a blocked, unprotected hunt (deferring its
objective), that hunt keeps its stop and review. A later pause, such as an
evolution exchange or a restart, resumes the checklist instead of waiting on the
released hunt.

The local RFU transport now supports distinct authenticated owner identities
for two instances of the same title. Identical game names no longer imply one
save owner. Same-title owners exchange native RFU bytes; neither a save nor a
fabricated trade receipt travels in this protocol.

**A second FireRed save can serve as an invisible trade-evolution partner.**
Emerald can trade only after FireRed has the National Dex and Celio's link; a
second FireRed trades as soon as both saves have the Pokédex.
- The partner is its own owner (for example `firered-partner`, title
  `firered`, role `partner`). It has its own directory, run lock, port, status
  and native link owner identity. Its saves keep the FireRed identity, so a
  banked save can be imported unchanged as its working copy.
- It is never assigned tasks. It starts headless and idle, is hidden from the
  game list, and serves only the round trips the coordinator prepares for it.
- It supports only trade evolutions. Time and Beauty routes still need Emerald.
  When both partners are ready, Emerald keeps its routes.
- It offers an ordinary placeholder from its own party: not shiny, legendary,
  mythical, an egg or an item holder; no HM and no trade evolution; #1–151.
- It trades from a Pokémon Center whose native save holds its live party and
  PC. Each round trip is net zero: after the return it must hold exactly its
  original party and PC individuals, or it stops for review.
- The two saves must have different trainer IDs; the pair authenticates two
  distinct link owners.
- The pair needs the Pokédex on both saves, and the National Dex on both when
  the source or evolved species is outside #1–151. The teammate step may run
  before Celio's link when the FireRed partner is ready. Emerald keeps its
  National Dex and Sevii link requirements.

`postgame-firered-partner` qualifies a real two-save round trip: the permanent
Machoke goes to the partner, evolves there and returns as the same Machamp.
Both native saves and link exits are verified, and the partner ends net zero.
Campaign scheduling of trade evolutions during the story is not yet enabled.

While two owners' adapters are natively linked, each reports its emulated
frames since the connection and the owner ahead holds its next frame (at most
5 s per stall), so one stalled owner cannot overflow the other's native receive
queue. The overflow stop is kept. If the link still fails before the exchange
starts, each FireRed owner cold-boots its unchanged native save, proves the
original party and trade count, and the source retries the leg (at most three
verified retries). A started exchange or an unproven save stays stopped for
review. The Emerald owner keeps the restart proof at owner restart.

## Verification boundary

Behavior tests cover prerequisite saves, restart/handoff, Tower menu shapes,
Togepi identity and hatch acknowledgement, native completion evidence,
ordinary collection/evolution, all three roamers, Unown chamber validity,
Fame Checker coverage, utility HM protection and authenticated same-title RFU.

The required native corpus retains every historical case and adds
`campaign-postgame-handoff`. It starts from a real completed campaign, adopts
its unchanged commitment, progresses into a native capture and save, rebuilds
the controller during a menu and yields safely afterward. This is evidence for
the handoff and ordinary prerequisite work. It is **not** a complete
National Dex, all-four-mode Tower clear, 300-Egg run, multiplayer record or
new physical-trade qualification. See the exact-source verification report
for actual totals and skips.

`postgame-evolution-route` retains the real Viridian Forest stall. A visited
Fly landing with a proven onward route is eligible even if no walking route
exists. The replay flies to Celadon, withdraws the original Weedle, rebuilds
the controller inside the PC, evolves it through native training, saves, and
verifies Kakuna's identity before yielding. A postgame update may also yield
at this guarded field boundary without waiting for the entire adventure.

The agenda keeps a Fly user in the party after roster changes. Tower balancing
or a collection swap can box the only flyer; the recorded flyer is then
withdrawn from the PC before further collection goals so long-distance travel
can fly rather than walk. A party that already knows Fly, or a save with no
recoverable flyer, never holds the agenda on this entry.

Dex evolutions train behind the strongest healthy escort when that is faster:
the trainee switches in for a share while the escort fights higher-level
tables, and it carries the owned Exp. Share (withdrawn from the PC if needed
and returned to the bag after the evolution). Limited Rare Candies go to
expensive levels right after a natural level-up; cheap levels keep training.

`postgame-worker-resume` launches an isolated real worker from that retained
task, starts it without an old hunt, shuts it down, restarts it, and verifies
that Stop still holds its frame. An absent hunt and absent interrupted recovery
are not treated as a matching recovery owner. This case covers the worker's
resume gate as well as the controller-level decision tests.

`postgame-evolution-save` adds an ordinary native save during the retained
training task, then requires a separate save after the evolved individual is
observed. The original preparation baseline still verifies consumed items;
it cannot certify a later evolution. A second emulator boots from SRAM alone
and verifies the evolved identity and Dex entry. Older active checkpoints
also obtain this fresh proof before emitting an evolution receipt.

Reproduce the factual HM/Fame catalogs from the pinned source checkout with:

```
python3 scripts/derive-postgame-facts.py /path/to/pokefirered
```

The generator includes event identities, reachable flag instructions and HM
compatibility facts. It includes no artwork or dialogue. Native event flags
remain the authority; a reachable conditional script is not proof it ran.

## Native acquisition regressions

The mandatory corpus includes Game Corner Porygon, a complete Cleffa breeding
cycle, retained recovery after an original party member was boxed, and an
automatic Kadabra evolution through two actual FireRed/Emerald workers and the
Mac host coordinator. The acquisition cases rebuild controllers during owned
menus and require a later native save, then boot SRAM alone to prove the
result. Breeding also restores both exact parents and the original party.
The paired case requires outbound and return receipts, evolution identity,
both games’ saved SRAM and normal native link closure. It preserves active
exchange checkpoints even for a save originally created in manual mode.

These checks qualify those workflows; they do not assert completion of every
species, event dependency, Trainer Tower mode, sticker or multiplayer record.

League and Tower entry use the established six-member battle roster, including
restoring members boxed by collection or evolution. League preparation derives
its level target from the cartridge's rematch Champion party with the campaign's
two-level margin. Tower opponents scale to the highest current party level, so
the other battle members train to that level before entry. An active challenge
keeps its battle ownership. XP between levels counts as preparation progress;
walking without progress still times out. The encounter guard permits ordinary
training battles while continuing to protect shinies and missing species.
League and Tower preparation disable new generic restocking trips through the
existing field-care option: League preparation owns its explicit medicine basket,
and Tower preparation retains its training budget. Necessary healing and an
already owned shopping transaction still finish normally.

Tower defeats are retained separately from the cartridge's temporary loss flag,
which the lobby clears after healing. An unchanged, prepared team cannot
immediately repeat its failed challenge. Party ordering and restored HP do not
count as a stronger team; changes to members, levels, moves, held items or stats
permit another attempt. This is a bounded failure path, not a victory receipt.
Retry contexts use the same persistent team changes and ignore party ordering.
Older saved contexts migrate without clearing attempts or cooldown deadlines.

The `postgame-combat-preparation` replay restores the actual utility party through
the native PC, earns battle XP, saves and verifies cold Continue. It reconstructs
the controller during PC use, training and saving, and preserves every original
individual. `postgame-tower-defeat` finishes a retained native Tower battle and
verifies that its defeat survives the healed lobby, cleared loss flag, controller
reconstruction and native save. Neither replay certifies all four Tower prizes
or the complete stronger League run.

Funding, training and recovery reachability also use the navigator's existing
Victory Road passage logic when a reset boulder gate disconnects the static map
graph. The `postgame-victory-road-funding` replay retains the real League deferral
in the final switch pocket, then requires earning money, leaving the cave and
saving that progress through cold Continue. An executable cave exit must not
be reported as an unavailable income route.

The five one-way League battle rooms retain challenge ownership above ordinary
field care and agenda selection. Intermissions use their owned item recovery and
native save, including a fresh save-success acknowledgement after controller
reconstruction. A retained outside care task waits until the challenge ends;
an exhausted intermission reports its specific supply or PP shortage without
deferring the room to an unreachable Pokémon Center. This does not waive the
entry preparation or promise victory with insufficient supplies.

Emerald’s cartridge-derived adapter inputs remain outside released source and
app bundles. Configure `games.emerald.adapterData` with the local input directory
containing `pokeemerald` and `pokeemerald-symbols`. The host forwards this path
to the selected worker for ordinary, manual and update-held launches. A missing
configured directory is reported before launching. Engine updates do not move
or replace these private inputs. The paired native replay uses the same explicit
per-game setting while running the sanitized release export.

## Objective selection and unavailable work

Native saves requested inside the Safari Zone retain their transaction while
the shared save policy selects Retire, confirms the exit and drains the entrance
dialogue. Saving then proceeds through the normal cartridge menu. An evolved
individual is not acknowledged until its post-evolution save is verified.
The `postgame-safari-save` replay retains the actual Vileplume menu stop at
60 caught species, restarts during retirement and the save success dialogue,
verifies the same Pokémon after a cold Continue, and requires leaving the
entrance, flying to Pallet, speaking to Oak and saving the National Dex upgrade.
Travel and dialogue are reconstructed; a second cold Continue verifies that
the upgrade is durable. If an indoor objective has no walking route but a
visited Fly landing reaches it, shared travel planning first proves a reachable
outdoor exit through the map graph. Local objectives, reachable walking routes,
locked dialogue, badge requirements and unvisited destinations keep their guards.
It neither rolls back the evolution nor changes ROM or Pokémon data.

National Dex targets in the Safari Zone are caught like shiny Safari targets.
The hunt protects the requested individual and saves its protected anchor. The
capture then uses only a first Safari Ball timing that two independent replays
from that exact source have caught. Admission needs a readable encounter in a
Safari battle, the hunt's own requested non-shiny target (species, form and
requested traits), no catch and no receipt. A shiny keeps its unchanged
admission; anything else still stops with the encounter preserved. Engines
before build 109 stopped every such target as "The protected encounter is
unreadable". A restarted owner resumes only that retained stop, like an
interrupted hunt: by itself with the bot on, otherwise from the Bot switch. It
must still be at the same Safari battle with the same identity and no native
save since the anchor. The capture re-verifies all of this before any input
(`postgame-safari-dex-capture`, `postgame-safari-dex-entry`).

The National Dex prerequisite first tries quick ordinary evolutions and common
reachable captures. If those are exhausted before 60 registrations, it considers
other native Kanto level evolutions, then rarer reachable encounters. This wider
search does not change the campaign’s optional Exp. Share grinding policy and
does not attempt National-Dex-only evolutions before Oak’s upgrade. Reserved
individuals, shinies, Eggs and Everstone holders remain excluded.

Available Kanto gifts, fossils, prizes and encounters can run before Celio’s
link quest; they must not be locked behind the prerequisite they help satisfy.
Island objectives and Mewtwo retain their link requirements. One-time gifts and
static encounters retain their shiny policy. An unavailable checklist entry is
deferred, and the same decision checks the next eligible entry with a bounded
number of attempts.

If no verified route exists, the controller retains a named dependency goal,
its observed count, reason and earliest retry deadline. It reports waiting while
the emulator remains visible, rechecks changed evidence and automatically retries
expired cooldowns. This is not counted as meaningful progress or completion.
Stop/manual ownership and unfinished capture, trade or save transactions remain
authoritative. Legitimate external sources and storage capacity cannot be
manufactured by the fallback.

National Dex and Celio prerequisites participate in the same persistent retry
queue as other postgame work. Five active minutes without meaningful progress
defers the prerequisite and checks eligible alternatives. The rejection survives
controller reconstruction and does not mark the quest complete. Owned milestone
saves retain priority, and returning from alternate work keeps the native save
boundary. A recovered National Dex upgrade permits Celio's distinct prerequisite
even if the older National Dex route is still cooling down.

Lorelei's route approaches the Waterfall field-move position from any lower or
external map, including a Pokémon Center after withdrawing or teaching its
carrier. Once above the waterfall it targets the cave's native scene triggers.
The required `postgame-icefall` replay preserves the actual Four Island Center
wait. It reconstructs the controller in Waterfall's party menu, above the falls,
in Lorelei's dialogue and in the Rocket battle. It requires native quest
completion, a verified save, return to Four Island and a safe handoff. A cold
Continue must retain the quest flag and every original party/PC individual.
All 47 earlier native cases remain required. This qualifies the retained route
and its return, not every later Celio checkpoint or an entire fresh postgame.

Unlocked scripted entrances must also be approachable from other maps. The
shared route planner can stage outside Rocket Warehouse or Dotted Hole only
after observing its permanent unlock flag. The Mt. Ember Ruby Path door opens
when `VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F` (0x4076) is at least 4. It is
staged only for a target that its 1F landing can reach, so a Ruby Path floor
behind Strength boulders (B3F and its stair loop) never sends the player to the
door to stall. The National Dex selector uses the same reachability, from the
player's position or the destination island's ferry landing. It records a
failed hunt per species and map, so one failed floor does not hide the
species' other floors. Altering Cave counts only the table that
`VAR_ALTERING_CAVE_WILD_SET` (0x4024) selects; 0, unset, or out of range means
table 1 (Zubat). Species that appear only in the event tables 2-9 are not
hunted there. A blocked hunt that the worker releases keeps its
failure context. After three identical failures, the objective waits for a
state change. On arrival, it still requires the
cartridge's live door and collision grid before entering; an unlock flag does
not manufacture a walkable doorway. Ordinary complete routes retain priority,
and an unreachable interior target cannot cause an exit/reentry cycle.
`postgame-sapphire` retains the Five Island Center return after healing. It
requires entry, Gideon's defeat, Sapphire recovery, Celio delivery and a native
save verified by cold Continue. Controller reconstruction covers the doorway,
battle, delivery dialogue and save; all original individuals remain owned.

Fly shortcuts currently contain Kanto destinations. They must not operate on
the three separate Sevii Fly maps, including special dungeons whose names omit
the island. Inter-region travel uses the native ferry. An already-open Sevii
Fly selector is canceled without replacing the owning mission. `island-fly-region`
retains the actual shiny Lapras hunt stuck on Five Island's Fly screen. It
requires cancellation, restart during field/ferry transitions, a native trip
to Vermilion and executable handoff to the same Lapras goal, preserving party
identities and SRAM. It does not claim to qualify the eventual shiny capture.
These two cases extend the mandatory corpus to 50; all previous cases remain.

The required `postgame-objective-selection` native replay preserves the actual
52-species Celadon idle checkpoint. It selects an ordinary boxed Pidgey, rebuilds
the controller during the PC transaction, verifies native evolution and a fresh
save by booting from SRAM, preserves every original individual and the campaign
record, then requires another executable objective before yielding.
# Post-League supplies and travel recovery

After the native League completion flag is verified, automatic postgame work
and traveling gift and static hunts provision through the real Indigo
Plateau clerk. The planner reads verified mart stock and spends available cash
above a ₽10,000 reserve, bounded by a hunt's remaining spending allowance and
bag capacity. It funds essentials before larger reserves: 20 Max Potions,
10 Full Restores, 15 Full Heals, 20 Revives, 20 Max Repels, and up to 99 Ultra
Balls and 30 Great Balls. These are budgeted targets, not guaranteed quantities.
Celio's one-time roamer generation preparation retains its established 30-ball
trip and menu ownership; the general postgame controller provisions before
dispatch, and roamer travel can still use owned medicine.
The postgame controller retains the logical basket while its input planner
resolves each native ferry leg. Island supply errands therefore share the
existing Seagallop routing and menu policy used by standalone hunts.
Ethers, Elixirs, Max Revives and Master Balls are not invented or purchased from
a clerk that does not stock them. Repels are stocked; this change does not add
automatic repel use.

Shopping resumes only below minimum reserves (five strong HP medicines, three
Revives, five all-status cures, 30 Ultra Balls or three Max Repels). The chosen
basket and committed spending survive restarts and purchase-result menus.
Using one medicine does not trigger another shopping trip. Normal Potions do
not count as strong postgame HP reserves.

During postgame travel, owned medicine treats fainting, status and HP at or
below 65%, using the existing PP-restoration policy for low moves. Minor HP/PP
wear no longer requires full restoration before every step. When medicine is
unavailable, a reachable healer handles significant damage or exhausted attack
PP. A status-only utility member does not cause an endless healer loop. Battle
and capture healing retain their existing survival-based decisions; League
intermissions retain full-team restoration and save requirements. Captures,
native saves and owned menu transactions keep priority.

The native `postgame-supplies` regression uses the actual expired Mewtwo attempt
on the same game, with a separately identified new controller attempt. It buys
medicine using real money, restarts at quantity/result menus, then returns to
Mewtwo travel without replacing SRAM. `postgame-field-medicine` retains the
actual damaged-Fearow audit state and its matching SRAM. Its request metadata
is reconstructed from the same hunt's earlier retained checkpoint; it starts
a new attempt explicitly. It verifies ordinary Max Potion use, restarts in the
party picker and result message, and resumes supplies with identities, moves,
experience and saved SRAM intact. These are isolated checkpoint qualifications,
not a new full campaign or a physical wireless trade test.

The historical objective-selection replay also qualifies the new supply
prerequisite. Because acquisition ranking depends on the player's location,
it returns from Indigo Plateau to its original Celadon boundary using ordinary
navigation, then reconstructs the retained controller there. Its original
Pidgey evolution, PC-menu restart, individual-preservation, native-save and cold
Continue assertions remain required. The native state is never edited or
rewound during that setup.
Safari retirement still requires the original evolution save and Oak's durable
National Dex upgrade, with native provisioning allowed between those milestones.
The island-Fly replay still requires canceling the incompatible menu, taking the
ferry to Kanto and retaining the Lapras goal through any subsequent supply trip.
Native party-reorder transitions require neutral resampling; stable observations
and cold saves must retain every original individual. The 53-case aggregate test
process has a 60-minute deadline to accommodate these additional journeys and
paired transfers; individual game watchdogs and hunt limits are unchanged.
# Seafoam current navigation

Seafoam B4F travel requires the B3F Strength puzzle. Before choosing the fall
warp, shared navigation clears the blocking stones and drops both required
boulders. It reads live object positions and cartridge flags 76, 77 and 723,
so controller restarts and partially completed puzzles retain the destination.
The cartridge itself stops the current when B4F loads; the bot does not write
flags, positions, encounter data, or ROM bytes.

The required `seafoam-current` native replay retains the actual Articuno
B3F/B4F loop. It must solve both drops, survive controller restoration before
a push and after the first drop, reach Articuno, save normally, and verify the
puzzle and all original Pokémon through a cold Continue. The legendary stays
available for the existing shiny workflow. This is navigation/save coverage,
not a claim that the replay performs a new physical wireless trade.

Navigation cycle detection treats incidental battle XP, levels, damage, PP use,
and new sightings as unrelated to travel progress. Native puzzle milestones,
owned captures, saves, and the active supply or recovery transaction still
count as progress. Battle/menu observations cannot themselves trigger a field
recovery, and the observation history survives controller restoration.

## Legendary generation timing

Articuno, Zapdos and Moltres run `setwildbattle` before their cry dialog;
Mewtwo runs it after the dialog confirmation. Static missions select the
corresponding input boundary. Calibrating the birds after their cry would
repeatedly restore an already-generated individual. Legacy bird attempts can
return to their verified pre-interaction save only after observing an unmatched
ordinary encounter. Protected shinies retain ownership. The timing revision
records prior calibration attempts and preserves the hunt's elapsed time,
encounter count and reset count; the corrected boundary has three calibration
attempts before the existing safety stop.

`static-legendary-timing` is the 55th required native replay. It retains the
actual failed Articuno timing checkpoint, resumes the same request, checks a
matched shiny prediction, pauses and reconstructs the worker during its timing
wait, then requires capture, native saving and a cold Continue. All original
individuals, IVs and the immutable campaign record must survive. This tests
ordinary emulator input and observation; it does not write RNG or Pokémon data.

Completion persists the player’s verified capture receipt after a timed catch,
replacing any earlier unsaved planning receipt before the owner stops or hands
off. The static replay requires both receipts to agree and verifies native SRAM.


## Roaming capture and Mt. Ember routing

Requested ordinary roamers use the same input-only, twice-verified first-ball
qualification as shiny roamers. The scope is the matching released identity in
a native roaming battle; ordinary wild encounters are not broadened into this
workflow. No ROM, encounter traits or captured trial state is injected.

An ordinary roamer that naturally flees can hand back to pursuit only when
outcome 6, the same still-active native roamer, unchanged SRAM, zero matching
owned individuals, and an uncaught protected receipt all agree. Unknown or
inactive identities, Roar outcomes, catches and shiny failures retain their
existing safety paths. Elapsed budgets remain intact. Pursuit encounters count
once per battle, including across controller restarts; historical unrecorded
encounters cannot be reconstructed beyond the preserved protected encounter.

Shadow Tag alone is not a complete Entei/Raikou strategy: it prevents ordinary
escape but does not prevent Roar. Original FireRed's Roar disappearance bug is
another reason not to replace capture qualification with unqualified trapping.
Mechanics reference: https://bulbapedia.bulbagarden.net/wiki/Roaming_Pok%C3%A9mon

Moltres uses an authored ascent through Mt. Ember's exterior and summit
Strength puzzles. Native object positions determine each push; observed
positions survive scan-range loss and controller restart and are rechecked
after map changes. The world graph continues treating boulders as obstacles.
Only the actual legendary interaction may create its encounter anchor.

### Unsupported navigation and partial acquisitions

A same-map Vs Seeker anchor can require a detour through a connecting gate.
Activation and recharge approaches retain the world-route fallback when local
navigation cannot reach the anchor. Navigation diagnostics distinguish an action,
arrival at an interaction location, a temporary game transition and an unsupported
destination. Arrival alone never completes a quest or acquisition.

Postgame unsupported-route and missing-advice decisions use the existing owner's
watchdog: two re-observations within a 30-second active-time budget, then an
alternative funding candidate, safe deferral or an explicit blocked result.
Transitions, battles and menus do not consume that navigation budget; broader
semantic supervision remains in place. Retry history survives controller restart.
Rejected income trainers cool down and stop retrying after three failures in the
same traversal context. Context-aware agenda failures similarly require relevant
game-state changes after three attempts, rather than relying indefinitely on time.

A dirty Game Corner acquisition can be suspended only in verified free overworld
with no unfinished purchase, prize receipt, slot round or final save. Its currency
and Pokémon identities are recorded, a native save is required, and only then may
the retained request be deferred and resumed later. It is not marked complete.
An unverifiable or timed-out save retains ownership and reports blocked. Protected
captures, evolutions and other owned transactions are never discarded to recover.
Existing saved acquisitions remain compatible; old dirty purchases with a settled
purchase and no prize baseline can use this verified suspension path.

Bot health exposes the current task/target, last semantic progress, wait reason,
remaining navigation budget and recovery attempts. Running processes no longer
mask postgame recovery or blocked status. Connection freshness remains a separate
host concern. The interface layout is unchanged.

Automatic postgame hunt start failures return to their clean agenda owner with persisted failure history, while protected transactions and explicit user requests remain retained. The `postgame-hunt-rejection` native regression restarts the actual rejected Snorlax handoff and verifies movement through the Route15 gate with the original suspended prize request. Suspended acquisitions are also persisted in the shared agenda so intervening hunts cannot discard their identity. This does not qualify the legacy Snorlax executor for arbitrary current-save handoffs.

See [BOT-RECOVERY-BOUNDARIES.md](BOT-RECOVERY-BOUNDARIES.md) for the research-to-code audit, recovery deadlines, task-specific progress and boundary test matrix. The required `postgame-boundary-recovery` native case covers the retained ordinary-battle timeout through verified suspension and resumed income.

# Rare Candy supply (question-mark Mail)

This is an opt-in bot setting, `qmmRareCandySupply`, and it is off by default. It is shown as
**Rare Candy supply** in Bot settings for FireRed. When enabled, three things
change:

- Rare Candy player tasks duplicate candies instead of collecting field
  candies.
- When an evolution task would fetch a Rare Candy (an expensive, fresh
  level), it requests a candy stock (30 by default) from the supply instead.
- Once the save holds a reserved mail slot and the supply is available,
  candies count as renewable. Evolution trainees then receive one every level
  (`renewableCandies`).
- If the setting is turned off, a supply that has not yet saved or handed out
  Mail is dropped; one that has still finishes its cleanup and native save.

The supply uses a cartridge glitch with ordinary button input. It never
writes memory, never loads snapshots and never patches the ROM. Code:
`engine/firered/src/suite/qmm-supply.js`.

**Mechanics** (pret/pokefirered c75f352):

- `GiveMailToMon` (src/mail_data.c) only searches the six party slots of
  `SaveBlock1.mail`. When none is free, it returns `0xFF` and changes nothing.
- `Cmd_tryrecycleitem` restores `gBattleStruct->usedHeldItems` for the
  attacker's battler position. It writes that item into the party Pokémon's
  held item (`REQUEST_HELDITEM_BATTLE`).
- Knock Off clears only the battle copy of the item and marks
  `gWishFutureKnock.knockedOffMons`.

A Mail holder that loses its Mail to an ally's Knock Off can then Recycle a
berry consumed at its position. Its party mail slot stays allocated with no
holder: the reserved slot. With that slot and five written Mails, all six party
slots are allocated.

Giving Retro Mail to a Pokémon holding item X then runs
`Task_HandleSwitchItems*YesNoInput`. That function returns X to the Bag, and
`GiveMailToMon` fails. The following Easy Chat screen is quit without edits,
so nothing is committed. Each iteration gives +1 X for ₽50 of Mail.

**One-time setup:**

1. **Cast:**
   - A Knock Off user: CH'DING Farfetch'd, traded for a Spearow of level 21–40.
   - A Recycle user: MIMIEN Mr. Mime, traded for an Abra, at level 33 or
     higher. Level-up training learns Recycle through `learnMoveIds`, and no
     level-up move replaces a `keepMoveIds` move (Reflect, Barrier).
   - A sleep move ally (Spore is preferred).
   - A Chesto Berry.
2. **Pre-battle native save.** Before it, the party is ordered as berry holder,
   sleeper, Recycle user holding written Mail, Knock Off user, then two
   finishers. The party is healed.
3. **Route 14 double battle against Twins Kiri & Jan** (L29 in every rematch
   tier). The rules below come from the state-driven turn plan, keyed on
   `usedHeldItems[0]`, the left battler's item and the knock-off mark:
   - Pairs with Follow Me are avoided, because in Gen III it redirects moves
     aimed at an ally.
   - Pairs with trapping moves or sleep moves are avoided too.
   - The planned turns: Spore the berry holder, switch in Mr. Mime and
     Farfetch'd, then Knock Off Mr. Mime. Mr. Mime uses Reflect, since it moves
     first, then Recycle. Finally switch in the finishers.
   - After the turn budget (10 by default) the plan gives up and simply wins.
   - Only the setup trainer's battle is choreographed.
4. **Success check** (from `playerMemory.mail`): exactly one allocated slot that
   no party member references, and the Recycle user holding the berry and
   still linking that slot. Success is saved natively.
   - A failed attempt is never saved. The owner returns `power-cycle`: the
     worker switches the console off and on, with SRAM untouched.
   - Before Continue, the retry waits 47 extra title-screen frames per failed
     attempt. FRLG seeds its RNG from the frame the title screen is left, and
     emulation is deterministic, so an identical press would replay the failed
     battle exactly.
   - After Continue, it verifies the pre-battle save counter and SRAM hash.
     A field that never passed the title screen (a checkpoint restored after
     the failed battle) is power-cycled again. At most three attempts are made.

**Duplication session:**

- **Box 3 slot 1.** `mail[0xFF]` aliases Box 3 slot 1. Before any Mail is
  handed out, an occupant of that slot is withdrawn and deposited elsewhere.
  Roster deposits during the supply avoid Box 3 (`avoidDepositBoxes`).
- **Seed holder.** When the reserved slot's former holder is still in the
  party, it holds the seed. Its failed Give then opens the reserved record
  itself instead of the alias.
- **Order of work:** buy all Retro Mail in one trip, write one word on each of
  the five holders, give the seed, then duplicate until the stock target is
  reached.
- **Per-iteration checks.** Each step must show exactly +1 item and −1 Mail
  with the seed still held; otherwise the supply stops. Five holders with a
  free slot would attach real Mail, so the session refuses to start unless all
  six slots are allocated.
- **Cleanup:**
  - Take every Mail back (Take > Send to PC: No > Yes).
  - Restore every held item that moved, and the original party and order.
  - Save natively.

  The reserved slot stays in the save, so later supplies need no battle.

**Guards:**

- The owner does not yield or hand off while a supply transaction is dirty,
  or while a party Pokémon holds Mail and the supply is active or enabled.
  With the setting off, a player's own Mail changes nothing.
- Deposits never pick a Mail holder (FireRed refuses to store one).
- Native trades are refused while party Mail exists: in the worker (new trade
  commands and resumed trades whose exchange has not started), and in
  `TradePreparation`.
- General held-item equip advice stays off (`identityEvolution`).
- Easy Chat is written only when it shows a free party mail slot. The "?" Mail
  (`mail[0xFF]`, the Box 3 slot 1 alias) and the reserved record are always
  quit unedited; a holder's Give that opens either stops the supply, and an
  unidentified record is never written.
- Recycle training owns its wild XP encounters (`fightTrainingNonTargets`) even
  when a Rare Candy request, not an evolution, started the supply. Shinies and
  capture targets stay protected.
- The seed candy comes from the planner's item preparation with Route 17's
  hidden candy excluded (`excludeLocationIds`): it lies on the Cycling Road
  slope, where the field controller cannot stop to press A.
- A supply that stops before holding anything records its reason. The request
  then falls back to field candies for 30 minutes.

**Observer additions:**

- `playerMemory.mail`: party mail slots, each member's mail link, reserved
  slots, and Box 3 slot 1.
- `ui.easyChat`: stage, input readiness, words address/index and the Box 3 slot 1
  alias.
- Party stages for the three prompts that were previously reported as
  `bag-transition`: `confirm-switch-item`, `confirm-send-mail-to-pc` and
  `confirm-lose-mail`.
- `battle.usedHeldItems` and `battle.knockedOffMons`.
- Berries are given through Key Items > Berry Pouch. There is no fifth Bag
  pocket; the earlier route pressed Right indefinitely.

Qualification: `postgame-qmm-prerequisites`, `postgame-qmm-setup-battle`,
`postgame-qmm-duplicate` and `postgame-qmm-renewable` (see
[Bot regression verification](BOT-REGRESSION-GATE.md)). They do not qualify
Mr. Mime's Recycle training or a setup battle against an already defeated
pair, which needs a VS Seeker rematch. The training was run natively once
outside the gate, from the prerequisites hand-off: 339k frames and 63 battles
from level 9 to Recycle at 33, keeping Barrier, then Retro Mail and `setup`.
