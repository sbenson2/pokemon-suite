# Laya in the request interpreter

Laya (Convai Innovations, Apache-2.0) is a small decision model: given a state
and typed questions (`choice`, `noul`, `score`) it returns probabilities in
one forward pass and never generates text. The request interpreter
(`pokemon_suite/pokemon_requests.py`) can consult it. With no model installed,
or with `mode` left at `off`, the interpreter is exactly the deterministic
parser.

## Runtime: a pinned sidecar, nothing in the app

- `pokemon_suite/laya_runtime.py` (host side, standard library only):
  - verifies the asset;
  - starts the sidecar with the host (a background pre-warm that never
    blocks startup), on `POST /api/pokemon-suite/requests/warm` (`{}`; the
    Mac and iPhone call it when Ask opens and when the mic is tapped, the web
    when the Ask field appears or is focused, each at most every 30 s; it
    returns at once with `laya`: `ready`, `loading`, `unavailable` or `off`),
    and otherwise on the first consult;
  - talks JSON lines over stdin/stdout.
- `pokemon_suite/laya_sidecar.py` is launched as
  `<the host's own Python> -I -S -B laya_sidecar.py --asset <folder>`.
  - It imports only the standard library until it adds the asset's pinned
    runtime folder (numpy, onnxruntime, tokenizers) to `sys.path`.
  - No torch.
  - The app bundle does not grow.
- Calls:
  - A typed request never waits for the model to load. The request that
    finds Laya not ready starts it (about 1.3–1.7 s: verify, spawn, load)
    and is answered deterministically at once.
  - A spoken request (`via: voice`) and the first request after the host
    starts wait up to 3 s for a Laya that is still loading (and start it
    when it is not running), then fall back as above. Only a Laya that can
    change the decision (`mode: on`, calibrated) is waited for. The wait is
    logged as `laya.waitMs`.
  - A ready sidecar has `timeoutMs` (default 1500) to answer each consult.
    A slower consult keeps the deterministic decision for that request, and
    its late answer is discarded by id.
  - A sidecar that leaves a request unanswered for max(5 s, 4 × timeout) is
    treated as hung: it is killed, and the next request restarts it. A late
    answer counts as an answer, so one slow consult never costs a reload.
  - The sidecar exits after `idleExitSeconds` without a request (default 600),
    which frees its memory. It also exits when the host goes away (end of
    input). A warm-up call that finds it already running sends it a blank
    line, which restarts that timer and is never answered, so the request
    the warm-up announces still finds it.
  - Closing the host waits (up to 5 s) for its start-up warm-up, then stops the
    sidecar; a boot still in progress is cancelled (it spawns nothing, or kills
    what it spawned), and a closed classifier starts no new sidecar.

## The asset is pinned like a cartridge

The asset is a folder you choose, named after its id, for example
`~/Library/Application Support/PokemonSuite/assets/laya-en-aa8c91ca-onnx-q8/`:

| Path | Contents |
|---|---|
| `asset.json` | Id, Python tag (`cp313`), sources. Deterministic, pinned. |
| `pins.sha256` | `<sha256>  <path>` for every other file. |
| `model/` | `laya.onnx` and `laya.onnx.data` (8-bit weight-only), `laya_config.json`, `tokenizer/`. |
| `runtime/site-packages/` | numpy 2.5.3, onnxruntime 1.30.0 and tokenizers 0.23.2 wheels (CPython 3.13, macOS arm64), unpacked as-is. |

`LAYA_ASSETS` in `laya_runtime.py` is the reviewed identity: every model
file's sha256 plus a digest of the whole runtime tree. Before every sidecar
start the host checks:

- `pins.sha256` equals a reviewed entry. A local pins file cannot approve
  other weights.
- Every file on disk is pinned. There are no symlinks and no extra files, so a
  dropped-in `sitecustomize.py`, `.pth` or `.pyc` is refused.
- Every file matches its sha256.
- The runtime was built for the host's Python.

Any failure means Laya is unavailable; the reason appears under `laya.skipped`
in the interpret result. The weights never enter `release/manifest.json`.

The asset is built outside this repository (the build script is not part of the public source yet):

1. Download the fp32 ONNX export `receptron/laya-onnx@68f27dfe` of
   `convaiinnovations/laya@aa8c91ca` and check it against its Hugging Face
   sha256.
2. Quantize it: onnxruntime MatMulNBits, 8-bit, block 32, symmetric. This step
   is byte-reproducible.
3. Download the three wheels and check their sha256.
4. Write the pins, verify the folder, and run a sidecar smoke test with the
   app's Python.

## Configuration

Put this in `request-interpreter.json` in the service data folder:

```json
{"laya": {"asset": "~/Library/Application Support/PokemonSuite/assets/laya-en-aa8c91ca-onnx-q8",
          "mode": "off", "timeoutMs": 1500, "idleExitSeconds": 600, "threads": 4},
 "log": false}
```

`mode` takes one of three values:

- `off` (the default): not constructed; deterministic only.
- `shadow`: every clause is consulted, except a negated clause and one the
  code layer reads as an answer added after the fine-tune (see Laya primary),
  and the answers are reported under `laya` in the interpret result, and in the opt-in request log when `log` is
  `true`. A decision never changes. Use this mode to collect data for
  fine-tuning. It costs about 0.3–0.5 s per clause on the M1.
- `on`: the calibrated combination below. It applies only to an asset with an
  entry in `LAYA_CALIBRATIONS`; an uncalibrated asset is treated as `shadow`.

The config is read when the request service starts. Restart the service to
apply a change.

## Request log (`log: true`)

`requests/requests.ndjson` in the service data folder stays on this Mac. It
rotates at 5 MB to `requests.ndjson.1`. It holds two kinds of row:

- **Interpret rows** (no `event` field) record the text, how it arrived (`via`),
  the decision and `laya`. They also carry the `draftId`, any clarification
  `answers` sent with the request, and `client`. The client is an 8-character
  hash of the asking app's User-Agent (or the companion relay's Origin), used
  only to tell rephrases apart.
- **Outcome rows** carry `event`, `draftId` and `afterSeconds` (the time since
  that draft's interpret). They never repeat the text. The events are:
  - `committed`: the draft ran. The row has `goalId`, the `intents`,
    `applied`, `confirmed`, and any `answers` sent with the commit.
  - `commit-refused`: the Suite turned the commit down (`status`, `error`).
    The draft is still open.
  - `cancelled`: the owner pressed Cancel.
    `POST /api/pokemon-suite/requests/cancel` (`{draftId}`) drops the draft.
  - `clarified`: the owner picked a choice (`slot`, `choice`, `label`). `next`
    is the draftId of the re-interpreted request; it is absent when the answer
    came with the commit.
  - `rephrased`: the same client sent different text within 60 s of a draft
    that still needed the owner (a clarification, a Run button, or "I can't
    turn that into a bot action"). Its `next` points to the new draft, and
    `suggestion` is `true` when an offered suggestion was picked.
  - `superseded`: the same kind of replacement, but after more than 60 s, or
    with the same text resent.
  - `expired`: the draft was left waiting. `reason` is `ttl` (15 min),
    `evicted` (more than 256 drafts) or `shutdown` (the host stopped).
  - `goal`: the supervisor finished the committed goal. The row has `goalId`,
    the final `status` (`done`, `failed` or `cancelled`) and `summary`. The
    goal keeps `source.draftId`, so this row is written even after a restart.

  Answered questions need nothing more from the owner, so they get no outcome
  row.

## Combination (LayaCalibration)

Per clause, the code layer ranks the catalog intents (43: the 38 trained
intents Laya is asked about plus the five answers added after the
fine-tune, which Laya never sees). Laya may use only
the intents the code layer scored at least 0.40 ("viable"):

- **switch:** `combined = (1 - weight) * code + weight * Laya` (Laya's
  probabilities are temperature-scaled and renormalized over the viable
  intents). Another intent replaces the top one only if its own code score is
  at least 0.50 and it leads by `switch_margin`.
- **promote:** when the code layer would ask "did you mean …" (top score in
  0.40–0.50), an offered action whose Laya probability reaches `promote` is
  accepted, and the owner still confirms it. Questions and unsupported
  families are never promoted.
- **reject:** when the clause is uncertain (below 0.50) and Laya's
  "actionable" probability is below `reject`, the clause is rejected.
- **entity:** an ambiguous species is resolved when Laya's calibrated top
  probability reaches `entity_threshold`. Otherwise the owner is asked.

Invariants, which are tested with adversarial fake models on every corpus row
except the never-tuned split:

- Laya can never accept a clause that the code layer rejects.
- Laya can never pick an intent that the code layer scored below 0.40.
- A promoted clause always asks for confirmation.
- Shadow mode never changes a decision.
- A model error keeps the deterministic answer.

## G4 result

The evaluation notes are internal and not published. The zero-shot English checkpoint
did not improve the deterministic parser, so no calibration ships and the
recommended mode is `off`, or `shadow` to collect data. A fine-tuned
checkpoint (L0.6) would be exported to ONNX with the same tool, pinned as a
new reviewed asset, calibrated, and then turned `on`.

## Stop triage (shadow only)

The stop triage (`docs/STOP-TRIAGE.md`) reuses this classifier when the configuration turns
Laya on. It asks two choice questions — the stop's bucket and the supported action — in the
background, once per distinct stop (game, session and the owner's stop reason; the frame keeps
moving while the owner stays stopped, so it is not part of the stop), and logs the answer next
to the deterministic rules' (`<data>/requests/stop-triage.ndjson`). A skipped consult (Laya
loading, busy or failing) is retried after 60 s, not on every poll. The endpoint never waits
for Laya. Laya never changes a triage or offers a fix.

## Laya primary (fine-tuned model, mode `on`)

In September 2026 the owner decided to "trust laya with the code we made as fall
back". With the fine-tuned asset `laya-ml-ft-l06-0762007a-onnx-q8` and mode
`on`:

- **Laya decides:** for each clause, Laya's intent is taken when its calibrated
  probability is at least `primary` (0.98) and its "is this a request for the
  bot" probability is at least `primary_actionable` (0.90).
- **Otherwise:** the deterministic decision applies.
- **Unchanged:** the code entity layer, validators, the farming preview,
  clarifications, and confirmation of destructive steps.
- **Clauses:** the code layer splits the request before Laya reads it, at
  "then", "and <verb>" and commas. Dictation on the Mac and iPhone now adds
  punctuation (`addsPunctuation`, with up to 100 `contextualStrings`: the party,
  the hunt target, command words and FireRed places), but a run-on spoken list
  can still arrive without commas, so a clause also splits at a verb when
  every piece is a confident step on its own and reads worse joined: "heal my
  team go to cinnabar and save" is three clauses, while
  "restore my main save" and "is my team healed" stay whole. A spoken
  take-back is not a list: a run-on never splits off a cancel ("catch a
  pikachu cancel that", "never mind go to cinnabar"), a bare stop or wait,
  a question before an action ("should i heal my team go to cinnabar"), or
  anything after "actually", "no" or "wait" or before the word it needs
  ("catch a pikachu new save"); those stay one clause. Laya reads one
  clause at a time and never splits or merges them.
- **Laya's reading is confirmed:** a runnable step that exists only because
  Laya decided it (a rescue of a clause the code layer did not accept, or an
  override of one it did) carries "I read “…” as “…”. Confirm?". This also
  holds when a fold merges Laya's clause into another ("catch a pikachu, then
  trade it to level 40" becomes the catch's final level; a repeat is merged
  away) or joins two clauses because Laya read one of them. An intent the
  owner picked needs no confirmation. The web and Swift clients send the
  confirmation with the Run tap (the button reads Confirm), so this is a
  visible line, not an extra step. Overriding an accepted code decision is
  confirmed as well; that goes beyond the rescue rule and is the owner's call.
- **Entity veto:** an accepted code decision stands when Laya's intent lacks
  the entity it requires ("find a master ball" is an item, not a catch with
  no Pokémon). The pick is reported under `laya.vetoed`.
- **Decided by the code layer alone** (Laya is not asked, in any mode):
  - a negated clause ("don't catch a pikachu", "you shouldn't heal", "don't
    cancel my goal", and a bare "Don't," that dictation punctuated off its
    verb) queues nothing and says so; "don't stop until you catch a shiny
    pikachu" asks for the hunt and is not a negation. A request that ends in
    a bare "no, don't" is taken back as a whole;
  - a question-shaped clause that reads as an action ("is there a shiny
    mewtwo", "should i catch a pikachu") asks "Do you want the bot to …?";
    the yes is the confirmation, and a no queues nothing;
  - a clause that reads as one of the answers below.
- **A cancel said with anything else** ("Catch a Pikachu. Cancel that.",
  "Never mind, catch a Pikachu.") is confirmed: it cancels a goal already
  running or queued (commit applies it before the new goal starts), not a
  step of this request.
- **Hunts no executor can start** are understood but not offered to run:
  "Understood, but the bot can’t run this yet: <the farming preview's first
  limitation>". Evolution and trade routes (the first stage runs), one-time
  encounters and the Celadon Eevee (the supervisor checks the save) are still
  goals.
- **Fallback:** when Laya is loading, times out (1.5 s) or fails, the request
  is decided deterministically.
- **Answers added after the fine-tune** (`status-stop`, `status-owned`,
  `status-stats`, `status-missing`, `status-bag`: why the bot stopped, which
  Pokémon you have and where, their level, IVs and EVs, missing Pokédex
  entries, and bag counts once the save reader returns the bag; today
  `TradingLibrary.inventory` returns only the party and PC, so a bag question
  says the bag isn't readable yet and help does not offer it) are read by the
  code layer alone. The stop answer names the stop card's one-tap fix when
  code proved it safe; Ask itself shows no button (`offer` is returned for a
  client that renders it). Laya's intent question keeps exactly the 38
  trained options, text and order (`LAYA_OPTIONS`, pinned by a hash in
  `tests/test_laya_primary.py`), and a clause whose code-layer reading is one
  of these answers (score >= 0.40) is never sent to Laya. Teaching them to
  Laya needs a new asset, calibration and blind set.

Measured once on a fresh, frozen blind set (426 phrasings, never used for
tuning):

| | Intent | Nonsense accepted |
|---|---|---|
| Deterministic | 68.3% | 6/102 |
| Laya-primary | 79.8% | 8/102 |

The author runs it with those numbers. Laya is not included in the
release; without it, Ask uses the deterministic parser. The detailed
evaluation notes are internal and not published.

## Battle tape and dataset (L2 groundwork, recording only)

The battle advisor does not consult Laya. To build a battle-advice dataset,
the central player can record each final battle choice. It records:
- the facts the advisor saw: the active Pokémon, the foes, the party, types,
  stat stages and PP;
- its scored damaging moves;
- the choice itself: a move, a switch, an item or running, plus the
  advisor's objective.

The menu steps that lead to a choice are not recorded, so each choice appears
once.

- It is off unless `POKEMON_SUITE_BATTLE_TAPE` names a file. The app never sets
  it; replays and collection runs do.
- `engine/firered/src/player/battle-tape.js` appends JSON lines (schema
  `pokemon-suite/battle-turn/v1`). It skips a repeat of the same choice in the
  same state and stops with a `truncated` marker at 512 MB.
- A tape failure is contained. `engine/firered/test/battle-tape.test.js`
  checks that the central player's decision is identical with, without and
  with a failing tape.
- `scripts/laya-export-battles.mjs --mechanics <battle knowledge> --out
  rows.jsonl <tapes…>` writes one Laya row per distinct choice. Each row has a
  readable state, a `choice` question over every legal action (usable moves,
  healthy switches, and Run in wild battles) and the advisor's choice as the
  label. Item choices are counted but not exported: the tape does not record
  the bag, so an item option would reveal its own label.
- Each record names its context, and the exported options follow it:
  - `turn`: moves, switches, and Run in wild battles;
  - `shift`: a free shift before an announced trainer Pokémon, where the
    options are keep or switch, and the announced foe is in the state. It is
    recorded at the "change Pokémon?" prompt (yes with its target, or no to
    keep). The party menu after a yes is not a second choice;
  - `forced`: a replacement after a faint, switches only;
  - `item-target`: choosing who receives an item; not exported.
- The required native case `battle-tape-equivalence` replays one Gym battle
  with and without the tape. Both runs must end identically.
- Live collection is off by default. With `<runtime>/battle-tape.json`
  `{"enabled": true}`, the host starts the FireRed owner (never a partner) with
  the tape at `<runtime>/firered/battle-tape.ndjson`. The setting applies when
  the worker starts; delete the file and restart to stop.
  (`tests/test_battle_tape_launch.py`)

These labels imitate the deterministic advisor, which is only a prior.
Handoff L2 continues with outcome labels from forked savestates at
disagreements, then a recorded-only advisor. It only becomes a tie-breaker
after it passes its pilot gate.
