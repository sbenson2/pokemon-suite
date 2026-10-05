# Bot regression verification

The opt-in Rare Candy supply (question-mark Mail, see
[FireRed postgame](FIRERED-POSTGAME.md#rare-candy-supply-question-mark-mail)) adds four cases.
Each runs the real postgame owner from a copied live save with ordinary input only:

- `postgame-qmm-prerequisites`: from the Sept 22 live save, resolve the missing
  cast through the cartridge (Kindle Road Spearow, both in-game trades, the
  boxed Abra) and hand the traded Mr. Mime to Recycle training. Deposits avoid
  Box 3, so its first slot keeps its occupant. Training itself (level 9 to 33)
  is not a gate case: the field trainer re-plans its VS Seeker rematch batches
  on every decision, about 240 ms each on Route 11, so the 339k-frame training
  takes about 33 minutes to replay.
- `postgame-qmm-setup-battle`: make the pre-battle native save, fight the Route
  14 double battle, fail the first attempt on purpose (turn budget 1), power
  cycle to that save, wait extra title-screen frames so the retry gets a new
  RNG seed, verify the Continue, reserve the mail slot on the second attempt,
  save, and cold-continue with clean storage.
- `postgame-qmm-duplicate`: from the post-battle save, duplicate 13 Rare
  Candies through the orphan's former holder (not the Box 3 slot 1 alias).
  Reconstruct the owner mid-session, take all Mail back, restore the party, save
  and cold-continue: no Bad Egg, Box 3 slot 1 empty, the reserved slot kept.
- `postgame-qmm-renewable`: from a restored party with no link to the reserved
  slot, buy Retro Mail and duplicate through the Box 3 slot 1 alias. Box 3 slot 1
  must stay empty and unchanged on every iteration.

`postgame-checklist-agenda` starts the real session worker from the live
checkpoint saved after the first supply. That checkpoint holds the finished
task's disabled agenda and the Mail-supply ledger. The case then chooses the
postgame checklist.
- The checklist must resume this campaign's durable `postgame-agenda.json`:
  the League rematch receipt, Hall of Fame and Egg sticker records, Togepi and
  Trainer Tower workflows, and dex retry deferrals. It keeps the ledger in the
  owner's checkpoint, and the finished League rematch is not repeated.
- A durable agenda from another campaign is never resumed.
- Before this fix, the checklist saved an empty agenda over the durable one,
  both after a player task and after an app relaunch.

Goal requests (G1) add two required cases. Both start the real session worker
from the September 17 live save in the Saffron Dojo, taken right after the
Hitmonlee gift. On that save the League, the National Dex and Celio's link are
done, and all four static legendaries are unused. Its durable agenda has already
reserved the fossil revival.

- `postgame-priority-static-target`: from a ready owner, `postgame-goal`
  carries a priority target: a shiny Mewtwo under the request's own ID.
  - The agenda must select Mewtwo ahead of every checklist entry. No other hunt
    may be handed off or started first; before the fix, the reserved fossil
    revival started.
  - The shiny static hunt then starts on the current save under the request
    ID. The hunt keeps the save label.
  - It travels to Cerulean Cave B1F, saves its pre-encounter anchor and reaches
    the first encounter reset. The encounter stays unused.
  - The durable agenda keeps the unfinished target and the untouched fossil
    reservation.
- `manual-new-save-bot-start`: Bot settings → New save backs up the current
  save under its own label. Start bot must then stop at New Game without
  writing a save; before the fix it tried Continue and failed with "no verified
  Continue save". Restoring the backup and starting the bot must Continue on
  the original map again.

Goal requests (G2, the goal supervisor) add two required cases. Both run the
real session worker and the real host goal supervisor
(`scripts/goal-supervisor-replay.py`: `SuiteSessions` over the owner's status
port, the single request database and `GoalSupervisor.tick`) in an isolated
runtime. The supervisor only uses the Suite's controls.

- `goal-new-game-trainer-name`: the owner makes a blank New save (no in-game
  save; the owner reports `newProfile`). A goal "new game as Nova with
  Squirtle, get me a shiny Mewtwo" arrives with save mode current-if-able.
  - The supervisor must choose a new save because no save exists, and start it
    through the reviewed campaign flow: preview with `trainerName` and the
    starter, then `start-campaign`, which backs up the current profile. Both
    earlier saves stay backed up; the original save is byte-identical.
  - The New Game keyboard must type "Nova" exactly, in its case, instead of a
    preset; the rival keeps its seeded preset. The replay ends in the player's
    bedroom after the intro and reads the name from the campaign's save state.
    Before the fix the engine refused the `trainerName` setting.
- `goal-supervisor-postgame-handoff`: the handoff leg from the verified
  completed-campaign save (Hall of Fame entered and saved). The supervisor
  restarts with the goal's persisted state: it had started this campaign and
  queued a shiny Zapdos hunt after it.
  - The owner continues into the postgame by itself. The supervisor must mark
    the campaign step done, pin the goal to this save, save the hunt in the
    request database and hand it to the running postgame as its priority
    target (`postgame-goal` with `priorityTarget`, sent once).
  - From that moment no other hunt may be handed off or started. The owner's
    care plans its supply basket at the League clerk and catches National Dex
    species on the way. Until G2b it stopped for review after the first catch
    ("The retained supply basket exceeds the remaining spending limit or cash
    reserve.", see `postgame-supply-replan`); that stop now fails the case. The
    owner must re-derive the basket with nothing bought and keep travelling
    past Route 22 with the goal's target (the goal stays running,
    `postgame-priority`, target sent once), or start the static Zapdos hunt
    under the request's ID (the goal reports the hunt), or stop for another
    reason, which the goal must report (waiting, attention, the owner's
    reason) and never override. At least 10,000 money is kept. On this save the
    trip later spends every capture ball on National Dex captures in Victory
    Road and meets the designed empty-ball capture stop, so the case ends once
    the owner is past Route 22 with the re-derived basket.
  - The durable agenda keeps the target and continues the goal's campaign, and
    on the saved state the engine's agenda selection returns the priority
    target before every checklist entry.

The completed-campaign supply basket (G2b) adds one required case. It runs the
real session worker with no goal and no supervisor.

- `postgame-supply-replan`: the automatic postgame after the Hall of Fame on the
  verified completed-campaign save (30,548 money, 7 Ultra Balls). Care plans its
  basket at the League clerk priced to the cash reserve (17 Ultra Balls, 20,400
  of 20,548), then catches National Dex species on the way with those balls.
  - Before the fix the retained basket's absolute target (24 Ultra Balls) then
    cost more than money − 10,000 and the owner stopped for review although
    nothing had been bought.
  - The basket must be re-derived from the current stock and money at its
    retained destination with nothing bought (status basket targets follow the
    thrown balls; durable care state: `replanned`, `observedSpent` 0, cost
    within money − 10,000), and the owner must travel past Route 22 (Route 23 or
    Victory Road) without any stop; the cartridge keeps at least 10,000. If the
    basket is bought first, the durable spending must be recorded with no basket
    retained. After anything was bought, or when no purchase fits the limits,
    the basket still stops for review (engine unit tests).
  - The owner is stopped through its own handoff boundary (`prepare-update`,
    the boundary software updates use): it holds at its next stable overworld
    frame with no battle, menu, pending save or unsaved capture, then retires.
    A plain Stop could leave the checkpoint in a wild battle that never settles
    without input (gate 106-01). The checks read that stop-time state, and a
    cold Continue of the in-game save must also keep at least 10,000.

`postgame-team-trade-evolution` runs both real owners (FireRed and the
Emerald partner) with the host coordinator. It starts from the live save after
the first Rare Candy supply.
- With the partner ready, the ordinary checklist must reserve the permanent
  team's Machoke before any Dex spare.
- It trades Machoke to Emerald and receives the same individual back as Machamp
  in its party slot.
- It verifies both exchanges and native saves, and leaves the other five
  teammates unchanged.
- Without the step, the checklist sends a PC spare instead. The case runs alone
  after the parallel lanes.

`postgame-national-ember-hunt` starts from the live save of September 23
(Celadon Pokémon Center 2F), retained after fourteen Slugma hunts had stalled
at One Island Harbor.
- The real National Dex selector runs on the native observation. Species it
  prefers are deferred through ordinary per-species retry records until it
  picks Slugma. It must choose Ruby Path B2F, never B3F or the B1F/B2F stair
  loop, which Strength boulders cut off from the entrance.
- The real hunt then travels by ferry to Kindle Road, the Mt. Ember exterior
  and the Ruby Path cave door, which a map-load script opens. It goes down
  1F → B1F → B2F and must reach a B2F encounter cell or the hunting phase, or
  meet Slugma on the way.
- The mission and player are rebuilt from their serialized state on the
  exterior. Every individual is kept and no native save is written.
- Before the fix, the selector chose B3F, and navigation had no route past the
  harbor.

`postgame-fame-cut-gym-trainer` uses the same live save. There, Tamia's Erika
fact had failed twice with "No executable route", because the Celadon Gym
yard is behind a Cut tree and no party member knew Cut.
- The Fame owner must borrow the stored Cut user, cut into the yard, talk to
  Tamia (Fame Checker person 5, bit 3), restore the original six and save.
- Each restore save opens the borrow for the next Cut-gated gym source. From
  this save the owner goes on to Lisa and Erika, one borrow, restore and save at
  a time. The case finishes once no borrow is open.
- A cold Continue must keep the facts and the original party.

`postgame-fame-museum-guide-loop` is the live Pewter City loop (Sept 25). The
Fame table listed the Museum Guide (object 1) as a source of Brock fact 2, but
his script awards nothing: answering NO walks the player to the Museum and he
disappears until the map reloads, so the owner looped on him.
- The case starts from the live save with the Museum Guide as the active Fame
  target. The owner must gain Brock fact 2 (person 2, bit 2) from the Fat Man,
  save, and keep it through a cold Continue with every original Pokémon.
- `engine/firered/test/fame-facts-sources.test.js` checks every visited Fame
  source against `test-support/fame-script-awards.json`, which
  `scripts/extract-fame-script-awards.py` extracts from the pinned pokefirered
  scripts.
- The save's waiting, clean Onix partner trade belongs to
  `postgame-held-item-partner`. This isolated replay sets it aside the way
  `deferPartnerEvolution` does.
- The same borrow now covers every Cut-gated source: the Gym sign, Tamia,
  Lisa, Erika and Brock's Pewter Museum journal.

`postgame-dunsparce-tunnel-rng` starts from the stop commit of live hunt
f4180987 (September 26). Its state and SRAM are that hunt's RNG plan source:
Three Isle Port 12,13, just off the ferry. The National Dex collection had
hunted Dunsparce there about 195 times.
- Three Isle Port's only land cells are a grass pocket reached through the
  Dunsparce Tunnel. `ThreeIsland_DunsparceTunnel_OnTransition` installs the
  dug-out layout once the National Dex is enabled (flag 2112 and variable
  0x404E = 0x6258); the knowledge pack keeps the walled one. Each RNG trial
  waited at the harbor door until "RNG menu navigation exceeded its budget"
  (about two minutes, owner held still).
- The real selector must keep Dunsparce on the Port with an exact route to its
  grass. The real mission must hand the reached map to RNG planning, and the
  real planner must build a verified plan in isolated trials observed with the
  worker's trial watch (the campaign story watch alone).
- The owner runs the plan through the worker's frame-exact executor. It must
  walk Port → tunnel → Port and meet a wild Dunsparce on a Port grass cell,
  with no menu opened inside the encounter-less tunnel. Every individual is
  kept and no native save is written.
- Before the fix the planner threw the live error after 110 seconds. Without the
  area check, Sweet Scent is used inside the tunnel and calibration fails;
  without the two watched values, the selector skips the Port.
- `engine/firered/test/dunsparce-tunnel-rng.test.js` covers the trial's
  earlier stop ("RNG setup has no executable route to an encounter cell of
  <map>" after 1800 frames without a route), a shorter wait that continues, and
  the selector's exact reachability.

`dojo-gift-hidden-power` asks for the Saffron Dojo Hitmonlee as an ordinary
(not shiny) gift with a chosen Hidden Power type, the one IV trait that min/max
IV ranges cannot express.
- It starts the real session worker from the `dojo-gift-timing` save's
  retained pre-gift anchor. Every received Hitmonlee is judged by its traits,
  and a mismatch resets to that anchor.
- The saved Hitmonlee must have the requested type, computed from the lowest
  bit of each IV. The owner must first turn down `minRejections` Hitmonlee of
  other types, so the case fails when the type is ignored. The gift is verified
  in the native save and through a cold Continue, with every original Pokémon.
- `engine/firered/test/rng-traits.test.js` covers the Gen III formula (type
  from the lowest bits, power from the second bits) on standard spreads.

`battle-tape-equivalence` proves that the opt-in battle tape (Laya L2
groundwork, `engine/firered/src/player/battle-tape.js`) never changes play. It
replays the `campaign-major-battle` Cerulean Gym checkpoint twice, first without
and then with `POKEMON_SUITE_BATTLE_TAPE`, in separate emulator sessions.
- Both runs must end on the same frame with the same save hash.
- The taped run must record the battle's choices, including moves with scored
  options.

`postgame-released-hunt-resume` restarts the live owner as it was retained on
September 23 at 11:56.
- The checklist had released a blocked Slugma hunt (navigation recovery
  exhausted, flagged for review). The first automatic Emerald exchange then
  finished both trades and saves.
- The postgame must resume, verify and save the returned Alakazam, and keep the
  released hunt's review.
- A retry of the deferred objective is a new hunt with its own budget.
- Before the fix the owner stayed blocked with "Three recovery attempts failed".

`postgame-held-item-partner` runs both real owners with the coordinator from the
live save at the September 23 stop (boxed Onix, Metal Coat in the bag).
- The automatic Dex route must withdraw Onix, give it the Metal Coat, trade it
  to Emerald, and receive the same individual back as Steelix.
- The coat must be consumed, and both exchanges and native saves verified.
- Before the fix, the route's equip step (which names no species) stopped with
  "The source Pokémon is missing, duplicated, or evolved outside the expected
  step".
- A unit test also covers the local worker waiting for FireRed's trade
  preparation. Its absence caused a live `TypeError` in the poll.

`postgame-firered-partner` runs two real FireRed owners with the coordinator,
and no Emerald owner. It starts from the `postgame-team-trade-evolution`
checkpoint. The partner is a temporary working copy of the owner's banked shiny
save (trainer ID 8185, saved at the Lavender Pokémon Center), imported as the
partner owner's seed.
- Only the FireRed partner is advertised. The ordinary checklist must reserve
  the permanent Machoke for that owner, trade it as the leader to the partner
  (guest), let it evolve there, and receive the same individual back as Machamp.
- Both exchanges and both native saves are verified, with normal link exits.
  Receipts are keyed by role, and the pair names both owners and trainer IDs.
- The partner's placeholder is its own ordinary party member (not shiny,
  legendary, an egg or an item holder). After the return, a cold boot of the
  partner's final save holds exactly its original party and PC individuals.
- The banked save is never written.
- Without the owner/title and partner work, the second FireRed owner cannot
  start ("Unknown configured Suite game.").
- The case runs alone after the parallel lanes.

`task-firered-partner` repeats the clean FireRed round trip from a retained
checklist under task scope. After both real workers publish their checkpoints, the
replay pauses the real host coordinator and starts the source bot. It requires
the source worker to publish `runScope: task` and the automatic
`waiting-for-transfer` request while the partner remains unprepared, then
resumes the host coordinator.
- The host must prepare the partner and finish both exchanges, both native
  saves, and both normal link exits.
- The source must retain the same individual as Machamp and all other owned
  Pokémon, retain task scope, and continue the original national-collection
  checklist to its next automatic evolution. That preparation may rearrange
  the party. The real host coordinator keeps publishing fresh availability; a
  replay-only command boundary records and rejects the next preparation request
  without dispatching it or fabricating success, preventing another exchange
  during teardown. The partner
  must remain net zero and the banked save immutable, as in the postgame case.
- This covers the coordinator's task-scope dispatch with actual worker status,
  rather than a fixture-only flag. The case runs alone after the parallel lanes.

`postgame-firered-partner-stall` and `postgame-firered-partner-restart` repeat
that round trip with one scheduling stall of the partner owner's process
(SIGSTOP, then SIGCONT; no input and no memory access) once both games are in
the outbound trade menu. Gate 105 failed `postgame-firered-partner` when the
partner's native RFU receive FIFO (64 packets) overflowed: the leader sends one
RFU frame per emulated frame, and the two owners' emulators ran on independent
clocks while one of them stalled.
- `-stall` stops the partner for 2.5 s, below the 4 s link heartbeat. The
  linked frame clock holds the leader, so the round trip completes with no
  retry (`restarts` stays 0). Before the fix it failed with the local link
  receive buffer limit.
- `-restart` stops the partner for 6 s, past the heartbeat. The link ends
  before the exchange; each owner cold-boots its unchanged native save and
  proves its original party and trade count, and the source retries the leg
  once (`restarts` 1); its deadline allows the repeated leg. Before the fix
  both owners stopped in `waiting` until a manual restart.
- The replay runs the coordinator as the host does: a command the partner has
  not acknowledged yet (its cold-boot readiness check is slow under load) is
  retried on a later tick instead of ending the replay.

`postgame-firered-partner-console-reset` repeats that round trip with the
partner console restarting itself in the outbound trade menu. Gates 118-02 and
122-01 failed `postgame-firered-partner` when the partner FireRed restarted to
its boot screen before any exchange. Its frame counter kept running, so no
owner reset it, and its stack still held nested RFU interrupt frames. The
partner reported the boot screen's empty party as "The prepared trade party
changed unexpectedly".
- Once both games are in the trade menu and the partner is still choosing its
  Pokémon, the replay presses the partner console's own soft-reset chord
  (A+B+Start+Select) through `scripts/replay-console-reset.mjs`. It is loaded
  only into that owner's process and changes controller input only.
- A console that has left its loaded game is not a party change. Before the
  exchange it is a lost link: each owner cold-boots its unchanged native save
  and proves its original party and trade count, and the source retries the leg
  once (`restarts` 1). After the exchange starts it stays
  `trade-outcome-unresolved`.

Extra saves (families the main save can only get from another FireRed save:
the other starters, the Dome Fossil, a Dojo Hitmon and the other roaming dogs)
add four cases. Every leg is a single verified native trade between two FireRed
owners (reservation method `single`), controller inputs only.

`postgame-extra-save-loan` runs the main save and the FireRed partner with the
coordinator. It starts from the owner's Sept 27 Four Island checkpoint (the
`owned-trade-sevii` save, which lacks the Squirtle line), with every local
checklist entry waiting on a retry so that only the extra-save plan can choose
work. The partner is a working copy of the bank (Squirtle start, a non-shiny
Blastoise in its party).
- The coordinator publishes the partner's inventory; the main save's postgame
  plans the loan and names the partner, its route and an unknown ETA.
- The opening leg trades an ordinary PC duplicate for the Blastoise, which
  registers it. The main save breeds a Squirtle Egg with its own Ditto at the
  Four Island Day Care, withdraws both parents, and returns the Blastoise before
  the Egg hatches (the closing leg). The Egg then hatches, the original team is
  restored and saved.
- Both pairs complete with both native saves verified; the receipt registers
  Blastoise and Squirtle; the duplicate and the Ditto are back; a cold boot of
  the partner's final save holds exactly its original individuals; the bank is
  never written. The case runs alone after the parallel lanes.

`postgame-extra-save-loan-resume` restarts both owners from native saves
preserved mid-loan by the first native run of the loan, which stopped at the
Day Care withdrawal menu: that list menu is not a stable field frame, and the
exchange waited instead of letting the Day Care task answer it. The main save
holds the Egg with both parents still in the Day Care; the partner holds the
main save's duplicate with its loan open in its ledger. Both owners restart;
the main save withdraws both parents, returns the Blastoise, hatches the Egg,
restores its team (the first resume run stopped there with
`repeated-menu-transaction`: the restore drained its own PC session) and saves;
the partner closes its loan net zero against the holdings it recorded.

`postgame-extra-save-loan-charmander` is the same loan for the Charmander line:
the partner is the archived FIRE save (Charmander start, post-League) after
`helper-park-archived-save` parked it in the Viridian City Pokémon Center, and
it lends its Charizard. The main save registers Charizard and hatches a
Charmander from its own Ditto; the FIRE save ends net zero.

`helper-park-archived-save` parks an archived save before it can lend: the
archived FIRE save (Charmander start, post-League, saved in Pallet Town) runs
only the ordinary travel player task to the Viridian City Pokémon Center and
saves there. A cold boot of that save passes the FireRed partner readiness with
its Charizard as the named offer.

`campaign-helper-fossil-goal` plays a helper record with a fossil goal from the
owner's Cinnabar Island campaign checkpoint (Helix Fossil still unrevived): hand
the fossil to the Lab, walk out and back, receive the revived Pokémon (declining
the nickname), save it in the party at the Cinnabar Center and stop with the goal
receipt, surviving a controller restart.

`campaign-helper-dome-fossil` plays a helper record choosing the Dome Fossil
from Mt. Moon B2F with the fossil objective active and neither fossil taken (a
checkpoint preserved from `campaign-home-healing` by the ordinary default
campaign): beat the Super Nerd, take the Dome Fossil (FLAG_GOT_DOME_FOSSIL) and
leave the Helix Fossil, surviving a controller restart.

`leafgreen-mansion-secret-key` resumes the owner's stopped LeafGreen campaign
from Pokémon Mansion 2F (9,3), the pocket that the set Mansion switch seals.
That run had stopped with no meaningful progress on its way to heal. The case
applies the owner's reviewed retry, then requires the run to:
- climb back to 3F, drop through a hole and heal at the Cinnabar Pokémon Center;
- survive a controller restart;
- obtain the Secret Key and leave the Mansion for the Cinnabar Gym objective.

The campaign is never blocked along the way. The supervisor clock advances at
the stopped run's own measured rate.

Postgame workflow qualification retains every earlier required case and adds:

- `postgame-tower-admission`: finish a retained pre-update save before refreshing
  its obsolete pending roster objective, then retain the admitted roster through
  the first native battle, reconstruction and arrival on floor two.
- `postgame-tower-recovery-prize`: resume a persisted outside-healer detour,
  complete the active Single challenge, save after its prize and cold-continue
  the prize and all original individuals.
- `postgame-tower-double-recovery`: heal through the Tower's lobby nurse after
  a Double floor, preserving the active mode and cleared floor on return.
- `postgame-unown-handoff`: continue a real worker's prepared form-specific
  hunt, restart, capture, save, cold-continue and select a different missing form.
- `postgame-league-record`: retain the first rematch receipt while claiming a
  sticker and completing another five-battle League run, then save, cold-continue
  and schedule the next record cycle.
- `postgame-fame-fact`: read the full native Fame record, obtain new facts,
  save, cold-continue and select another source.
- `postgame-fame-cut-roster` and `postgame-fame-original-togetic`: borrow the
  required identified party member, obtain the native fact, restore and save the
  original six, cold-continue and retain the next-source handoff.
- `postgame-egg-record-claim`: claim an earned Egg sticker, save and cold-continue
  its native level while retaining the daycare recovery reserve.
- `postgame-egg-record-repeat`: breed an already owned species, hatch it,
  restore the original party and parents, save, cold-continue and restart into
  the next breeding cycle. Retained fixtures carry absolute recovery cooldowns
  for other goals; the isolated replay re-defers them against the run clock so
  an expired fixture `retryAt` cannot outrank the retained Egg transaction.

All 91 scenarios, including the supply and Unown successor cases below, are mandatory. Separate saved native runs qualify all eight
floors and prizes of each Tower mode; a combined cold Continue verifies all four
prize flags and every original individual. This does not assert completion of
all 96 Fame facts, all 28 Unown forms, 200 League entries or 300 hatches.

The native suite's time limits come from the gate plan (`gate-plan.json`; see
"Parallel lanes, phases and time limits" below), so they grow with the corpus
instead of a fixed aggregate deadline. Long hunts are bounded by observed
progress rather than by wall-clock windows. Individual replay and
gameplay deadlines remain in force; new scenarios do not remove historical ones.
Successful saves alone cannot keep a stalled objective's progress deadline alive.

The seventy-fourth case, `postgame-tower-balanced-roster`, starts with the
retained post-League save: five level-77–79 Pokémon, one level-100 Fearow, and
a boxed Mewtwo. It must replace Fearow through native PC actions, retain the
six-family choice across a controller restart in the PC, save, and cold-Continue
with all 65 starting individuals. This qualifies balanced preparation, not a
Tower prize or all four Tower modes. All earlier cases remain mandatory.

The seventy-third case, `postgame-league-finish`, preserves the native stop after
Lance in the stronger League rematch. It must cross the opened doorway, beat
the Champion, complete Hall of Fame saving and credits, and return to playable
gameplay. Controller reconstruction covers Champion entry, battle and Hall of
Fame. Cold cartridge Continue must retain the increased League/save counters
and every original individual. All earlier cases remain mandatory. Generic
Tanoby and Selphy travel also retain executable-doorway characterization tests.

The automatic-partner replay must finish both real native exchanges, both saved
results and both normal room exits. Local RFU transport drains a pending
disconnect after the game closes its adapter, with a three-second limit for
unexpected departures. This prevents a disconnect delivered in the same socket
burst from clearing the final unread native command. Tests cover ordering,
timeouts, cleanup and bounded buffering; a saved result alone never qualifies
an interrupted exit as successful.

The 68th and 69th required cases, `postgame-combat-preparation` and
`postgame-tower-defeat`, cover actual PC roster restoration, productive XP
training and retention of a native Tower loss after the lobby clears its flag.
Both require controller reconstruction, a native save, cold Continue and
preservation of the original individuals. Every earlier case remains required.
These cases qualify preparation and failure handling, not a complete Tower or
League run; the distinction is retained in the postgame completion ledger.
The combat-preparation case also rejects generic restocking that spends the
challenge's earnings and interrupts native roster assembly or XP training.
Tower balancing requires five distinct families from the established permanent
team. A collection party first commits to restoring that team; the choice
survives intermediate PC actions, PC exit and controller reconstruction until
the challenge starts. It cannot switch to a different roster immediately after
restoration. The separate balanced-roster case retains its qualified reserve
selection through those same PC boundaries.

The 70th case, `postgame-victory-road-funding`, retains an actual League funding
deferral in Victory Road's final switch pocket. Reachability checks reuse the
navigator's authored passage rather than declaring all earning routes absent.
The replay must earn a native payout, leave the cave, reconstruct the controller,
save and verify the money and original Pokémon after cold Continue. Its existing
retry cooldown elapses through the supervisory clock; no game state is edited.

`postgame-league-shortage` and `postgame-league-intermission` retain both sides of
the one-way League recovery boundary. A native shortage must finish its retained
save and stop with the specific reason, preserving challenge ownership and retry
history. The stocked case must beat Lorelei, heal, save through reconstruction,
and enter Bruno's room. Both require cold Continue and individual preservation;
these boundary cases do not certify the entire five-battle rematch.

The 56th and 57th cases, `roamer-capture-handoff` and `moltres-ascent`, retain
the Entei safety stop and Moltres mission checkpoint. The roamer case verifies
natural-flight recovery without restoring the game, preserves the budget and
identity, then uses a separate preserved encounter to qualify a first throw
twice, capture, save across controller reconstruction and verify cold Continue.
The ascent case leaves the islands, handles observed Mt. Ember Strength pushes
across controller reconstruction, and hands off at the available Moltres
interaction. It does not claim a completed shiny Moltres hunt. Every prior
55 case remains required.

The thirty-eighth case, `campaign-postgame-handoff`, resumes a completed native
campaign into collection preparation, reconstructs the controller during a
menu, verifies a new native catch/save and a safe handoff, and preserves the
original campaign record. Postgame coverage and qualification limits are in
[FireRed postgame](FIRERED-POSTGAME.md). Existing 37 cases remain mandatory.

The thirty-seventh case, `trainer-portrait`, retains a female campaign save. It
verifies that native GIRL telemetry stays GIRL with no run profile and with a
conflicting planned character, including after restoring the same state. The
frame, SRAM and party remain unchanged; no game input is needed for this
presentation correction.

Campaign recovery ownership, budgets and evidence are documented in
[Campaign recovery](BOT-RECOVERY.md). `campaign-transform` adds a real Ditto
battle at 1×, 5× and 10×, including copied moves/PP, controller restoration,
field handoff and a hung planner worker at 10×. `campaign-strategy-recovery`
retains the Route 21 stop and injects a supervisory-clock delay to require a
different training choice, persistent rejection and productive native battle
handoff. These bring the required corpus to 36 cases. Neither case writes game
memory or changes the ROM.

Shared action boundaries and the seeded interruption corpus are described in
[FireRed action verification](BOT-ACTION-CONTRACTS.md). The menu and navigation
interruption cases are required alongside every historical native case.

The thirty-fourth case, `campaign-moving-rematch`, retains the Route 21 North
Vs. Seeker stop during Elite Four preparation. The trainer had walked beyond
scan range while its authored position remained nearby. The replay must exit
the stale menu, reposition, activate against observed trainers, and complete
the subsequent native double battle before handing back to field recovery.
It verifies the second allied Pokémon actually spends PP on its selected move,
restarts during menu exit, item use and the second battler's move menu, and
reloads the final checkpoint. Party identities, SRAM, the committed campaign
and the five-minute progress limit remain intact. No trainer coordinates,
RNG, moves or battle outcomes are injected into the emulator.

The thirty-third case, `campaign-field-dialogue`, retains Bill's Yes/No prompt
outside Cinnabar Gym while Rhydon's training interrupted the Earth Badge
objective. It verifies adoption of the five-minute progress limit with consumed
time intact, a recorded reviewed retry, the planned No answer, native field
release, Fly to Viridian and the same training-task handoff. The first reading
of a story value the campaign newly watches (VAR_NATIONAL_DEX, added for the
Dunsparce Tunnel) is a baseline, so an engine update cannot renew that time. It restarts during
the choice and Fly menus, then reloads a checkpoint at the destination. Party
identities, moves, XP, SRAM and the immutable run record must remain unchanged.

The older `campaign-story-checkpoints` fixture was captured after fourteen idle
minutes under the former fifteen-minute deadline. It now additionally requires
the new timeout to stop that retained budget before an explicit reviewed retry.
All of its original navigation, badge, restart and handoff assertions remain.

The thirty-second case, `campaign-menu-route-recovery`, retains the actual
three-move Goldeen capture stop. It must execute the selected Cut, recover from
controlled missing directional inputs at the battle action menu, catch the
same encounter, reload its emulator checkpoint and hand off to the next
campaign objective. Pending feedback survives controller reconstruction. The
original team and immutable run commitment remain intact. See the action
verification document for supported menu graphs and bounded recovery limits.

Two League tactics cases retain the original Lorelei and Lance emulator
snapshots. Their historical controller checkpoints were unavailable, so each
reconstructs only the observed battle objective and committed team plan. They
require native victory, the same living team, an action surviving controller
reconstruction, unchanged SRAM and handoff to the next room. Lorelei must finish
the retained 14-HP Dewgong with native Pound evidence; Lance must avoid the
retained voluntary switch cycle. Synthetic boundary cases additionally retain
healing when a proposed finish is unsafe and reject a reserve that cannot
survive an incoming attack. They do not claim a complete fresh campaign.

`postgame-league-champion-tactics` retains the live postgame Champion room,
before the rematch battle, of a level 89–100 team. The pre-change engine paid
five times to switch out members that were winning their KO races, bouncing
Machamp and Dragonite against Tyranitar and Golduck to Fearow against
Charizard; Fearow then fainted. The case reconstructs only the Champion
objective and committed team plan, and must reach the Hall of Fame with
`FLAG_DEFEATED_CHAMP` set, the same team and a battle action surviving
controller reconstruction. It fails on any voluntary switch back to a member
already withdrawn against the same opponent, on any paid switch out of an
active member whose KO race the engine rates as won, and on more than two paid
voluntary switches.

`postgame-league-exp-share` retains the live Indigo Plateau Pokémon Center
between postgame League rounds: four level-100 members, Persian (94), the
starter-family Venusaur (89), and the Exp. Share held by a boxed Raichu. The
pre-change engine ran the round with the full battle team and no trainee. The
case reconstructs only the League objective and committed team plan. The bot
must bring the Exp. Share to a passive trainee through the PC and held-item
targets, keep the trainee out of the lead, and reach the Hall of Fame with
`FLAG_DEFEATED_CHAMP` set after at least five League battles. The trainee must
never be active in battle, must still hold the Exp. Share, and must have gained
experience. A battle action must survive controller reconstruction, and at most
one original party member may be boxed.

`postgame-league-exp-share-restore` starts from the same center. Venusaur is
first given its own held item, Dragonite's King's Rock, with the ordinary
take/give targets. The composition must keep that item in the Bag for Venusaur
(never equipped on another member) while Venusaur holds the Exp. Share. The
passive setup then ends (an earlier engine's hold after a fainted battler,
written in its record shape), and before the full team goes in the next visit must take the
Exp. Share back to the Bag and give Venusaur its King's Rock. The pre-change
engine sent the full team in with the Exp. Share still on Venusaur and its item
left in the Bag. At the end the older hold record must still be in place (the
engine only notes when it first saw it), with no resume recorded. The case stops
before the League doors.

`postgame-league-exp-share` also requires, at the Hall of Fame, that no hold was
recorded and that no battler fainted in the round.

`postgame-league-exp-share-strike` retains the live incident of September 25
(the round that became Hall of Fame entry 102). Dragonite fainted to Agatha's
rematch team while the passive trainee Gloom held the Exp. Share at full HP. The
checkpoint pairs the retained emulator state inside the Agatha battle with the
last native save before it; the build aborts unless the state's save counter
matches the save. Its metadata carries that round's League workflow state, in
the older round shape, and the committed team plan. The case reconstructs only
the League objective and team plan; the battle objective is the one the live
controller resolved before the faint (the party read withheld, so the faint is
first seen after the battle, as it was live). Following the owner's decision of
September 26 (one fainted battler in a won round is a strike, and the trainee
stays protected for the whole round), the bot must:

- record a strike, not a hold, at the first stable decision in Agatha's room:
  no `disabled` record, Dragonite's faint recorded once (room 2) with the
  `battler-fainted` condition, and the round kept open;
- name Gloom in every League objective to the end of the round;
- keep the round and its faint, with no hold, when the controller is rebuilt
  from JSON at the Agatha intermission;
- beat Lance and the Champion and reach the Hall of Fame with
  `FLAG_DEFEATED_CHAMP` set, Gloom never the active battler and its experience
  risen while it still holds the Exp. Share;
- at the first readable field frame outside the League, judge the round as won
  (entry 102) with Dragonite's one faint in its history entry, close it, and
  record no hold and no resume; the next plan is active with Gloom.

The build-106 engine fails at the first stable decision in Agatha's room: it
holds `battler-fainted` there and the intermission objective no longer names
Gloom. (Until September 26 this case was `postgame-league-exp-share-faint` and
asserted that hold; the id was never in the release corpus.)

`postgame-league-training` retains a private copy of the live hunt checkpoint of
September 26 at the Four Island Pokémon Center, at Hall of Fame entry 200. The
save still carries the earlier engine's hold record (a battler fainted, entry
101, Agatha's room). The trainee Gloom is boxed, and a party Oddish holds the
Exp. Share. As in `postgame-league-record`, every other checklist goal is
deferred and the full postgame controller runs. The pre-change engine has no
League training entry. The case has two phases:

- **Held.** With the setting on but never resumed, the checklist must list
  League training as paused and not runnable, with the reason "Paused after a
  battler fainted at Hall of Fame entry 101. To resume, turn League training off
  in Bot settings and save, then turn it on and save again." The old record
  stays (the engine notes only when it first saw it), nothing resumes it, the
  agenda selects nothing, no League objective runs and nothing is saved.
- **Resumed.** The controller is reopened from JSON with a resume stamp newer
  than that first sighting. The hold must be released and recorded in history.
  A native cycle must open at entry 200 as the round starts, before Lorelei's
  room. There the party must be five level-100 permanent-team battlers plus
  Gloom holding the Exp. Share, not leading, with a Fly user still in the party.
  The controller is rebuilt during preparation, in a League room, in battle and
  at the Hall of Fame. Gloom must never enter battle. The round must be saved
  natively at entry 201 and judged as won with experience gained. The run is
  counted once for Gloom, no cycle stays open, and Gloom is still planned. Every
  original individual remains, and a cold Continue from the save shows entry 201
  and the same individuals.

The case has a 15-minute wall-clock limit.

`postgame-rare-candy-move-learn` retains the live Celadon Pokémon Center party
menu of September 24: a Rare Candy took the Dex target Diglett to level 21, the
move policy declined Fury Swipes, and the screen shows "Stop trying to teach
FURY SWIPES?". The pre-change engine did not observe that party-menu prompt,
waited on a party transition and stopped at its 120-second boundary with the
evolution task retained. Resumed as the Bot switch does, the owner must answer
YES, keep using one Rare Candy per level (a level-up move offered at 25 follows
the ordinary move policy), let Diglett evolve at 26 without cancelling, save
natively, close every menu and hand off to the next postgame objective. The
candy transaction must survive an owner restart; the cold Continue must contain
Dugtrio and every other individual. `postgame-rare-candy-move-learn-resume`
starts from the same screen after install 107 had resumed that stop through the
postgame checklist (which dropped the evolution task) and the host restarted;
the pre-change engine idled there with "Current task list is exhausted". The
owner must answer the prompt, close the menus, select the Dugtrio evolution
again and finish it the same way. Gate `gate-verification-124-01` (build 124)
failed both: the resumed owner ranked the new Oddish → Gloom → Bellossom chain
ahead of Dugtrio and stopped `blocked` at Six Island's harbor (the walled Sun
Stone had passed a map-entry test), and the retained owner, after Dugtrio,
opened the Rare Candy supply while the last candy's level-up was on screen, so
the supply pressed B at "Stop trying to teach …?". Every "Stop trying to
teach" prompt in both cases must be answered YES.

`postgame-safari-dex-capture` retains the live Safari Zone Center battle of
September 24. The National Dex checklist hunted Nidoran♂ with shininess
"any". RNG timing produced exactly that target (not shiny), and the hunt
protected it and saved its protected anchor. The pre-change protected Safari
capture admitted only shinies, so it stopped the owner inside the battle with
"The protected encounter is unreadable". No restart, Bot switch or checklist
restart resumed it.
- The owner restarts from that stop as an engine install leaves it: stop-game
  has switched the bot off. The stop must now be resumable ('paused'), and no
  frame may advance before the owner resumes.
- The Bot switch (player task 'resume') must then resume it. A readable,
  requested non-shiny Safari target now enters the same qualified Safari Ball
  capture as a shiny.
- The first-ball plan is verified by two independent replays before any owner
  input. It must catch the same individual, retire from the Safari and save
  natively.
- A cold Continue must contain the Nidoran♂, registered as caught, and every
  original individual with the party unchanged.
- The checklist must then run its next objective without blocking.
- On the build-108 engine the stop stays blocked with the live message.

`postgame-safari-dex-entry` covers a fresh Safari Dex capture from the same
visit. Its native state is the live vault's retained Safari Zone Center field
state from before that encounter, with the same native save. Its bot session
is the live hunt with the encounter fields cleared: hunting, running,
unprotected.
- The interrupted hunt resumes by itself (bot on), and RNG timing meets a
  requested Nidoran♂.
- The capture must admit that fresh protected target, with the same
  qualified-capture, native-save, cold-Continue and handoff checks. The caught
  individual must be the RNG-observed target.
- On the build-108 engine the fresh hunt blocks with the live message.

New engine and planner packages require a passing regression receipt. The
installer checks the receipt against the package's exact file inventory before
extracting code. Existing installed versions remain readable for pinned runs
and recovery. A signature identifies the publisher; the receipt records that
publisher's verification of the payload.

Run from the project root, using the Python environment with the Suite update
dependencies installed:

```sh
python scripts/verify-bot.py --corpus .private/bot-regressions/corpus.json --output .private/verification/run-001
python scripts/build-macos.py --verification .private/verification/run-001/report.json --engine-package /path/to/published-engine.pksuite --output .private/build-001
```

Keep the existing `--radio-runtime` option when building the wireless edition.
For host or UI changes, `--engine-package` retains the published engine capsule
only if every engine file matches the reviewed source. Changed engine code needs
`--engine-version` with a new immutable version instead. A fresh host verification
report must not regenerate a previously published engine version.
Signed engine/planner builds also require `--verification`. Source or test edits
invalidate an old report. Build and package commands verify this before use.

The runner exports reviewed source into an isolated temporary directory and runs:

1. A mandatory ROM integrity comparison for each native replay, using the
   reviewed original and exact approved trade patch fingerprints.
2. All FireRed engine tests, including navigation, menus, battles, capture,
   evolution, save/restart, trading state machines and update handoffs.
3. All Suite Python tests, including other game adapters, inventory, companion
   networking, radio lifecycle and software updates.
4. Standalone adapter, save, ROM artwork, browser and replay input tests.
5. Every registered native checkpoint replay against the user's local ROM/core.

Failure, an empty suite, a skipped ROM check/native replay or source changes during the run
prevent a passing receipt. Logs retain individual skipped tests. Browser tests
may skip when Chromium is unavailable; that is not evidence of UI qualification.
The standalone iOS emulator build is outside this Mac verification gate.

ROM approval lives in `pokemon_suite/rom_integrity.py`, independently of local
configuration and sidecar manifests. FireRed revision 1 may be unchanged or use
the reviewed `firered-rev1-peer-trade-v2` wireless trade patch. Its five file
ranges cover 132 bytes; exactly 127 differ from the original. Every byte outside
those ranges must match the independently fingerprinted baseline. The whole
patched ROM must also match its reviewed SHA-256, protecting instructions inside
the permitted ranges. Encounter generation, RNG, stats and catch rates receive
no patch permission. New versions or games need a reviewed source policy before
their native replays can qualify a release; a local profile cannot approve itself.

`rom-integrity.json` records each replay's game, mode, profile, config fingerprint,
base/used ROM fingerprints and changed-byte count, without ROM bytes or local
paths. Each replay checks that receipt against the config and the exact ROM
buffer it boots. The gate rechecks ROMs, configs and the receipt after all suites.
Missing originals, unknown profiles, forged fingerprints and changes during the
run fail verification. Both stock and native-radio configurations require
absolute local cartridge paths. A manual `scripts/replay-bot.mjs` invocation now
also needs the generated ROM receipt as its second argument.

These are release checks, so adding them does not restart a running game or
rewrite saves. New engine/planner packages require the ROM check; existing
installed versions remain available for pinned runs. This records the reviewed
publisher's tests and does not turn the receipt into proof against a malicious
publisher or a separately modified emulator.

Each behavior fix must add a regression test for the actual failure. Preserve
reproducible native checkpoints in the private corpus, with an observable
completion condition and unchanged-state assertions where appropriate. Run old
cases alongside new ones. The initial corpus covers completing a PC roster
transaction with a retained objective and recovering a displaced National Dex
save transaction. A third replay follows the PC exit through the next native
save, including the field-memory refresh required by the already exhausted
checkpoint. These files contain user saves and must never be released.
A fourth replay retains Suicune's supply task through Fly, a restart in the
party menu, the full purchase transaction and the ferry return to Celio. It
checks the exact inventory and money changes and stops before releasing the
roamer. It starts with the retained menu stop and uses the same recorded,
explicit retry path as the hunt Start action. Automatic collection starts do
not receive that retry permission or reset their recovery budgets.
A fifth replay uses a stopped Safari campaign to verify independent search
encounters count as progress across a controller restart, while a frozen field
still times out. Only its diagnostic watchdog is re-armed; its ROM and native
save bytes remain unchanged. A sixth replay covers returning home to heal after
obtaining a party: the active recovery task owns navigation, survives a restart
during dialogue, restores HP, and hands control back to the campaign before
leaving. Opening navigation must not override subsequent visits to the house.
The source-controlled `engine/firered/test-support/native-regressions.json`
requires these case identifiers, so a corpus containing only the newest bug
cannot qualify a release.

A seventh replay uses the original Misty turn-zero checkpoint to verify that
major battles override XP switch-training. It requires Grass attacks, no fainted
party members or consumed medicine, a controller restart during battle, the
Cascade Badge and a navigation handoff out of the Gym. The historical controller
state was not retained for that snapshot: the replay starts a controller with
the observed badge objective and original team plan. The native state is
unchanged, including the already committed first-turn recall. Behavioral tests
also cover rivals, every Gym Leader, Giovanni, the League and its rematches,
the Dojo master, scripted Rocket/biker encounters and ghost Marowak. They retain
ordinary wild/regular-trainer XP training and committed item transactions.

An eighth replay opens the real Cut party picker using ordinary inputs on a
preserved campaign save. It retains the old combat-recipient objective, requires
cancellation before selecting that recipient, restarts during the menu exit,
and returns to campaign control with the party, bag and SRAM unchanged. Engine
38 fails this replay by selecting the combat recipient. Behavioral tests cover
learning confirmations, empty move slots, resumed forget menus, explicit utility
roles, and capture/PC/teaching handoff when an old objective lacks its new helper.
If an older run has passed the preferred habitat, it can use a reachable native
backup carrier without changing a permanent fighter's role. Backup candidates
are not scheduled as additional captures.

A ninth replay starts at the stopped campaign's root PC choice, before its
assigned Rhyhorn has been caught. It uses the explicit reviewed retry, restarts
during menu recovery, closes the PC with the original party and SRAM unchanged,
then requires an ordinary Safari capture and a handoff beyond roster assembly.
The original Pokemon, team commitment and recovery history remain intact.
Same-milestone acquisition steps must precede a roster objective that consumes
them. The PC root is identified using the facing tile and native choice state;
unrelated choices remain protected. Explicit retries consume the existing
recovery attempt budget, including across a restart.

A tenth replay preserves the subsequent legacy clock failure. Older controllers
charged time spent blocked for review when a later Pause or update accounted
the clock. Blocked campaigns now suspend active-time accounting, including when
restored. A versioned correction can exclude the historical review interval
only when the retained menu-stop timestamp proves active budget remained and
the decision history shows no subsequent active action. It records the original
counters and excluded interval, preserves achievements and retry limits, and
cannot reset a real active stall. The replay uses this actual checkpoint,
restarts after recovery, catches Rhyhorn through gameplay and reaches the next
objective without changing the native save or run commitment directly.

FireRed combat members may learn Fly, Surf and Strength. Other HMs require an
explicit utility role; already knowing a weak HM does not make a fighter utility.
The Suite derives a versioned field plan from verified native roster facts and
keeps it separately in controller state. It preserves the original run record,
random seeds and permanent six, including on update/restart. Required field
helpers take precedence over the older no-helper setting. Existing learned HMs
are not edited or removed from the save; removal requires Move Deleter gameplay.
The postgame agenda also keeps a verified Fly user in the party: when a roster
change boxes the only flyer, the recorded flyer is withdrawn from the PC before
further collection goals, so long-distance travel can fly instead of walking.
A party that already knows Fly completes the entry, and an unrecoverable source
leaves it ineligible rather than stalling the agenda.

Evolution training (build 98) trains one identified Pokémon faster, using only
ordinary play:
- **Escort.** The strongest healthy party member escorts the trainee. Direct
  and escorted switch training compete on estimated rate, so higher-level
  tables become safe choices. The trainee still switches out before an
  opponent can act, and guarded training stays last.
- **Exp. Share.** The owned Exp. Share is withdrawn from the PC with the trainee
  if necessary and given to it. After the evolution, and before the native
  save, it returns to the bag.
- **Rare Candies.** A trip is charged once across the battles still needed. A
  limited candy stock goes to levels costing at least 3,000 XP, right after a
  natural level-up, because a candy discards progress inside the current level.
  Only such levels detour for a reachable field candy.
- **Planner cost.** The planner reuses a training selection for identical
  observation content and inputs, without changing any decision.

`postgame-evolution-acceleration` cold-continues the live September 22 save: a
level-23 Skiploom training toward Jumpluff. The recorded run needed about 36k
frames per level at the Memorial Pillar. The replay must finish within that
recorded budget, and it checks that:
- the trainee fetches the boxed Exp. Share
- it trains behind an escort against opponents above its level
- the plan survives a restart
- the trainee never faints
- it evolves and saves, and cold Continue restores Jumpluff
- the Exp. Share is back in the bag, and every other individual is preserved

The cold boot continues the checkpoint's frame count, because the owner's
trackers reject frames that go backwards.

FireRed ignores directional input for roughly the first 12 frames after a
battle menu reopens. This was measured on an Elite Four rematch turn that needed
Bag and Pokémon commands.

Menu-route recovery learns from input receipts. It used to count those ignored
presses as failures, so it rejected valid cursor edges and stopped with
`repeated-menu-transaction`. Presses issued within 16 frames of a menu surface
becoming visible, or of a new battle turn, are no longer evidence against an
edge. Ignored presses after that window are still learned. A genuinely rejected
edge is therefore still recovered through an alternate route, or stopped as
before.

`postgame-league-menu-settle` preserves the live stop against Lorelei's Lapras.
It restarts through the postgame checklist and drives the frame-exact live
execution loop with receipts. It must win the battle and reach Bruno's room with
no rejected edge.

The major-battle replay also covers direct exit objectives when the player is
already standing on an inactive automatic warp. These use the same step-off
and reentry behavior as transit routing; standing still cannot activate one.
Landing-only events beside a wide doorway resolve to a nearby activating event
with the same destination map, destination warp and elevation. This is required
by Cerulean Gym's three-tile entrance and is not keyed to that Gym's map name.

The corpus uses `pokemon-suite/native-regressions/v1` with a `cases` array. Each
case has `id`, `config`, `checkpoint`, `nativeRadio`, and `target`. Paths resolve
relative to the corpus file. Checkpoints use the existing SaveVault format and
checksum-bound state/SRAM files. Current targets are `postgame-pc-exit` and
`postgame-native-save`, `postgame-pc-save`, `roamer-supplies`,
`campaign-safari-search`, `campaign-home-healing`, `campaign-major-battle`, and
`campaign-hm-policy`, `campaign-roster-acquisition`, and `campaign-blocked-clock`;
extend the runner with a tested completion condition for
other native failures. The runner creates a separate emulator and never connects
to a live game owner or radio relay.

This is a regression gate, not a claim of an error-free full campaign. Test
coverage does not replace a long autonomous run or a physical Switch trade.
Record those separately with their exact engine, core, ROM and checkpoint
identities. Do not use a software update to rewind a completed catch or trade.

An eleventh replay preserves the overlevelled Mr. Mime / Rhyhorn Surf-training
checkpoint. It completes an ordinary native battle across a controller restart,
requires XP for the underlevelled permanent member and obedient teammates,
returns to field navigation toward the missing Soul Badge, and preserves the
party identities, SRAM and immutable run record. It never adjusts levels or XP.
General battle preparation now retains identity for one level at a time and
reassesses the team after completion. Legacy assignments adopt this policy once;
explicit carrier/identity evolution targets remain binding. Routine story travel
can train permanent members without choosing an XP detour. Major battle tactics,
healing, capture, save and active VS Seeker response transactions retain priority.
Known foreign-OT Pokemon above the native badge obedience limit yield to safe
obedient fighters; emergency replacement remains possible. Routine escort
selection favors adequately matched permanent members within two levels of the
lowest capable candidate. Boss fights continue to choose battle strength.
A field-carrier training prerequisite can first pursue its missing access badge
without advancing the completed objective prefix or abandoning the carrier.

A twelfth replay retains the pre-update entry to a partially completed Route 24
VS Seeker batch. It follows all remaining responses through the medicine-errand
handoff and rejects assignments that train a field helper instead of a permanent
member. It starts with the old lead already participating: XP already earned in
that first battle is preserved, and further foreign-OT XP is checked from its
first field boundary. Explicit identity or field-carrier training still owns its
required subject. This covers the non-battle parent-objective path that the
single-battle replay did not exercise.


The thirteenth replay preserves a five-badge campaign caught in Cinnabar's
locked Gym door script while its retained objective is Sabrina. Active
coordinate-event tiles now receive a traversal cost on unrelated routes, using
the native map variables. Explicit story targets and unavoidable corridor
scenes remain reachable. A held route stops at a scene boundary; changing the
scene variable invalidates its cached route. The replay leaves Cinnabar for
Route 21, restarts its controller along the way and retains Sabrina, party
identity, ROM and saved SRAM. Walking friendship changes are allowed.

The fourteenth replay starts from that loop's actual watchdog stop. Ordinary
resume and automatic update handoff cannot clear the stop. An explicit reviewed
policy retry preserves its report, achievements, lifetime accounting and run
commitment, records the consumed idle budget and grants a new progress window.
There are at most three such retries per campaign, retained across restarts.
An unresolved menu transaction, capture or NPC trade keeps the stop latched;
retrying a progress timeout cannot bypass that transaction's own review gate.
The old safety timeout still applies to each attempt. The replay requires the
same real route handoff and checks that the public story view reports five
verified badges, Sabrina active and no conflicting badge evidence.

Story presentation reads the actual committed campaign, including its dynamic
team acquisitions, field-carrier preparation and conditional Sevii interlude.
It cannot select objectives or mutate saved progress. Tests distinguish current
native evidence, historical completion, unknown observations and contradictory
badge flags. Future map puzzles and healthy-party observations cannot mark
unvisited story steps complete. The native app displays this under Bot Settings
→ Story progress; details and completed chapters are collapsible inside a
bounded scroll region. See [the full story checkpoint reference](FIRERED-STORY-CHECKPOINTS.md).

The isolated planner protocol also publishes the story snapshot for the owner’s
status API, including while paused. A real-controller worker test verifies the
read-only observation path, stable evidence through transitions and worker
replacement; older planner modules without presentation remain compatible.

The fifteenth replay starts at the ferry departure dialogue that exhausted the
progress watchdog after cycling between Two and Three Island. It completes the
already accepted trip, restarts the controller in the next destination menu,
reaches One Island and hands off to Bill's return objective. The native party,
SRAM and immutable run record are preserved. The campaign and hunt observers
watch the cartridge's Cinnabar and Celio scene variables: Lostelle's completion
flag does not unlock the Vermilion menu row. Behavioral cases cover every
Tri-Pass origin before and after that row unlocks, Rainbow pages, conflicting
pass flags and unavailable destinations. The latter cannot silently fall through
to a default acceptance of a different island.

The sixteenth replay preserves Haunter's repeated Dream Eater attempts against
an awake Tentacool. It requires a working alternative, a restart in the move
menu, battle completion and handoff to the same eighth-badge objective without
rewinding SRAM or changing party identities. The local move knowledge catalog
and its limits are documented in [MOVE-KNOWLEDGE.md](MOVE-KNOWLEDGE.md).

The seventeenth replay verifies all native held-item table rows and a genuine
owned Hard Stone from the preserved PC inventory, then exits the PC across
controller reconstruction with the same party, boxed identity and hunt policy.
It then equips owned berries through the actual Key Items → Berry Pouch menus,
restarts in the context menu and verifies item transfer and return to the field.
See [held-item and database coverage](ITEMS-AND-OFFLINE-POKEDEX.md) for the explicit
distinction between catalog/handoff qualification and damage-model tests.

The eighteenth replay preserves the Route 20 watchdog stop after a swimmer
rematch. It requires leaving the water through ordinary navigation, reaching
a safe recharge area, increasing the native Vs. Seeker battery to full, using
the device, finishing the next response batch, and returning to campaign
control with earned experience. Controller reconstruction occurs after shore
arrival and during activation menus. The original party identities, random
team commitment, eighth-badge objective and saved SRAM remain intact. It uses
the explicit reviewed retry on its private checkpoint; live update handoffs
cannot erase a watchdog stop or its retry history.

Recharge approach routing first preserves an available safe land path, then
uses normal observed travel if the player must return from water or another
transit surface. The recharge circuit and anchor retain their restricted
terrain rules. Training route fallbacks accumulate distinct trainer exclusions
through candidate exhaustion, including base identities, and terminate if the
selector repeats an excluded candidate. Only the executable winning selection
is committed. The progress watchdog is unchanged.


The nineteenth replay preserves the seven-badge Haunter training checkpoint.
It finishes the entered rematch, reaches a subsequent native training battle,
requires a capable trainee to choose Fight, reconstructs the controller in the
move menu, and verifies earned XP and return to the eighth-badge objective.
The original team identities, run commitment and saved SRAM remain intact.
A trainee can finish a short fight even when an earlier route selected switch
training or another member has stronger coverage. Retention requires working
moves, sufficient PP, ordinary health/level checks and a known incoming-damage
estimate with a spare-turn allowance. Immunity, uncertain damage, status,
insufficient health and forced battle transactions preserve protective behavior.
The estimate uses HP units instead of comparing normalized move utility to HP.
Boss readiness gates remain unchanged.

The twentieth replay, `competitive-ev-training`, uses the existing private
home-healing save and requires a native one-point Speed EV gain, controller
reconstruction in a move menu, exact EV readback, and a completed in-game save.
The direct-training replay also checks persisted trainee XP measurements.
See [training and competitive preparation](TRAINING-AND-COMPETITIVE-PREPARATION.md)
for the estimator, supported actions, and explicit limits.

The twenty-first replay preserves the actual Victory Road doorway loop before
manual takeover. Its recorded Route 20 destination is held by a navigation
campaign, because the newer training estimator may select another practice
area. It uses the original native checkpoint and party with the production
advisors and central player, reconstructs the controller on 3F, clears the
return passages on all three floors, rejects repeated return ladders, and
requires a handoff to ordinary Route 22 navigation with the same destination.
Saved SRAM stays unchanged. The historical full controller pointer was not
retained; the fixture documents this reconstruction explicitly.

Victory Road's authored return and the ordinary map graph now agree on the
destination region, including the two disconnected approaches within Route 23.
Returning south handles reset Strength gates and obstructing boulders before
leaving the cave. Northbound League travel and internal puzzle targets retain
their existing behavior. Behavioral tests also distinguish destinations on
opposite sides of the same map.

The twenty-second replay starts from the completed campaign and verifies that
a paused save can reopen with its saved display frame. The preview is compressed,
checksum-bound to its native state, and stored only in private save metadata.
Restoring or displaying it cannot advance the emulator or alter native state
or SRAM. Native rendering takes over on the next real frame; actual black fades
are preserved. Corrupt or mismatched previews are ignored. Existing saves without
a preview acquire one when their game next renders and saves. Audio continues
to use the original emulator source. Campaign completion still requires the
native Hall of Fame save and return to playable postgame, then waits for a
command with the viewer alive; it does not imply all Sevii side quests are done.

The twenty-third replay preserves the stopped Fly-teaching campaign, including
its random Charizard team, pending VS Seeker responses and recovery history.
The supported reviewed retry must leave the unrelated party menu, select the
TM Case and HM02, teach Charizard through ordinary move replacement, and close
the menus before continuing the Silph Co. objective. It reconstructs the
controller at the recipient picker. Pokemon identities and experience, other
members' moves, item quantities and saved SRAM must remain unchanged. The TM
Case's native sorting is allowed. A teaching objective defers training until
the move transaction finishes; pending rematches remain available afterward.
This applies to all move-teaching objectives. Fly, Surf and Strength remain
allowed for combat members; the separate restricted-HM regression stays required.

The twenty-fourth replay retains the Route 17 campaign stopped below a ledge
while approaching Biker William. It executes the production autonomous emulator's
movement leases against the native core, using virtual presentation ticks at 10×.
This covers complete multi-segment input, settlement and execution feedback rather
than replaying only each action's initial hold frames. The approach starts on
normal ground and encounters a slope after a corner. It must retain the bicycle
brake over the full route, reconstruct the campaign controller after climbing,
defeat the intended trainer, earn native XP and hand back to the Koga preparation
objective. The original team identities, campaign commitment and saved SRAM remain.

Terrain controls inspect the entire executable route, including intermediate
tiles within straight segments; current cartridge tiles override source layout
tiles. Slopes outside the planned route do not change ordinary bicycle controls.
Route and segment execution confirm the final position after movement settles,
so touching a destination then rolling away cannot be reported as successful
arrival. The existing watchdog is unchanged.

A twenty-fifth replay preserves the Route 18 Vs. Seeker menu stop. It resumes
the in-flight activation, reconstructs the campaign controller, rejects repeated
activation across the inaccessible barrier, and continues through ordinary
trainer battles to a fresh activation from a reachable position. It reconstructs
the controller in the next activation menu and requires an actual rematch win,
native XP, a stable field handoff, and preserved campaign/party identities and
SRAM. The production input executor runs at virtual 10× timing. Necessary HP/PP
recovery after the rematch retains its priority.

Vs. Seeker plans must prove local access from the activation position to the
trainers. Route visibility alone is insufficient: leaving and reentering the
same map clears responses. Remaining response steps constrain travel, while
one-way ledge actions can preserve responses without reloading a map. These
checks apply to both campaign training and battle-income preparation.

The twenty-sixth replay retains the campaign stopped at the northern 3F ladder
after healing interrupted its final Victory Road boulder objective. It must open
the obstructed return passage, reconstruct the controller, restore any necessary
reset switch, drop the boulder, activate the final 2F switch and return to Indigo
Plateau with League preparation active. It uses the original campaign and party
and the production executor at virtual 10×. A short wait for the native switch
script is allowed; a persistent unsupported-action wait fails the replay.

Boulder objectives keep their authored pushes when executable. When their
approach is blocked after reentry, they use the same Victory Road transit
recovery as ordinary destinations, treating other boulders as obstacles until
the appropriate passage plan moves them. The original northbound and southbound
navigation scenarios remain required alongside the interrupted puzzle case.

## Native postgame acquisitions and paired owners

The required corpus preserves the earlier cases and adds `postgame-game-corner`,
`postgame-breeding`, `postgame-npc-trade-start-menu`, `postgame-recovery-storage`, and
`postgame-automatic-partner`. See `FIRERED-POSTGAME.md` for their actual proof
boundaries. Paired cases require separate immutable checkpoints and a
`partnerGame`/`partnerCheckpoint`; preflight verifies the companion against the
reviewed stock Emerald fingerprint. The replay rechecks those bytes and the
configuration receipt before either owner runs. A local manifest cannot approve
a modified companion cartridge. All temporary owners are isolated from live
saves and stopped when the replay ends.

`postgame-npc-trade-start-menu` resumes the retained Celadon checkpoint with
Pokémon selected in the Start menu. It must finish Fly to Cerulean, the native
Poliwhirl-for-Jynx trade, storage of its intact letter in the PC mailbox,
restoration of the original team, and a native save.
The replay proves the reserved Poliwhirl has exactly one owner before the trade,
is absent afterward, and cold Continue retains Jynx, the trade flag, the
stored letter, and the restored team.

`postgame-egg-wait-progress` is live hatch 113 (Sept 26). Its same-trainer
Rattata and Donphan get a 20% native Egg roll every 256 daycare steps and
needed 19 rolls. The owner walked the whole wait, but no watchdog evidence
changed, so the five-minute timeout opened a 120-second boundary that a dirty
breeding task cannot meet.
- The case starts from the live autosave after 12 failed rolls, with the owner's
  watchdog as retained then: 279 seconds idle since the parent deposit, having
  seen this cartridge state (re-expressed in the replay's observation space).
  The watchdog clock advances with emulated frames at the cartridge's native
  rate (an owner at 1x), so host load cannot change the result.
- Without the roll credit the boundary opens about 21 paced seconds later,
  before the next roll. With it, the first decision sees the owner's roll count
  for the first time and renews the budget once (an update installed mid-wait
  credits the rolls made since the deposit); after that only a new roll renews
  it, about every 118 paced seconds. The owner restarts in the wait and during
  the hatch, waits six more rolls (711 paced seconds) for the Egg, withdraws
  both parents, hatches, restores the original six and saves; a cold Continue
  keeps every individual.
- Only a wait that outlasts five paced minutes after that first renewal
  exercises the per-roll credit. The replayed draws decide that, so the replay
  reports it (`creditedPastTimeout`) rather than asserting it. The per-roll
  credit, its 64-roll bound and the owner scope are covered by
  `engine/firered/test/postgame-egg-wait-watchdog.test.js`.

## Bounded postgame failure recovery

`postgame-funding-recovery` retains the Route 15 partial Game Corner purchase.
The replay invokes the production suspension request on the copied controller
state, then proves the native save and cold Continue preserve currency and every
owned Pokémon. It resumes the same request, restarts during the gate detour, and
requires actual battle income. The suspension trigger is explicit because the
historical watchdog signature depends on the observer's watched flags; unit
regressions separately exercise automatic timeout and unavailable-funding entry.
The cartridge state, SRAM and ROM are never edited to construct the scenario.

Behavioral checks cover disconnected activation/recharge routes, arrival versus
unsupported navigation, moving NPCs, bounded retries and missing advice,
persisted failed funding candidates, partial acquisition suspension, save
failure, protected ownership, agenda retry limits, and truthful health status.
All earlier native cases remain required.

Automatic postgame hunt start failures return to their clean agenda owner with persisted failure history, while protected transactions and explicit user requests remain retained. The `postgame-hunt-rejection` native regression restarts the actual rejected Snorlax handoff and verifies movement through the Route15 gate with the original suspended prize request. Suspended acquisitions are also persisted in the shared agenda so intervening hunts cannot discard their identity. Automatic Snorlax continuation is separately covered by `postgame-snorlax-handoff`; explicit legacy reset hunts still use their prepared encounter.

See [BOT-RECOVERY-BOUNDARIES.md](BOT-RECOVERY-BOUNDARIES.md) for the research-to-code audit, recovery deadlines, task-specific progress and boundary test matrix. The required `postgame-boundary-recovery` native case covers the retained ordinary-battle timeout through verified suspension and resumed income.


The sixty-second case, `postgame-income-chain`, adds the connected production
worker funding → coin purchase → Scyther → native save chain, including restart
in battle and after partial coin purchases. Checkpoint inspection reobserves the
same copied frame after a restore so an observer's old callback signature cannot
hide a completed transaction. The game itself is neither advanced nor changed by
that read. See the coordinated funding section in BOT-RECOVERY-BOUNDARIES.md.
Completion is sampled from checkpoints until a cold Continue of the native save
contains Scyther. The in-memory save counter can already exceed the baseline from
an earlier save while the post-purchase save is still being written (gate
102-01).

The required corpus also retains `protected-capture-exhaustion`: the exact failed legendary capture source must recover through qualified inputs, native save and cold Continue. This supplements the original full static timing/restart case; a later favorable timing run cannot replace it.

## Post-victory menus and remaining postgame handoffs

The 67-case corpus retains every earlier scenario and adds:

- `postgame-evolution-learning`: the actual Venomoth move-picker stop with the
  native battle flag still set after victory. It requires learning, a new save,
  controller restarts, cold Continue, all original identities, and agenda handoff.
- `postgame-acquisition-travel`: the same checkpoint through the evolution save
  and a Game Corner acquisition's ferry trip to Celadon, retaining its request
  across a ferry-menu restart. Prize purchase/save remains covered separately.
- `postgame-tower-travel`: native travel to the Trainer Tower lobby, its save and
  handoff. Tower interiors belong to Seven Island. This does not certify winning
  all four challenges.
- `postgame-snorlax-handoff`: the production worker continues the existing game
  from a completed hunt, restarts, supplies and saves its encounter anchor, catches
  the required shiny, and verifies ownership and Pokédex registration after cold
  Continue. Timing shares the conservative RNG wait used by gifts and legendaries;
  Snorlax's native confirmation prompt consumes two RNG advances per frame.

The existing Sapphire replay additionally requires Lorelei's optional house
conversation before Celio's delivery and verifies both flags after cold Continue.
The cartridge permanently hides her on delivery. An already-missed conversation
stays incomplete and unavailable on that save; the agenda must not retry the
absent NPC or manufacture completion. Event and partner prerequisites, storage
capacity and unqualified full-collection routes remain explicit limits on
full-checklist completion.

## September 20 supply-trip qualification

The corpus retains all 84 historical cases and adds the mandatory
`postgame-shopping-resume` case from the preserved September 20 safety stop.
It requires actual Tentacruel revival, retained shopping through Victory Road,
controller reconstruction during treatment, puzzle traversal and purchasing,
a verified native save, cold Continue, individual preservation and a subsequent
task handoff. Unit checks additionally cover destination rejection, stock and
route validation, deferred baskets, spending limits and retained owner budgets.

The preserved September 20 failure stops on its healer detour at Route23 `(5,29)`:
the retained Celadon nurse has no supported onward route. Behavioral regressions
cover retargeting to Viridian at a free field boundary, preserving the basket,
Revive replacement cost and watchdog through reconstruction, and stopping when
no replacement is reachable. Locked input and open transactions retain ownership.
The unchanged failure seed and diagnostics remain private. Unit coverage does
not qualify the complete supply transaction: this case must pass the exact-source
gate before packaging or changing the live owner's engine.

The corpus also requires `postgame-unown-successor`, retaining the saved A-form
checkpoint and exercising the next missing form, ?. It uses the existing real
worker handoff replay, including restart, capture, native save, cold Continue and
original-individual preservation. This supplements the original A-form case;
it does not replace it or establish all 28 forms. With this successor case, all
86 scenarios are mandatory. A separate consecutive-capture receipt must
establish travel to another chamber before claiming that joined workflow.

## Development selections and evidence reuse

`scripts/verify-bot.py --cases <id,...>` runs the unit suites and only the named
native replays. The report carries `receipt: false`, and
`require_bot_verification` refuses such a report at packaging, so a development
selection can never become a release receipt. A release run keeps every corpus
case mandatory.

`--resume-from <dir>` reuses per-case passes from an earlier run only when the
reviewed source and corpus hashes are identical. The earlier run may have failed
or been interrupted: only its passed cases are offered (collected into
`reuse-evidence.json`). Each reused case is rechecked against its recorded ROM
SHA-1, core digest and checkpoint state hash; failures always rerun. The report
lists every reused case in `reusedCases`, and the native check records per-case
durations.

Evidence is durable while the run is still going:
- `run-manifest.json` is written before any suite runs (source and corpus
  hashes, options, the plan's digest, estimate and budget);
- `checks.jsonl` gets one line per finished suite;
- `case-evidence.jsonl` gets one fsynced line per finished native case, with the
  case's own log (`native/<id>.log`) and its SHA-256, before that replay lane
  takes another case. The final `case-evidence.json` is still written.

A stopped run (SIGTERM, including the gate wrapper's deadline) stops every
replay worker and the owners they spawned, then writes `report.json` with
`status: failed` and `interrupted: true`. Resume it with `--resume-from`.

`scripts/run-gate.py` runs a gate detached and writes `gate.done.json` with the
exit code, elapsed time and check summary, then posts a desktop notification.
Inspect the summary or `report.json` when it exists instead of polling the log.

### Gate-failure triage (advice only)

When a run fails, `scripts/run-gate.py` adds a `triage` section to
`gate.done.json` and prints it. `scripts/gate_triage.py <run>` gives the same
advice for any verify-bot output folder, reading it and the runs beside it.
Each failure gets one class:
- `regression`: ROM integrity; a failure already seen on the identical source
  and corpus; a case or test that the last passing run did not have; a stage
  that stopped without its summary; or no timing signature and no registered
  family.
- `known-flaky`: a registered family that failed this way before and passed
  when the identical source ran again (the income chain and the worker resume
  under load, the transform planner restart).
- `race/flake`: a temporary-folder cleanup race, a spent wall-clock budget, or
  a stop-time checkpoint taken mid-action (phase `transition`).

When every failure is retryable it suggests `--resume-from <run> --first
<cases>`; otherwise it says to investigate first. A second failure on the
identical source is always a regression. The triage never changes a result:
the next run still has to pass every check. The runner also samples the load
average once a minute into `<run>.load.jsonl`; the triage shows the peak as
evidence and does not use it to decide.

On the 13 failed gates of Sept 22–24 (`tests/data/gate-failure-labels.jsonl`),
letting each family answer only for runs after the one that showed it, the
triage matches the diagnosed class 9 times, against 6 for a constant
"regression" answer, and it never advises a retry for a real regression. It
is deterministic: 13 failures are too few to calibrate Laya, and L1.1 measured
zero-shot Laya at a constant's accuracy on stop triage.

### Parallel lanes, phases and time limits

`--lanes N` runs the native replays in N worker processes. Each worker runs one
case at a time, in its own emulator, exactly as the serial runner does. Some
cases are paced by the wall clock, so they run with no other replay competing
for the CPU. They are listed as `exclusive` in
`engine/firered/test-support/native-regressions.json`, beside `required`:
the real-time wireless exchanges between two live games (the partner, trade
evolution, held-item, extra-save loan and helper trade cases, and
`postgame-recovery-storage`), and `campaign-transform`, whose planner
supervision restarts a worker after a real timeout.

verify-bot writes the schedule to `gate-plan.json` before any suite runs
(`--plan-only` writes just the plan):
- **Phases.** Exclusive cases named in `--first` run first, alone; then the
  parallel lanes; then the remaining exclusive cases, alone. Within a phase,
  `--first` cases come first, then cases without a recorded duration (usually
  new ones), then the longest first, using `--order-from <run>` durations.
- **Budget.** The estimate replays the schedule with the recorded durations,
  counting fifteen minutes for a case without one. The native suite's deadline
  is 1.5 × the estimate + 10 minutes. `scripts/run-gate.py` adds 45 minutes for
  the other suites to set its own outer deadline.
- **Watchdog.** Each case may run for max(3 × its recorded duration, 15 minutes)
  (45 minutes without a record). Past that, its worker and everything the worker
  started are stopped and the case fails.
- **Failure limit.** After `--max-failures` native failures (default 3) no new
  case starts; cases already running finish, so their own cleanup of spawned
  owners and temporary saves still runs. Below the limit a lane failure does not
  stop the run, so the exclusive cases still run and report.

Lanes, order and the plan change only scheduling. Every corpus case still runs
to its verified end state, any failure fails the run, and the report records
`lanes`, `order` and the plan's estimate and budget. `scripts/run-gate.py` uses
three lanes by default; `--lanes 1` runs every phase one case at a time. On gate
95-03's timings, three lanes finish in about 44 minutes instead of 131. The
longest case sets the floor.

Replays are deterministic except where a spawned worker or a real-time link
paces them by wall clock. Between gates 95-03 and 96-01, 76 of 86 cases ended
on the same frame with the same save hash. The first lane-mode gate must
reproduce those end states exactly.

The Unown successor replay bounds its worker by observed frame progress, with a
stall limit and a wall-clock cleanup backstop, instead of a wall-clock duration,
so a loaded gate host cannot expire it mid-capture. Gameplay deadlines are
unchanged.

FireRed collection goal (build 124) adds three required cases, all from the live
September 28 checkpoint at the Lavender Pokémon Center 2F (162 of 189 FireRed
species registered; the unfixed owner reported "Available routes are cooling
down after failed attempts" after a Switch trade and stood still):

- `postgame-fishing-collection`: the retained owner's first decision is a
  fishing hunt. The real session worker resumes the checklist, collects the
  Good Rod from the Fuchsia fishing guru's brother, fishes Krabby on Route 12,
  restarts while fishing, catches and saves it (cold Continue: Krabby, the rod
  and every original individual), then hands off the Kingler evolution. Other
  local routes keep ordinary retry records for isolation.
- `postgame-breed-to-evolve`: the shiny-only Eevee breeds a plain Eevee with
  Ditto at the Four Island Day Care (restarts at the deposit menu, after a
  withdrawal, while hatching and during the evolution). The shiny leaves the PC
  early in the friendship cycle, comes back before hatching and keeps its moves,
  item and friendship; only the Day Care's experience is added. The hatchling
  (never the shiny) evolves with a stone and both native saves are verified.
- `postgame-collection-sources`: selection only. The knowledge pack agrees with
  the pinned goal list; the checkpoint counts 162 owned, 14 reachable, 13
  planned and 196 other-game entries; Castform counts as #351; and each route
  resolves to its real first step (Good Rod Krabby, Lax Incense Wynaut, a
  Poliwhirl spare for ZYNX, the protected Eevee and Omanyte breedings). The
  Sun Stone and King's Rock behind Strength boulders are not ordinary
  supplies; the Metal Coat is. Since build 126 Bellossom's first step is the
  reviewed Ruin Valley boulder route (`map-arrival` at Ruin Valley).

National collection workflows (build 126) add three required cases. Two start
from the live October 1 stop at the Four Island Pokémon Center (176 of 189
registered, an engine-125 exhausted record that the new workflow revision
evaluates again). The third starts from the October 4 save with the FireRed
partner ready.

- `postgame-flareon-fire-stone`: the plain hatched Eevee is withdrawn, a Fire
  Stone is bought at the Celadon Department Store 4F across the Seagallop (the
  only seller on the navigation graph), and Eevee becomes Flareon. The case
  restarts in the mart, with the stone stocked, and during the evolution. A
  cold Continue proves Flareon, the consumed stone, every original individual
  and every unchanged shiny.
- `postgame-bellossom-sun-stone`: with Flareon deferred, the owner travels to
  Six Island's Ruin Valley and makes the four reviewed Strength pushes, each
  chosen from the live boulders (11 east, 12 south, 13 east, 11 north). It
  collects the Sun Stone (flag 0x1E6), raises the plain PC Oddish to Gloom
  (never the League trainee Gloom) and uses the stone. The case restarts
  mid-puzzle, with the stone stocked, and during the evolution. A cold Continue
  proves Bellossom.
- `postgame-politoed-kings-rock` (exclusive: two FireRed owners plus the host
  coordinator): with Flareon and Bellossom deferred, the owner fishes a plain
  spare Poliwhirl and takes the King's Rock from the party Dragonite that held
  it. It withdraws and equips the Poliwhirl, trades it to the FireRed partner
  (it evolves there) and receives the same individual back as Politoed, with
  both native saves and link exits verified. The King's Rock is consumed, the
  Dragonite holds nothing and the partner is net zero.
