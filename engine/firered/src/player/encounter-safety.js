import { createEncounterTracker, encounterFingerprint } from "./encounter-tracker.js";
import { evaluateHuntTarget, validateHuntConfig } from "./hunt-config.js";
import { selectBestCaptureBall } from "./capture-balls.js";
import { maximumCredibleIncomingDamage, battleDecisionState, selectCapturePreparationMove, selectCapturePreparationSpecialist, selectCaptureHealing } from "./battle-model.js";
import { dataOf, indexed } from "./mechanics-data.js";
import { deriveBattleLegality } from "./battle-legality.js";
import {chooseSafariCapture} from './safari-capture.js';

export function knownCaptureFreeSlots(trainer) {
  if (trainer?.partyValidity !== "valid" || !Array.isArray(trainer.party)) return null;
  const partyFree = 6 - trainer.party.length;
  const counts = trainer.storage?.boxCounts;
  if (trainer.storage?.validity !== "valid" || !Array.isArray(counts) || counts.length !== 14 ||
      counts.some((count) => !Number.isInteger(count) || count < 0 || count > 30)) return partyFree > 0 ? partyFree : null;
  return partyFree + counts.reduce((sum, count) => sum + 30 - count, 0);
}

function matchingCounts(trainer, fingerprint) {
  const count = (records) => records.filter((record) => encounterFingerprint(record) === fingerprint).length;
  return { party: trainer?.partyValidity === "valid" ? count(trainer.party ?? []) : null,
    storage: trainer?.storage?.validity === "valid" ? count(trainer.storage.pokemon ?? []) : null };
}

function captureHazard(memory, mechanics) {
  const opponent = memory.battle?.opponent;
  const player = memory.battle?.player;
  if (!opponent || !player || !Array.isArray(opponent.moves) || !Array.isArray(opponent.pp)) return "unknown-battle-risk";
  const residualRisk = (Number(opponent.status1) & (8 | 16 | 128)) ||
      (Number(opponent.status2) & (7 | 0xe000 | (1 << 27) | (1 << 28))) ||
      (Number(opponent.status3) & ((1 << 2) | (1 << 5))) || (Number(memory.battle.weather) & (24 | 128));
  let usable = 0, escapeOrSelfKo = false;
  for (const [slot, moveId] of opponent.moves.entries()) {
    if (!moveId || opponent.pp[slot] === 0) continue;
    usable++;
    const move = indexed(dataOf(mechanics).moves, moveId);
    if (!move) return 'unknown-battle-risk';
    if (/EXPLOSION|SELF_DESTRUCT|TELEPORT|ROAR|RECOIL|MEMENTO|PERISH_SONG|CURSE|BELLY_DRUM|STRUGGLE/.test(move.effect ?? "")) escapeOrSelfKo=true;
  }
  if (!usable) return "opponent-struggle-risk";
  const incoming = maximumCredibleIncomingDamage({ mechanics, attacker: opponent, defender: player });
  if (incoming === null || !(Number(player.hp) > incoming * 2)) return "capture-battler-survival-unknown";
  return escapeOrSelfKo ? 'opponent-escape-or-self-ko-risk' : residualRisk ? "residual-damage-risk" : null;
}

// This guard runs before workflow reconciliation and normal policy arbitration.
// It returns semantic intentions only; the central delegator is still the mapper.
export function createEncounterSafety({ initialState = null, config = null, mechanics = {}, resumeProtectedCapture = false, captureRequirements = null } = {}) {
  const policy = config ?? validateHuntConfig(captureRequirements?.automaticShinies
    ? {observeOnly:false,onShiny:'capture'} : {});
  const state = initialState ? structuredClone(initialState) : {
    schema: "master-red/encounter-safety/v1", blocked: null, capture: null, unknownSince: null,
  };
  if (state.schema !== "master-red/encounter-safety/v1") throw new TypeError("invalid encounter safety checkpoint");
  if (resumeProtectedCapture && (!config || config.observeOnly || state.blocked !== "protected-encounter-pause" || !state.capture)) {
    throw new Error("reviewed capture resume requires a paused protected encounter and active hunting config");
  }
  let reviewedResume = resumeProtectedCapture;
  const tracker = createEncounterTracker({ initialState: initialState?.tracker });
  let lastEvent = null;
  const wait = (reason) => ({ kind: "resample", reason });
  const stop = (reason) => { state.blocked = reason; return { kind: "blocked", reason }; };
  const act = (kind, fields = {}) => ({ kind: "act", reason: "protected-capture-workflow",
    recommendation: { kind, objective: "preserve-protected-encounter", ...fields } });
  const captureSucceeded = (memory) => {
    const counts = matchingCounts(memory.trainer, state.capture.fingerprint);
    return Object.keys(counts).some((key) => counts[key] !== null && state.capture.before[key] !== null &&
      counts[key] > state.capture.before[key]);
  };
  const saveCaughtPokemon = (observation) => {
    const memory = observation.playerMemory;
    const ui = memory.ui ?? {};
    const capture = state.capture;
    if (!captureSucceeded(memory)) return stop("protected-encounter-lost-or-unverified");
    // Safari has Retire instead of Save. Preserve the capture through its normal
    // exit script, then establish the save baseline on the entrance map.
    if (captureRequirements?.safari && memory.safari?.balls > 0 && /^MAP_SAFARI_ZONE_/.test(memory.map?.id ?? '')) {
      capture.safariExit = true;
      if (observation.phase !== 'stable' || !observation.emulator.inputReady) return wait('safari-exit-transition');
      if (ui.fieldDialog) return act('acknowledge-cartridge-prompt');
      if (ui.choiceMenu) return act('choose-menu-option', {targetOption:'yes'});
      if (ui.startMenu) {
        const targetIndex=ui.startMenu.order?.indexOf('retire') ?? -1;
        return targetIndex<0 ? stop('safari-retire-menu-unavailable') : act('choose-start-menu-item',{targetItem:'retire',targetIndex});
      }
      if (ui.party || ui.bag) return act('close-menu');
      return act('open-start-menu');
    }
    if(captureRequirements?.safari && /^MAP_SAFARI_ZONE_/.test(memory.map?.id ?? '')) return wait('safari-exit-transition');
    if (!capture.save) {
      if (!Number.isSafeInteger(memory.gameStats?.savedGame) || !observation.sram?.sha256) return stop("native-save-baseline-unknown");
      capture.save = { savedGame: memory.gameStats.savedGame, sramSha256: observation.sram.sha256, map: memory.map?.id };
    }
    if (["error", "saving-error"].includes(ui.saveDialog?.stage)) return stop("native-save-failed");
    const saved = memory.saveAttemptStatus === 1 && memory.gameStats?.savedGame === capture.save.savedGame + 1 &&
      observation.sram.sha256 !== capture.save.sramSha256;
    if (saved && observation.emulator.mode === "overworld" && !ui.saveDialog && !ui.startMenu && memory.map?.id === capture.save.map) {
      capture.nativeSaveVerified = true;
      capture.savedSramSha256 = observation.sram.sha256;
      capture.savedFrame = observation.frame;
      return stop("protected-capture-saved");
    }
    if (ui.saveDialog) {
      if (["confirm-save", "confirm-overwrite"].includes(ui.saveDialog.stage)) return act("choose-menu-option", { targetOption: "yes" });
      if (ui.saveDialog.stage === "success") return saved ? act("acknowledge-cartridge-prompt") : stop("native-save-postconditions-failed");
      return wait("native-save-in-progress");
    }
    if (ui.startMenu) {
      const targetIndex = ui.startMenu.order?.indexOf("save") ?? -1;
      return targetIndex < 0 ? stop("native-save-menu-unavailable")
        : act("choose-start-menu-item", { targetItem: "save", targetIndex });
    }
    if (["awaiting-page", "awaiting-close"].includes(ui.fieldDialog?.stage)) return act("acknowledge-cartridge-prompt");
    if (observation.emulator.mode !== "overworld" || ui.bag || ui.party || ui.choiceMenu) return stop("unexpected-capture-save-menu");
    return act("open-start-menu");
  };
  return Object.freeze({
    state: () => ({ ...structuredClone(state), tracker: tracker.state(), lastEvent }),
    inspect(observation) {
      if (reviewedResume) {
        reviewedResume = false;
        const encounter = observation.playerMemory?.encounter;
        if (!observation.emulator?.inBattle || encounter?.kind !== "wild" || encounter.validity !== "valid" ||
            encounterFingerprint(encounter.pokemon) !== state.capture.fingerprint) return stop("protected-resume-context-mismatch");
        state.blocked = null;
        state.capture.reviewedResumeFrame = observation.frame;
      }
      const memory = observation.playerMemory ?? {};
      // A qualified input replay can finish a capture outside this guard.
      // Clear only the obsolete survival pause after the cartridge reports a
      // catch and the exact protected individual appears in native ownership.
      // The normal save workflow below must still establish its own proof.
      if (state.blocked === 'capture-battler-survival-unknown' &&
        captureRequirements?.optimizeCapture && !policy.observeOnly && state.capture &&
        observation.phase === 'stable' && !observation.emulator?.inBattle &&
        observation.emulator?.mode === 'overworld' && memory.battleOutcome === 7 &&
        memory.trainer?.partyValidity === 'valid' && memory.trainer?.storage?.validity === 'valid' &&
        captureSucceeded(memory)) {
        state.blocked = null;
        state.capture.caught = true;
      }
      const replacementPrompt = observation.emulator?.inBattle &&
        memory.battle?.player?.hp === 0 && memory.trainer?.usablePartyCount > 0 &&
        Boolean(memory.ui?.choiceMenu || memory.ui?.party);
      // FireRed retains inBattle through evolution and its summary move picker.
      // The picker reports mode=battle after leaving the evolution callback.
      // Recognized post-victory learning/stats pages still belong to the native
      // modal policy after training hands the evolved individual over to saving.
      const completedBattleAftermath = memory.battleOutcome === 1 &&
        Boolean(memory.ui?.moveLearning || memory.ui?.levelUp ||
          observation.emulator?.mode === 'evolution' && memory.ui?.evolution);
      if(state.blocked==='unexpected-hunt-battle-menu' && (replacementPrompt || completedBattleAftermath) &&
        !policy.observeOnly && !state.capture && memory.encounter?.kind==='wild' &&
        memory.encounter.validity==='valid' && memory.encounter.pokemon?.shiny===false &&
        tracker.state().current?.fingerprint===encounterFingerprint(memory.encounter.pokemon) &&
        evaluateHuntTarget(memory.encounter.pokemon,policy).known && !evaluateHuntTarget(memory.encounter.pokemon,policy).protected)state.blocked=null;
      // The cartridge increments runAttempts before reporting a successful
      // escape. A saved pause on that final message must finish the exit.
      if(state.blocked==='hunt-escape-budget'&&!state.capture&&!policy.observeOnly&&
        observation.emulator?.inBattle&&(memory.battleOutcome===4||Number.isInteger(memory.battle?.runAttempts)&&memory.battle.runAttempts<policy.limits.maxEscapeAttempts)&&memory.encounter?.kind==='wild'&&memory.encounter.validity==='valid'&&
        memory.encounter.pokemon?.shiny===false&&tracker.state().current?.fingerprint===encounterFingerprint(memory.encounter.pokemon)&&
        evaluateHuntTarget(memory.encounter.pokemon,policy).known&&!evaluateHuntTarget(memory.encounter.pokemon,policy).protected)state.blocked=null;
      if(state.blocked==='hunt-escape-blocked'&&captureRequirements?.fightTrappedNonTargets&&
        !policy.observeOnly&&!state.capture&&memory.encounter?.kind==='wild'&&memory.encounter.validity==='valid'&&
        memory.encounter.pokemon?.shiny===false&&evaluateHuntTarget(memory.encounter.pokemon,policy).known&&!evaluateHuntTarget(memory.encounter.pokemon,policy).protected)state.blocked=null;
      // Older optimized captures paused permanently when Thrash caused confusion.
      // Re-evaluate that exact wild identity through the guard; a changed or
      // unreadable encounter still cannot clear the saved stop.
      if(['residual-damage-risk','opponent-escape-or-self-ko-risk','capture-battler-survival-unknown'].includes(state.blocked)&&captureRequirements?.optimizeCapture&&
        !policy.observeOnly&&state.capture&&observation.emulator.inBattle&&
        memory.encounter?.kind==='wild'&&memory.encounter.validity==='valid'&&
        encounterFingerprint(memory.encounter.pokemon)===state.capture.fingerprint)state.blocked=null;
      // Older observers exposed a previous save's success callback for the two
      // frames before a new dialog initializes. Resume only that proven context,
      // with the same caught identity and unchanged baseline; never waive saving.
      if(state.blocked==='native-save-postconditions-failed'&&state.capture?.caught&&
        !observation.emulator.inBattle&&memory.ui?.saveDialog?.stage==='initializing'&&
        captureSucceeded(memory)&&memory.gameStats?.savedGame===state.capture.save?.savedGame&&
        observation.sram?.sha256===state.capture.save?.sramSha256)state.blocked=null;
      if (state.blocked) return { kind: "blocked", reason: state.blocked };
      if (memory.questLog?.playback) return wait("quest-log-playback");
      // Legacy diagnostic fixtures without the new adapter contract remain
      // readable. Real live observers always expose encounter, including null.
      if (!config && !Object.hasOwn(memory, "encounter") && !state.capture) return null;
      const tracked = tracker.observe(observation);
      lastEvent = tracked.event;
      // The old man's catching demonstration is cartridge-controlled, not a
      // capturable encounter. Never let its stale/init RAM or bag animation
      // trigger hunting decisions. Existing protected captures still fail closed.
      if (!state.capture && observation.emulator.inBattle && memory.encounter?.kind === "tutorial") {
        state.unknownSince = null;
        return wait("cartridge-catching-tutorial");
      }
      const record = memory.encounter?.pokemon;
      const evaluation = evaluateHuntTarget(record, policy);
      // An owned provisioning trip can defer new ordinary collection attempts.
      // Existing captures retain ownership, and shiny protection is unconditional.
      if (captureRequirements?.deferOrdinaryTargets && record?.shiny === false) evaluation.protected = false;
      if (!state.capture && memory.encounter?.kind === "wild" && evaluation.protected) {
        state.capture = { id: tracked.current?.id, fingerprint: encounterFingerprint(record),
          pokemon: structuredClone(record), startedFrame: observation.frame, observationId: observation.captureId,
          before: matchingCounts(memory.trainer, encounterFingerprint(record)), caught: false, nativeSaveVerified: false };
        if ((record.shiny ? policy.onShiny : policy.onTarget) === "pause") return stop("protected-encounter-pause");
      }
      if (config?.observeOnly) return stop("hunt-observe-only");
      if (state.capture) {
        if (observation.frame - state.capture.startedFrame > policy.limits.maxIdleFrames * 5) return stop("protected-capture-timeout");
        const ui = memory.ui ?? {};
        const registration = ui.pokedexRegistration?.stage === "registered-entry";
        const nickname = ui.choiceMenu && memory.battle?.scriptName === "capture-nickname-prompt";
        if (registration || nickname) state.capture.postCatch = true;
        if (memory.battleOutcome === 7 && (state.capture.postCatch || captureSucceeded(memory))) state.capture.caught = true;
        if (observation.phase !== "stable" || observation.emulator.inputReady === false) return wait("protected-encounter-transition");
        if (state.capture.caught || state.capture.postCatch) {
          if (registration) return act("acknowledge-cartridge-prompt");
          if (nickname) return act("choose-menu-option", { targetOption: captureRequirements?.nickname ? "yes" : "no" });
          if (ui.naming?.subject==='pokemon' && captureRequirements?.nickname)
            return act('enter-naming-screen-text',{subject:'pokemon',targetText:captureRequirements.nickname});
          if (observation.emulator.inBattle) {
            if (ui.battle?.stage === "message") return act("acknowledge-cartridge-prompt");
            return wait("verify-caught-pokemon");
          }
          return saveCaughtPokemon(observation);
        }
        if (!observation.emulator.inBattle) return stop("protected-encounter-lost-or-unverified");
      }
      if (observation.emulator.inBattle && memory.encounter?.kind !== "trainer" && tracked.validity !== "valid") {
        state.unknownSince ??= observation.frame;
        return observation.frame - state.unknownSince >= policy.limits.maxUnknownFrames
          ? stop("unreadable-encounter-timeout") : wait("unreadable-encounter");
      }
      state.unknownSince = null;
      if (!state.capture) {
        if (!config) return null;
        if (!observation.emulator.inBattle && tracker.state().totalEncounters >= policy.limits.maxEncounters) return stop("hunt-encounter-budget");
        if (!observation.emulator.inBattle || memory.encounter?.kind === "trainer") return null;
        if (observation.phase !== "stable" || !observation.emulator.inputReady) return wait("hunt-battle-transition");
        // Normal battle policy already understands the cartridge's forced
        // replacement prompt and selects a healthy party member. Capture guards
        // above still own every shiny and requested encounter.
        if(replacementPrompt)return null;
        if(completedBattleAftermath && record?.shiny===false && evaluation.known && !evaluation.protected)return null;
        if(captureRequirements?.fightTrainingNonTargets && record?.shiny===false && evaluation.known)return null;
        if (memory.ui?.battle?.stage === 'message') return act('acknowledge-cartridge-prompt', {objective:'leave-non-target-encounter'});
        if (Number(memory.battle?.runAttempts) >= policy.limits.maxEscapeAttempts) return stop("hunt-escape-budget");
        const legality = deriveBattleLegality({ battle: memory.battle, battleTypeFlags: memory.battleTypeFlags,
          party: memory.trainer?.party, mechanics });
        if (!legality.run.allowed) {
          const knownTrap=legality.run.blockers.length>0&&legality.run.blockers.every(reason=>['arena-trap','shadow-tag','magnet-pull','wrapped','escape-prevention','rooted'].includes(reason));
          if(captureRequirements?.fightTrappedNonTargets&&record.shiny===false&&!legality.run.unidentifiedGhost&&knownTrap)return null;
          return stop("hunt-escape-blocked");
        }
        const ui = memory.ui ?? {};
        if (ui.battle?.stage === "action") return act("choose-battle-command", { targetCommand: "run", objective: "leave-non-target-encounter" });
        if (ui.battle?.stage === "move" || ui.bag) return act("close-menu", { objective: "leave-non-target-encounter" });
        if (ui.battle?.stage === "message") return act("acknowledge-cartridge-prompt", { objective: "leave-non-target-encounter" });
        return stop("unexpected-hunt-battle-menu");
      }
      if (encounterFingerprint(record) !== state.capture.fingerprint) return stop("protected-encounter-identity-changed");
      const flags = memory.battleTypeFlags;
      if(flags===132&&captureRequirements?.safari){
        if(!(knownCaptureFreeSlots(memory.trainer)>0))return stop('capture-storage-full-or-unknown');
        if(Number(memory.battle?.turn)>=policy.limits.maxCaptureTurns)return stop('capture-turn-budget');
        if(memory.safari?.balls===0)return stop('safari-balls-exhausted');
        const safariChoice=chooseSafariCapture(memory.safari);
        if(!safariChoice)return stop('safari-capture-state-unavailable');
        state.capture.safariChoice=safariChoice;
        if(memory.ui?.battle?.stage==='message')return act('acknowledge-cartridge-prompt');
        if(observation.phase!=='stable'||!observation.emulator.inputReady)return wait('safari-capture-transition');
        if(memory.ui?.battle?.stage==='action')return act('choose-safari-command',{targetAction:safariChoice.action,targetIndex:safariChoice.action==='bait'?1:0});
        return wait('safari-capture-transition');
      }
      // Ordinary singles, including scripted/legendary wild encounters. Safari,
      // ghost, link, tutorial, roamer and doubles need separate capture skills.
      if (!Number.isInteger(flags) || (flags & ~(4 | (captureRequirements?.roamer ? (1 << 10) : 0) | (1 << 13) | (1 << 17) | (1 << 18)))) return stop("unsupported-protected-battle");
      if (!(knownCaptureFreeSlots(memory.trainer) > 0)) return stop("capture-storage-full-or-unknown");
      if (!(memory.trainer?.party?.some((member) => member.hp > 0))) return stop("capture-party-fainted");
      if (Number(memory.battle?.turn) >= policy.limits.maxCaptureTurns) return stop("capture-turn-budget");
      const inventoryBalls = memory.trainer?.bag?.pokeBalls ?? [];
      const shinyPriority = captureRequirements?.shinyPriority === true && state.capture.pokemon.shiny === true;
      const balls = captureRequirements?.ballIds && !shinyPriority
        ? inventoryBalls.filter(ball => captureRequirements.ballIds.includes(ball.itemId)) : inventoryBalls;
      if (captureRequirements && !shinyPriority && inventoryBalls.filter(ball => [2,3,4].includes(ball.itemId)).reduce((sum,ball)=>sum+ball.quantity,0) <= captureRequirements.minBalls) return stop("capture-ball-reserve-reached");
      const master = policy.allowMasterBall || shinyPriority ? balls.findIndex((ball) => ball.itemId === 1 && ball.quantity > 0) : -1;
      const ui = memory.ui ?? {};
      if (ui.battle?.stage === 'message' || ui.party?.stage === 'message') return act('acknowledge-cartridge-prompt');
      const hazard = captureHazard(memory, mechanics);
      if (hazard === 'capture-battler-survival-unknown' && master < 0 && captureRequirements?.optimizeCapture) {
        const healing = selectCaptureHealing({mechanics,memory});
        if (healing) {
          if (ui.battle?.stage === 'action') return act('choose-battle-command',{targetCommand:'bag'});
          if (ui.party?.stage === 'choose-pokemon' && ui.party.itemId === healing.itemId)
            return act('choose-party-member',{targetPartySlot:healing.target.slot,targetSpecies:healing.target.species});
          if (ui.bag?.stage === 'list') return ui.bag.pocket !== 0
            ? act('choose-bag-pocket',{targetPocket:0})
            : act('choose-bag-item',{targetItemId:healing.itemId,targetIndex:memory.trainer.bag.items.findIndex(i=>i.itemId===healing.itemId)});
          if (ui.bag?.stage === 'context' && ui.bag.pocket === 0 && ui.bag.selectedItemId === healing.itemId)
            return act('choose-bag-context-action',{targetAction:'use',targetIndex:0});
          if (ui.party || ui.bag || ui.battle?.stage === 'move') return act('close-menu');
        }
        const legality=deriveBattleLegality({battle:memory.battle,battleTypeFlags:flags,mechanics,party:memory.trainer.party});
        const reserve=legality.switch.allowed ? memory.trainer.party
          .filter(p=>p.validity==='valid'&&!p.status1&&
            !(p.species===memory.battle.player.species&&p.hp===memory.battle.player.hp))
          .map(member=>({member,incoming:maximumCredibleIncomingDamage({mechanics,attacker:memory.battle.opponent,defender:member})}))
          .filter(p=>p.incoming!==null&&p.member.hp>p.incoming*3)
          .sort((a,b)=>b.member.hp/Math.max(1,b.incoming)-a.member.hp/Math.max(1,a.incoming))[0]?.member : null;
        if (reserve) {
          if(ui.party?.stage==='selection-menu')return ui.party.selectedPartySlot===reserve.slot
            ? act('choose-menu-option',{targetIndex:0}) : act('close-menu');
          if(ui.party?.stage==='choose-pokemon')return act('choose-party-member',{targetPartySlot:reserve.slot,targetSpecies:reserve.species});
          if(ui.battle?.stage==='action')return act('choose-battle-command',{targetCommand:'pokemon',targetPartySlot:reserve.slot});
          if(ui.bag||ui.battle?.stage==='move')return act('close-menu');
        }
      }
      const urgentBall = captureRequirements?.optimizeCapture && ['residual-damage-risk','opponent-escape-or-self-ko-risk'].includes(hazard);
      if (hazard && master < 0 && !urgentBall) return stop(hazard);
      const best = selectBestCaptureBall({ balls, opponent: memory.battle?.opponent, mechanics,
        ownedSpecies: memory.trainer?.pokedex?.ownedSpecies, turn: memory.battle?.turn });
      const selectedBall = master >= 0 && (shinyPriority || hazard || !best) ? { itemId: 1, index: master } : best;
      const ball = selectedBall ? { ...selectedBall, index: inventoryBalls.findIndex(ball => ball.itemId === selectedBall.itemId) } : null;
      if (!ball) return stop("capture-balls-exhausted");
      if(captureRequirements?.optimizeCapture && master<0 && !hazard){
        const battle=battleDecisionState(memory,ui);
        const legality=deriveBattleLegality({battle,battleTypeFlags:flags,mechanics,party:memory.trainer.party});
        let preparation=selectCapturePreparationMove({mechanics,player:battle.player,opponent:battle.opponent,
          selectableMoveSlots:new Set(legality.moves.selectableSlots)});
        // Never authorize damage from the model's fallback stats on a protected Pokémon.
        if(preparation?.kind==='weaken' && ![battle.player.stats?.attack,battle.player.stats?.spAttack,
          battle.opponent.stats?.defense,battle.opponent.stats?.spDefense].every(n=>Number.isFinite(n)&&n>0))preparation=null;
        const safeParty=memory.trainer.party.filter(member=>{
          const incoming=maximumCredibleIncomingDamage({mechanics,attacker:battle.opponent,defender:member});
          return !member.status1&&incoming!==null&&member.hp>incoming*3;
        });
        const specialist=selectCapturePreparationSpecialist({mechanics,party:safeParty,battle,
          activePreparation:preparation,switchAllowed:legality.switch.allowed});
        if(specialist){
          const slot=specialist.member.slot;
          if(ui.party?.stage==='selection-menu')return ui.party.selectedPartySlot===slot
            ? act('choose-menu-option',{targetIndex:0}) : act('close-menu');
          if(ui.party?.stage==='choose-pokemon')return act('choose-party-member',{targetPartySlot:slot,targetSpecies:specialist.member.species});
          if(ui.battle?.stage==='action')return act('choose-battle-command',{targetCommand:'pokemon',targetPartySlot:slot});
          if(ui.bag||ui.battle?.stage==='move')return act('close-menu');
        }else if(preparation){
          if(ui.battle?.stage==='action')return act('choose-battle-command',{targetCommand:'fight'});
          if(ui.battle?.stage==='move')return act('choose-battle-move',{targetMoveId:preparation.moveId,targetMoveSlot:preparation.moveSlot,
            ...(preparation.kind==='weaken'?{maximumCriticalDamage:preparation.maximumCriticalDamage}:{})});
          if(ui.bag||ui.party)return act('close-menu');
        }
      }
      if (ui.battle?.stage === "action") return act("choose-battle-command", { targetCommand: "bag" });
      if (ui.battle?.stage === "move" || ui.party) return act("close-menu");
      if (ui.battle?.stage === "message") return act("acknowledge-cartridge-prompt");
      if (ui.bag?.stage === "list") return ui.bag.pocket !== 2
        ? act("choose-bag-pocket", { targetPocket: 2 }) : act("choose-bag-item", { targetItemId: ball.itemId, targetIndex: ball.index });
      if (ui.bag?.stage === "context") return ui.bag.pocket === 2 && ui.bag.selectedItemId === ball.itemId
        ? act("choose-bag-context-action", { targetAction: "use", targetIndex: 0 }) : act("close-menu");
      return stop("unexpected-protected-capture-menu");
    },
  });
}
