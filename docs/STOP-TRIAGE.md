# Stop triage: why the bot stopped

When a game owner is **blocked** or **recovering**, the host explains the stop in plain
language and, only when code proves it safe, offers one supported fix. The triage reads;
it never changes a stop, a save or a gameplay input, and nothing runs until the owner taps.

Code: `pokemon_suite/pokemon_stop_triage.py`. Tests: `tests/test_stop_triage.py`,
`tests/stop-triage-card.test.mjs`, Swift `StopTriageTests` and `ActivityLayoutTests`.

## Inputs (read-only)

- The live status (`bot`, `mission`, `recovery`, `decision`, `decisionFeed`, `mode`,
  `callback2`, `localEvolution`, `nativeTrade`, `control`, the engine version).
- `<game>/recovery-report.json`, only when it was written for this session and frame.
- The active hunt's retained checkpoint (`hunts/<id>/saves/current.json`, or
  `native-radio/saves/current.json`), only when its frame and hunt match the live owner.
- `recovery.json` history and `partner-availability.json`.

Symbolic links, non-regular and oversized files are ignored.

## Output

`GET /api/pokemon-suite/stop-triage?game=firered` returns `{ok, triage}`; `triage` is null
unless the owner is stopped or recovering:

```
{schema: "pokemon-suite/stop-triage/v1", bucket, family, title, explanation, evidence[],
 fixedIn?, regression?, retained?, case?, stop: {reason, state, phase, map, mode, frame},
 suggestedAction: {action, safe, why, label?, confirm?, playerTask?, token?}, laya?}
```

- `bucket`: `transient-retry` (automatic recovery or a retry clears it), `known-bug-family`
  (a diagnosed bug with a shipped or pending fix), `needs-code-fix` (a new bug, or a known
  family on an engine that already has its fix — `regression: true`), `needs-owner`.
- `action`: `resume`, `postgame-checklist`, `retry-hunt`, `archive-hunt` or `none`.
- The sessions payload carries a compact copy (`session.triage`) for stopped or recovering
  owners; it never consults Laya. A running checklist that only carries a released hunt's
  old recovery record gets no card.

Registered families (each from a diagnosed live stop, with the build that fixed it):
`party-menu-move-prompt` (108), `league-intermission-save` (106), `mt-ember-ruby-path` (105),
`evolution-step-source-lookup` (103), `released-hunt-holds-checklist` (102),
`league-menu-settle` (99), `cycling-road-pull` (95), `victory-road-first-floor` (92).
Generic families cover navigation cycles, missing routes, repeated menus, transition
deadlines, no progress, trade/partner/wireless states, supplies and protected encounters.

## One-tap fixes

Only two categories are ever `safe`:

| Suggestion | Proven conditions | Posts |
| --- | --- | --- |
| Restart the postgame checklist | The checklist's own evolution step (postgame run scope and preparation) stopped at step 0 with the step-0 stop reason; the retained checkpoint for this exact frame shows index 0, no receipts, no current fingerprint, no baseline, nothing dirty. | `player-tasks {action: "postgame"}` |
| Resume the bot | A released hunt on engine 102 or later under the postgame checklist: the hunt is blocked, unprotected, its objective deferred by the enabled checklist and not held by it, and its recovery is not running. | `player-tasks {action: "resume"}` |

Both also require: FireRed, a live owner that is `blocked` (not recovering), bot control
(not manual), no command error, no linked evolution exchange or unfinished trade, no
unsaved protected encounter, capture, Rare Candy supply, acquisition or pending save.
The engine's own guards on those commands still apply.

The client shows what the fix will do and posts it with the suggestion's `token`
(`player-tasks {game, action, triage}`). The host re-derives the triage from fresh state and
answers **409** unless it is still the same safe action with the same token. Without a
`triage` field, `player-tasks` behaves exactly as before.

Asking the bot "why did it stop" / "what happened" answers from the same card (the sessions
payload's compact triage). When the suggestion is `safe`, the interpret result also carries
`offer: {label, confirm, playerTask: {game, action, triage}}`: the body of that same
`player-tasks` call. It is never part of the goal, and committing the draft runs nothing.

## Laya (shadow only)

When `request-interpreter.json` turns Laya on (`shadow` or `on`), the shared sidecar is
asked two choice questions (bucket, action) once per distinct stop — its game, session and
the owner's stop reason (`Automatic resume-mission: X` is the same stop as X); the frame is not
part of it, because it keeps moving while the owner stays stopped. The consult always runs in
the background, started by whichever comes first: the sessions payload showing the stop or
the triage endpoint. The endpoint never waits for Laya; it answers with the rules and shows
`triage.laya` once the consult has answered. The answer is recorded in
`<data>/requests/stop-triage.ndjson` next to the rules' answer and never changes the result.
A skipped consult (Laya loading, busy or failing) and Laya off are looked at again only after
60 s, not on every poll; a missing, slow or failing model leaves only the deterministic
triage, and with Laya off nothing is scheduled.

## Labeled set

`tests/data/stop-triage-labels.jsonl` holds real stops (live recovery reports and private
live snapshots, Sept 7–24) as normalized facts with hand labels and evidence ids. The dev
split (Sept 20–24) is the rules' source; the holdout (Sept 7–19) measures the three-way
cause (transient / code bug / owner) on families the rules never registered. Rebuild it
with the private tool that wrote it; the tests enforce accuracy floors and that no
labeled stop is ever offered an unsafe one-tap fix.
