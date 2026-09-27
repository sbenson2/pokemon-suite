import { appendFileSync, statSync } from "node:fs";
import { battleDecisionState, scoreBattleMoves } from "./battle-model.js";

// Laya program L2 groundwork: an opt-in record of each final battle choice with
// the facts the battle advisor saw and its scored move options, for building a
// battle-advice dataset from replays. It is off unless POKEMON_SUITE_BATTLE_TAPE
// names a file, and it never changes or delays a decision.
export const BATTLE_TAPE_SCHEMA = "pokemon-suite/battle-turn/v1";
export const BATTLE_TAPE_MAX_BYTES = 512 * 1024 * 1024;

const BATTLER_FIELDS = ["species", "level", "hp", "maxHp", "status1", "status2", "types", "ability", "item",
  "moves", "pp", "stats", "statStages"];
const PARTY_FIELDS = ["slot", "species", "level", "hp", "maxHp", "status"];
// Menu steps (fight, bag, pokemon) lead to one of these, so each choice is recorded once.
// The context says which actions were open: a normal turn, a free shift before an
// announced trainer Pokémon, a forced replacement, or picking an item's target.
// A free shift is decided at the "change Pokémon?" prompt (yes with a target, or
// no to keep); the party menu that follows a yes repeats it and is not recorded.
const CHOICES = {
  "choose-battle-move": (r) => ({ kind: "move", moveId: r.targetMoveId, moveSlot: r.targetMoveSlot }),
  "choose-menu-option": (r, context) => context !== "shift" ? null
    : r.targetOption === "yes" ? { kind: "switch", partySlot: r.targetPartySlot, species: r.targetSpecies }
      : r.targetOption === "no" ? { kind: "keep" } : null,
  "choose-party-member": (r, context) => context === "item-target"
    ? { kind: "item-target", partySlot: r.targetPartySlot }
    : context === "shift" ? null
      : { kind: "switch", partySlot: r.targetPartySlot, species: r.targetSpecies },
  "retain-active-pokemon": (r, context) => context === "shift" ? { kind: "keep" } : null,
  "choose-bag-item": (r) => ({ kind: "item", itemId: r.targetItemId }),
  "choose-battle-command": (r) => r.targetCommand === "run" ? { kind: "run" } : null,
};

function decisionContext(state, ui) {
  if (ui.party && ui.party.itemId != null) return "item-target";
  if (!(Number(state.player?.hp) > 0)) return "forced";
  if ((ui.party || ui.choiceMenu) && state.announcedOpponentName) return "shift";
  return "turn";
}

const pick = (value, fields) => value
  ? Object.fromEntries(fields.filter((field) => value[field] !== undefined).map((field) => [field, value[field]]))
  : null;

/** The tape record for one decision, or null when it is not a final battle choice. */
export function battleTurnRecord({ observation, decision, mechanics }) {
  if (observation?.emulator?.mode !== "battle") return null;
  const recommendation = decision?.winner?.recommendation;
  if (!recommendation || !CHOICES[recommendation.kind]) return null;
  const memory = observation.playerMemory ?? {};
  const ui = memory.ui ?? {};
  const state = battleDecisionState(memory, ui);
  if (!state?.player) return null;
  const context = decisionContext(state, ui);
  const choice = CHOICES[recommendation.kind](recommendation, context);
  if (!choice) return null;
  let options = null;
  try {
    options = scoreBattleMoves({ mechanics, player: state.player, opponent: state.opponent,
      weather: state.player.battleWeather })
      .map(({ moveId, moveSlot, effectiveness, score }) => ({ moveId, moveSlot, effectiveness, score }));
  } catch { options = null; }
  return {
    schema: BATTLE_TAPE_SCHEMA,
    frame: observation.frame,
    map: memory.map?.id ?? null,
    battleTypeFlags: memory.battleTypeFlags ?? null,
    turn: memory.battle?.turn ?? null,
    context,
    announcedOpponent: state.announcedOpponentName ?? null,
    player: pick(state.player, BATTLER_FIELDS),
    playerPartySlot: state.playerPartySlot ?? null,
    opponents: (state.opponents ?? []).map((opponent) => pick(opponent, BATTLER_FIELDS)),
    party: (memory.trainer?.party ?? []).map((member) => pick(member, PARTY_FIELDS)),
    options,
    choice: { ...choice, objective: recommendation.objective ?? null },
    advisor: decision.winner?.advisor ?? null,
    reason: decision.reason ?? null,
  };
}

/** Appends records as JSON lines; skips a repeat of the same choice in the same state and stops at maxBytes. */
export function createBattleTape(path, { maxBytes = BATTLE_TAPE_MAX_BYTES } = {}) {
  let last = null, written = null, closed = false;
  return (record) => {
    if (!record || closed) return;
    const key = JSON.stringify({ ...record, frame: null });
    if (key === last) return;
    last = key;
    if (written === null) {
      try { written = statSync(path).size; } catch { written = 0; }
    }
    const line = written >= maxBytes
      ? JSON.stringify({ schema: BATTLE_TAPE_SCHEMA, truncated: true, frame: record.frame, maxBytes }) + "\n"
      : JSON.stringify(record) + "\n";
    closed = written >= maxBytes;
    appendFileSync(path, line);
    written += Buffer.byteLength(line);
  };
}

export function battleTapeFromEnvironment(environment = process.env) {
  const path = environment?.POKEMON_SUITE_BATTLE_TAPE;
  return path ? createBattleTape(path) : null;
}

/** Records one decision; a failure is contained so the decision is never affected. */
export function recordBattleTurn(tape, observation, decision, mechanics) {
  try {
    const record = battleTurnRecord({ observation, decision, mechanics });
    if (record) tape(record);
  } catch {
    // The tape is evidence only.
  }
}
