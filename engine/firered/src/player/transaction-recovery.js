import { createHash } from "node:crypto";

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const pokemonProgress = (pokemon) => pokemon && Object.fromEntries(
  ["slot", "species", "level", "experience", "hp", "maxHp", "status", "status1", "status2", "moves", "pp", "heldItem"]
    .map((key) => [key, pokemon[key]]),
);

export function transactionProgressSignature(observation) {
  const memory = observation.playerMemory ?? {};
  const trainer = memory.trainer ?? {};
  return digest({
    map: memory.map?.id, position: memory.position,
    party: trainer.party?.map(pokemonProgress), bag: trainer.bag,
    storage: trainer.storage?.pokemon?.map(p => [p.box,p.slot,p.species,p.personality]),
    money: trainer.money, pokedex: trainer.pokedex,
    story: memory.storyState, vsSeeker: memory.vsSeeker,
    player: pokemonProgress(memory.battle?.player),
    opponent: pokemonProgress(memory.battle?.opponent),
  });
}

function repeating(keys) {
  if (keys.length < 32) return false;
  for (let period = 1; period <= 16; period += 1) {
    const window = Math.max(32, period * 4);
    if (keys.length < window) continue;
    const tail = keys.slice(-window);
    if (tail.every((key, index) => key === tail[index % period])) return true;
  }
  return false;
}

function partyIdentities(party) {
  if (!Array.isArray(party) || party.length < 2 || party.length > 6) return null;
  return [...party].sort((a, b) => Number(a.slot) - Number(b.slot)).map((member) =>
    JSON.stringify(Number.isSafeInteger(member.personality) && Number.isSafeInteger(member.otId)
      ? [member.otId, member.personality]
      : [member.species, member.level, member.maxHp, member.moves]),
  );
}

export function createTransactionRecovery(initialState = null) {
  let progress = initialState?.progress ?? null;
  let attempts = initialState?.attempts ?? 0;
  let blocked = initialState?.blocked ?? null;
  let unwinding = initialState?.unwinding ?? false;
  let fieldParty = initialState?.fieldParty ? structuredClone(initialState.fieldParty) : null;
  let keys = structuredClone(initialState?.keys ?? []);
  if (!Number.isSafeInteger(attempts) || attempts < 0 || attempts > 2 ||
      blocked !== null && blocked.reason !== "repeated-menu-transaction") {
    throw new TypeError("invalid transaction recovery state");
  }
  if (!Array.isArray(keys) || keys.length > 64 || keys.some(key => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) {
    throw new TypeError("invalid transaction recovery evidence");
  }
  if (fieldParty && (!Array.isArray(fieldParty.order) || fieldParty.order.length < 2 ||
      fieldParty.order.length > 6 || fieldParty.order.some(id => typeof id !== "string") ||
      typeof fieldParty.leaving !== "boolean")) {
    throw new TypeError("invalid field party recovery state");
  }
  return Object.freeze({
    blocked: () => blocked,
    observe(observation, decision) {
      if (blocked) return { action: "stop", ...blocked };
      if (observation.phase !== "stable" || observation.emulator?.inputReady === false || decision.kind === "complete") return null;
      const memory = observation.playerMemory ?? {};
      const ui = memory.ui ?? {};
      const mode = observation.emulator?.mode;
      const ordinaryParty = mode === "party" && ui.party &&
        (ui.party.menuType == null || ui.party.menuType === 0);
      const protectedMenu = Boolean(ui.saveDialog || mode === 'in-game-trade' ||
        /UNION_ROOM|TRADE|COLOSSEUM|CABLE_CLUB/.test(memory.map?.id ?? ''));
      if (ordinaryParty) {
        const order = partyIdentities(memory.trainer?.party);
        if (order) {
          const reordered = fieldParty &&
            JSON.stringify(order) !== JSON.stringify(fieldParty.order) &&
            JSON.stringify([...order].sort()) === JSON.stringify([...fieldParty.order].sort());
          fieldParty = { order, leaving: Boolean(fieldParty?.leaving || reordered) };
        }
      } else if (!ui.startMenu) {
        fieldParty = null;
      }
      // Stock FRLG leaks its two slide buffers on every field party swap.
      // Finish one reorder, then return to the field so the native heap resets.
      // Identify the actual members (including duplicate species), not slots or
      // HP changes. Never interrupt animations, battle replacements, or trades.
      if (!protectedMenu && fieldParty?.leaving &&
          (ordinaryParty && ["choose-pokemon", "selection-menu", "choose-switch-target"].includes(ui.party.stage) ||
            mode === "start-menu" && ui.startMenu)) {
        return { action: "unwind-menu", reason: "complete-field-party-reorder", attempts };
      }
      const nextProgress = transactionProgressSignature(observation);
      if (nextProgress !== progress) {
        keys = []; attempts = 0; unwinding = false; progress = nextProgress;
      }
      const inBattle = observation.emulator?.mode === "battle";
      const hasMenu = Boolean(ui.bag || ui.startMenu || ui.party || ui.battle || ui.storage ||
        !protectedMenu && mode === 'overworld' && ui.choiceMenu);
      const canCancel = !protectedMenu && Boolean(ui.bag || ui.startMenu ||
        ui.party && (ordinaryParty || inBattle && Number(memory.battle?.player?.hp) > 0) ||
        ["move", "target"].includes(ui.battle?.stage));
      keys.push(digest({ mode: observation.emulator?.mode, ui,
        recommendation: decision.winner?.recommendation, buttons: decision.action?.buttons }));
      keys = keys.slice(-64);
      if (!hasMenu) unwinding = false;
      if (hasMenu && repeating(keys)) {
        keys = [];
        if (attempts === 2) {
          blocked = { reason: "repeated-menu-transaction", attempts,
            objective: decision.winner?.recommendation?.objective ?? null,
            frame: observation.frame, map: memory.map?.id ?? null };
          return { action: "stop", ...blocked };
        }
        attempts += 1;
        unwinding = canCancel;
        return { action: canCancel ? "unwind-menu" : "replan", attempts };
      }
      return unwinding && canCancel ? { action: "unwind-menu", attempts } : null;
    },
    reset() { progress = null; attempts = 0; blocked = null; unwinding = false; keys = []; fieldParty = null; },
    // The loop window is evidence, not a process-local cache. Preserve it even
    // when an update lands one observation before recovery would have begun.
    state() { return { progress, attempts, blocked: structuredClone(blocked), unwinding, keys: [...keys],
      ...(fieldParty ? { fieldParty: structuredClone(fieldParty) } : {}) }; },
  });
}
