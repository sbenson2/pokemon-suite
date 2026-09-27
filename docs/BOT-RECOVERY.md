# Campaign recovery

The emulator owner remains the only input writer. The planning worker receives
observations and returns decisions; it owns no emulator, input lease or save.

The central player resolves an execution owner's deliberate timing wait before
recording a menu attempt. The optional `beforeAction` hook may return only a
bounded neutral wait (1–600 frames) or a stop. It runs after safety checks and
cannot override a persisted stop or submit different buttons. Deferred inputs
do not consume retry evidence; existing evidence is retained, including across
controller restoration. Unmarked neutral PC loops keep their existing limits.
Static and gift RNG timing uses this hook, so waiting at a Dojo Yes/No offer is
not counted as repeatedly trying to confirm it.

A completed campaign record is retained for history but no longer prevents
the current postgame hunt from using automatic recovery. Active campaigns keep
their own supervisor. The mission's existing ownership checks, protected-save
rules, three-attempt limit, cooldown and explicit Pause/Stop remain in force.
The required `dojo-gift-timing` native replay preserves the actual Hitmonlee
stop and its original generation anchors. Three isolated worker paths verify
automatic recovery, a recorded explicit retry, and a full timed-offer reset
with Stop and owner reconstruction during the wait. All paths must receive the
predicted shiny gift, finish its native save, verify cold Continue, preserve all
original Pokémon and the campaign record, and yield to the next command.
This extends the required corpus to 51 without removing the previous 50 cases.

The owner enforces a 30-second response deadline outside that worker. On a
worker crash or timeout it terminates the old generation, restores the last
acknowledged planning snapshot and retries the planning call. Execution feedback
is replayed against its pre-feedback snapshot; emulator inputs are never
replayed. Two worker restarts are permitted per method, objective and task.
The journal survives owner reconstruction. User Pause/Stop cancels a pending
decision and remains authoritative across worker replacement. A policy exception
is reported rather than retried as an infrastructure failure.

Local menu and movement contracts still handle missed inputs and blocked edges.
An unchanged map revisit no longer erases a failed movement edge. Changed local
blockers, story state or explicit manual handoff retain their existing
revalidation behavior.

At one minute without semantic progress, the campaign can change a known
healing or training strategy. It selects another reachable healer, trainer or
wild training map, retaining the trainee, level requirement and story objective.
Selection is checked at most once every five active seconds. No alternative is
invented when the planner cannot prove one exists. Rejected training choices
persist through menus and restarts, and are reconsidered when party identity,
species, level or moves change. Recovery permits at most three different
strategies per objective; retrying a process does not renew that budget.

Closing a menu changes recovery to `verifying`. Success requires task evidence
(the intended trainee's XP, the requested capture, a completed healing task or a campaign checkpoint)
and a stable field handoff across distinct frames. Animation frames neither
prove progress nor erase already observed evidence. An older completion of a
reused task ID is not new progress. Escort XP cannot renew an
active trainee's campaign deadline. A failed recovery retains its history and
becomes an explicit unresolved incident. The five-minute progress deadline
remains the outer bound for each qualified strategy, with lifetime elapsed time
preserved. Save, trade, protected capture, unknown modal state and user pause
cannot be cleared by task recovery.

The campaign API exposes the current recovery and planner restart journal.
Detailed records remain in the saved campaign state. Exhausted or unknown
failures preserve the current game and its view for repair; the system does not
reload earlier progress, alter game memory, skip mandatory goals or claim that
every possible state can recover automatically.

The native corpus includes a real Ditto taken from a preserved PC inventory
using ordinary inputs. It must Transform, use copied PP, win and return to the
field at 1×, 5× and 10×. At 10× a deliberately hung planning worker must restart
without changing the emulator. The alternate-strategy replay retains the
Route 21 checkpoint, injects a supervisory-clock delay, chooses a different
training target and verifies native battle progress after planner restoration.
All historical checkpoints and ROM-integrity checks remain required.
