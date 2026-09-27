# Training and competitive preparation

Campaign preparation retains its story, major-battle readiness and one-level
rotation rules. Reachable trainer batches and wild land tables can now be
compared by the assigned Pokémon's expected XP over the full cycle. The
comparison accounts for the current moveset, switching, Exp. Share recipients,
trainer and Lucky Egg bonuses, travel, encounter search, rematch charging,
dialogue and PP recovery. Opponents come from the owning game's tables and
current rematch tier. Incomplete matchup data retains the earlier selector.

Timing constants are initial estimates. Native XP readback, emulated frames
and the campaign's active wall clock calibrate the comparison after battles.
That clock excludes user pauses and survives controller reconstruction.
Measurements are keyed by route or trainer batch, individual, level band,
moves, held item and training method. Estimates and observed XP per minute are
separate values; the Mac activity statistics show the observed rate when
available. The bot retains an existing choice for improvements under 15%,
including its travel cost. An affirmative Vs. Seeker response batch still
finishes before a new location can be selected.

This estimates the best of the currently supported, reachable options. It is
not proof of a globally fastest route, a perfect damage simulation or a
completed campaign. Combat safety still makes the actual switch and move
decisions. No game memory or Pokémon records are edited by these features.

Experience goes only to members that can still gain it. A level-100 member is
never a Vs. Seeker batch trainee, a balanced-experience recipient or a
participation-switch target; it may still escort or finish. When no healthy
permanent member is below level 100, an activated response batch is finished
without a trainee.

## Battle decisions

Single-battle switching compares conservative KO races from observed battle
data: each member's minimum damage roll times accuracy against the opponent's
maximum credible hit, with an unknown speed order counted against us. A paid
switch gives the incoming member a free hit first. The active member keeps
attacking while it wins its race, whatever its health; a narrow win by a
member that the health and level gates call unsafe may hand over only to a
member that wins comfortably after its entry hit. A losing member switches only
to a member that still wins after that hit, and otherwise keeps attacking
unless it would faint this turn without winning. A member already withdrawn
against the current opponent (FireRed's participation mask) is not switched
back in except in such an emergency. Free shifts and replacements after a faint
choose from the live enemy party, keeping the only answer to a later opponent
in reserve. In a League room, or on the map of another major trainer whose
party is known, the field lead is reordered from the static trainer data when
the current lead does not win comfortably against the first opponent and
another member wins (comfortably, if the lead still wins narrowly), unless
training owns the lead. When a race cannot be
bounded, for example an unknown move, item or frozen member, the earlier
matchup rules apply.

## Passive Exp. Share trainee in League rematches

Between postgame League rounds, at the Indigo Plateau Pokémon Center, the bot
can give the sixth party slot to a trainee. This applies to every postgame
League round: the rematch itself, the Hall of Fame sticker record and League
training (below). It happens when five permanent-team members can carry the
round alone. Each must be at least 15 levels above the rematch Champion's ace (level 90 in FireRed, capped at 100),
obedient, and have attacking PP. The trainee is, in order of preference:

1. a Pokémon whose level-up evolution registers a missing National Dex species;
2. the team's lowest member below level 100 (any member of a permanent-team
   family, boxed ones included; League training keeps to the battle team, below);
3. otherwise the lowest-level party member below 100.

For the first choice, every owned candidate is tried in rank order until one
can be composed. Only evolutions reached by level alone count. Friendship and
item evolutions are left out, and so is Nincada's Shedinja, which needs a free
party slot. A current trainee chosen for the first or second reason keeps its
place until it reaches its target. One chosen only as the lowest-level party
member gives way to those candidates, and trains on only when none of them can
be composed.

Shinies, eggs, protected Pokémon, and Everstone or Mail holders are never
chosen. The starter family, which the PC roster never deposits, is always either
a battler or the trainee.

The existing PC roster and held-item targets assemble the party. A boxed
Exp. Share holder visits the party once to hand the item over. The trainee's
other item is taken, the trainee receives the Exp. Share, and a fighter moves to
the lead. While a trainee is planned, the general held-item policy leaves the
Exp. Share alone, does not equip the trainee with anything else, and keeps the
trainee's own item in the Bag for it.

In battle the trainee is never the lead, a voluntary switch, a free-shift target
or a revive target. It is a forced replacement only when every other member has
fainted. If something else sends it out, it is withdrawn to a member that can
fight. This protection lasts the whole round: once the round starts, every League
objective names the trainee until the round is judged, even after a hold
(owner decision, September 26; build 106 dropped the trainee at a hold).

### Strikes and holds

A round starts in Lorelei's room with the composed trainee. The bot records the
Hall of Fame count, the trainee's experience and the money there, then every
battler that faints. The round is judged at the first readable field frame
outside the League rooms, never during the Hall of Fame scene. A new Hall of
Fame entry means the round was won.

One fainted battler in a round that is still won is a **strike**, not a hold
(owner decision, September 26): the round is recorded with its faint and
training continues with the same trainee. The intermission revives the battler
(otherwise the League recovery stops the bot), the trainee was untouched and the
round was won. Build 106 held at the first faint instead.

Any of the following is a **hold**. It turns the trainee off for all later
rounds until the owner resumes training (below); the current round keeps its
trainee protected to the end:

- two or more faints in one round (`battler-fainted:multiple`, at once; the
  same battler fainting in two rooms counts as two faints);
- a round with a faint when another of the last five judged trainee rounds
  had one too (`battler-fainted:repeat`, at the judgement; the round just
  judged must contain a faint, and a resume keeps this history);
- the trainee takes damage;
- the trainee is missing from a readable party;
- the intermission is blocked, for example because supplies ran out, a save
  failed or the party could not be read. The League recovery still stops the
  bot, as before;
- a Pokémon Center visit cannot compose the trainee, for example because no
  party member can make room for a boxed Exp. Share holder. That visit already
  uses the full team;
- a round ends without a new Hall of Fame entry, a round with one faint
  included (its conditions then list the faint);
- the trainee is below level 100 and gained no experience in a won round;
- the round's starting Hall of Fame count could not be read.

A hold keeps the round open for its judgement, and winning that round does not
lift it. An unreadable value never decides a verdict. An unreadable party inside
the League leaves the verdict to a later frame. If the Hall of Fame count is
unreadable outside, the round stays open and the next visit uses the full team
until the round can be judged. A new round never starts while an older one is
unjudged.

Faints and trainee damage are read from the party on field frames between
battles. A battler that faints in the Champion battle can go unseen, because the
Hall of Fame follows directly.

The League workflow state (`leagueExpShare`) keeps the hold in `disabled`, with
its reason, every condition seen, the Hall of Fame entry and the time. `history`
keeps the last 50 events: judged rounds (faints, experience gained and money
change), holds, resumes and finished trainees. The strike window is read from the
judged rounds there; there is no separate strike counter.

### Resuming from Bot settings

**League training** (`leagueExpShareTraining`) is a FireRed Bot setting, on by
default, in the web Bot settings and in the Mac app under **Bot settings →
Hunting defaults → Capture**. When it is off, no League round uses a trainee.
The full team plays, and a trainee still holding the Exp. Share gets its own item
back first.

A hold is lifted only by the owner. The checklist shows the reason and the way
out, for example: "Paused after two or more battlers fainted in one League
round at Hall of Fame entry 150. To resume, turn League training off in Bot
settings and save, then turn it on and save again." A hold recorded by the build-106 engine after a
single faint reads "Paused after a battler fainted at Hall of Fame entry 101. …";
it stays until the owner resumes, like any other hold. Both saves are needed: turning the setting back on stamps the
resume time (`leagueExpShareResumedAt`). The save reports whether the running
game received the change. The host passes it to a running FireRed session only
through an idle command slot; if another command is still unanswered, or no
session runs, the bot reads it when postgame work next starts. Until the resume
applies, the checklist says "Resume requested in Bot settings."

The hold is released at the next free field decision outside the League with no
round open, and only if the resume is newer than the hold. A hold recorded by an
earlier engine has no time: the time this engine first saw it stands in, so only
a resume made after that releases it. Round history, and with it the strike
window, is kept: after a resume, one more faint within five rounds of an earlier
one holds again, and a round without a faint does not.

The setting and its stamp belong to the FireRed game, not to one save. A resume
releases every FireRed save's holds made before it, including those in a
checkpoint restored later. Starting a new postgame checklist for a different
campaign clears League training holds and history along with the rest of that
checklist's state.

The file keeps `leagueExpShareTraining` and the stamp beside the saved
preferences, so an older host still reads the settings; an older host drops both
when it saves (the setting is then on again, and nothing is resumed). An older
engine ignores the setting and still honours any hold.

### League training

The checklist entry **Train a Pokémon with the League Exp. Share**
(`league-training`) runs League rounds of its own, but only while a real trainee
exists: a Pokémon for a missing Dex species, a battle-team member below level
100, or the current trainee until it reaches its target. Here the team means one
member per permanent-team family, the strongest (a boxed duplicate of a family
does not count). It never picks a new lowest-level party member just to have
something to train. League rounds that run anyway (the rematch and the Hall of
Fame sticker record) still do, and still train boxed family members.

The entry sits after the Hall of Fame sticker and before the Egg sticker. It is
not part of postgame completion. Its status, checked in this order:

- unknown until the party, PC and Hall of Fame count have been read at a field
  decision outside the League. A hold shows as paused (below) even before that,
  because a hunt may own the game meanwhile;
- pending, not runnable ("Starts after the first stronger League victory.")
  until the League rematch is complete;
- pending while the last round is unjudged or a lent held item is still owed;
- complete ("Off in Bot settings.") when the setting is off;
- pending, not runnable, with the "Paused after …" reason during a hold;
- pending with its goal, for example "Gloom Lv. 53 → Lv. 100", while a trainee
  is planned;
- otherwise complete, with the reason: no eligible trainee, no Exp. Share, or
  fewer than five sweep-level battlers.

Goals earlier in the checklist come first, so a pending entry names the first
earlier goal that is ready, for example "Gloom Lv. 53 → Lv. 100 · waits for
Complete the National Pokédex". League training runs when that goal is waiting
for a retry or finished.

The run reads a baseline of the Hall of Fame count, save counter and SRAM hash,
as the Hall of Fame sticker record does; if it cannot be read, it stops for
review. At the Pokémon Center a lent held item is returned first. The run never
buys League supplies or enters Lorelei's room without a composed trainee; it
stops for review with "No League trainee is ready: …" instead, and the
checklist moves on. When the round starts (the walk to Lorelei), a cycle opens
at that baseline. The verified native Hall of Fame save closes it and counts the
run, per trainee. A cycle whose round ended without a new Hall of Fame entry is
dropped once League training no longer owns the checklist, so a later League run
by another goal is never counted as training.

League training reuses the League supplies and their funding, the intermission
heals and saves, the retry backoff and both progress watchdogs. There is no
round cap, money reserve or rest period. The demand is finite, a round that
gives no experience holds, and so do faints in two of the last five rounds. Milestone saves keep priority. The entry is complete
once the trainee reaches its target and no Dex or team candidate is left. It
becomes pending again if a team member below level 100 or a new Dex level-up
source appears.

### Rotation and the returned item

The PC is out of reach inside the League rooms, so rotation happens only
between rounds. A trainee that
reaches its target (its evolution, or level 100) is marked done, and the next
candidate joins at the next Pokémon Center visit. If no candidate remains, the
full team stays.

When a trainee rotates out or the passive setup ends, it gets its item slot back
first, with the same held-item targets: the Exp. Share returns to the Bag (the
general held-item policy then places it, as other borrowed Exp. Shares return)
and the trainee is given the item it held before. A boxed former trainee visits
the party for this. If that item is no longer in the Bag, the slot stays empty,
this is recorded (`leagueExpShare.restored`), and the League continues.

## Finishing against a healing trainer

FireRed's trainer AI can spend its turn on an item (the League and the Champion
carry Full Restores). It commits that action before the player's action menu is
answered, and the item acts before any move. The observer reports each battler's
chosen action (`battle.chosenActions`). When the opponent has chosen an item, a
finishing move must knock out its full HP; a weaker, higher-PP move that only
covers the current HP is not chosen, and the normal move choice (the strongest
move) applies instead. When the opponent chose a move, or its action is
unreadable, finishing is unchanged.

## Prepare an individual in FireRed

In the Mac app, choose **Bot → Task → Train competitive EVs**. Select a Pokémon
from the current save, set all six final EV targets, and optionally require IV
ranges. The picker does not change saves or start the wireless relay. The
running game verifies the exact selected identity again before acting.

The task checks existing EVs and fixed IVs first, withdraws the individual if
needed, travels to a reachable land encounter table, prepares the lead, and
fights only opponents whose native EV yield fits the remaining spread. It
checks the recipient's EVs after combat, handles healing and PP recovery, and
saves through the game's menu before returning a completion receipt. The
request and menu target survive restart. Incidental evolution is declined.
Unexpected shinies remain protected by the normal capture-and-save workflow.

FireRed's EV storage limits are 255 per stat and 510 total. Macho Brace doubles
the holder's gain; current or cured Pokérus doubles it again. Owned vitamins are
used only when their increase, capped at 100 in that stat, fits the target.
With Pokérus, the task reserves a vitamin when its capped gain is needed to
reach an odd remaining deficit, and avoids vitamins that would make the final
spread unreachable. Each participating or Exp. Share recipient gets the
species' EV yield, rather than an XP-style
division. The task reads the selected recipient's actual result, can equip an
owned Macho Brace into an empty held-item slot, and can remove
its Macho Brace for smaller final gains, restoring the original held item before
the final save. A level-100 Pokémon cannot gain battle EVs in FireRed. An unknown
custom Enigma Berry effect is not guessed. These rules follow
[`MonGainEVs` in the game source](https://github.com/pret/pokefirered/blob/c75f352304d529f6ba92d4f74b9cf8b5c3810788/src/pokemon.c).

The task does not automatically purchase vitamins, reset EVs through another
game, breed replacements or use fishing/surfing EV routes. If no supported
route can supply an exact remaining gain, or an unwanted battle cannot be
escaped safely, it reports that condition instead of claiming completion.
Existing unwanted EVs require another individual or a separately arranged
Emerald reset: FireRed's EV-reducing berries do not perform that reset.
[Smogon's FRLG training guide](https://www.smogon.com/ingame/guides/ev_frlg)
provides the corresponding game-specific route and item guidance.

For a new competitive candidate, configure the nature, ability and IV ranges
in Farming first. **Traits → IV ranges** accepts exact values such as Attack
0–0, as well as ordinary minimums. Requirements filter native acquisition/RNG
outcomes; they cannot train IVs. Leave final leveling off until the saved
individual's EV task is complete, then request any final level/evolution setup.
Every encountered shiny is still saved even if it misses these preferences;
the EV task independently rejects a mismatched competitive individual.

A Hidden Power type can be part of the same request: typed or spoken ("catch a
timid Abra with Hidden Power Fire"), or as the farming request's `hiddenPower`
field (`{"type": "fire"}`, with an optional `minPower` from 30 to 70). FireRed
derives the type from each IV's lowest bit and the power from its second bit,
so it filters the same native outcomes as the IV ranges. The roaming Suicune
keeps only its HP IV and part of its Attack IV, so its hunt refuses a Hidden
Power type.

Champions destination presets remain separate. Completing a source-game EV
task records `onlineReady: false`; it does not establish transfer eligibility
or compliance with the destination's current format.

## Regression evidence

The mandatory corpus retains every older fixture and adds
`competitive-ev-training`. That native replay starts with the original
early-game Charmander, travels from its house to Route 1, gains exactly one
Speed EV through a normal KO, reconstructs the controller in its move menu,
and verifies the exact spread and native save. The other party member gains
no XP, and both identities remain unchanged. It does not manufacture a save
or modify the ROM.

The existing direct-training replay additionally requires persisted native XP
and full-cycle frame measurements across restart. Unit and native tests cover
different guarantees; neither qualifies a complete campaign or physical trade.
