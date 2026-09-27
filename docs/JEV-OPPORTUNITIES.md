# Jev opportunities (tabled)

Research note, September 21, 2026. Status: **tabled** — no dependency is
adopted. This records where TypeSafe AI's Jev could help Pokémon Suite later,
where it must not be used, and the smallest pilot worth considering.

## What Jev is

A "System One" decision model: state plus typed questions in, calibrated
answers out (choice up to 255 options, score, boolean). Roughly 70–500 ms and
US$0.042 per million input tokens with free output, no generated text, no
image input in early access, cloud API only, and vendor benchmarks that have
not been independently confirmed. It cannot hallucinate prose because it does
not write prose; it can still misclassify.

## Opportunity table

| Surface | Use | Fit | Effort | Risk / limit |
| --- | --- | --- | --- | --- |
| Pokémon request intake (`pokemon_sessions.py`, `pokemon-bot-settings.js`) | Parse a typed or dictated request ("Timid shiny Gastly, two, FireRed") into the existing structured form with choice/boolean/score answers | Strong: bounded option sets, existing forms, sub-second | Small: one client call plus a review screen | Cloud round-trip; species needs a two-level choice; never auto-start a task without confirmation |
| Offline catalog search (`ITEMS-AND-OFFLINE-POKEDEX.md`, `pokedex_database.py`) | Rank local species/items/moves/trainer rows against a natural-language query | Strong: local data, scoring output, no prose needed | Small: score candidates, keep current SQLite as the source of truth | Send catalog excerpts only; degrade to keyword search offline |
| Review-stop routing in the app and companion | Classify a retained stop and suggest an advisory next step from the engine's explicit reasons | Moderate: reasons already exist; Jev adds grouping and wording-free routing | Small: classify the existing reason payload | Advisory only; the engine and reviewed rules stay authoritative |
| Bulk knowledge labeling | Dedupe and tag world/story/mechanics references and scraped text offline | Good: cheap high-volume classification | Medium: batch harness | Provenance must stay reviewable; keep outputs in staging |
| Multi-session dashboard | Score and classify each running game for sorting and alerting | Moderate | Small | Do not let classification delay or gate the session itself |

## Where Jev must not be used

- The bot's decision loop: advisors, hunt plans, capture and safety stops,
  save or trade verification, ROM integrity. Those stay deterministic and
  gate-reviewed; an unreviewed probabilistic model cannot own them.
- Anything that writes saves or starts a live task without explicit
  confirmation.
- Frame or screenshot understanding (text-only early access).
- Core offline operation. Any use is an optional online enhancement with
  zero-data-retention requested, and ROM, save and telemetry bytes are never
  sent.

## Smallest pilot

The request-intake parser behind an explicit online toggle: build a labeled
set of typed requests, compare Jev against a keyword baseline on the same
structured form, and adopt only if it clearly wins. Success would make free
text intake dependable without changing any bot behavior.
