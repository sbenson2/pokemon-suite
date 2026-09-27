# Bot recovery boundaries

This audit completes the six recommendations recorded in the September 18 bot
reliability research. It covers the existing FireRed postgame owner and its
handoffs; it does not qualify every Pokémon goal or replace cartridge policies.

Repeated manual saves no longer count as new semantic objective progress. A
Tower lobby/exterior loop could previously save at every destination change and
keep its deadline alive indefinitely. The retained supervisor now requires
changes to quest, collection, battle preparation or native record evidence;
League entries and Egg hatch counters are meaningful progress. Pending save
transactions keep their existing verification and protected recovery boundary.

## Follow-up: maintenance and ineffective actions

The build-84 live run exposed a missing case in the original matrix: an
ownerless restocking task repeatedly attempted Strength against a hidden
Victory Road boulder. Its navigation advice existed, but its inputs had no
effect. Build 85 adds the following coverage to the retained suite:

| Same-pattern scan | Result and verification |
| --- | --- |
| Restocking, center healing, item treatment and maintenance saves | The controller supplies a persistent maintenance owner when no acquisition, evolution, player request, prerequisite or agenda owner exists. Deliberate dependency waits remain eligible for later retry without consuming the maintenance deadline. A failed alternative lookup ends in an explicit block; it cannot reset the timer indefinitely. Controller tests cover looping travel, restart and an unfinished save. |
| Executable field advice with no result | Movement, object interaction, field moves and boulder pushing share a 30-active-second result deadline and two retries. Changing advice or frame/script counters does not renew it. Observed movement/facing, persistent state changes and actual interactions allow normal progress. |
| Incidental progress during maintenance/funding | Walking friendship and battle XP do not reset restocking/healing/funding deadlines. Training and evolution retain their existing experience-based progress. |
| Puzzle traversal after the campaign ends | The planner watches Victory Road puzzle flags and variables even with an empty story campaign. Hidden boulders cannot be operated at their template positions. Existing object-route filters and execution feedback were checked; the new result deadline also covers a policy that fails to consume an exclusion. |
| Retained native failure | The exact `(34,19)` checkpoint first verifies a bounded failure when action effects are withheld, then traverses Victory Road, restarts on the route and during purchase, buys the missing supplies, saves and cold-continues the verified inventory and Pokémon. |

The native purchase target is an absolute stock quantity: this checkpoint has
three Ultra Balls and needs one more plus one Full Heal, costing ₽1,800.
This scan is specific to the shared ownership/action-result failure pattern;
it is not a claim that every route has been exhaustively tested.

## Research coverage

| Recommendation | Implementation and evidence |
| --- | --- |
| Validate routes and choose alternatives | Existing route metrics and world graph; same-map gate fallback; persisted income candidate failures; untried reachable alternatives rank ahead of failed candidates after cooldown; recharge prefers a clear circuit over a longer grass path. Campaign planner tests, funding native replay. |
| Distinguish navigation outcomes | Action, arrived, temporary interaction, unsupported; target and reason supplied to owner. Planner/advisor and watchdog tests. |
| Bound retries under the actual owner | Navigation: two retries, 30 seconds of active waiting. Semantic task progress: five active minutes. Pending recovery: 120 active seconds to finish the current interaction, then verified suspension save: 60 active seconds. All clocks persist through replanning/restart and cap the first sample after a pause. |
| Preserve partial acquisitions before yielding | Verified debit/credit and identity checks; normal in-game save, receipt, deferred original request. Suspended acquisitions and deferred evolution sources also survive agenda-only hunt continuation. |
| Report useful health | Running/recovering/blocked/dependency follows the owner; pending boundary reports reason and remaining budget. Heartbeat/frame advancement does not prove task progress. Existing connection freshness remains separate. |
| Test combinations, not only happy paths | Unit failures before fixes; retained funding, rejected-hunt and mid-battle timeout replays; complete exact-source gate including original cases and mandatory ROM integrity. |

## State/transition audit

| Boundary | On no progress or interruption | Restart / terminal behavior | Verification |
| --- | --- | --- | --- |
| Free overworld, route unavailable | Retry observation, reject candidate, choose another supported route or defer clean task | Same retry budget; third same-context agenda failure requires relevant state change | Navigation, income and agenda regressions; Route15 gate replay |
| Movement loop, recharge/activation without payout | Semantic timeout; movement, battery cycling and incidental friendship/XP do not extend a currency task | Failed funding candidate retained; clear recharge circuit preferred | Currency-progress and grass-circuit tests; retained native battle/funding replay |
| Ordinary wild/trainer battle | Existing battle policy finishes encounter under a pending recovery deadline | Restart retains deadline and owner; safe overworld triggers save/defer; expiry retains checkpoint and reports block | Native mid-battle timeout, restart, suspension, cold Continue and resumed funding; boundary clock tests |
| Shiny, unreadable or protected capture | Existing capture policy and identity guards remain authoritative; no reset, discard or forced escape added | Policy safety failure or exhausted recovery deadline blocks with ownership intact | Existing capture safety/recovery tests, static legendary and roamer native cases |
| Dialogue, menu or transition | Existing owner drains its interaction; timeout remains pending instead of aborting merely because saving is temporarily unavailable | Unknown/stuck interaction reaches explicit deadline; no unbounded transition exemption | Boundary clock/restart tests; original menu, dialogue and navigation interruption replays |
| Coin debit/credit in flight | Finish exact purchased batch and dialogue; do not begin a second purchase during recovery | Mismatched balances stop with ownership retained | Native-acquisition debit, mismatch, restart and yield-request tests; original prize replay |
| Slots in flight | Finish the paid round/payout, then exit through the existing confirmation | Never place a new bet after the recovery request; deadline remains bounded | Slot exit and paid-round unit tests; original coin-cap coverage |
| Prize received / evolution committed | Existing identity and native-save receipt policies finish the transaction | Cannot convert an unverified received Pokémon into a clean deferred task | Acquisition and evolution identity/save tests; native evolution/prize cases |
| Native save / quest milestone | Continue normal save policy within pending boundary deadline | No receipt means no ownership release; suspension has its own retained 60-second deadline | Milestone timeout/restart and suspension timeout/mismatch tests; native cold Continue |
| Automatic hunt start rejected | Clean matching agenda owner records rejection and selects other work | User requests and protected work remain owned; failed automatic request is not silently completed | Rejected-hunt native restart and unit guards |
| Successful hunt handoff | Shared agenda retains suspended acquisition IDs and reserved evolution sources | New controller cannot replace them with duplicate requests | Agenda-only continuation unit tests; native original-request resume |
| User pause / process restart | Preserve checkpoint and pending recovery; no uncontrolled input during pause | Bounded active-time accounting; cannot renew lease by restarting planner | Boundary clock, navigation, recovery ledger and worker-resume tests |
| External partner dependency / native trade | Existing partner owner and exchange protocol retain the reservation; local link heartbeat detects loss | No new abandon/rollback path; missing partner is an explicit dependency, accepted exchanges retain save/exit handshake requirements | Existing local-link disconnect, reservation, trade continuation tests and automatic round-trip native replay |

## Progress definition

Ordinary tasks retain their cartridge evidence, including verified saves.
Currency tasks count money, coins, inventory and owned species; incidental saves,
script variables, party reordering and XP/friendship cannot renew their deadline;
training/evolution tasks retain those meaningful signals. Recharge counters and
frame ticks never count as completed funding. A pending recovery cannot be
cancelled simply by seeing a new progress signature: it must reach a safe
boundary or complete its owned transaction.

A breeding owner waiting for its Egg also counts the Day Care's native Egg
rolls: one per 256 daycare steps while no Egg is held (pokefirered
`TryProduceOrHatchEgg`). A same-trainer pair of different species succeeds 20%
of the time, so a long walk without an Egg is normal (live hatch 113 needed 19
rolls). Only the owning acquisition receives this credit, and only for 64 rolls
(0.8^64 ≈ 6e-7 at the lowest compatibility). After that the normal timeout and
120-second boundary apply, and the stop names the cause: "The Day Care produced
no Egg in N rolls." A walk that stops, steps taken while an Egg is pending, and
rolls after the Egg is received (the parents still wait to be withdrawn) earn
no credit.

An engine update can watch more flags or variables; the Dunsparce Tunnel fix
added VAR_NATIONAL_DEX. The first reading of a newly watched value is a
baseline, not progress, so an update cannot renew a retained budget. The
campaign supervisor records the story values it has observed (older checkpoints
derive them from their achievements). The postgame watchdog records the story
ids its evidence covered: when an observation adds ids, a state already seen
under the previous ids is not new. Postgame watchdogs saved before the ids were
recorded covered all of them except VAR_NATIONAL_DEX. A later change of a new
value is progress. A breeding owner's first reading of its own roll count is its
native wait, not a watch change, and does count.

## Current regression checkpoint

The September 18 review stop is a partial Scyther prize (2,520 coins, ₽3,563)
in a normal Oddish battle on Route15. The old controller stopped before the
battle policy could return to the field. The new replay starts at that exact
checkpoint, restarts during the pending battle and save, cold-continues the
saved currency and Pokémon, then resumes the original request and requires
actual trainer income. Private save files are not shipped.

The legacy Snorlax current-save executor remains unsupported; a rejected
automatic start yields with bounded failure history. Browser layout checks need
Chromium. Passing this matrix is scoped evidence, not a claim that every future
ROM state or supported goal is stall-free.


## Coordinated funding and planner ownership

Funding retains a trainer area and a capable battler identity through travel,
recharge, activation, battle and controller restart. Unrelated training cannot
replace that battler. The commitment is released after observed battle income,
a changed traversal capability or a recorded failure. Fresh NPC and route evidence
still validates the next action. Once committed, selection evaluates that area
instead of reranking the world on every walking step.

Failed funding candidates retain attempts and cooldowns across map changes and
transient flags. Older map-keyed failure records migrate without losing attempts.
A clean funding timeout first records the failed candidate and tries a different
executable route under the same parent. Partial purchases retain the existing
save-before-suspension requirement. Exhausted alternatives reach the existing
bounded deferral or review boundary. Permanent agenda failure context likewise
excludes the current map and temporary flags.

Readiness must be satisfiable. The damaging-PP reserve is capped at half the
member's actual maximum, including PP Ups: a fully restored five-PP move cannot
cause another healing trip. Actual depletion still requests recovery. Existing
HP, status, inventory basket, coin-cap, debit/credit and native-save predicates
retain their completion checks and ownership.

Postgame now uses the same supervised worker protocol as campaign planning.
The session remains the sole emulator-input owner. Planner commands and execution
feedback are serialized; acknowledged state survives worker replacement; late
decisions are cancelled by Pause. Commands that resume after a verified dependency
clear the acknowledged host wait only after success; a newer Pause or a rejected
command retains control. This includes both completed trade returns and partner
deferral, which otherwise leave a stale waiting overlay. Partner availability publication is coalesced
and does not make the host command loop wait behind a planner decision. Native
trade return acknowledgment awaits the postgame owner before releasing its pair.

The required `postgame-income-chain` case starts at the retained Route8 funding
failure and runs the actual session worker with a connected video subscriber.
It requires native trainer income, coin purchases, battle and purchase restarts,
the Scyther prize, a native save and cold Continue with the original Pokémon.
Packet timing and changing movement pictures are checked separately. The older
61 native cases remain required. These checks do not guarantee a requested 10×
emulation rate on every host or classify every long native animation as a stall.

Protected capture qualification may prove up to three throws of the selected ball, bounded by available stock, 256 timing trials and the existing trace frame limit. Roamers retain a single throw. Enemy turns occur only in isolated trials until an entire successful trace reproduces independently; the owner replays inputs from its exact protected source and saves normally. Exhaustion preserves the encounter and reports the failed boundary. The retained `protected-capture-exhaustion` native case starts at the exact shiny Articuno checkpoint that exhausted the former first-ball search and requires the same identity, native save and cold Continue.

## Retained shopping and field care

Shopping can suspend at a free, input-ready overworld boundary for needed item
or center treatment. Its optional `fieldCare.suspendedShopping` state retains
the same absolute basket and spending limit across reconstruction. Open native
menus, battles, capture receipts and saves retain their existing owners. New
baskets track observed cash decreases; old checkpoints retain their planned
cost, with medicine consumed during care added to the reserved expenditure.
Unobserved historical cash movements cannot be reconstructed from old state.

Confirmed shopping-route failures persist destination cooldowns and relevant
state requirements. Alternatives must stock every remaining item and return
route metrics from the existing navigator, then rank by transitions, local
cost and map ID. Exhausted alternatives retain the basket in
`fieldCare.deferredShopping` and save before selecting other eligible work.
Completed Sevii prerequisites cannot own maintenance. Healing, reconstruction
and repeated saves cannot renew an exhausted parent budget.

Retained center care revalidates its next navigation action at a free, input-ready,
script-complete field boundary. The global field script must have stopped, even
when the input-ready and field-lock observations already permit movement. If the
destination has no executable action, it
selects a reachable free healer while retaining the suspended basket, medicine
replacement cost, spending limit and parent watchdog. With no reachable healer,
it stops for review and retains the care owner and basket. Open transactions
keep their owner. A cave exit action alone does not prove onward reachability.
When a supply destination has a reachable nurse and at least two healthy
attackers can travel, care prefers that nurse. Isolated paralysis can wait for
that visit; low HP, fainting, poison and exhausted attacking PP still need care.

Newly observed story progress, such as a completed Victory Road switch, can
renew the five-minute progress deadline during a care detour. Its bounded
seen-state history survives reconstruction. Medicine consumption, healing,
repeated saves and revisiting a previously observed switch state cannot renew
the retained shopping budget.

An active supply basket, including one suspended for care, defers new ordinary
incidental captures until provisioning completes. While the National Dex
prerequisite still needs species below sixty caught entries, those incidental
captures remain required work and are not deferred; once that prerequisite work
is complete the deferral applies. Shinies and already-owned capture transactions
keep their protection; an empty-ball protected capture still stops. Finishing
the basket restores ordinary collection eligibility.

On Cycling Road pull tiles the owned movement chord (bicycle plus direction) is
retained across the continuous tile transitions and excused from the transition
veto, a coasting bicycle brakes, and a task waiting on the slope continues that
chord instead of releasing it. Otherwise the pull carries the character away
from the training area and the owned task stops on its active deadline.

Identity-evolution training route selection never commits to a cycling-road
pull interaction or encounter target: the slope cannot hold the standing tile a
trainer interaction needs and carries the walk off the pull tiles. The
exclusion applies only to an identity evolution that carries a training
fingerprint; campaign battle training keeps its own route choices, including
the reviewed cycling-route case.

These behavioral checks do not establish that every healer route is executable
end to end. The September 20 Route23 failure remains in the private corpus; the
complete supply chain and live rollout require the mandatory exact-source gate.

Unown hunts use the existing native encounter-search policy because the land
RNG predictor explicitly does not model Unown personality generation. The
validated chamber and requested-form capture policy still apply, together with
shiny protection, hunt limits, native saving and restart state. Other supported
land hunts keep their timing planner. Before a direct timing plan, a readable
field observation retires any escaped ordinary encounter identity; a retained
protected encounter or blocked safety decision prevents planning.

## Limit-cycle exclusions

A forced-movement pull can carry the character away from a one-tile approach
lease and reverse the walk without failing any single move, which previously
surfaced only at the 120-second recovery deadline. `engine/firered/src/player/limit-cycle.js`
records settled field positions and, when a small tile set repeats with opposite
travel directions on one map, adds bounded tile exclusions to the observation's
`navigationExclusions`. Routing then chooses another approach or another
training target on the next decision. Detection is deterministic, checkpointed
with the central player and cleared by a manual resume; it never changes a
gameplay deadline.
