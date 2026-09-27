# FireRed pacing and campaign benchmarks

Solo FireRed automation requests up to 10× native speed. The executor retains
every cartridge frame and every approved input lease. It wakes between display
ticks, bounds each work slice to 8 ms, and lowers the target when measured frame
work leaves insufficient processor headroom. It cannot guarantee 10× end-to-end:
observation, planning, save writes and host load also consume real time.

Manual play and radio trades use native pacing. Paired emulator exchanges retain
their separately qualified clock. Emerald and Crystal keep their existing
default. A timing change cannot resume a paused controller, clear a safety stop,
alter RNG state, edit game memory or skip an input boundary. Video delivery keeps
one in-flight frame and the newest pending frame for each viewer; audio already
uses bounded native-tempo windows.

Campaign checkpoints retain `metadata.benchmark`. Session status exposes
`benchmark`, `performance`, and requested/effective/measured speed in `control`.
The final `campaign-report.json` includes the benchmark, also written separately
as `campaign-benchmark.json`. These files stay in the local game directory.

The benchmark distinguishes campaign active time, wall time since recording
began, emulated frames, and the cartridge's own playtime and counters. It breaks
recorded time down by activity, task purpose and story objective. First-observed
objective timestamps are observation milestones, not proof of completion.
Planner round trips, worker computation, snapshot preparation, input execution,
observation and checkpoint costs are measured separately. Worker computation is
part of its round trip; emulator controller work includes cartridge work. These
overlapping values must not be summed as independent time categories.

Battle, training and navigation diagnostics accompany the timing report. They
retain move prerequisites and PP, type effectiveness, model utility rankings,
the active and preferred party matchups, incoming-damage estimates, recovery
items, switch/run legality, and the advisor's actual constraints and evidence.
An apparently stronger damaging move does not make a support, recovery or
training choice incorrect. Review signals identify conditions needing inspection;
they neither change decisions nor certify the strategy as optimal.

Selections are intentions. Confirmed move attempts require native PP consumption
and last-move evidence; this does not establish that the move landed. Swaps use
native battler-to-party identity, so a party-menu permutation or changing actors
in doubles is not a swap. Only active battlers in the current battle format count.
Item consumption requires the selected item to decrease in the native bag.
XP, levels, fainting and EV changes follow Pokemon identity across party slots.
Training rates include the whole observed cycle, including travel and healing,
and distinguish the assigned trainee's XP from the team's total gain. Partial
battles and uncertain outcomes are labeled explicitly.

Navigation records guarded route completions, stalls, divergence, boundary
handoffs, observed native steps, map changes and revisited sampled positions.
Training revisits are counted separately. Planned distance is the supplied
route's tile distance, not a claim of the globally shortest path. Observations
do not visit every tile, and revisits alone are not proof of a navigation bug.
Hall of Fame credits and quest-log playback are excluded from navigation.
Measurement revision 2 corrects menu permutations and credits map tours;
restored revision 1 aggregates remain labeled revision 1 and cannot be corrected
without their original observations.

Detailed events are appended to `campaign-diagnostics-<run-id>.jsonl` in the
owning game's local directory. Events include an ID, frame and session owner;
checkpoint recovery can repeat an event, so consumers should deduplicate by
owner and event ID. The checkpoint retains aggregates and recent history. Live
status includes a smaller recent window to limit mobile bandwidth. The archive
queue is bounded; dropped events and write/measurement errors are reported.
Diagnostic failures cannot grant input or dismiss a campaign safety stop.

Engine 59 also keys medicine selections by the observed bag quantity. Earlier
reports can undercount repeated uses of the same item outside battle when the
item and bag position remain unchanged. Do not retroactively treat those event
totals as complete; compare preserved native bag snapshots when available.

League review added shared tactical checks. A super-effective reserve must still
improve matchup utility, and a voluntary switch cannot knowingly take a lethal
incoming hit. A reliable finishing attack uses remaining HP, damage and action
order; it does not override captures, training participation, forced actions or
committed medicine. Unknown speed, confusion, paralysis, priority, Quick Claw,
Focus Band and Substitute prevent unsafe finishing shortcuts. Among sufficient
accurate attacks, remaining PP helps preserve scarce coverage. Full Heal and
Full Restore also treat native confusion. Battle outcomes and timing still
depend on the cartridge's RNG; one successful replay is not a speed benchmark.

An update to an existing campaign starts a partial measurement. Its previous
active time and native counters remain a baseline; missing historical detail is
not inferred. Owner, engine and requested-speed changes begin new segments.
Offline time is excluded from active play, and pauses, stops and qualified
interventions remain in the report. Completion requires the campaign's verified
Hall of Fame native-save receipt and return to stable playable postgame.
Player-controlled frames are recorded outside automation; they cannot inflate
bot throughput or training XP. Native save counters and cartridge playtime still
describe the entire save, including manual play. An interrupted battle remains
partial instead of being credited to the bot as a completed win.

For optimization comparisons, use the same reviewed ROM/core, campaign settings,
starter and committed team seed. Compare several fresh paired runs and report
both real active time and game frames, plus failures and interventions. Faster
emulation alone reduces real time; fewer unnecessary battles, switches, menu
actions or journeys must reduce game frames as well. Change one behavior family
at a time and rerun the complete regression gate before delivery.
