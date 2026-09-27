# FireRed action verification

The central player, native input writer and recovery guards share responsibility
for an action. A proposed button press is not evidence that its goal succeeded.
These checks apply to the existing policies; they do not replace the campaign
planner or emulate game outcomes in software.

| Boundary | Required evidence | Response when it is missing |
| --- | --- | --- |
| Observe → execute | Same native menu, encounter, position, facing, travel mode, story prerequisites, party identities/condition, moves/PP, bag, money and relevant battle or PC state; ready input within 120 frames | Reject the stale input and resample before the sole input writer |
| Open switch picker → confirm | The originally selected Pokémon remains usable and has the same personality/OT identity, including after temporary party reordering | Reconcile its new slot; abandon the commitment if the target is unavailable |
| Confirm switch → complete | The native active battler's remapped party slot is the committed member | Retain ownership until observed activation or native rejection |
| Move → settle | Native settled position and mode following the executor's receipt | Count stationary failures; do not count battle interruption or partial movement as a blocked approach |
| Cursor → intended option | Settled native cursor after a completed directional input | After three failed deliveries, exclude that edge and try another verified route to the same option |
| Vs. Seeker approach → use | Current-map active trainers within the cartridge's seven-tile horizontal and five-tile vertical range | Recompute the approach from observed positions; templates alone cannot authorize item use |
| Double-battle move → confirm | The menu-owning battler's learned moves and cursor | Use the same acting-battler resolution as move scoring, including the second allied Pokémon |
| Repeat menu → recover | A repeated cycle without native progress, in an observed cancellable menu | Bounded unwind/replan, then a latched review stop after two unsuccessful attempts |
| Reconstruct controller | Pending movement receipt, menu observation window, consumed recovery budget and committed target | Preserve evidence; restarting does not grant another attempt |

The precondition uses a SHA-256 digest of selected native facts. Capture IDs,
unrelated RAM hashes, RNG and presentation clocks do not invalidate an action.
Only PC menus include the storage snapshot. The digest keeps this evidence
small in decision feeds and checkpoints. This is a consistency check inside the
trusted engine, not an authentication mechanism for external commands.

Both the IPC worker and the direct emulator enforce it. The Mac session supplies
a fresh observer to the direct executor; an action carrying a contract cannot
run without that reader. Native `inputReady` is also false while the bot's own
keys remain held. The central player must prove that the exact previous chord
is still owned before binding its held-key mask into the next contract. A
different mask, battle or recap invalidates this exception. This keeps the
Cycling Road brake and ordinary running continuous without accepting stray input.
Verified retained movement has a separate transition
case: only the already held directional chord, or the Cycling Road brake on an
observed slope, can continue. A changed map, position, battle or button set
invalidates it. Other transition inputs become neutral waits so a frame-owned
clock can finish the animation and request a fresh decision.
Rejection feedback is checkpointed too. If the next observation is still at the
rejected frame, the controller submits a bounded neutral interval before
replanning, after checking protected capture and stop latches. The native replay
must exercise that path itself; it cannot inject recovery inputs on its behalf.

Central-player decisions and campaign menu recovery use this contract. Native
radio input and frame-timed RNG/capture plans retain their separate transaction
and timing checks; this change does not add observation work inside those
frame-sensitive loops.

Existing legacy workflow checkpoints without personality/OT use their earlier
fingerprint fallback. New commitments record native identity. Duplicate species
with matching stats cannot satisfy a new commitment by resemblance alone.

Movement evidence is consumed by a subsequent observation, not by a neutral
transition input. A restored pending receipt is checked against the current
native state before an exclusion is learned. Navigation exclusions remain
planner evidence; cartridge collision data is never modified. Existing changed
blocker, story, map reentry and explicit manual handoff rules still apply.

Menu recovery retains up to 64 hashed observations. Short cycles keep the
existing 32-observation trigger; cycles of 9–16 steps require four observed
repetitions. Unready animation does not spend this budget. Native progress can
start a new transaction window; a process restart cannot. The existing campaign
watchdog still covers nonperiodic stalls and unsupported plans. It is not
automatically re-armed by these changes.

The live campaign and qualification monitor share a five-minute default
no-progress deadline, measured in active wall time. Emulation speed does not
multiply that budget. Pauses and offline time do not count; reconstruction
preserves consumed time. Older checkpoints adopt the new default, including
an immediate stop if their retained idle time already exceeds five minutes.
An explicit reviewed retry retains that stop's evidence and existing limits.
The legacy blocked-clock accounting repair still interprets old records using
their historical deadline; it does not set the current running deadline.

Overworld Yes/No menus participate in the shorter repeated-action detector.
They can request bounded replanning without guessing an answer or cancelling
an unknown prompt. The existing two-attempt limit and persisted observation
window apply. Save and link-trade choices keep their separate protections.
Fly cannot open a new menu while any field modal or script owns control;
the existing dialogue/choice policy finishes first. This guard applies on all
maps and preserves the selected travel destination and interrupted task.

Generic cancellation is excluded during saves, radio/in-game trades, scripted
party pickers, and forced faint replacements. Existing protected shiny capture
handling and explicit reviewed-retry limits remain authoritative. These guards
do not approve release, overwrite, retry or cancellation of a protected Pokémon.

Battle move navigation uses the cartridge's learned-move layout. With three
moves, the top-right cursor must travel left then down to reach the bottom-left
move; the empty fourth slot cannot be crossed. Exhausted PP does not remove a
learned move from this layout. Invalid move targets produce no confirmation.

Directional recovery supports battle action/move menus and the wrapping start
menu. It records completed input receipts, waits for settled native feedback,
and excludes a direction after three failures at that cursor. A shortest valid
alternative retains the original move, command or menu target. Every recovery
input passes through the same fresh observation contract as ordinary input.
Reaching the requested cursor is recorded separately from finishing the task.
This does not choose random buttons, change the objective or reset a watchdog.

Failed edges, pending receipts and a bounded history survive controller restart
and menu reopening. Real party, bag, story, position or battle progress begins
a new evidence window. No executed frames, stale rejected commands and unready
animation do not count as failed inputs. When all supported routes are exhausted,
the existing unwind/replan budget and review stop remain authoritative. Unknown
menus and save/trade surfaces are excluded from this alternative routing.

## Qualification

`menu-navigation.test.js` checks every pair of accessible slots in one-, two-,
three- and four-move menus, failed directional delivery, wrapping start menus,
restarts, animation, menu reopening, stale contracts and finite exhaustion.
The required `campaign-menu-route-recovery` native case preserves the stopped
Goldeen encounter and original campaign controller. It selects Cut, injects
three missing Right inputs below the guarded executor, verifies a different
route to Bag, catches that same Goldeen and hands off to the next campaign
objective. Controller restarts occur during move selection, pending feedback
and capture. A native state/SRAM checkpoint reload verifies the caught identity
and retained controller state. This proves emulator checkpoint persistence;
it does not claim an additional in-game save. No ROM or gameplay memory is
modified to simulate the fault or catch.

`action-contracts.test.js` exercises stale input at the worker boundary, every
restart cut within the original 32-observation loop window, protected menus,
and movement receipts interrupted before their settled observation.
`generated-action-workflows.test.js` uses 64 repeatable fault schedules with
duplicate party members and reordered slots. It checks commitment, selection,
confirmation and handoff using independent expected identities and buttons.
Longer menu cycles receive generated transition/restart schedules too.
Failures print the seed and event trace; individual cases can be selected with
Node's `--test-name-pattern`. These bounded generators do not claim exhaustive
coverage of all game states or automatic counterexample shrinking.

Three required native cases, `campaign-menu-interruptions`,
`campaign-navigation-interruptions` and `campaign-battle-interruptions`, use the
privately preserved teaching, Victory Road and active campaign saves.
Each runs at configured 1×, 5× and 10× with seeded controller
reconstruction before decisions and after execution, plus pause/resume. Inputs
pass through the production worker precondition and autonomous executor. Each
variant must complete the native transaction, resume the campaign, preserve
the team/run identity and keep the original SRAM. Teaching also verifies exact
move recipients, unchanged XP, other moves and bag quantities.
The battle case must observe combat, earn native XP, close all menus and retain
its League objective without any reviewed retry.

These replays use a virtual presentation clock to make them repeatable. They
exercise the speed configurations but are not real-time throughput benchmarks.
Each speed starts in a separate emulator from the preserved checkpoint. Within
a variant there is no game rewind or gameplay-memory editing. The mandatory
original-ROM comparison and all older regression cases still run in the release
gate; generated tests supplement that corpus.

## Clean campaign evidence

The current campaign has received mid-run repairs. Its completion cannot qualify
as an uninterrupted run of this version. Preserve it and its intervention log.
Subsequent qualification should pin engine, core and ROM identities at the
beginning and cover all three starters with different team seeds. Each run must
obtain the eight badges, finish the League with its committed team, complete the
native Hall of Fame save and reach the postgame field without corrective edits,
manual input, policy retries or version changes. Record those outcomes and wall
time separately from this regression receipt. Full campaigns and physical radio
trades remain separate evidence; neither is implied by unit or replay success.
