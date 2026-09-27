# FireRed bot reconciliation — September 10, 2026

The standalone Suite includes the current FireRed campaign task and supervision
repair. Comparison with the bot development source found the eleven repaired
implementation/test files already synchronized byte for byte. Reconciliation
preserves those changes and the Suite's separate installation and save behavior.

## Included behavior

- Training commits to a particular Pokémon by original trainer ID and
  personality, with a parent objective and required level. VS Seeker responses,
  party reorder and checkpoint restoration do not silently change that trainee.
- Healing remains an active task during travel and nurse dialogue. It completes
  only after the same party members are observed with restored HP, status and
  PP. A healthy replacement cannot satisfy another member's recovery task.
- Both the live Suite controller and the qualification runner use the shared
  campaign supervisor. Fifteen active minutes without meaningful progress
  produces an explicit, save-preserving blocked result. Walking and switching
  menus alone do not count as progress.
- Checkpoints retain task identities, progress history, consumed idle time and
  recent decisions. Pauses and process downtime do not consume the budget;
  Resume does not clear a latched stall.

The implementation is in `engine/firered/src/player/campaign-tasks.js`,
`campaign-supervisor.js`, `campaign.js`, `advisors.js`, `planning-context.js`,
`campaign-episode.js`, `src/suite/campaign-run.js`, and `src/cli/run-player.js`.
The new behavioral tests and their shared fixture are included in source exports.

## Standalone integration

The standalone service resolves its worker inside `engine/firered/src/suite`.
It does not launch a controller from the old host application. The campaign
controller uses the reconciled planner and supervisor from the same engine tree.

Seven intentional differences from the bot development tree remain: the
standalone cold-save initializer, console startup, session worker, save vault,
portable radio path, and two test adaptations for the standalone import path
and atomic publication of a supervisor fixture.
These were retained rather than overwritten during source comparison.

The new RC3 archive, automatic checksum and freshly extracted candidate replace
the inconsistent RC2 release artifacts as the current distribution candidate.
Existing game profiles and running campaigns are not migrated or reset by source
reconciliation. Restarting an old owner in another application is a separate
operation; starting a Suite game uses this Suite's engine and profile.

## Verification boundary

Run `npm run test:engine` for the full imported engine suite, including the real
planner/advisor/task and Suite controller regression tests. Run the Python,
Node and browser checks from the README against a fresh extracted candidate to
verify installation, HTTP controls, ROM artwork and release reproducibility.

The source repair has native training/healing continuation evidence from the
bot development environment. This integration does not establish a new,
uninterrupted fresh-save completion or certify every random team or desktop OS.

## Temporary puzzle prerequisites — September 10 follow-up

A stopped native Suite run had remembered the first Vermilion Gym lock as
completed, although the cartridge's temporary flag was clear. The second-lock
objective therefore kept interacting with a can while its prerequisite was
closed. The progress supervisor preserved the checkpoint after its timeout.

The shared campaign planner now identifies map-local completion conditions
using FireRed's temporary flag and variable ranges, including nested conditions.
It rechecks them from stable, known cartridge state on the relevant map, even
when a saved campaign prefix says that step was previously completed. It keeps
the permanent campaign history and selects the current switch from live game
variables. A permanent completion alternative, such as both gym locks being
open or the badge having been earned, prevents unnecessary replay.

This covers Bill's teleporter prerequisite as well as Surge's first lock.
Script-reset switches with persistent variable IDs, including Victory Road,
retain explicit resettable annotations. The reset search examines reachable
candidates on the current floor so a stale switch on another floor cannot mask
the necessary repair. Optional regional training and collection wait until an
active switch sequence finishes; required healing can still take priority.

The temporary-state ranges and gym behavior were checked against the
[FireRed flag definitions](https://github.com/pret/pokefirered/blob/master/include/constants/flags.h),
[variable definitions](https://github.com/pret/pokefirered/blob/master/include/constants/vars.h),
and [Vermilion Gym scripts](https://github.com/pret/pokefirered/blob/master/data/maps/VermilionCity_Gym/scripts.inc).
The Mansion already selects its next switch action from current cartridge
state. The League's separate blackout reconciliation remains unchanged.

Regression coverage includes healing travel, checkpoint restoration, changing
switch locations, permanent completion, multiple reset floors, nested temporary
variables, missing observations, transitions, quest recap, and optional detours.
A private replay of the actual stalled checkpoint opened both locks through
ordinary controller inputs and continued to battle preparation, without editing
game memory or substituting a later save. That is recovery evidence for this
failure class, not proof of an uninterrupted fresh-save Hall of Fame run.
