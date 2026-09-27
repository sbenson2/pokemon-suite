// Battle policy: pure advice from one observation. Chooses the best damaging
// move by power × STAB × type effectiveness × accuracy, sends out the best
// healthy reserve when a member faints, and never leaves the cartridge waiting.
// Menu layouts: src/battle_controller_player.c HandleInputChooseAction /
// HandleInputChooseMove (2×2 cursors, DPAD toggles bit 0 / bit 1).

function cursorMove(current, target) {
  if (current === target) return null;
  if ((current & 1) !== (target & 1)) return (target & 1) ? 'right' : 'left';
  return (target & 2) ? 'down' : 'up';
}

export function scoreMove(move, attacker, defender, tables) {
  if (!move || move.id === 0 || move.pp === 0) return -1;
  if (attacker.disabledMove === move.id || attacker.encoreTimer > 0 && attacker.encoredMove !== move.id) return -1;
  const info = tables.move(move.id);
  if (attacker.tauntTimer > 0 && info.power === 0) return -1;
  if (info.power === 0) return 0;
  const stab = attacker.types.includes(info.type) ? 1.5 : 1;
  const effectiveness = tables.effectiveness(info.type, defender.types) / 10;
  const accuracy = info.accuracy === 0 ? 1 : info.accuracy / 100;
  const physical = info.type < 10;
  const ratio = physical ? (attacker.stats.attack + 1) / (defender.stats.defense + 1) : (attacker.stats.spAttack + 1) / (defender.stats.spDefense + 1);
  return info.power * stab * effectiveness * accuracy * Math.min(ratio, 3);
}

export function chooseMove(attacker, defender, tables) {
  let best = null;
  attacker.moves.forEach((move, index) => {
    const score = scoreMove(move, attacker, defender, tables);
    if (score >= 0 && (!best || score > best.score)) best = { index, score, move };
  });
  return best;
}

export function chooseReserve(party, activeIndexes) {
  let best = null;
  party.forEach((member, index) => {
    if (activeIndexes.includes(index) || member.isEgg || !member.hasSpecies || member.hp === 0) return;
    const score = member.level * 100 + member.hp;
    if (!best || score > best.score) best = { index, score };
  });
  return best;
}

const BALLS_POCKET = 1;
const ITEMS_POCKET = 0;
const POTIONS = Object.freeze(['ITEM_POTION', 'ITEM_SUPER_POTION', 'ITEM_HYPER_POTION', 'ITEM_FULL_RESTORE', 'ITEM_MAX_POTION']);

/** Gen III damage estimate (no random roll, no crit) for one move against a battler. */
export function estimateDamage(attacker, move, defender, tables) {
  const info = tables.move(move.id);
  if (!info || info.power === 0 || move.pp === 0) return 0;
  const physical = info.type < 10;
  const attack = physical ? attacker.stats.attack : attacker.stats.spAttack;
  const defense = Math.max(1, physical ? defender.stats.defense : defender.stats.spDefense);
  const base = Math.floor(Math.floor(Math.floor(2 * attacker.level / 5 + 2) * info.power * attack / defense) / 50) + 2;
  const stab = attacker.types.includes(info.type) ? 1.5 : 1;
  const effectiveness = tables.effectiveness(info.type, defender.types) / 10;
  return Math.floor(base * stab * effectiveness * 0.85);
}

function weakestDamagingMove(attacker, defender, tables) {
  let weakest = null;
  attacker.moves.forEach((move, index) => {
    const score = scoreMove(move, attacker, defender, tables);
    if (score > 0 && (!weakest || score < weakest.score)) weakest = { index, score, move };
  });
  return weakest;
}

export function createBattleAdvisor({ tables, constants = null }) {
  const itemId = (name) => constants?.items?.[name] ?? null;
  return Object.freeze({
    advise(observation, context = {}) {
      const battle = observation.battle;
      if (!battle) return null;
      const player = battle.battlers.find(battler => battler.side === 'player' && battler.awaitingInput) ?? null;
      const evidence = ['src/battle_controller_player.c', 'src/battle_main.c gTypeEffectiveness'];
      const opponentNow = battle.battlers.find(battler => battler.side === 'opponent' && battler.mon.hp > 0) ?? battle.battlers.find(battler => battler.side === 'opponent');
      const activePlayer = battle.battlers.find(battler => battler.side === 'player');
      const balls = (observation.bag?.pokeBalls ?? []).reduce((sum, slot) => sum + slot.quantity, 0);
      const wantsCapture = !battle.isTrainer && opponentNow && context.captureTargets?.has(opponentNow.mon.species) && balls > 0 && observation.party.length < 6;
      const potionSlot = (observation.bag?.items ?? []).findIndex(slot => POTIONS.some(name => itemId(name) === slot.itemId) && slot.quantity > 0);
      const activeHpFraction = activePlayer && activePlayer.mon.maxHp ? activePlayer.mon.hp / activePlayer.mon.maxHp : 1;
      const wantsPotion = battle.isTrainer && potionSlot >= 0 && activeHpFraction < 0.3 && activeHpFraction > 0 && (context.potionUses ?? 0) < 3;
      if (observation.emulator.mode === 'bag' || observation.is('CB2_BagMenuRun')) {
        if(observation.emulator.paletteFadeActive||!['Task_BagMenu_HandleInput','Task_ItemContext_SingleRow','Task_ItemContext_MultipleRows'].some(name=>observation.hasTask(name)))return null;
        const bag = observation.menus.bag;
        const wantPocket = wantsCapture ? BALLS_POCKET : ITEMS_POCKET;
        if (!wantsCapture && !wantsPotion) return { kind: 'battle-bag-cancel', button: 'b', confidence: 0.6, evidenceRefs: evidence };
        if (observation.hasTask('Task_ItemContext_SingleRow') || observation.hasTask('Task_ItemContext_MultipleRows')) return { kind: 'battle-bag-use', button: 'a', confidence: 0.8, evidenceRefs: ['src/item_menu.c Task_ItemContext'] };
        if (bag.pocket !== wantPocket) return { kind: 'battle-bag-pocket', button: bag.pocket < wantPocket ? 'right' : 'left', confidence: 0.8, evidenceRefs: ['include/item_menu.h BagPosition.pocket'], detail: { pocket: bag.pocket, want: wantPocket } };
        const index = bag.cursor[bag.pocket] + bag.scroll[bag.pocket];
        const target = wantsCapture ? 0 : potionSlot;
        if (index !== target) return { kind: 'battle-bag-cursor', button: index < target ? 'down' : 'up', confidence: 0.8, evidenceRefs: evidence, detail: { index, target } };
        return { kind: wantsCapture ? 'battle-throw-ball' : 'battle-use-potion', button: 'a', confidence: 0.85, evidenceRefs: ['src/item_use.c ItemUseInBattle_PokeBall'], detail: { slot: target }, itemUse: !wantsCapture };
      }
      if (observation.emulator.mode === 'party-menu' || observation.is('CB2_UpdatePartyMenu')) {
        // OpenPartyMenuInBattle temporarily calls UpdatePartyToBattleOrder;
        // gBattlerPartyIndexes still refers to the order outside this menu.
        const partyIndex = battler => Number.isInteger(battler?.mon.personality) && Number.isInteger(battler?.mon.otId)
          ? observation.party.findIndex(p => p.personality === battler.mon.personality && p.otId === battler.mon.otId)
          : battler?.partyIndex;
        const players = battle.battlers.filter(battler => battler.side === 'player');
        const active = players.map(partyIndex);
        if (active.some(index => !Number.isInteger(index) || index < 0)) return null;
        const cursor = observation.menus.partyMenu.slotId;
        if (observation.menus.partyMenu.action === 3 || (observation.menus.partyMenu.bagItem ?? 0) !== 0) {
          // An item is being applied: target the active battler, not a reserve.
          const slot = partyIndex(activePlayer) ?? 0;
          if (observation.hasTask('Task_HandleSelectionMenuInput')) return { kind: 'battle-item-confirm', button: 'a', confidence: 0.85, evidenceRefs: evidence };
          if (cursor === slot) return { kind: 'battle-item-target', button: 'a', confidence: 0.85, evidenceRefs: evidence, detail: { slot } };
          return { kind: 'battle-item-cursor', button: cursor < slot ? 'down' : 'up', confidence: 0.8, evidenceRefs: evidence, detail: { cursor, slot } };
        }
        // PARTY_ACTION_SEND_OUT (1) cannot be cancelled. Ordinary optional
        // switches can be declined even if advancing text already opened them.
        if (observation.menus.partyMenu.action === 0 && players.every(p => p.mon.hp > 0))
          return { kind: 'battle-decline-switch', button: 'b', confidence: 1, evidenceRefs: evidence };
        const reserve = chooseReserve(observation.party, active);
        if (observation.hasTask('Task_HandleSelectionMenuInput')) return { kind: 'battle-party-confirm', button: 'a', confidence: 0.9, evidenceRefs: evidence, detail: { cursor } };
        if (!reserve) return { kind: 'battle-party-cancel', button: 'b', confidence: 0.5, evidenceRefs: evidence };
        if (cursor === reserve.index) return { kind: 'battle-party-select', button: 'a', confidence: 0.9, evidenceRefs: evidence, detail: { slot: reserve.index } };
        return { kind: 'battle-party-move', button: cursor < reserve.index ? 'down' : 'up', confidence: 0.8, evidenceRefs: evidence, detail: { cursor, slot: reserve.index } };
      }
      if (!player) return { kind: 'battle-advance', button: 'a', confidence: 0.5, evidenceRefs: evidence, cadence: 10 };
      const opponent = opponentNow;
      const unwantedWild=!battle.isTrainer&&!wantsCapture&&player.mon.level>=100&&battle.enemyParty?.length>0&&battle.enemyParty.every(p=>p.validity==='valid'&&p.shiny===false);
      if(unwantedWild&&player.controllerName==='HandleInputChooseAction'){
        const button=cursorMove(player.actionCursor,3);
        return {kind:button?'battle-run-cursor':'battle-run',button:button??'a',confidence:1,evidenceRefs:evidence};
      }
      if(unwantedWild&&player.controllerName==='HandleInputChooseMove')return {kind:'battle-back-to-run',button:'b',confidence:1,evidenceRefs:evidence};
      switch (player.controllerName) {
        case 'HandleInputChooseAction': {
          if (battle.isWallyTutorial) return { kind: 'battle-advance', button: 'a', confidence: 0.9, evidenceRefs: evidence };
          const opponentHp = opponent && opponent.mon.maxHp ? opponent.mon.hp / opponent.mon.maxHp : 1;
          const weakest = opponent ? weakestDamagingMove(player.mon, opponent.mon, tables) : null;
          const weakestDamage = weakest ? estimateDamage(player.mon, weakest.move, opponent.mon, tables) : 0;
          const wouldKo = opponent ? weakestDamage >= opponent.mon.hp : false;
          const openBag = (wantsCapture && (opponentHp <= 0.5 || wouldKo)) || wantsPotion;
          const targetAction = openBag ? 1 : 0;
          const move = player.actionCursor === targetAction ? null : cursorMove(player.actionCursor, targetAction);
          if (move) return { kind: 'battle-action-cursor', button: move, confidence: 0.9, evidenceRefs: evidence, detail: { target: targetAction } };
          return openBag ? { kind: wantsPotion ? 'battle-open-bag-potion' : 'battle-open-bag-ball', button: 'a', confidence: 0.85, evidenceRefs: evidence, detail: { species: opponent?.mon.speciesName ?? null, opponentHp, wouldKo, weakestDamage } } : { kind: 'battle-fight', button: 'a', confidence: 0.9, evidenceRefs: evidence };
        }
        case 'HandleInputChooseMove': {
          const weakest=wantsCapture&&opponent?weakestDamagingMove(player.mon,opponent.mon,tables):null;
          if(wantsCapture&&(!weakest||estimateDamage(player.mon,weakest.move,opponent.mon,tables)>=opponent.mon.hp))return {kind:'battle-back-to-capture',button:'b',confidence:1,evidenceRefs:evidence};
          const opponentHp = opponent && opponent.mon.maxHp ? opponent.mon.hp / opponent.mon.maxHp : 1;
          const best = opponent ? ((wantsCapture && opponentHp > 0.5) ? weakestDamagingMove(player.mon, opponent.mon, tables) : chooseMove(player.mon, opponent.mon, tables)) : null;
          const target = best?.index ?? 0;
          const move = cursorMove(player.moveCursor, target);
          if (move) return { kind: 'battle-move-cursor', button: move, confidence: 0.9, evidenceRefs: evidence, detail: { target, cursor: player.moveCursor } };
          return { kind: 'battle-use-move', button: 'a', confidence: 0.9, evidenceRefs: evidence, detail: { move: best?.move?.name ?? null, score: best?.score ?? null } };
        }
        case 'HandleInputChooseTarget': return { kind: 'battle-target', button: 'a', confidence: 0.8, evidenceRefs: evidence };
        case 'PlayerHandleYesNoInput': return { kind: 'battle-decline-switch', button: 'b', confidence: 0.7, evidenceRefs: evidence };
        case 'OpenPartyMenuToChooseMon':
        case 'WaitForMonSelection': return { kind: 'battle-advance', button: 'a', confidence: 0.5, evidenceRefs: evidence, cadence: 10 };
        default: return { kind: 'battle-advance', button: 'a', confidence: 0.5, evidenceRefs: evidence, cadence: 10 };
      }
    },
  });
}
